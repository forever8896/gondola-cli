// Minimal Chrome DevTools client for the promo scripts: one headless Chromium, one page.
export async function openChrome(w: number, h: number, port: number, flags: string[] = []) {
  const prof = `${import.meta.dir}/out/prof-${port}`;
  await Bun.$`rm -rf ${prof} && mkdir -p ${prof}`.quiet();
  const chrome = Bun.spawn(['chromium', '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--hide-scrollbars',
    '--force-device-scale-factor=1', '--allow-file-access-from-files', `--window-size=${w},${h}`, `--user-data-dir=${prof}`, ...flags, 'about:blank'],
    { stdout: 'ignore', stderr: 'ignore' });
  let t: any = null;
  for (let i = 0; i < 40 && !t; i++) { await Bun.sleep(250); try { t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
  if (!t) throw new Error('Chromium did not start');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (m: any) => void>(), waiters: ((m: any) => void)[] = [];
  ws.onmessage = ev => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
    if (m.method) for (const w of [...waiters]) w(m);
  };
  const send = (method: string, params: any = {}) => new Promise<any>(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const once = (method: string) => new Promise<any>(r => { const w = (m: any) => { if (m.method === method) { waiters.splice(waiters.indexOf(w), 1); r(m); } }; waiters.push(w); });
  const js = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const goto = async (url: string) => { const l = once('Page.loadEventFired'); await send('Page.navigate', { url }); await l; };
  const close = async () => { ws.close(); chrome.kill(); await chrome.exited; await Bun.$`rm -rf ${prof}`.quiet(); };
  return { send, js, goto, close };
}
