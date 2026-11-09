"use server"

import { errorMessage, runAction } from "@/lib/actions/define"
import {
  createRoomAction,
  endRoom,
  moderateParticipant,
} from "@/lib/actions/rooms"
import { createGuestLink, joinAsGuest } from "@/lib/actions/guests"
import { requireActor } from "@/lib/auth/session"

// The writes a page makes, each one an action run as the signed-in member.
// Errors come back as a message for a toast, never thrown into the page.
export async function createRoom(
  title: string,
  group?: string,
  agenda?: string[]
) {
  const actor = await requireActor("/")
  try {
    return {
      ok: true as const,
      ...(await runAction(createRoomAction, actor, { title, group, agenda })),
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

export async function moderateAction(
  name: string,
  identity: string,
  action: "mute_mic" | "stop_camera" | "lower_hand" | "remove"
) {
  const actor = await requireActor(`/r/${name}`)
  try {
    await runAction(moderateParticipant, actor, { name, identity, action })
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) }
  }
}

export async function createGuestLinkAction(
  name: string,
  hours: number,
  label?: string
) {
  const actor = await requireActor(`/r/${name}`)
  try {
    const link = await runAction(createGuestLink, actor, {
      name,
      hours,
      label,
    })
    return { ok: true as const, url: link.url, expiresAt: link.expiresAt }
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) }
  }
}

// The one write a person without an account makes: the secret in their
// guest link is the check, so there is no actor to require.
export async function joinAsGuestAction(secret: string, name: string) {
  try {
    return {
      ok: true as const,
      joined: await runAction(
        joinAsGuest,
        { userId: "", via: "web" },
        { secret, name }
      ),
    }
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) }
  }
}
