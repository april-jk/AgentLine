import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type VoiceSecretaryResult, api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { useProjects } from "../hooks/useProjects";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useNavigationLayout } from "../layouts";
import type { SessionSummary } from "../types";

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

function ConversationBubbles({ result }: { result: VoiceSecretaryResult }) {
  const visibleTurns = result.callSession.transcript.filter(
    (turn) => turn.speaker === "user" || turn.speaker === "talker",
  );

  return (
    <div className="voice-bubbles" aria-label="Talker conversation">
      {visibleTurns.map((turn) => {
        const isUser = turn.speaker === "user";
        return (
          <div
            key={turn.id}
            className={`voice-bubble-row ${isUser ? "voice-bubble-user" : "voice-bubble-talker"}`}
          >
            <div className="voice-bubble-meta">{isUser ? "You" : "Talker"}</div>
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
  const contextLabel = result.callSession.conversationSessionId
    ? "Conversation"
    : "Project";

  return (
    <div className="voice-results">
      <div className="voice-result-summary">
        <div>
          <span className="voice-kicker">Talker</span>
          <strong>{result.callSession.id}</strong>
        </div>
        <div>
          <span className="voice-kicker">Worker context</span>
          <strong>{contextLabel}</strong>
        </div>
        <div>
          <span className="voice-kicker">Worker action</span>
          <strong>{result.plannerResult.recommendedAction}</strong>
        </div>
        <StatusBadge status={result.callSession.status} />
      </div>

      <ResultSection title="Talker">
        <ConversationBubbles result={result} />
      </ResultSection>

      <ResultSection title="Worker">
        <div className="voice-worker-block">
          <span className="voice-kicker">Project context</span>
          <p>{result.plannerResult.projectSummary}</p>
        </div>

        <div className="voice-grid">
          <div>
            <span className="voice-kicker">Task</span>
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
              <span className="voice-kicker">
                {result.callSession.conversationSessionId
                  ? "Selected conversation"
                  : "Session"}
              </span>
              <strong>{result.executorReport.providerSessionId}</strong>
            </div>
            <div>
              <span className="voice-kicker">Changed files</span>
              <strong>{result.executorReport.changedFiles?.length ?? 0}</strong>
            </div>
          </div>
          {sessionLink && (
            <Link
              className="voice-session-link"
              to={`${basePath}${sessionLink}`}
            >
              Open Codex session
            </Link>
          )}
          <TextList items={result.executorReport.verification} />
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

export function VoiceSecretaryPage() {
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const { projects } = useProjects();
  const [projectPath, setProjectPath] = useState("");
  const [conversationSessionId, setConversationSessionId] = useState("");
  const [projectSessions, setProjectSessions] = useState<SessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [utterance, setUtterance] = useState(
    "Help me understand what this project should do next.",
  );
  const [result, setResult] = useState<VoiceSecretaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        if (cancelled) return;
        setProjectSessions(response.sessions);
      })
      .catch((err) => {
        if (cancelled) return;
        setSessionsError(err instanceof Error ? err.message : String(err));
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectPath.trim() || !utterance.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await api.startVoiceSecretaryCall({
        projectPath: projectPath.trim(),
        conversationSessionId: conversationSessionId.trim() || undefined,
        conversationProvider: selectedConversation?.provider,
        utterance: utterance.trim(),
      });
      setResult(response.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

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
            <form className="voice-console" onSubmit={submit}>
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
                  {sessionsError && (
                    <small className="voice-field-error">
                      Failed to load conversations: {sessionsError}
                    </small>
                  )}
                </label>
              </div>

              <label className="voice-utterance">
                <span>Caller utterance</span>
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
                  {isSubmitting ? "Starting..." : "Start call handoff"}
                </button>
                <span>
                  Talker uses one short ephemeral turn, then Worker reuses the
                  selected conversation provider or falls back to the project.
                </span>
              </div>
            </form>

            {error && <div className="voice-error">{error}</div>}

            {result ? (
              <VoiceSecretaryResultView result={result} />
            ) : (
              <div className="voice-empty">
                <h2>Ready</h2>
                <p>
                  Start a call handoff to see Talker return one short reply and
                  Worker use the selected project or conversation context.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
