import { randomUUID } from "node:crypto";
import type {
  ExecutionTask,
  ProjectKnowledgeIndex,
  TalkerProjectMemory,
} from "./types.js";

export function needsProjectInitialization(
  memory: TalkerProjectMemory | undefined,
): boolean {
  if (!memory) return true;
  return !memory.workerFindings.some(
    (finding) => finding.source === "initializer",
  );
}

export function buildProjectInitializationTask(input: {
  projectPath: string;
  projectIndex: ProjectKnowledgeIndex;
  conversationSessionId?: string;
  provider: ExecutionTask["provider"];
}): ExecutionTask {
  return {
    id: randomUUID(),
    projectPath: input.projectPath,
    conversationSessionId: input.conversationSessionId,
    provider: input.provider,
    purpose: "project-initialization",
    mode: "read_only",
    prompt: [
      "You are initializing persistent project memory for AgentLine Voice Secretary.",
      "Do not modify files. Read the project as a project expert and produce stable, concise facts for future spoken answers.",
      "",
      `Project name: ${input.projectIndex.projectName}`,
      "Initialization goals:",
      "- confirm the project positioning in plain language",
      "- summarize current capabilities that are already real",
      "- summarize the current Voice Secretary status",
      "- summarize the most important current focus or next step",
      "- avoid markdown, file paths, and long code-oriented wording",
      "",
      "Return a concise project-grounded summary that can be reused as durable memory.",
    ].join("\n"),
    acceptanceCriteria: [
      "The Worker returns a concise reusable project summary.",
      "The summary is grounded in current project files and recent commits.",
      "No file modifications are made.",
    ],
    riskNotes: [
      "Initialization should stay read-only and cheap enough for the first project use.",
    ],
    requiredVerification: [
      "Confirm the summary can be reused for future spoken project answers.",
    ],
  };
}
