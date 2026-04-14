import {
  type RealtimeCallAction,
  type RealtimeCallState,
  type TranscriptTurn,
} from "./callTypes";

export const initialRealtimeCallState: RealtimeCallState = {
  phase: "idle",
  error: null,
  session: null,
  transcript: [],
};

export function realtimeCallReducer(
  state: RealtimeCallState,
  action: RealtimeCallAction,
): RealtimeCallState {
  switch (action.type) {
    case "call/connecting":
      return {
        ...state,
        phase: "connecting",
        error: null,
      };
    case "call/connected":
      return {
        ...state,
        phase: "listening",
        error: null,
        session: action.session,
      };
    case "call/phase":
      return {
        ...state,
        phase: action.phase,
      };
    case "call/error":
      return {
        ...state,
        phase: "error",
        error: action.message,
      };
    case "call/clear-error":
      return {
        ...state,
        error: null,
      };
    case "transcript/clear":
      return {
        ...state,
        transcript: [],
      };
    case "transcript/merge": {
      const { id, speaker, text, final = false, append = false } = action.payload;
      if (!text.trim()) return state;

      const existingIndex = state.transcript.findIndex((turn) => turn.id === id);
      if (existingIndex === -1) {
        const nextTurn: TranscriptTurn = {
          id,
          speaker,
          text,
          final,
          createdAt: Date.now(),
        };
        return {
          ...state,
          transcript: [...state.transcript, nextTurn],
        };
      }

      const existing = state.transcript[existingIndex]!;
      const nextText = append ? `${existing.text}${text}` : text;
      const updated: TranscriptTurn = {
        ...existing,
        speaker,
        text: nextText,
        final: existing.final || final,
      };
      const nextTranscript = [...state.transcript];
      nextTranscript[existingIndex] = updated;
      return {
        ...state,
        transcript: nextTranscript,
      };
    }
    default:
      return state;
  }
}
