#!/usr/bin/env bun
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { boat } from './boat';
import { explore, detect, type Options } from './explore';
import { writeWall } from './wall';

const HELP = `gondola: explore a change as many variants at once, each built in its own Boat sandbox.

Usage
  gondola explore "<task>" [options]   Build N variants of a change to this repo. Nothing here is modified.
  gondola list                         Runs in this repo.
  gondola open [--run <id>]            Open the page that compares a run's variants (the latest by default).
  gondola show [--run <id>]            Variants of a run (the latest by default), as text.
  gondola apply <n> [--run <id>]       Apply variant n to the working tree. Add -b to do it on a new branch.
  gondola clean                        Delete sandboxes that runs left behind.

Options for explore
  -n, --count <N>        Number of variants (default 6, at most 50).
      --copy             Also vary the wording: each variant gets its own angle and voice. Facts stay fixed.
      --style <keep|wild>
                         keep (default): stay in the project's design system and vary the composition.
                         wild: restyle, each variant with its own art direction, palette and fonts.
      --path <path>      Page the change is on (default /).
      --dir <folder>     App folder inside the repo, for monorepos.
      --dev <command>    Dev server command (default: from package.json).
      --install <command>
                         Install command (default: from the lockfile).
      --port <N>         Port the dev server uses (default: detected).
      --with <file>      Send a git-ignored file too, e.g. --with .env.local. Repeatable.
      --model <id>       Agent model (default claude-sonnet-5-5, run as Claude Code on your Boat Claude sign-in;
                         openrouter:<model> uses your OpenRouter key in Boat).
      --machine <size>   Sandbox size: small, default, large (default: default).
      --budget <min>     Minutes each agent may work (default 12).
      --polish           Add an art-director pass: each agent critiques its own screenshots and fixes them.
      --keep             Leave finished sandboxes running for an hour so their live previews stay open.
      --json             Print the result as JSON on stdout (progress goes to stderr).
`;

function parse(argv: string[]) {
  const flags: Record<string, string | boolean | string[]> = {}, rest: string[] = [];
  const short: Record<string, string> = { n: 'count', b: 'branch', h: 'help' };
  const bool = new Set(['copy', 'polish', 'keep', 'json', 'branch', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-') || a === '-') { rest.push(a); continue; }
    let [k, v] = a.replace(/^--?/, '').split(/=(.*)/s) as [string, string | undefined];
    k = short[k] ?? k;
    if (bool.has(k)) { flags[k] = true; continue; }
    v ??= argv[++i];
    if (v === undefined) throw new Error(`--${k} needs a value`);
    if (k === 'with') (flags.with = (flags.with as string[]) ?? []).push(v); else flags[k] = v;
  }
  return { flags, rest };
}

const git = async (args: string[], cwd = process.cwd(), stdin?: string) => {
  const p = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', stdin: stdin === undefined ? 'ignore' : new Blob([stdin]) });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
};
const repoRoot = async () => {
  const r = (await git(['rev-parse', '--show-toplevel'])).out.trim();
  if (!r) throw new Error('not inside a git repository');
  return r;
};
async function runs(root: string) {
  const dir = join(root, '.gondola'), out: any[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const run = await Bun.file(join(dir, name, 'run.json')).json().catch(() => null);
    if (run) out.push(run);
  }
  return out.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
}
async function pickRun(root: string, id?: string) {
  const all = await runs(root);
  const run = id ? all.find(r => r.id === id) : all.at(-1);
  if (!run) throw new Error(id ? `no run ${id} in this repo` : 'no runs in this repo yet: start one with `gondola explore "<task>"`');
  return run;
}
const publicVariant = (root: string, run: any, v: any) => ({
  n: v.n, status: v.status, direction: v.label, name: v.name, summary: v.summary, headline: v.headline, notes: v.notes,
  changed: v.stat, files: v.files, page_status: v.page_status, issues_left: v.issues, error: v.error, preview: v.preview,
  patch: v.status === 'done' ? join(root, '.gondola', run.id, String(v.n), 'patch.diff') : undefined,
  screenshot: v.status === 'done' ? join(root, '.gondola', run.id, String(v.n), 'desktop.png') : undefined,
  apply: v.status === 'done' ? `gondola apply ${v.n} --run ${run.id}` : undefined,
});
const table = (run: any) => run.variants.map((v: any) =>
  `  ${String(v.n).padStart(2)}  ${v.status === 'done' ? (v.name ?? '').padEnd(28).slice(0, 28) : ('(' + v.status + ')').padEnd(28)}  ${v.status === 'done' ? v.label : (v.error ?? '')}` +
  (v.headline ? `\n      "${v.headline}"` : '')).join('\n');

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { flags, rest } = parse(argv);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || flags.help) { console.log(HELP); return; }

  if (cmd === 'explore') {
    const task = rest.join(' ').trim();
    if (!task) throw new Error('say what to explore: gondola explore "redesign the pricing section"');
    const n = Number(flags.count ?? 6);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('--count must be between 1 and 50');
    const style = String(flags.style ?? 'keep');
    if (style !== 'keep' && style !== 'wild') throw new Error('--style is keep or wild');
    const path = String(flags.path ?? '/');
    if ((await boat(['--version'])).code !== 0) throw new Error('the Boat CLI is not installed or not signed in: see https://boat.dev, then `boat login`');
    const o: Options = {
      task, cwd: process.cwd(), n, style, copy: !!flags.copy, dir: String(flags.dir ?? '').replace(/^\.?\/+|\/+$/g, ''),
      path: path.startsWith('/') ? path : '/' + path, install: flags.install as string | undefined, dev: flags.dev as string | undefined,
      port: flags.port ? Number(flags.port) : undefined, with: (flags.with as string[]) ?? [],
      model: String(flags.model ?? process.env.GONDOLA_MODEL ?? 'claude-sonnet-5-5'), machine: String(flags.machine ?? 'default'),
      budgetMin: Number(flags.budget ?? 12), polish: !!flags.polish, keep: !!flags.keep, json: !!flags.json,
    };
    const { run, out, wall } = await explore(o);
    const done = run.variants.filter((v: any) => v.status === 'done').length;
    if (o.json) console.log(JSON.stringify({ run: run.id, task: run.task, finished: done, of: run.variants.length, wall, folder: out, variants: run.variants.map((v: any) => publicVariant(run.repo, run, v)) }, null, 2));
    else console.log(`\n${done} of ${run.variants.length} variants finished.\n\n${table(run)}\n\nCompare them:  gondola open\nTake one:      gondola apply <n>\n`);
    if (!done) process.exitCode = 1;
    return;
  }

  const root = await repoRoot();

  if (cmd === 'list') {
    const all = await runs(root);
    if (flags.json) { console.log(JSON.stringify(all.map(r => ({ run: r.id, task: r.task, started_at: r.started_at, finished: r.variants.filter((v: any) => v.status === 'done').length, of: r.variants.length })), null, 2)); return; }
    console.log(all.length ? all.map(r => `${r.id}  ${String(r.started_at).slice(0, 16).replace('T', ' ')}  ${r.variants.filter((v: any) => v.status === 'done').length}/${r.variants.length}  ${r.task}`).join('\n') : 'No runs in this repo yet.');
    return;
  }

  if (cmd === 'show') {
    const run = await pickRun(root, flags.run as string | undefined);
    if (flags.json) console.log(JSON.stringify({ run: run.id, task: run.task, wall: join(root, '.gondola', run.id, 'wall.html'), variants: run.variants.map((v: any) => publicVariant(root, run, v)) }, null, 2));
    else console.log(`Run ${run.id}: ${run.task}\n\n${table(run)}\n\nCompare them:  ${join(root, '.gondola', run.id, 'wall.html')}`);
    return;
  }

  if (cmd === 'open') {
    const run = await pickRun(root, flags.run as string | undefined);
    const wall = await writeWall(join(root, '.gondola', run.id), run);   // rebuilt, so old runs get the current wall
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    if (!flags.json) Bun.spawn([opener, wall], { stdout: 'ignore', stderr: 'ignore' }).unref();
    console.log(wall);
    return;
  }

  if (cmd === 'apply') {
    const run = await pickRun(root, flags.run as string | undefined);
    const v = run.variants.find((x: any) => x.n === Number(rest[0]));
    if (!v || v.status !== 'done') throw new Error(`run ${run.id} has no finished variant ${rest[0] ?? ''}`.trim());
    const patch = join(root, '.gondola', run.id, String(v.n), 'patch.diff');
    // The patch was made against the files as they were when the run started.
    if ((await git(['apply', '--check', patch], root)).code !== 0 && (await git(['apply', '--check', '--3way', patch], root)).code !== 0)
      throw new Error(`variant ${v.n} no longer applies cleanly: these files changed since the run started.\n${(await git(['apply', '--check', patch], root)).err.trim().split('\n').slice(0, 6).join('\n')}`);
    if (flags.branch) {
      const name = `gondola/${run.id}-${v.n}`;
      const sw = await git(['switch', '-c', name], root);
      if (sw.code !== 0) throw new Error(sw.err.trim());
      console.error(`on new branch ${name}`);
    }
    const ap = (await git(['apply', patch], root)).code === 0 ? { code: 0, err: '' } : await git(['apply', '--3way', patch], root);
    if (ap.code !== 0) throw new Error(ap.err.trim());
    console.log(`Applied variant ${v.n} (${v.name}) to the working tree: ${v.stat || v.files.length + ' files'}.\nNothing is committed. Review with \`git diff\`; undo with \`git apply -R ${patch}\`.`);
    return;
  }

  if (cmd === 'clean') {
    const r = await boat(['list', '--json'], { timeoutMs: 60_000 });
    let list: any[] = [];
    try { list = JSON.parse(r.out).sandboxes ?? []; } catch { throw new Error('could not list your Boat sandboxes: ' + r.err.trim().slice(-200)); }
    const ours = list.filter(s => /^gcli-/.test(String(s.name ?? '')));
    for (const s of ours) {
      const d = await boat(['delete', s.id, '--yes', '--json'], { timeoutMs: 60_000 });
      console.log(`${d.code === 0 ? 'deleted' : 'could not delete'} ${s.id} (${s.name})`);
    }
    if (!ours.length) console.log('No gondola sandboxes are running.');
    return;
  }

  if (cmd === 'detect') { console.log(JSON.stringify(await detect(join(root, String(flags.dir ?? ''))), null, 2)); return; }
  throw new Error(`unknown command "${cmd}". Run gondola --help.`);
}

main().catch(e => { console.error(`gondola: ${e?.message ?? e}`); process.exit(1); });
