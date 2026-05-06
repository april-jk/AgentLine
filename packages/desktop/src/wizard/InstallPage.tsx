import { useMemo } from "react";

interface Props {
  agents: string[];
  onNext: () => void;
}

interface TaskStatus {
  id: string;
  label: string;
  status: "done";
  message: string;
}

export function InstallPage({ agents, onNext }: Props) {
  const tasks = useMemo(() => {
    const t: TaskStatus[] = [
      {
        id: "yep",
        label: "AgentLine Server",
        status: "done",
        message: "Skip install (using your existing local environment).",
      },
    ];
    if (agents.includes("claude")) {
      t.push({
        id: "claude",
        label: "Claude Code",
        status: "done",
        message: "Skip install (expected to be preinstalled).",
      });
    }
    if (agents.includes("codex")) {
      t.push({
        id: "codex",
        label: "Codex CLI",
        status: "done",
        message: "Skip install (expected to be preinstalled).",
      });
    }
    return t;
  }, [agents]);

  const statusIcon = () => "●";
  const statusColor = () => "var(--success)";

  return (
    <div style={{ width: "100%", maxWidth: 400 }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Environment check
      </h2>
      <p
        style={{
          color: "var(--text-secondary)",
          fontSize: 14,
          marginBottom: 24,
        }}
      >
        Installation is disabled. AgentLine will use tools already installed on
        your machine.
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          marginBottom: 32,
        }}
      >
        {tasks.map((task) => (
          <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                color: statusColor(),
                fontSize: 18,
                width: 24,
                textAlign: "center",
              }}
            >
              {statusIcon()}
            </span>
            <div>
              <div style={{ fontWeight: 500 }}>{task.label}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {task.message}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn-primary"
        onClick={onNext}
        style={{ width: "100%" }}
      >
        Continue
      </button>
    </div>
  );
}
