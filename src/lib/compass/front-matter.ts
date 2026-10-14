// Flat front matter: `---` on line 1, `key: value` scalars, `---` to close. That is the whole grammar
// the compass tooling writes, so no YAML library: nested or list values are reported, not parsed.

export interface FrontMatter {
  /** True when a terminated `---` block opened the file. */
  present: boolean;
  /** Keys lower-cased, values trimmed with one layer of matching quotes removed. */
  data: Record<string, string>;
  /** Everything after the closing `---` (or the whole text when there is no block). */
  body: string;
  problems: string[];
}

const KEY_VALUE_RE = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/;

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2) {
    const first = v[0],
      last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return v.slice(1, -1);
  }
  return v;
}

export function parseFrontMatter(raw: string): FrontMatter {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { present: false, data: {}, body: text, problems: [] };
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (close < 0) {
    return {
      present: false,
      data: {},
      body: text,
      problems: ['Front matter opens with --- but never closes; the file was read as plain markdown.'],
    };
  }
  const data: Record<string, string> = {};
  const problems: string[] = [];
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = KEY_VALUE_RE.exec(line);
    if (!m || /^\s/.test(line)) {
      problems.push(`Front matter line ${i + 1} is not a flat key: value pair (${trimmed.slice(0, 40)}).`);
      continue;
    }
    const key = m[1].toLowerCase();
    if (key in data) problems.push(`Front matter repeats the key "${key}"; the last value wins.`);
    data[key] = unquote(m[2]);
  }
  return { present: true, data, body: lines.slice(close + 1).join('\n'), problems };
}

/** A positive integer from a front-matter value, else null. */
export function frontMatterInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= 1 ? n : null;
}
