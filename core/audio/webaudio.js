export default class WebAudio {
    constructor() {

        //constants for audio behavoir
        this.maximumAudioLag = 1.5; //amount of seconds we can potentially be behind the server audio stream
        this.syncLagInterval = 5000; //check every x milliseconds if we are behind the server audio stream
        this.updateBufferEvery = 20; //add recieved data to the player buffer every x milliseconds
        this.reduceBufferInterval = 500; //trim the output audio stream buffer every x milliseconds so we don't overflow
        this.maximumSecondsOfBuffering = 1; //maximum amount of data to store in the play buffer
        this.connectionCheckInterval = 500; //check the connection every x milliseconds

        //register all our background timers. these need to be created only once - and will run independent of the object's streams/properties
        setInterval(() => this.updateQueue(), this.updateBufferEvery);
        setInterval(() => this.syncInterval(), this.syncLagInterval);
        setInterval(() => this.reduceBuffer(), this.reduceBufferInterval);
        setInterval(() => this.tryLastPacket(), this.connectionCheckInterval);
        this.start();
    }

    //registers all the event handlers for when this stream is closed - or when data arrives.
    registerHandlers() {
        this.mediaSource.addEventListener('sourceended', e => this.socketDisconnected(e))
        this.mediaSource.addEventListener('sourceclose', e => this.socketDisconnected(e))
        this.mediaSource.addEventListener('error', e => this.socketDisconnected(e))
        this.buffer.addEventListener('error', e => this.socketDisconnected(e))
        this.buffer.addEventListener('abort', e => this.socketDisconnected(e))
    }

    socketDisconnected(e) {
        console.log("Audio failed: " + e)
        this.mediaSource = null;
        this.start();
    }

    //starts the web audio stream. only call this method on button click.
    start() {
        if (!!this.audio) this.audio.remove();
        this.queue = null;
        this.buffer = null;

        //if (!this.mediaSource) {
            this.audio = document.createElement('audio');
            
            this.audio.autoplay = true;
            this.mediaSource = new MediaSource()
            this.audio.src = window.URL.createObjectURL(this.mediaSource);
            this.mediaSource.addEventListener('sourceopen', e => this.onSourceOpen())
            //first we need a media source - and an audio object that contains it.

        //}

        //start our stream - we can only do this on user input
        this.audio.play().then(function() {
            console.log("Playback started.");
        }).catch(function(e) {
            console.log("Playback failed: " + e);
        });
    }

    //this is called when the media source contains data
    onSourceOpen(e) {
        this.buffer = this.mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"')
        //this.buffer = this.mediaSource.addSourceBuffer('audio/webm; codecs="opus"');
        //this.buffer.mode = 'sequence';
        this.registerHandlers();
    }

    //whenever data arrives in our websocket this is called.
    websocketDataArrived(data) {
        if (!this.mediaSource) {
            return;
        }
        if (!data || data.length == 0) {
            return;
        }
        this.lastPacket = Date.now();
        this.queue = this.queue == null ? data : this.concat(this.queue, data);
    }


    tryLastPacket() {
        if (this.lastPacket == null) return;
        if ((Date.now() - this.lastPacket) > 1000) {
            //this.socketDisconnected('timeout');
        }
    }

    //this updates the buffer with the data from our queue
    updateQueue() {
        if (!this.queue || !this.buffer || this.buffer.updating) {
            return;
        }

        if (!this.audio.error) {
            if (!this.queue.length) {
                console.log('null queue');
            }
            this.buffer.appendBuffer(this.queue);
            this.queue = null;
            
            this.audio.play().catch(function(e) {
                console.log("Playback failed: " + e);
            });

            
        } else {
            console.log('AudioElement Error: ' + this.audio.error);
            this.start();
        }
    }

    //reduces the stream buffer to the minimal size that we need for streaming
    reduceBuffer() {
        if (!(this.buffer && !this.buffer.updating && !!this.audio && !!this.audio.currentTime && this.audio.currentTime > 1)) {
            return;
        }

        this.buffer.remove(0, this.audio.currentTime - 1);
    }

    //synchronizes the current time of the stream with the server
    syncInterval() {
        if (!(this.audio && this.audio.currentTime && this.audio.currentTime > 1 && this.buffer && this.buffer.buffered && this.buffer.buffered.length > 1)) {
        //if (!(this.audio && this.audio.currentTime && this.buffer && this.buffer.buffered && this.buffer.buffered.length > 1)) {
            return;
        }

        var currentTime = this.audio.currentTime;
        var targetTime = this.buffer.buffered.end(this.buffer.buffered.length - 1);

        if (targetTime > (currentTime + this.maximumAudioLag)) {
            this.audio.fastSeek(targetTime);
        }
    }

    //joins two data arrays - helper function
    concat(buffer1, buffer2) {
        var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
        tmp.set(new Uint8Array(buffer1), 0);
        tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
        return tmp.buffer;
    };
}
