import { randomUUID } from "node:crypto";
import type { ProviderName } from "@agentline/shared";
import type { SDKMessage } from "../sdk/types.js";
import type { ProcessEvent } from "../supervisor/types.js";
import type {
  CallSession,
  CallbackRequest,
  PlannerRunRef,
  TranscriptTurn,
  VoiceSessionHookEvent,
  VoiceSessionSnapshot,
  VoiceWorkerStatus,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function extractAssistantText(message: SDKMessage): string | undefined {
  if (message.type !== "assistant") return undefined;
  const content = message.message?.content;
  if (typeof content === "string") {
    const normalized = content.trim();
    return normalized || undefined;
  }
  if (!Array.isArray(content)) return undefined;
  const normalized = content
    .flatMap((block) => {
      if (typeof block?.text === "string") {
        return [block.text.trim()];
      }
      if (typeof block?.content === "string") {
        return [block.content.trim()];
      }
      return [];
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return normalized || undefined;
}

interface VoiceSessionRuntimeRecord {
  snapshot: VoiceSessionSnapshot;
  transcript: TranscriptTurn[];
  plannerRuns: PlannerRunRef[];
  callbackRequests: CallbackRequest[];
  pendingHook?: VoiceSessionHookEvent;
  workerUnsubscribe?: () => void;
  boundWorkerProcessId?: string;
}

export class VoiceSecretaryRuntimeManager {
  private readonly sessions = new Map<string, VoiceSessionRuntimeRecord>();

  getOrCreateSession(input: {
    voiceSessionId?: string;
    projectPath: string;
    conversationSessionId?: string;
    conversationProvider?: ProviderName;
  }): VoiceSessionRuntimeRecord {
    const id = input.voiceSessionId ?? randomUUID();
    const existing = this.sessions.get(id);
    if (existing) {
      existing.snapshot.updatedAt = nowIso();
      if (!existing.snapshot.workerProvider && input.conversationProvider) {
        existing.snapshot.workerProvider = input.conversationProvider;
      }
      if (
        !existing.snapshot.conversationSessionId &&
        input.conversationSessionId
      ) {
        existing.snapshot.conversationSessionId = input.conversationSessionId;
      }
      return existing;
    }

    const record: VoiceSessionRuntimeRecord = {
      snapshot: {
        id,
        startedAt: nowIso(),
        updatedAt: nowIso(),
        projectPath: input.projectPath,
        conversationSessionId: input.conversationSessionId,
        workerSessionId: input.conversationSessionId,
        workerProvider: input.conversationProvider,
        workerStatus: input.conversationSessionId ? "idle" : "idle",
      },
      transcript: [],
      plannerRuns: [],
      callbackRequests: [],
    };
    this.sessions.set(id, record);
    return record;
  }

  addTranscriptTurn(
    record: VoiceSessionRuntimeRecord,
    turn: TranscriptTurn,
  ): void {
    record.transcript.push(turn);
    record.snapshot.updatedAt = nowIso();
  }

  addPlannerRun(
    record: VoiceSessionRuntimeRecord,
    plannerRun: PlannerRunRef,
  ): void {
    record.plannerRuns.push(plannerRun);
    record.snapshot.updatedAt = nowIso();
  }

  addCallbackRequest(
    record: VoiceSessionRuntimeRecord,
    callbackRequest: CallbackRequest,
  ): void {
    record.callbackRequests.push(callbackRequest);
    record.snapshot.updatedAt = nowIso();
  }

  setSpeakerProjectSummary(
    record: VoiceSessionRuntimeRecord,
    summary: string,
  ): void {
    record.snapshot.speakerProjectSummary = summary;
    record.snapshot.updatedAt = nowIso();
  }

  setWorkerBinding(
    record: VoiceSessionRuntimeRecord,
    binding: {
      workerSessionId: string;
      workerProvider: ProviderName;
      workerStatus: VoiceWorkerStatus;
    },
  ): void {
    record.snapshot.workerSessionId = binding.workerSessionId;
    record.snapshot.workerProvider = binding.workerProvider;
    record.snapshot.workerStatus = binding.workerStatus;
    record.snapshot.updatedAt = nowIso();
  }

  bindWorkerProcess(
    record: VoiceSessionRuntimeRecord,
    processId: string | undefined,
    subscribe:
      | ((listener: (event: ProcessEvent) => void) => () => void)
      | undefined,
  ): void {
    if (!processId || !subscribe) return;
    if (record.boundWorkerProcessId === processId) return;
    record.workerUnsubscribe?.();
    record.boundWorkerProcessId = processId;
    record.workerUnsubscribe = subscribe((event) => {
      this.handleWorkerEvent(record, event);
    });
  }

  consumePendingHook(
    voiceSessionId: string,
  ): { snapshot: VoiceSessionSnapshot; hook?: VoiceSessionHookEvent } | null {
    const record = this.sessions.get(voiceSessionId);
    if (!record) return null;
    const hook = record.pendingHook;
    record.pendingHook = undefined;
    return { snapshot: { ...record.snapshot }, hook };
  }

  buildCallSession(
    record: VoiceSessionRuntimeRecord,
    status: CallSession["status"],
    channel: CallSession["channel"] = "web-voice",
  ): CallSession {
    return {
      id: randomUUID(),
      voiceSessionId: record.snapshot.id,
      channel,
      status,
      startedAt: record.snapshot.startedAt,
      projectPath: record.snapshot.projectPath,
      conversationSessionId: record.snapshot.conversationSessionId,
      workerSessionId: record.snapshot.workerSessionId,
      workerStatus: record.snapshot.workerStatus,
      transcript: [...record.transcript],
      plannerRuns: [...record.plannerRuns],
      callbackRequests: [...record.callbackRequests],
    };
  }

  getSnapshot(voiceSessionId: string): VoiceSessionSnapshot | null {
    const record = this.sessions.get(voiceSessionId);
    return record ? { ...record.snapshot } : null;
  }

  private handleWorkerEvent(
    record: VoiceSessionRuntimeRecord,
    event: ProcessEvent,
  ): void {
    if (event.type === "message") {
      const text = extractAssistantText(event.message);
      if (text) {
        record.snapshot.latestWorkerMessage = text;
        record.snapshot.updatedAt = nowIso();
      }
      return;
    }

    if (event.type === "complete") {
      record.snapshot.workerStatus = "completed";
      record.snapshot.updatedAt = nowIso();
      record.pendingHook = {
        id: randomUUID(),
        voiceSessionId: record.snapshot.id,
        createdAt: nowIso(),
        reason: "worker_completed",
        text: "我已经从项目专家那里知道了更多项目细节，我们可以继续讨论了。",
      };
      return;
    }

    if (event.type === "terminated") {
      record.snapshot.workerStatus = "failed";
      record.snapshot.updatedAt = nowIso();
      record.pendingHook = {
        id: randomUUID(),
        voiceSessionId: record.snapshot.id,
        createdAt: nowIso(),
        reason: "worker_failed",
        text: "项目专家这边刚才中断了，我可以继续帮你整理目前已知的信息。",
      };
    }
  }
}
