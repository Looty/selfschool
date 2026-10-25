import type { JobKind } from "@selfschool/shared";

/**
 * Jobs whose reply has one prose field worth showing while it is still being written. Only chat: a grade reply is
 * short and arrives almost at once, so streaming it adds nothing over the loading state.
 */
export const STREAM_FIELD: Partial<Record<JobKind, string>> = { chat: "answer" };

const SIMPLE_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

/**
 * The text of a JSON string field as far as it has been written so far, from a reply that is still arriving
 * (`{"covered": true, "answer": "Because the comp`). Returns null until the field has started. A half-written
 * escape (a trailing backslash or a short \\uXXXX) is left out until the rest arrives.
 */
export function streamedField(text: string, field: string): string | null {
  const start = new RegExp(`"${field}"\\s*:\\s*"`).exec(text);
  if (!start) return null;
  let out = "";
  for (let i = start.index + start[0].length; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') return out;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = text.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += SIMPLE_ESCAPES[next] ?? next;
    i++;
  }
  return out;
}
