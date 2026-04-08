export type CallPhase =
  | "idle"
  | "connecting"
  | "listening"
  | "assistant_speaking"
  | "error"
  | "ended";

export type TranscriptSpeaker = "user" | "assistant" | "system";

export type SessionMeta = {
  sessionId: string;
  model: string;
  voice: string;
  expiresAt: string;
};

export type TranscriptTurn = {
  id: string;
  speaker: TranscriptSpeaker;
  text: string;
  final: boolean;
  createdAt: number;
};

export type RealtimeCallState = {
  phase: CallPhase;
  error: string | null;
  session: SessionMeta | null;
  transcript: TranscriptTurn[];
};

export type RealtimeCallAction =
  | { type: "call/connecting" }
  | { type: "call/connected"; session: SessionMeta }
  | { type: "call/phase"; phase: CallPhase }
  | { type: "call/error"; message: string }
  | { type: "call/clear-error" }
  | { type: "transcript/clear" }
  | {
      type: "transcript/merge";
      payload: {
        id: string;
        speaker: TranscriptSpeaker;
        text: string;
        final?: boolean;
        append?: boolean;
      };
    };
