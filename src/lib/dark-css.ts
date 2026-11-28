// A dark copy of a stylesheet written with literal light colours.
//
// The workspaces (a task's, an experiment's) were drawn as a daylight pane: about a thousand colour literals over
// a dozen stylesheets, none of them tokens. Rather than restate each by hand, darkCss() reads such a stylesheet
// and answers the rules that undo it for the dark theme: the same selectors under `.dark`, the same declarations,
// each colour turned over in lightness (white becomes the dark ground, ink becomes light, an accent stays an
// accent) with its hue kept. What is dark on purpose in daylight (a code block, a 3D stage) is left alone, and
// so are shadows, which stay dark on any ground.

type Rgb = [number, number, number];
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** A light-theme colour as the dark theme shows it: lightness turned over, hue kept, grounds a little less vivid. */
export function darkOf(rgb: Rgb): Rgb {
  const [L, a, b] = toOklab(rgb);
  const to = Math.min(0.95, Math.max(0.13, 1.02 - 0.86 * L));
  // A cream ground turned over at full strength is mud: grounds keep a hint of their warmth, no more.
  let keep = to < 0.3 ? 0.55 : 1;
  for (let i = 0; i < 12; i++, keep *= 0.85) {
    const out = fromOklab([to, a * keep, b * keep]);
    if (out.every((c) => c >= -0.002 && c <= 1.002) || i === 11) return out.map((c) => Math.round(255 * Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, c))))))) as Rgb;
  }
  return rgb;
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]+\s*[, ]\s*[\d.]+\s*[, ]\s*[\d.]+\s*(?:[,/]\s*[\d.]+%?\s*)?\)/g;
function parse(text: string): { rgb: Rgb; alpha: number } | null {
  if (text.startsWith('#')) {
    const hex = text.slice(1), wide = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    if (wide.length !== 6 && wide.length !== 8) return null;
    const n = (i: number) => parseInt(wide.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], alpha: wide.length === 8 ? n(6) / 255 : 1 };
  }
  const parts = text.slice(text.indexOf('(') + 1, -1).split(/[\s,/]+/).filter(Boolean);
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  return { rgb: [Number(parts[0]), Number(parts[1]), Number(parts[2])], alpha };
}
const turn = (value: string) => value.replace(COLOUR, (text) => {
  const c = parse(text);
  if (!c) return text;
  const [r, g, b] = darkOf(c.rgb);
  return c.alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${+c.alpha.toFixed(3)})`;
});

type Node = { selector: string; body: string } | { at: string; children: Node[] };
/** Rules and the @-blocks around them, comments dropped. Enough CSS for stylesheets written by hand in this repo. */
function read(css: string): Node[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let at = 0;
  const block = (): Node[] => {
    const out: Node[] = [];
    while (at < text.length) {
      const open = text.indexOf('{', at), close = text.indexOf('}', at);
      if (close !== -1 && (open === -1 || close < open)) { at = close + 1; return out; }   // the end of the block we are in
      if (open === -1) break;
      const head = text.slice(at, open).trim();
      at = open + 1;
      if (/^@(media|supports|container|layer)\b/.test(head)) out.push({ at: head, children: block() });
      else {
        // A rule, or an @-block with nothing to turn (keyframes, font-face): its body is read to its matching brace.
        let depth = 1, end = at;
        for (; end < text.length && depth > 0; end++) depth += text[end] === '{' ? 1 : text[end] === '}' ? -1 : 0;
        if (!head.startsWith('@')) out.push({ selector: head, body: text.slice(at, end - 1) });
        at = end;
      }
    }
    return out;
  };
  return block();
}
/** The declarations of a rule: split at the semicolons that are not inside brackets. */
function declarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0, from = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if ((ch === ';' && depth === 0) || i === body.length) {
      const one = body.slice(from, i), colon = one.indexOf(':');
      if (colon > 0) out.push([one.slice(0, colon).trim(), one.slice(colon + 1).trim()]);
      from = i + 1;
    }
  }
  return out;
}
const splitSelectors = (selector: string) => {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i <= selector.length; i++) {
    const ch = selector[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if ((ch === ',' && depth === 0) || i === selector.length) { out.push(selector.slice(from, i).trim()); from = i + 1; }
  }
  return out.filter(Boolean);
};
const SHADOW = /^(-webkit-)?(box-shadow|text-shadow|filter|backdrop-filter)$/;

export interface DarkOptions {
  /** What a dark page has above the styled thing: `.dark` alone, or `.dark .srp` for styles also used elsewhere. */
  under: string;
  /** The class of the thing itself, when rules name it first (`.srp{...}`): those go under `.dark` directly. */
  root?: string;
  /** Only rules whose selector matches are turned. */
  only?: RegExp;
  /** Selectors of what is dark on purpose in daylight (a code block, a 3D stage, a window) and stays as it is. */
  keep?: RegExp;
}

/** The rules that make a light stylesheet dark under `.dark`. Add them after the stylesheet itself. */
export function darkCss(css: string, { under, root, only, keep }: DarkOptions): string {
  const nodes = read(css);
  const kept = (selector: string) => keep !== undefined && keep.test(selector);
  const place = (selector: string) => (root && new RegExp(`^\\${root}(?![\\w-])`).test(selector) ? `.dark ${selector}` : `${under} ${selector}`);

  const write = (list: Node[]): string => list.map((node) => {
    if ('at' in node) { const inner = write(node.children); return inner ? `${node.at}{${inner}}` : ''; }
    if (only && !only.test(node.selector)) return '';
    const selectors = splitSelectors(node.selector).filter((s) => !kept(s));
    if (selectors.length === 0) return '';
    const turned = declarations(node.body)
      .filter(([prop, value]) => !SHADOW.test(prop) && !value.includes('url(') && value.search(COLOUR) !== -1)
      .map(([prop, value]) => `${prop}:${turn(value)}`);
    return turned.length ? `${selectors.map(place).join(',')}{${turned.join(';')}}` : '';
  }).join('');
  return `\n${write(nodes)}\n`;
}
