/** The summary service's LiveKit identity in every room (summary/src/main.ts):
 * the only sender whose summary and captions the meeting page shows. */
export const SUMMARY_IDENTITY = "summary"

/** Whether a text stream came from the summary service. The service joins
 * hidden, so streams from it arrive with an empty sender identity; every
 * visible sender, guests included, has its own identity and is refused. */
export function fromSummary(identity: string | undefined): boolean {
  return !identity || identity === SUMMARY_IDENTITY
}

/** A member joins each room once per device, as `<meet user id>.<device>`,
 * so a laptop and a phone can sit in the same meeting. This is the member
 * behind a LiveKit identity; guests, egress and the summary service have
 * no dot and come back unchanged. */
export function memberOf(identity: string): string {
  const dot = identity.indexOf(".")
  return dot < 0 ? identity : identity.slice(0, dot)
}

/** A fresh identity for one member's device in one room. */
export function deviceIdentity(memberId: string): string {
  return `${memberId}.${crypto.randomUUID().slice(0, 8)}`
}
