export type CallSource = "phone" | "transcript";

export type Caller = {
  displayName: string;
  phoneNumber: string;
};

export type TaskIntent =
  | "agent_work"
  | "create_project"
  | "no_action"
  | "research"
  | "schedule"
  | "unknown";

export type TaskPacket = {
  id: string;
  source: CallSource;
  caller: Caller;
  intent: TaskIntent;
  summary: string;
  transcriptDigest: string;
  openQuestions: string[];
  constraints: string[];
  requiresHumanApproval: boolean;
};

export type ExecutionResult = {
  adapter: "stub";
  status: "accepted" | "blocked" | "completed";
  message: string;
  nextStep: string;
};

export type CallbackDecision =
  | {
      type: "call_back";
      reason: string;
      questions: string[];
    }
  | {
      type: "continue_background";
      reason: string;
      statusMessage: string;
    }
  | {
      type: "complete";
      reason: string;
      statusMessage: string;
    };

export type TranscriptRecord = {
  raw: string;
  normalized: string;
};

export type LocalLoopRun = {
  schemaVersion: "agentline.local-loop.v1";
  runId: string;
  createdAt: string;
  transcript: TranscriptRecord;
  task: TaskPacket;
  execution: ExecutionResult;
  callback: CallbackDecision;
};
