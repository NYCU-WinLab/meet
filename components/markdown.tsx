import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

// Meeting notes are Markdown written by the transcribe summary. Render it
// with the two type sizes the design allows: headings are body size and
// bold, so a note never shouts louder than the page title.
const components: Components = {
  h1: ({ children }) => (
    <h3 className="mt-6 font-semibold first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-6 font-semibold first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-4 font-semibold first:mt-0">{children}</h4>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 font-semibold first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="mt-3 first:mt-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mt-3 list-disc pl-6 first:mt-0 [&_ol]:mt-1 [&_ul]:mt-1">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 list-decimal pl-6 first:mt-0 [&_ol]:mt-1 [&_ul]:mt-1">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="mt-1 first:mt-0">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-3 border-l-2 pl-4 text-muted-foreground first:mt-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="bg-muted px-1 font-mono">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mt-3 overflow-x-auto bg-muted p-4 first:mt-0 [&_code]:p-0">
      {children}
    </pre>
  ),
  // The notes come from a model, so an image could point anywhere and load
  // on page open. Show it as a link the member clicks instead.
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <a href={src} target="_blank" rel="noreferrer" className="underline">
        {alt || src}
      </a>
    ) : null,
  hr: () => <hr className="mt-6 first:mt-0" />,
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto first:mt-0">
      <table className="w-full border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b px-3 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b px-3 py-2">{children}</td>,
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
