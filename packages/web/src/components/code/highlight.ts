import type { HighlighterCore } from "shiki/core";

/** Languages bundled on demand; anything else renders as plain text. */
const LANGS: Record<string, () => Promise<{ default: unknown }>> = {
  ts: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  js: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
};
const ALIAS: Record<string, string> = {
  typescript: "ts", javascript: "js", sh: "bash", shell: "bash", zsh: "bash", py: "python", yml: "yaml", rs: "rust", jsonc: "json",
};

export const resolveLang = (lang: string | undefined): string | null => {
  const l = (lang ?? "").toLowerCase();
  const name = ALIAS[l] ?? l;
  return name in LANGS ? name : null;
};

let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
    ]);
    return createHighlighterCore({ themes: [light.default, dark.default], langs: [], engine: createJavaScriptRegexEngine() });
  })();
  return highlighter;
}

/**
 * Highlights `code` to HTML with both themes as CSS variables (`--shiki-light` / `--shiki-dark`),
 * so a theme switch needs no re-render. Loads shiki and the one grammar on first use.
 * Returns null for unknown languages. The HTML is produced by shiki from escaped tokens.
 */
export async function highlight(code: string, lang: string | undefined): Promise<string | null> {
  const name = resolveLang(lang);
  if (!name) return null;
  const h = await getHighlighter();
  if (!loaded.has(name)) {
    const mod = await LANGS[name]!();
    await h.loadLanguage(mod.default as never);
    loaded.add(name);
  }
  return h.codeToHtml(code, { lang: name, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false });
}
