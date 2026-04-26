# Voice Secretary Contracts

These contracts are intentionally provider-neutral. They should live in shared
types once implementation begins.

## CallSession

```ts
type CallChannel = "web-voice" | "phone" | "telegram" | "feishu" | "simulated";

type CallSessionStatus =
  | "active"
  | "waiting_for_planner"
  | "waiting_for_executor"
  | "waiting_for_user"
  | "callback_scheduled"
  | "completed"
  | "failed";

interface CallSession {
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
```

## TranscriptTurn

```ts
interface TranscriptTurn {
  id: string;
  at: string;
  speaker: "user" | "talker" | "system";
  text: string;
  source: "asr" | "tts" | "typed" | "system";
  confidence?: number;
}
```

## PlannerRequest

```ts
interface PlannerRequest {
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
```

## PlannerResult

```ts
interface PlannerResult {
  id: string;
  requestId: string;
  projectSummary: string;
  relevantInstructions: InstructionReference[];
  recommendedAction: "ask_user" | "create_executor_session" | "answer_directly";
  talkerBrief: TalkerBrief;
  executionTask?: ExecutionTask;
  callbackDecision: CallbackDecision;
}
```

## ExecutionTask

An `ExecutionTask` is a handoff to a real AgentLine provider session. It is not
executed by the ProjectPlanner.

```ts
type ExecutorProvider = "codex" | "claude" | "opencode" | "gemini";

interface ExecutionTask {
  id: string;
  projectPath: string;
  provider: ExecutorProvider;
  mode: "read_only" | "implementation" | "test" | "review";
  prompt: string;
  acceptanceCriteria: string[];
  riskNotes: string[];
  requiredVerification: string[];
}
```

## ExecutorReport

```ts
interface ExecutorReport {
  executionTaskId: string;
  providerSessionId: string;
  status: "completed" | "failed" | "needs_user" | "cancelled";
  summary: string;
  changedFiles?: string[];
  verification?: string[];
  questionsForUser?: string[];
  links?: ExecutorLink[];
}
```

## TalkerBrief

The TalkerBrief is what the real-time secretary can safely say.

```ts
interface TalkerBrief {
  spokenSummary: string;
  suggestedNextUtterance: string;
  factsToAvoidOverstating: string[];
  questionsToAsk: string[];
}
```

## CallbackDecision

```ts
interface CallbackDecision {
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
```

## Adapter Interfaces

```ts
interface AudioInput {
  stream: AsyncIterable<ArrayBuffer>;
  encoding: "pcm" | "wav" | "webm" | "ogg_opus";
  sampleRate: number;
  channels: 1 | 2;
}

interface AudioOutput {
  bytes: ArrayBuffer;
  encoding: "mp3" | "wav" | "pcm" | "ogg_opus";
  sampleRate?: number;
}

interface TTSOptions {
  voiceType?: string;
  encoding?: AudioOutput["encoding"];
  speedRatio?: number;
  volumeRatio?: number;
  pitchRatio?: number;
}

interface ASRAdapter {
  start(input: AudioInput): AsyncIterable<TranscriptTurn>;
}

interface TTSAdapter {
  speak(text: string, options?: TTSOptions): Promise<AudioOutput>;
}

interface ChannelAdapter {
  receive(): AsyncIterable<ChannelEvent>;
  send(event: ChannelOutput): Promise<void>;
  callback?(request: CallbackRequest): Promise<void>;
}

interface ExecutorAgentAdapter {
  createSession(task: ExecutionTask): Promise<ExecutorSessionRef>;
  getReport(sessionId: string): Promise<ExecutorReport>;
}
```

## Volcengine Provider Config

```ts
interface VolcengineSpeechConfig {
  appId: string;
  accessToken: string;
  asr: {
    endpoint: string;
    cluster: string;
    language?: string;
  };
  tts: {
    endpoint: string;
    cluster: string;
    voiceType: string;
    audioEncoding: AudioOutput["encoding"];
  };
}
```

Load this config from server-side environment variables only. Do not expose it
to browser clients or provider sessions.

## Naming Rule

Use these names consistently:
- `Talker` for the realtime secretary
- `ProjectPlanner` for read-only context analysis and dispatch
- `ExecutorAgentSession` for write-capable provider sessions

Avoid calling the ProjectPlanner a worker in code. "Worker" implies execution
and can blur the no-write boundary.
