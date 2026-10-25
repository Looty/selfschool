import type { Draft } from "./state";

export type TemplatePart = { text: string } | { slot: number };

/** Splits a fill template into literal text and 1-based slots, in reading order. */
export function parseTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{\{(\d+)\}\}/g)) {
    if (m.index > last) parts.push({ text: template.slice(last, m.index) });
    parts.push({ slot: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

export const slotCount = (template: string): number => parseTemplate(template).filter((p) => "slot" in p).length;

/** A template with no text outside its slots is an ordering question and is laid out as numbered rows. */
export const isOrdering = (template: string): boolean => parseTemplate(template).every((p) => "slot" in p || !p.text.trim());

/** Monospace for templates that read as code, the body font for prose. */
export const looksLikeCode = (template: string): boolean =>
  parseTemplate(template).some((p) => "text" in p && /[{}();=<>[\]]/.test(p.text));

/** Chip ids per slot (index 0 = slot 1), null while empty. */
export const slotsOf = (d: Draft, count: number): (number | null)[] => Array.from({ length: count }, (_, i) => d.slots?.[i] ?? null);

/** Puts a chip in a slot; a chip lives in one place, so it leaves any slot it was in, and a displaced chip returns to the bank. */
export function placeChip(d: Draft, count: number, chip: number, slot: number): Draft {
  const slots = slotsOf(d, count).map((c) => (c === chip ? null : c));
  slots[slot] = chip;
  return { ...d, slots };
}

export function clearSlot(d: Draft, count: number, slot: number): Draft {
  const slots = slotsOf(d, count);
  slots[slot] = null;
  return { ...d, slots };
}

export const isFilled = (d: Draft, count: number): boolean => slotsOf(d, count).every((c) => c !== null);
