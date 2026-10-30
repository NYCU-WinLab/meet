import type { Action } from "@/lib/actions/define"
import {
  cancelScheduledRoom,
  createRoomAction,
  endRoom,
  joinRoom,
  listGroups,
  listRooms,
  scheduleRoom,
  updateScheduledRoom,
} from "@/lib/actions/rooms"
import { dashboard } from "@/lib/actions/dashboard"
import { whoami } from "@/lib/actions/users"

/** Every action, in the order MCP lists them. */
export const actions: Action[] = [
  whoami,
  listRooms,
  listGroups,
  createRoomAction,
  scheduleRoom,
  updateScheduledRoom,
  cancelScheduledRoom,
  joinRoom,
  endRoom,
  dashboard,
]
