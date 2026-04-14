/**
 * Twilio Media Stream bridge server
 *
 * Runs as a standalone Node.js process (port 5051 by default).
 * - POST /twilio/voice  — Twilio webhook; returns TwiML that opens a Media Stream
 * - WS   /twilio/stream — Twilio Media Stream; bridges audio to/from OpenAI Realtime API
 *
 * Start: npm run dev:twilio
 * Expose publicly during development: ngrok http 5051
 * Then set your Twilio phone number's voice webhook to: https://<ngrok-url>/twilio/voice
 */

import http from "node:http";
import express, { type Request, type Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import twilio from "twilio";
import { buildSiteAssistantSystemPrompt } from "./site-assistant-knowledge.js";
import {
  OPENING_CALL_INSTRUCTIONS,
  VOICE_CHANNEL_APPEND,
} from "../shared/voice-prompts.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(
  process.env.PORT ?? process.env.TWILIO_BRIDGE_PORT ?? "5051",
  10,
);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() ?? "";
const OPENAI_MODEL =
  process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime";
const OPENAI_VOICE = process.env.OPENAI_REALTIME_VOICE?.trim() || "marin";
const OPENAI_WS_URL = `wss://api.openai.com/v1/realtime?model=${OPENAI_MODEL}`;

// ─── Audio transcoding (pure TS — no native addons) ──────────────────────────
//
// Twilio:  G.711 µ-law, 8 kHz, mono, base64-encoded
// OpenAI:  PCM16,      24 kHz, mono, base64-encoded

/** ITU-T G.711 µ-law decode: one byte → one Int16 sample */
const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

function mulawDecode(mulaw: number): number {
  const ulaw = ~mulaw & 0xff;
  const sign = ulaw & 0x80;
  const exponent = (ulaw >> 4) & 0x07;
  const mantissa = ulaw & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign !== 0 ? -sample : sample;
}

function mulawEncode(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0x00;
  let magnitude = Math.abs(sample);
  magnitude = Math.min(magnitude, MULAW_CLIP);
  magnitude += MULAW_BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (magnitude & mask) === 0 && exponent > 0; exponent -= 1) {
    mask >>= 1;
  }

  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function upsample8to24(input: Int16Array): Int16Array {
  const out = new Int16Array(input.length * 3);
  for (let i = 0; i < input.length; i++) {
    const curr = input[i]!;
    const next = i + 1 < input.length ? input[i + 1]! : curr;
    out[i * 3] = curr;
    out[i * 3 + 1] = Math.round(curr + (next - curr) / 3);
    out[i * 3 + 2] = Math.round(curr + ((next - curr) * 2) / 3);
  }
  return out;
}

/**
 * Downsample Int16Array from 24 kHz to 8 kHz (3× factor).
 * Averages each group of 3 samples before decimation — a simple anti-aliasing
 * low-pass filter that prevents high-frequency content from folding back.
 */
function downsample24to8(input: Int16Array): Int16Array {
  const outLen = Math.floor(input.length / 3);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = Math.round(
      (input[i * 3]! + input[i * 3 + 1]! + input[i * 3 + 2]!) / 3,
    );
  }
  return out;
}

/** Twilio base64 µ-law 8 kHz → base64 PCM16 24 kHz (for OpenAI input) */
function twilioAudioToOpenAI(base64Mulaw: string): string {
  const mulawBytes = Buffer.from(base64Mulaw, "base64");
  const pcm8k = new Int16Array(mulawBytes.length);
  for (let i = 0; i < mulawBytes.length; i++) {
    pcm8k[i] = mulawDecode(mulawBytes[i]!);
  }
  const pcm24k = upsample8to24(pcm8k);
  const outBuf = Buffer.allocUnsafe(pcm24k.length * 2);
  for (let i = 0; i < pcm24k.length; i++) {
    outBuf.writeInt16LE(pcm24k[i]!, i * 2);
  }
  return outBuf.toString("base64");
}

/** OpenAI base64 PCM16 24 kHz → base64 µ-law 8 kHz (for Twilio output) */
function openAIAudioToTwilio(base64Pcm24k: string): string {
  const pcmBuf = Buffer.from(base64Pcm24k, "base64");
  const sampleCount = Math.floor(pcmBuf.length / 2);
  const pcm24k = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    pcm24k[i] = pcmBuf.readInt16LE(i * 2);
  }
  const pcm8k = downsample24to8(pcm24k);
  const mulawOut = Buffer.allocUnsafe(pcm8k.length);
  for (let i = 0; i < pcm8k.length; i++) {
    mulawOut[i] = mulawEncode(pcm8k[i]!);
  }
  return mulawOut.toString("base64");
}

// ─── Per-call session state ───────────────────────────────────────────────────

type CallSession = {
  callSid: string;
  streamSid: string | null;
  openaiWs: WebSocket | null;
  openingPromptSent: boolean;
  /** Monotonically increasing counter used in Twilio mark event names */
  markCounter: number;
  /** True only while OpenAI is actively generating a response */
  responseActive: boolean;
};

function makeSession(): CallSession {
  return {
    callSid: "",
    streamSid: null,
    openaiWs: null,
    openingPromptSent: false,
    markCounter: 0,
    responseActive: false,
  };
}

function cleanup(session: CallSession): void {
  if (
    session.openaiWs &&
    (session.openaiWs.readyState === WebSocket.OPEN ||
      session.openaiWs.readyState === WebSocket.CONNECTING)
  ) {
    session.openaiWs.close();
  }
  session.openaiWs = null;
}

// ─── OpenAI Realtime API WebSocket (one per call) ────────────────────────────

function openOpenAIConnection(
  session: CallSession,
  twilioWs: WebSocket,
): void {
  const instructions =
    `${buildSiteAssistantSystemPrompt()}${VOICE_CHANNEL_APPEND}`.trim();

  const openaiWs = new WebSocket(OPENAI_WS_URL, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  session.openaiWs = openaiWs;

  openaiWs.on("open", () => {
    console.info(`[twilio-bridge] OpenAI WS open  callSid=${session.callSid}`);

    // Configure the session: PCM16 I/O, server VAD, voice and instructions
    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions,
          voice: OPENAI_VOICE,
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
          },
        },
      }),
    );

  });

  openaiWs.on("message", (raw: Buffer | string) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    handleOpenAIMessage(msg, session, twilioWs);
  });

  openaiWs.on("error", (err) => {
    console.error(
      `[twilio-bridge] OpenAI WS error callSid=${session.callSid}`,
      err,
    );
    cleanup(session);
  });

  openaiWs.on("close", () => {
    console.info(`[twilio-bridge] OpenAI WS closed callSid=${session.callSid}`);
    cleanup(session);
  });
}

function handleOpenAIMessage(
  msg: Record<string, unknown>,
  session: CallSession,
  twilioWs: WebSocket,
): void {
  switch (msg.type) {
    case "session.updated":
      if (!session.openingPromptSent && session.openaiWs?.readyState === WebSocket.OPEN) {
        session.openingPromptSent = true;
        session.openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["text", "audio"],
              instructions: OPENING_CALL_INSTRUCTIONS,
            },
          }),
        );
      }
      break;

    case "response.created":
      session.responseActive = true;
      break;

    case "response.done":
    case "response.cancelled":
      session.responseActive = false;
      break;

    case "response.audio.delta": {
      // Incremental PCM16 24 kHz audio chunk from the assistant
      const delta = msg.delta as string | undefined;
      if (!delta || !session.streamSid) break;
      if (twilioWs.readyState !== WebSocket.OPEN) break;

      twilioWs.send(
        JSON.stringify({
          event: "media",
          streamSid: session.streamSid,
          media: { payload: openAIAudioToTwilio(delta) },
        }),
      );
      break;
    }

    case "response.audio.done": {
      // Assistant finished speaking this turn — send a mark so we can detect
      // when Twilio has fully played it out (useful for future barge-in timing)
      if (!session.streamSid || twilioWs.readyState !== WebSocket.OPEN) break;
      session.markCounter += 1;
      twilioWs.send(
        JSON.stringify({
          event: "mark",
          streamSid: session.streamSid,
          mark: { name: `turn-${session.markCounter}` },
        }),
      );
      break;
    }

    case "input_audio_buffer.speech_started": {
      // Only barge-in if OpenAI is actually mid-response; ignore spurious VAD
      // triggers from line noise or silence before the first response starts.
      if (!session.responseActive) break;

      // Tell Twilio to discard any audio it hasn't played yet
      if (session.streamSid && twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(
          JSON.stringify({ event: "clear", streamSid: session.streamSid }),
        );
      }
      // Tell OpenAI to stop generating the current response
      if (session.openaiWs?.readyState === WebSocket.OPEN) {
        session.openaiWs.send(JSON.stringify({ type: "response.cancel" }));
      }
      break;
    }

    case "error": {
      const err = msg.error as Record<string, unknown> | undefined;
      // response_cancel_not_active is benign — just means we tried to cancel
      // when nothing was generating (e.g. spurious VAD before first response).
      if (err?.code !== "response_cancel_not_active") {
        console.error(
          `[twilio-bridge] OpenAI Realtime error callSid=${session.callSid}`,
          msg,
        );
      }
      break;
    }

    default:
      // session.updated, transcript events, etc. — ignore
      break;
  }
}

// ─── Express app (TwiML webhook) ──────────────────────────────────────────────

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio POSTs form-encoded bodies
app.use(express.json());

app.post("/twilio/voice", (_req: Request, res: Response) => {
  const publicUrl =
    process.env.TWILIO_BRIDGE_PUBLIC_URL?.trim().replace(/\/$/, "") ?? "";

  if (!publicUrl) {
    res.status(500).send("TWILIO_BRIDGE_PUBLIC_URL is not configured.");
    return;
  }

  // Convert https:// → wss:// for the WebSocket stream URL
  const wsUrl = publicUrl.replace(/^https?:\/\//, "wss://") + "/twilio/stream";

  const twiml = new twilio.twiml.VoiceResponse();
  twiml.connect().stream({ url: wsUrl });

  res.type("text/xml").send(twiml.toString());
  console.info(`[twilio-bridge] /twilio/voice → TwiML stream to ${wsUrl}`);
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    openaiKeyConfigured: Boolean(OPENAI_API_KEY),
    publicUrlConfigured: Boolean(process.env.TWILIO_BRIDGE_PUBLIC_URL),
  });
});

// ─── HTTP server + WebSocket server sharing the same port ─────────────────────

const server = http.createServer(app);

// noServer: true lets us route WebSocket upgrades manually by path
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const rawUrl = req.url ?? "";
  const pathname = new URL(rawUrl, "http://localhost").pathname;

  if (pathname === "/twilio/stream") {
    console.info(`[twilio-bridge] WS upgrade accepted url=${rawUrl}`);
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    console.warn(`[twilio-bridge] WS upgrade rejected url=${rawUrl}`);
    socket.destroy();
  }
});

// ─── Twilio Media Stream WebSocket handler ────────────────────────────────────

wss.on("connection", (twilioWs: WebSocket) => {
  const session = makeSession();

  twilioWs.on("message", (raw: Buffer | string) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (msg.event) {
      case "connected":
        // Twilio confirms the stream channel is open — nothing to do yet
        break;

      case "start": {
        const start = msg.start as Record<string, unknown>;
        session.callSid = (start.callSid as string) ?? "";
        session.streamSid = (msg.streamSid as string) ?? null;
        console.info(
          `[twilio-bridge] Stream started callSid=${session.callSid} streamSid=${session.streamSid}`,
        );
        openOpenAIConnection(session, twilioWs);
        break;
      }

      case "media": {
        const media = msg.media as Record<string, unknown>;
        const payload = media.payload as string; // base64 µ-law 8 kHz
        if (session.openaiWs?.readyState === WebSocket.OPEN) {
          session.openaiWs.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: twilioAudioToOpenAI(payload),
            }),
          );
        }
        break;
      }

      case "stop":
        console.info(
          `[twilio-bridge] Stream stopped callSid=${session.callSid}`,
        );
        cleanup(session);
        break;

      default:
        break;
    }
  });

  twilioWs.on("close", () => cleanup(session));
  twilioWs.on("error", (err) => {
    console.error(
      `[twilio-bridge] Twilio WS error callSid=${session.callSid}`,
      err,
    );
    cleanup(session);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.info(`[twilio-bridge] Listening on port ${PORT}`);
  console.info(
    `[twilio-bridge] Webhook URL:     POST http://localhost:${PORT}/twilio/voice`,
  );
  console.info(
    `[twilio-bridge] Media stream WS: wss://localhost:${PORT}/twilio/stream`,
  );
  if (!OPENAI_API_KEY) {
    console.warn("[twilio-bridge] WARNING: OPENAI_API_KEY is not set");
  }
  if (!process.env.TWILIO_BRIDGE_PUBLIC_URL) {
    console.warn(
      "[twilio-bridge] WARNING: TWILIO_BRIDGE_PUBLIC_URL is not set — TwiML webhook will fail",
    );
  }
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
