import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { useProviders } from "../../hooks/useProviders";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";
import { getAllProviders } from "../../providers/registry";

const DEFAULT_OLLAMA_SYSTEM_PROMPT =
  "You are a helpful coding assistant. You help users with software engineering tasks. You have access to tools for reading files, editing files, running shell commands, and searching code. Use tools when needed to answer questions or make changes. Be concise and direct.";

function OllamaUrlInput() {
  const { t } = useI18n();
  const { settings, updateSetting } = useServerSettings();
  const [url, setUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const serverValue = settings?.ollamaUrl ?? "";

  useEffect(() => {
    if (settings) {
      setUrl(settings.ollamaUrl ?? "");
    }
  }, [settings]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await updateSetting("ollamaUrl", url.trim() || undefined);
      setHasChanges(false);
    } catch {
      // Error handled by useServerSettings
    } finally {
      setIsSaving(false);
    }
  }, [url, updateSetting]);

  return (
    <div style={{ marginTop: "var(--space-2)", width: "100%" }}>
      <div
        style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}
      >
        <input
          type="text"
          className="settings-input"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setHasChanges(e.target.value !== serverValue);
          }}
          placeholder="http://localhost:11434"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="settings-button"
          disabled={!hasChanges || isSaving}
          onClick={handleSave}
        >
          {isSaving ? t("providersSaving") : t("providersSave")}
        </button>
      </div>
      <span className="settings-hint">{t("providersOllamaUrlHint")}</span>
    </div>
  );
}

function OllamaUseFullSystemPrompt() {
  const { t } = useI18n();
  const { settings, updateSetting } = useServerSettings();
  const enabled = settings?.ollamaUseFullSystemPrompt ?? false;

  return (
    <label
      style={{
        display: "flex",
        gap: "var(--space-2)",
        alignItems: "center",
        marginTop: "var(--space-2)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) =>
          updateSetting("ollamaUseFullSystemPrompt", e.target.checked)
        }
      />
      <span>{t("providersUseFullPrompt")}</span>
      <span className="settings-hint" style={{ marginLeft: "auto" }}>
        {t("providersUseFullPromptHint")}
      </span>
    </label>
  );
}

function OllamaSystemPromptInput() {
  const { t } = useI18n();
  const { settings, updateSetting } = useServerSettings();
  const [prompt, setPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const serverValue = settings?.ollamaSystemPrompt ?? "";

  useEffect(() => {
    if (settings) {
      setPrompt(settings.ollamaSystemPrompt ?? "");
    }
  }, [settings]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await updateSetting("ollamaSystemPrompt", prompt.trim() || undefined);
      setHasChanges(false);
    } catch {
      // Error handled by useServerSettings
    } finally {
      setIsSaving(false);
    }
  }, [prompt, updateSetting]);

  return (
    <div style={{ marginTop: "var(--space-2)", width: "100%" }}>
      <textarea
        className="settings-textarea"
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          setHasChanges(e.target.value !== serverValue);
        }}
        placeholder={DEFAULT_OLLAMA_SYSTEM_PROMPT}
        rows={4}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "var(--space-2)",
        }}
      >
        <span className="settings-hint">{t("providersOllamaPromptHint")}</span>
        <button
          type="button"
          className="settings-button"
          disabled={!hasChanges || isSaving}
          onClick={handleSave}
        >
          {isSaving ? t("providersSaving") : t("providersSave")}
        </button>
      </div>
    </div>
  );
}

function OllamaSettings() {
  const { settings } = useServerSettings();
  const useFullPrompt = settings?.ollamaUseFullSystemPrompt ?? false;

  return (
    <>
      <OllamaUrlInput />
      <OllamaUseFullSystemPrompt />
      {!useFullPrompt && <OllamaSystemPromptInput />}
    </>
  );
}

type ProviderTone = "claude" | "codex" | "gemini" | "opencode";

function getProviderTone(providerId: string): ProviderTone {
  if (providerId === "claude" || providerId === "claude-ollama") {
    return "claude";
  }
  if (
    providerId === "gemini" ||
    providerId === "gemini-acp" ||
    providerId === "aion"
  ) {
    return "gemini";
  }
  if (providerId === "codex" || providerId === "codex-oss") {
    return "codex";
  }
  return "opencode";
}

const PROVIDER_LOGO_MAP: Record<string, string> = {
  claude: "/provider-logos/claude.svg",
  "claude-ollama": "/provider-logos/ollama.svg",
  gemini: "/provider-logos/gemini.svg",
  "gemini-acp": "/provider-logos/gemini.svg",
  codex: "/provider-logos/codex-mark.svg",
  "codex-oss": "/provider-logos/codex-mark.svg",
  opencode: "/provider-logos/opencode.png",
};

function ProviderLogo({
  providerId,
  displayName,
}: {
  providerId: string;
  displayName: string;
}) {
  const logoSrc = PROVIDER_LOGO_MAP[providerId] ?? "/icon-192.png";

  return (
    <img
      src={logoSrc}
      alt={`${displayName} logo`}
      className="provider-card-logo-image"
      loading="lazy"
      decoding="async"
    />
  );
}

export function ProvidersSettings() {
  const { t } = useI18n();
  const { providers: serverProviders, loading: providersLoading } =
    useProviders();
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);

  const providerDisplayList = useMemo(() => {
    // Merge server detection status with client-side metadata
    const mergedProviders = getAllProviders().map((clientProvider, index) => {
      const serverInfo = serverProviders.find(
        (provider) => provider.name === clientProvider.id,
      );
      return {
        ...clientProvider,
        installed: serverInfo?.installed ?? false,
        authenticated: serverInfo?.authenticated ?? false,
        originalIndex: index,
      };
    });

    // Configured providers first, then unconfigured.
    // Priority: authenticated > installed > not configured.
    mergedProviders.sort((left, right) => {
      const leftRank = left.authenticated ? 2 : left.installed ? 1 : 0;
      const rightRank = right.authenticated ? 2 : right.installed ? 1 : 0;
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return left.originalIndex - right.originalIndex;
    });

    return mergedProviders.map(
      ({ originalIndex: _drop, ...provider }) => provider,
    );
  }, [serverProviders]);

  const activeProvider = useMemo(
    () =>
      activeProviderId
        ? providerDisplayList.find(
            (provider) => provider.id === activeProviderId,
          )
        : undefined,
    [activeProviderId, providerDisplayList],
  );

  const closeProviderModal = useCallback(() => {
    setActiveProviderId(null);
  }, []);

  return (
    <section className="settings-section">
      <h2>{t("providersSectionTitle")}</h2>
      <p className="settings-section-description">
        {t("providersSectionDescription")}
      </p>
      <div className="providers-card-grid">
        {providerDisplayList.map((provider) => (
          <article key={provider.id} className="providers-card">
            <div
              className={`providers-card-logo providers-card-logo-${getProviderTone(provider.id)}`}
            >
              <ProviderLogo
                providerId={provider.id}
                displayName={provider.displayName}
              />
            </div>
            <div className="providers-card-main">
              <h3 className="providers-card-title">{provider.displayName}</h3>
              {providersLoading ? (
                <span className="settings-status-badge settings-status-not-detected">
                  {t("agentContextLoading")}
                </span>
              ) : provider.installed ? (
                <span className="settings-status-badge settings-status-detected">
                  {t("providersDetected")}
                </span>
              ) : (
                <span className="settings-status-badge settings-status-not-detected">
                  {t("providersNotDetected")}
                </span>
              )}
            </div>
            <button
              type="button"
              className="settings-button providers-card-settings-button"
              onClick={() => setActiveProviderId(provider.id)}
            >
              {t("pageTitleSettings")}
            </button>
          </article>
        ))}
      </div>
      {activeProvider ? (
        <Modal
          title={`${activeProvider.displayName} · ${t("pageTitleSettings")}`}
          onClose={closeProviderModal}
        >
          <div className="providers-modal-content">
            <div className="providers-modal-summary">
              <div
                className={`providers-card-logo providers-card-logo-${getProviderTone(activeProvider.id)} providers-card-logo-large`}
              >
                <ProviderLogo
                  providerId={activeProvider.id}
                  displayName={activeProvider.displayName}
                />
              </div>
              <div className="providers-modal-summary-text">
                <strong>{activeProvider.displayName}</strong>
                {providersLoading ? (
                  <span className="settings-status-badge settings-status-not-detected">
                    {t("agentContextLoading")}
                  </span>
                ) : activeProvider.installed ? (
                  <span className="settings-status-badge settings-status-detected">
                    {t("providersDetected")}
                  </span>
                ) : (
                  <span className="settings-status-badge settings-status-not-detected">
                    {t("providersNotDetected")}
                  </span>
                )}
              </div>
            </div>

            <p className="settings-section-description providers-modal-description">
              {activeProvider.metadata.description}
            </p>

            {activeProvider.metadata.limitations.length > 0 && (
              <ul className="settings-limitations providers-modal-limitations">
                {activeProvider.metadata.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            )}

            {activeProvider.id === "claude-ollama" && (
              <div className="providers-modal-setting-group">
                <OllamaSettings />
              </div>
            )}

            {activeProvider.metadata.website && (
              <a
                href={activeProvider.metadata.website}
                target="_blank"
                rel="noopener noreferrer"
                className="settings-link providers-modal-link"
              >
                {t("providersWebsite")}
              </a>
            )}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
