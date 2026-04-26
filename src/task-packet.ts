import { createHash } from "node:crypto";
import type { CallSource, Caller, TaskIntent, TaskPacket } from "./types.ts";

export type TaskPacketInput = {
  transcript: string;
  source?: CallSource;
  caller?: Partial<Caller>;
};

const DEFAULT_CALLER: Caller = {
  displayName: "Local Developer",
  phoneNumber: "+10000000000",
};

export function normalizeTranscript(transcript: string): string {
  return transcript.trim().replace(/\s+/g, " ");
}

export function createTaskPacket(input: TaskPacketInput): TaskPacket {
  const normalized = normalizeTranscript(input.transcript);
  const caller = {
    ...DEFAULT_CALLER,
    ...input.caller,
  };

  const transcriptDigest = hashText(normalized || "empty-transcript", 16);
  const intent = inferIntent(normalized);
  const openQuestions = inferOpenQuestions(normalized, intent);
  const requiresHumanApproval = inferApprovalNeed(normalized);

  return {
    id: `task_${hashText(`${caller.phoneNumber}:${normalized}`, 12)}`,
    source: input.source ?? "transcript",
    caller,
    intent,
    summary: summarizeTranscript(normalized),
    transcriptDigest,
    openQuestions,
    constraints: inferConstraints(normalized),
    requiresHumanApproval,
  };
}

function hashText(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function inferIntent(transcript: string): TaskIntent {
  const lower = transcript.toLowerCase();

  if (!lower) {
    return "unknown";
  }

  if (includesAny(lower, ["thanks", "thank you", "never mind", "nevermind", "all good"])) {
    return "no_action";
  }

  if (
    includesAny(lower, [
      "create repo",
      "create repository",
      "new project",
      "initialize",
      "scaffold",
      "mvp",
    ])
  ) {
    return "create_project";
  }

  if (includesAny(lower, ["research", "investigate", "find projects", "github"])) {
    return "research";
  }

  if (includesAny(lower, ["schedule", "calendar", "appointment", "meeting"])) {
    return "schedule";
  }

  if (includesAny(lower, ["codex", "claude", "agent", "execute", "implement"])) {
    return "agent_work";
  }

  return "unknown";
}

function inferOpenQuestions(transcript: string, intent: TaskIntent): string[] {
  if (!transcript) {
    return ["What should AgentLine do first?"];
  }

  if (intent === "unknown") {
    return ["What outcome should the agent produce?"];
  }

  if (intent === "no_action") {
    return [];
  }

  if (transcript.length < 24) {
    return ["Can you provide one more sentence of context?"];
  }

  return [];
}

function inferApprovalNeed(transcript: string): boolean {
  const lower = transcript.toLowerCase();
  return includesAny(lower, [
    "delete",
    "remove production",
    "deploy",
    "payment",
    "purchase",
    "send money",
    "wire",
    "private key",
  ]);
}

function inferConstraints(transcript: string): string[] {
  const lower = transcript.toLowerCase();
  const constraints = new Set<string>();

  if (includesAny(lower, ["fast", "latency", "low latency", "real-time", "realtime"])) {
    constraints.add("Keep the live voice loop low-latency.");
  }

  if (includesAny(lower, ["phone", "call", "callback", "call back"])) {
    constraints.add("Treat phone/callback behavior as a first-class workflow.");
  }

  if (includesAny(lower, ["open source", "opensource", "github"])) {
    constraints.add("Keep the project suitable for open-source development.");
  }

  if (includesAny(lower, ["codex", "claude code", "agent"])) {
    constraints.add("Keep agent execution behind an adapter boundary.");
  }

  if (constraints.size === 0) {
    constraints.add("Keep the first loop narrow and verifiable.");
  }

  return [...constraints];
}

function summarizeTranscript(transcript: string): string {
  if (!transcript) {
    return "No transcript provided.";
  }

  if (transcript.length <= 220) {
    return transcript;
  }

  return `${transcript.slice(0, 217)}...`;
}

function includesAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}
