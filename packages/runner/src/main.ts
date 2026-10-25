#!/usr/bin/env node
import { createAdapter, loadConfig, runLoop } from "./index.js";

const cfg = loadConfig();
const ac = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => ac.abort());

await runLoop({ cfg, adapter: createAdapter(cfg), signal: ac.signal, log: (m) => console.log(`[runner] ${m}`) });
