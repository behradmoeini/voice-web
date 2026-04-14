import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { initialRealtimeCallState, realtimeCallReducer } from "./callReducer";
import { type CallPhase, type SessionMeta, type TranscriptSpeaker } from "./callTypes";
import { useAudioMeter } from "./useAudioMeter";
import { OPENING_CALL_INSTRUCTIONS } from "../../../shared/voice-prompts";

type SessionDebug = {
  requestId?: string;
  env?: {
    openaiApiKeyConfigured?: boolean;
  };
  timingsMs?: Record<string, number>;
  upstreamRequestId?: string;
};

type SessionResponse = {
  clientSecret: string;
  model: string;
  voice: string;
  expiresAt: string;
  sessionId: string;
  instructionHash?: string;
  hint?: string;
  detail?: string;
  requestId?: string;
  debug?: SessionDebug;
  error?: string;
};

type HealthCheckResult = {
  ok: boolean;
  configured: boolean;
  summary: string;
};

type ConnectionMetric = {
  step: string;
  durationMs: number;
  ok: boolean;
  detail?: string;
};

type DebugLogEntry = {
  ts: string;
  message: string;
};

type StartupState = "booting" | "ready" | "error";

type StartupCheck = {
  step: string;
  durationMs: number;
  ok: boolean;
  detail?: string;
};

type JsonMap = Record<string, unknown>;

const BARGE_IN_COOLDOWN_MS = 350;
const RESPONSE_FALLBACK_DELAY_MS = 700;
const DISCONNECT_GRACE_MS = 4_500;
const START_CALL_TIMEOUT_MS = 30_000;
const AUTO_HANGUP_DELAY_MS = 1_400;
const DONE_INTENT_FORCE_HANGUP_MS = 2_600;
const MAX_START_ATTEMPTS = 2;
const MAX_DEBUG_LOG_LINES = 260;
type TimerRef = { current: number | null };

function apiUrl(path: string): string {
  const base = (
    import.meta.env.VITE_API_BASE_URL as string | undefined
  )?.trim()
    .replace(/\/$/, "") ?? "";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}

function asJsonMap(value: unknown): JsonMap {
  return typeof value === "object" && value !== null ? (value as JsonMap) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function extractTextFromEvent(event: JsonMap): string {
  const direct = asText(event.delta) || asText(event.transcript) || asText(event.text);
  if (direct) return direct;

  const part = asJsonMap(event.part);
  const partText = asText(part.text) || asText(part.transcript);
  if (partText) return partText;

  const item = asJsonMap(event.item);
  const content = Array.isArray(item.content) ? item.content : [];
  for (const segment of content) {
    const seg = asJsonMap(segment);
    const text = asText(seg.text) || asText(seg.transcript);
    if (text) return text;
  }

  return "";
}

function resolveEventId(event: JsonMap, prefix: string): string {
  const direct =
    asText(event.item_id) ||
    asText(event.response_id) ||
    asText(event.id) ||
    asText(asJsonMap(event.item).id);
  return direct || makeId(prefix);
}

function statusForPhase(phase: CallPhase): string {
  switch (phase) {
    case "idle":
      return "Ready to start";
    case "connecting":
      return "Connecting to receptionist";
    case "listening":
      return "Listening";
    case "assistant_speaking":
      return "Assistant speaking";
    case "ended":
      return "Call ended";
    case "error":
      return "Connection error";
    default:
      return "Idle";
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission is blocked. Allow microphone access and retry.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unable to start the realtime call.";
}

function buildSessionErrorMessage(payload: SessionResponse, statusCode: number): string {
  const errorCode = payload.error || "";

  if (errorCode === "assistant_not_configured") {
    return (
      "Server is missing OPENAI_API_KEY for this deployment. " +
      "Set env var in Vercel (preview/production), redeploy, and retry."
    );
  }

  if (payload.hint) {
    return payload.hint;
  }

  if (payload.detail) {
    return payload.detail;
  }

  if (errorCode) {
    return `${errorCode} (status ${statusCode})`;
  }

  return `Failed to create realtime session (status ${statusCode}).`;
}

function normalizeSpeech(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCallerDoneIntent(text: string): boolean {
  const t = normalizeSpeech(text);
  if (!t) return false;

  if (/no more questions?/.test(t) || /nothing else/.test(t) || /that'?s all/.test(t)) {
    return true;
  }

  if (/^(bye|goodbye|thanks?(\s+you)?\s+bye)$/.test(t)) {
    return true;
  }

  if (/\b(i am done|i'm done|we are done|we're done|all good)\b/.test(t)) {
    return true;
  }

  const hasFarewell = /\b(bye|goodbye|talk to you later|have a good day)\b/.test(t);
  const hasContinuation = /\b(another|also|question|ask|before that|one more)\b/.test(t);
  if (hasFarewell && !hasContinuation) {
    return true;
  }

  return false;
}

function isAssistantFarewell(text: string): boolean {
  const t = normalizeSpeech(text);
  if (!t) return false;
  return /\b(goodbye|thanks for calling|take care|have a great day|have a good day)\b/.test(t);
}

export function useRealtimeCall() {
  const [state, dispatch] = useReducer(realtimeCallReducer, initialRealtimeCallState);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [metrics, setMetrics] = useState<ConnectionMetric[]>([]);
  const [eventCounts, setEventCounts] = useState<Record<string, number>>({});
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [serverDebug, setServerDebug] = useState<SessionDebug | null>(null);
  const [healthSummary, setHealthSummary] = useState<string>("not checked");
  const [statusDetail, setStatusDetail] = useState<string>("Tap Start call to initialize.");
  const [startupState, setStartupState] = useState<StartupState>("booting");
  const [startupDetail, setStartupDetail] = useState<string>("Running startup checks...");
  const [startupChecks, setStartupChecks] = useState<StartupCheck[]>([]);

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const micSenderRef = useRef<RTCRtpSender | null>(null);
  const preparedSessionRef = useRef<SessionMeta | null>(null);
  const stateRef = useRef(state);
  const lastBargeAtRef = useRef(0);
  const startSeqRef = useRef(0);
  const manualEndRef = useRef(false);
  const pendingResponseTimerRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const autoHangupTimerRef = useRef<number | null>(null);
  const lastResponseCreatedAtRef = useRef(0);
  const pendingHangupRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const isSecure =
    typeof window !== "undefined" &&
    (window.isSecureContext ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  const clearTimer = useCallback((timerRef: TimerRef) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pushLog = useCallback((message: string) => {
    const entry: DebugLogEntry = {
      ts: new Date().toISOString(),
      message,
    };
    setDebugLogs((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_DEBUG_LOG_LINES
        ? next.slice(next.length - MAX_DEBUG_LOG_LINES)
        : next;
    });
  }, []);

  const pushMetric = useCallback(
    (step: string, startedAt: number, ok: boolean, detail?: string) => {
      const durationMs = Number((performance.now() - startedAt).toFixed(1));
      setMetrics((prev) => [...prev, { step, durationMs, ok, detail }]);
      pushLog(`${ok ? "OK" : "FAIL"} ${step} (${durationMs} ms)${detail ? ` :: ${detail}` : ""}`);
    },
    [pushLog],
  );

  const bumpEvent = useCallback((type: string) => {
    setEventCounts((prev) => ({
      ...prev,
      [type]: (prev[type] ?? 0) + 1,
    }));
  }, []);

  const teardownRealtimeConnection = useCallback(() => {
    clearTimer(disconnectTimerRef);
    clearTimer(pendingResponseTimerRef);
    clearTimer(autoHangupTimerRef);
    pendingHangupRef.current = false;

    const channel = channelRef.current;
    if (channel) {
      channel.onmessage = null;
      channel.onopen = null;
      channel.onerror = null;
      if (channel.readyState === "open" || channel.readyState === "connecting") {
        channel.close();
      }
      channelRef.current = null;
    }

    const peer = peerRef.current;
    if (peer) {
      peer.onconnectionstatechange = null;
      peer.ontrack = null;
      if (peer.connectionState !== "closed") {
        peer.close();
      }
      peerRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    micSenderRef.current = null;
    preparedSessionRef.current = null;
  }, [clearTimer]);

  const shutdownMedia = useCallback(() => {
    teardownRealtimeConnection();

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setMicStream(null);
  }, [teardownRealtimeConnection]);

  const sendClientEvent = useCallback(
    (event: JsonMap) => {
      const channel = channelRef.current;
      if (!channel || channel.readyState !== "open") return false;
      channel.send(JSON.stringify(event));
      const type = asText(event.type) || "unknown";
      pushLog(`client_event ${type}`);
      return true;
    },
    [pushLog],
  );

  const pushTranscript = useCallback(
    (
      speaker: TranscriptSpeaker,
      id: string,
      text: string,
      options?: { append?: boolean; final?: boolean },
    ) => {
      if (!text) return;
      dispatch({
        type: "transcript/merge",
        payload: {
          id,
          speaker,
          text,
          append: options?.append,
          final: options?.final,
        },
      });
    },
    [],
  );

  const scheduleFallbackResponse = useCallback(() => {
    clearTimer(pendingResponseTimerRef);
    const marker = performance.now();

    pendingResponseTimerRef.current = window.setTimeout(() => {
      if (stateRef.current.phase === "error") return;
      if (lastResponseCreatedAtRef.current >= marker) return;
      sendClientEvent({
        type: "response.create",
        response: {
          instructions:
            "Respond only with Praxify website facts. If the user asks anything outside Praxify website knowledge, refuse briefly and redirect to Praxify topics.",
        },
      });
      pushLog("fallback response.create sent after speech_stopped");
    }, RESPONSE_FALLBACK_DELAY_MS);
  }, [clearTimer, pushLog, sendClientEvent]);

  const terminateCall = useCallback(
    (reason: string) => {
      manualEndRef.current = true;
      pushLog(`call terminated: ${reason}`);
      setStatusDetail(reason);
      shutdownMedia();
      dispatch({ type: "call/phase", phase: "ended" });
      dispatch({ type: "call/clear-error" });
    },
    [pushLog, shutdownMedia],
  );

  const scheduleAutoHangup = useCallback(
    (reason: string, delayMs = AUTO_HANGUP_DELAY_MS) => {
      if (autoHangupTimerRef.current !== null) return;
      setStatusDetail("Caller appears done. Closing the call...");
      autoHangupTimerRef.current = window.setTimeout(() => {
        if (stateRef.current.phase === "error" || stateRef.current.phase === "ended") {
          return;
        }
        terminateCall(reason);
      }, delayMs);
      pushLog(`auto hangup scheduled (${delayMs} ms)`);
    },
    [pushLog, terminateCall],
  );

  const clearPendingHangup = useCallback(
    (reason: string) => {
      pendingHangupRef.current = false;
      clearTimer(autoHangupTimerRef);
      pushLog(reason);
    },
    [clearTimer, pushLog],
  );

  const activatePendingHangup = useCallback(
    (text: string, source: string) => {
      pendingHangupRef.current = true;
      setStatusDetail("Caller said they are done. Closing shortly...");
      pushLog(`done-intent detected (${source}): "${text.slice(0, 120)}"`);

      if (stateRef.current.phase === "assistant_speaking") {
        sendClientEvent({ type: "response.cancel" });
        pushLog("assistant response cancelled due to done-intent");
      }

      // Force-close shortly even if server never emits response.done.
      scheduleAutoHangup("Caller ended the conversation.", DONE_INTENT_FORCE_HANGUP_MS);
    },
    [pushLog, scheduleAutoHangup, sendClientEvent],
  );

  const handleServerEvent = useCallback(
    (raw: unknown) => {
      const event = asJsonMap(raw);
      const type = asText(event.type);
      if (!type) return;

      bumpEvent(type);

      if (
        type !== "response.output_audio.delta" &&
        type !== "response.output_audio_transcript.delta" &&
        type !== "conversation.item.input_audio_transcription.delta"
      ) {
        pushLog(`server_event ${type}`);
      }

      if (type === "input_audio_buffer.speech_started") {
        clearTimer(pendingResponseTimerRef);
        if (pendingHangupRef.current) {
          clearPendingHangup("auto hangup cancelled due to new user speech");
        }

        if (stateRef.current.phase === "assistant_speaking") {
          const now = performance.now();
          if (now - lastBargeAtRef.current > BARGE_IN_COOLDOWN_MS) {
            lastBargeAtRef.current = now;
            sendClientEvent({ type: "response.cancel" });
          }
        }
        dispatch({ type: "call/phase", phase: "listening" });
        return;
      }

      if (type === "input_audio_buffer.speech_stopped") {
        if (stateRef.current.phase !== "error") {
          dispatch({ type: "call/phase", phase: "listening" });
        }
        scheduleFallbackResponse();
        return;
      }

      if (type === "response.created") {
        lastResponseCreatedAtRef.current = performance.now();
        clearTimer(pendingResponseTimerRef);
        dispatch({ type: "call/phase", phase: "assistant_speaking" });
        return;
      }

      if (type === "response.output_audio.delta") {
        dispatch({ type: "call/phase", phase: "assistant_speaking" });
        return;
      }

      if (type === "response.done") {
        if (stateRef.current.phase !== "error") {
          dispatch({ type: "call/phase", phase: "listening" });
        }
        if (pendingHangupRef.current) {
          scheduleAutoHangup("Caller ended the conversation.");
        }
        return;
      }

      if (type === "conversation.item.input_audio_transcription.delta") {
        const text = extractTextFromEvent(event);
        pushTranscript("user", resolveEventId(event, "user"), text, {
          append: true,
          final: false,
        });
        return;
      }

      if (type === "conversation.item.input_audio_transcription.completed") {
        const text = extractTextFromEvent(event);
        pushTranscript("user", resolveEventId(event, "user"), text, {
          append: false,
          final: true,
        });

        if (isCallerDoneIntent(text)) {
          activatePendingHangup(text, "input_audio_transcription.completed");
        } else if (pendingHangupRef.current) {
          clearPendingHangup("pending hangup cleared by follow-up caller input");
        }
        return;
      }

      if (type === "conversation.item.created") {
        const item = asJsonMap(event.item);
        if (asText(item.role) === "user") {
          const text = extractTextFromEvent(event);
          if (text && isCallerDoneIntent(text)) {
            activatePendingHangup(text, "conversation.item.created");
          }
        }
        return;
      }

      if (
        type === "response.output_audio_transcript.delta" ||
        type === "response.output_text.delta"
      ) {
        const text = extractTextFromEvent(event);
        pushTranscript("assistant", resolveEventId(event, "assistant"), text, {
          append: true,
          final: false,
        });
        dispatch({ type: "call/phase", phase: "assistant_speaking" });
        return;
      }

      if (
        type === "response.output_audio_transcript.done" ||
        type === "response.output_text.done"
      ) {
        const text = extractTextFromEvent(event);
        pushTranscript("assistant", resolveEventId(event, "assistant"), text, {
          append: false,
          final: true,
        });
        if (pendingHangupRef.current && isAssistantFarewell(text)) {
          scheduleAutoHangup("Call completed successfully.");
        }
        return;
      }

      if (type === "error") {
        const message =
          asText(asJsonMap(event.error).message) ||
          asText(event.message) ||
          "Realtime call error.";
        pushLog(`server error: ${message}`);
        dispatch({ type: "call/error", message });
        setStatusDetail("Realtime API reported an error.");
      }
    },
    [
      bumpEvent,
      clearTimer,
      pendingResponseTimerRef,
      pushLog,
      pushTranscript,
      scheduleAutoHangup,
      scheduleFallbackResponse,
      sendClientEvent,
      activatePendingHangup,
      clearPendingHangup,
    ],
  );

  const runHealthCheck = useCallback(async (): Promise<HealthCheckResult> => {
    const startedAt = performance.now();

    try {
      const response = await fetch(apiUrl("/api/realtime-session"), {
        method: "GET",
      });

      const json = asJsonMap(await response.json().catch(() => ({})));
      const configured = Boolean(asJsonMap(json.configured).openaiApiKey);
      const requestId = asText(json.requestId);
      const model = asText(asJsonMap(json.defaults).model);
      const voice = asText(asJsonMap(json.defaults).voice);

      const summary =
        `OPENAI_API_KEY=${configured ? "set" : "missing"}, ` +
        `model=${model || "n/a"}, voice=${voice || "n/a"}, requestId=${requestId || "n/a"}`;

      setHealthSummary(summary);
      pushMetric("GET /api/realtime-session (health)", startedAt, response.ok, summary);
      return {
        ok: response.ok && configured,
        configured,
        summary,
      };
    } catch (error) {
      const message = toErrorMessage(error);
      setHealthSummary(`health check failed: ${message}`);
      pushMetric("GET /api/realtime-session (health)", startedAt, false, message);
      return {
        ok: false,
        configured: false,
        summary: `health check failed: ${message}`,
      };
    }
  }, [pushMetric]);

  const pushStartupCheck = useCallback(
    (step: string, startedAt: number, ok: boolean, detail?: string) => {
      const durationMs = Number((performance.now() - startedAt).toFixed(1));
      setStartupChecks((prev) => [...prev, { step, durationMs, ok, detail }]);
      pushLog(
        `startup ${ok ? "OK" : "FAIL"} ${step} (${durationMs} ms)${
          detail ? ` :: ${detail}` : ""
        }`,
      );
    },
    [pushLog],
  );

  const requestSession = useCallback(
    async (attempt: number): Promise<SessionResponse> => {
      const startedAt = performance.now();
      const response = await fetch(apiUrl("/api/realtime-session"), { method: "POST" });
      const sessionJson = asJsonMap(await response.json().catch(() => ({}))) as SessionResponse;

      if (!response.ok) {
        const msg = buildSessionErrorMessage(sessionJson, response.status);
        pushMetric(`POST /api/realtime-session (attempt ${attempt})`, startedAt, false, msg);
        throw new Error(msg);
      }

      setServerDebug(sessionJson.debug ?? null);
      pushMetric(
        `POST /api/realtime-session (attempt ${attempt})`,
        startedAt,
        true,
        `requestId=${sessionJson.debug?.requestId || sessionJson.requestId || "n/a"}`,
      );

      return {
        clientSecret: asText(sessionJson.clientSecret),
        model: asText(sessionJson.model),
        voice: asText(sessionJson.voice),
        expiresAt: asText(sessionJson.expiresAt),
        sessionId: asText(sessionJson.sessionId),
      };
    },
    [pushMetric],
  );

  const establishPreconnectedRealtime = useCallback(async (): Promise<SessionMeta> => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt += 1) {
      teardownRealtimeConnection();

      try {
        setStatusDetail(`Preparing realtime connection (${attempt}/${MAX_START_ATTEMPTS})...`);
        const session = await requestSession(attempt);
        if (!session.clientSecret) {
          throw new Error("Missing realtime client secret from server.");
        }

        const peer = new RTCPeerConnection();
        peerRef.current = peer;

        const dataChannel = peer.createDataChannel("oai-events");
        channelRef.current = dataChannel;

        const transceiver = peer.addTransceiver("audio", { direction: "sendrecv" });
        micSenderRef.current = transceiver.sender;

        const channelOpenPromise = new Promise<void>((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            reject(new Error("Timed out waiting for realtime data channel."));
          }, START_CALL_TIMEOUT_MS);

          dataChannel.onopen = () => {
            window.clearTimeout(timeoutId);
            resolve();
          };
        });

        dataChannel.onerror = () => {
          pushLog("data channel error");
        };

        dataChannel.onmessage = (messageEvent) => {
          try {
            const parsed = JSON.parse(String(messageEvent.data)) as unknown;
            handleServerEvent(parsed);
          } catch {
            pushLog("failed to parse data-channel message");
          }
        };

        peer.ontrack = (event) => {
          const audioEl = remoteAudioRef.current;
          const streamFromEvent = event.streams[0];
          if (!audioEl || !streamFromEvent) return;
          audioEl.srcObject = streamFromEvent;
          void audioEl.play().catch(() => undefined);
          pushLog("remote audio track received");
        };

        peer.onconnectionstatechange = () => {
          if (manualEndRef.current) return;
          pushLog(`peer_connection_state ${peer.connectionState}`);

          if (peer.connectionState === "connected") {
            clearTimer(disconnectTimerRef);
            return;
          }

          if (peer.connectionState === "disconnected") {
            clearTimer(disconnectTimerRef);
            disconnectTimerRef.current = window.setTimeout(() => {
              if (manualEndRef.current) return;

              if (
                stateRef.current.phase === "connecting" ||
                stateRef.current.phase === "listening" ||
                stateRef.current.phase === "assistant_speaking"
              ) {
                dispatch({
                  type: "call/error",
                  message: "Call disconnected and did not recover. Start again.",
                });
                setStatusDetail("Connection lost.");
                shutdownMedia();
              } else {
                setStartupState("error");
                setStartupDetail("Realtime connection dropped. Run startup checks again.");
                teardownRealtimeConnection();
              }
            }, DISCONNECT_GRACE_MS);
            return;
          }

          if (peer.connectionState === "failed" || peer.connectionState === "closed") {
            if (
              stateRef.current.phase === "connecting" ||
              stateRef.current.phase === "listening" ||
              stateRef.current.phase === "assistant_speaking"
            ) {
              dispatch({
                type: "call/error",
                message: "Realtime connection failed. Please retry.",
              });
              setStatusDetail("Connection failed.");
              shutdownMedia();
            } else {
              setStartupState("error");
              setStartupDetail("Realtime connection failed during startup.");
              teardownRealtimeConnection();
            }
          }
        };

        const offerStartedAt = performance.now();
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        pushMetric(`createOffer + setLocalDescription (attempt ${attempt})`, offerStartedAt, true);

        const sdpStartedAt = performance.now();
        const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        });

        if (!sdpResponse.ok) {
          const detail = await sdpResponse.text().catch(() => "");
          pushMetric(
            `POST /v1/realtime/calls (attempt ${attempt})`,
            sdpStartedAt,
            false,
            detail || `status=${sdpResponse.status}`,
          );
          throw new Error(detail || `Failed SDP negotiation (${sdpResponse.status}).`);
        }
        pushMetric(`POST /v1/realtime/calls (attempt ${attempt})`, sdpStartedAt, true);

        const answerStartedAt = performance.now();
        const answerSdp = await sdpResponse.text();
        await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
        pushMetric(`setRemoteDescription (attempt ${attempt})`, answerStartedAt, true);

        const readyStartedAt = performance.now();
        await Promise.race([
          channelOpenPromise,
          new Promise<void>((_, reject) => {
            window.setTimeout(
              () => reject(new Error("Timed out waiting for receptionist readiness.")),
              START_CALL_TIMEOUT_MS,
            );
          }),
        ]);
        pushMetric(`RTC data channel open (attempt ${attempt})`, readyStartedAt, true);

        const nextSession: SessionMeta = {
          sessionId: session.sessionId,
          model: session.model,
          voice: session.voice,
          expiresAt: session.expiresAt,
        };
        preparedSessionRef.current = nextSession;
        return nextSession;
      } catch (attemptError) {
        lastError = attemptError;
        teardownRealtimeConnection();
        const message = toErrorMessage(attemptError);
        pushLog(`preconnect attempt ${attempt} failed: ${message}`);

        if (attempt < MAX_START_ATTEMPTS) {
          await delay(650 * attempt);
        }
      }
    }

    throw lastError || new Error("Unable to establish realtime connection.");
  }, [
    clearTimer,
    handleServerEvent,
    pushLog,
    pushMetric,
    requestSession,
    shutdownMedia,
    teardownRealtimeConnection,
  ]);

  const runStartupChecks = useCallback(async () => {
    if (
      stateRef.current.phase === "connecting" ||
      stateRef.current.phase === "listening" ||
      stateRef.current.phase === "assistant_speaking"
    ) {
      setStartupDetail("Startup checks skipped: call is active.");
      return;
    }

    setStartupState("booting");
    setStartupDetail("Running startup checks...");
    setStartupChecks([]);
    dispatch({ type: "call/clear-error" });

    const secureStart = performance.now();
    if (!isSecure) {
      pushStartupCheck("Secure context", secureStart, false, "HTTPS or localhost required");
      setStartupState("error");
      setStartupDetail("Startup blocked: HTTPS or localhost is required.");
      return;
    }
    pushStartupCheck("Secure context", secureStart, true);

    const browserStart = performance.now();
    const hasMediaDevices =
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices) &&
      typeof navigator.mediaDevices.getUserMedia === "function";
    const hasRtc = typeof RTCPeerConnection !== "undefined";

    if (!hasMediaDevices || !hasRtc) {
      pushStartupCheck(
        "Browser capabilities",
        browserStart,
        false,
        `mediaDevices=${hasMediaDevices}, rtc=${hasRtc}`,
      );
      setStartupState("error");
      setStartupDetail("Startup blocked: this browser lacks required WebRTC features.");
      return;
    }
    pushStartupCheck("Browser capabilities", browserStart, true, "mediaDevices+WebRTC ready");

    const healthStart = performance.now();
    const health = await runHealthCheck();
    pushStartupCheck("Server health", healthStart, health.ok, health.summary);
    if (!health.ok) {
      setStartupState("error");
      setStartupDetail("Startup blocked: server health check failed.");
      return;
    }

    const preconnectStart = performance.now();
    try {
      const preparedSession = await establishPreconnectedRealtime();
      pushStartupCheck(
        "Realtime preconnect",
        preconnectStart,
        true,
        `session=${preparedSession.sessionId}`,
      );
    } catch (error) {
      const message = toErrorMessage(error);
      pushStartupCheck("Realtime preconnect", preconnectStart, false, message);
      setStartupState("error");
      setStartupDetail(`Startup blocked: ${message}`);
      return;
    }

    dispatch({ type: "call/phase", phase: "idle" });
    setStartupState("ready");
    setStartupDetail("Startup complete. Start call is now enabled.");
  }, [establishPreconnectedRealtime, isSecure, pushStartupCheck, runHealthCheck]);

  const startCall = useCallback(async () => {
    if (!isSecure) {
      dispatch({
        type: "call/error",
        message: "Use HTTPS or localhost to enable microphone access.",
      });
      return;
    }

    if (startupState !== "ready") {
      dispatch({
        type: "call/error",
        message: "Startup checks are not complete yet. Wait for readiness and retry.",
      });
      setStatusDetail("Startup checks incomplete.");
      return;
    }

    const preparedPeer = peerRef.current;
    const preparedChannel = channelRef.current;
    const preparedSession = preparedSessionRef.current;

    if (
      !preparedPeer ||
      !preparedChannel ||
      preparedChannel.readyState !== "open" ||
      !preparedSession ||
      !micSenderRef.current
    ) {
      setStartupState("booting");
      setStartupDetail("Realtime preconnect expired. Rebuilding...");
      await runStartupChecks();
      if (
        !peerRef.current ||
        !channelRef.current ||
        channelRef.current.readyState !== "open" ||
        !preparedSessionRef.current ||
        !micSenderRef.current
      ) {
        dispatch({
          type: "call/error",
          message: "Realtime connection is not ready. Run startup checks again.",
        });
        return;
      }
    }

    manualEndRef.current = false;
    startSeqRef.current += 1;
    const startSeq = startSeqRef.current;

    setEventCounts({});
    setStatusDetail("Activating microphone...");
    dispatch({ type: "call/connecting" });

    pushLog(`startCall begin (seq=${startSeq})`);

    try {
      const micStartedAt = performance.now();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      pushMetric("getUserMedia", micStartedAt, true);

      if (startSeq !== startSeqRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const sender = micSenderRef.current;
      const micTrack = stream.getAudioTracks()[0];
      if (!sender || !micTrack) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Realtime audio sender is not ready.");
      }

      const attachStartedAt = performance.now();
      await sender.replaceTrack(micTrack);
      pushMetric("attach microphone track", attachStartedAt, true);

      localStreamRef.current = stream;
      setMicStream(stream);

      const liveSession = preparedSessionRef.current;
      if (!liveSession) {
        throw new Error("Missing prepared session metadata.");
      }

      dispatch({ type: "call/connected", session: liveSession });
      setStatusDetail("Receptionist is ready.");
      sendClientEvent({
        type: "response.create",
        response: {
          instructions: OPENING_CALL_INSTRUCTIONS,
        },
      });

      pushLog("startCall completed");
    } catch (error) {
      const message = toErrorMessage(error);
      const currentStream = localStreamRef.current;
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
      localStreamRef.current = null;
      setMicStream(null);
      pushLog(`startCall failed: ${message}`);
      setStatusDetail("Call start failed.");
      dispatch({
        type: "call/error",
        message,
      });
    }
  }, [
    isSecure,
    runStartupChecks,
    startupState,
    pushLog,
    pushMetric,
    sendClientEvent,
  ]);

  const endCall = useCallback(() => {
    terminateCall("Call ended by operator.");
    setStartupState("booting");
    setStartupDetail("Re-preparing realtime connection...");
    void runStartupChecks();
  }, [runStartupChecks, terminateCall]);

  const clearTranscript = useCallback(() => {
    dispatch({ type: "transcript/clear" });
    pushLog("transcript cleared");
  }, [pushLog]);

  const copyDebugSnapshot = useCallback(async () => {
    const snapshot = {
      when: new Date().toISOString(),
      status: state.phase,
      statusDetail,
      startupState,
      startupDetail,
      startupChecks,
      error: state.error,
      secureContext: isSecure,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      session: state.session,
      healthSummary,
      serverDebug,
      metrics,
      eventCounts,
      transcriptTurns: state.transcript.length,
      pendingHangup: pendingHangupRef.current,
      logs: debugLogs,
    };

    const text = JSON.stringify(snapshot, null, 2);

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }

    return text;
  }, [
    debugLogs,
    eventCounts,
    healthSummary,
    isSecure,
    metrics,
    serverDebug,
    startupChecks,
    startupDetail,
    startupState,
    state,
    statusDetail,
  ]);

  useEffect(() => {
    void runStartupChecks();
  }, [runStartupChecks]);

  useEffect(() => () => shutdownMedia(), [shutdownMedia]);

  const micLevel = useAudioMeter(
    micStream,
    state.phase === "connecting" ||
      state.phase === "listening" ||
      state.phase === "assistant_speaking",
  );

  const statusText = useMemo(() => statusForPhase(state.phase), [state.phase]);
  const isCallActive =
    state.phase === "connecting" ||
    state.phase === "listening" ||
    state.phase === "assistant_speaking";

  return {
    state,
    statusText,
    statusDetail,
    micLevel,
    isSecure,
    isCallActive,
    remoteAudioRef,
    startCall,
    endCall,
    clearTranscript,
    runHealthCheck,
    runStartupChecks,
    healthSummary,
    startupState,
    startupDetail,
    startupChecks,
    metrics,
    eventCounts,
    debugLogs,
    serverDebug,
    copyDebugSnapshot,
  };
}
