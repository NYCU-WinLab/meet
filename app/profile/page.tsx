import Link from "next/link"

import { FieldList, FieldRow } from "@/components/field-list"
import { MeetShell } from "@/components/meet-shell"
import { PageHeader } from "@/components/page-header"
import { runAction } from "@/lib/actions/define"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"

import { SignOutButton } from "./sign-out-button"

export const dynamic = "force-dynamic"

const links = [{ label: "播過的歌", href: "/played" }]

export default async function ProfilePage() {
  const actor = await requireActor("/profile")
  const member = await runAction(whoami, actor, {})
  return (
    <MeetShell page={{ label: member.name, href: "/profile", tip: "" }}>
      <div className="flex flex-col gap-12">
        <PageHeader title={member.name} actions={<SignOutButton />} />
        <FieldList>
          <FieldRow label="帳號">{member.username ?? "未填"}</FieldRow>
          <FieldRow label="信箱">{member.email}</FieldRow>
        </FieldList>
        <ul className="flex flex-col">
          {links.map((link) => (
            <li key={link.href} className="border-b border-border">
              <Link
                href={link.href}
                prefetch
                className="flex min-h-14 items-center hover:text-muted-foreground"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </MeetShell>
  )
}
