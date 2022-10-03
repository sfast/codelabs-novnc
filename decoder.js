import init, { decode_qoi } from './qoi_viewer.js'
var arr;

async function run() {
  await init();
  self.addEventListener('message', function(evt) {
    try {
      let length = evt.data.length;
      let data = new Uint8Array(evt.data.sab.slice(0, length));
      let resultData = decode_qoi(data);
      if (! arr) {
          arr = new Uint8Array(evt.data.sabR);
      }
      let lengthR = resultData.data.length;
      arr.set(resultData.data);
      let img = {colorSpace: resultData.colorSpace, width: resultData.width, height: resultData.height};  
      self.postMessage({result: 0, img: img, length: lengthR, width: evt.data.width, height: evt.data.height, x: evt.data.x, y: evt.data.y});
    } catch (err) {
      console.log(err)
    }
  }, false);
}

run();

