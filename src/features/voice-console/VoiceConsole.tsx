import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useRealtimeCall } from "./useRealtimeCall";
import styles from "./VoiceConsole.module.css";

function formatExpiry(iso: string): string {
  if (!iso) return "n/a";
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "n/a";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

const phaseClassMap = {
  idle: "phaseIdle",
  connecting: "phaseConnecting",
  listening: "phaseListening",
  assistant_speaking: "phaseSpeaking",
  ended: "phaseEnded",
  error: "phaseError",
} as const;

export default function VoiceConsole() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const {
    state,
    statusText,
    statusDetail,
    startupState,
    startupDetail,
    startupChecks,
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
    metrics,
    eventCounts,
    debugLogs,
    serverDebug,
    copyDebugSnapshot,
  } = useRealtimeCall();

  const phaseClass = styles[phaseClassMap[state.phase]];

  const sortedEventCounts = useMemo(
    () =>
      Object.entries(eventCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 14),
    [eventCounts],
  );

  const startDisabledReason = useMemo(() => {
    if (!isSecure) return "Requires HTTPS or localhost";
    if (startupState === "booting") return "Running startup checks";
    if (startupState === "error") return "Startup checks failed";
    return "";
  }, [isSecure, startupState]);

  async function onCopySnapshot() {
    try {
      await copyDebugSnapshot();
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("failed");
      setTimeout(() => setCopyState("idle"), 1800);
    }
  }

  return (
    <>
      <Helmet>
        <title>Praxify Realtime Voice Console</title>
        <meta
          name="description"
          content="Realtime speech-to-speech receptionist console for Praxify."
        />
      </Helmet>

      <div className={styles.page}>
        <main className={styles.grid}>
          <section className={styles.callPanel}>
            <p className={styles.kicker}>Realtime Speech-to-Speech</p>
            <h1 className={styles.heading}>Receptionist Call Console</h1>
            <p className={styles.lead}>
              This build is instrumented for diagnostics. Start a call and inspect timings, event
              volume, and server setup details.
            </p>

            <div className={styles.stateRow}>
              <span className={`${styles.stateChip} ${phaseClass}`}>{statusText}</span>
              <span className={styles.micHint}>
                Mic level: <strong>{Math.round(micLevel * 100)}%</strong>
              </span>
            </div>
            <p className={styles.statusDetail}>{statusDetail}</p>
            <p className={styles.statusDetail}>
              Startup: <strong>{startupState}</strong> - {startupDetail}
            </p>

            <div className={styles.meter} aria-hidden="true">
              <span
                className={styles.meterFill}
                style={{ transform: `scaleX(${Math.max(micLevel, 0.04)})` }}
              />
            </div>

            {!isSecure && (
              <div className={styles.warning} role="status">
                Microphone access requires HTTPS or localhost.
              </div>
            )}

            {state.error && (
              <div className={styles.error} role="alert">
                {state.error}
              </div>
            )}

            <div className={styles.controls}>
              {!isCallActive ? (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => void startCall()}
                  disabled={Boolean(startDisabledReason)}
                  title={startDisabledReason || "Ready"}
                >
                  {startupState === "booting" ? "Preparing..." : "Start call"}
                </button>
              ) : (
                <button type="button" className={styles.dangerBtn} onClick={endCall}>
                  End call
                </button>
              )}
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={clearTranscript}
                disabled={state.transcript.length === 0}
              >
                Clear transcript
              </button>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => void runStartupChecks()}
                disabled={startupState === "booting"}
              >
                {startupState === "booting" ? "Checking..." : "Run startup checks"}
              </button>
              <button type="button" className={styles.secondaryBtn} onClick={() => void runHealthCheck()}>
                Check server health
              </button>
              <button type="button" className={styles.secondaryBtn} onClick={() => void onCopySnapshot()}>
                {copyState === "copied"
                  ? "Snapshot copied"
                  : copyState === "failed"
                    ? "Copy failed"
                    : "Copy debug snapshot"}
              </button>
            </div>

            <dl className={styles.meta}>
              <div>
                <dt>Model</dt>
                <dd>{state.session?.model || "n/a"}</dd>
              </div>
              <div>
                <dt>Voice</dt>
                <dd>{state.session?.voice || "n/a"}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{state.session?.sessionId || "n/a"}</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{formatExpiry(state.session?.expiresAt || "")}</dd>
              </div>
              <div>
                <dt>Health</dt>
                <dd>{healthSummary}</dd>
              </div>
              <div>
                <dt>API Key</dt>
                <dd>
                  {serverDebug?.env?.openaiApiKeyConfigured === true
                    ? "configured"
                    : serverDebug?.env?.openaiApiKeyConfigured === false
                      ? "missing"
                      : "unknown"}
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.transcriptPanel} aria-live="polite">
            <div className={styles.transcriptHeader}>
              <h2>Live Transcript</h2>
              <span>{state.transcript.length} turns</span>
            </div>

            {state.transcript.length === 0 ? (
              <p className={styles.emptyTranscript}>
                Transcript appears here once the conversation starts.
              </p>
            ) : (
              <div className={styles.transcriptFeed}>
                {state.transcript.map((turn) => (
                  <article
                    key={turn.id}
                    className={`${styles.turn} ${
                      turn.speaker === "user" ? styles.turnUser : styles.turnAssistant
                    }`}
                  >
                    <header>
                      <span>{turn.speaker === "user" ? "You" : "Praxify"}</span>
                      <small>{turn.final ? "final" : "streaming"}</small>
                    </header>
                    <p>{turn.text}</p>
                  </article>
                ))}
              </div>
            )}

            <div className={styles.debugSection}>
              <h3>Connection Timings (ms)</h3>
              {metrics.length === 0 ? (
                <p className={styles.emptyDebug}>No call metrics yet.</p>
              ) : (
                <div className={styles.metricsTable}>
                  {metrics.map((metric, index) => (
                    <div key={`${metric.step}-${index}`} className={styles.metricRow}>
                      <span>{metric.step}</span>
                      <span>{metric.durationMs.toFixed(1)}</span>
                      <span>{metric.ok ? "ok" : "fail"}</span>
                    </div>
                  ))}
                </div>
              )}

              <h3>Event Counts</h3>
              {sortedEventCounts.length === 0 ? (
                <p className={styles.emptyDebug}>No server events yet.</p>
              ) : (
                <div className={styles.metricsTable}>
                  {sortedEventCounts.map(([name, count]) => (
                    <div key={name} className={styles.metricRow}>
                      <span>{name}</span>
                      <span>{count}</span>
                      <span>events</span>
                    </div>
                  ))}
                </div>
              )}

              <h3>Debug Logs</h3>
              {debugLogs.length === 0 ? (
                <p className={styles.emptyDebug}>No debug logs yet.</p>
              ) : (
                <div className={styles.logBox}>
                  {debugLogs.map((entry, index) => (
                    <div key={`${entry.ts}-${index}`}>{`${entry.ts} ${entry.message}`}</div>
                  ))}
                </div>
              )}

              <h3>Startup Checks</h3>
              {startupChecks.length === 0 ? (
                <p className={styles.emptyDebug}>No startup checks yet.</p>
              ) : (
                <div className={styles.metricsTable}>
                  {startupChecks.map((check, index) => (
                    <div key={`${check.step}-${index}`} className={styles.metricRow}>
                      <span>{check.step}</span>
                      <span>{check.durationMs.toFixed(1)}</span>
                      <span>{check.ok ? "ok" : "fail"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>

        <audio ref={remoteAudioRef} autoPlay playsInline className={styles.hiddenAudio} />
      </div>
    </>
  );
}
