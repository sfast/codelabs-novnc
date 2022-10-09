/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * (c) 2012 Michael Tinglof, Joe Balaz, Les Piech (Mercuri.ca)
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import * as Log from '../util/logging.js';
import Inflator from "../inflator.js";
const qoiErrors = {
    SUCCESS: 0,
    QOI_INCOMPLETE_IMAGE: 1,
    QOI_OUTPUT_CHANNELS_INVALID: 2,
    QOI_COLORSPACE_INVALID: 3,
    QOI_INVALID_CHANNELS: 4,
    QOI_INVALID_SIGNATURE: 5,
    QOI_PIXEL_LENGTH_INVALID: 6,
};

export default class TightDecoder {
    constructor() {
        this._ctl = null;
        this._filter = null;
        this._numColors = 0;
        this._palette = new Uint8Array(1024);  // 256 * 4 (max palette size * max bytes-per-pixel)
        this._len = 0;

        this._zlibs = [];
        for (let i = 0; i < 4; i++) {
            this._zlibs[i] = new Inflator();
        }
        this._sabTest = typeof SharedArrayBuffer;
        if (this._sabTest !== 'undefined') {
            this._threads = 40;
            this._workerEnabled = false;
            this._displayGlobal = null;
            this._workers = [];
            this._isDecoded = [];
            this._sabs = [];
            this._sabsR = [];
            this._arrs = [];
            this._qoiRects = [];
            this._rectQlooping = false;
            for (let i = 0; i < this._threads; i++) {
                this._workers.push(new Worker("decoder.js"));
                this._isDecoded.push(true);
                this._sabs.push(new SharedArrayBuffer(300000));
                this._sabsR.push(new SharedArrayBuffer(400000));
                this._arrs.push(new Uint8Array(this._sabs[i]));
                this._workers[i].onmessage = (evt) => {
                    this._isDecoded[i] = true;
                    this._workerEnabled = true;
                    if(evt.data.result == 0) {
                        let data = new Uint8ClampedArray(this._sabsR[i].slice(0,  evt.data.length));
                        let img = new ImageData(data.slice(), evt.data.img.width, evt.data.img.height, {colorSpace: evt.data.img.colorSpace});
                        this._displayGlobal.blitQoi(
                            evt.data.x,
                            evt.data.y,
                            evt.data.width,
                            evt.data.height,
                            img,
                            0,
                            false);
                    }
                };
            }
        }

        fetch("/core/decoders/qoi.wasm")
            .then(bytes => bytes.arrayBuffer())
            .then(mod => WebAssembly.compile(mod))
            .then(module => {
                return new WebAssembly.Instance(module);
            })
            .then(instance => {
                this._instance = instance;
            });

    }

    decodeRect(x, y, width, height, sock, display, depth) {
        if (this._ctl === null) {
            if (sock.rQwait("TIGHT compression-control", 1)) {
                return false;
            }

            this._ctl = sock.rQshift8();

            // Reset streams if the server requests it
            for (let i = 0; i < 4; i++) {
                if ((this._ctl >> i) & 1) {
                    this._zlibs[i].reset();
                    Log.Info("Reset zlib stream " + i);
                }
            }

            // Figure out filter
            this._ctl = this._ctl >> 4;
        }

        let ret;

        if (this._ctl === 0x08) {
            ret = this._fillRect(x, y, width, height,
                                 sock, display, depth);
        } else if (this._ctl === 0x09) {
            ret = this._jpegRect(x, y, width, height,
                                 sock, display, depth);
        } else if (this._ctl === 0x0A) {
            ret = this._pngRect(x, y, width, height,
                                sock, display, depth);
        } else if ((this._ctl & 0x08) == 0) {
            ret = this._basicRect(this._ctl, x, y, width, height,
                                  sock, display, depth);
        } else if (this._ctl === 0x0B) {
            ret = this._webpRect(x, y, width, height,
                                sock, display, depth);
        } else if (this._ctl === 0x0C) {
            ret = this._qoiRect(x, y, width, height,
                                sock, display, depth);
        } else {
            throw new Error("Illegal tight compression received (ctl: " +
                                   this._ctl + ")");
        }

        if (ret) {
            this._ctl = null;
        }

        return ret;
    }

    _fillRect(x, y, width, height, sock, display, depth) {
        if (sock.rQwait("TIGHT", 3)) {
            return false;
        }

        const rQi = sock.rQi;
        const rQ = sock.rQ;

        display.fillRect(x, y, width, height,
                         [rQ[rQi], rQ[rQi + 1], rQ[rQi + 2]], false);
        sock.rQskipBytes(3);

        return true;
    }

    _jpegRect(x, y, width, height, sock, display, depth) {
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        display.imageRect(x, y, width, height, "image/jpeg", data);

        return true;
    }

    _webpRect(x, y, width, height, sock, display, depth) {
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        display.imageRect(x, y, width, height, "image/webp", data);

        return true;
    }

    _processRectQ() {
        for (let ri in this._qoiRects) {
            workerLoop:
            for (let i = 0; i < this._threads; i++) {
                if (this._isDecoded[i] == true) {
                    this._isDecoded[i] = false;
                    this._arrs[i].set(this._qoiRects[ri].data);
                    this._workers[i].postMessage({
                        length: this._qoiRects[ri].data.length,
                        x: this._qoiRects[ri].x,
                        y: this._qoiRects[ri].y,
                        width: this._qoiRects[ri].width,
                        height: this._qoiRects[ri].height,
                        depth: this._qoiRects[ri].depth,
                        sab: this._sabs[i],
                        sabR: this._sabsR[i]});
                    delete this._qoiRects[ri];
                    break workerLoop;
                }
            }
        }
        this._rectQlooping = false;
    }

    _qoiRect(x, y, width, height, sock, display, depth) {
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }
        if (this._sabTest !== 'undefined') {
            let dataClone = new Uint8Array(data);
            let item = {x: x,y: y,width: width,height: height,data: dataClone,depth: depth};
            this._qoiRects.push(item);
            if (! this._rectQlooping) {
                this._rectQlooping = true;
                this._processRectQ();
            }
        }
        if (! this._workerEnabled) {
            if (! this._displayGlobal) {
                this._displayGlobal = display;
            }
            let pixelLength = width * height * 4;
            let importData = new Uint8Array(this._instance.exports.memory.buffer, 0, data.length);
            importData.set(data);

            let resultData = new Uint8Array(this._instance.exports.memory.buffer,
                                           importData.byteOffset + importData.length,
                                           pixelLength);
            let result = this._instance.exports.decodeQOI(importData, 0, importData.length,
                4, resultData);

            if(result == 0) {
                display.blitImage(
                    x,
                    y,
                    width,
                    height,
                    resultData,
                    0,
                    false);
            } else {
                switch (result) {
                    case qoiErrors.QOI_INCOMPLETE_IMAGE: {
                        Log.Info('QOI.decode: Incomplete image');
                        break;
                    } case qoiErrors.QOI_OUTPUT_CHANNELS_INVALID: {
                        Log.Info("QOI.decode: The number of channels for the output is invalid");
                        break;
                    } case qoiErrors.QOI_COLORSPACE_INVALID: {
                        Log.Info("QOI.decode: The colorspace declared in the file is invalid");
                        break;
                    } case qoiErrors.QOI_INVALID_CHANNELS: {
                        Log.Info("QOI.decode: The number of channels declared in the file is invalid");
                        break;
                    } case qoiErrors.QOI_INVALID_SIGNATURE: {
                        Log.Info("QOI.decode: The signature of the QOI file is invalid");
                        break;
                    } case qoiErrors.QOI_PIXEL_LENGTH_INVALID: {
                        Log.Info("QOI.decode: The pixel length is ZERO");
                        break;
                    }

                    return false;
                }
            }
        }
        return true;
    }

    _pngRect(x, y, width, height, sock, display, depth) {
        throw new Error("PNG received in standard Tight rect");
    }

    _basicRect(ctl, x, y, width, height, sock, display, depth) {
        if (this._filter === null) {
            if (ctl & 0x4) {
                if (sock.rQwait("TIGHT", 1)) {
                    return false;
                }

                this._filter = sock.rQshift8();
            } else {
                // Implicit CopyFilter
                this._filter = 0;
            }
        }

        let streamId = ctl & 0x3;

        let ret;

        switch (this._filter) {
            case 0: // CopyFilter
                ret = this._copyFilter(streamId, x, y, width, height,
                                       sock, display, depth);
                break;
            case 1: // PaletteFilter
                ret = this._paletteFilter(streamId, x, y, width, height,
                                          sock, display, depth);
                break;
            case 2: // GradientFilter
                ret = this._gradientFilter(streamId, x, y, width, height,
                                           sock, display, depth);
                break;
            default:
                throw new Error("Illegal tight filter received (ctl: " +
                                       this._filter + ")");
        }

        if (ret) {
            this._filter = null;
        }

        return ret;
    }

    _copyFilter(streamId, x, y, width, height, sock, display, depth) {
        const uncompressedSize = width * height * 3;
        let data;

        if (uncompressedSize === 0) {
            return true;
        }

        if (uncompressedSize < 12) {
            if (sock.rQwait("TIGHT", uncompressedSize)) {
                return false;
            }

            data = sock.rQshiftBytes(uncompressedSize);
        } else {
            data = this._readData(sock);
            if (data === null) {
                return false;
            }

            this._zlibs[streamId].setInput(data);
            data = this._zlibs[streamId].inflate(uncompressedSize);
            this._zlibs[streamId].setInput(null);
        }

        let rgbx = new Uint8Array(width * height * 4);
        for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
            rgbx[i]     = data[j];
            rgbx[i + 1] = data[j + 1];
            rgbx[i + 2] = data[j + 2];
            rgbx[i + 3] = 255;  // Alpha
        }

        display.blitImage(x, y, width, height, rgbx, 0, false);

        return true;
    }

    _paletteFilter(streamId, x, y, width, height, sock, display, depth) {
        if (this._numColors === 0) {
            if (sock.rQwait("TIGHT palette", 1)) {
                return false;
            }

            const numColors = sock.rQpeek8() + 1;
            const paletteSize = numColors * 3;

            if (sock.rQwait("TIGHT palette", 1 + paletteSize)) {
                return false;
            }

            this._numColors = numColors;
            sock.rQskipBytes(1);

            sock.rQshiftTo(this._palette, paletteSize);
        }

        const bpp = (this._numColors <= 2) ? 1 : 8;
        const rowSize = Math.floor((width * bpp + 7) / 8);
        const uncompressedSize = rowSize * height;

        let data;

        if (uncompressedSize === 0) {
            return true;
        }

        if (uncompressedSize < 12) {
            if (sock.rQwait("TIGHT", uncompressedSize)) {
                return false;
            }

            data = sock.rQshiftBytes(uncompressedSize);
        } else {
            data = this._readData(sock);
            if (data === null) {
                return false;
            }

            this._zlibs[streamId].setInput(data);
            data = this._zlibs[streamId].inflate(uncompressedSize);
            this._zlibs[streamId].setInput(null);
        }

        // Convert indexed (palette based) image data to RGB
        if (this._numColors == 2) {
            this._monoRect(x, y, width, height, data, this._palette, display);
        } else {
            this._paletteRect(x, y, width, height, data, this._palette, display);
        }

        this._numColors = 0;

        return true;
    }

    _monoRect(x, y, width, height, data, palette, display) {
        // Convert indexed (palette based) image data to RGB
        // TODO: reduce number of calculations inside loop
        const dest = this._getScratchBuffer(width * height * 4);
        const w = Math.floor((width + 7) / 8);
        const w1 = Math.floor(width / 8);

        for (let y = 0; y < height; y++) {
            let dp, sp, x;
            for (x = 0; x < w1; x++) {
                for (let b = 7; b >= 0; b--) {
                    dp = (y * width + x * 8 + 7 - b) * 4;
                    sp = (data[y * w + x] >> b & 1) * 3;
                    dest[dp]     = palette[sp];
                    dest[dp + 1] = palette[sp + 1];
                    dest[dp + 2] = palette[sp + 2];
                    dest[dp + 3] = 255;
                }
            }

            for (let b = 7; b >= 8 - width % 8; b--) {
                dp = (y * width + x * 8 + 7 - b) * 4;
                sp = (data[y * w + x] >> b & 1) * 3;
                dest[dp]     = palette[sp];
                dest[dp + 1] = palette[sp + 1];
                dest[dp + 2] = palette[sp + 2];
                dest[dp + 3] = 255;
            }
        }

        display.blitImage(x, y, width, height, dest, 0, false);
    }

    _paletteRect(x, y, width, height, data, palette, display) {
        // Convert indexed (palette based) image data to RGB
        const dest = this._getScratchBuffer(width * height * 4);
        const total = width * height * 4;
        for (let i = 0, j = 0; i < total; i += 4, j++) {
            const sp = data[j] * 3;
            dest[i]     = palette[sp];
            dest[i + 1] = palette[sp + 1];
            dest[i + 2] = palette[sp + 2];
            dest[i + 3] = 255;
        }

        display.blitImage(x, y, width, height, dest, 0, false);
    }

    _gradientFilter(streamId, x, y, width, height, sock, display, depth) {
        throw new Error("Gradient filter not implemented");
    }

    _readData(sock) {
        if (this._len === 0) {
            if (sock.rQwait("TIGHT", 3)) {
                return null;
            }

            let byte;

            byte = sock.rQshift8();
            this._len = byte & 0x7f;
            if (byte & 0x80) {
                byte = sock.rQshift8();
                this._len |= (byte & 0x7f) << 7;
                if (byte & 0x80) {
                    byte = sock.rQshift8();
                    this._len |= byte << 14;
                }
            }
        }

        if (sock.rQwait("TIGHT", this._len)) {
            return null;
        }

        let data = sock.rQshiftBytes(this._len);
        this._len = 0;

        return data;
    }

    _getScratchBuffer(size) {
        if (!this._scratchBuffer || (this._scratchBuffer.length < size)) {
            this._scratchBuffer = new Uint8Array(size);
        }
        return this._scratchBuffer;
    }
}
