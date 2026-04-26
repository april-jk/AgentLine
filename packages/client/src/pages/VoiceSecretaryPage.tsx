import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type VoiceSecretaryResult, api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { useProjects } from "../hooks/useProjects";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useNavigationLayout } from "../layouts";

type ExecutorMode = "fake" | "agentline";

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

function VoiceSecretaryResultView({
  result,
}: { result: VoiceSecretaryResult }) {
  const basePath = useRemoteBasePath();
  const sessionLink = result.executorReport.links?.[0]?.href;

  return (
    <div className="voice-results">
      <div className="voice-result-summary">
        <div>
          <span className="voice-kicker">Call</span>
          <strong>{result.callSession.id}</strong>
        </div>
        <StatusBadge status={result.callSession.status} />
        <StatusBadge status={result.executorReport.status} />
      </div>

      <ResultSection title="Talker">
        <p className="voice-spoken">{result.finalBrief.spokenSummary}</p>
        <div className="voice-next-question">
          {result.finalBrief.suggestedNextUtterance}
        </div>
      </ResultSection>

      <ResultSection title="Planner">
        <p>{result.plannerResult.projectSummary}</p>
        <div className="voice-grid">
          <div>
            <span className="voice-kicker">Action</span>
            <strong>{result.plannerResult.recommendedAction}</strong>
          </div>
          <div>
            <span className="voice-kicker">Task mode</span>
            <strong>
              {result.plannerResult.executionTask?.mode ?? "none"}
            </strong>
          </div>
          <div>
            <span className="voice-kicker">Provider</span>
            <strong>
              {result.plannerResult.executionTask?.provider ?? "none"}
            </strong>
          </div>
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

      <ResultSection title="Executor">
        <p>{result.executorReport.summary}</p>
        <div className="voice-grid">
          <div>
            <span className="voice-kicker">Session</span>
            <strong>{result.executorReport.providerSessionId}</strong>
          </div>
          <div>
            <span className="voice-kicker">Changed files</span>
            <strong>{result.executorReport.changedFiles?.length ?? 0}</strong>
          </div>
        </div>
        {sessionLink && (
          <Link className="voice-session-link" to={`${basePath}${sessionLink}`}>
            Open executor session
          </Link>
        )}
        <TextList items={result.executorReport.verification} />
      </ResultSection>

      <ResultSection title="Transcript">
        <ol className="voice-transcript">
          {result.callSession.transcript.map((turn) => (
            <li key={turn.id}>
              <span>{turn.speaker}</span>
              <p>{turn.text}</p>
            </li>
          ))}
        </ol>
      </ResultSection>
    </div>
  );
}

export function VoiceSecretaryPage() {
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const { projects } = useProjects();
  const [projectPath, setProjectPath] = useState("");
  const [utterance, setUtterance] = useState(
    "Help me understand what this project should do next.",
  );
  const [executorMode, setExecutorMode] = useState<ExecutorMode>("fake");
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

  useEffect(() => {
    if (projectPath || sortedProjects.length === 0) return;
    const agentLineProject =
      sortedProjects.find((project) => project.name === "AgentLine") ??
      sortedProjects[0];
    if (agentLineProject) {
      setProjectPath(agentLineProject.path);
    }
  }, [projectPath, sortedProjects]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectPath.trim() || !utterance.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await api.simulateVoiceSecretary({
        projectPath: projectPath.trim(),
        utterance: utterance.trim(),
        executorMode,
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
              <div className="voice-form-row">
                <label>
                  <span>Project</span>
                  <select
                    value={projectPath}
                    onChange={(event) => setProjectPath(event.target.value)}
                  >
                    <option value="">Select a project</option>
                    {sortedProjects.map((project) => (
                      <option key={project.id} value={project.path}>
                        {project.name} - {project.path}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Executor</span>
                  <select
                    value={executorMode}
                    onChange={(event) =>
                      setExecutorMode(event.target.value as ExecutorMode)
                    }
                  >
                    <option value="fake">Fake executor</option>
                    <option value="agentline">AgentLine Codex session</option>
                  </select>
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
                  {isSubmitting ? "Running..." : "Run simulated call"}
                </button>
                {executorMode === "agentline" && (
                  <span>
                    Creates a real provider session in plan mode. The planner
                    still does not edit files.
                  </span>
                )}
              </div>
            </form>

            {error && <div className="voice-error">{error}</div>}

            {result ? (
              <VoiceSecretaryResultView result={result} />
            ) : (
              <div className="voice-empty">
                <h2>Ready</h2>
                <p>
                  Run the simulated call to see the Talker response, the
                  ProjectPlanner task packet, and the executor handoff result.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
