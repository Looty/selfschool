/** Pure helpers for lesson markdown: directive blocks, citations, heading ids. No React, no DOM. */

export type DirectiveName = "low-confidence" | "key-takeaways" | "glossary";
export type Block = { kind: "markdown"; text: string } | { kind: DirectiveName; text: string };

const DIRECTIVES: readonly string[] = ["low-confidence", "key-takeaways", "glossary"];
const FENCE = /^\s{0,3}(```+|~~~+)/;
const OPEN = /^:::\s*([a-z][a-z0-9-]*)\s*$/i;
const CLOSE = /^:::\s*$/;

/**
 * Splits lesson markdown into plain markdown chunks and `:::name … :::` directive blocks.
 * Directives inside fenced code are left alone; an unclosed directive stays literal markdown;
 * an unknown directive name keeps its content as plain markdown.
 */
export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) blocks.push({ kind: "markdown", text });
    buf = [];
  };

  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = FENCE.exec(line);
    if (f) {
      const mark = f[1]![0]!;
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      buf.push(line);
      continue;
    }
    const open = fence === null ? OPEN.exec(line) : null;
    if (!open) {
      buf.push(line);
      continue;
    }
    // find the closing ::: outside of code fences
    let inner: string[] = [];
    let end = -1;
    let innerFence: string | null = null;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      const jf = FENCE.exec(l);
      if (jf) {
        const mark = jf[1]![0]!;
        if (innerFence === null) innerFence = mark;
        else if (innerFence === mark) innerFence = null;
      } else if (innerFence === null && CLOSE.test(l)) {
        end = j;
        break;
      }
      inner.push(l);
    }
    if (end === -1) {
      buf.push(line); // unclosed: literal
      continue;
    }
    const name = open[1]!.toLowerCase();
    const text = inner.join("\n").trim();
    if (DIRECTIVES.includes(name)) {
      flush();
      blocks.push({ kind: name as DirectiveName, text });
    } else {
      buf.push(...inner);
    }
    i = end;
    inner = [];
  }
  flush();
  return blocks;
}

/** Splits a line into [text, isCode] runs so `[3]` inside `inline code` is never touched. */
function splitInlineCode(line: string): Array<[string, boolean]> {
  const out: Array<[string, boolean]> = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push([line.slice(last, m.index), false]);
    out.push([m[0], true]);
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push([line.slice(last), false]);
  return out;
}

/** Applies `fn` to every prose segment (outside fenced and inline code). */
function mapProse(md: string, fn: (text: string) => string): string {
  let fence: string | null = null;
  return md
    .split("\n")
    .map((line) => {
      const f = FENCE.exec(line);
      if (f) {
        const mark = f[1]![0]!;
        if (fence === null) fence = mark;
        else if (fence === mark) fence = null;
        return line;
      }
      if (fence !== null) return line;
      return splitInlineCode(line)
        .map(([t, code]) => (code ? t : fn(t)))
        .join("");
    })
    .join("\n");
}

// `[3]` not already a link label (`[3](…)`, `[3][ref]`) or a footnote/task marker.
const CITATION = /(?<![\\!\]])\[(\d{1,3})\](?![(:[])/g;

export const sourceHref = (n: number) => `#source-${n}`;

/** Citation numbers used in the prose, ascending and unique. */
export function extractCitations(md: string): number[] {
  const found = new Set<number>();
  mapProse(md, (t) => {
    for (const m of t.matchAll(CITATION)) found.add(Number(m[1]));
    return t;
  });
  return [...found].sort((a, b) => a - b);
}

/**
 * Rewrites `[n]` into a markdown link to the Sources entry. Numbers without a source are left as
 * plain text so there are no dead anchors.
 */
export function linkCitations(md: string, known: ReadonlySet<number>): string {
  return mapProse(md, (t) => t.replace(CITATION, (whole, n: string) => (known.has(Number(n)) ? `[\\[${n}\\]](${sourceHref(Number(n))})` : whole)));
}

/** GitHub-style heading id: lowercase, words joined by dashes. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}
