import { randomUUID } from "node:crypto";
import type { ProviderName } from "@agentline/shared";
import type { SDKMessage } from "../sdk/types.js";
import type { ProcessEvent } from "../supervisor/types.js";
import type { VoiceSecretaryKnowledgeStore } from "./knowledge-store.js";
import type {
  CallSession,
  CallbackRequest,
  PlannerRunRef,
  ProjectKnowledgeIndex,
  TalkerContextFrame,
  TalkerContextTurn,
  TalkerProjectMemory,
  TranscriptTurn,
  VoiceSessionHookEvent,
  VoiceSessionSnapshot,
  VoiceWorkerStatus,
} from "./types.js";

const MAX_RECENT_TURNS = 8;

interface ProjectTalkerMemory {
  projectIndex?: ProjectKnowledgeIndex;
  recentTurns: TalkerContextTurn[];
  latestWorkerMessage?: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function summarizeWorkerCompletion(text: string | undefined): string {
  const normalized = text?.trim();
  if (!normalized) {
    return "我已经从项目专家那里知道了更多项目细节，我们可以继续讨论了。";
  }
  return `项目专家刚刚补充：${normalized}`;
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
  talkerContext: TalkerContextTurn[];
  projectMemory?: TalkerProjectMemory;
  pendingHook?: VoiceSessionHookEvent;
  workerUnsubscribe?: () => void;
  boundWorkerProcessId?: string;
}

export class VoiceSecretaryRuntimeManager {
  private readonly sessions = new Map<string, VoiceSessionRuntimeRecord>();
  private readonly projectMemories = new Map<string, ProjectTalkerMemory>();

  constructor(private readonly knowledgeStore?: VoiceSecretaryKnowledgeStore) {}

  getOrCreateSession(input: {
    voiceSessionId?: string;
    projectPath: string;
    conversationSessionId?: string;
    conversationProvider?: ProviderName;
    projectMemory?: TalkerProjectMemory;
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

    const projectMemory =
      input.projectMemory ?? this.projectMemories.get(input.projectPath);

    const record: VoiceSessionRuntimeRecord = {
      snapshot: {
        id,
        startedAt: nowIso(),
        updatedAt: nowIso(),
        projectPath: input.projectPath,
        conversationSessionId: input.conversationSessionId,
        workerSessionId: input.conversationSessionId,
        workerProvider: input.conversationProvider,
        workerStatus: "idle",
        latestWorkerMessage: projectMemory?.latestWorkerMessage,
      },
      transcript: [],
      plannerRuns: [],
      callbackRequests: [],
      talkerContext: projectMemory ? [...projectMemory.recentTurns] : [],
      projectMemory:
        projectMemory && "memoryFilePath" in projectMemory
          ? projectMemory
          : undefined,
    };
    this.sessions.set(id, record);
    return record;
  }

  addTranscriptTurn(
    record: VoiceSessionRuntimeRecord,
    turn: TranscriptTurn,
  ): void {
    record.transcript.push(turn);
    if (turn.speaker === "user" || turn.speaker === "talker") {
      record.talkerContext.push({
        speaker: turn.speaker,
        text: turn.text,
        at: turn.at,
      });
      record.talkerContext = record.talkerContext.slice(-MAX_RECENT_TURNS);
      this.syncProjectMemory(record);
    }
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

  setProjectIndex(
    record: VoiceSessionRuntimeRecord,
    projectIndex: ProjectKnowledgeIndex,
  ): void {
    record.snapshot.projectIndexSummary = projectIndex.summary;
    this.syncProjectMemory(record, {
      projectIndex,
    });
    record.snapshot.updatedAt = nowIso();
  }

  setProjectMemory(
    record: VoiceSessionRuntimeRecord,
    memory: TalkerProjectMemory,
  ): void {
    record.projectMemory = memory;
    record.talkerContext = [...memory.recentTurns];
    this.projectMemories.set(record.snapshot.projectPath, {
      projectIndex: this.projectMemories.get(record.snapshot.projectPath)
        ?.projectIndex,
      recentTurns: [...memory.recentTurns],
      latestWorkerMessage: memory.latestWorkerMessage,
      updatedAt: memory.updatedAt,
    });
    record.snapshot.latestWorkerMessage = memory.latestWorkerMessage;
    record.snapshot.updatedAt = nowIso();
  }

  buildTalkerContext(record: VoiceSessionRuntimeRecord): TalkerContextFrame {
    return {
      projectIndex: this.projectMemories.get(record.snapshot.projectPath)
        ?.projectIndex,
      projectMemory: record.projectMemory,
      recentTurns: [...record.talkerContext],
      latestWorkerMessage: record.snapshot.latestWorkerMessage,
      workerStatus: record.snapshot.workerStatus,
    };
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
        this.syncProjectMemory(record, { latestWorkerMessage: text });
        void this.knowledgeStore?.recordWorkerUpdate(
          record.snapshot.projectPath,
          text,
        );
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
        text: summarizeWorkerCompletion(record.snapshot.latestWorkerMessage),
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

  private syncProjectMemory(
    record: VoiceSessionRuntimeRecord,
    overrides: Partial<ProjectTalkerMemory> = {},
  ): void {
    const current = this.projectMemories.get(record.snapshot.projectPath);
    this.projectMemories.set(record.snapshot.projectPath, {
      projectIndex: overrides.projectIndex ?? current?.projectIndex,
      recentTurns: [...record.talkerContext],
      latestWorkerMessage:
        overrides.latestWorkerMessage ??
        record.snapshot.latestWorkerMessage ??
        current?.latestWorkerMessage,
      updatedAt: nowIso(),
    });
  }
}
