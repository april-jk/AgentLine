export type Caller = {
  displayName: string;
  phoneNumber: string;
};

export type TaskPacket = {
  id: string;
  source: "phone" | "transcript";
  caller: Caller;
  intent: string;
  summary: string;
  openQuestions: string[];
  constraints: string[];
  requiresHumanApproval: boolean;
};

export type CallbackDecision =
  | { type: "no_callback"; reason: string }
  | { type: "call_back"; reason: string; questions: string[] }
  | { type: "send_async_update"; reason: string };

export function createTaskPacket(transcript: string): TaskPacket {
  const normalized = transcript.trim().replace(/\s+/g, " ");

  return {
    id: "task_local_001",
    source: "transcript",
    caller: {
      displayName: "Local Developer",
      phoneNumber: "+10000000000",
    },
    intent: "seed_project",
    summary: normalized || "No transcript provided.",
    openQuestions: normalized ? [] : ["What should AgentLine do first?"],
    constraints: ["Keep the live voice loop low-latency."],
    requiresHumanApproval: false,
  };
}

export function decideCallback(task: TaskPacket): CallbackDecision {
  if (task.openQuestions.length > 0) {
    return {
      type: "call_back",
      reason: "The task still has unresolved questions.",
      questions: task.openQuestions,
    };
  }

  if (task.requiresHumanApproval) {
    return {
      type: "call_back",
      reason: "Human approval is required before execution.",
      questions: ["Do you approve this task?"],
    };
  }

  return {
    type: "no_callback",
    reason: "The task is ready for background execution.",
  };
}

function main() {
  const transcript =
    process.argv.slice(2).join(" ") ||
    "Create the first project repository for a phone-native AI secretary.";
  const task = createTaskPacket(transcript);
  const callback = decideCallback(task);

  console.log(JSON.stringify({ task, callback }, null, 2));
}

main();

