import { useDeveloperMode } from "../../hooks/useDeveloperMode";
import { useOnboarding } from "../../hooks/useOnboarding";
import { useI18n } from "../../i18n";
import { DevelopmentSettings } from "./DevelopmentSettings";

export function AboutSettings() {
  const { t } = useI18n();
  const { resetOnboarding } = useOnboarding();
  const { remoteLogCollectionEnabled, setRemoteLogCollectionEnabled } =
    useDeveloperMode();

  return (
    <section className="settings-section">
      <h2>{t("aboutTitle")}</h2>
      <div className="settings-group">
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("aboutReportBugTitle")}</strong>
            <p>{t("aboutReportBugDescription")}</p>
          </div>
          <a
            href="https://github.com/april-jk/AgentLine/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="settings-button"
          >
            {t("aboutReportBug")}
          </a>
        </div>
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("aboutSetupWizardTitle")}</strong>
            <p>{t("aboutSetupWizardDescription")}</p>
          </div>
          <button
            type="button"
            className="settings-button"
            onClick={resetOnboarding}
          >
            {t("aboutLaunchWizard")}
          </button>
        </div>
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("aboutDiagnosticsTitle")}</strong>
            <p>{t("aboutDiagnosticsDescription")}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={remoteLogCollectionEnabled}
              onChange={(e) => setRemoteLogCollectionEnabled(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      <DevelopmentSettings embedded />
    </section>
  );
}
