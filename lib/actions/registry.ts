import type { Action } from "@/lib/actions/define"
import {
  createRoomAction,
  endRoom,
  joinRoom,
  listRooms,
} from "@/lib/actions/rooms"
import { whoami } from "@/lib/actions/users"

/** Every action, in the order MCP lists them. */
export const actions: Action[] = [
  whoami,
  listRooms,
  createRoomAction,
  joinRoom,
  endRoom,
]
