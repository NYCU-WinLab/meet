/** The summary service's LiveKit identity in every room (summary/src/main.ts):
 * the only sender whose summary and captions the meeting page shows. */
export const SUMMARY_IDENTITY = "summary"

/** Whether a text stream came from the summary service. The service joins
 * hidden, so streams from it arrive with an empty sender identity; every
 * visible sender, guests included, has its own identity and is refused. */
export function fromSummary(identity: string | undefined): boolean {
  return !identity || identity === SUMMARY_IDENTITY
}
