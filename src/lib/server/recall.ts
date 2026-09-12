import { createHmac, timingSafeEqual } from "node:crypto";
import { recallConfig } from "./env";

const SIGNATURE_AGE_SECONDS = 5 * 60;

export class RecallError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export function verifyRecallWebhook(
  body: string,
  headers: Headers,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber) || Math.abs(nowSeconds - timestampNumber) > SIGNATURE_AGE_SECONDS) {
    return false;
  }

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  return signatureHeader.split(/\s+/).some((entry) => {
    const [version, encoded] = entry.split(",", 2);
    if (version !== "v1" || !encoded) return false;
    try {
      const received = Buffer.from(encoded, "base64");
      return received.length === expected.length && timingSafeEqual(received, expected);
    } catch {
      return false;
    }
  });
}

async function recallRequest(path: string, init: RequestInit) {
  const { apiKey, region } = recallConfig();
  let response: Response;
  try {
    response = await fetch(`https://${region}.recall.ai/api/v1${path}`, {
      ...init,
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new RecallError(timedOut ? "Recall request timed out" : "Recall request failed", timedOut ? "RECALL_TIMEOUT" : "RECALL_UNAVAILABLE");
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new RecallError(`Recall returned ${response.status}${detail ? `: ${detail}` : ""}`, "RECALL_REJECTED");
  }
  if (response.status === 204) return null;
  return response.json() as Promise<unknown>;
}

export async function createRecallBot(sessionId: string, meetingUrl: string, transcriptUrl: string, mediaUrl: string) {
  const result = await recallRequest("/bot/", {
    method: "POST",
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: "MyDuo",
      metadata: { myduo_session_id: sessionId },
      recording_config: {
        transcript: {
          provider: { elevenlabs_streaming: { model_id: "scribe_v2_realtime" } },
        },
        realtime_endpoints: [{ type: "webhook", url: transcriptUrl, events: ["transcript.data"] }],
      },
      output_media: {
        camera: { kind: "webpage", config: { url: mediaUrl } },
      },
    }),
  });
  const id = typeof result === "object" && result && "id" in result ? (result as { id?: unknown }).id : null;
  if (typeof id !== "string" || !id) throw new RecallError("Recall response did not include a bot id", "RECALL_INVALID_RESPONSE");
  return id;
}

export async function removeRecallBot(botId: string) {
  // DELETE /bot/{id}/ only works for scheduled bots; a bot that has joined must leave the call instead.
  await recallRequest(`/bot/${encodeURIComponent(botId)}/leave_call/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
