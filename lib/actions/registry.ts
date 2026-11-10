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
import {
  createGuestLink,
  guestLinkInfo,
  joinAsGuest,
  listGuestLinks,
  revokeGuestLink,
} from "@/lib/actions/guests"
import { recordAiUsage } from "@/lib/actions/ai-usage"
import {
  matchRecordingSpeakers,
  saveLiveSummary,
} from "@/lib/actions/live-summaries"
import { dashboard } from "@/lib/actions/dashboard"
import {
  fileRecording,
  getRecording,
  listMyRecordings,
  recordingFile,
  recordingGaps,
  searchRecordings,
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
  createGuestLink,
  listGuestLinks,
  revokeGuestLink,
  guestLinkInfo,
  joinAsGuest,
  dashboard,
  recordAiUsage,
  saveLiveSummary,
  matchRecordingSpeakers,
  recordingGaps,
  fileRecording,
  listMyRecordings,
  getRecording,
  searchRecordings,
  recordingFile,
]
