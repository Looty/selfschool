import { describe, expect, it } from "vitest";
import { apiPath } from "../src/apiPath.js";

describe("apiPath", () => {
  it("strips /api at the root base", () => {
    expect(apiPath("/api/courses/c/files/a.pdf", "/")).toBe("/courses/c/files/a.pdf");
    expect(apiPath("/courses/c", "/")).toBeUndefined();
  });
  it("accepts both /api and <base>api under a sub-path", () => {
    expect(apiPath("/api/backup", "/selfschool/")).toBe("/backup");
    expect(apiPath("/selfschool/api/courses/c/files/a.pdf", "/selfschool/")).toBe("/courses/c/files/a.pdf");
  });
  it("ignores the app's own pages and assets", () => {
    expect(apiPath("/selfschool/courses/c", "/selfschool/")).toBeUndefined();
    expect(apiPath("/selfschool/assets/x.js", "/selfschool/")).toBeUndefined();
    expect(apiPath("/apix/y", "/")).toBeUndefined();
  });
});
