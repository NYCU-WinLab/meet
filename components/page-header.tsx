import * as React from "react"

type HeaderProps = {
  title: React.ReactNode
  /** Buttons that act on this page's content, such as 新增. Navigation goes
   * in the app shell's corners, not here. */
  actions?: React.ReactNode
}

// The top of a page: its title on the left, the page's own actions on the
// right. No subtitle: the title says what the page is. On a phone the
// actions drop under the title.
function PageHeader({ title, actions }: HeaderProps) {
  return (
    <header
      data-slot="page-header"
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <h1 className="min-w-0 text-title font-medium">{title}</h1>
      {actions && <div className="flex shrink-0 gap-3">{actions}</div>}
    </header>
  )
}

// A section title inside a page, one step below the page title by weight.
function SectionHeader({ title, actions }: HeaderProps) {
  return (
    <div
      data-slot="section-header"
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <h2 className="min-w-0 font-semibold">{title}</h2>
      {actions && <div className="flex shrink-0 gap-3">{actions}</div>}
    </div>
  )
}

export { PageHeader, SectionHeader }
