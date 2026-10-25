import { describe, expect, it } from "vitest";
import { loadConfig, runLoop, type ProviderAdapter } from "../src/index.js";

describe("runLoop", () => {
  it("polls, runs the job through the adapter and posts the result", async () => {
    const ac = new AbortController();
    const posted: { url: string; body: unknown }[] = [];
    let served = false;

    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.includes("/jobs/next")) {
        if (served) {
          await new Promise((r) => setTimeout(r, 5));
          return new Response(null, { status: 204 });
        }
        served = true;
        return Response.json({
          id: "j1",
          kind: "grade",
          attempts: 1,
          payload: { question: { id: "q", text: "t", rubric: "r" }, answer: "a" },
        });
      }
      posted.push({ url, body: JSON.parse(String(init?.body)) });
      ac.abort();
      return Response.json({ status: "done" });
    }) as unknown as typeof fetch;

    const adapter: ProviderAdapter = {
      name: "stub",
      toolsDisabled: true,
      run: async () => ({ text: '{"score":0.5,"correct":false,"feedback":"half"}', costUsd: 0, permissionDenials: [] }),
    };

    await runLoop({ cfg: loadConfig({ SELFSCHOOL_API_URL: "http://api.test" }), adapter, signal: ac.signal, fetchImpl });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toBe("http://api.test/jobs/j1/result");
    expect(posted[0]?.body).toMatchObject({ ok: true, result: { score: 0.5, correct: false, feedback: "half" } });
  });

  it("refuses to start with an adapter that cannot disable tools", async () => {
    const adapter: ProviderAdapter = { name: "bad", toolsDisabled: false, run: async () => { throw new Error("no"); } };
    await expect(runLoop({ cfg: loadConfig({}), adapter, signal: new AbortController().signal })).rejects.toThrow(/disable tools/);
  });
});
