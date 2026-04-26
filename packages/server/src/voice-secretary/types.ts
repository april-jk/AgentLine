export type CallChannel =
  | "web-voice"
  | "phone"
  | "telegram"
  | "feishu"
  | "simulated";

export type CallSessionStatus =
  | "active"
  | "waiting_for_planner"
  | "waiting_for_executor"
  | "waiting_for_user"
  | "callback_scheduled"
  | "completed"
  | "failed";

export interface TranscriptTurn {
  id: string;
  at: string;
  speaker: "user" | "talker" | "system";
  text: string;
  source: "asr" | "tts" | "typed" | "system";
  confidence?: number;
}

export interface CallSession {
  id: string;
  channel: CallChannel;
  status: CallSessionStatus;
  startedAt: string;
  endedAt?: string;
  projectPath?: string;
  transcript: TranscriptTurn[];
  plannerRuns: PlannerRunRef[];
  callbackRequests: CallbackRequest[];
}

export interface PlannerRunRef {
  id: string;
  requestId: string;
  status: "completed" | "failed";
}

export interface CallbackRequest {
  id: string;
  reason:
    | "missing_information"
    | "approval_required"
    | "execution_finished"
    | "execution_failed"
    | "scheduled_update";
  priority: "normal" | "urgent";
  script: string;
}

export interface PlannerRequest {
  id: string;
  callSessionId: string;
  projectPath: string;
  userIntent: string;
  conversationSummary: string;
  knownConstraints: string[];
  missingInformation: string[];
  urgency: "low" | "normal" | "high";
  requestedOutcome:
    | "answer"
    | "plan"
    | "implementation"
    | "investigation"
    | "status_check";
}

export interface InstructionReference {
  path: string;
  summary: string;
}

export interface PlannerResult {
  id: string;
  requestId: string;
  projectSummary: string;
  relevantInstructions: InstructionReference[];
  recommendedAction: "ask_user" | "create_executor_session" | "answer_directly";
  talkerBrief: TalkerBrief;
  executionTask?: ExecutionTask;
  callbackDecision: CallbackDecision;
}

export type ExecutorProvider = "codex" | "claude" | "opencode" | "gemini";

export interface ExecutionTask {
  id: string;
  projectPath: string;
  provider: ExecutorProvider;
  mode: "read_only" | "implementation" | "test" | "review";
  prompt: string;
  acceptanceCriteria: string[];
  riskNotes: string[];
  requiredVerification: string[];
}

export interface ExecutorLink {
  label: string;
  href: string;
}

export interface ExecutorReport {
  executionTaskId: string;
  providerSessionId: string;
  status:
    | "queued"
    | "started"
    | "completed"
    | "failed"
    | "needs_user"
    | "cancelled";
  summary: string;
  changedFiles?: string[];
  verification?: string[];
  questionsForUser?: string[];
  links?: ExecutorLink[];
}

export interface TalkerBrief {
  spokenSummary: string;
  suggestedNextUtterance: string;
  factsToAvoidOverstating: string[];
  questionsToAsk: string[];
}

export interface CallbackDecision {
  required: boolean;
  reason?:
    | "missing_information"
    | "approval_required"
    | "execution_finished"
    | "execution_failed"
    | "scheduled_update";
  priority?: "normal" | "urgent";
  suggestedWindow?: string;
  script?: string;
}

export interface ExecutorAgentAdapter {
  createSession(task: ExecutionTask): Promise<ExecutorSessionRef>;
  getReport(sessionId: string): Promise<ExecutorReport>;
}

export interface ExecutorSessionRef {
  id: string;
  provider: ExecutorProvider;
  taskId: string;
}

export interface SimulatedCallInput {
  projectPath: string;
  utterance: string;
}

export interface SimulatedCallResult {
  callSession: CallSession;
  plannerRequest: PlannerRequest;
  plannerResult: PlannerResult;
  executorReport: ExecutorReport;
  finalBrief: TalkerBrief;
}
