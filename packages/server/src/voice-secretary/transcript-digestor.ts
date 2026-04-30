import type { ProjectTranscriptEvent, TalkerProjectMemory } from "./types.js";

const MAX_DIGEST_ITEMS = 10;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function unique(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = clean(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function looksLikeQuestion(text: string): boolean {
  return (
    /[?？]$/.test(text) || /怎么|为什么|现在|最近|是否|能不能|是什么/.test(text)
  );
}

export function applyTranscriptEventToMemory(
  memory: TalkerProjectMemory,
  event: ProjectTranscriptEvent,
): TalkerProjectMemory {
  const cleanedText = clean(event.text);
  if (!cleanedText) return memory;

  let recentChangesDigest = [...memory.recentChangesDigest];
  let openQuestions = [...memory.openQuestions];

  if (
    event.kind === "worker_message" ||
    event.kind === "memory_note" ||
    (event.kind === "turn" && event.source === "talker")
  ) {
    recentChangesDigest = unique(
      [cleanedText, ...recentChangesDigest],
      MAX_DIGEST_ITEMS,
    );
  }

  if (
    event.kind === "turn" &&
    event.source === "user" &&
    looksLikeQuestion(cleanedText)
  ) {
    openQuestions = unique([cleanedText, ...openQuestions], MAX_DIGEST_ITEMS);
  }

  if (event.kind === "worker_failed") {
    openQuestions = unique(
      [
        "上一次项目专家任务中断了，可能还有细节需要继续确认。",
        ...openQuestions,
      ],
      MAX_DIGEST_ITEMS,
    );
  }

  return {
    ...memory,
    recentChangesDigest,
    openQuestions,
    updatedAt: event.at,
  };
}
