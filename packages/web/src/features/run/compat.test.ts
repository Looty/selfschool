import { describe, expect, it } from "vitest";
import { checkCompat, helperFiles, jsImports, pythonImports } from "./compat";

describe("pythonImports", () => {
  it("finds top-level modules in import and from-import lines, not in strings or relative imports", () => {
    const src = [
      "import sys, math as m",
      "from collections import Counter",
      "import numpy.linalg  # comment",
      "    import torch.nn as nn",
      "from . import sibling",
      'text = "import pandas"',
    ].join("\n");
    expect(pythonImports(src).sort()).toEqual(["collections", "math", "numpy", "sys", "torch"]);
  });
});

describe("jsImports", () => {
  it("finds import, dynamic import and require specifiers", () => {
    const src = 'import x from "./util";\nimport { y } from "node:fs";\nconst z = require("lodash");\nconst w = await import("./lazy.js");\nimport "./side";';
    expect(jsImports(src).sort()).toEqual(["./lazy.js", "./side", "./util", "lodash", "node:fs"]);
  });
});

describe("checkCompat", () => {
  const files = new Map([
    ["lab06-bigram.py", "import collections, math, random\ntext = open('input.txt').read()"],
    ["lab07-attention.py", "import numpy as np"],
    ["minigpt.py", "import math\nimport torch\nfrom torch import nn"],
    ["lab08-train.py", "import sys\nfrom minigpt import GPT"],
    ["lab01-gpt2-chat.py", "from transformers import AutoModelForCausalLM, set_seed"],
    ["main.ts", 'import { x } from "./util";\nconsole.log(x);'],
    ["util.ts", "export const x = 1;"],
    ["server.ts", 'import fs from "node:fs";\nimport express from "express";'],
  ]);

  it("standard library and Pyodide packages run in the browser", () => {
    expect(checkCompat("lab06-bigram.py", files)).toEqual({ ok: true });
    expect(checkCompat("lab07-attention.py", files)).toEqual({ ok: true });
  });

  it("follows the lesson's own modules to what they need (lab08 -> minigpt -> torch)", () => {
    expect(checkCompat("lab08-train.py", files)).toEqual({ ok: false, needs: ["torch"] });
    expect(checkCompat("lab01-gpt2-chat.py", files)).toEqual({ ok: false, needs: ["transformers"] });
  });

  it("JS/TS: local imports are fine, Node and npm modules need a computer", () => {
    expect(checkCompat("main.ts", files)).toEqual({ ok: true });
    expect(checkCompat("server.ts", files)).toEqual({ ok: false, needs: ["express", "fs"] });
  });

  it("helpers are the files another file imports", () => {
    expect([...helperFiles(files)].sort()).toEqual(["minigpt.py", "util.ts"]);
  });
});
