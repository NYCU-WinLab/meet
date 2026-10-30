"use server"

import { errorMessage, runAction } from "@/lib/actions/define"
import { createRoomAction, endRoom } from "@/lib/actions/rooms"
import { requireActor } from "@/lib/auth/session"

// The writes a page makes, each one an action run as the signed-in member.
// Errors come back as a message for a toast, never thrown into the page.
export async function createRoom(title: string, group?: string) {
  const actor = await requireActor("/")
  try {
    return {
      ok: true as const,
      ...(await runAction(createRoomAction, actor, { title, group })),
    }
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) }
  }
}

export async function endRoomAction(name: string) {
  const actor = await requireActor("/")
  try {
    await runAction(endRoom, actor, { name })
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) }
  }
}
