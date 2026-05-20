export function isRemoteSecureConnectionPending(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message
    .toLowerCase()
    .includes("remote client requires secureconnection - not authenticated");
}

export function shouldClearStoredControlPlaneAccount(
  error: unknown,
): boolean {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;

  if (status === 401) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("account_auth_required") ||
    message.includes("unauthorized") ||
    message.includes("invalid_token") ||
    message.includes("token_expired")
  );
}
