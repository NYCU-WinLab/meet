// The @agent replies in the meeting chat.
import type { LocalParticipant } from "@livekit/rtc-node"

// What @livekit/components-react's useChat sends on.
export const CHAT_TOPIC = "lk.chat"
// The meeting page names a chat message carrying this attribute "agent":
// the agent is hidden, so the page cannot look its name up.
export const AGENT_ATTRIBUTE = "meet.agent"

/** Sends one reply on the chat. With `to`, only those identities receive it:
 * LiveKit sends a message without destinations to everyone it has admitted,
 * including people the agent has not seen join yet. An empty `to` sends
 * nothing, since LiveKit would read it as everyone. */
export async function sendReply(
  participant: Pick<LocalParticipant, "sendText"> | undefined,
  text: string,
  to?: string[]
) {
  if (to && to.length === 0) return
  await participant?.sendText(text, {
    topic: CHAT_TOPIC,
    attributes: { [AGENT_ATTRIBUTE]: "1" },
    ...(to ? { destinationIdentities: [...to] } : {}),
  })
}
