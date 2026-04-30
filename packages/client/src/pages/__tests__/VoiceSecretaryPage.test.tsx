import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceSecretaryPage } from "../VoiceSecretaryPage";

const mocks = vi.hoisted(() => {
  const recorderState = {
    isSupported: true,
    isRecording: false,
    status: "idle" as const,
    error: null as string | null,
  };
  const speechRecognition = {
    startListening: vi.fn(),
    stopListening: vi.fn(),
  };
  const speechSynthesis = {
    isSupported: true,
    isSpeaking: false,
    error: null as string | null,
    speak: vi.fn(async () => true),
    stop: vi.fn(),
  };
  const recorder = {
    get isSupported() {
      return recorderState.isSupported;
    },
    get isRecording() {
      return recorderState.isRecording;
    },
    get status() {
      return recorderState.status;
    },
    get error() {
      return recorderState.error;
    },
    startRecording: vi.fn(async () => {
      recorderState.isRecording = true;
    }),
    stopRecording: vi.fn(async () => {
      recorderState.isRecording = false;
      return new Blob(["wav"], { type: "audio/wav" });
    }),
    setProcessing: vi.fn(),
  };
  return {
    projects: [
      {
        id: "project-1",
        name: "AgentLine",
        path: "/tmp/agentline",
        lastActivity: "2026-04-28T00:00:00.000Z",
      },
    ],
    settings: {
      phoneTalkerProvider: "custom-api",
      phoneTalkerModel: "deepseek-v4-flash",
      phoneVolcengineAsrAppId: "asr-app",
      phoneVolcengineAsrAccessToken: "asr-token",
      phoneVolcengineTtsAppId: "tts-app",
      phoneVolcengineTtsAccessToken: "tts-token",
      phoneVolcengineTtsVoiceType: "voice-a",
    },
    recorderState,
    recorder,
    speechRecognition,
    speechSynthesis,
    api: {
      getProjectSessions: vi.fn(),
      startVoiceSecretaryAudioCall: vi.fn(),
      startVoiceSecretaryCall: vi.fn(),
      getVoiceSecretarySessionStatus: vi.fn(),
    },
  };
});

vi.mock("../../api/client", () => ({
  api: mocks.api,
}));

vi.mock("../../components/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("../../hooks/useProjects", () => ({
  useProjects: () => ({ projects: mocks.projects }),
}));

vi.mock("../../layouts", () => ({
  useNavigationLayout: () => ({
    openSidebar: vi.fn(),
    isWideScreen: true,
    toggleSidebar: vi.fn(),
    isSidebarCollapsed: false,
  }),
}));

vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));

vi.mock("../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: mocks.settings,
  }),
}));

vi.mock("../../hooks/useVoiceRecorder", () => ({
  useVoiceRecorder: () => mocks.recorder,
}));

vi.mock("../../hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => mocks.speechRecognition,
}));

vi.mock("../../hooks/useSpeechSynthesis", () => ({
  useSpeechSynthesis: () => mocks.speechSynthesis,
}));

describe("VoiceSecretaryPage", () => {
  const audioPlayMock = vi.fn().mockResolvedValue(undefined);
  const audioPauseMock = vi.fn();

  beforeEach(() => {
    mocks.recorderState.isRecording = false;
    mocks.recorderState.error = null;
    mocks.recorder.startRecording.mockClear();
    mocks.recorder.stopRecording.mockClear();
    mocks.recorder.setProcessing.mockClear();
    mocks.speechRecognition.startListening.mockClear();
    mocks.speechRecognition.stopListening.mockClear();
    mocks.speechSynthesis.speak.mockClear();
    mocks.speechSynthesis.stop.mockClear();
    mocks.api.getProjectSessions.mockReset();
    mocks.api.startVoiceSecretaryAudioCall.mockReset();
    mocks.api.startVoiceSecretaryCall.mockReset();
    mocks.api.getVoiceSecretarySessionStatus.mockReset();

    mocks.api.getProjectSessions.mockResolvedValue({ sessions: [] });
    mocks.api.getVoiceSecretarySessionStatus.mockResolvedValue({
      snapshot: {
        id: "voice-1",
        startedAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:00.000Z",
        projectPath: "/tmp/agentline",
        workerSessionId: "session-1",
        workerProvider: "codex",
        workerStatus: "running",
      },
    });
    mocks.api.startVoiceSecretaryAudioCall.mockResolvedValue({
      transcript: "项目现在怎么样？",
      talkerText: "项目已经接通了实时语音链路。",
      audioBase64: "SUQz",
      audioContentType: "audio/mpeg",
      result: {
        callSession: {
          id: "call-1",
          voiceSessionId: "voice-1",
          channel: "web-voice",
          status: "waiting_for_user",
          startedAt: "2026-04-28T00:00:00.000Z",
          workerSessionId: "session-1",
          workerStatus: "running",
          transcript: [],
          plannerRuns: [],
          callbackRequests: [],
        },
        voiceSession: {
          id: "voice-1",
          startedAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
          projectPath: "/tmp/agentline",
          workerSessionId: "session-1",
          workerProvider: "codex",
          workerStatus: "running",
          speakerProjectSummary: "Project summary",
        },
        plannerRequest: {
          id: "planner-request-1",
          userIntent: "项目现在怎么样？",
          knownConstraints: [],
          missingInformation: [],
          requestedOutcome: "summary",
        },
        plannerResult: {
          id: "planner-result-1",
          projectSummary: "Project summary",
          relevantInstructions: [],
          recommendedAction: "create_executor_session",
          executionTask: {
            id: "task-1",
            projectPath: "/tmp/agentline",
            provider: "codex",
            mode: "read_only",
            prompt: "prompt",
            acceptanceCriteria: [],
            riskNotes: [],
            requiredVerification: [],
          },
          talkerBrief: {
            spokenSummary: "Talker brief",
            suggestedNextUtterance: "next",
            factsToAvoidOverstating: [],
            questionsToAsk: [],
          },
        },
        executorReport: {
          executionTaskId: "task-1",
          providerSessionId: "session-1",
          status: "completed",
          summary: "Executor finished",
          changedFiles: [],
          verification: ["Verified"],
        },
        finalBrief: {
          spokenSummary: "项目已经接通了实时语音链路。",
          suggestedNextUtterance: "继续追问",
          factsToAvoidOverstating: [],
          questionsToAsk: [],
        },
      },
    });

    Object.defineProperty(globalThis, "Audio", {
      configurable: true,
      writable: true,
      value: class {
        src = "";
        currentTime = 0;
        onended: null | (() => void) = null;
        onerror: null | (() => void) = null;
        play = audioPlayMock.mockImplementation(async () => {
          this.onended?.();
        });
        pause = audioPauseMock;
      },
    });
    globalThis.URL.createObjectURL = vi.fn(() => "blob:test");
    globalThis.URL.revokeObjectURL = vi.fn();
    globalThis.atob = vi.fn(() => "ID3");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("submits recorded audio and plays the synthesized reply", async () => {
    render(
      <MemoryRouter>
        <VoiceSecretaryPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.api.getProjectSessions).toHaveBeenCalledWith("project-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Start live call" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Record one utterance" }),
    );

    await waitFor(() => {
      expect(mocks.recorder.startRecording).toHaveBeenCalled();
      expect(mocks.speechRecognition.startListening).toHaveBeenCalled();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Send this utterance" }),
    );

    await waitFor(() => {
      expect(mocks.recorder.stopRecording).toHaveBeenCalled();
      expect(mocks.speechRecognition.stopListening).toHaveBeenCalled();
      expect(mocks.api.startVoiceSecretaryAudioCall).toHaveBeenCalledWith(
        expect.objectContaining({
          voiceSessionId: expect.any(String),
          projectPath: "/tmp/agentline",
          conversationSessionId: undefined,
          conversationProvider: undefined,
          audio: expect.any(Blob),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText("项目现在怎么样？").length).toBeGreaterThan(0);
      expect(
        screen.getAllByText("项目已经接通了实时语音链路。").length,
      ).toBeGreaterThan(0);
    });
    expect(audioPlayMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the turn usable when Volcengine TTS fails without using browser speech", async () => {
    mocks.api.startVoiceSecretaryAudioCall.mockResolvedValueOnce({
      transcript: "给我介绍一下这个项目的背景信息",
      talkerText: "这是一个移动优先的 Agent 监督项目。",
      ttsError: "quota exceeded for types: text_words_lifetime",
      result: {
        callSession: {
          id: "call-tts-fallback",
          voiceSessionId: "voice-tts-fallback",
          channel: "web-voice",
          status: "waiting_for_user",
          startedAt: "2026-04-28T00:00:00.000Z",
          workerSessionId: undefined,
          workerStatus: "idle",
          transcript: [],
          plannerRuns: [],
          callbackRequests: [],
        },
        voiceSession: {
          id: "voice-tts-fallback",
          startedAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
          projectPath: "/tmp/agentline",
          workerStatus: "idle",
          speakerProjectSummary: "Project summary",
        },
        plannerRequest: {
          id: "planner-request-fallback",
          userIntent: "给我介绍一下这个项目的背景信息",
          knownConstraints: [],
          missingInformation: [],
          requestedOutcome: "answer",
        },
        plannerResult: {
          id: "planner-result-fallback",
          projectSummary: "Project summary",
          relevantInstructions: [],
          recommendedAction: "answer_directly",
          talkerBrief: {
            spokenSummary: "这是一个移动优先的 Agent 监督项目。",
            suggestedNextUtterance: "要我继续展开最近进展吗？",
            factsToAvoidOverstating: [],
            questionsToAsk: [],
          },
        },
        executorReport: {
          executionTaskId: "speaker-direct",
          providerSessionId: "speaker-direct",
          status: "completed",
          summary: "Speaker 直接回答了当前问题。",
          changedFiles: [],
          verification: ["No worker handoff"],
        },
        finalBrief: {
          spokenSummary: "这是一个移动优先的 Agent 监督项目。",
          suggestedNextUtterance: "要我继续展开最近进展吗？",
          factsToAvoidOverstating: [],
          questionsToAsk: [],
        },
      },
    });

    render(
      <MemoryRouter>
        <VoiceSecretaryPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.api.getProjectSessions).toHaveBeenCalledWith("project-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Start live call" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Record one utterance" }),
    );
    await waitFor(() => {
      expect(mocks.recorder.startRecording).toHaveBeenCalled();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send this utterance" }),
    );

    await waitFor(() => {
      expect(
        screen.getAllByText("这是一个移动优先的 Agent 监督项目。").length,
      ).toBeGreaterThan(0);
    });

    expect(mocks.speechSynthesis.speak).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Volcengine TTS failed, no audio was played/i),
    ).toBeTruthy();
    expect(audioPlayMock).not.toHaveBeenCalled();
  });

  it("uses the live conversation as the primary typed-turn transcript without duplicating the Talker panel", async () => {
    mocks.api.startVoiceSecretaryCall.mockResolvedValue({
      result: {
        callSession: {
          id: "call-typed-1",
          voiceSessionId: "voice-typed-1",
          channel: "web-voice",
          status: "waiting_for_user",
          startedAt: "2026-04-28T00:00:00.000Z",
          workerSessionId: undefined,
          workerStatus: "idle",
          transcript: [],
          plannerRuns: [],
          callbackRequests: [],
        },
        voiceSession: {
          id: "voice-typed-1",
          startedAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
          projectPath: "/tmp/agentline",
          workerStatus: "idle",
          speakerProjectSummary: "Project summary",
        },
        plannerRequest: {
          id: "planner-request-typed-1",
          userIntent: "最近一次代码提交是什么？",
          knownConstraints: [],
          missingInformation: [],
          requestedOutcome: "answer",
        },
        plannerResult: {
          id: "planner-result-typed-1",
          projectSummary: "Project summary",
          relevantInstructions: [],
          recommendedAction: "answer_directly",
          talkerBrief: {
            spokenSummary:
              "最近一次提交是 abc123，主题是“修复 Voice Secretary”。",
            suggestedNextUtterance: "要我继续展开这次提交吗？",
            factsToAvoidOverstating: [],
            questionsToAsk: [],
          },
        },
        executorReport: {
          executionTaskId: "speaker-direct",
          providerSessionId: "speaker-direct",
          status: "completed",
          summary: "Speaker 直接回答了当前问题。",
          changedFiles: [],
          verification: ["No worker handoff"],
        },
        finalBrief: {
          spokenSummary:
            "最近一次提交是 abc123，主题是“修复 Voice Secretary”。",
          suggestedNextUtterance: "要我继续展开这次提交吗？",
          factsToAvoidOverstating: [],
          questionsToAsk: [],
        },
      },
    });

    render(
      <MemoryRouter>
        <VoiceSecretaryPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.api.getProjectSessions).toHaveBeenCalledWith("project-1");
    });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "最近一次代码提交是什么？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send typed turn" }));

    await waitFor(() => {
      expect(mocks.api.startVoiceSecretaryCall).toHaveBeenCalledWith(
        expect.objectContaining({
          projectPath: "/tmp/agentline",
          utterance: "最近一次代码提交是什么？",
        }),
      );
    });

    expect(
      screen.getAllByText(
        "最近一次提交是 abc123，主题是“修复 Voice Secretary”。",
      ),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("heading", {
        name: "Talker",
      }),
    ).toBeNull();
  });

  it("surfaces worker progress updates back into the live conversation", async () => {
    mocks.api.startVoiceSecretaryCall.mockResolvedValueOnce({
      result: {
        callSession: {
          id: "call-typed-worker",
          voiceSessionId: "voice-typed-worker",
          channel: "web-voice",
          status: "waiting_for_user",
          startedAt: "2026-04-28T00:00:00.000Z",
          workerSessionId: "session-worker",
          workerStatus: "running",
          transcript: [],
          plannerRuns: [],
          callbackRequests: [],
        },
        voiceSession: {
          id: "voice-typed-worker",
          startedAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
          projectPath: "/tmp/agentline",
          workerSessionId: "session-worker",
          workerProvider: "codex",
          workerStatus: "running",
        },
        plannerRequest: {
          id: "planner-request-worker",
          userIntent: "语音识别是怎么实现的？",
          knownConstraints: [],
          missingInformation: [],
          requestedOutcome: "answer",
        },
        plannerResult: {
          id: "planner-result-worker",
          projectSummary: "Project summary",
          relevantInstructions: [],
          recommendedAction: "consult_worker",
          executionTask: {
            id: "task-worker",
            projectPath: "/tmp/agentline",
            provider: "codex",
            mode: "read_only",
            prompt: "prompt",
            acceptanceCriteria: [],
            riskNotes: [],
            requiredVerification: [],
          },
          talkerBrief: {
            spokenSummary: "语音识别现在有两层。",
            suggestedNextUtterance: "要我继续拆这一块吗？",
            factsToAvoidOverstating: [],
            questionsToAsk: [],
          },
        },
        executorReport: {
          executionTaskId: "task-worker",
          providerSessionId: "session-worker",
          status: "started",
          summary: "Worker is running",
          changedFiles: [],
          verification: [],
        },
        finalBrief: {
          spokenSummary: "语音识别现在有两层。",
          suggestedNextUtterance: "要我继续拆这一块吗？",
          factsToAvoidOverstating: [],
          questionsToAsk: [],
        },
      },
    });

    mocks.api.getVoiceSecretarySessionStatus.mockResolvedValueOnce({
      snapshot: {
        id: "voice-typed-worker",
        startedAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:03.000Z",
        projectPath: "/tmp/agentline",
        workerSessionId: "session-worker",
        workerProvider: "codex",
        workerStatus: "running",
        latestWorkerMessage:
          "现在这块是双层实现。前端实时字幕用 Web Speech API 预览，正式转写走服务端火山 ASR。",
      },
    });

    render(
      <MemoryRouter>
        <VoiceSecretaryPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.api.getProjectSessions).toHaveBeenCalledWith("project-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Start live call" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "语音识别是怎么实现的？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send typed turn" }));

    await waitFor(() => {
      expect(mocks.api.startVoiceSecretaryCall).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          /前端实时字幕用 Web Speech API 预览，正式转写走服务端火山 语音识别，我继续帮你盯着/,
        ),
      ).toBeTruthy();
    });
  });

  it("does not append stale worker updates when the current turn has no bound worker", async () => {
    mocks.api.startVoiceSecretaryCall.mockResolvedValueOnce({
      result: {
        callSession: {
          id: "call-typed-direct",
          voiceSessionId: "voice-typed-direct",
          channel: "web-voice",
          status: "waiting_for_user",
          startedAt: "2026-04-28T00:00:00.000Z",
          workerSessionId: undefined,
          workerStatus: "idle",
          transcript: [],
          plannerRuns: [],
          callbackRequests: [],
        },
        voiceSession: {
          id: "voice-typed-direct",
          startedAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
          projectPath: "/tmp/agentline",
          workerStatus: "idle",
        },
        plannerRequest: {
          id: "planner-request-direct",
          userIntent: "给我介绍一下项目现在的信息。",
          knownConstraints: [],
          missingInformation: [],
          requestedOutcome: "answer",
        },
        plannerResult: {
          id: "planner-result-direct",
          projectSummary: "Project summary",
          relevantInstructions: [],
          recommendedAction: "answer_directly",
          talkerBrief: {
            spokenSummary: "这是项目的基础介绍。",
            suggestedNextUtterance: "要我继续讲下一步吗？",
            factsToAvoidOverstating: [],
            questionsToAsk: [],
          },
        },
        executorReport: {
          executionTaskId: "speaker-direct",
          providerSessionId: "speaker-direct",
          status: "completed",
          summary: "Speaker 直接回答了当前问题。",
          changedFiles: [],
          verification: ["No worker handoff"],
        },
        finalBrief: {
          spokenSummary: "这是项目的基础介绍。",
          suggestedNextUtterance: "要我继续讲下一步吗？",
          factsToAvoidOverstating: [],
          questionsToAsk: [],
        },
      },
    });

    mocks.api.getVoiceSecretarySessionStatus.mockResolvedValueOnce({
      snapshot: {
        id: "voice-typed-direct",
        startedAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:03.000Z",
        projectPath: "/tmp/agentline",
        workerStatus: "idle",
        latestWorkerMessage:
          "现在这块是双层实现。前端实时字幕用 Web Speech API 预览，正式转写走服务端火山 ASR。",
      },
    });

    render(
      <MemoryRouter>
        <VoiceSecretaryPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.api.getProjectSessions).toHaveBeenCalledWith("project-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Start live call" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "给我介绍一下项目现在的信息。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send typed turn" }));

    await waitFor(() => {
      expect(mocks.api.startVoiceSecretaryCall).toHaveBeenCalled();
    });

    expect(screen.getAllByText("这是项目的基础介绍。")).toHaveLength(1);
    expect(screen.queryByText(/前端实时字幕用 Web Speech API 预览/)).toBeNull();
  });
});
