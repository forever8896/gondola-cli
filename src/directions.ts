// Picks one direction per variant: a composition or an art direction, plus (optionally) a copy angle and voice.
const KIT = new URL('../kit/', import.meta.url).pathname;
const load = (f: string) => Bun.file(KIT + f).json();

export type StyleMode = 'keep' | 'wild';
export type Direction = {
  n: number;
  of: number;
  label: string;
  style: any;
  copy: { mode: 'verbatim' } | { mode: 'rewrite'; angle: any; voice: any };
};

const shuffle = <T>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};
/** n items from a shuffled list, starting over (reshuffled) when the list runs out. */
const cycle = <T>(list: T[], n: number) => {
  const out: T[] = [];
  while (out.length < n) out.push(...shuffle(list));
  return out.slice(0, n);
};

/** Background themes for a set: about 20% light, 20% paper, 25% colour-field, the rest dark. */
function themeSlots(n: number) {
  const k = (f: number) => Math.round(n * f);
  const slots: string[] = [...Array(k(0.2)).fill('light'), ...Array(k(0.2)).fill('paper'), ...Array(k(0.25)).fill('colour')];
  while (slots.length < n) slots.push('dark');
  return shuffle(slots.slice(0, n));
}

/** Art directions from Gondola's library: one per style family first, each with its own palette and font pairing. */
async function wildStyles(n: number) {
  const briefs: any[] = (await load('briefs.json')).filter((b: any) => !b.tier);   // refined directions only
  const palettes: any[] = await load('palettes.json');
  const types: any[] = (await load('type-pairings.json')).filter((t: any) => !t.mood.includes('wildcard'));

  const fams = new Map<string, any[]>();
  for (const b of shuffle(briefs)) (fams.get(b.style_family) ?? fams.set(b.style_family, []).get(b.style_family)!).push(b);
  const picked: any[] = [];
  for (let round = 0; picked.length < n && round < 20; round++)
    for (const f of shuffle([...fams.keys()])) {
      const b = fams.get(f)![round];
      if (b && picked.length < n) picked.push(b);
    }
  while (picked.length < n) picked.push(...shuffle(briefs).slice(0, n - picked.length));   // more variants than directions

  const slots = themeSlots(n), usedP = new Set<string>(), usedT = new Set<string>();
  return picked.map((b, i) => {
    const p = shuffle(palettes.filter(x => x.theme === slots[i] && !usedP.has(x.id)))[0]
      ?? shuffle(palettes.filter(x => !usedP.has(x.id)))[0] ?? shuffle(palettes)[0];
    usedP.add(p.id);
    const t = shuffle(types.filter(x => !usedT.has(x.id)))[0] ?? shuffle(types)[0];
    usedT.add(t.id);
    const { palette: _p, typography: _t, brief_id: _i, directory_tags: _d, ...rest } = b;
    return {
      mode: 'wild', ...rest,
      palette: {
        theme: p.theme, background: p.bg, surface: p.surface, text: p.ink, muted_text: p.muted, accent: p.accent,
        accent_use: p.accent_use, ...(p.accent2 ? { accent2: p.accent2, accent2_use: p.accent2_use } : {}),
      },
      typography: { display: t.display, text: t.text, ...(t.mono ? { mono: t.mono } : {}), how: t.use },
    };
  });
}

const pretty = (s: string) => String(s).split('-').map(w => (w[0]?.toUpperCase() ?? '') + w.slice(1)).join(' ');

export async function pickDirections(n: number, style: StyleMode, copy: boolean): Promise<Direction[]> {
  const styles = style === 'wild'
    ? await wildStyles(n)
    : cycle(await load('compositions.json') as any[], n).map(c => ({ mode: 'keep', composition: c.name, idea: c.idea }));
  const lib = await load('copy.json');
  const angles = cycle(lib.angles as any[], n), voices = cycle(lib.voices as any[], n);
  return styles.map((s: any, i: number) => {
    const c = copy
      ? { mode: 'rewrite' as const, angle: { name: angles[i].name, how: angles[i].how }, voice: { name: voices[i].name, how: voices[i].how } }
      : { mode: 'verbatim' as const };
    const label = (s.mode === 'wild' ? pretty(s.style_family) : s.composition) + (copy ? ` · ${angles[i].name}, ${voices[i].name.toLowerCase()}` : '');
    return { n: i + 1, of: n, label, style: s, copy: c };
  });
}

export const STYLE_RULES: Record<StyleMode, string> = {
  keep:
    `Stay inside the project's existing design system: its colours, fonts, spacing scale and components. Do not add new\n` +
    `colours or fonts. Your variant differs through composition: \`brief.style.composition\` and \`brief.style.idea\` tell you\n` +
    `how to arrange and stage the content. Commit to that idea fully; a timid version of it is worthless next to the others.`,
  wild:
    `This is a restyle. \`brief.style\` gives you a style family, palette, typography, layout, motion and a hard constraint:\n` +
    `follow them literally, using exactly those colours (in the roles given) and exactly those fonts (Google Fonts links are\n` +
    `allowed for them). Put the new tokens in one place (CSS variables or the theme config the project already has) and apply\n` +
    `them only to what the task covers, so the change is easy to extend or revert.`,
};

export const COPY_RULES = {
  verbatim:
    `Keep all wording exactly as it is. You may reorder, regroup and re-emphasise existing text, but do not rewrite it and\n` +
    `do not add or remove content.`,
  rewrite:
    `Rewrite the wording. \`brief.copy.angle\` says what the text should lead with and \`brief.copy.voice\` how it should\n` +
    `sound. Apply both to every headline, sub-headline, label and call to action the task covers.\n` +
    `Facts are fixed: never invent or change numbers, prices, features, customers, quotes, dates or guarantees. Every claim\n` +
    `must be supported by what the repository already says. You may cut text, and you may say the same true thing in\n` +
    `different words. Keep it in the language the page is already written in.`,
};
