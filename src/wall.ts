// The wall: one static HTML file per run that shows every variant side by side, in the look of Gondola's own wall
// (white ground, one grey family, the only colour comes from the pages). It reads only files next to it.
import { join } from 'node:path';

const KIT = new URL('../kit/', import.meta.url).pathname;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const dataUri = async (f: string) => `data:image/png;base64,${Buffer.from(await Bun.file(KIT + f).arrayBuffer()).toString('base64')}`;

export async function writeWall(out: string, run: any) {
  const has = (f: string) => Bun.file(join(out, f)).exists();
  const done = run.variants.filter((v: any) => v.status === 'done');

  // Everything the page needs about each tile, for the detail view.
  const items: any[] = [];
  const origFull = await has('original-full.jpg');
  if (origFull || (await has('original.png'))) items.push({
    kind: 'now', title: 'Current page', eyebrow: 'Now', summary: 'What every variant started from.',
    full: origFull ? 'original-full.jpg' : 'original.png',
  });
  for (const v of run.variants) {
    const d = String(v.n);
    if (v.status !== 'done') { items.push({ kind: 'failed', n: v.n, title: 'Did not finish', eyebrow: v.label, summary: v.error ?? v.status }); continue; }
    const full = (await has(`${d}/full.jpg`)) ? `${d}/full.jpg` : (await has(`${d}/desktop.png`)) ? `${d}/desktop.png` : null;
    const broken = v.page_status && !/^[23]/.test(v.page_status);
    items.push({
      kind: 'variant', n: v.n, title: v.name, eyebrow: v.label, headline: run.copy ? v.headline : null, summary: v.summary, notes: v.notes,
      warnings: [...(broken ? [`The page answered HTTP ${v.page_status} after this change.`] : []), ...(v.issues ?? [])],
      stat: v.stat || `${v.files?.length ?? 0} files changed`, files: v.files ?? [], full,
      phone: (await has(`${d}/mobile.png`)) ? `${d}/mobile.png` : null, patch: `${d}/patch.diff`, preview: v.preview ?? null,
      cmd: `gondola apply ${v.n} --run ${run.id}`,
    });
  }

  const applyIcon = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const shortStat = (s: string) => s.replace(/ files? changed,?/, s.startsWith('1 ') ? ' file' : ' files').replace(/ insertions?\(\+\),?/, '+').replace(/ deletions?\(-\)/, '−');
  const tiles = items.map((it, i) => {
    if (it.kind === 'failed') return `
    <div class="cell failed">
      <div class="frame"><div class="fail">No result</div></div>
      <div class="meta"><b>Did not finish</b><span>${it.n}</span></div>
      <p class="sub">${esc(it.eyebrow)}</p>
      <p class="sum">${esc(it.summary)}</p>
    </div>`;
    return `
    <div class="cell ${it.kind}" style="--delay:${-(i * 3.7).toFixed(1)}s">
      <button class="frame" type="button" data-open="${i}" aria-label="Open ${esc(it.title)}">
        ${it.full ? `<img class="full" src="${esc(it.full)}" alt="" loading="lazy">` : '<div class="fail">No screenshot</div>'}
        ${it.warnings?.length ? `<i class="flag" title="${it.warnings.length} thing${it.warnings.length > 1 ? 's' : ''} to check"></i>` : ''}
      </button>
      <div class="meta"><b>${esc(it.title)}</b><span>${it.kind === 'now' ? 'now' : it.n}</span></div>
      <p class="sub">${esc(it.eyebrow)}</p>
      ${it.headline ? `<p class="quote">${esc(it.headline)}</p>` : ''}
      ${it.kind === 'variant' ? `<div class="acts">
        <button class="btn dark apply" type="button" data-copy="${esc(it.cmd)}">${applyIcon}<span>Apply</span></button>
        <button class="btn" type="button" data-open="${i}">Details</button>
        <span class="stat">${esc(shortStat(it.stat))}</span>
      </div>` : `<p class="sum">${esc(it.summary)}</p>`}
    </div>`;
  }).join('');

  const logo = await dataUri('logo.png'), favicon = await dataUri('favicon.png');
  const took = `${Math.floor((run.seconds ?? 0) / 60)} min ${(run.seconds ?? 0) % 60} s`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gondola · ${esc(String(run.task).slice(0, 60))}</title>
<link rel="icon" type="image/png" href="${favicon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --ink:#111; --grey:#8c8c8c; --grey-2:#b3b3b3; --hair:#e5e5e5; --hair-2:#ececec; --bg:#fff; --ease:cubic-bezier(.2,.8,.2,1); color-scheme:light; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:400 15px/1.45 'Inter Tight', system-ui, -apple-system, sans-serif; -webkit-font-smoothing:antialiased; }
  button { font:inherit; color:inherit; }
  a { color:var(--ink); }
  :focus-visible { outline:1.5px solid var(--ink); outline-offset:3px; border-radius:4px; }
  [hidden] { display:none !important; }

  .topbar { height:64px; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:0 max(28px, calc((100vw - 1640px) / 2)); }
  .brand img { display:block; height:22px; width:auto; }
  .runlabel { font-size:13px; color:var(--grey); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .runlabel b { font-weight:400; color:var(--ink); }

  .head { padding:34px max(28px, calc((100vw - 1640px) / 2)) 0; }
  .head h1 { margin:0; font-weight:500; font-size:clamp(22px, 2.3vw, 34px); line-height:1.16; letter-spacing:-.025em; max-width:34ch; text-wrap:balance; }
  .facts { display:flex; flex-wrap:wrap; gap:4px 22px; margin:16px 0 0; padding:0; list-style:none; font-size:13px; color:var(--grey); font-variant-numeric:tabular-nums; }
  .facts b { font-weight:400; color:var(--ink); }

  .grid { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:38px 24px; padding:36px max(28px, calc((100vw - 1640px) / 2)) 96px; }
  @media (max-width:1380px) { .grid { grid-template-columns:repeat(3, minmax(0, 1fr)); } }
  @media (max-width:980px) { .grid { grid-template-columns:repeat(2, minmax(0, 1fr)); gap:30px 16px; } }
  @media (max-width:600px) { .grid { grid-template-columns:1fr; } .topbar, .head, .grid { padding-left:16px; padding-right:16px; } }

  .cell { display:flex; flex-direction:column; min-width:0; }
  .frame { position:relative; display:block; width:100%; aspect-ratio:16 / 10; border:0; padding:0; border-radius:10px; overflow:hidden; background:#f5f5f5; cursor:pointer;
    box-shadow:0 0 0 1px var(--hair), 0 16px 32px -20px rgba(0,0,0,.35); transition:transform 350ms var(--ease), box-shadow 350ms var(--ease); }
  button.frame:hover, button.frame:focus-visible { transform:translateY(-3px); box-shadow:0 0 0 1px var(--ink), 0 22px 44px -22px rgba(0,0,0,.45); outline:none; }
  .failed .frame { cursor:default; box-shadow:0 0 0 1px var(--hair); }
  /* the whole page, scrolling slowly down and back up; it stops while you point at it */
  .full { position:absolute; left:0; top:0; width:100%; height:auto; display:block; will-change:transform; }
  .scrolls .full { animation:wallscroll var(--dur, 30s) cubic-bezier(.45,0,.55,1) var(--delay, 0s) infinite; }
  .scrolls .frame:hover .full { animation-play-state:paused; }
  @keyframes wallscroll { 0%, 7% { transform:translateY(0); } 46%, 54% { transform:translateY(calc(-1 * var(--dist, 0px))); } 93%, 100% { transform:translateY(0); } }
  @media (prefers-reduced-motion: reduce) { .scrolls .full { animation:none; } button.frame:hover { transform:none; } }
  .fail { position:absolute; inset:0; display:grid; place-items:center; color:var(--grey); font-size:13px; background:#fafafa; }
  .flag { position:absolute; top:10px; right:10px; width:9px; height:9px; border-radius:50%; background:var(--ink); box-shadow:0 0 0 3px rgba(255,255,255,.9); }

  .meta { display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-top:13px; }
  .meta b { font-weight:500; font-size:16px; letter-spacing:-.015em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .meta span { flex:none; font-size:12px; color:var(--grey-2); font-variant-numeric:tabular-nums; }
  .now .meta b, .failed .meta b { color:var(--grey); }
  .sub { margin:1px 0 0; font-size:12px; color:var(--grey); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .quote { margin:10px 0 0; font-size:15px; line-height:1.3; letter-spacing:-.01em; text-wrap:pretty; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .quote::before { content:'\\201C'; } .quote::after { content:'\\201D'; }
  .sum { margin:8px 0 0; font-size:13px; color:var(--grey); }
  .acts { display:flex; align-items:center; gap:8px; margin-top:auto; padding-top:14px; }
  .stat { margin-left:auto; font-size:12px; color:var(--grey-2); font-variant-numeric:tabular-nums; white-space:nowrap; }

  .btn { display:inline-flex; align-items:center; gap:7px; border:1px solid rgba(0,0,0,.1); background:#fff; padding:7px 13px; border-radius:99px; font-size:13px; line-height:1.3; cursor:pointer;
    text-decoration:none; white-space:nowrap; transition:box-shadow 200ms, transform 200ms var(--ease), background 200ms; }
  .btn:hover { box-shadow:0 4px 14px -6px rgba(0,0,0,.35); }
  .btn:active { transform:scale(.97); }
  .btn.dark { background:var(--ink); color:#fff; border-color:var(--ink); padding-left:11px; }
  .btn.dark svg { opacity:.55; transition:opacity 200ms; }
  .btn.dark.copied svg { opacity:1; }
  .btn.big { padding:11px 20px 11px 16px; font-size:14px; }

  /* detail view */
  dialog { border:0; padding:0; width:min(1280px, calc(100vw - 48px)); height:min(860px, calc(100vh - 48px)); max-width:none; max-height:none; border-radius:14px; overflow:hidden; background:#fff;
    box-shadow:0 0 0 1px rgba(0,0,0,.08), 0 40px 90px -30px rgba(0,0,0,.5); color:var(--ink); }
  dialog::backdrop { background:rgba(255,255,255,.82); backdrop-filter:blur(6px); }
  dialog[open] { display:grid; grid-template-columns:minmax(0, 1fr) 380px; animation:rise 320ms var(--ease); }
  @keyframes rise { from { transform:translateY(18px); opacity:0; } }
  .view { background:#f5f5f5; overflow:auto; padding:28px; display:flex; flex-direction:column; align-items:center; gap:18px; }
  .view img { display:block; width:100%; max-width:720px; height:auto; border-radius:8px; box-shadow:0 0 0 1px var(--hair), 0 20px 40px -24px rgba(0,0,0,.35); background:#fff; }
  .view img.phone { max-width:320px; }
  .seg { position:sticky; top:0; z-index:1; display:flex; padding:3px; border-radius:99px; background:rgba(255,255,255,.9); box-shadow:0 0 0 1px var(--hair), 0 6px 18px -10px rgba(0,0,0,.3); backdrop-filter:blur(6px); }
  .seg button { border:0; background:none; padding:5px 14px; border-radius:99px; font-size:12px; cursor:pointer; color:var(--grey); }
  .seg button[aria-pressed=true] { background:var(--ink); color:#fff; }
  .side { display:flex; flex-direction:column; min-height:0; border-left:1px solid var(--hair); }
  .side-top { display:flex; justify-content:space-between; align-items:center; padding:14px 14px 0 26px; font-size:12px; color:var(--grey); font-variant-numeric:tabular-nums; }
  .nav { display:flex; gap:2px; }
  .icon { width:32px; height:32px; border:0; background:none; border-radius:50%; cursor:pointer; display:grid; place-items:center; color:var(--grey); font-size:16px; }
  .icon:hover { background:#f3f3f3; color:var(--ink); }
  .side-body { flex:1; overflow:auto; padding:10px 26px 22px; }
  .side h2 { margin:0; font-weight:500; font-size:26px; line-height:1.12; letter-spacing:-.025em; }
  .side .sub { white-space:normal; margin-top:6px; font-size:13px; }
  .side .quote { font-size:19px; line-height:1.25; -webkit-line-clamp:unset; margin-top:20px; }
  .side p.txt { margin:14px 0 0; font-size:14px; color:#444; }
  .side h3 { margin:24px 0 6px; font-size:11px; font-weight:500; letter-spacing:.07em; text-transform:uppercase; color:var(--grey); }
  .side ul { margin:0; padding:0; list-style:none; font-size:13px; color:#444; }
  .side ul li { padding:6px 0; border-top:1px solid var(--hair-2); }
  .side ul.files li { font:12px/1.4 ui-monospace, 'SF Mono', Menlo, monospace; color:#555; word-break:break-all; }
  .side-foot { border-top:1px solid var(--hair); padding:16px 26px 20px; display:flex; flex-direction:column; gap:12px; }
  .cmd { font:12px/1.4 ui-monospace, 'SF Mono', Menlo, monospace; color:#555; background:#f6f6f6; border-radius:8px; padding:9px 11px; overflow:auto; white-space:nowrap; user-select:all; }
  .foot-row { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  .foot-row a { font-size:13px; color:var(--grey); text-decoration:none; }
  .foot-row a:hover { color:var(--ink); }
  @media (max-width:860px) { dialog[open] { grid-template-columns:1fr; grid-template-rows:minmax(0, 1fr) auto; } .side { border-left:0; border-top:1px solid var(--hair); max-height:52vh; } .view { padding:16px; } }

  .toast { position:fixed; left:50%; bottom:26px; transform:translate(-50%, 20px); opacity:0; pointer-events:none; z-index:50; display:flex; align-items:center; gap:12px; max-width:calc(100vw - 32px);
    background:var(--ink); color:#fff; border-radius:12px; padding:11px 16px; font-size:13px; box-shadow:0 18px 40px -16px rgba(0,0,0,.5); transition:transform 350ms var(--ease), opacity 250ms; }
  .toast.on { transform:translate(-50%, 0); opacity:1; }
  .toast code { font:12px ui-monospace, 'SF Mono', Menlo, monospace; color:rgba(255,255,255,.6); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
</style>
</head>
<body>
<header class="topbar">
  <a class="brand" href="https://github.com/forever8896/gondola-cli" aria-label="Gondola"><img src="${logo}" alt="Gondola" width="139" height="22"></a>
  <div class="runlabel"><b>${esc(String(run.repo ?? '').split('/').pop())}${run.dir ? '/' + esc(run.dir) : ''}</b> · run ${esc(run.id)}</div>
</header>
<section class="head">
  <h1>${esc(run.task)}</h1>
  <ul class="facts">
    <li><b>${done.length} of ${run.variants.length}</b> variants</li>
    <li>${run.style === 'wild' ? 'restyled' : 'in your design system'}</li>
    <li>copy ${run.copy ? 'rewritten per variant' : 'unchanged'}</li>
    <li>page <b>${esc(run.path)}</b></li>
    <li>${esc(run.model)}</li>
    <li>${took}</li>
  </ul>
</section>
<main class="grid">${tiles}
</main>

<dialog id="dlg" aria-labelledby="d-title">
  <div class="view" id="d-view">
    <div class="seg" id="d-seg" hidden><button type="button" data-shot="full" aria-pressed="true">Desktop</button><button type="button" data-shot="phone" aria-pressed="false">Phone</button></div>
    <img id="d-img" alt="">
  </div>
  <aside class="side">
    <div class="side-top"><span id="d-count"></span>
      <div class="nav"><button class="icon" type="button" id="d-prev" aria-label="Previous">←</button><button class="icon" type="button" id="d-next" aria-label="Next">→</button><button class="icon" type="button" id="d-close" aria-label="Close">✕</button></div>
    </div>
    <div class="side-body">
      <h2 id="d-title"></h2>
      <p class="sub" id="d-eyebrow"></p>
      <p class="quote" id="d-quote" hidden></p>
      <p class="txt" id="d-sum"></p>
      <div id="d-notes" hidden><h3>From the agent</h3><p class="txt" style="margin-top:0" id="d-notes-t"></p></div>
      <div id="d-warn" hidden><h3>To check</h3><ul id="d-warn-l"></ul></div>
      <div id="d-files" hidden><h3 id="d-stat"></h3><ul class="files" id="d-files-l"></ul></div>
    </div>
    <div class="side-foot" id="d-foot">
      <div class="cmd" id="d-cmd"></div>
      <div class="foot-row">
        <button class="btn dark big apply" type="button" id="d-apply">${applyIcon}<span>Apply this variant</span></button>
        <a id="d-patch" href="#">View patch</a><a id="d-preview" href="#" hidden>Live preview</a>
      </div>
    </div>
  </aside>
</dialog>
<div class="toast" id="toast" role="status"><span id="toast-t"></span><code id="toast-c"></code></div>

<script>
  const ITEMS = ${JSON.stringify(items).replace(/</g, '\\u003c')};
  const $ = id => document.getElementById(id);

  // Slow scroll through each whole page: distance and duration depend on how tall the page is.
  for (const img of document.querySelectorAll('.full')) {
    const arm = () => {
      const frame = img.parentElement, dist = img.offsetHeight - frame.offsetHeight;
      if (dist < 24) return;
      const cell = frame.closest('.cell');
      cell.style.setProperty('--dist', dist + 'px');
      cell.style.setProperty('--dur', Math.max(18, Math.round(dist / 26)) + 's');
      cell.classList.add('scrolls');
    };
    if (img.complete && img.naturalHeight) arm(); else img.addEventListener('load', arm);
  }
  addEventListener('resize', () => { for (const c of document.querySelectorAll('.scrolls')) { const i = c.querySelector('.full'); c.style.setProperty('--dist', Math.max(0, i.offsetHeight - i.parentElement.offsetHeight) + 'px'); } });

  // Apply: a static page cannot run commands, so the button copies the one that does.
  let toastTimer;
  async function copy(btn, cmd) {
    let ok = true;
    try { await navigator.clipboard.writeText(cmd); } catch { ok = false; }
    $('toast-t').textContent = ok ? 'Copied. Paste it in a terminal inside the repo.' : 'Copy this and run it in the repo:';
    $('toast-c').textContent = cmd;
    $('toast').classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('on'), 4200);
    const label = btn.querySelector('span'), was = btn.dataset.label || (btn.dataset.label = label.textContent);
    btn.classList.add('copied'); label.textContent = ok ? 'Copied' : 'See below';
    setTimeout(() => { btn.classList.remove('copied'); label.textContent = was; }, 1800);
  }
  for (const b of document.querySelectorAll('[data-copy]')) b.addEventListener('click', () => copy(b, b.dataset.copy));

  // Detail view.
  const dlg = $('dlg'), order = ITEMS.map((it, i) => i).filter(i => ITEMS[i].kind !== 'failed');
  let cur = 0;
  const list = (ul, rows) => { ul.replaceChildren(...rows.map(t => Object.assign(document.createElement('li'), { textContent: t }))); };
  function shot(which) {
    const it = ITEMS[cur], src = which === 'phone' ? it.phone : it.full;
    $('d-img').src = src || ''; $('d-img').classList.toggle('phone', which === 'phone');
    for (const b of $('d-seg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.shot === which));
    $('d-view').scrollTop = 0;
  }
  function show(i) {
    cur = i; const it = ITEMS[i];
    $('d-count').textContent = it.kind === 'now' ? 'Now' : 'Variant ' + it.n + ' of ' + ITEMS.filter(x => x.kind !== 'now').length;
    $('d-title').textContent = it.title; $('d-eyebrow').textContent = it.kind === 'now' ? '' : it.eyebrow;
    $('d-quote').hidden = !it.headline; $('d-quote').textContent = it.headline || '';
    $('d-sum').textContent = it.summary || '';
    $('d-notes').hidden = !it.notes; $('d-notes-t').textContent = it.notes || '';
    $('d-warn').hidden = !(it.warnings && it.warnings.length); list($('d-warn-l'), it.warnings || []);
    $('d-files').hidden = !(it.files && it.files.length); $('d-stat').textContent = it.stat || ''; list($('d-files-l'), it.files || []);
    $('d-foot').hidden = it.kind !== 'variant';
    if (it.kind === 'variant') {
      $('d-cmd').textContent = it.cmd; $('d-patch').href = it.patch;
      $('d-preview').hidden = !it.preview; if (it.preview) $('d-preview').href = it.preview;
    }
    $('d-seg').hidden = !it.phone; shot('full');
    if (!dlg.open) dlg.showModal();
  }
  const step = d => show(order[(order.indexOf(cur) + d + order.length) % order.length]);
  for (const b of document.querySelectorAll('[data-open]')) b.addEventListener('click', () => show(Number(b.dataset.open)));
  for (const b of $('d-seg').querySelectorAll('button')) b.addEventListener('click', () => shot(b.dataset.shot));
  $('d-prev').addEventListener('click', () => step(-1)); $('d-next').addEventListener('click', () => step(1));
  $('d-close').addEventListener('click', () => dlg.close());
  $('d-apply').addEventListener('click', () => copy($('d-apply'), ITEMS[cur].cmd));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  // wall.html#3 opens variant 3.
  const linked = ITEMS.findIndex(it => it.kind === 'variant' && '#' + it.n === location.hash);
  if (linked >= 0) show(linked);
  dlg.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); });
</script>
</body>
</html>
`;
  const file = join(out, 'wall.html');
  await Bun.write(file, html);
  return file;
}
