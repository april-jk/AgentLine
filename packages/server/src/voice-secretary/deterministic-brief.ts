import type {
  ExecutorReport,
  PlannerRequest,
  ProjectKnowledgeIndex,
  TalkerBrief,
  TalkerContextFrame,
  VoiceSessionHookEvent,
} from "./types.js";

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\/api\/voice-secretary/gi, "语音秘书接口")
    .replace(/packages\/client/gi, "客户端")
    .replace(/packages\/server/gi, "服务端")
    .replace(/packages\/relay/gi, "中继服务")
    .replace(/docs\/[^\s，。；,]*/gi, "项目文档")
    .replace(/[A-Za-z0-9._-]*\/[A-Za-z0-9._/-]+/g, "相关模块")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizePositioning(text: string): string {
  const cleaned = cleanForSpeech(text);
  if (
    /A better remote interface for Claude Code and Codex/i.test(cleaned) ||
    /Self-hosted, no cloud accounts/i.test(cleaned)
  ) {
    return "一个面向手机端的自托管 AI 代理监督台，方便你随时查看和接管 Claude Code、Codex 这类会话";
  }
  return cleaned;
}

function shortenList(items: string[] | undefined, limit: number): string[] {
  return normalizeItems(items, limit).map((item) => cleanForSpeech(item));
}

function summarizeCommitAreas(files: string[] | undefined): string {
  if (!files || files.length === 0) return "";
  const areas = new Set<string>();
  for (const file of files) {
    if (file.startsWith("packages/client/src/pages/")) {
      areas.add("前端页面");
      continue;
    }
    if (file.startsWith("packages/client/src/api/")) {
      areas.add("前端接口");
      continue;
    }
    if (file.startsWith("packages/client/src/hooks/")) {
      areas.add("前端交互");
      continue;
    }
    if (file.startsWith("packages/server/src/routes/")) {
      areas.add("服务端路由");
      continue;
    }
    if (file.startsWith("packages/server/src/voice-secretary/")) {
      areas.add("语音秘书运行时");
      continue;
    }
    if (file.startsWith("packages/server/test/")) {
      areas.add("服务端测试");
      continue;
    }
    if (file.startsWith("packages/client/src/pages/__tests__/")) {
      areas.add("前端测试");
      continue;
    }
    if (file.startsWith("docs/")) {
      areas.add("项目文档");
    }
  }
  return [...areas].slice(0, 4).join("、");
}

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

function isCommitQuestion(text: string): boolean {
  return /最近.*提交|最新.*提交|代码提交|commit/i.test(text);
}

function isProjectOverviewQuestion(text: string): boolean {
  return /项目.*(怎么样|现状|进展|能力|功能|背景|介绍)|介绍.*项目|status|progress|capabilit/i.test(
    text,
  );
}

function isVoiceStackQuestion(text: string): boolean {
  return /语音识别|语音合成|asr|tts|火山|字节|speech/i.test(text);
}

export function buildProjectKnowledgeSummary(
  projectIndex: ProjectKnowledgeIndex | undefined,
): string {
  if (!projectIndex) {
    return "当前项目资料还在整理中。";
  }

  const capabilities = shortenList(projectIndex.currentCapabilities, 3);
  const voiceStatus = shortenList(projectIndex.voiceSecretaryStatus, 2);
  const nextSteps = shortenList(projectIndex.knownNextSteps, 2);

  const parts = [
    `${projectIndex.projectName} 现在可以把它理解成${humanizePositioning(projectIndex.projectPositioning)}。`,
    capabilities.length > 0
      ? `已经比较明确的能力，主要是${joinItems(capabilities)}。`
      : "",
    voiceStatus.length > 0
      ? `语音秘书这条线现在已经做到${joinItems(voiceStatus)}。`
      : "",
    nextSteps.length > 0 ? `接下来更靠前的是${joinItems(nextSteps)}。` : "",
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
    return `我已经有 ${projectIndex.projectName} 的基础资料了，它现在重点在${cleanForSpeech(capability)}，你可以直接问我现状、能力或者下一步。`;
  }
  return `我已经有 ${projectIndex.projectName} 的基础项目资料了，你可以直接问我项目现状、能力或者下一步。`;
}

export function buildDeterministicPlannerBrief(
  request: PlannerRequest,
  providerSummary: string,
): TalkerBrief {
  const userIntent = request.userIntent.trim();
  if (
    isCommitQuestion(userIntent) &&
    request.projectIndex?.latestCommitSummary
  ) {
    const commitAreas = summarizeCommitAreas(
      request.projectIndex.latestCommitFiles,
    );
    const commitSummary = cleanForSpeech(
      request.projectIndex.latestCommitSummary,
    );
    return {
      spokenSummary: commitAreas
        ? `${commitSummary} 主要动的是${commitAreas}这几块。`
        : commitSummary,
      suggestedNextUtterance:
        "你要我继续展开这次提交具体改了哪些文件，还是直接看下一步重点？",
      factsToAvoidOverstating: [
        "只陈述当前项目索引里已经整理出的最新提交信息。",
      ],
      questionsToAsk: [
        "你要我继续展开这次提交具体改了哪些文件，还是直接看下一步重点？",
      ],
    };
  }

  const projectSummary = buildProjectKnowledgeSummary(request.projectIndex);
  if (isVoiceStackQuestion(userIntent)) {
    return {
      spokenSummary:
        "现在这套语音链路，识别和合成都走火山引擎，服务端有专门的 ASR 和 TTS 适配层。页面这边主要负责录音、展示对话，再把结果接回来。",
      suggestedNextUtterance:
        "你要我继续展开前端页面、服务端路由，还是语音秘书运行时这一层？",
      factsToAvoidOverstating: [
        "只陈述当前索引和已知代码结构，不把未验证的链路说成已经稳定可用。",
      ],
      questionsToAsk: [
        "你要我继续展开前端页面、服务端路由，还是语音秘书运行时这一层？",
      ],
    };
  }
  if (isProjectOverviewQuestion(userIntent)) {
    return {
      spokenSummary: projectSummary,
      suggestedNextUtterance: "你想继续追项目现状，还是让我展开某个具体模块？",
      factsToAvoidOverstating: [
        "当前回答基于项目索引和项目记忆，不代表已经做了完整代码审计。",
      ],
      questionsToAsk: ["你想继续追项目现状，还是让我展开某个具体模块？"],
    };
  }

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
  userIntent?: string;
  plannerSuggestedNextUtterance?: string;
  projectIndex?: ProjectKnowledgeIndex;
  context?: TalkerContextFrame;
  executorReport: ExecutorReport;
  pendingHook?: VoiceSessionHookEvent;
}): TalkerBrief {
  const userIntent = args.userIntent?.trim() ?? "";
  if (isCommitQuestion(userIntent) && args.projectIndex?.latestCommitSummary) {
    const commitAreas = summarizeCommitAreas(
      args.projectIndex.latestCommitFiles,
    );
    const commitSummary = cleanForSpeech(args.projectIndex.latestCommitSummary);
    return {
      spokenSummary: commitAreas
        ? `${commitSummary} 主要动的是${commitAreas}这几块。`
        : commitSummary,
      suggestedNextUtterance:
        args.plannerSuggestedNextUtterance ??
        "你要我继续展开这次提交改了哪些文件吗？",
      factsToAvoidOverstating: [
        "如果还没有新的 worker 完成结果，就不要把未验证的细节补进去。",
      ],
      questionsToAsk: [
        args.plannerSuggestedNextUtterance ??
          "你要我继续展开这次提交改了哪些文件吗？",
      ],
    };
  }

  const projectSummary = buildProjectKnowledgeSummary(args.projectIndex);
  if (isVoiceStackQuestion(userIntent)) {
    return {
      spokenSummary:
        "现在这套语音链路，识别和合成都走火山引擎，服务端有专门的 ASR 和 TTS 适配层。页面这边负责录音、展示对话，再把结果接回来。",
      suggestedNextUtterance:
        args.plannerSuggestedNextUtterance ??
        "你要我继续拆前端页面、服务端路由，还是运行时这一层？",
      factsToAvoidOverstating: ["当前回答只基于现有代码结构和已知状态。"],
      questionsToAsk: [
        args.plannerSuggestedNextUtterance ??
          "你要我继续拆前端页面、服务端路由，还是运行时这一层？",
      ],
    };
  }
  if (isProjectOverviewQuestion(userIntent)) {
    return {
      spokenSummary: projectSummary,
      suggestedNextUtterance:
        args.plannerSuggestedNextUtterance ??
        "你想让我继续展开某个模块，还是追最近一次提交？",
      factsToAvoidOverstating: [
        "当前回答基于项目索引、项目记忆和已知 worker 结果。",
      ],
      questionsToAsk: [
        args.plannerSuggestedNextUtterance ??
          "你想让我继续展开某个模块，还是追最近一次提交？",
      ],
    };
  }

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
    latestWorker
      ? `项目专家最近补充了一点：${cleanForSpeech(latestWorker)}。`
      : "",
    executorSummary
      ? `这轮项目专家给到的结论是：${cleanForSpeech(executorSummary)}。`
      : "",
    cleanForSpeech(hookLine),
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
