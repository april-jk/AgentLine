import type {
  ProjectKnowledgeIndex,
  TalkerContextFrame,
  TalkerContextTurn,
  TalkerMemoryPacket,
} from "./types.js";

const MAX_ASSISTANT_DIGEST = 3;
const MAX_STABLE_FACTS = 4;
const MAX_WORKER_FINDINGS = 3;
const MAX_RECENT_CHANGES = 3;
const MAX_OPEN_QUESTIONS = 2;
const MAX_SPOKEN_HINTS = 3;
const MAX_RECENT_TURNS = 4;

function normalize(items: string[] | undefined, limit: number): string[] {
  if (!items) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

function lower(text: string): string {
  return text.toLowerCase();
}

function scoreFinding(
  userIntent: string,
  finding: { topic: string; summary: string },
): number {
  const intent = lower(userIntent);
  const combined = lower(`${finding.topic} ${finding.summary}`);
  let score = 0;
  if (!intent) return score;
  const isCommitIntent = /提交|commit/.test(intent);
  const isSpeechIntent = /语音|识别|合成|asr|tts|speech|火山/.test(intent);
  if (isCommitIntent && /提交|commit/.test(combined)) score += 5;
  if (isSpeechIntent && /语音|识别|合成|asr|tts|speech|火山/.test(combined)) {
    score += 6;
  }
  if (
    /进展|现状|状态|背景|能力|功能/.test(intent) &&
    /进展|现状|状态|背景|能力|功能/.test(combined)
  ) {
    score += 3;
  }
  if (isSpeechIntent && /提交|commit/.test(combined)) {
    score -= 2;
  }
  if (combined.includes(intent.slice(0, Math.min(intent.length, 12))))
    score += 1;
  return score;
}

function scoreStableFact(userIntent: string, fact: string): number {
  const intent = lower(userIntent);
  const normalizedFact = lower(fact);
  let score = 0;
  const isCommitIntent = /提交|commit/.test(intent);
  const isSpeechIntent = /语音|识别|合成|asr|tts|speech|火山/.test(intent);
  if (isCommitIntent && /提交|commit/.test(normalizedFact)) score += 4;
  if (
    isSpeechIntent &&
    /语音|识别|合成|asr|tts|speech|火山/.test(normalizedFact)
  ) {
    score += 5;
  }
  if (
    /进展|现状|状态|背景|能力|功能/.test(intent) &&
    /进展|现状|状态|背景|能力|功能/.test(normalizedFact)
  ) {
    score += 2;
  }
  if (isSpeechIntent && /提交|commit/.test(normalizedFact)) {
    score -= 2;
  }
  if (
    /voice secretary/i.test(intent) &&
    /voice secretary/i.test(normalizedFact)
  )
    score += 2;
  return score;
}

function pickRecentTurns(
  turns: TalkerContextTurn[] | undefined,
): TalkerContextTurn[] {
  return (turns ?? []).slice(-MAX_RECENT_TURNS);
}

function buildProjectBrief(
  projectIndex: ProjectKnowledgeIndex | undefined,
): string {
  if (!projectIndex) return "";
  return [
    projectIndex.projectPositioning,
    ...(projectIndex.currentCapabilities ?? []).slice(0, 2),
    ...(projectIndex.voiceSecretaryStatus ?? []).slice(0, 1),
  ]
    .filter(Boolean)
    .join("；");
}

export function selectTalkerMemory(
  userIntent: string,
  context: TalkerContextFrame,
): TalkerMemoryPacket {
  const assistantStyleHints = normalize(
    context.assistantMemory?.spokenStyleHints,
    MAX_SPOKEN_HINTS,
  );
  const assistantConversationDigest = normalize(
    context.assistantMemory?.recentConversationDigest,
    MAX_ASSISTANT_DIGEST,
  );
  const relevantStableFacts = normalize(
    [...(context.projectMemory?.stableFacts ?? [])].sort(
      (left, right) =>
        scoreStableFact(userIntent, right) - scoreStableFact(userIntent, left),
    ),
    MAX_STABLE_FACTS,
  );
  const relevantWorkerFindings = [
    ...(context.projectMemory?.workerFindings ?? []),
  ]
    .sort(
      (left, right) =>
        scoreFinding(userIntent, right) - scoreFinding(userIntent, left),
    )
    .slice(0, MAX_WORKER_FINDINGS)
    .map((finding) => ({
      topic: finding.topic,
      summary: finding.summary,
    }));
  const spokenHints = normalize(
    context.projectMemory?.spokenHints,
    MAX_SPOKEN_HINTS,
  );
  const relevantRecentChanges = normalize(
    [...(context.projectMemory?.recentChangesDigest ?? [])].sort(
      (left, right) =>
        scoreStableFact(userIntent, right) - scoreStableFact(userIntent, left),
    ),
    MAX_RECENT_CHANGES,
  );
  const relevantOpenQuestions = normalize(
    [...(context.projectMemory?.openQuestions ?? [])].sort(
      (left, right) =>
        scoreStableFact(userIntent, right) - scoreStableFact(userIntent, left),
    ),
    MAX_OPEN_QUESTIONS,
  );

  return {
    assistantStyleHints,
    assistantConversationDigest,
    projectBrief: buildProjectBrief(context.projectIndex),
    relevantStableFacts,
    relevantRecentChanges,
    relevantOpenQuestions,
    relevantWorkerFindings,
    spokenHints,
    recentTurns: pickRecentTurns(context.recentTurns),
    latestWorkerMessage: context.latestWorkerMessage,
    workerStatus: context.workerStatus,
  };
}
