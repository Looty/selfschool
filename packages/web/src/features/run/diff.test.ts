import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";
import { editableText, savedBytes } from "./EditorDrawer";

describe("diffLines", () => {
  const original = "a\nb\nc\nd";
  it("an inserted line marks only that line", () => {
    expect(diffLines(original, "a\nb\nNEW\nc\nd")).toEqual({ changed: new Set([2]), count: 1 });
  });
  it("a changed line counts once (not as one removed plus one added)", () => {
    expect(diffLines(original, "a\nB\nc\nd")).toEqual({ changed: new Set([1]), count: 1 });
  });
  it("removed lines count though nothing is marked", () => {
    expect(diffLines(original, "a\nd")).toEqual({ changed: new Set(), count: 2 });
  });
  it("a stretch with more added than removed counts the added", () => {
    expect(diffLines(original, "a\nX\nY\nZ\nc\nd")).toEqual({ changed: new Set([1, 2, 3]), count: 3 });
  });
  it("separate stretches add up; no change is nothing", () => {
    expect(diffLines(original, "A\nb\nc\nD").count).toBe(2);
    expect(diffLines(original, original)).toEqual({ changed: new Set(), count: 0 });
    expect(diffLines("", "x").count).toBe(1);
  });
  it("very large inputs fall back to a line-by-line comparison", () => {
    const big = Array.from({ length: 1200 }, (_, i) => `line ${i}`).join("\n");
    const edited = big.replace("line 7\n", "line seven\n");
    expect(diffLines(big, edited)).toEqual({ changed: new Set([7]), count: 1 });
  });
});

describe("editor text and line ends", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("shows CRLF files with \\n line ends and writes them back with CRLF", () => {
    const shown = editableText(enc("a\r\nb\r\n"))!;
    expect(shown).toEqual({ text: "a\nb\n", crlf: true });
    expect(new TextDecoder().decode(savedBytes("a\nB\n", shown.crlf)!)).toBe("a\r\nB\r\n");
    // unchanged text gives back exactly the original bytes (so "edited" clears)
    expect(savedBytes(shown.text, true)).toEqual(enc("a\r\nb\r\n"));
  });
  it("keeps a byte-order mark, refuses binary, invalid UTF-8 and huge files", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("x = 1\n")]);
    expect(savedBytes(editableText(withBom)!.text, false)).toEqual(withBom);
    expect(editableText(new Uint8Array([0x00, 0x01]))).toBeNull();
    expect(editableText(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
    expect(editableText(new Uint8Array(600 * 1024).fill(0x61))).toBeNull();
    expect(savedBytes("a".repeat(600 * 1024), false)).toBeNull();
  });
});
