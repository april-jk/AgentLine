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
});
