import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

interface DebugCaptureEvent {
  type: string;
  at?: string;
  [key: string]: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function appendVoiceSecretaryDebugCapture(
  dataDir: string | undefined,
  event: DebugCaptureEvent,
): Promise<void> {
  if (!dataDir) return;
  const dir = path.join(dataDir, "debug", "voice-secretary");
  const file = path.join(dir, "captures.jsonl");
  await mkdir(dir, { recursive: true });
  await appendFile(
    file,
    `${JSON.stringify({
      at: event.at ?? nowIso(),
      ...event,
    })}\n`,
    "utf8",
  );
}
