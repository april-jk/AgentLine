import type {
  ExecutorReport,
  PlannerRequest,
  ProjectKnowledgeIndex,
  TalkerBrief,
  TalkerContextFrame,
  VoiceSessionHookEvent,
} from "./types.js";

function normalizeItems(items: string[] | undefined, limit: number): string[] {
  if (!items) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function joinItems(items: string[]): string {
  return items.join("；");
}

function stripTerminalPunctuation(text: string): string {
  return text.trim().replace(/[。.!！?？；;，,]+$/u, "");
}

function withFullStop(text: string): string {
  const normalized = stripTerminalPunctuation(text);
  return normalized ? `${normalized}。` : "";
}

function makeSentence(prefix: string, items: string[], fallback = ""): string {
  if (items.length === 0) {
    return fallback;
  }
  return `${prefix}${joinItems(items)}。`;
}

export function buildProjectKnowledgeSummary(
  projectIndex: ProjectKnowledgeIndex | undefined,
): string {
  if (!projectIndex) {
    return "当前项目资料还在整理中。";
  }

  const parts = [
    `${projectIndex.projectName} 的定位是${stripTerminalPunctuation(projectIndex.projectPositioning)}。`,
    makeSentence(
      "已经比较明确的能力有：",
      normalizeItems(projectIndex.currentCapabilities, 4),
    ),
    makeSentence(
      "Voice Secretary 当前这条线已经具备：",
      normalizeItems(projectIndex.voiceSecretaryStatus, 4),
    ),
    makeSentence(
      "项目核心模块主要是：",
      normalizeItems(projectIndex.coreModules, 4),
    ),
    makeSentence(
      "最近重点集中在：",
      normalizeItems(projectIndex.recentFocus, 3),
    ),
    makeSentence(
      "接下来优先事项包括：",
      normalizeItems(projectIndex.knownNextSteps, 3),
    ),
  ].filter(Boolean);

  return parts.join(" ");
}

export function buildDeterministicOpeningLine(
  projectIndex: ProjectKnowledgeIndex | undefined,
): string {
  if (!projectIndex) {
    return "我已经接上这个项目的基础资料了，你可以直接问项目现状、功能能力或者下一步。";
  }

  const capability = normalizeItems(projectIndex.currentCapabilities, 1)[0];
  if (capability) {
    return `我已经有 ${projectIndex.projectName} 的基础项目资料了，它目前重点是${capability}，你可以直接问我项目现状、能力或者下一步。`;
  }
  return `我已经有 ${projectIndex.projectName} 的基础项目资料了，你可以直接问我项目现状、能力或者下一步。`;
}

export function buildDeterministicPlannerBrief(
  request: PlannerRequest,
  providerSummary: string,
): TalkerBrief {
  const projectSummary = buildProjectKnowledgeSummary(request.projectIndex);
  const latestWorker = request.latestWorkerMessage?.trim();
  const workerLine = latestWorker
    ? `项目专家最近已经补充过：${latestWorker}。`
    : request.workerSessionId
      ? "这个项目已经绑定了一个长期项目专家，深度问题会继续复用它。"
      : "如果需要更深的代码和进展细节，我会继续让项目专家补充。";
  const firstQuestion =
    request.requestedOutcome === "status_check" ||
    request.requestedOutcome === "answer"
      ? "你想先听项目现状，还是继续让我追问更深的实现细节？"
      : "你想让我先继续追项目专家的细节，还是先把当前判断讲清楚？";

  return {
    spokenSummary: `${projectSummary} ${workerLine} ${providerSummary}`.trim(),
    suggestedNextUtterance: firstQuestion,
    factsToAvoidOverstating: [
      "Talker 的基础判断来自项目索引和项目记忆，不代表已经完整审计全仓代码。",
      "只有项目专家和正式执行会话才能继续做深度查阅或修改。",
    ],
    questionsToAsk: [firstQuestion],
  };
}

export function buildDeterministicFinalBrief(args: {
  plannerSuggestedNextUtterance?: string;
  projectIndex?: ProjectKnowledgeIndex;
  context?: TalkerContextFrame;
  executorReport: ExecutorReport;
  pendingHook?: VoiceSessionHookEvent;
}): TalkerBrief {
  const projectSummary = buildProjectKnowledgeSummary(args.projectIndex);
  const latestWorker = stripTerminalPunctuation(
    args.context?.latestWorkerMessage?.trim() ?? "",
  );
  const executorSummary =
    args.executorReport.providerSessionId !== "speaker-direct"
      ? stripTerminalPunctuation(args.executorReport.summary)
      : "";
  const hookLine = withFullStop(args.pendingHook?.text?.trim() ?? "");

  const parts = [
    projectSummary,
    latestWorker ? `项目专家最近补充的是：${latestWorker}。` : "",
    executorSummary ? `这轮项目专家返回的是：${executorSummary}。` : "",
    hookLine,
  ].filter(Boolean);

  const fallbackQuestion =
    args.plannerSuggestedNextUtterance ??
    "你想继续聊项目现状，还是让我追一个更具体的模块？";

  return {
    spokenSummary: parts.join(" "),
    suggestedNextUtterance: fallbackQuestion,
    factsToAvoidOverstating: [
      "Talker 只应陈述项目索引、项目记忆和项目专家已返回的信息。",
      "如果项目专家还没完成，不要把排队中的任务说成已经改完。",
    ],
    questionsToAsk: [fallbackQuestion],
  };
}
