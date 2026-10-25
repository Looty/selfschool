import { isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "../../components/code/CodeBlock";
import { remarkGlossary, type GlossaryEntry } from "./glossary";
import { linkCitations, slugify } from "./markdown";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

const components: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
      const lang = /language-([\w+-]+)/.exec(child.props.className ?? "")?.[1];
      return <CodeBlock code={textOf(child.props.children).replace(/\n$/, "")} lang={lang} />;
    }
    return <pre>{children}</pre>;
  },
  a({ href, children }) {
    if (href?.startsWith("#source-")) {
      const n = href.slice("#source-".length);
      return (
        <sup className="cite">
          <a href={href} aria-label={`Source ${n}`}>
            {children}
          </a>
        </sup>
      );
    }
    if (href?.startsWith("#")) return <a href={href}>{children}</a>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={slugify(textOf(children))}>{children}</h3>,
  // Raw HTML is never rendered; images are not part of the lesson format.
  img: () => null,
};

/**
 * Safe lesson markdown: no raw HTML (react-markdown drops it), URLs sanitised by the library,
 * `[n]` rewritten to citation links for the sources that exist.
 */
export function Markdown({ text, sources, glossary }: { text: string; sources: ReadonlySet<number>; glossary?: readonly GlossaryEntry[] }) {
  const md = useMemo(() => linkCitations(text, sources), [text, sources]);
  // The first use of each glossary term gets a dotted underline and its plain-words meaning as a native tooltip.
  const plugins = useMemo(() => (glossary && glossary.length > 0 ? [remarkGfm, remarkGlossary(glossary)] : [remarkGfm]), [glossary]);
  return (
    <ReactMarkdown remarkPlugins={plugins} components={components}>
      {md}
    </ReactMarkdown>
  );
}
