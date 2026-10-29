import "./code.css";
import { useEffect, useState } from "react";
import { rustPlaygroundUrl } from "../../features/run/files";
import { highlight } from "./highlight";

/** Fenced code: plain text first, shiki HTML (both themes via CSS variables) once it has loaded. */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setHtml(null);
    highlight(code, lang)
      .then((h) => live && setHtml(h))
      .catch(() => live && setHtml(null));
    return () => {
      live = false;
    };
  }, [code, lang]);

  // Rust cannot compile in the browser: a complete program opens in the official playground, already filled in
  const playground = lang === "rust" ? rustPlaygroundUrl(code) : null;
  const block = (
    <div className="code-block" tabIndex={0} role="region" aria-label={lang ? `${lang} code` : "Code"}>
      {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre><code>{code}</code></pre>}
    </div>
  );
  if (!playground) return block;
  return (
    <div>
      {block}
      <div className="-mt-2 mb-4 flex justify-end text-[13px]">
        <a href={playground} target="_blank" rel="noopener noreferrer" className="text-accent no-underline hover:underline" title="Opens play.rust-lang.org with this program filled in">
          Run in Rust Playground ↗
        </a>
      </div>
    </div>
  );
}
