import { SpanStatusCode, trace } from "@opentelemetry/api"
import { logs, SeverityNumber } from "@opentelemetry/api-logs"

/** An expected refusal with a member-facing message: not a service fault, so
 * its span stays unset instead of ERROR. */
export class RefusalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RefusalError"
  }
}

const tracer = trace.getTracer("meet")
const logger = logs.getLogger("meet")

/** An error as a log record; a no-op until instrumentation registers. */
export function emitErrorLog(
  error: unknown,
  attributes: Record<string, string | number | boolean | undefined>
) {
  logger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: error instanceof Error ? error.message : String(error),
    attributes: {
      ...attributes,
      "exception.type": error instanceof Error ? error.name : typeof error,
    },
  })
}

/**
 * Runs fn in a span: name, outcome and duration, plus the attributes given
 * (ids and counts only, never member content or secrets).
 */
export async function traced<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn()
    } catch (error) {
      span.recordException(error as Error)
      // Refusals and bad input are the caller's mistake, not a fault.
      const expected =
        error instanceof RefusalError || (error as Error)?.name === "ZodError"
      if (!expected) span.setStatus({ code: SpanStatusCode.ERROR })
      else span.setAttribute("action.refused", true)
      span.setAttribute(
        "error.message",
        error instanceof Error ? error.message : String(error)
      )
      throw error
    } finally {
      span.end()
    }
  })
}
