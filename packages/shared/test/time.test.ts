import { describe, expect, it } from "vitest";
import { formatDuration, lessonMinutes, quizMinutes } from "../src/time.js";

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

describe("lessonMinutes", () => {
  it("is 200 words a minute, rounded up, never below 1", () => {
    expect(lessonMinutes("")).toBe(1);
    expect(lessonMinutes(words(200))).toBe(1);
    expect(lessonMinutes(words(201))).toBe(2);
    expect(lessonMinutes(words(1000))).toBe(5);
  });

  it("times code by line instead of by word, ignoring blank lines", () => {
    const code = "```ts\n" + Array.from({ length: 20 }, (_, i) => `const a${i} = ${i};`).join("\n") + "\n\n```";
    expect(lessonMinutes(`${words(200)}\n\n${code}`)).toBe(3); // 1 min prose + 20 lines * 6 s = 2 min
  });

  it("adds 15 seconds per image and does not count markup, directive fences or URLs as words", () => {
    expect(lessonMinutes(words(200) + "\n" + "![d](../x.png)\n".repeat(4))).toBe(2);
    const marked = `:::key-takeaways\n- ${words(100)}\n:::\n[${words(100)}](https://example.com/${"a".repeat(500)})`;
    expect(lessonMinutes(marked)).toBe(1);
  });
});

describe("quizMinutes", () => {
  it("allows 45 s per choice question, 1 min per short answer, 4 min per written answer", () => {
    expect(quizMinutes([{ type: "mcq" }, { type: "mcq" }, { type: "short" }, { type: "open" }])).toBe(7); // 1.5 + 1 + 4 = 6.5
    expect(quizMinutes([])).toBe(0);
  });
});

describe("formatDuration", () => {
  it("shows minutes under an hour and rounds longer spans to 5 minutes", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(42)).toBe("42 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(137)).toBe("2 h 15 min");
    expect(formatDuration(14 * 60 + 2)).toBe("14 h");
  });
});
