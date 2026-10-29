import { MeetShell } from "@/components/meet-shell"
import { PageHeader } from "@/components/page-header"
import { runAction } from "@/lib/actions/define"
import { listRooms } from "@/lib/actions/rooms"
import { requireActor } from "@/lib/auth/session"

import { CreateRoom } from "./create-room"
import { RoomList } from "./room-list"

export const dynamic = "force-dynamic"

export default async function Home() {
  const actor = await requireActor("/")
  const { rooms } = await runAction(listRooms, actor, {})
  return (
    <MeetShell>
      <div className="flex flex-col gap-12">
        <PageHeader title="會議室" actions={<CreateRoom />} />
        <RoomList rooms={rooms} />
      </div>
    </MeetShell>
  )
}
