import type { Action } from "@/lib/actions/define"
import {
  createRoomAction,
  endRoom,
  joinRoom,
  listGroups,
  listRooms,
} from "@/lib/actions/rooms"
import { dashboard } from "@/lib/actions/dashboard"
import { whoami } from "@/lib/actions/users"

/** Every action, in the order MCP lists them. */
export const actions: Action[] = [
  whoami,
  listRooms,
  listGroups,
  createRoomAction,
  joinRoom,
  endRoom,
  dashboard,
]
