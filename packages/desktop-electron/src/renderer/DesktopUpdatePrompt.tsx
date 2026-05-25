import type { ReleaseDownload, UpdateManifest } from "@agentline/shared";

interface DesktopUpdatePromptProps {
  currentVersion: string;
  update: UpdateManifest;
  download: ReleaseDownload | null;
  downloadUrl: string | null;
  onDismiss: () => void;
  onDownload: (url: string) => void;
}

export function DesktopUpdatePrompt({
  currentVersion,
  update,
  download,
  downloadUrl,
  onDismiss,
  onDownload,
}: DesktopUpdatePromptProps) {
  return (
    <div className="update-dialog-backdrop">
      <section
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-update-title"
      >
        <div className="update-dialog-header">
          <h2 id="desktop-update-title">Update Available</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss update prompt"
            onClick={onDismiss}
          >
            ×
          </button>
        </div>
        <p>
          AgentLine v{update.version} is available. Current version: v
          {currentVersion}.
        </p>
        {download ? (
          <p className="update-dialog-download">
            Recommended download: {download.name}
          </p>
        ) : (
          <p className="update-dialog-download">
            Open the official release page to choose a download.
          </p>
        )}
        <div className="actions inline-actions">
          <button type="button" className="secondary" onClick={onDismiss}>
            Later
          </button>
          {downloadUrl ? (
            <button
              type="button"
              onClick={() => {
                onDownload(downloadUrl);
              }}
            >
              Download Update
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
