#include <emscripten/emscripten.h>
#include <stdio.h>
#include <string.h>

#define STBI_ASSERT(x)
extern "C" {

    EMSCRIPTEN_KEEPALIVE
    int decodeQOI (uint8_t * arrayBuffer, int byteOffset, int byteLength, int outputChannels, uint8_t * result) {
        
        // move to the offset
        arrayBuffer += byteOffset;

        // resulting array needs to also be moved to it's proper location ( past the arraybuffer's length )
        result += byteLength;

        int width = ((arrayBuffer[4] << 24) | (arrayBuffer[5] << 16) | (arrayBuffer[6] << 8) | arrayBuffer[7]) >> 0;
        int height = ((arrayBuffer[8] << 24) | (arrayBuffer[9] << 16) | (arrayBuffer[10] << 8) | arrayBuffer[11]) >> 0;
        int pixelLength = width * height * 4;

        uint8_t magic1 = arrayBuffer[0];
        uint8_t magic2 = arrayBuffer[1];
        uint8_t magic3 = arrayBuffer[2];
        uint8_t magic4 = arrayBuffer[3];

        uint8_t channels = arrayBuffer[12];
        uint8_t colorspace = arrayBuffer[13];

        if(pixelLength == 0) {
            return 6;
        }

        if (magic1 != 113 || magic2 != 111 || magic3 != 105|| magic4 != 102) {
            //throw new Error('QOI.decode: The signature of the QOI file is invalid');
            result[0] = magic1;
            result[1] = magic2;
            result[2] = magic3;
            result[3] = magic4;

            return 5;
        }

        if (channels < 3 || channels > 4) {
            //throw new Error('QOI.decode: The number of channels declared in the file is invalid');
            return 4;
        }

        if (colorspace > 1) {
            //throw new Error('QOI.decode: The colorspace declared in the file is invalid');
            return 3;
        }

        if (outputChannels < 3 || outputChannels > 4) {
            //throw new Error('QOI.decode: The number of channels for the output is invalid');
            return 2;
        }

        int arrayPosition = 14;

        uint8_t index[64 * 4];
        uint8_t indexPosition = 0;

        uint8_t red = 0;
        uint8_t green = 0;
        uint8_t blue = 0;
        uint8_t alpha = 255;

        int chunksLength = byteLength - 8;
        int pixelPosition = 0;
        int run = 0;

        for (; pixelPosition < pixelLength && arrayPosition < byteLength - 4; pixelPosition += outputChannels) {
            if (run > 0) {
                run--;
            } else if (arrayPosition < chunksLength) {
                uint8_t byte1 = arrayBuffer[arrayPosition++];

                if (byte1  == 254) { // QOI_OP_RGB
                    red = arrayBuffer[arrayPosition++];
                    green = arrayBuffer[arrayPosition++];
                    blue = arrayBuffer[arrayPosition++];
                } else if (byte1  == 255) { // QOI_OP_RGBA
                    red = arrayBuffer[arrayPosition++];
                    green = arrayBuffer[arrayPosition++];
                    blue = arrayBuffer[arrayPosition++];
                    alpha = arrayBuffer[arrayPosition++]; 
                } else if ((byte1 & 192)  == 0) { // QOI_OP_INDEX
                    red = index[byte1 * 4];
                    green = index[byte1 * 4 + 1];
                    blue = index[byte1 * 4 + 2];
                    alpha = index[byte1 * 4 + 3];
                } else if ((byte1 & 192)  == 64) { // QOI_OP_DIFF
                    red += ((byte1 >> 4) & 3) - 2;
                    green += ((byte1 >> 2) & 3) - 2;
                    blue += (byte1 & 3) - 2;

                    // handle wraparound
                    red = (red + 256) % 256;
                    green = (green + 256) % 256;
                    blue = (blue + 256) % 256;
                } else if ((byte1 & 192)  == 128) { // QOI_OP_LUMA
                    uint8_t byte2 = arrayBuffer[arrayPosition++];
                    uint8_t greenDiff = (byte1 & 63) - 32;
                    uint8_t redDiff = greenDiff + ((byte2 >> 4) & 15) - 8;
                    uint8_t blueDiff = greenDiff + (byte2 & 15) - 8;

                    // handle wraparound
                    red = (red + redDiff + 256) % 256;
                    green = (green + greenDiff + 256) % 256;
                    blue = (blue + blueDiff + 256) % 256;
                } else if ((byte1 & 192) == 192) { // QOI_OP_RUN
                    run = byte1 & 63;
                }

                indexPosition = ((red * 3 + green * 5 + blue * 7 + alpha * 11) % 64) * 4;
                index[indexPosition] = red;
                index[indexPosition + 1] = green;
                index[indexPosition + 2] = blue;
                index[indexPosition + 3] = alpha;
            }

            if (outputChannels  == 4) { // RGBA
                result[pixelPosition] = red;
                result[pixelPosition + 1] = green;
                result[pixelPosition + 2] = blue;
                result[pixelPosition + 3] = 255; //hardcoded full alpha //alpha;
            } else { // RGB
                result[pixelPosition] = red;
                result[pixelPosition + 1] = green;
                result[pixelPosition + 2] = blue;
            }
        }

        if (pixelPosition < pixelLength) {
            //throw new Error('QOI.decode: Incomplete image');
            memset(result, 0, byteLength);
            result[0] = pixelPosition;
            result[1] = pixelLength;
            result[2] = 111;
            return 1;
        }

        // checking the 00000001 padding is not required, as per specs
        return 0;
    }
}