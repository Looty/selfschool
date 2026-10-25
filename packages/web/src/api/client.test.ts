import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("callApi", () => {
  it("routes through the mock transport when VITE_MOCK=1 and returns schema-parsed data", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const { callApi } = await import("./client");
    const d = await callApi("dashboard");
    expect(d.courses.length).toBeGreaterThan(0);
    const lesson = await callApi("lesson", { params: { courseId: "typescript-fundamentals", lessonId: "l06" } });
    expect(lesson.lesson.title).toBe("Type guards");
    expect(lesson.standfirst.length).toBeGreaterThan(20);
  });

  it("surfaces api errors with their status", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const { callApi, ApiError } = await import("./client");
    await expect(callApi("course", { params: { courseId: "nope" } })).rejects.toBeInstanceOf(ApiError);
  });

  it("http transport builds /api paths and sends JSON bodies", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ retired: true });
    });
    const { httpTransport } = await import("./client");
    await httpTransport("reportQuestion", { params: { questionId: "x 1" }, body: { reason: "wrong key" } });
    expect(calls[0]?.url).toBe("/api/questions/x%201/report");
    expect(calls[0]?.init).toMatchObject({ method: "POST", body: JSON.stringify({ reason: "wrong key" }) });
    vi.unstubAllGlobals();
  });
});
