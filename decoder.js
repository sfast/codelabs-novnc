import init, { decode_qoi } from './qoi_viewer.js'

async function run() {
  await init();
  self.addEventListener('message', function(evt) {
    try {
      let resultData = decode_qoi(evt.data.data);
      self.postMessage({result: 0, resultData: resultData, width: evt.data.width, height: evt.data.height, x: evt.data.x, y: evt.data.y});
    } catch (err) {
      console.log(err)
    }
  }, false);
}

run();

