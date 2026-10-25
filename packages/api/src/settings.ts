import { eq } from "drizzle-orm";
import { JOB_KINDS, modelsSchema, type JobKind, type Models, type Settings } from "@selfschool/shared";
import type { Ctx } from "./ctx.js";
import { settings } from "./db/schema.js";
import { HttpError } from "./util.js";

export const DEFAULT_MODELS: Models = { grade: "haiku", chat: "haiku", generate: "sonnet", verify: "sonnet" };
export const MODEL_OPTIONS = ["haiku", "sonnet", "opus"];

export function getModels(ctx: Ctx): Models {
  const row = ctx.db.select().from(settings).where(eq(settings.key, "models")).get();
  const parsed = modelsSchema.partial().safeParse(row?.value);
  return { ...DEFAULT_MODELS, ...(parsed.success ? stripUndefined(parsed.data) : {}) };
}

const stripUndefined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export function updateModels(ctx: Ctx, patch: Partial<Models>): Models {
  const clean = stripUndefined(patch);
  for (const [kind, model] of Object.entries(clean)) {
    if (!MODEL_OPTIONS.includes(model as string)) throw new HttpError(400, `unknown model "${model}" for ${kind}`);
  }
  const next = { ...getModels(ctx), ...clean };
  ctx.db
    .insert(settings)
    .values({ key: "models", value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next } })
    .run();
  return next;
}

export function settingsView(ctx: Ctx): Settings {
  const lastSeen = ctx.runnerLastSeen();
  const connected = ctx.aiAvailable();
  const size = ctx.db.$client.prepare("SELECT page_count * page_size AS size FROM pragma_page_count, pragma_page_size").get() as { size: number };
  return {
    models: getModels(ctx),
    modelOptions: Object.fromEntries(JOB_KINDS.map((k: JobKind) => [k, MODEL_OPTIONS])) as Settings["modelOptions"],
    runner: { connected, lastSeen },
    provider: { name: "Claude Code CLI", detail: connected ? "runner connected" : "runner not running" },
    database: { sizeBytes: size.size },
  };
}
