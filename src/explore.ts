// One run: copy the repo into a Boat sandbox, install it once, fork it once per variant, let an agent build each
// variant against the running dev server, and bring back a patch and screenshots for every one.
import { mkdir, rm, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boat, lastJson, putFile, exec, q, StartLimiter } from './boat';
import { pickDirections, STYLE_RULES, COPY_RULES, type Direction, type StyleMode } from './directions';
import { writeWall } from './wall';

const KIT = new URL('../kit/', import.meta.url).pathname;

export type Options = {
  task: string;
  cwd: string;
  n: number;
  style: StyleMode;
  copy: boolean;
  dir: string;            // app folder inside the repo ('' = repo root)
  path: string;           // page to look at, e.g. /pricing
  install?: string;
  dev?: string;
  port?: number;
  with: string[];         // ignored files to send anyway (e.g. .env.local)
  model: string;
  machine: string;
  budgetMin: number;
  polish: boolean;
  keep: boolean;
  json: boolean;
};

export type Variant = {
  n: number;
  label: string;
  status: 'queued' | 'forking' | 'working' | 'capturing' | 'done' | 'failed';
  sandbox?: string;
  preview?: string;
  name?: string;
  summary?: string;
  headline?: string | null;
  notes?: string | null;
  files?: string[];
  stat?: string;
  page_status?: string;
  issues?: string[];
  error?: string;
  seconds?: number;
};

const limiter = new StartLimiter([
  { ms: 60_000, max: Number(process.env.STARTS_PER_MINUTE ?? 11) },
  { ms: 3_600_000, max: Number(process.env.STARTS_PER_HOUR ?? 58) },
  { ms: 86_400_000, max: Number(process.env.STARTS_PER_DAY ?? 195) },
]);

const sh = async (cmd: string[], cwd: string, stdin?: string) => {
  const p = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe', stdin: stdin === undefined ? 'ignore' : new Blob([stdin]) });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
};

// ---------- what to run ----------
/** Install and dev commands for the project, from its lockfile and package.json. */
export async function detect(appDir: string): Promise<{ install: string; dev: string | null }> {
  const has = (f: string) => Bun.file(join(appDir, f)).exists();
  const pkg = (await has('package.json')) ? await Bun.file(join(appDir, 'package.json')).json().catch(() => null) : null;
  if (!pkg) return { install: 'true', dev: (await has('index.html')) ? 'python3 -m http.server 4173' : null };
  const pm = (await has('bun.lock')) || (await has('bun.lockb')) ? 'bun' : (await has('pnpm-lock.yaml')) ? 'pnpm' : (await has('yarn.lock')) ? 'yarn' : 'npm';
  const install = { bun: 'bun install', pnpm: 'pnpm install', yarn: 'yarn install', npm: (await has('package-lock.json')) ? 'npm ci' : 'npm install' }[pm];
  const script = pkg.scripts?.dev ? 'dev' : pkg.scripts?.start ? 'start' : null;
  return { install, dev: script ? `${pm} run ${script}` : null };
}

// Tools a project may need that a fresh sandbox may not have.
const TOOLS =
  `export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"; ` +
  `need() { command -v "$1" >/dev/null 2>&1; }; `;
const ensureTool = (cmd: string) => {
  const pm = cmd.trim().split(/\s+/)[0];
  if (pm === 'bun') return `need bun || curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1; `;
  if (pm === 'pnpm' || pm === 'yarn') return `need ${pm} || npm install -g ${pm} >/dev/null 2>&1 || sudo npm install -g ${pm} >/dev/null 2>&1; `;
  return '';
};

// ---------- sandbox helpers ----------
/** Run a long command in the background on the sandbox and wait for its exit code. */
async function long(sb: string, name: string, cmd: string, timeoutS: number) {
  const script = `mkdir -p ~/kit; ( ${cmd} ) > ~/kit/${name}.log 2>&1; echo $? > ~/kit/${name}.code`;
  const started = await boat(['exec', sb, '--detach', `bash -c ${q(script)}`]);
  if (started.code !== 0) return { code: 1, tail: started.err.slice(-300) };
  const until = Date.now() + timeoutS * 1000;
  while (Date.now() < until) {
    await Bun.sleep(4000);
    const r = await exec(sb, `cat ~/kit/${name}.code 2>/dev/null`);
    if (r.stdout.trim()) return { code: Number(r.stdout.trim()), tail: (await exec(sb, `tail -n 25 ~/kit/${name}.log`)).stdout };
  }
  return { code: 124, tail: (await exec(sb, `tail -n 25 ~/kit/${name}.log`)).stdout };
}

const listening = `ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un | tr '\\n' ' '`;

/** Start the dev server and wait until a port answers HTTP. Returns the port, or null with the log tail. */
async function startDev(sb: string, appPath: string, dev: string, port: number | undefined, env: Record<string, string> = {}) {
  const before = port ? '' : (await exec(sb, listening)).stdout.trim();
  const exports = Object.entries({ ...env, ...(port ? { PORT: String(port) } : {}) }).map(([k, v]) => `export ${k}=${q(v)}; `).join('');
  await boat(['exec', sb, '--detach', `bash -c ${q(`${TOOLS}${exports}cd ${appPath} && exec ${dev} > ~/kit/dev.log 2>&1`)}`]);
  const ports = port ? `echo ${port}` : listening;
  const r = await exec(sb,
    `for i in $(seq 1 75); do for p in $(${ports}); do case " ${before} " in *" $p "*) continue;; esac; ` +
    `c=$(curl -s -o /dev/null -m 20 -w '%{http_code}' http://localhost:$p/); [ "$c" != 000 ] && { echo "PORT $p"; exit 0; }; done; sleep 2; done; ` +
    `echo NOPORT; tail -n 15 ~/kit/dev.log`, 240);
  const m = r.stdout.match(/PORT (\d+)/);
  if (!m) return { port: null, loopback: false, log: (r.stdout.replace('NOPORT', '').trim() || r.stderr.trim() || 'no answer from the sandbox').slice(-600) };
  // Does it listen on this machine only (Vite, Next) or on every interface (python -m http.server, --host)?
  const addrs = (await exec(sb, `ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ':${m[1]}$'`)).stdout.trim().split('\n').filter(Boolean);
  return { port: Number(m[1]), loopback: addrs.length > 0 && addrs.every(a => /^(127\.|\[::1\])/.test(a)), log: '' };
}

const chrome = (w: number, h: number, out: string, url: string) =>
  `timeout 60 google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=6000 --window-size=${w},${h} --screenshot=${out} ${q(url)} >/dev/null 2>&1`;

/** Concrete findings from a real browser at desktop and phone width (overflow, overlap, contrast, script errors). */
async function browserCheck(sb: string, url: string): Promise<string[]> {
  const r = await exec(sb, `node ~/.rd/qa.mjs check ${q(url)} 2>/dev/null`, 150);
  for (const line of r.stdout.trim().split('\n').reverse()) try {
    const j = JSON.parse(line);
    // "barely styled" is a rule for Gondola's from-scratch pages; it says nothing about a change to an existing app.
    if (Array.isArray(j)) return j.map(String).filter(i => !i.startsWith('QA checker error') && !/barely styled/.test(i));
  } catch {}
  return [];
}

/**
 * Findings that were not there before the change. A finding that lists offenders ("…: "Start free" 3.7:1; "Team" 3.7:1")
 * keeps only the offenders the original page did not have.
 */
export function newFindings(now: string[], before: string[]): string[] {
  const had = new Set(before);
  const quoted = (s: string) => [...s.matchAll(/"([^"]*)"/g)].map(m => m[1]);
  const hadQuoted = new Set(before.flatMap(quoted));
  const out: string[] = [];
  for (const f of now) {
    if (had.has(f)) continue;
    const cut = f.lastIndexOf('): ');
    const items = cut > 0 ? f.slice(cut + 3).split('; ') : [];
    if (items.length && items.every(i => quoted(i).length)) {
      const fresh = items.filter(i => !quoted(i).every(t => hadQuoted.has(t)));
      if (fresh.length) out.push(f.slice(0, cut + 3) + fresh.join('; '));
    } else out.push(f);
  }
  return out;
}

function describeTool(use: any): string | null {
  const name = String(use?.name ?? ''), inp = use?.input ?? {};
  const file = String(inp.file_path ?? inp.path ?? '').split('/').pop();
  if (/write/i.test(name)) return `writing ${file}`;
  if (/edit/i.test(name)) return `editing ${file}`;
  if (/read/i.test(name)) return `reading ${file}`;
  if (/bash|shell|exec/i.test(name)) return `$ ${String(inp.command ?? '').replace(/\s+/g, ' ').slice(0, 80)}`;
  return name ? name.toLowerCase() : null;
}

/** One agent turn in a sandbox. Models named claude-…/sonnet/opus/haiku run as Claude Code on your Boat Claude sign-in. */
async function prompt(model: string, sb: string, text: string, onAction: (a: string) => void, timeoutMs: number) {
  const provider = /^openrouter:anthropic\//.test(model) ? 'opencode' : /^(claude-|sonnet|opus|haiku)/.test(model) ? 'claude' : 'pi';
  const seen = new Set<string>();
  let error = '';
  const r = await boat(['prompt', sb, '--provider', provider, '--model', model, '--json', text], {
    timeoutMs,
    onLine: line => {
      const ev = JSON.parse(line);
      if (ev?.event === 'error') error = String(ev.error ?? 'error');
      const inner = ev?.data?.data;
      if (inner?.error) error = String(inner.error);
      if (ev?.data?.type === 'response' && typeof inner?.content === 'string' && /^\s*API Error\b/.test(inner.content)) error = inner.content.trim().slice(0, 200);
      for (const t of inner?.tools ?? []) {
        const id = t?.use?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const a = describeTool(t.use);
        if (a) onAction(a);
      }
    },
  });
  if (r.code !== 0 && !error) error = (r.err || r.out).trim().split('\n').slice(-2).join(' ');
  return { ok: r.code === 0 && !error, error: error.replace(/\s+/g, ' ').slice(0, 300) };
}

// ---------- the run ----------
export async function explore(o: Options) {
  const t0 = Date.now();
  const say = (who: string, text: string) => {
    console.error(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  ${who.padEnd(5)} ${text}`);
  };

  const root = (await sh(['git', 'rev-parse', '--show-toplevel'], o.cwd)).out.trim();
  if (!root) throw new Error('not inside a git repository (gondola sends the files git knows about)');
  const appDir = join(root, o.dir);
  const found = await detect(appDir);
  const install = o.install ?? found.install, dev = o.dev ?? found.dev;
  if (!dev) throw new Error(`could not tell how to start the dev server in ${appDir}: pass --dev "<command>"`);

  const id = Buffer.from(crypto.getRandomValues(new Uint8Array(4))).toString('hex');
  const out = join(root, '.gondola', id);
  await mkdir(out, { recursive: true });
  // Keep run folders out of git without touching the project's .gitignore.
  const exclude = join((await sh(['git', 'rev-parse', '--git-common-dir'], root)).out.trim().replace(/^(?!\/)/, root + '/'), 'info', 'exclude');
  if (!(await Bun.file(exclude).text().catch(() => '')).includes('.gondola/')) await appendFile(exclude, '\n.gondola/\n').catch(() => {});

  const directions = await pickDirections(o.n, o.style, o.copy);
  const variants: Variant[] = directions.map(d => ({ n: d.n, label: d.label, status: 'queued' }));
  const run: any = {
    id, task: o.task, repo: root, dir: o.dir, path: o.path, style: o.style, copy: o.copy, model: o.model, install, dev,
    started_at: new Date().toISOString(), sandboxes: [] as string[], variants,
  };
  const save = () => Bun.write(join(out, 'run.json'), JSON.stringify(run, null, 2));
  const sandboxes = new Set<string>();
  const track = async (sb: string) => { sandboxes.add(sb); run.sandboxes = [...sandboxes]; await save(); };
  const destroy = async (sb: string) => {
    for (let i = 1; i <= 3; i++) {
      const r = await boat(['delete', sb, '--yes', '--json'], { timeoutMs: 60_000 });
      if (r.code === 0 || /not.?found|no such|does not exist|already/i.test(r.err + r.out) || lastJson(r.out)?.operation?.status) { sandboxes.delete(sb); return; }
      await Bun.sleep(3000 * i);
    }
    console.error(`could not delete sandbox ${sb}: run \`gondola clean\``);
  };
  const cleanup = async () => { await Promise.all([...sandboxes].map(destroy)); run.sandboxes = [...sandboxes]; await save(); };
  const onSignal = async () => { console.error('\ninterrupted: deleting sandboxes…'); await cleanup(); process.exit(130); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);

  let base: string | null = null;
  try {
    // 1. Base sandbox with the repo in it.
    say('base', `starting a sandbox for ${root.split('/').pop()}${o.dir ? '/' + o.dir : ''}`);
    await limiter.take();
    const created = await boat(['new', '--name', `gcli-${id}-base`, '--type', o.machine, '--ttl', '7200', '--json'], { timeoutMs: 300_000 });
    base = lastJson(created.out)?.id ?? null;
    if (!base) throw new Error('could not create the base sandbox: ' + (created.err || created.out).trim().slice(-300));
    await track(base);

    // Everything git tracks plus untracked files it does not ignore, so uncommitted work comes along; ignored files
    // (node_modules, .env) stay here unless named with --with.
    const files = (await sh(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)).out.split('\0').filter(Boolean);
    const present: string[] = [];
    for (const f of [...files, ...o.with]) if (await Bun.file(join(root, f)).exists()) present.push(f);
    const tgz = join(out, 'repo.tgz');
    const tar = await sh(['tar', '--null', '-T', '-', '-czf', tgz], root, present.join('\0'));
    if (tar.code !== 0) throw new Error('could not pack the repository: ' + tar.err.slice(-200));
    const mb = Bun.file(tgz).size / 2 ** 20;
    say('base', `sending ${present.length} files (${mb.toFixed(1)} MB)`);
    await exec(base, 'mkdir -p ~/kit/out ~/app ~/.rd');
    const up = await boat(['scp', tgz, `${base}:/home/user/kit/repo.tgz`], { timeoutMs: 600_000 });
    if (up.code !== 0) throw new Error('could not upload the repository: ' + up.err.slice(-200));
    await rm(tgz, { force: true });
    await putFile(base, '/home/user/.rd/qa.mjs', await Bun.file(KIT + 'qa.mjs').text());

    const appPath = '~/app' + (o.dir ? '/' + o.dir : '');
    say('base', `installing: ${install}`);
    const inst = await long(base, 'install',
      `${TOOLS}${ensureTool(install)}${ensureTool(dev)}cd ~/app && tar -xzf ~/kit/repo.tgz && rm ~/kit/repo.tgz && cd ${appPath} && ${install}`, 1200);
    if (inst.code !== 0) throw new Error(`install failed (exit ${inst.code}):\n${inst.tail.trim().split('\n').slice(-8).join('\n')}`);
    // The baseline every variant is diffed against: the files as sent, after install (so lockfile noise is not in patches).
    const baseline = await exec(base, `cd ~/app && rm -rf .git && git init -q && git add -A && git -c user.name=gondola -c user.email=gondola@localhost commit -qm baseline && git tag gondola-base && echo OK`, 120);
    if (!baseline.stdout.includes('OK')) throw new Error('could not record the baseline in the sandbox: ' + baseline.stderr.slice(-200));

    say('base', `starting the dev server: ${dev}`);
    const first = await startDev(base, appPath, dev, o.port);
    if (!first.port) throw new Error(`the dev server did not come up. Its log ends with:\n${first.log}\nPass --dev and --port if it needs a different command.`);
    const port = first.port, loopback = first.loopback, url = `http://localhost:${port}${o.path}`;
    run.port = port;
    await exec(base, `${chrome(1440, 900, '/home/user/kit/original.png', url)}; timeout 60 node ~/.rd/qa.mjs shot ${q(url)} /home/user/kit/original-full.jpg >/dev/null 2>&1`, 180);
    const known = await browserCheck(base, url);
    for (const f of ['original.png', 'original-full.jpg']) await boat(['scp', `${base}:/home/user/kit/${f}`, join(out, f)], { timeoutMs: 120_000 });
    say('base', `dev server answers on port ${port}; snapshotting`);

    await boat(['stop', base, '--json'], { timeoutMs: 300_000 });
    for (let i = 0; i < 90; i++) {
      const info = lastJson((await boat(['info', base, '--json'])).out);
      const s = info?.sandbox ?? info;
      if (s?.state === 'stopped' && s?.snapshotAvailable) break;
      await Bun.sleep(2000);
    }

    // 2. One fork and one agent per variant.
    const template = await Bun.file(KIT + 'AGENTS.template.md').text();
    say('run', `forking ${o.n} sandboxes`);
    await Promise.all(directions.map(d => buildVariant(d, variants[d.n - 1])));

    async function buildVariant(d: Direction, v: Variant) {
      const started = Date.now();
      const tag = `#${d.n}`;
      let sb: string | null = null;
      const set = async (fields: Partial<Variant>) => { Object.assign(v, fields); await save(); };
      try {
        await set({ status: 'forking' });
        for (let attempt = 1; attempt <= 3 && !sb; attempt++) {
          await limiter.take();
          const f = await boat(['fork', base!, '--json', '--wait', '--ttl', '3600'], { timeoutMs: 300_000 });
          sb = lastJson(f.out)?.id ?? null;
          if (!sb) { say(tag, `fork failed (attempt ${attempt}): ${(f.err || f.out).trim().split('\n').pop()?.slice(0, 160)}`); await Bun.sleep(6000 * attempt); }
        }
        if (!sb) throw new Error('fork failed 3 times');
        await track(sb);
        await boat(['rename', sb, `gcli-${id}-${d.n}`]);
        await set({ sandbox: sb });

        // The private preview URL. For a server that listens on this machine only, Boat relays to it and takes the
        // port on the outside interface, and the URL must exist first because Vite refuses hosts it was not told
        // about. A server that listens on every interface needs that port itself, so it starts first.
        const hostIt = async () => lastJson((await boat(['host', sb!, String(port), ...(loopback ? ['--localhost'] : []), '--json'])).out);
        let hosted = loopback ? await hostIt() : null;
        const host = hosted?.url ? new URL(hosted.url).host : '';
        const up = await startDev(sb, appPath, dev!, port, host ? { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: host } : {});
        if (!up.port) throw new Error('the dev server did not start in the fork: ' + up.log.slice(-200));
        if (!loopback) hosted = await hostIt();
        if (hosted?.url) await set({ preview: hosted.url.replace(/\/?(\?|$)/, o.path + '$1') });

        const agents = template
          .replaceAll('{{N}}', String(d.n)).replaceAll('{{OF}}', String(d.of)).replaceAll('{{TASK}}', o.task)
          .replaceAll('{{DIR}}', o.dir ? '/' + o.dir : '').replaceAll('{{URL}}', url)
          .replaceAll('{{STYLE_RULES}}', STYLE_RULES[o.style]).replaceAll('{{COPY_RULES}}', COPY_RULES[d.copy.mode])
          .replaceAll('{{SHOT_DESKTOP}}', chrome(1440, 900, '/tmp/desktop.png', url)).replaceAll('{{SHOT_MOBILE}}', chrome(390, 844, '/tmp/mobile.png', url));
        await putFile(sb, '/home/user/kit/AGENTS.md', agents);
        await putFile(sb, '/home/user/kit/brief.json', JSON.stringify(d, null, 2));
        await mkdir(join(out, String(d.n)), { recursive: true });
        await Bun.write(join(out, String(d.n), 'brief.json'), JSON.stringify(d, null, 2));

        await set({ status: 'working' });
        say(tag, `agent started · ${d.label}`);
        const deadline = Date.now() + o.budgetMin * 60_000;
        let last = 0;
        const onAction = (a: string) => { if (/^(writing|editing)/.test(a) || Date.now() - last > 20_000) { last = Date.now(); say(tag, a); } };
        const turn = async (text: string, until: number) => {
          for (let attempt = 1; attempt <= 3; attempt++) {
            const left = until - Date.now();
            if (left < 45_000) return;
            const r = await prompt(o.model, sb!, attempt === 1 ? text :
              `Your previous turn was interrupted by an error. Continue the same task from where you stopped; your edits in ~/app are still there. Task: ${text}`, onAction, left);
            if (r.ok) return;
            say(tag, `agent error (attempt ${attempt}): ${r.error}`);
            await Bun.sleep(4000 * attempt);
          }
        };

        await turn(`You are variant agent ${d.n} of ${d.of}. Read ~/kit/AGENTS.md first and follow it exactly; your direction is ~/kit/brief.json. ` +
          `Make the change in ~/app, look at the result at ${url}, write ~/kit/result.json and stop.`, deadline);

        if (o.polish && deadline - Date.now() > 120_000) {
          say(tag, 'art director pass');
          await turn(`Art director pass. Take fresh screenshots of ${url} at 1440px and 390px wide (commands in ~/kit/AGENTS.md), open them, and judge the ` +
            `part you changed as the art director of an award-winning studio would: one clear focal point, a type scale with real jumps, deliberate line ` +
            `breaks, a visible grid, generous rhythmic spacing, a phone layout that is just as composed. Fix the five most visible problems with targeted ` +
            `edits. Keep your direction, the scope rules and the copy rules. Then stop.`, Math.min(deadline, Date.now() + 6 * 60_000));
        }

        // One round of concrete browser findings (overflow, overlap, contrast, script errors).
        // Findings the page already had before the change are not this variant's to fix.
        const qa = async () => newFindings(await browserCheck(sb!, url), known).slice(0, 12);
        let issues = await qa();
        if (issues.length && Date.now() < deadline + 120_000) {
          say(tag, `browser check found ${issues.length} issue${issues.length > 1 ? 's' : ''}, fixing`);
          await turn(`A browser check of ${url} found these problems:\n${issues.map(i => '- ' + i).join('\n')}\n` +
            `Fix the ones your change caused, with targeted edits. Keep your variant as it is otherwise. Then stop.`, Date.now() + 5 * 60_000);
          issues = await qa();
        }

        await set({ status: 'capturing', issues });
        const cap = await exec(sb,
          `cd ~/app && git log --oneline -n 5 > ~/kit/out/gitlog.txt 2>&1; git add -A >/dev/null 2>&1; git diff --cached --binary gondola-base > ~/kit/out/patch.diff; ` +
          `git diff --cached --name-only gondola-base > ~/kit/out/files.txt; git diff --cached --shortstat gondola-base > ~/kit/out/stat.txt; ` +
          `curl -s -o /dev/null -m 30 -w '%{http_code}' ${q(url)} > ~/kit/out/status.txt; ` +
          `${chrome(1440, 900, '/home/user/kit/out/desktop.png', url)}; ${chrome(390, 844, '/home/user/kit/out/mobile.png', url)}; ` +
          `timeout 60 node ~/.rd/qa.mjs shot ${q(url)} /home/user/kit/out/full.jpg >/dev/null 2>&1; ` +
          `cp ~/kit/result.json ~/kit/out/ 2>/dev/null; tail -n 40 ~/kit/dev.log > ~/kit/out/dev.log 2>/dev/null; ` +
          `cd ~/kit/out && tar -czf ~/kit/out.tgz . && echo PACKED`, 300);
        if (!cap.stdout.includes('PACKED')) throw new Error('could not collect the result');
        const dir = join(out, String(d.n));
        await boat(['scp', `${sb}:/home/user/kit/out.tgz`, join(dir, 'out.tgz')], { timeoutMs: 300_000 });
        await sh(['tar', '-xzf', 'out.tgz', '--no-same-owner', '--no-same-permissions'], dir);
        await rm(join(dir, 'out.tgz'), { force: true });

        const read = (f: string) => Bun.file(join(dir, f)).text().catch(() => '');
        const changed = (await read('files.txt')).trim().split('\n').filter(Boolean);
        if (!changed.length) throw new Error('the agent changed no files');
        let meta: any = {};
        try { meta = JSON.parse(await read('result.json')); } catch {}
        const str = (x: unknown, k: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, k) : null);
        await set({
          status: 'done', files: changed, stat: (await read('stat.txt')).trim(), page_status: (await read('status.txt')).trim(),
          name: str(meta.name, 60) ?? d.label, summary: str(meta.summary, 300) ?? undefined, headline: str(meta.headline, 300),
          notes: str(meta.notes, 700), seconds: Math.round((Date.now() - started) / 1000),
        });
        say(tag, `done: ${v.name} (${v.stat || changed.length + ' files'})`);
      } catch (e: any) {
        await set({ status: 'failed', error: String(e?.message ?? e).slice(0, 300), seconds: Math.round((Date.now() - started) / 1000) });
        say(tag, `failed: ${v.error}`);
      } finally {
        if (sb && !(o.keep && v.status === 'done')) await destroy(sb);
        if (!sb || !o.keep || v.status !== 'done') await set({ preview: undefined });
      }
    }
  } finally {
    if (base) await destroy(base);
    if (!o.keep) await cleanup();
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    run.finished_at = new Date().toISOString();
    run.seconds = Math.round((Date.now() - t0) / 1000);
    run.sandboxes = [...sandboxes];
    await save();
  }

  const wall = await writeWall(out, run);
  return { run, out, wall };
}
