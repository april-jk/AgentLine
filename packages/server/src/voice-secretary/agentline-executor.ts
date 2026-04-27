import type { ProviderName } from "@agentline/shared";
import type { SessionMetadataService } from "../metadata/index.js";
import { encodeProjectId } from "../projects/paths.js";
import type { PermissionMode, UserMessage } from "../sdk/types.js";
import type { Process } from "../supervisor/Process.js";
import type {
  QueueFullResponse,
  Supervisor,
} from "../supervisor/Supervisor.js";
import type { QueuedResponse } from "../supervisor/WorkerQueue.js";
import type {
  ExecutionTask,
  ExecutorAgentAdapter,
  ExecutorReport,
  ExecutorSessionRef,
} from "./types.js";

export interface AgentLineExecutorAgentAdapterOptions {
  supervisor: Supervisor;
  sessionMetadataService?: SessionMetadataService;
}

interface AgentLineExecutorSessionRef extends ExecutorSessionRef {
  processId?: string;
  queued?: boolean;
  queueId?: string;
  position?: number;
}

function isQueuedResponse(
  result: Process | QueuedResponse | QueueFullResponse,
): result is QueuedResponse {
  return "queued" in result && result.queued === true;
}

function isQueueFullResponse(
  result: Process | QueuedResponse | QueueFullResponse,
): result is QueueFullResponse {
  return "error" in result && result.error === "queue_full";
}

function permissionModeForTask(task: ExecutionTask): PermissionMode {
  return task.mode === "read_only" ? "plan" : "default";
}

function providerForTask(task: ExecutionTask): ProviderName {
  return task.provider;
}

export class AgentLineExecutorAgentAdapter implements ExecutorAgentAdapter {
  private readonly reports = new Map<string, ExecutorReport>();

  constructor(private readonly options: AgentLineExecutorAgentAdapterOptions) {}

  async createSession(
    task: ExecutionTask,
  ): Promise<AgentLineExecutorSessionRef> {
    const provider = providerForTask(task);
    const userMessage: UserMessage = { text: task.prompt };

    const result = task.conversationSessionId
      ? await this.options.supervisor.resumeSession(
          task.conversationSessionId,
          task.projectPath,
          userMessage,
          permissionModeForTask(task),
          { providerName: provider },
        )
      : await this.options.supervisor.startSession(
          task.projectPath,
          userMessage,
          permissionModeForTask(task),
          { providerName: provider },
        );

    if (isQueueFullResponse(result)) {
      const report = {
        executionTaskId: task.id,
        providerSessionId: "queue-full",
        status: "failed" as const,
        summary: `正式执行会话未创建：队列已满，最大队列长度为 ${result.maxQueueSize}。`,
        changedFiles: [],
        verification: [],
      };
      this.reports.set(report.providerSessionId, report);
      return {
        id: report.providerSessionId,
        provider: task.provider,
        taskId: task.id,
      };
    }

    if (isQueuedResponse(result)) {
      const sessionId = `queued-${result.queueId}`;
      const report = {
        executionTaskId: task.id,
        providerSessionId: sessionId,
        status: "queued" as const,
        summary: `正式执行会话已排队，当前位置 ${result.position}。`,
        changedFiles: [],
        verification: ["AgentLine accepted the execution task into its queue."],
      };
      this.reports.set(sessionId, report);
      return {
        id: sessionId,
        provider: task.provider,
        taskId: task.id,
        queued: true,
        queueId: result.queueId,
        position: result.position,
      };
    }

    if (this.options.sessionMetadataService) {
      await this.options.sessionMetadataService.setProvider(
        task.conversationSessionId ?? result.sessionId,
        provider,
      );
    }

    const providerSessionId = task.conversationSessionId ?? result.sessionId;
    const projectId = task.conversationSessionId
      ? encodeProjectId(task.projectPath)
      : result.projectId;

    const report = {
      executionTaskId: task.id,
      providerSessionId,
      status: "started" as const,
      summary: task.conversationSessionId
        ? "已把任务包交给用户选择的既有对话；该对话现在作为 Worker 上下文继续处理本次电话需求。"
        : "正式 AgentLine 执行会话已创建，任务包已经交给 provider 会话；后续代码修改和审计记录都在该会话内发生。",
      changedFiles: [],
      verification: [
        task.conversationSessionId
          ? `Resumed provider session ${providerSessionId}.`
          : `Created provider session ${providerSessionId}.`,
        `Permission mode: ${result.permissionMode}.`,
      ],
      links: [
        {
          label: "AgentLine session",
          href: `/projects/${projectId}/sessions/${providerSessionId}`,
        },
      ],
    };
    this.reports.set(providerSessionId, report);

    return {
      id: providerSessionId,
      provider: task.provider,
      taskId: task.id,
      processId: result.id,
    };
  }

  async getReport(sessionId: string): Promise<ExecutorReport> {
    return (
      this.reports.get(sessionId) ?? {
        executionTaskId: "unknown",
        providerSessionId: sessionId,
        status: "failed",
        summary: "正式执行会话报告不存在。",
        changedFiles: [],
        verification: [],
      }
    );
  }
}
