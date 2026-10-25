import { describe, expect, it } from "vitest";
import { QUESTION_TYPES, QUESTION_TYPE_INFO } from "../src/questionTypes.js";
import { buildBrief } from "../src/brief.js";
import { questionSchema } from "../src/course.js";

describe("question type guidance", () => {
  it("describes exactly the types the schema accepts", () => {
    const schemaTypes = questionSchema.options.map((o) => o.shape.type.value).sort();
    expect([...QUESTION_TYPES].sort()).toEqual(schemaTypes);
  });

  it("gives every type a real description of where to use it and where not to", () => {
    for (const t of QUESTION_TYPES) {
      const i = QUESTION_TYPE_INFO[t];
      expect(i.label.trim().length).toBeGreaterThan(3);
      for (const field of [i.does, i.useFor, i.avoid]) expect(field.trim().length).toBeGreaterThan(25);
    }
    expect(QUESTION_TYPES.filter((t) => !QUESTION_TYPE_INFO[t].instant)).toEqual(["open"]);
  });

  it("is rendered into the brief, one entry per type", () => {
    const md = buildBrief({
      course: { id: "c", title: "C", description: "" }, chapters: [], quizIds: [], lastSourceNumber: 100, weakSpots: [],
      outline: { title: "T", rationale: "r", unverified: false, chapters: [{ title: "A", why: "", lessons: [{ title: "L", objective: "o", why: "" }] }] },
      budgetMinutes: 60, seed: {},
    });
    expect(md).toContain("## Choosing a question type");
    for (const t of QUESTION_TYPES) {
      expect(md).toContain(`**\`${t}\`**`);
      expect(md).toContain(QUESTION_TYPE_INFO[t].useFor);
    }
  });
});
