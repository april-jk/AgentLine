import { describe, expect, it } from "vitest";
import {
  isRemoteSecureConnectionPending,
  shouldClearStoredControlPlaneAccount,
} from "../controlPlaneAccountState";

describe("controlPlaneAccountState", () => {
  it("detects remote secure-connection bootstrap errors", () => {
    expect(
      isRemoteSecureConnectionPending(
        new Error("Remote client requires SecureConnection - not authenticated"),
      ),
    ).toBe(true);
    expect(isRemoteSecureConnectionPending(new Error("unauthorized"))).toBe(
      false,
    );
  });

  it("clears stored account only for explicit auth failures", () => {
    const unauthorized = new Error("account_auth_required") as Error & {
      status?: number;
    };
    unauthorized.status = 401;

    expect(shouldClearStoredControlPlaneAccount(unauthorized)).toBe(true);
    expect(
      shouldClearStoredControlPlaneAccount(new Error("token_expired")),
    ).toBe(true);
    expect(
      shouldClearStoredControlPlaneAccount(
        new Error(
          "Remote client requires SecureConnection - not authenticated",
        ),
      ),
    ).toBe(false);
    expect(
      shouldClearStoredControlPlaneAccount(new Error("Failed to fetch")),
    ).toBe(false);
  });
});
