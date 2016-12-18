import ffmpeg from 'fluent-ffmpeg';
import Canvas from 'canvas';
import path from 'path';
import debug from 'debug';
import http from 'http';
import { Readable } from 'stream';
import fs from 'fs';
import request from 'request';

const debugFFMPEG = debug('CanvasLive:FFMPEG');
const debugCanvas = debug('CanvasLive:Canvas');
const debugApp = debug('CanvasLive');
const Image = Canvas.Image;

const bombFile = fs.readFileSync('./image.png');

const bomb = new Image();
bomb.src = bombFile;

let index = 0;

class CanvasStream extends Readable {
  constructor(options) {
    super({
      ...options,
    });

    this.canvas = new Canvas(960, 540);
    this.ctx = this.canvas.getContext('2d');
  }

  draw() {
    this.ctx.clearRect(0, 0, 960, 540);

    if (Date.now() - this.start > 15000) {
      this.ctx.fillStyle = '#cc3700';
    } else {
      this.ctx.fillStyle = '#08c';
    }
    this.ctx.fillRect(20, 20, 920, 500);

    const time = Date.now() - this.start;
    const timeSecond = Math.round(time / 1000);

    this.ctx.font = '60px sans-serif';
    this.ctx.fillStyle = '#4a4a4a';
    this.ctx.fillText(`Started ${time} ms`, 80, 120);

    this.ctx.drawImage(bomb, timeSecond * 10, timeSecond * 10, 128, 100);
  }

  _read() {
    if (!this.start) this.start = Date.now();

    this.draw();
    this.imgBuf = this.canvas.toBuffer();

    index += 1;

    const fps = Math.round(1000 / (Date.now() - (this.lastDraw || 0)));
    this.lastDraw = Date.now();
    debugCanvas(`Frame: ${index}\tBuffer Len: ${this._readableState.length}\tImage Len: ${this.imgBuf.length}\tFPS: ${fps}`);

    this.push(this.imgBuf);
  }
}

function onLive(rtmpUrl) {
  const canvasStream = new CanvasStream();

  ffmpeg(canvasStream)
    .inputOptions('-r 30')
    .inputOptions('-c:v png')
    .inputOptions('-f image2pipe')
    .inputOptions('-f lavfi')
    .inputOptions('-i anullsrc')
    .on('start', (command) => {
      debugFFMPEG(`Spawn ffmpeg: ${command}`);
    })
    .on('codecData', (data) => {
      debugFFMPEG('Input is ' + data.audio + ' audio ' + 'with ' + data.video + ' video');
    })
    .on('progress', (progress) => {
      if (progress.percent) {
        debugFFMPEG('Processing: ' + progress.percent + '% done', progress);
      } else {
        debugFFMPEG(`Processing: ${progress.frames} frames done.\t${progress.timemark} (FPS: ${progress.currentFps})`);
      }
    })
    .on('error', (err, stdout, stderr) => {
      debugFFMPEG(`error: ${err.message}`);
      debugFFMPEG(`stdout: ${stdout}`);
      debugFFMPEG(`stderr: ${stderr}`);
    })
    .on('end', () => {
      debugFFMPEG('FFMPEG end.');
    })
    .addOptions([
      '-threads 0',
      '-c:v libx264',
      '-s 1280x720',
      '-pix_fmt yuv420p',
      '-crf 28',
      '-preset ultrafast',
      '-r 30',
    ])
    .format('flv')
    .save(rtmpUrl);
}

const FB_TOKEN = process.env.FB_TOKEN;
if (!FB_TOKEN) {
  console.error('Please pass FB_TOKEN to ENV');
  process.exit(1);
}

request.post(`https://graph.facebook.com/me/live_videos?access_token=${FB_TOKEN}`, (err, res, body) => {
  if (err) {
    console.error(`FB API Error`, err.toString());
  } else {
    try {
      const data = JSON.parse(body);

      if (data.stream_url) {
        debugApp(`Start to Live: ${data.stream_url}`);
        onLive(data.stream_url);
      } else {
        console.error('Cannot found stream url');
      }
    } catch (ex) {
      console.error('Parse body failed.');
    }
  }
});
