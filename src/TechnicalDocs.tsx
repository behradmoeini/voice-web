import { Helmet } from "react-helmet-async";
import styles from "./TechnicalDocs.module.css";

export default function TechnicalDocs() {
  return (
    <>
      <Helmet>
        <title>Praxify Voice System Technical Documentation</title>
        <meta
          name="description"
          content="Architecture, design rationale, and maintenance guide for the realtime voice test system."
        />
      </Helmet>

      <main className={styles.page}>
        <article className={styles.doc}>
          <header className={styles.hero}>
            <p className={styles.kicker}>Engineering Reference</p>
            <h1>Realtime Speech-to-Speech System Design</h1>
            <p>
              This document is the implementation-level guide for developers working on the Praxify
              voice test system. It prioritizes design rationale, architecture tradeoffs, and
              maintenance practices so the team can iterate safely and measure bottlenecks.
            </p>
            <p>
              Canonical markdown version: <a href="/TECHNICAL_DESIGN.md">/TECHNICAL_DESIGN.md</a>
            </p>
          </header>

          <section>
            <h2>1. Purpose and Design Intent</h2>
            <p>
              The current website is an internal test harness, not an end-user UI. The goal is to
              optimize call quality, latency, reliability, and observability before integrating into
              production call surfaces.
            </p>
            <div className={styles.callout}>
              <h3>Primary design goals</h3>
              <ul>
                <li>Low-latency speech-to-speech via OpenAI Realtime over WebRTC.</li>
                <li>Server-side key protection using ephemeral client secrets.</li>
                <li>Debug-first UX: timings, event counts, health checks, and snapshot export.</li>
                <li>Stateless deployment model compatible with Vercel serverless execution.</li>
                <li>Fast iteration with explicit state transitions and modular frontend boundaries.</li>
              </ul>
            </div>
          </section>

          <section>
            <h2>2. High-Level Architecture</h2>
            <p>The system has three active runtime zones with clear responsibilities:</p>
            <div className={styles.grid3}>
              <div>
                <h3>Browser</h3>
                <ul>
                  <li>Captures microphone audio.</li>
                  <li>Creates WebRTC peer connection and data channel.</li>
                  <li>Renders transcripts and diagnostics.</li>
                  <li>Executes barge-in behavior by cancelling active responses.</li>
                </ul>
              </div>
              <div>
                <h3>Vercel API</h3>
                <ul>
                  <li>Validates environment configuration.</li>
                  <li>Builds receptionist instructions from site knowledge prompt source.</li>
                  <li>Mints ephemeral realtime client secret.</li>
                  <li>Returns debug timing + upstream request metadata.</li>
                </ul>
              </div>
              <div>
                <h3>OpenAI Realtime</h3>
                <ul>
                  <li>Handles speech input/output generation.</li>
                  <li>Publishes realtime lifecycle events over data channel.</li>
                  <li>Streams model audio on remote media track.</li>
                </ul>
              </div>
            </div>

            <h3>High-Level Runtime Diagram</h3>
            <div className={styles.archDiagram} role="img" aria-label="High-level architecture diagram">
              <div className={styles.archRow}>
                <div className={styles.archNode}>
                  <h4>Browser Console</h4>
                  <p>UI, transcript, diagnostics, and microphone control.</p>
                </div>
                <div className={styles.archArrow} aria-hidden="true">
                  POST /api/realtime-session
                </div>
                <div className={styles.archNode}>
                  <h4>Vercel API</h4>
                  <p>Builds grounded prompt and mints ephemeral client secret.</p>
                </div>
                <div className={styles.archArrow} aria-hidden="true">
                  POST /v1/realtime/client_secrets
                </div>
                <div className={styles.archNode}>
                  <h4>OpenAI Realtime</h4>
                  <p>Realtime model, audio generation, transcription and event stream.</p>
                </div>
              </div>
              <div className={styles.archBackRow}>
                <span>Browser receives client secret + metadata</span>
                <span>Then browser negotiates WebRTC directly with OpenAI</span>
                <span>Data channel events + remote assistant audio stream back to browser</span>
              </div>
            </div>

            <h3>Low-Level Startup Diagram</h3>
            <div className={styles.sequenceDiagram} role="img" aria-label="Low-level startup sequence diagram">
              <div className={styles.sequenceHeader}>
                <span>Browser</span>
                <span>Vercel API</span>
                <span>OpenAI Realtime</span>
              </div>
              <div className={styles.sequenceStep}>
                <span>Page load: run startup checks</span>
                <span>-</span>
                <span>-</span>
              </div>
              <div className={styles.sequenceStep}>
                <span>GET /api/realtime-session (health)</span>
                <span>Validate env + defaults</span>
                <span>-</span>
              </div>
              <div className={styles.sequenceStep}>
                <span>POST /api/realtime-session</span>
                <span>Build prompt; mint secret</span>
                <span>Issue client secret</span>
              </div>
              <div className={styles.sequenceStep}>
                <span>Create RTCPeerConnection + data channel</span>
                <span>-</span>
                <span>-</span>
              </div>
              <div className={styles.sequenceStep}>
                <span>POST /v1/realtime/calls (SDP)</span>
                <span>-</span>
                <span>Return answer SDP</span>
              </div>
              <div className={styles.sequenceStep}>
                <span>Wait for data channel open</span>
                <span>-</span>
                <span>Realtime session ready</span>
              </div>
              <div className={styles.sequenceStep}>
                <span>Enable Start Call button</span>
                <span>-</span>
                <span>-</span>
              </div>
              <div className={styles.sequenceStep}>
                <span>On Start Call: request mic and attach track</span>
                <span>-</span>
                <span>Begin receptionist response flow</span>
              </div>
            </div>
          </section>

          <section>
            <h2>3. Frontend Structure and Rationale</h2>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Role</th>
                  <th>Why this split exists</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>`useRealtimeCall.ts`</td>
                  <td>Session lifecycle, WebRTC wiring, event processing, diagnostics pipeline.</td>
                  <td>Keeps side-effect heavy protocol logic separate from rendering.</td>
                </tr>
                <tr>
                  <td>`callTypes.ts` + `callReducer.ts`</td>
                  <td>Canonical call phase model + transcript merge behavior.</td>
                  <td>Enforces predictable state transitions and simplifies debugging.</td>
                </tr>
                <tr>
                  <td>`useAudioMeter.ts`</td>
                  <td>Microphone level analysis via `AnalyserNode`.</td>
                  <td>Isolates DSP concerns; easy to tune/replace.</td>
                </tr>
                <tr>
                  <td>`VoiceConsole.tsx`</td>
                  <td>Debug UI, controls, metrics, event count and log visualization.</td>
                  <td>Test operators can inspect runtime health without opening DevTools.</td>
                </tr>
                <tr>
                  <td>`App.tsx`</td>
                  <td>Shell and mode switch between console and documentation.</td>
                  <td>Documentation is available in-product for every test session.</td>
                </tr>
              </tbody>
            </table>

            <h3>State machine decisions</h3>
            <ul>
              <li>
                `connecting`, `listening`, `assistant_speaking`, `error`, and `ended` are explicit
                states to avoid ambiguous UI behavior.
              </li>
              <li>
                Startup preconnect runs before call start; `Start call` is disabled until WebRTC +
                data channel are ready.
              </li>
              <li>
                Transcript updates are normalized by event id and merged incrementally (delta +
                final events).
              </li>
              <li>
                Barge-in is intentionally conservative with cooldown (`BARGE_IN_COOLDOWN_MS`) to
                prevent repeated cancel spam.
              </li>
            </ul>
          </section>

          <section>
            <h2>4. Backend Contract and Design Decisions</h2>
            <p>
              Endpoint: `POST /api/realtime-session` in `api/realtime-session.ts`.
            </p>
            <p>
              The API never returns `OPENAI_API_KEY`; only ephemeral `clientSecret` and non-secret
              metadata are sent to the browser.
            </p>
            <h3>Response contract</h3>
            <pre className={styles.code}>{`{
  "clientSecret": "ek_...",
  "model": "gpt-realtime",
  "voice": "marin",
  "expiresAt": "ISO-8601",
  "sessionId": "...",
  "instructionHash": "...",
  "debug": {
    "requestId": "uuid",
    "env": { "openaiApiKeyConfigured": true },
    "timingsMs": {
      "instructionBuild": 0.4,
      "openaiRequest": 253.5,
      "total": 258.4
    },
    "upstreamRequestId": "..."
  }
}`}</pre>

            <h3>Operational health endpoint</h3>
            <p>
              `GET /api/realtime-session` returns config status + defaults so operators can verify
              deployment health before testing audio.
            </p>

            <h3>Why timing fields are emitted</h3>
            <ul>
              <li>
                `instructionBuild` isolates server prompt assembly overhead from upstream network
                cost.
              </li>
              <li>`openaiRequest` captures token mint latency to detect backend bottlenecks.</li>
              <li>
                `total` provides a single number for session startup trend dashboards.
              </li>
            </ul>
          </section>

          <section>
            <h2>5. Debugging and Bottleneck Method</h2>
            <h3>On-page instrumentation</h3>
            <ul>
              <li>Connection Timings panel for startup steps.</li>
              <li>Event Counts panel for protocol event throughput.</li>
              <li>Debug Logs panel with timestamped local decisions and failures.</li>
              <li>
                Copy Debug Snapshot button exports structured JSON suitable for support/debug chats.
              </li>
            </ul>

            <h3>Bottleneck triage sequence</h3>
            <ol>
              <li>Run "Check server health" and verify `OPENAI_API_KEY` is configured.</li>
              <li>Start a call and review `POST /api/realtime-session` timing.</li>
              <li>Compare `POST /v1/realtime/calls` timing vs `RTC data channel open` timing.</li>
              <li>Inspect event counts for missing transcription/response lifecycle events.</li>
              <li>Copy snapshot and attach it to issue reports.</li>
            </ol>

            <h3>Interpretation guide</h3>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Likely issue</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>High `POST /api/realtime-session`</td>
                  <td>OpenAI token mint latency or network path</td>
                  <td>Compare regions, inspect `upstreamRequestId` logs.</td>
                </tr>
                <tr>
                  <td>`POST /v1/realtime/calls` failure</td>
                  <td>SDP negotiation / token validity</td>
                  <td>Inspect response body + ensure recent client secret.</td>
                </tr>
                <tr>
                  <td>No transcript events, audio connected</td>
                  <td>Mic capture or event handling mismatch</td>
                  <td>Validate mic permission + check `input_audio_buffer.*` counts.</td>
                </tr>
                <tr>
                  <td>Frequent connection drops</td>
                  <td>Network instability / peer state transitions</td>
                  <td>Use debug logs and retry across networks/devices.</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h2>6. Maintenance Guide for Developers</h2>
            <h3>Change boundaries</h3>
            <ul>
              <li>
                Protocol/lifecycle changes go in `useRealtimeCall.ts` first, then UI bindings in
                `VoiceConsole.tsx`.
              </li>
              <li>
                State model changes must update `callTypes.ts`, `callReducer.ts`, and diagnostics
                snapshot schema in one commit.
              </li>
              <li>
                Server response shape changes must preserve backward compatibility for debug fields
                where possible.
              </li>
            </ul>

            <h3>Safe extension patterns</h3>
            <ul>
              <li>Add new metrics with stable `step` names to preserve trend comparability.</li>
              <li>
                If new realtime events are consumed, increment event counts and add explicit
                logging rules.
              </li>
              <li>
                Keep prompt authority centralized in `server/site-assistant-knowledge.ts`.
              </li>
            </ul>

            <h3>Recommended regression checks</h3>
            <ul>
              <li>Build: `npm run build`.</li>
              <li>Health endpoint returns configured status in target environment.</li>
              <li>Call startup shows all critical steps with non-zero timings.</li>
              <li>Barge-in still cancels assistant when user starts speaking.</li>
              <li>Snapshot copy contains metrics, event counts, and logs.</li>
            </ul>
          </section>

          <section>
            <h2>7. Security, Privacy, and Data Handling</h2>
            <ul>
              <li>API key remains server-only; browser receives short-lived client secret.</li>
              <li>No transcript persistence in backend for current test harness.</li>
              <li>Health endpoint exposes configuration booleans, not secret values.</li>
              <li>
                Debug snapshot may include transcripts and user-agent data; share only in trusted
                internal channels.
              </li>
            </ul>
          </section>

          <section>
            <h2>8. Operations and Commands</h2>
            <pre className={styles.code}>{`# local development
npm install
npm run dev:vercel

# production build check
npm run build

# health (local)
curl -s http://localhost:3000/api/realtime-session

# health (deployed)
curl -s https://voice-web-rust.vercel.app/api/realtime-session

# mint session debug payload
curl -s -X POST https://voice-web-rust.vercel.app/api/realtime-session

# deployment inspect
npx vercel inspect voice-web-rust.vercel.app

# runtime logs (CLI auth required)
npx vercel logs voice-web-rust.vercel.app --since=1h`}</pre>
          </section>

          <section>
            <h2>9. Known Limits and Next Steps</h2>
            <ul>
              <li>Session debug metrics are startup-focused; no long-term persistence yet.</li>
              <li>
                Event counts are process-local and reset per page session; no aggregated backend
                analytics yet.
              </li>
              <li>
                For future production call use: add structured log ingestion, percentile latency
                dashboards, and synthetic probes.
              </li>
            </ul>
          </section>
        </article>
      </main>
    </>
  );
}
