/**
 * Twilio Media Stream bridge server
 *
 * Runs as a standalone Node.js process (port 5051 by default).
 * - POST /twilio/voice: Twilio webhook; returns TwiML that opens a Media Stream
 * - POST /twilio/transfer-action: handles post-transfer call flow
 * - WS   /twilio/stream: Twilio Media Stream; bridges audio to/from OpenAI Realtime API
 *
 * Start: npm run dev:twilio
 * Expose publicly during development: ngrok http 5051
 * Then set your Twilio phone number's voice webhook to: https://<ngrok-url>/twilio/voice
 */

import http from "node:http";
import express, { type Request, type Response } from "express";
import { WebSocket, WebSocketServer } from "ws";
import twilio from "twilio";
import { CONTACT_PHONE } from "./constants.js";
import { buildSiteAssistantSystemPrompt } from "./site-assistant-knowledge.js";
import {
  ADMIN_TRANSFER_PHONE_NUMBER,
  OPENING_CALL_INSTRUCTIONS,
  TECHNICAL_TRANSFER_PHONE_NUMBER,
  VOICE_CHANNEL_APPEND,
} from "../shared/voice-prompts.js";

const PORT = parseInt(
  process.env.PORT ?? process.env.TWILIO_BRIDGE_PORT ?? "5051",
  10,
);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() ?? "";
const OPENAI_MODEL =
  process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime";
const OPENAI_VOICE = process.env.OPENAI_REALTIME_VOICE?.trim() || "marin";
const OPENAI_WS_URL = `wss://api.openai.com/v1/realtime?model=${OPENAI_MODEL}`;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER?.trim() ?? "";
const TWILIO_BRIDGE_PUBLIC_URL =
  process.env.TWILIO_BRIDGE_PUBLIC_URL?.trim().replace(/\/$/, "") ?? "";
const ADMIN_TRANSFER_NUMBER =
  process.env.TWILIO_ADMIN_TRANSFER_NUMBER?.trim() ||
  ADMIN_TRANSFER_PHONE_NUMBER;
const TECHNICAL_TRANSFER_NUMBER =
  process.env.TWILIO_TECHNICAL_TRANSFER_NUMBER?.trim() ||
  TECHNICAL_TRANSFER_PHONE_NUMBER;
const PUBLIC_CONTACT_NUMBER = TWILIO_PHONE_NUMBER || CONTACT_PHONE;
const HUMAN_TRANSFER_ENABLED = Boolean(
  TWILIO_ACCOUNT_SID &&
    TWILIO_AUTH_TOKEN &&
    TWILIO_BRIDGE_PUBLIC_URL &&
    ADMIN_TRANSFER_NUMBER &&
    TECHNICAL_TRANSFER_NUMBER,
);
const twilioClient = HUMAN_TRANSFER_ENABLED
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;
const transferResumeInstructions = new Map<string, string>();

const TRANSFER_TOOL = {
  type: "function" as const,
  name: "transfer_to_human",
  description:
    "Transfer the live phone call to the correct Praxify team member after the caller clearly wants a handoff and the administrative vs technical destination is known. If the destination is unclear, ask a clarifying question before using this tool.",
  parameters: {
    type: "object",
    properties: {
      destination_type: {
        type: "string",
        enum: ["administrative", "technical"],
        description:
          "Use administrative for booking, scheduling, billing, pricing, account, contact, or general business questions. Use technical for website, app, automation, integration, bug, setup, or implementation questions.",
      },
      reason: {
        type: "string",
        description: "Short explanation of why the caller wants a human handoff.",
      },
    },
    required: ["destination_type", "reason"],
    additionalProperties: false,
  },
};

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

type JsonMap = Record<string, unknown>;

type FunctionCallResult = {
  ok: boolean;
  status: string;
  destinationType?: TransferDestination;
  reason?: string;
  detail?: string;
};

type TransferDestination = "administrative" | "technical";

type CallSession = {
  callSid: string;
  streamSid: string | null;
  openaiWs: WebSocket | null;
  openingPromptSent: boolean;
  openingInstructions: string;
  markCounter: number;
  responseActive: boolean;
  transferInProgress: boolean;
};

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
  for (
    let mask = 0x4000;
    (magnitude & mask) === 0 && exponent > 0;
    exponent -= 1
  ) {
    mask >>= 1;
  }

  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function upsample8to24(input: Int16Array): Int16Array {
  const out = new Int16Array(input.length * 3);
  for (let i = 0; i < input.length; i += 1) {
    const curr = input[i]!;
    const next = i + 1 < input.length ? input[i + 1]! : curr;
    out[i * 3] = curr;
    out[i * 3 + 1] = Math.round(curr + (next - curr) / 3);
    out[i * 3 + 2] = Math.round(curr + ((next - curr) * 2) / 3);
  }
  return out;
}

function downsample24to8(input: Int16Array): Int16Array {
  const outLen = Math.floor(input.length / 3);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    out[i] = Math.round(
      (input[i * 3]! + input[i * 3 + 1]! + input[i * 3 + 2]!) / 3,
    );
  }
  return out;
}

function twilioAudioToOpenAI(base64Mulaw: string): string {
  const mulawBytes = Buffer.from(base64Mulaw, "base64");
  const pcm8k = new Int16Array(mulawBytes.length);
  for (let i = 0; i < mulawBytes.length; i += 1) {
    pcm8k[i] = mulawDecode(mulawBytes[i]!);
  }
  const pcm24k = upsample8to24(pcm8k);
  const outBuf = Buffer.allocUnsafe(pcm24k.length * 2);
  for (let i = 0; i < pcm24k.length; i += 1) {
    outBuf.writeInt16LE(pcm24k[i]!, i * 2);
  }
  return outBuf.toString("base64");
}

function openAIAudioToTwilio(base64Pcm24k: string): string {
  const pcmBuf = Buffer.from(base64Pcm24k, "base64");
  const sampleCount = Math.floor(pcmBuf.length / 2);
  const pcm24k = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    pcm24k[i] = pcmBuf.readInt16LE(i * 2);
  }
  const pcm8k = downsample24to8(pcm24k);
  const mulawOut = Buffer.allocUnsafe(pcm8k.length);
  for (let i = 0; i < pcm8k.length; i += 1) {
    mulawOut[i] = mulawEncode(pcm8k[i]!);
  }
  return mulawOut.toString("base64");
}

function makeSession(): CallSession {
  return {
    callSid: "",
    streamSid: null,
    openaiWs: null,
    openingPromptSent: false,
    openingInstructions: OPENING_CALL_INSTRUCTIONS,
    markCounter: 0,
    responseActive: false,
    transferInProgress: false,
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

function buildStreamUrl(publicUrl: string): string {
  return publicUrl.replace(/^https?:\/\//, "wss://") + "/twilio/stream";
}

function buildStreamTwiml(publicUrl: string): string {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.connect().stream({ url: buildStreamUrl(publicUrl) });
  return twiml.toString();
}

function getOpeningInstructions(callSid: string): string {
  const override = transferResumeInstructions.get(callSid);
  if (!override) return OPENING_CALL_INSTRUCTIONS;
  transferResumeInstructions.delete(callSid);
  return override;
}

function safeJsonParse(input: string): JsonMap {
  try {
    const parsed = JSON.parse(input) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as JsonMap)
      : {};
  } catch {
    return {};
  }
}

function sendFunctionCallOutput(
  session: CallSession,
  callId: string,
  output: FunctionCallResult,
): void {
  if (session.openaiWs?.readyState !== WebSocket.OPEN) return;

  session.openaiWs.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    }),
  );
}

function resolveTransferNumber(
  destinationType: string,
): { destinationType: TransferDestination; phoneNumber: string } | null {
  if (destinationType === "administrative") {
    return { destinationType, phoneNumber: ADMIN_TRANSFER_NUMBER };
  }

  if (destinationType === "technical") {
    return { destinationType, phoneNumber: TECHNICAL_TRANSFER_NUMBER };
  }

  return null;
}

async function transferCallToHuman(
  session: CallSession,
  reason: string,
  destinationType: string,
): Promise<FunctionCallResult> {
  const transferTarget = resolveTransferNumber(destinationType);
  if (!transferTarget) {
    return {
      ok: false,
      status: "needs_destination_type",
    };
  }

  if (session.transferInProgress) {
    return {
      ok: false,
      status: "already_in_progress",
      destinationType: transferTarget.destinationType,
    };
  }

  if (!session.callSid || !twilioClient || !TWILIO_BRIDGE_PUBLIC_URL) {
    return {
      ok: false,
      status: "not_configured",
      destinationType: transferTarget.destinationType,
    };
  }

  session.transferInProgress = true;

  const twiml = new twilio.twiml.VoiceResponse();

  const dialOptions: {
    action: string;
    method: "POST";
    answerOnBridge: true;
    callerId?: string;
  } = {
    action: `${TWILIO_BRIDGE_PUBLIC_URL}/twilio/transfer-action`,
    method: "POST",
    answerOnBridge: true,
  };

  if (TWILIO_PHONE_NUMBER) {
    dialOptions.callerId = TWILIO_PHONE_NUMBER;
  }

  twiml.dial(dialOptions, transferTarget.phoneNumber);

  try {
    await twilioClient.calls(session.callSid).update({
      twiml: twiml.toString(),
    });

    console.info(
      `[twilio-bridge] Human transfer started callSid=${session.callSid} destination=${transferTarget.destinationType} target=${transferTarget.phoneNumber} reason=${reason || "unspecified"}`,
    );

    return {
      ok: true,
      status: "initiated",
      destinationType: transferTarget.destinationType,
      reason,
    };
  } catch (error) {
    session.transferInProgress = false;
    console.error(
      `[twilio-bridge] Human transfer failed callSid=${session.callSid}`,
      error,
    );
    return {
      ok: false,
      status: "failed",
      destinationType: transferTarget.destinationType,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function openOpenAIConnection(session: CallSession, twilioWs: WebSocket): void {
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
    console.info(`[twilio-bridge] OpenAI WS open callSid=${session.callSid}`);

    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions,
          voice: OPENAI_VOICE,
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          tools: HUMAN_TRANSFER_ENABLED ? [TRANSFER_TOOL] : [],
          tool_choice: HUMAN_TRANSFER_ENABLED ? "auto" : "none",
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
    let msg: JsonMap;
    try {
      msg = JSON.parse(raw.toString()) as JsonMap;
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
  msg: JsonMap,
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
              instructions: session.openingInstructions,
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

    case "response.function_call_arguments.done": {
      const name = typeof msg.name === "string" ? msg.name : "";
      const callId = typeof msg.call_id === "string" ? msg.call_id : "";
      if (name !== "transfer_to_human" || !callId) {
        break;
      }

      const args = safeJsonParse(
        typeof msg.arguments === "string" ? msg.arguments : "{}",
      );
      const reason = typeof args.reason === "string" ? args.reason.trim() : "";
      const destinationType =
        typeof args.destination_type === "string" ? args.destination_type.trim() : "";

      void transferCallToHuman(session, reason, destinationType).then((result) => {
        sendFunctionCallOutput(session, callId, result);

        if (!result.ok && session.openaiWs?.readyState === WebSocket.OPEN) {
          const instructions =
            result.status === "needs_destination_type"
              ? "Ask one short clarifying question: whether the caller needs administrative help or technical help. Do not mention internal transfer destination numbers."
              : `Briefly apologize that you could not connect the live transfer right now. Offer the main Praxify phone number ${PUBLIC_CONTACT_NUMBER} as the fallback. Do not mention any internal transfer destination numbers.`;

          session.openaiWs.send(
            JSON.stringify({
              type: "response.create",
              response: {
                modalities: ["text", "audio"],
                instructions,
              },
            }),
          );
        }
      });
      break;
    }

    case "response.audio.delta": {
      const delta = typeof msg.delta === "string" ? msg.delta : "";
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

    case "response.audio.done":
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

    case "input_audio_buffer.speech_started":
      if (!session.responseActive) break;
      if (session.streamSid && twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(
          JSON.stringify({ event: "clear", streamSid: session.streamSid }),
        );
      }
      if (session.openaiWs?.readyState === WebSocket.OPEN) {
        session.openaiWs.send(JSON.stringify({ type: "response.cancel" }));
      }
      break;

    case "error": {
      const err =
        typeof msg.error === "object" && msg.error !== null
          ? (msg.error as JsonMap)
          : {};
      if (err.code !== "response_cancel_not_active") {
        console.error(
          `[twilio-bridge] OpenAI Realtime error callSid=${session.callSid}`,
          msg,
        );
      }
      break;
    }

    default:
      break;
  }
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post("/twilio/voice", (_req: Request, res: Response) => {
  if (!TWILIO_BRIDGE_PUBLIC_URL) {
    res.status(500).send("TWILIO_BRIDGE_PUBLIC_URL is not configured.");
    return;
  }

  res.type("text/xml").send(buildStreamTwiml(TWILIO_BRIDGE_PUBLIC_URL));
  console.info(
    `[twilio-bridge] /twilio/voice -> TwiML stream to ${buildStreamUrl(TWILIO_BRIDGE_PUBLIC_URL)}`,
  );
});

app.post("/twilio/transfer-action", (req: Request, res: Response) => {
  const dialStatus =
    typeof req.body?.DialCallStatus === "string" ? req.body.DialCallStatus : "";
  const callSid = typeof req.body?.CallSid === "string" ? req.body.CallSid : "";

  console.info(
    `[twilio-bridge] transfer action callSid=${callSid} dialStatus=${dialStatus || "unknown"}`,
  );

  const shouldReconnectAssistant =
    Boolean(TWILIO_BRIDGE_PUBLIC_URL) &&
    ["busy", "no-answer", "failed", "canceled", "completed"].includes(dialStatus);

  if (shouldReconnectAssistant && callSid) {
    transferResumeInstructions.set(
      callSid,
      dialStatus === "completed"
        ? "The human handoff has ended. Do not repeat the standard greeting. In one short sentence, let the caller know you are back on the line and ask what they need next."
        : `The attempted human handoff did not connect because the dial result was "${dialStatus}". Do not repeat the standard greeting. In one short sentence, apologize and continue helping or offer the main Praxify number ${PUBLIC_CONTACT_NUMBER}. Do not mention any internal transfer destination number.`,
    );

    res.type("text/xml").send(buildStreamTwiml(TWILIO_BRIDGE_PUBLIC_URL));
    return;
  }

  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(
    `I'm sorry, no one is available right now. You can reach the Praxify team at ${PUBLIC_CONTACT_NUMBER}. Goodbye.`,
  );
  res.type("text/xml").send(twiml.toString());
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    openaiKeyConfigured: Boolean(OPENAI_API_KEY),
    publicUrlConfigured: Boolean(TWILIO_BRIDGE_PUBLIC_URL),
    humanTransferEnabled: HUMAN_TRANSFER_ENABLED,
    adminTransferConfigured: Boolean(ADMIN_TRANSFER_NUMBER),
    technicalTransferConfigured: Boolean(TECHNICAL_TRANSFER_NUMBER),
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const rawUrl = req.url ?? "";
  const pathname = new URL(rawUrl, "http://localhost").pathname;

  if (pathname === "/twilio/stream") {
    console.info(`[twilio-bridge] WS upgrade accepted url=${rawUrl}`);
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }

  console.warn(`[twilio-bridge] WS upgrade rejected url=${rawUrl}`);
  socket.destroy();
});

wss.on("connection", (twilioWs: WebSocket) => {
  const session = makeSession();

  twilioWs.on("message", (raw: Buffer | string) => {
    let msg: JsonMap;
    try {
      msg = JSON.parse(raw.toString()) as JsonMap;
    } catch {
      return;
    }

    switch (msg.event) {
      case "connected":
        break;

      case "start": {
        const start =
          typeof msg.start === "object" && msg.start !== null
            ? (msg.start as JsonMap)
            : {};
        session.callSid = typeof start.callSid === "string" ? start.callSid : "";
        session.streamSid = typeof msg.streamSid === "string" ? msg.streamSid : null;
        session.openingInstructions = getOpeningInstructions(session.callSid);
        console.info(
          `[twilio-bridge] Stream started callSid=${session.callSid} streamSid=${session.streamSid}`,
        );
        openOpenAIConnection(session, twilioWs);
        break;
      }

      case "media": {
        const media =
          typeof msg.media === "object" && msg.media !== null
            ? (msg.media as JsonMap)
            : {};
        const payload = typeof media.payload === "string" ? media.payload : "";
        if (payload && session.openaiWs?.readyState === WebSocket.OPEN) {
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
        console.info(`[twilio-bridge] Stream stopped callSid=${session.callSid}`);
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
  if (!TWILIO_BRIDGE_PUBLIC_URL) {
    console.warn(
      "[twilio-bridge] WARNING: TWILIO_BRIDGE_PUBLIC_URL is not set - TwiML webhook will fail",
    );
  }
  if (!HUMAN_TRANSFER_ENABLED) {
    console.warn(
      "[twilio-bridge] WARNING: human transfer is disabled. Check Twilio credentials and transfer destination numbers",
    );
  }
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
