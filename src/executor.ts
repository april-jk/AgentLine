import type { ExecutionResult, TaskPacket } from "./types.ts";

export function runStubExecutor(task: TaskPacket): ExecutionResult {
  if (task.intent === "no_action") {
    return {
      adapter: "stub",
      status: "completed",
      message: "No background agent work is needed.",
      nextStep: "Close the loop without a callback.",
    };
  }

  if (task.openQuestions.length > 0) {
    return {
      adapter: "stub",
      status: "blocked",
      message: "Stub executor did not start because the task needs more human input.",
      nextStep: "Ask the caller the open questions.",
    };
  }

  if (task.requiresHumanApproval) {
    return {
      adapter: "stub",
      status: "blocked",
      message: "Stub executor did not start because human approval is required.",
      nextStep: "Call back for explicit approval.",
    };
  }

  return {
    adapter: "stub",
    status: "accepted",
    message: `Stub executor accepted ${task.id} with intent ${task.intent}.`,
    nextStep: "Dispatch to a real Codex, Claude Code, or custom agent adapter.",
  };
}
