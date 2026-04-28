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

const mocks = vi.hoisted(() => ({
  projects: [
    {
      id: "project-1",
      name: "AgentLine",
      path: "/tmp/agentline",
      lastActivity: "2026-04-28T00:00:00.000Z",
    },
  ],
  settings: {
    phoneTalkerProvider: "codex",
    phoneTalkerModel: "gpt-5.2",
    phoneVolcengineAsrAppId: "asr-app",
    phoneVolcengineAsrAccessToken: "asr-token",
    phoneVolcengineTtsAppId: "tts-app",
    phoneVolcengineTtsAccessToken: "tts-token",
    phoneVolcengineTtsVoiceType: "voice-a",
  },
  recorder: {
    isSupported: true,
    isRecording: false,
    status: "idle",
    error: null as string | null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    setProcessing: vi.fn(),
  },
  api: {
    getProjectSessions: vi.fn(),
    startVoiceSecretaryAudioCall: vi.fn(),
    startVoiceSecretaryCall: vi.fn(),
  },
}));

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

describe("VoiceSecretaryPage", () => {
  const audioPlayMock = vi.fn().mockResolvedValue(undefined);
  const audioPauseMock = vi.fn();

  beforeEach(() => {
    mocks.api.getProjectSessions.mockReset();
    mocks.api.startVoiceSecretaryAudioCall.mockReset();
    mocks.api.startVoiceSecretaryCall.mockReset();
    mocks.recorder.startRecording.mockReset();
    mocks.recorder.stopRecording.mockReset();
    mocks.recorder.setProcessing.mockReset();
    mocks.recorder.isRecording = false;
    mocks.recorder.error = null;

    mocks.api.getProjectSessions.mockResolvedValue({ sessions: [] });
    mocks.api.startVoiceSecretaryAudioCall.mockResolvedValue({
      transcript: "Help me understand what this project should do next.",
      talkerText: "Talker final reply",
      audioBase64: "SUQz",
      audioContentType: "audio/mpeg",
      result: {
        callSession: {
          id: "call-1",
          channel: "web-voice",
          status: "completed",
          startedAt: "2026-04-28T00:00:00.000Z",
          transcript: [],
          plannerRuns: [],
          callbackRequests: [],
        },
        plannerRequest: {
          id: "planner-request-1",
          userIntent: "Help me understand what this project should do next.",
          knownConstraints: [],
          missingInformation: [],
          requestedOutcome: "plan",
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
          spokenSummary: "Talker final reply",
          suggestedNextUtterance: "Ask next",
          factsToAvoidOverstating: [],
          questionsToAsk: ["Ask next"],
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

  it("submits recorded audio to the Volcengine-backed route and plays the reply", async () => {
    const audioBlob = new Blob(["wav"], { type: "audio/wav" });
    mocks.recorder.isRecording = true;
    mocks.recorder.stopRecording.mockResolvedValue(audioBlob);

    render(
      <MemoryRouter>
        <VoiceSecretaryPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.api.getProjectSessions).toHaveBeenCalledWith("project-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Start live call" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(mocks.api.startVoiceSecretaryAudioCall).toHaveBeenCalledWith({
        projectPath: "/tmp/agentline",
        conversationSessionId: undefined,
        conversationProvider: undefined,
        audio: audioBlob,
      });
    });

    expect(audioPlayMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Talker final reply").length).toBeGreaterThan(0);
  });
});
