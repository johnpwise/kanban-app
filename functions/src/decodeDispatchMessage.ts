import { dispatchMessageSchema } from "./schemas/dispatchMessage";

import type { DispatchMessage } from "./schemas/dispatchMessage";

/**
 * A permanent (never-retry) validation failure: malformed JSON, a schema violation, or the
 * message's Pub/Sub attributes disagreeing with its body. Deliberately carries only a short,
 * fixed `reason` string — never the raw body or attributes — so callers can log safely without
 * re-deriving what is safe to include.
 */
export class DispatchMessageValidationError extends Error {
  constructor(public readonly reason: string) {
    super(`ADA dispatch message failed validation: ${reason}`);
    this.name = "DispatchMessageValidationError";
  }
}

/**
 * Decodes a Pub/Sub message's base64 `data` as UTF-8 JSON, validates it against
 * `dispatchMessageSchema`, and cross-checks the message's attributes against the validated body.
 * Never trusts an identifier found only in attributes: the body is the source of truth, and
 * attributes are checked for agreement only.
 */
export function decodeDispatchMessage(data: string, attributes: Record<string, string>): DispatchMessage {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    throw new DispatchMessageValidationError("message body is not valid JSON");
  }

  const result = dispatchMessageSchema.safeParse(json);
  if (!result.success) {
    throw new DispatchMessageValidationError("message body failed schema validation");
  }

  const message = result.data;
  const attributesAgree =
    attributes.schemaVersion === String(message.schemaVersion) &&
    attributes.eventType === message.eventType &&
    attributes.executionRequestId === message.executionRequestId &&
    attributes.correlationId === message.correlationId;

  if (!attributesAgree) {
    throw new DispatchMessageValidationError("message attributes disagree with the validated body");
  }

  return message;
}
