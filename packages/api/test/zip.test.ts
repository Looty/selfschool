import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { fixtureDir, setup } from "./helpers.js";

/** Every file of the `mini` fixture, with its course id changed so it does not clash with the installed one. */
function miniFiles(id: string): Record<string, Uint8Array> {
  const root = fixtureDir("mini");
  const out: Record<string, Uint8Array> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const rel = relative(root, p).split("\\").join("/");
        out[rel] = rel === "course.yaml" ? strToU8(readFileSync(p, "utf8").replace(/^id: .*$/m, `id: ${id}`)) : new Uint8Array(readFileSync(p));
      }
    }
  };
  walk(root);
  return out;
}

const inFolder = (files: Record<string, Uint8Array>, folder: string) => Object.fromEntries(Object.entries(files).map(([k, v]) => [`${folder}/${k}`, v]));

async function post(h: ReturnType<typeof setup>, path: string, body: Uint8Array | string, name = "course.zip") {
  const res = await h.app.request(`${path}?name=${encodeURIComponent(name)}`, { method: "POST", body: body as never });
  return { status: res.status, json: (await res.json()) as any };
}

describe("course zip: preview", () => {
  it("validates the package and summarises chapters, lessons and quizzes without installing", async () => {
    const h = setup();
    const zip = zipSync(miniFiles("zipped-one"));
    const { status, json } = await post(h, "/packages/upload/preview", zip, "zipped-one.zip");
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.conflict).toBe("none");
    expect(json.checks.map((c: any) => c.ok)).toEqual([true, true, true, true]);
    expect(json.course.id).toBe("zipped-one");
    expect(json.course.lessonCount).toBeGreaterThan(0);
    expect(json.course.chapters[0].lessons[0]).toHaveProperty("title");
    expect(json.course.questionCount).toBeGreaterThan(0);
    expect((await h.get("/courses")).json.courses.map((c: any) => c.id)).not.toContain("zipped-one");
  });

  it("finds the package inside the single folder a zip-this-folder action creates", async () => {
    const h = setup();
    const { json } = await post(h, "/packages/upload/preview", zipSync(inFolder(miniFiles("zipped-two"), "my course")));
    expect(json.ok).toBe(true);
    expect(json.course.id).toBe("zipped-two");
  });

  it("reports validation problems as a failed check, with the file and message", async () => {
    const h = setup();
    const files = miniFiles("zipped-bad");
    files["c1/quiz-01.yaml"] = strToU8("id: broken\nquestions: []\n");
    const { status, json } = await post(h, "/packages/upload/preview", zipSync(files));
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.course).toBeNull();
    expect(json.checks.at(-1)).toMatchObject({ label: "Validate the package", ok: false });
    expect(json.issues.length).toBeGreaterThan(0);
    expect(json.issues[0]).toHaveProperty("file");
  });

  it("flags an id that belongs to a different source", async () => {
    const h = setup();
    await h.get("/courses"); // loads the installed `mini` course
    const { json } = await post(h, "/packages/upload/preview", zipSync(miniFiles("mini")));
    expect(json.ok).toBe(false);
    expect(json.conflict).toBe("clash");
    expect(json.checks.find((c: any) => c.label === "Course id is free").ok).toBe(false);
  });

  it("rejects things that are not a usable course zip", async () => {
    const h = setup();
    const notZip = (await post(h, "/packages/upload/preview", "hello there, not a zip")).json;
    expect(notZip.ok).toBe(false);
    expect(notZip.checks[0].detail).toMatch(/not a zip/);

    const noManifest = (await post(h, "/packages/upload/preview", zipSync({ "readme.md": strToU8("hi") }))).json;
    expect(noManifest.ok).toBe(false);
    expect(noManifest.checks[0].detail).toMatch(/course\.yaml/);

    const evil = (await post(h, "/packages/upload/preview", zipSync({ "../../evil.txt": strToU8("x"), "course.yaml": strToU8("x") }))).json;
    expect(evil.ok).toBe(false);
    expect(evil.checks[0].detail).toMatch(/unsafe path/);
  });
});

describe("repo / folder preview (same checks as a zip)", () => {
  it("runs the same checks and summary for a local folder, and installs nothing", async () => {
    const h = setup();
    const res = await h.post("/packages/preview", { url: fixtureDir("mini"), path: "", ref: "main" });
    expect(res.status).toBe(200);
    expect(res.json.checks.map((c: any) => c.label)).toEqual(["Fetch the package", "Find course.yaml", "Validate the package", "Course id is free"]);
    expect(res.json.course.chapters.length).toBeGreaterThan(0);
    expect(res.json.fileCount).toBeGreaterThan(0);
  });

  it("reports a bad source as a failed check instead of an error", async () => {
    const h = setup();
    const res = await h.post("/packages/preview", { url: "http://example.com/x.git", path: "", ref: "main" });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(false);
    expect(res.json.checks[0]).toMatchObject({ label: "Fetch the package", ok: false });
  });
});

describe("course zip: install", () => {
  it("adds the course, lists it as a package, and lets a newer zip of it replace it", async () => {
    const dir = (await import("./helpers.js")).miniCourses();
    const h = setup({ coursesDir: dir });
    const first = await post(h, "/packages/upload", zipSync(miniFiles("zipped-three")), "three.zip");
    expect(first.status).toBe(200);
    expect(first.json.id).toBe("zipped-three");
    expect(first.json.url).toBe("zip:three.zip");
    expect(existsSync(join(dir, "zipped-three", "course.yaml"))).toBe(true);
    expect((await h.get("/courses")).json.courses.map((c: any) => c.id)).toContain("zipped-three");

    const again = await post(h, "/packages/upload/preview", zipSync(miniFiles("zipped-three")), "three-v2.zip");
    expect(again.json.conflict).toBe("update");
    expect((await post(h, "/packages/upload", zipSync(miniFiles("zipped-three")), "three-v2.zip")).status).toBe(200);
  });

  it("refuses an id that belongs to a different source, and leaves no temp folders behind", async () => {
    const dir = (await import("./helpers.js")).miniCourses();
    const h = setup({ coursesDir: dir });
    await h.get("/courses");
    const res = await post(h, "/packages/upload", zipSync(miniFiles("mini")));
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/already installed/);
    expect(readdirSync(dir).filter((n) => n.startsWith("."))).toEqual([]);
  });

  it("answers 422 for an invalid package", async () => {
    const h = setup();
    const res = await post(h, "/packages/upload", zipSync({ "course.yaml": strToU8("title: nothing") }));
    expect(res.status).toBe(422);
  });
});
