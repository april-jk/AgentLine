import type { CallbackDecision, ExecutionResult, TaskPacket } from "./types.ts";

export function decideCallback(
  task: TaskPacket,
  execution: ExecutionResult,
): CallbackDecision {
  if (task.openQuestions.length > 0) {
    return {
      type: "call_back",
      reason: "The task packet has unresolved questions.",
      questions: task.openQuestions,
    };
  }

  if (task.requiresHumanApproval) {
    return {
      type: "call_back",
      reason: "The task includes an action that requires human approval.",
      questions: ["Do you approve this task moving into execution?"],
    };
  }

  if (execution.status === "completed") {
    return {
      type: "complete",
      reason: "The executor completed the work during the local loop.",
      statusMessage: execution.message,
    };
  }

  return {
    type: "continue_background",
    reason: "The task is clear enough for background execution.",
    statusMessage: execution.message,
  };
}

