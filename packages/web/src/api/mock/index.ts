import type { RouteName } from "@selfschool/shared";
import { ApiError, type Transport } from "../client";
import { handlers } from "./handlers";
import { createDb, type MockDb } from "./state";

let db: MockDb | undefined;

/** Resets the in-memory state (tests, and `window.__mockReset()` while developing). */
export function resetMock(): MockDb {
  db = createDb();
  return db;
}

/**
 * In-memory stand-in for the api, enabled with VITE_MOCK=1. Same signature as the http transport;
 * `?ai=paused` in the URL simulates a stopped runner. Latency is small but non-zero so loading
 * states are visible.
 */
export const mockTransport: Transport = async (name: RouteName, input) => {
  db ??= createDb();
  await new Promise((r) => setTimeout(r, 80));
  const handler = handlers[name] as ((i: unknown, d: MockDb) => unknown) | undefined;
  if (!handler) throw new ApiError(404, `no mock for ${name}`);
  return structuredClone(await handler(input, db));
};

if (typeof window !== "undefined") (window as unknown as { __mockReset: () => void }).__mockReset = () => void resetMock();
