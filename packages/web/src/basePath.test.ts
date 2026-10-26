import { describe, expect, it } from "vitest";
import { apiHref, isAppRoute, routerBasename } from "./basePath";

describe("routerBasename", () => {
  it("keeps the root as /", () => expect(routerBasename("/")).toBe("/"));
  it("drops the trailing slash of a sub-path", () => expect(routerBasename("/selfschool/")).toBe("/selfschool"));
});

describe("apiHref", () => {
  it("leaves api links alone at the root", () => expect(apiHref("/api/courses/c/files/a.pdf", "/")).toBe("/api/courses/c/files/a.pdf"));
  it("moves api links under a sub-path", () => expect(apiHref("/api/courses/c/files/a.pdf", "/selfschool/")).toBe("/selfschool/api/courses/c/files/a.pdf"));
  it("leaves other links alone", () => {
    expect(apiHref("https://example.com/api/x", "/selfschool/")).toBe("https://example.com/api/x");
    expect(apiHref("/courses/c", "/selfschool/")).toBe("/courses/c");
  });
});

describe("isAppRoute", () => {
  it("is true for root-absolute app paths", () => expect(isAppRoute("/courses/c/lessons/l")).toBe(true));
  it("is false for api, protocol-relative and external links", () => {
    expect(isAppRoute("/api/backup")).toBe(false);
    expect(isAppRoute("//example.com/x")).toBe(false);
    expect(isAppRoute("https://example.com")).toBe(false);
    expect(isAppRoute("#source-1")).toBe(false);
  });
});
