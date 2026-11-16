/**
 * Slack `chat.postMessage` returns a per-channel message timestamp of the form `<seconds>.<6-digit-micros>`.
 * Reject empty, non-string, or synthetic values so unconfirmed deliveries enter `needs_attention`.
 */
export function isSlackMessageTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*\.\d{6}$/.test(value.trim());
}
