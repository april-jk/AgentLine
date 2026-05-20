import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ModelSwitchModal } from "../ModelSwitchModal";

const mocks = vi.hoisted(() => ({
  api: {
    getProcessModels: vi.fn(),
    setProcessModel: vi.fn(),
  },
}));

vi.mock("../../api/client", () => ({
  api: mocks.api,
}));

describe("ModelSwitchModal", () => {
  beforeEach(() => {
    mocks.api.getProcessModels.mockReset();
    mocks.api.setProcessModel.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a friendly unsupported message for 400 model-list errors", async () => {
    const error = Object.assign(new Error("API error: 400"), { status: 400 });
    mocks.api.getProcessModels.mockRejectedValueOnce(error);

    render(
      <I18nProvider>
        <ModelSwitchModal
          processId="process-1"
          currentModel="gpt-5"
          onModelChanged={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("This session doesn't support switching models."),
      ).toBeDefined();
    });
  });
});
