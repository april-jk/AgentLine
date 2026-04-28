import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { getAllProviders } from "../sdk/providers/index.js";
import { CodexEphemeralTalker } from "./codex-ephemeral.js";
import {
  VoiceSecretaryTalkerLlm,
  getVoiceSecretaryLlmConfig,
} from "./talker-llm.js";
import type {
  AvailableVoiceProvider,
  CallChannel,
  CallSession,
  CallbackDecision,
  ExecutionTask,
  ExecutorAgentAdapter,
  ExecutorReport,
  ExecutorSessionRef,
  InstructionReference,
  PlannerRequest,
  PlannerResult,
  SimulatedCallInput,
  SimulatedCallResult,
  TalkerBrief,
  TranscriptTurn,
  VoiceProviderCatalog,
} from "./types.js";

const MAX_INSTRUCTION_CHARS = 900;
const MAX_PROJECT_SUMMARY_FILES = 8;

function nowIso(): string {
  return new Date().toISOString();
}

function createTranscriptTurn(
  speaker: TranscriptTurn["speaker"],
  text: string,
  source: TranscriptTurn["source"],
): TranscriptTurn {
  return {
    id: randomUUID(),
    at: nowIso(),
    speaker,
    text,
    source,
  };
}

function ensureInsideProject(projectPath: string, filePath: string): boolean {
  const root = resolve(projectPath);
  const candidate = resolve(filePath);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function summarizeText(text: string): string {
  const normalized = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  return normalized.slice(0, MAX_INSTRUCTION_CHARS);
}

async function readInstructionFile(
  projectPath: string,
  filePath: string,
): Promise<InstructionReference | null> {
  if (!ensureInsideProject(projectPath, filePath)) return null;

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;
    const content = await readFile(filePath, "utf-8");
    const path = relative(projectPath, filePath) || basename(filePath);
    return { path, summary: summarizeText(content) };
  } catch {
    return null;
  }
}

async function discoverInstructionFiles(
  projectPath: string,
): Promise<InstructionReference[]> {
  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "package.json",
    "docs/README.md",
    "docs/roadmap/README.md",
    "docs/features/voice-secretary/README.md",
  ].map((path) => join(projectPath, path));

  const refs: InstructionReference[] = [];
  for (const candidate of candidates) {
    const ref = await readInstructionFile(projectPath, candidate);
    if (ref) refs.push(ref);
  }

  return refs;
}

async function listTopLevelEntries(projectPath: string): Promise<string[]> {
  try {
    const entries = await readdir(projectPath, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .slice(0, MAX_PROJECT_SUMMARY_FILES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
  } catch {
    return [];
  }
}

function chooseRequestedOutcome(
  utterance: string,
): PlannerRequest["requestedOutcome"] {
  const normalized = utterance.toLowerCase();
  if (
    /fix|bug|实现|修改|完善|修复|增加|新增|build|feature|ship/.test(normalized)
  ) {
    return "implementation";
  }
  if (/review|审查|评审/.test(normalized)) {
    return "investigation";
  }
  if (/test|验证|回归|check/.test(normalized)) {
    return "status_check";
  }
  if (/plan|规划|方案|下一步|roadmap/.test(normalized)) {
    return "plan";
  }
  return "answer";
}

function chooseExecutionMode(
  outcome: PlannerRequest["requestedOutcome"],
): ExecutionTask["mode"] {
  switch (outcome) {
    case "implementation":
      return "implementation";
    case "status_check":
      return "test";
    case "investigation":
      return "review";
    default:
      return "read_only";
  }
}

function summarizeProviderCatalog(providers: AvailableVoiceProvider[]): string {
  if (providers.length === 0) {
    return "当前没有检测到可立即复用的正式 provider，会默认回退到 Codex。";
  }
  return `当前可用 provider：${providers.map((provider) => provider.displayName).join("、")}。`;
}

async function listAvailableProviders(): Promise<AvailableVoiceProvider[]> {
  const providers = await Promise.all(
    getAllProviders().map(async (provider) => {
      const auth = await provider.getAuthStatus();
      return {
        name: provider.name,
        displayName: provider.displayName,
        installed: auth.installed,
        authenticated: auth.authenticated,
        enabled: auth.enabled,
      };
    }),
  );

  const uniqueProviders = new Map<string, AvailableVoiceProvider>();
  for (const provider of providers) {
    if (!provider.installed || (!provider.authenticated && !provider.enabled)) {
      continue;
    }
    if (!uniqueProviders.has(provider.name)) {
      uniqueProviders.set(provider.name, provider);
    }
  }

  return [...uniqueProviders.values()];
}

function chooseExecutorProvider(
  request: PlannerRequest,
  providers: AvailableVoiceProvider[],
): ExecutionTask["provider"] {
  if (request.conversationProvider) {
    return request.conversationProvider;
  }

  const preferredOrder: ExecutionTask["provider"][] = [
    "codex",
    "claude",
    "opencode",
    "gemini",
    "claude-ollama",
    "codex-oss",
    "gemini-acp",
  ];
  const available = new Set(providers.map((provider) => provider.name));
  return preferredOrder.find((provider) => available.has(provider)) ?? "codex";
}

export class VoiceSecretaryTalker {
  constructor(
    private readonly codexTalker: Pick<
      CodexEphemeralTalker,
      "createOpeningText" | "createFinalBrief"
    > = new CodexEphemeralTalker(),
    private readonly llm: Pick<
      VoiceSecretaryTalkerLlm,
      "createOpeningText" | "createFinalBrief"
    > = new VoiceSecretaryTalkerLlm(getVoiceSecretaryLlmConfig()),
  ) {}

  async createOpeningTurn(input: SimulatedCallInput): Promise<TranscriptTurn> {
    const projectName = basename(input.projectPath);
    const workerContextLabel =
      input.conversationSessionId !== undefined
        ? `对话 ${input.conversationSessionId}`
        : `${projectName} 项目`;
    const codexOpening = await this.codexTalker.createOpeningText(
      input,
      workerContextLabel,
    );
    const llmOpening = codexOpening
      ? codexOpening
      : await this.llm.createOpeningText(input, workerContextLabel);
    return createTranscriptTurn(
      "talker",
      llmOpening ??
        `收到。我先快速记录你的需求，然后以 ${workerContextLabel} 作为 Worker 上下文，稍后给你一个简短结论。`,
      "tts",
    );
  }

  createPlannerRequest(
    callSession: CallSession,
    input: SimulatedCallInput,
  ): PlannerRequest {
    return {
      id: randomUUID(),
      callSessionId: callSession.id,
      projectPath: input.projectPath,
      conversationSessionId: input.conversationSessionId,
      conversationProvider: input.conversationProvider,
      userIntent: input.utterance,
      conversationSummary: `用户通过模拟通话提出需求：${input.utterance}`,
      knownConstraints: [
        "Talker 只负责低延迟对话，不读取完整项目或修改文件。",
        "ProjectPlanner 只能做只读项目理解和任务下发。",
        input.conversationSessionId
          ? "Worker 必须复用用户选择的既有对话上下文。"
          : "缺省时 Worker 挂载到项目并创建新的正式执行会话。",
        "真实修改必须交给 ExecutorAgentSession。",
      ],
      missingInformation: [],
      urgency: "normal",
      requestedOutcome: chooseRequestedOutcome(input.utterance),
    };
  }

  async createFinalBrief(
    plannerResult: PlannerResult,
    executorReport: ExecutorReport,
  ): Promise<TalkerBrief> {
    const codexBrief = await this.codexTalker.createFinalBrief(
      plannerResult,
      executorReport,
    );
    const llmBrief = codexBrief
      ? codexBrief
      : await this.llm.createFinalBrief(plannerResult, executorReport);
    if (llmBrief) {
      return {
        ...llmBrief,
        factsToAvoidOverstating: [
          ...llmBrief.factsToAvoidOverstating,
          "Worker 的本轮任务包和正式执行会话是分开的，不能把排队或启动说成已经改完。",
        ],
      };
    }

    const firstQuestion =
      plannerResult.talkerBrief.questionsToAsk[0] ??
      "要我继续把这个任务交给正式执行会话吗？";

    return {
      spokenSummary: `${plannerResult.talkerBrief.spokenSummary} ${executorReport.summary}`,
      suggestedNextUtterance: firstQuestion,
      factsToAvoidOverstating: [
        ...plannerResult.talkerBrief.factsToAvoidOverstating,
        "Worker 的本轮任务包是只读理解，不代表已经完成代码修改。",
      ],
      questionsToAsk: [firstQuestion],
    };
  }
}

export class SimulatedTalker extends VoiceSecretaryTalker {}

export class ProjectPlanner {
  constructor(
    private readonly providerCatalog: VoiceProviderCatalog = {
      listAvailableProviders,
    },
    private readonly codexTalker: Pick<
      CodexEphemeralTalker,
      "createPlannerBrief"
    > = new CodexEphemeralTalker(),
    private readonly llm: Pick<
      VoiceSecretaryTalkerLlm,
      "createPlannerBrief"
    > = new VoiceSecretaryTalkerLlm(getVoiceSecretaryLlmConfig()),
  ) {}

  async plan(request: PlannerRequest): Promise<PlannerResult> {
    const [instructions, topLevelEntries, providers] = await Promise.all([
      discoverInstructionFiles(request.projectPath),
      listTopLevelEntries(request.projectPath),
      this.providerCatalog.listAvailableProviders(),
    ]);
    const projectSummary =
      topLevelEntries.length > 0
        ? `项目 ${basename(request.projectPath)} 顶层包含：${topLevelEntries.join(", ")}。`
        : `项目 ${basename(request.projectPath)} 可访问，但未读取到顶层目录列表。`;
    const contextSummary = request.conversationSessionId
      ? `${projectSummary} 本次电话将复用对话 ${request.conversationSessionId} 作为 Worker 上下文。`
      : `${projectSummary} 本次电话缺省挂载到项目，并由 Worker 创建新的执行上下文。`;
    const providerSummary = request.conversationProvider
      ? `当前已选对话 provider：${request.conversationProvider}，本次会复用该 provider。`
      : summarizeProviderCatalog(providers);

    const executionTask = this.createExecutionTask(
      request,
      instructions,
      providers,
    );
    const callbackDecision: CallbackDecision = {
      required: true,
      reason: "scheduled_update",
      priority: "normal",
      script:
        "我已经完成只读项目理解，可以继续创建正式执行会话，或先回答你的补充问题。",
    };
    const instructionPaths = instructions.map(
      (instruction) => instruction.path,
    );
    const codexBrief = await this.codexTalker.createPlannerBrief(
      request,
      contextSummary,
      providerSummary,
      instructionPaths,
    );
    const llmBrief = codexBrief
      ? codexBrief
      : await this.llm.createPlannerBrief(
          request,
          contextSummary,
          providerSummary,
          instructionPaths,
        );
    const defaultSuggestedNext =
      "下一步你想让我创建正式执行会话，还是先把计划读给你听？";

    return {
      id: randomUUID(),
      requestId: request.id,
      projectSummary: `${contextSummary} ${providerSummary}`,
      relevantInstructions: instructions,
      recommendedAction: "create_executor_session",
      talkerBrief: llmBrief ?? {
        spokenSummary:
          "我已经只读检查了项目说明，并准备好一个正式执行会话可以使用的任务包。",
        suggestedNextUtterance: defaultSuggestedNext,
        factsToAvoidOverstating: [
          "ProjectPlanner 没有修改文件。",
          "Worker 接到的是只读任务包，真实修改需要后续明确执行任务。",
        ],
        questionsToAsk: [defaultSuggestedNext],
      },
      executionTask,
      callbackDecision,
    };
  }

  private createExecutionTask(
    request: PlannerRequest,
    instructions: InstructionReference[],
    providers: AvailableVoiceProvider[],
  ): ExecutionTask {
    const instructionList =
      instructions.length > 0
        ? instructions
            .map(
              (instruction) => `- ${instruction.path}: ${instruction.summary}`,
            )
            .join("\n")
        : "- No local instruction files were found.";
    const mode = chooseExecutionMode(request.requestedOutcome);
    const provider = chooseExecutorProvider(request, providers);

    return {
      id: randomUUID(),
      projectPath: request.projectPath,
      conversationSessionId: request.conversationSessionId,
      provider,
      mode,
      prompt: [
        "You are the formal AgentLine executor session for a voice-originated request.",
        "Do not assume the Talker or ProjectPlanner modified code.",
        request.conversationSessionId
          ? "You are continuing the user-selected existing conversation as the Worker context."
          : "No existing conversation was selected, so this Worker context is project-scoped.",
        "",
        `User intent: ${request.userIntent}`,
        `Requested outcome: ${request.requestedOutcome}`,
        `Execution mode: ${mode}`,
        "",
        "Relevant read-only project instructions:",
        instructionList,
        "",
        "Return a concise project-grounded next-step recommendation.",
      ].join("\n"),
      acceptanceCriteria: [
        "Executor session receives a structured task packet.",
        request.conversationSessionId
          ? "The selected existing conversation receives the Worker handoff."
          : "A new project-scoped executor session receives the Worker handoff.",
        "No file modifications are made by ProjectPlanner.",
        "Result can be summarized back to the caller.",
      ],
      riskNotes: [
        mode === "implementation"
          ? "Voice-originated implementation must still obey normal provider approval and audit controls."
          : "This voice-originated task should stay bounded until the formal executor session confirms the next step.",
      ],
      requiredVerification: [
        "Confirm the task packet contains user intent and project instructions.",
      ],
    };
  }
}

export class FakeExecutorAgentAdapter implements ExecutorAgentAdapter {
  private reports = new Map<string, ExecutorReport>();

  async createSession(task: ExecutionTask): Promise<ExecutorSessionRef> {
    const sessionRef: ExecutorSessionRef = {
      id: `fake-executor-${randomUUID()}`,
      provider: task.provider,
      taskId: task.id,
    };
    this.reports.set(sessionRef.id, {
      executionTaskId: task.id,
      providerSessionId: sessionRef.id,
      status: "completed",
      summary:
        "模拟执行器已收到任务包并返回结果；真实代码修改仍需交给正式 provider 会话。",
      changedFiles: [],
      verification: [
        "Task packet contained user intent.",
        "Task packet contained read-only project instruction references.",
      ],
    });
    return sessionRef;
  }

  async getReport(sessionId: string): Promise<ExecutorReport> {
    const report = this.reports.get(sessionId);
    if (!report) {
      return {
        executionTaskId: "unknown",
        providerSessionId: sessionId,
        status: "failed",
        summary: "模拟执行器找不到对应会话。",
        changedFiles: [],
        verification: [],
      };
    }
    return report;
  }
}

export class SimulatedCallLoop {
  constructor(
    private readonly talker = new SimulatedTalker(),
    private readonly planner = new ProjectPlanner(),
    private readonly executor: ExecutorAgentAdapter = new FakeExecutorAgentAdapter(),
    private readonly options: {
      channel?: CallChannel;
      userTurnSource?: TranscriptTurn["source"];
    } = {},
  ) {}

  async run(input: SimulatedCallInput): Promise<SimulatedCallResult> {
    const startedAt = nowIso();
    const callSession: CallSession = {
      id: randomUUID(),
      channel: this.options.channel ?? "simulated",
      status: "active",
      startedAt,
      projectPath: input.projectPath,
      conversationSessionId: input.conversationSessionId,
      transcript: [
        createTranscriptTurn(
          "user",
          input.utterance,
          this.options.userTurnSource ?? "typed",
        ),
        await this.talker.createOpeningTurn(input),
      ],
      plannerRuns: [],
      callbackRequests: [],
    };

    callSession.status = "waiting_for_planner";
    const plannerRequest = this.talker.createPlannerRequest(callSession, input);
    const plannerResult = await this.planner.plan(plannerRequest);
    callSession.plannerRuns.push({
      id: plannerResult.id,
      requestId: plannerRequest.id,
      status: "completed",
    });

    if (!plannerResult.executionTask) {
      throw new Error("Simulated planner did not produce an execution task");
    }

    callSession.status = "waiting_for_executor";
    const executorSession = await this.executor.createSession(
      plannerResult.executionTask,
    );
    const executorReport = await this.executor.getReport(executorSession.id);
    const finalBrief = await this.talker.createFinalBrief(
      plannerResult,
      executorReport,
    );

    if (plannerResult.callbackDecision.required) {
      callSession.callbackRequests.push({
        id: randomUUID(),
        reason: plannerResult.callbackDecision.reason ?? "scheduled_update",
        priority: plannerResult.callbackDecision.priority ?? "normal",
        script:
          plannerResult.callbackDecision.script ?? finalBrief.spokenSummary,
      });
    }
    callSession.status = "completed";
    callSession.endedAt = nowIso();

    return {
      callSession,
      plannerRequest,
      plannerResult,
      executorReport,
      finalBrief,
    };
  }
}

export class VoiceSecretaryCallLoop extends SimulatedCallLoop {
  constructor(
    executor: ExecutorAgentAdapter,
    options: {
      providerCatalog?: VoiceProviderCatalog;
      talker?: VoiceSecretaryTalker;
      planner?: ProjectPlanner;
    } = {},
  ) {
    const talker = options.talker ?? new VoiceSecretaryTalker();
    const planner =
      options.planner ?? new ProjectPlanner(options.providerCatalog);
    super(talker, planner, executor, {
      channel: "web-voice",
      userTurnSource: "asr",
    });
  }
}
