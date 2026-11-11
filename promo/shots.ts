// Sharp full-page captures (1440 px wide) of the page before the run and of the applied variant.
// Usage: bun shots.ts <name> <url>
import { openChrome } from './cdp';
const [name, url] = process.argv.slice(2);
const c = await openChrome(1440, 900, 9461, ['--force-prefers-reduced-motion']);
await c.goto(url);
await Bun.sleep(2500);
const h = await c.js(`Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)`);
const shot = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: Math.min(h, 9000), scale: 1 } });
await Bun.write(`${import.meta.dir}/assets/run/${name}.jpg`, Buffer.from(shot.result.data, 'base64'));
console.log(name, 1440, Math.min(h, 9000));
await c.close();
