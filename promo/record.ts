// Renders scene.html frame by frame: the scene is a pure function of time, so every frame is exact and motion is smooth.
// Usage: bun record.ts                 full film → out/gondola-cli.mp4 (+ 1280x800 copy and poster)
//        bun record.ts --at 12.5,20    stills → out/still-<t>.jpg
//        bun record.ts --from 28 --to 32   a segment → out/part.mp4
import { openChrome } from './cdp';
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const W = 1920, H = 1200, FPS = 60, DIR = import.meta.dir;
const c = await openChrome(W, H, 9462);
await c.goto(`file://${DIR}/scene.html`);
await c.js('window.READY');
const duration: number = await c.js('window.DURATION');
const grab = async (t: number, file: string, quality = 95) => {
  await c.js(`window.render(${t})`);
  const s = await c.send('Page.captureScreenshot', { format: 'jpeg', quality, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  await Bun.write(file, Buffer.from(s.result.data, 'base64'));
};
await Bun.$`mkdir -p ${DIR}/out`.quiet();
if (arg('--at')) {
  for (const t of arg('--at')!.split(',').map(Number)) await grab(t, `${DIR}/out/still-${t}.jpg`, 88);
} else {
  const from = Number(arg('--from') ?? 0), to = Number(arg('--to') ?? duration), part = arg('--from') !== undefined || arg('--to') !== undefined;
  await Bun.$`rm -rf ${DIR}/frames && mkdir -p ${DIR}/frames`.quiet();
  const n = Math.round((to - from) * FPS), t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await grab(from + i / FPS, `${DIR}/frames/${String(i).padStart(5, '0')}.jpg`);
    if (i % 300 === 0) console.log(`frame ${i}/${n}  ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  const name = part ? 'part' : 'gondola-cli';
  await Bun.$`ffmpeg -v error -y -framerate ${FPS} -i ${DIR}/frames/%05d.jpg -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart ${DIR}/out/${name}.mp4`;
  if (!part) {
    await Bun.$`ffmpeg -v error -y -i ${DIR}/out/${name}.mp4 -vf scale=1280:800:flags=lanczos -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart ${DIR}/out/${name}-1280.mp4`;
  }
  console.log(`done: ${n} frames in ${Math.round((Date.now() - t0) / 1000)}s`);
}
await c.close();
