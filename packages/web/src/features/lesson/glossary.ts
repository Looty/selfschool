/** Lesson glossary: parse the `:::glossary` block and mark its terms in the prose as hoverable <abbr data-def="meaning">. No React, no DOM. */

export interface GlossaryEntry {
  /** What the learner reads in the prose, e.g. "LLM" or "large language model". */
  phrase: string;
  /** The plain-words meaning shown on hover. */
  meaning: string;
  /** The term as written in the glossary line, for listing terms that never appear in the prose. */
  term: string;
}

const stripMd = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\[(\d+)\]/g, "").trim();

/** `- **Term**: meaning` lines → entries. Lines that do not match are ignored. */
export function parseGlossary(text: string): Array<{ term: string; meaning: string }> {
  const out: Array<{ term: string; meaning: string }> = [];
  for (const line of text.split("\n")) {
    const m = /^\s*[-*]\s+(.+?)\s*:\s+(\S.*)$/.exec(line.replace(/\*\*(.+?)\*\*:/, "**$1**: "));
    if (!m) continue;
    const term = stripMd(m[1]!);
    const meaning = stripMd(m[2]!);
    if (term && meaning) out.push({ term, meaning });
  }
  return out;
}

/**
 * Turns glossary lines into the phrases to look for. "LLM (large language model)" gives both "LLM" and
 * "large language model"; "Training / validation / test set" with a meaning of the same number of " / "
 * parts gives one entry per part; otherwise the line is a single phrase.
 */
export function glossaryEntries(lines: ReadonlyArray<{ term: string; meaning: string }>): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const { term, meaning } of lines) {
    const termParts = term.split(/\s+\/\s+/);
    const meaningParts = meaning.split(/\s+\/\s+/);
    const pairs: Array<[string, string]> =
      termParts.length > 1 && termParts.length === meaningParts.length ? termParts.map((t, i) => [t, meaningParts[i]!]) : [[term, meaning]];
    for (const [t, m] of pairs) {
      const paren = /^(.+?)\s*\((.+)\)$/.exec(t);
      const names = paren ? [paren[1]!, paren[2]!] : [t];
      for (const name of names) {
        const phrase = name.replace(/\s+/g, " ").trim();
        if (phrase.length >= 2) out.push({ phrase, meaning: m, term });
      }
    }
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One regex for all phrases, longest first, whole words, optional plural. Case-insensitive. */
export function glossaryRegex(entries: readonly GlossaryEntry[]): RegExp | null {
  if (entries.length === 0) return null;
  const alts = [...new Set(entries.map((e) => e.phrase.toLowerCase()))].sort((a, b) => b.length - a.length).map(escapeRe);
  return new RegExp(`(?<![\\w])(?:${alts.join("|")})(?:s|es)?(?![\\w])`, "gi");
}

export function meaningFor(entries: readonly GlossaryEntry[], matched: string): string | undefined {
  const m = matched.toLowerCase();
  const exact = entries.find((e) => e.phrase.toLowerCase() === m);
  if (exact) return exact.meaning;
  return entries.find((e) => m === `${e.phrase.toLowerCase()}s` || m === `${e.phrase.toLowerCase()}es`)?.meaning;
}

// ---- remark plugin ----

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

const SKIP = new Set(["code", "inlineCode", "link", "linkReference", "heading", "definition", "html"]);

/**
 * remark plugin: the first occurrence of each glossary phrase in the text it is given becomes
 * `<abbr class="gloss" data-def="meaning" tabindex="0">` (the meaning shows in a styled tooltip on hover or focus). Code, links and headings are left alone.
 */
export function remarkGlossary(entries: readonly GlossaryEntry[]) {
  const re = glossaryRegex(entries);
  return () => (tree: MdNode) => {
    if (!re) return;
    const seen = new Set<string>();
    const visit = (node: MdNode) => {
      if (!node.children) return;
      const next: MdNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value) {
          next.push(...split(child.value));
        } else {
          if (!SKIP.has(child.type)) visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    const split = (value: string): MdNode[] => {
      const parts: MdNode[] = [];
      let last = 0;
      re.lastIndex = 0;
      for (let m = re.exec(value); m; m = re.exec(value)) {
        const key = m[0].toLowerCase().replace(/(es|s)$/, "");
        const meaning = meaningFor(entries, m[0]);
        if (!meaning || seen.has(key)) continue;
        seen.add(key);
        if (m.index > last) parts.push({ type: "text", value: value.slice(last, m.index) });
        parts.push({
          type: "gloss",
          data: { hName: "abbr", hProperties: { className: ["gloss"], dataDef: meaning, tabIndex: 0, ariaLabel: `${m[0]}: ${meaning}` } },
          children: [{ type: "text", value: m[0] }],
        });
        last = m.index + m[0].length;
      }
      if (last === 0) return [{ type: "text", value }];
      if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
      return parts;
    };
    visit(tree);
  };
}

/** Glossary lines whose phrases never appear in the prose, so the learner can still read them. */
export function unmatchedLines(lines: ReadonlyArray<{ term: string; meaning: string }>, prose: string): Array<{ term: string; meaning: string }> {
  const text = prose.replace(/```[\s\S]*?```/g, " ");
  return lines.filter((line) => {
    const re = glossaryRegex(glossaryEntries([line]));
    return re ? !re.test(text) : false;
  });
}
