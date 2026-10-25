import { describe, expect, it } from "vitest";
import {
  CHAT_GRADE, GENERATE_VERIFY, formatBytes, initialFont, initialTextSize, initialThemeChoice, initialWidth, modelChoices, packageBody, pairPatch, pairState, resolveTheme, validatePackageForm,
} from "./prefs";

const models = { chat: "haiku", grade: "haiku", generate: "sonnet", verify: "opus" };

describe("theme", () => {
  it("resolves system via the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("keeps a stored choice that matches the applied theme", () => {
    expect(initialThemeChoice("system", "dark", true)).toBe("system");
    expect(initialThemeChoice("light", "light", true)).toBe("light");
  });
  it("falls back to the applied theme when the top-bar toggle overrode the choice", () => {
    expect(initialThemeChoice("system", "light", true)).toBe("light");
    expect(initialThemeChoice(null, "dark", false)).toBe("dark");
    expect(initialThemeChoice("bogus", "dark", false)).toBe("dark");
  });
  it("defaults the reading font to serif", () => {
    expect(initialFont(null)).toBe("serif");
    expect(initialFont("sans")).toBe("sans");
    expect(initialFont("comic")).toBe("serif");
  });
  it("keeps the text size between the default (the minimum) and the maximum", () => {
    expect(initialTextSize(null)).toBe(17);
    expect(initialTextSize("20")).toBe(20);
    expect(initialTextSize("12")).toBe(17);
    expect(initialTextSize("99")).toBe(28);
    expect(initialTextSize("big")).toBe(17);
  });
  it("defaults the content width to medium", () => {
    expect(initialWidth(null)).toBe("medium");
    expect(initialWidth("wide")).toBe("wide");
    expect(initialWidth("narrow")).toBe("narrow");
    expect(initialWidth("huge")).toBe("medium");
  });
});

describe("model selects", () => {
  it("reads a pair and flags mixed values", () => {
    expect(pairState(models, CHAT_GRADE)).toEqual({ value: "haiku", mixed: false });
    expect(pairState(models, GENERATE_VERIFY)).toEqual({ value: "sonnet", mixed: true });
  });
  it("writes both slots of a pair", () => {
    expect(pairPatch(CHAT_GRADE, "sonnet")).toEqual({ chat: "sonnet", grade: "sonnet" });
    expect(pairPatch(GENERATE_VERIFY, "opus")).toEqual({ generate: "opus", verify: "opus" });
  });
  it("keeps the current model selectable", () => {
    expect(modelChoices(["haiku", "sonnet"], "haiku")).toEqual(["haiku", "sonnet"]);
    expect(modelChoices(["haiku", "sonnet"], "legacy")).toEqual(["legacy", "haiku", "sonnet"]);
    expect(modelChoices(undefined, "x")).toEqual(["x"]);
  });
});

describe("add package form", () => {
  it("validates the url", () => {
    expect(validatePackageForm({ url: "  ", path: "", ref: "main" })).toMatch(/Enter/);
    expect(validatePackageForm({ url: "a b", path: "", ref: "" })).toMatch(/spaces/);
    expect(validatePackageForm({ url: "github.com/a/b", path: "", ref: "" })).toBeNull();
  });
  it("trims and defaults the ref", () => {
    expect(packageBody({ url: " github.com/a/b ", path: " courses/x ", ref: " " })).toEqual({ url: "github.com/a/b", path: "courses/x", ref: "main" });
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(482_816)).toBe("471.5 KB");
    expect(formatBytes(14.2 * 1024 * 1024)).toBe("14.2 MB");
  });
});
