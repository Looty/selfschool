/**
 * Cell values are compared as written: trimmed, inner whitespace collapsed, single quotes read as double. Case matters.
 * Outside string literals, spacing around brackets, commas and colons is ignored, so `['a','b']` equals `['a', 'b']`.
 */
export const normalizeTrace = (s: string): string =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/'/g, '"')
    .split(/("[^"]*")/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/ ?([,:;()[\]{}]) ?/g, "$1")))
    .join("");

/** Whether a typed cell equals the answer or any accepted spelling of it. */
export const traceMatches = (typed: string, accepted: string | string[]): boolean => {
  const want = (Array.isArray(accepted) ? accepted : [accepted]).map(normalizeTrace);
  const got = normalizeTrace(typed);
  return got !== "" && want.includes(got);
};
