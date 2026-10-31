import { MeetShell } from "@/components/meet-shell"
import { PageHeader } from "@/components/page-header"
import { runAction } from "@/lib/actions/define"
import { listGroups, listRooms } from "@/lib/actions/rooms"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"

import { CreateRoom } from "./create-room"
import { RoomList } from "./room-list"

export const dynamic = "force-dynamic"

export default async function Home() {
  const actor = await requireActor("/")
  const [{ rooms, maxRooms, scheduled }, { groups }, me] = await Promise.all([
    runAction(listRooms, actor, {}),
    runAction(listGroups, actor, {}).catch(() => ({ groups: [] })),
    runAction(whoami, actor, {}),
  ])
  return (
    <MeetShell>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="會議室"
          actions={
            <CreateRoom
              groups={groups}
              self={me.username ?? me.name}
              full={rooms.length >= maxRooms}
            />
          }
        />
        <RoomList rooms={rooms} scheduled={scheduled} />
      </div>
    </MeetShell>
  )
}
