import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomUUID } from "node:crypto";
import { buildSiteAssistantSystemPrompt } from "../server/site-assistant-knowledge.js";
import { VOICE_CHANNEL_APPEND } from "../shared/voice-prompts.js";

const DEFAULT_REALTIME_MODEL = "gpt-realtime";
const DEFAULT_REALTIME_VOICE = "marin";
const MAX_OPENAI_SESSION_ATTEMPTS = 2;

type JsonMap = Record<string, unknown>;

function asJsonMap(value: unknown): JsonMap {
  return typeof value === "object" && value !== null ? (value as JsonMap) : {};
}

function toIsoOrEmpty(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return "";
}

function elapsedMs(startNs: bigint): number {
  return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}

function shouldRetryOpenAiRequest(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAtNs = process.hrtime.bigint();
  const requestId = randomUUID();

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Request-Id", requestId);

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL;
  const voice = process.env.OPENAI_REALTIME_VOICE?.trim() || DEFAULT_REALTIME_VOICE;

  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      requestId,
      serverTime: new Date().toISOString(),
      configured: {
        openaiApiKey: Boolean(apiKey),
      },
      defaults: {
        model,
        voice,
      },
      timingsMs: {
        total: Number(elapsedMs(startedAtNs).toFixed(2)),
      },
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({
      error: "method_not_allowed",
      requestId,
      timingsMs: {
        total: Number(elapsedMs(startedAtNs).toFixed(2)),
      },
    });
    return;
  }

  if (!apiKey) {
    res.status(503).json({
      error: "assistant_not_configured",
      hint: "Set OPENAI_API_KEY in Vercel project environment variables for preview/production.",
      requestId,
      debug: {
        env: {
          openaiApiKeyConfigured: false,
        },
        timingsMs: {
          total: Number(elapsedMs(startedAtNs).toFixed(2)),
        },
      },
    });
    return;
  }

  const instructionStartNs = process.hrtime.bigint();
  const instructions = `${buildSiteAssistantSystemPrompt()}${VOICE_CHANNEL_APPEND}`.trim();
  const instructionHash = createHash("sha256").update(instructions, "utf8").digest("hex").slice(0, 16);
  const instructionBuildMs = Number(elapsedMs(instructionStartNs).toFixed(2));

  const payload = {
    session: {
      type: "realtime",
      model,
      instructions,
      audio: {
        output: {
          voice,
        },
      },
    },
  };

  try {
    let raw: JsonMap = {};
    let upstreamRequestId = "";
    let openaiStatus = 0;
    let openaiMs = 0;
    let openaiAttempt = 0;

    for (let attempt = 1; attempt <= MAX_OPENAI_SESSION_ATTEMPTS; attempt += 1) {
      openaiAttempt = attempt;
      const openaiStartNs = process.hrtime.bigint();
      const openaiRes = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": `${requestId}-a${attempt}`,
        },
        body: JSON.stringify(payload),
      });
      openaiMs += Number(elapsedMs(openaiStartNs).toFixed(2));

      openaiStatus = openaiRes.status;
      upstreamRequestId = openaiRes.headers.get("x-request-id") || upstreamRequestId;
      raw = asJsonMap(await openaiRes.json().catch(() => ({})));

      if (openaiRes.ok) break;
      if (attempt >= MAX_OPENAI_SESSION_ATTEMPTS || !shouldRetryOpenAiRequest(openaiRes.status)) {
        break;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 220 * attempt));
    }

    if (openaiStatus < 200 || openaiStatus >= 300) {
      console.error("realtime-session create failed", {
        requestId,
        upstreamStatus: openaiStatus,
        upstreamRequestId,
        openaiMs,
        openaiAttempt,
        raw,
      });

      res.status(502).json({
        error: "realtime_session_failed",
        requestId,
        debug: {
          env: {
            openaiApiKeyConfigured: true,
          },
          upstreamStatus: openaiStatus,
          upstreamRequestId,
          openaiAttempt,
          upstreamErrorCode:
            typeof asJsonMap(raw.error).code === "string"
              ? (asJsonMap(raw.error).code as string)
              : "",
          upstreamErrorMessage:
            typeof asJsonMap(raw.error).message === "string"
              ? (asJsonMap(raw.error).message as string)
              : "",
          timingsMs: {
            instructionBuild: instructionBuildMs,
            openaiRequest: openaiMs,
            total: Number(elapsedMs(startedAtNs).toFixed(2)),
          },
        },
      });
      return;
    }

    const clientSecretObj = asJsonMap(raw.client_secret);
    const clientSecret =
      (typeof raw.value === "string" && raw.value) ||
      (typeof clientSecretObj.value === "string" && clientSecretObj.value) ||
      "";

    if (!clientSecret) {
      console.error("realtime-session missing client secret", {
        requestId,
        upstreamRequestId,
        raw,
      });

      res.status(502).json({
        error: "missing_client_secret",
        requestId,
        debug: {
          env: {
            openaiApiKeyConfigured: true,
          },
          upstreamRequestId,
          timingsMs: {
            instructionBuild: instructionBuildMs,
            openaiRequest: openaiMs,
            total: Number(elapsedMs(startedAtNs).toFixed(2)),
          },
        },
      });
      return;
    }

    const expiresAt =
      toIsoOrEmpty(raw.expires_at) ||
      toIsoOrEmpty(clientSecretObj.expires_at) ||
      new Date(Date.now() + 60_000).toISOString();

    const sessionId =
      (typeof raw.id === "string" && raw.id) ||
      (typeof raw.session_id === "string" && raw.session_id) ||
      (typeof clientSecretObj.id === "string" && clientSecretObj.id) ||
      (typeof asJsonMap(raw.session).id === "string" && (asJsonMap(raw.session).id as string)) ||
      "session_unknown";

    const timingsMs = {
      instructionBuild: instructionBuildMs,
      openaiRequest: openaiMs,
      total: Number(elapsedMs(startedAtNs).toFixed(2)),
    };

    console.info("realtime-session created", {
      requestId,
      sessionId,
      model,
      voice,
      timingsMs,
      upstreamRequestId,
      openaiAttempt,
    });

    res.status(200).json({
      clientSecret,
      model,
      voice,
      expiresAt,
      sessionId,
      instructionHash,
      debug: {
        requestId,
        env: {
          openaiApiKeyConfigured: true,
        },
        timingsMs,
        upstreamRequestId,
        openaiAttempt,
      },
    });
  } catch (error) {
    console.error("realtime-session error", {
      requestId,
      error,
    });

    res.status(500).json({
      error: "realtime_session_error",
      detail: error instanceof Error ? error.message : String(error),
      requestId,
      debug: {
        env: {
          openaiApiKeyConfigured: true,
        },
        timingsMs: {
          instructionBuild: instructionBuildMs,
          total: Number(elapsedMs(startedAtNs).toFixed(2)),
        },
      },
    });
  }
}
