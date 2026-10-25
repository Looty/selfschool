/** Cell values are compared as written: trimmed, inner whitespace collapsed, single quotes read as double. Case matters. */
export const normalizeTrace = (s: string): string => s.trim().replace(/\s+/g, " ").replace(/'/g, '"');

/** Whether a typed cell equals the answer or any accepted spelling of it. */
export const traceMatches = (typed: string, accepted: string | string[]): boolean => {
  const want = (Array.isArray(accepted) ? accepted : [accepted]).map(normalizeTrace);
  const got = normalizeTrace(typed);
  return got !== "" && want.includes(got);
};
