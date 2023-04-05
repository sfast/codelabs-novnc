const generateUUID = () => ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
  (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
);

class SessionRecorder {
  constructor() {
    this.recorder = null;
    this.sourceCanvasEl = null;
    this.streamCanvasEl = null;
    this.cursorImageEl = null;

    // load the cursor image
    const imageEl = document.createElement("img");
    imageEl.width = 24;
    imageEl.height = 24;
    imageEl.src = "app/images/cursor.svg";
    imageEl.onload = () => this.cursorImageEl = imageEl;
  }

  initialize(rfb) {
    this.rfb = rfb;
  }

  start(fps = 30) {
    // Render to an off-screen canvas at the desired rate
    //
    // NOTE: noVNC does not render the cursor directly onto the canvas, instead a
    // separate image is drawn over the canvas at mouse position (via CSS)
    // so we do it ourselves..
    this.streamCanvasEl = null;
    this.streamCanvasEl = document.createElement("canvas");
    this.streamCanvasEl.width = document.body.clientWidth;
    this.streamCanvasEl.height = document.body.clientHeight;

    this._renderToCanvas = setInterval(() => {
      const context = this.streamCanvasEl.getContext("2d");
      context.clearRect(0, 0, this.streamCanvasEl.width, this.streamCanvasEl.height);
      context.drawImage(this.rfb._canvas, 0, 0);
      context.fillStyle = "red";
      context.drawImage(this.cursorImageEl, this.rfb._mousePos.x, this.rfb._mousePos.y);
    }, 1000/fps);

    // create a proper video stream
    const stream = this.streamCanvasEl.captureStream();

    this.recorder = new MediaRecorder(stream, {
      audioBitsPerSecond: 128000, // 128 Kbit/sec
      ideoBitsPerSecond: 2500000, // 2.5 Mbit/sec
      mimeType: "video/webm; codecs=vp9"
    });

    this.recorder.ondataavailable = (e) => {
      const blob = new Blob([e.data], { type: "video/webm" });
      const downloadLink = document.createElement("a");
      downloadLink.download = `${generateUUID()}.webm`;
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.dispatchEvent(new MouseEvent("click"));
      setTimeout(() => URL.revokeObjectURL(downloadLink.href), 1);
    }

    this.recorder.onstop = () => clearInterval(this._renderToCanvas);

    this.recorder.start();
  }

  stop() {
    this.recorder.stop();
  }
}

export default SessionRecorder;