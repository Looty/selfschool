import { isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Lesson } from "@selfschool/shared";
import { apiHref } from "../../basePath";
import { CodeBlock } from "../../components/code/CodeBlock";
import { TextLink } from "../../components/TextLink";
import { remarkGlossary, type GlossaryEntry } from "./glossary";
import { linkCitations, slugify } from "./markdown";

type LessonResource = Lesson["resources"][number];

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** The code and language of a fenced block (react-markdown passes `<pre><code class="language-x">`). */
function fenced(children: ReactNode): { code: string; lang: string | undefined } | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null;
  return { code: textOf(child.props.children).replace(/\n$/, ""), lang: /language-([\w+-]+)/.exec(child.props.className ?? "")?.[1] };
}

const components: Components = {
  pre({ children }) {
    const block = fenced(children);
    return block ? <CodeBlock code={block.code} lang={block.lang} /> : <pre>{children}</pre>;
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
    return <TextLink href={href}>{children}</TextLink>;
  },
  h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={slugify(textOf(children))}>{children}</h3>,
  // Raw HTML is never rendered; images are not part of the lesson format.
  img: () => null,
};

/**
 * Inline code naming one of the lesson's resources (`lab01.py`) becomes its download link, so nobody has to find the
 * Resources list first. (Running it is the lesson's Lab card: one place, not a button at every mention.)
 */
function withResources(resources: readonly LessonResource[]): Components {
  const byName = new Map(resources.map((r) => [r.name, r.url]));
  return {
    ...components,
    code({ className, children }) {
      const url = byName.get(textOf(children));
      if (!url) return <code className={className}>{children}</code>;
      return (
        <a href={apiHref(url, import.meta.env.BASE_URL)} download title="Download">
          <code className={className}>{children}</code>
        </a>
      );
    },
  };
}

/**
 * Safe lesson markdown: no raw HTML (react-markdown drops it), URLs sanitised by the library,
 * `[n]` rewritten to citation links for the sources that exist.
 */
export function Markdown({
  text,
  sources,
  glossary,
  resources,
}: {
  text: string;
  sources: ReadonlySet<number>;
  glossary?: readonly GlossaryEntry[];
  resources?: readonly LessonResource[];
}) {
  const md = useMemo(() => linkCitations(text, sources), [text, sources]);
  // The first use of each glossary term gets a dotted underline and its plain-words meaning as a native tooltip.
  const plugins = useMemo(() => (glossary && glossary.length > 0 ? [remarkGfm, remarkGlossary(glossary)] : [remarkGfm]), [glossary]);
  const comps = useMemo(() => (resources && resources.length > 0 ? withResources(resources) : components), [resources]);
  return (
    <ReactMarkdown remarkPlugins={plugins} components={comps}>
      {md}
    </ReactMarkdown>
  );
}
