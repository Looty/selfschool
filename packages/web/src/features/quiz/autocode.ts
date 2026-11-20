/**
 * Finds code inside quiz prose that the author did not put in backticks, so it can be shown in mono.
 * Three shapes count as code:
 * - a call or index: a name directly followed by `(` or `[` (`sorted(pairs)`, `p[1]`, `d.get("k")`);
 * - an assignment: `name = value`, where the value is a literal, a name, a call or a bracket group;
 * - a bare `[...]` or `{...}` group, or a `(...)` group holding quotes or brackets, that does not read as prose.
 * Brackets must balance (quotes inside are skipped), so prose like "(see above)" or "file(s)" stays prose.
 */
export type Segment = { code: boolean; text: string };

const OPEN = "([{";
const CLOSE = ")]}";
const IDENT_START = /[A-Za-z_]/;
const IDENT = /\w/;

/** Index just past the bracket group that opens at `i`, or -1 when it does not close. */
function groupEnd(s: string, i: number): number {
  const stack: string[] = [];
  for (let j = i; j < s.length; j++) {
    const c = s[j]!;
    if (c === '"' || c === "'") {
      const k = s.indexOf(c, j + 1);
      if (k < 0) return -1;
      j = k;
      continue;
    }
    const o = OPEN.indexOf(c);
    if (o >= 0) stack.push(CLOSE[o]!);
    else if (CLOSE.includes(c)) {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return j + 1;
    }
  }
  return -1;
}

/** Index just past a dotted name (`a`, `d.get`) starting at `i`. */
function identEnd(s: string, i: number): number {
  let j = i;
  for (;;) {
    while (j < s.length && IDENT.test(s[j]!)) j++;
    if (s[j] === "." && IDENT_START.test(s[j + 1] ?? "")) j++;
    else return j;
  }
}

/** Extends past trailing calls, indexes and attributes: `f(x)[0].y`. */
function chainEnd(s: string, j: number): number {
  for (;;) {
    if (s[j] === "(" || s[j] === "[") {
      const e = groupEnd(s, j);
      if (e < 0) return j;
      j = e;
    } else if (s[j] === "." && IDENT_START.test(s[j + 1] ?? "")) j = identEnd(s, j + 1);
    else return j;
  }
}

/** Three or more words in a row (string literals removed) read as a sentence, not code. */
const readsAsProse = (t: string): boolean => /[A-Za-z]{2,}(\s+[A-Za-z]{2,}){2,}/.test(t.replace(/(["'])[^"']*\1/g, ""));

/** Index just past a value starting at `i` (a literal, number, name or call, or bracket group), or -1. */
function valueEnd(s: string, i: number): number {
  const c = s[i] ?? "";
  if (c === '"' || c === "'") {
    const k = s.indexOf(c, i + 1);
    return k < 0 ? -1 : k + 1;
  }
  if (OPEN.includes(c)) {
    const e = groupEnd(s, i);
    return e < 0 ? -1 : chainEnd(s, e);
  }
  const num = /^-?\d+(\.\d+)?/.exec(s.slice(i));
  if (num) return i + num[0].length;
  if (IDENT_START.test(c)) return chainEnd(s, identEnd(s, i));
  return -1;
}

/** Index just past `= value` (also `a = b = value`) after a name ending at `j`, or -1. */
function assignmentEnd(s: string, j: number): number {
  const m = /^\s*=\s*/.exec(s.slice(j));
  if (!m || s[j + m[0].length] === "=") return -1;
  const end = valueEnd(s, j + m[0].length);
  if (end < 0) return -1;
  const more = IDENT_START.test(s[j + m[0].length]!) ? assignmentEnd(s, end) : -1;
  return more > 0 ? more : end;
}

/** Splits plain text into prose and code segments. */
export function splitCode(s: string): Segment[] {
  const out: Segment[] = [];
  let plain = 0;
  const push = (start: number, stop: number) => {
    // a declaration keyword belongs to its assignment, a closing `;` to the statement it ends
    const decl = /\b(const|let|var) $/.exec(s.slice(plain, start));
    const from = decl ? start - decl[0].length : start;
    const to = s.slice(stop).trim() === ";" ? s.length : stop;
    if (from > plain) out.push({ code: false, text: s.slice(plain, from) });
    out.push({ code: true, text: s.slice(from, to) });
    plain = to;
    return to;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (IDENT_START.test(c)) {
      const e = identEnd(s, i);
      if (s[e] === "(" || s[e] === "[") {
        const g = groupEnd(s, e);
        // "file(s)", "match(es)" are plurals, not calls
        if (g > 0 && !/^\((s|es)\)$/.test(s.slice(e, g))) {
          i = push(i, chainEnd(s, g));
          continue;
        }
      }
      const a = assignmentEnd(s, e);
      if (a > 0) {
        i = push(i, a);
        continue;
      }
      i = e;
      continue;
    }
    if (OPEN.includes(c)) {
      const g = groupEnd(s, i);
      const inner = g > 0 ? s.slice(i + 1, g - 1) : "";
      if (g > 0 && !readsAsProse(inner) && (c !== "(" || /["'([{]/.test(inner))) {
        i = push(i, chainEnd(s, g));
        continue;
      }
    }
    i++;
  }
  if (plain < s.length) out.push({ code: false, text: s.slice(plain) });
  return out;
}
