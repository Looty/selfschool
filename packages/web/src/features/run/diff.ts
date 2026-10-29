export interface LineDiff {
  /** Lines of the current text that are new or changed (0-based). */
  changed: Set<number>;
  /** How many lines were edited: per changed stretch, the larger of lines added and lines removed. */
  count: number;
}

/**
 * Compares two texts line by line, from a longest-common-subsequence match of whole lines, so inserting a line marks
 * that line only, not everything below it. One alignment gives both the marks and the count. Lesson scripts are
 * short; past a size where the table would get large it falls back to comparing line by line.
 */
export function diffLines(original: string, current: string): LineDiff {
  const a = original.split("\n");
  const b = current.split("\n");
  const changed = new Set<number>();
  if (a.length * b.length > 1_000_000) {
    let count = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      count++;
      if (i < b.length) changed.add(i);
    }
    return { changed, count };
  }
  // lcs[i * w + j] = length of the common subsequence of a[i..] and b[j..]
  const w = b.length + 1;
  const lcs = new Uint16Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  let count = 0;
  let added = 0;
  let removed = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      // a matching line closes the changed stretch before it
      count += Math.max(added, removed);
      added = removed = 0;
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) {
      removed++; // a line of the original is gone here
      i++;
    } else {
      changed.add(j++);
      added++;
    }
  }
  count += Math.max(added, removed);
  return { changed, count };
}
