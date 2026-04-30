import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { type VoiceSecretaryResult, api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { useProjects } from "../hooks/useProjects";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useServerSettings } from "../hooks/useServerSettings";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { useNavigationLayout } from "../layouts";
import type { SessionSummary } from "../types";

interface LiveTurn {
  id: string;
  speaker: "user" | "talker" | "system";
  text: string;
}

type CallPhase =
  | "idle"
  | "ready"
  | "recording"
  | "processing"
  | "playing"
  | "unsupported";

function makeId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`voice-status voice-status-${status}`}>{status}</span>
  );
}

function ResultSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="voice-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function TextList({ items }: { items: string[] | undefined }) {
  if (!items || items.length === 0) {
    return <p className="voice-muted">None</p>;
  }
  return (
    <ul className="voice-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function buildResultConversationTurns(
  result: VoiceSecretaryResult,
): Array<{ id: string; speaker: "user" | "talker" | "system"; text: string }> {
  const turns = result.callSession.transcript
    .filter((turn) => turn.speaker === "user" || turn.speaker === "talker")
    .map((turn) => ({
      id: turn.id,
      speaker: turn.speaker,
      text: turn.text,
    }));

  const finalSummary = result.finalBrief.spokenSummary.trim();
  const hasMatchingTalkerTurn = turns.some(
    (turn) => turn.speaker === "talker" && turn.text.trim() === finalSummary,
  );
  if (finalSummary && !hasMatchingTalkerTurn) {
    turns.push({
      id: `${result.callSession.id}-final-brief`,
      speaker: "talker",
      text: finalSummary,
    });
  }

  return turns;
}

function ConversationBubbles({
  turns,
}: {
  turns: Array<{
    id: string;
    speaker: "user" | "talker" | "system";
    text: string;
  }>;
}) {
  if (turns.length === 0) {
    return <p className="voice-muted">No conversation yet</p>;
  }

  return (
    <div className="voice-bubbles" aria-label="Talker conversation">
      {turns.map((turn) => {
        const isUser = turn.speaker === "user";
        const isSystem = turn.speaker === "system";
        return (
          <div
            key={turn.id}
            className={`voice-bubble-row ${
              isSystem
                ? "voice-bubble-system"
                : isUser
                  ? "voice-bubble-user"
                  : "voice-bubble-talker"
            }`}
          >
            <div className="voice-bubble-meta">
              {isSystem ? "System" : isUser ? "You" : "Talker"}
            </div>
            <div className="voice-bubble">{turn.text}</div>
          </div>
        );
      })}
    </div>
  );
}

function VoiceSecretaryResultView({
  result,
}: { result: VoiceSecretaryResult }) {
  const basePath = useRemoteBasePath();
  const sessionLink = result.executorReport.links?.[0]?.href;
  const task = result.plannerResult.executionTask;
  const voiceSession = result.voiceSession;
  const turns = buildResultConversationTurns(result);

  return (
    <div className="voice-results">
      <div className="voice-result-summary">
        <div>
          <span className="voice-kicker">Voice session</span>
          <strong>{voiceSession.id}</strong>
        </div>
        <div>
          <span className="voice-kicker">Project expert</span>
          <strong>{voiceSession.workerSessionId ?? "Not bound yet"}</strong>
        </div>
        <div>
          <span className="voice-kicker">Worker provider</span>
          <strong>{voiceSession.workerProvider ?? "None"}</strong>
        </div>
        <StatusBadge status={voiceSession.workerStatus} />
      </div>

      <ResultSection title="Talker">
        <ConversationBubbles turns={turns} />
      </ResultSection>

      <ResultSection title="Worker">
        <div className="voice-worker-block">
          <span className="voice-kicker">Speaker context</span>
          <p>
            {voiceSession.speakerProjectSummary ??
              result.plannerResult.projectSummary}
          </p>
        </div>

        <div className="voice-grid">
          <div>
            <span className="voice-kicker">Plan action</span>
            <strong>{task?.mode ?? "none"}</strong>
          </div>
          <div>
            <span className="voice-kicker">Provider</span>
            <strong>{task?.provider ?? "none"}</strong>
          </div>
          <div>
            <span className="voice-kicker">Executor session</span>
            <StatusBadge status={result.executorReport.status} />
          </div>
        </div>

        <div className="voice-worker-block">
          <span className="voice-kicker">Handoff result</span>
          <p>{result.executorReport.summary}</p>
          <div className="voice-grid voice-grid-compact">
            <div>
              <span className="voice-kicker">Bound worker</span>
              <strong>
                {voiceSession.workerSessionId ??
                  result.executorReport.providerSessionId}
              </strong>
            </div>
            <div>
              <span className="voice-kicker">Latest worker message</span>
              <strong>
                {voiceSession.latestWorkerMessage ? "Available" : "None yet"}
              </strong>
            </div>
          </div>
          {sessionLink ? (
            <Link
              className="voice-session-link"
              to={`${basePath}${sessionLink}`}
            >
              Open Codex session
            </Link>
          ) : null}
          <TextList items={result.executorReport.verification} />
        </div>

        <div className="voice-worker-block">
          <span className="voice-kicker">Talker callback</span>
          <p>{result.finalBrief.spokenSummary}</p>
          <TextList items={result.finalBrief.questionsToAsk} />
        </div>

        <div className="voice-instruction-list">
          {result.plannerResult.relevantInstructions.map((instruction) => (
            <details key={instruction.path}>
              <summary>{instruction.path}</summary>
              <p>{instruction.summary}</p>
            </details>
          ))}
        </div>
      </ResultSection>
    </div>
  );
}

function getCallPhaseLabel(phase: CallPhase): string {
  switch (phase) {
    case "ready":
      return "Ready for recording";
    case "recording":
      return "Recording caller audio...";
    case "processing":
      return "Volcengine ASR / Talker / TTS in progress...";
    case "playing":
      return "Playing Talker reply...";
    case "unsupported":
      return "Audio capture unavailable";
    default:
      return "Idle";
  }
}

function getConfiguredSpeechLabel(
  settings: {
    phoneVolcengineAsrAppId?: string;
    phoneVolcengineAsrAccessToken?: string;
    phoneVolcengineTtsAppId?: string;
    phoneVolcengineTtsAccessToken?: string;
    phoneVolcengineTtsVoiceType?: string;
  } | null,
): string {
  const asrReady = Boolean(
    settings?.phoneVolcengineAsrAppId && settings.phoneVolcengineAsrAccessToken,
  );
  const ttsReady = Boolean(
    settings?.phoneVolcengineTtsAppId &&
      settings.phoneVolcengineTtsAccessToken &&
      settings.phoneVolcengineTtsVoiceType,
  );

  if (asrReady && ttsReady) {
    return "Volcengine ASR/TTS ready";
  }
  return "Volcengine speech config incomplete";
}

function toLiveTurn(speaker: LiveTurn["speaker"], text: string): LiveTurn {
  return {
    id: makeId(),
    speaker,
    text,
  };
}

function joinTranscriptText(current: string, incoming: string): string {
  const left = current.trim();
  const right = incoming.trim();
  if (!left) return right;
  if (!right) return left;
  if (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)) {
    return `${left} ${right}`;
  }
  return `${left}${right}`;
}

export function VoiceSecretaryPage() {
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const { projects } = useProjects();
  const { settings } = useServerSettings();
  const recorder = useVoiceRecorder();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeUserTurnIdRef = useRef<string | null>(null);
  const activeTalkerTurnIdRef = useRef<string | null>(null);
  const liveTranscriptRef = useRef("");
  const visibleTalkerTextRef = useRef("");
  const pendingTalkerTextRef = useRef("");
  const talkerTextFrameRef = useRef<number | null>(null);

  const [projectPath, setProjectPath] = useState("");
  const [conversationSessionId, setConversationSessionId] = useState("");
  const [projectSessions, setProjectSessions] = useState<SessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [utterance, setUtterance] = useState(
    "Help me understand what this project should do next.",
  );
  const [liveTurns, setLiveTurns] = useState<LiveTurn[]>([]);
  const [result, setResult] = useState<VoiceSecretaryResult | null>(null);
  const [voiceSessionId, setVoiceSessionId] = useState("");
  const [hasServerVoiceSession, setHasServerVoiceSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callPhase, setCallPhase] = useState<CallPhase>(
    recorder.isSupported ? "idle" : "unsupported",
  );
  const [isCallActive, setIsCallActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
        const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
        return bTime - aTime;
      }),
    [projects],
  );

  const selectedProject = useMemo(
    () => sortedProjects.find((project) => project.path === projectPath),
    [projectPath, sortedProjects],
  );

  const sortedProjectSessions = useMemo(
    () =>
      [...projectSessions].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [projectSessions],
  );

  const selectedConversation = useMemo(
    () =>
      sortedProjectSessions.find(
        (session) => session.id === conversationSessionId,
      ) ?? null,
    [conversationSessionId, sortedProjectSessions],
  );

  const appendLiveTurn = useCallback((turn: LiveTurn) => {
    setLiveTurns((current) => current.concat(turn));
  }, []);

  const upsertLiveTurn = useCallback(
    (id: string, speaker: LiveTurn["speaker"], text: string) => {
      setLiveTurns((current) => {
        const normalized = text.trim();
        const index = current.findIndex((turn) => turn.id === id);
        if (index >= 0) {
          if (!normalized) {
            return current.filter((turn) => turn.id !== id);
          }
          const next = current.slice();
          const existing = next[index];
          if (!existing) {
            return current;
          }
          next[index] = { id: existing.id, speaker, text: normalized };
          return next;
        }
        if (!normalized) {
          return current;
        }
        return current.concat({ id, speaker, text: normalized });
      });
    },
    [],
  );

  const clearLiveTurn = useCallback((id: string | null) => {
    if (!id) return;
    setLiveTurns((current) => current.filter((turn) => turn.id !== id));
  }, []);

  const stopTalkerTextPump = useCallback(() => {
    if (talkerTextFrameRef.current !== null) {
      window.cancelAnimationFrame(talkerTextFrameRef.current);
      talkerTextFrameRef.current = null;
    }
  }, []);

  const pumpTalkerText = useCallback(() => {
    if (talkerTextFrameRef.current !== null) {
      return;
    }

    const flushNextFrame = () => {
      const turnId = activeTalkerTurnIdRef.current;
      if (!turnId || pendingTalkerTextRef.current.length === 0) {
        talkerTextFrameRef.current = null;
        return;
      }

      const pendingLength = pendingTalkerTextRef.current.length;
      const chunkSize = pendingLength > 48 ? 16 : pendingLength > 24 ? 10 : 6;
      const nextChunk = pendingTalkerTextRef.current.slice(0, chunkSize);
      pendingTalkerTextRef.current =
        pendingTalkerTextRef.current.slice(chunkSize);
      visibleTalkerTextRef.current += nextChunk;
      upsertLiveTurn(turnId, "talker", visibleTalkerTextRef.current);
      talkerTextFrameRef.current = window.requestAnimationFrame(flushNextFrame);
    };

    talkerTextFrameRef.current = window.requestAnimationFrame(flushNextFrame);
  }, [upsertLiveTurn]);

  const flushTalkerTextNow = useCallback(() => {
    const turnId = activeTalkerTurnIdRef.current;
    if (!turnId) {
      pendingTalkerTextRef.current = "";
      return;
    }
    if (pendingTalkerTextRef.current) {
      visibleTalkerTextRef.current += pendingTalkerTextRef.current;
      pendingTalkerTextRef.current = "";
      upsertLiveTurn(turnId, "talker", visibleTalkerTextRef.current);
    }
  }, [upsertLiveTurn]);

  const speechRecognition = useSpeechRecognition({
    lang: "zh-CN",
    onInterimResult: (interimText) => {
      if (!isCallActive || !recorder.isRecording) return;
      const turnId = activeUserTurnIdRef.current ?? makeId();
      activeUserTurnIdRef.current = turnId;
      upsertLiveTurn(
        turnId,
        "user",
        joinTranscriptText(liveTranscriptRef.current, interimText),
      );
    },
    onResult: (finalChunk) => {
      if (!isCallActive || !recorder.isRecording) return;
      liveTranscriptRef.current = joinTranscriptText(
        liveTranscriptRef.current,
        finalChunk,
      );
      const turnId = activeUserTurnIdRef.current ?? makeId();
      activeUserTurnIdRef.current = turnId;
      upsertLiveTurn(turnId, "user", liveTranscriptRef.current);
    },
    onError: (speechError) => {
      if (recorder.isRecording) {
        setError(speechError);
      }
    },
  });

  const browserSpeechLabel = useMemo(
    () =>
      recorder.isSupported
        ? "Microphone capture ready"
        : "No microphone capture",
    [recorder.isSupported],
  );

  useEffect(() => {
    if (projectPath || sortedProjects.length === 0) return;
    const agentLineProject =
      sortedProjects.find((project) => project.name === "AgentLine") ??
      sortedProjects[0];
    if (agentLineProject) {
      setProjectPath(agentLineProject.path);
    }
  }, [projectPath, sortedProjects]);

  useEffect(() => {
    setConversationSessionId("");
    setProjectSessions([]);
    setSessionsError(null);
    if (!selectedProject) return;

    let cancelled = false;
    setIsLoadingSessions(true);
    api
      .getProjectSessions(selectedProject.id)
      .then((response) => {
        if (!cancelled) {
          setProjectSessions(response.sessions);
        }
      })
      .catch((sessionError) => {
        if (!cancelled) {
          setSessionsError(
            sessionError instanceof Error
              ? sessionError.message
              : String(sessionError),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSessions(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProject]);

  useEffect(() => {
    if (!recorder.error) return;
    setError(recorder.error);
  }, [recorder.error]);

  useEffect(() => {
    return () => {
      stopTalkerTextPump();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, [stopTalkerTextPump]);

  useEffect(() => {
    if (!isCallActive || !voiceSessionId || !hasServerVoiceSession) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await api.getVoiceSecretarySessionStatus(voiceSessionId);
        if (cancelled) return;
        if (status.hook) {
          appendLiveTurn(toLiveTurn("talker", status.hook.text));
        }
      } catch {
        // Ignore ephemeral polling errors; the main turn path already surfaces hard failures.
      }
    };
    const handle = window.setInterval(() => {
      void poll();
    }, 3000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [appendLiveTurn, hasServerVoiceSession, isCallActive, voiceSessionId]);

  const playAudioReply = useCallback(
    async (audioBase64: string, contentType: string) => {
      const binary = Uint8Array.from(atob(audioBase64), (char) =>
        char.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([binary], { type: contentType }),
      );
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = url;

      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
      URL.revokeObjectURL(url);
    },
    [],
  );

  const submitRecordedAudio = useCallback(
    async (audio: Blob) => {
      if (!projectPath.trim()) return;
      const sessionId = voiceSessionId || makeId();
      if (!voiceSessionId) {
        setVoiceSessionId(sessionId);
      }
      setHasServerVoiceSession(false);

      recorder.setProcessing(true);
      setIsSubmitting(true);
      setError(null);
      setCallPhase("processing");

      try {
        visibleTalkerTextRef.current = "";
        pendingTalkerTextRef.current = "";
        stopTalkerTextPump();
        const talkerTurnId = makeId();
        activeTalkerTurnIdRef.current = talkerTurnId;
        const response = await api.startVoiceSecretaryAudioCall({
          voiceSessionId: sessionId,
          projectPath: projectPath.trim(),
          conversationSessionId: conversationSessionId.trim() || undefined,
          conversationProvider: selectedConversation?.provider,
          audio,
        });

        liveTranscriptRef.current = response.transcript;
        setLastTranscript(response.transcript);
        setUtterance(response.transcript);
        const userTurnId = activeUserTurnIdRef.current ?? makeId();
        activeUserTurnIdRef.current = userTurnId;
        upsertLiveTurn(userTurnId, "user", response.transcript);

        pendingTalkerTextRef.current = response.talkerText;
        if (!visibleTalkerTextRef.current) {
          upsertLiveTurn(talkerTurnId, "talker", "");
        }
        pumpTalkerText();
        flushTalkerTextNow();

        setResult(response.result);
        setVoiceSessionId(response.result.voiceSession.id);
        setHasServerVoiceSession(true);
        setCallPhase("playing");
        await playAudioReply(response.audioBase64, response.audioContentType);
        setCallPhase(isCallActive ? "ready" : "idle");
      } catch (turnError) {
        const message =
          turnError instanceof Error ? turnError.message : String(turnError);
        setError(message);
        appendLiveTurn(toLiveTurn("system", message));
        clearLiveTurn(activeTalkerTurnIdRef.current);
        setCallPhase(isCallActive ? "ready" : "idle");
      } finally {
        liveTranscriptRef.current = "";
        visibleTalkerTextRef.current = "";
        pendingTalkerTextRef.current = "";
        stopTalkerTextPump();
        activeUserTurnIdRef.current = null;
        activeTalkerTurnIdRef.current = null;
        recorder.setProcessing(false);
        setIsSubmitting(false);
      }
    },
    [
      appendLiveTurn,
      clearLiveTurn,
      conversationSessionId,
      isCallActive,
      playAudioReply,
      projectPath,
      recorder,
      flushTalkerTextNow,
      selectedConversation?.provider,
      pumpTalkerText,
      stopTalkerTextPump,
      upsertLiveTurn,
      voiceSessionId,
    ],
  );

  const startCall = useCallback(() => {
    setError(null);
    setIsCallActive(true);
    setVoiceSessionId((current) => current || makeId());
    setHasServerVoiceSession(false);
    setCallPhase(recorder.isSupported ? "ready" : "unsupported");
    if (liveTurns.length === 0) {
      appendLiveTurn(
        toLiveTurn(
          "system",
          "通话已开始。你说话时，这里会实时显示输入与回复。",
        ),
      );
    }
  }, [appendLiveTurn, liveTurns.length, recorder.isSupported]);

  const endCall = useCallback(() => {
    setIsCallActive(false);
    setVoiceSessionId("");
    setHasServerVoiceSession(false);
    setCallPhase(recorder.isSupported ? "idle" : "unsupported");
    speechRecognition.stopListening();
    if (recorder.isRecording) {
      void recorder.stopRecording();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    liveTranscriptRef.current = "";
    visibleTalkerTextRef.current = "";
    pendingTalkerTextRef.current = "";
    stopTalkerTextPump();
    activeUserTurnIdRef.current = null;
    activeTalkerTurnIdRef.current = null;
  }, [
    recorder.isRecording,
    recorder.isSupported,
    recorder.stopRecording,
    speechRecognition,
    stopTalkerTextPump,
  ]);

  const toggleRecording = useCallback(async () => {
    if (!isCallActive) return;

    if (recorder.isRecording) {
      speechRecognition.stopListening();
      const audio = await recorder.stopRecording();
      if (audio) {
        await submitRecordedAudio(audio);
      }
      return;
    }

    setError(null);
    liveTranscriptRef.current = "";
    activeUserTurnIdRef.current = makeId();
    clearLiveTurn(activeTalkerTurnIdRef.current);
    activeTalkerTurnIdRef.current = null;
    setCallPhase("recording");
    await recorder.startRecording();
    speechRecognition.startListening();
  }, [
    clearLiveTurn,
    isCallActive,
    recorder,
    speechRecognition,
    submitRecordedAudio,
  ]);

  const submitTypedTurn = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!projectPath.trim() || !utterance.trim()) return;
      const sessionId = voiceSessionId || makeId();
      if (!voiceSessionId) {
        setVoiceSessionId(sessionId);
      }
      setHasServerVoiceSession(false);

      setIsSubmitting(true);
      setError(null);
      setCallPhase("processing");

      try {
        const response = await api.startVoiceSecretaryCall({
          voiceSessionId: sessionId,
          projectPath: projectPath.trim(),
          conversationSessionId: conversationSessionId.trim() || undefined,
          conversationProvider: selectedConversation?.provider,
          utterance: utterance.trim(),
        });
        setLastTranscript(utterance.trim());
        appendLiveTurn(toLiveTurn("user", utterance.trim()));
        appendLiveTurn(
          toLiveTurn("talker", response.result.finalBrief.spokenSummary),
        );
        setResult(response.result);
        setVoiceSessionId(response.result.voiceSession.id);
        setHasServerVoiceSession(true);
        setCallPhase(isCallActive ? "ready" : "idle");
      } catch (turnError) {
        const message =
          turnError instanceof Error ? turnError.message : String(turnError);
        setError(message);
        appendLiveTurn(toLiveTurn("system", message));
        setCallPhase(isCallActive ? "ready" : "idle");
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      appendLiveTurn,
      conversationSessionId,
      isCallActive,
      projectPath,
      selectedConversation?.provider,
      utterance,
      voiceSessionId,
    ],
  );

  const callStatusLabel = getCallPhaseLabel(callPhase);

  return (
    <div
      className={isWideScreen ? "main-content-wrapper" : "main-content-mobile"}
    >
      <div
        className={
          isWideScreen
            ? "main-content-constrained"
            : "main-content-mobile-inner"
        }
      >
        <PageHeader
          title="Voice Secretary"
          onOpenSidebar={openSidebar}
          onToggleSidebar={toggleSidebar}
          isWideScreen={isWideScreen}
          isSidebarCollapsed={isSidebarCollapsed}
        />

        <main className="page-scroll-container">
          <div className="page-content-inner">
            <section className="voice-live-console">
              <div className="voice-live-header">
                <div>
                  <span className="voice-kicker">Live call</span>
                  <h2>Volcengine voice conversation</h2>
                  <p>
                    Start the call to open the live chat immediately. Your
                    speech appears while you talk, then Talker replies with
                    streamed text and Volcengine TTS audio.
                  </p>
                </div>
                <div className="voice-live-actions">
                  <button
                    type="button"
                    onClick={isCallActive ? endCall : startCall}
                    disabled={!projectPath.trim() || isSubmitting}
                  >
                    {isCallActive ? "End live call" : "Start live call"}
                  </button>
                  <StatusBadge status={callPhase} />
                </div>
              </div>

              <div className="voice-live-grid">
                <div className="voice-live-card">
                  <span className="voice-kicker">Capture</span>
                  <strong>{browserSpeechLabel}</strong>
                  <p>{callStatusLabel}</p>
                </div>
                <div className="voice-live-card">
                  <span className="voice-kicker">Configured provider</span>
                  <strong>
                    {settings?.phoneTalkerProvider ?? "codex"} ·{" "}
                    {settings?.phoneTalkerModel ?? "gpt-5.2"}
                  </strong>
                  <p>{getConfiguredSpeechLabel(settings)}</p>
                </div>
                <div className="voice-live-card">
                  <span className="voice-kicker">Last transcript</span>
                  <strong>{lastTranscript || "None yet"}</strong>
                  <p>
                    {recorder.isRecording
                      ? "Showing live microphone transcript"
                      : isSubmitting
                        ? "Waiting for streamed Talker reply"
                        : "Ready for the next utterance"}
                  </p>
                </div>
              </div>

              <div className="voice-live-toolbar">
                <button
                  type="button"
                  onClick={() => {
                    void toggleRecording();
                  }}
                  disabled={
                    !isCallActive || isSubmitting || !recorder.isSupported
                  }
                >
                  {recorder.isRecording
                    ? "Send this utterance"
                    : "Record one utterance"}
                </button>
                <span>
                  Real voice mode now uses browser live transcript plus
                  Volcengine server-side ASR/TTS streaming.
                </span>
              </div>

              <ConversationBubbles turns={liveTurns} />
            </section>

            <form className="voice-console" onSubmit={submitTypedTurn}>
              <div className="voice-form-row voice-form-row-single">
                <label>
                  <span>Project</span>
                  <select
                    value={projectPath}
                    onChange={(event) => {
                      setProjectPath(event.target.value);
                      setResult(null);
                    }}
                  >
                    <option value="">Select a project</option>
                    {sortedProjects.map((project) => (
                      <option key={project.id} value={project.path}>
                        {project.name} - {project.path}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="voice-form-row voice-form-row-single">
                <label>
                  <span>Conversation</span>
                  <select
                    value={conversationSessionId}
                    onChange={(event) => {
                      setConversationSessionId(event.target.value);
                      setResult(null);
                    }}
                    disabled={!selectedProject || isLoadingSessions}
                  >
                    <option value="">
                      {isLoadingSessions
                        ? "Loading conversations..."
                        : "Project scope (default)"}
                    </option>
                    {sortedProjectSessions.map((session) => {
                      const title =
                        session.customTitle ?? session.title ?? "Untitled";
                      const provider = session.provider
                        ? ` · ${session.provider}`
                        : "";
                      return (
                        <option key={session.id} value={session.id}>
                          {title}
                          {provider} · {session.id}
                        </option>
                      );
                    })}
                  </select>
                  {sessionsError ? (
                    <small className="voice-field-error">
                      Failed to load conversations: {sessionsError}
                    </small>
                  ) : null}
                </label>
              </div>

              <label className="voice-utterance">
                <span>Fallback typed utterance</span>
                <textarea
                  value={utterance}
                  onChange={(event) => setUtterance(event.target.value)}
                  rows={4}
                />
              </label>

              <div className="voice-actions">
                <button
                  type="submit"
                  disabled={
                    isSubmitting || !projectPath.trim() || !utterance.trim()
                  }
                >
                  {isSubmitting ? "Submitting..." : "Send typed turn"}
                </button>
                <span>
                  Typed fallback still uses the same Talker/Worker flow when you
                  do not want to record audio.
                </span>
              </div>
            </form>

            {error ? <div className="voice-error">{error}</div> : null}

            {result ? (
              <VoiceSecretaryResultView result={result} />
            ) : (
              <div className="voice-empty">
                <h2>Ready</h2>
                <p>
                  Start a live call, then record one utterance to send real
                  audio through Volcengine ASR/TTS.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
