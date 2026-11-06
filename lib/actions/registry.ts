import type { Action } from "@/lib/actions/define"
import {
  cancelScheduledRoom,
  createRoomAction,
  endRoom,
  joinRoom,
  listGroups,
  listRooms,
  moderateParticipant,
  scheduleRoom,
  updateScheduledRoom,
} from "@/lib/actions/rooms"
import { recordAiUsage } from "@/lib/actions/ai-usage"
import { dashboard } from "@/lib/actions/dashboard"
import {
  fileRecording,
  getRecording,
  listMyRecordings,
  recordingFile,
  recordingGaps,
} from "@/lib/actions/recordings"
import { memberAvatar, whoami } from "@/lib/actions/users"

/** Every action, in the order MCP lists them. */
export const actions: Action[] = [
  whoami,
  memberAvatar,
  listRooms,
  listGroups,
  createRoomAction,
  scheduleRoom,
  updateScheduledRoom,
  cancelScheduledRoom,
  joinRoom,
  moderateParticipant,
  endRoom,
  dashboard,
  recordAiUsage,
  recordingGaps,
  fileRecording,
  listMyRecordings,
  getRecording,
  recordingFile,
]
