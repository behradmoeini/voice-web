/**
 * Reads ../voice-agent/config/config.yaml and writes .env.local for this app.
 * Syncs: OPENAI_API_KEY, OPENAI_REALTIME_VOICE, OPENAI_REALTIME_MODEL.
 *
 * Usage (from voice-web): npm run sync:env
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const yamlPath = path.join(root, "..", "voice-agent", "config", "config.yaml");
const outPath = path.join(root, ".env.local");

function yamlScalar(text, key) {
  const re = new RegExp(`^\\s*${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^\\s#]+))`, "m");
  const m = text.match(re);
  if (!m) return "";
  return (m[1] ?? m[2] ?? m[3] ?? "").trim();
}

if (!fs.existsSync(yamlPath)) {
  console.error("Missing:", yamlPath);
  process.exit(1);
}

const raw = fs.readFileSync(yamlPath, "utf8");
const apiKey = yamlScalar(raw, "openai_api_key");
const realtimeVoice = yamlScalar(raw, "tts_voice") || "marin";
const realtimeModel = yamlScalar(raw, "llm_model") || "gpt-realtime";

const apiKeyLooksInvalid =
  !apiKey ||
  /^CHANGE_ME$/i.test(apiKey) ||
  /^sk-REPLACE/i.test(apiKey) ||
  apiKey.length < 20;

if (apiKeyLooksInvalid) {
  console.error("openai_api_key in voice-agent config is missing or still a placeholder.");
  process.exit(1);
}

const lines = [
  "# Synced from voice-agent/config/config.yaml - do not commit",
  `OPENAI_API_KEY=${apiKey}`,
  "",
  "# Realtime output voice preset",
  `OPENAI_REALTIME_VOICE=${realtimeVoice}`,
  "",
  "# Realtime model",
  `OPENAI_REALTIME_MODEL=${realtimeModel}`,
  "",
];

fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log("Wrote", outPath);
