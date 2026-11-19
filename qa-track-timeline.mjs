import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const dir = path.resolve('qa-track-timeline');
fs.mkdirSync(dir, { recursive: true });
const entry = path.join(dir, 'entry.tsx');
fs.writeFileSync(entry, `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackTimeline } from '../src/components/music/TrackTimeline';
import { DEFAULT_CLIP, type Clip } from '../src/core/clip';
const initial: Clip = { ...DEFAULT_CLIP, trackId: 'track', start: 12, length: 20, chorusStart: 60, chorusLength: 15, fadeIn: 0, fadeOut: 0, confetti: false };
function App() {
  const [clip, setClip] = useState(initial);
  return <><TrackTimeline clip={clip} onChange={setClip} /><output id="clip">{JSON.stringify(clip)}</output></>;
}
createRoot(document.getElementById('root')!).render(<App />);
`);

const stubs = {
  name: 'timeline-stubs',
  setup(builder) {
    builder.onResolve({ filter: /^\.\.\/\.\.\/data$/ }, () => ({ path: 'data', namespace: 'timeline-stub' }));
    builder.onResolve({ filter: /^\.\/TrackPicker$/ }, () => ({ path: 'picker', namespace: 'timeline-stub' }));
    builder.onResolve({ filter: /^\.\/uploadTrack$/ }, () => ({ path: 'upload', namespace: 'timeline-stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'timeline-stub' }, (args) => {
      if (args.path === 'data') return { contents: `export const tracksRepo = { file: async () => null, fileUrl: () => '/track.wav' };`, loader: 'js' };
      if (args.path === 'picker') return { contents: `export const addTrack = () => {}; export const useTrackList = () => ({ tracks: [{ id: 'track', title: 'Тестовый трек', durationMs: 120000, scope: 'agency' }], failed: false });`, loader: 'js' };
      return { contents: `export const UploadTrackButton = () => null;`, loader: 'jsx' };
    });
  },
};
await build({ entryPoints: [entry], bundle: true, outfile: path.join(dir, 'app.js'), format: 'esm', platform: 'browser', jsx: 'automatic', plugins: [stubs] });

const seconds = 120;
const sampleRate = 8000;
const dataSize = seconds * sampleRate * 2;
const wav = Buffer.alloc(44 + dataSize);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(dataSize, 40);
for (let i = 0; i < seconds * sampleRate; i++) {
  const frequency = 220 + Math.floor(i / sampleRate / 10) * 20;
  wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * i / sampleRate) * 5000), 44 + i * 2);
}

const html = `<!doctype html><html><head><style>
.timeline__wave{position:relative;width:900px;height:120px;background:#ddd;margin:20px 0}
.timeline__bars{position:absolute;inset:0;display:flex;align-items:center}.timeline__bars i{width:100%}
.timeline__handle{position:absolute;top:0;width:14px;height:120px;transform:translateX(-50%);z-index:2}
.timeline__handle--guess{background:#248}.timeline__handle--chorus{background:#da0}
</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/app.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    fs.createReadStream(path.join(dir, 'app.js')).pipe(res);
    return;
  }
  if (pathname === '/track.wav') {
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
      if (start >= wav.length || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${wav.length}` }); res.end(); return;
      }
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${wav.length}`, 'Content-Length': end - start + 1 });
      res.end(wav.subarray(start, end + 1));
    } else {
      res.writeHead(200, { 'Content-Length': wav.length }); res.end(wav);
    }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html);
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const near = (value, target, tolerance = 1.2) => Math.abs(value - target) <= tolerance;
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => { throw error; });
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio {
      constructor(...args) { super(...args); window.__timelineAudio = this; }
    };
  });
  await page.goto(`http://localhost:${port}`);
  const wave = page.locator('.timeline__wave');
  const audioState = () => page.evaluate(() => ({
    time: window.__timelineAudio?.currentTime,
    paused: window.__timelineAudio?.paused,
    readyState: window.__timelineAudio?.readyState,
  }));
  const waitPlayingAt = async (target) => {
    await page.waitForFunction((target) => {
      const audio = window.__timelineAudio;
      return audio && !audio.paused && audio.readyState >= 1 && Math.abs(audio.currentTime - target) < 1.2;
    }, target, { timeout: 5000 });
  };
  const drag = async (label, targetSecond) => {
    const handle = page.getByRole('button', { name: new RegExp(label) });
    const hb = await handle.boundingBox();
    const wb = await wave.boundingBox();
    if (!hb || !wb) throw new Error(`Нет геометрии для ${label}`);
    const y = hb.y + hb.height / 2;
    await page.mouse.move(hb.x + hb.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(wb.x + targetSecond / 120 * wb.width, y, { steps: 6 });
    await page.mouse.up();
  };

  await page.getByRole('button', { name: '▶ Угадывание' }).click();
  await waitPlayingAt(12);

  await drag('Начало угадывания', 20);
  await waitPlayingAt(20);
  console.log('PASS: начало угадывания перематывает играющий трек');

  await drag('Конец угадывания', 40);
  await waitPlayingAt(38);
  await page.waitForTimeout(250);
  if ((await audioState()).paused) throw new Error('Конец угадывания мгновенно остановил звук');
  console.log('PASS: конец угадывания играет хвост без мгновенной остановки');

  await drag('Начало припева', 50);
  await waitPlayingAt(50);
  await page.getByRole('button', { name: '■ Стоп' }).waitFor();
  console.log('PASS: начало припева переключает прослушивание на припев');

  await drag('Конец припева', 70);
  await waitPlayingAt(68);
  await page.waitForTimeout(250);
  if ((await audioState()).paused) throw new Error('Конец припева мгновенно остановил звук');
  console.log('PASS: конец припева играет хвост без мгновенной остановки');

  await page.getByRole('button', { name: '■ Стоп' }).click();
  await drag('Начало угадывания', 15);
  await waitPlayingAt(15);
  console.log('PASS: перетаскивание после остановки запускает звук с нового места');
} finally {
  await browser.close();
  server.close();
}
