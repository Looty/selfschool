import "./code.css";
import { useEffect, useState } from "react";
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

  return (
    <div className="code-block" tabIndex={0} role="region" aria-label={lang ? `${lang} code` : "Code"}>
      {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre><code>{code}</code></pre>}
    </div>
  );
}
