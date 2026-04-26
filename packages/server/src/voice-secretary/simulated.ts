import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import type {
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

export class SimulatedTalker {
  createOpeningTurn(input: SimulatedCallInput): TranscriptTurn {
    const projectName = basename(input.projectPath);
    return createTranscriptTurn(
      "talker",
      `收到。我先快速记录你的需求，然后只读检查 ${projectName} 的项目说明，稍后给你一个简短结论。`,
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
      userIntent: input.utterance,
      conversationSummary: `用户通过模拟通话提出需求：${input.utterance}`,
      knownConstraints: [
        "Talker 只负责低延迟对话，不读取完整项目或修改文件。",
        "ProjectPlanner 只能做只读项目理解和任务下发。",
        "真实修改必须交给 ExecutorAgentSession。",
      ],
      missingInformation: [],
      urgency: "normal",
      requestedOutcome: "plan",
    };
  }

  createFinalBrief(
    plannerResult: PlannerResult,
    executorReport: ExecutorReport,
  ): TalkerBrief {
    const firstQuestion =
      plannerResult.talkerBrief.questionsToAsk[0] ??
      "要我继续把这个任务交给正式执行会话吗？";

    return {
      spokenSummary: `${plannerResult.talkerBrief.spokenSummary} ${executorReport.summary}`,
      suggestedNextUtterance: firstQuestion,
      factsToAvoidOverstating: [
        ...plannerResult.talkerBrief.factsToAvoidOverstating,
        "模拟执行器没有进行真实代码修改。",
      ],
      questionsToAsk: [firstQuestion],
    };
  }
}

export class ProjectPlanner {
  async plan(request: PlannerRequest): Promise<PlannerResult> {
    const instructions = await discoverInstructionFiles(request.projectPath);
    const topLevelEntries = await listTopLevelEntries(request.projectPath);
    const projectSummary =
      topLevelEntries.length > 0
        ? `项目 ${basename(request.projectPath)} 顶层包含：${topLevelEntries.join(", ")}。`
        : `项目 ${basename(request.projectPath)} 可访问，但未读取到顶层目录列表。`;

    const executionTask = this.createExecutionTask(request, instructions);
    const callbackDecision: CallbackDecision = {
      required: true,
      reason: "scheduled_update",
      priority: "normal",
      script:
        "我已经完成只读项目理解，可以继续创建正式执行会话，或先回答你的补充问题。",
    };

    return {
      id: randomUUID(),
      requestId: request.id,
      projectSummary,
      relevantInstructions: instructions,
      recommendedAction: "create_executor_session",
      talkerBrief: {
        spokenSummary:
          "我已经只读检查了项目说明，并准备好一个正式执行会话可以使用的任务包。",
        suggestedNextUtterance:
          "下一步你想让我创建正式执行会话，还是先把计划读给你听？",
        factsToAvoidOverstating: [
          "ProjectPlanner 没有修改文件。",
          "当前流程使用 fake executor 验证闭环。",
        ],
        questionsToAsk: [
          "下一步你想让我创建正式执行会话，还是先把计划读给你听？",
        ],
      },
      executionTask,
      callbackDecision,
    };
  }

  private createExecutionTask(
    request: PlannerRequest,
    instructions: InstructionReference[],
  ): ExecutionTask {
    const instructionList =
      instructions.length > 0
        ? instructions
            .map(
              (instruction) => `- ${instruction.path}: ${instruction.summary}`,
            )
            .join("\n")
        : "- No local instruction files were found.";

    return {
      id: randomUUID(),
      projectPath: request.projectPath,
      provider: "codex",
      mode: "read_only",
      prompt: [
        "You are the formal AgentLine executor session for a voice-originated request.",
        "Do not assume the Talker or ProjectPlanner modified code.",
        "",
        `User intent: ${request.userIntent}`,
        "",
        "Relevant read-only project instructions:",
        instructionList,
        "",
        "Return a concise project-grounded next-step recommendation.",
      ].join("\n"),
      acceptanceCriteria: [
        "Executor session receives a structured task packet.",
        "No file modifications are made by ProjectPlanner.",
        "Result can be summarized back to the caller.",
      ],
      riskNotes: [
        "This simulated task is read-only and must not perform implementation.",
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
  ) {}

  async run(input: SimulatedCallInput): Promise<SimulatedCallResult> {
    const startedAt = nowIso();
    const callSession: CallSession = {
      id: randomUUID(),
      channel: "simulated",
      status: "active",
      startedAt,
      projectPath: input.projectPath,
      transcript: [
        createTranscriptTurn("user", input.utterance, "typed"),
        this.talker.createOpeningTurn(input),
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
    const finalBrief = this.talker.createFinalBrief(
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
