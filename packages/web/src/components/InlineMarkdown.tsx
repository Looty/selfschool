import ReactMarkdown from "react-markdown";
import { TextLink } from "./TextLink";

/** Inline-only markdown (bold, italic, code, links) for short manifest text such as course descriptions. */
export function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      allowedElements={["p", "strong", "em", "code", "a"]}
      unwrapDisallowed
      components={{
        p: ({ children }) => <>{children}</>,
        code: ({ children }) => <code className="font-mono text-[0.9em]">{children}</code>,
        a: ({ href, children }) => (
          <TextLink href={href} className="underline underline-offset-2">
            {children}
          </TextLink>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
