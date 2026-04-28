import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";

describe("client api", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        settings: {
          serviceWorkerEnabled: true,
          persistRemoteSessionsToDisk: false,
        },
      }),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes undefined setting values as null so clears reach the server", async () => {
    await api.updateServerSettings({
      globalInstructions: undefined,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request?.body).toBe(JSON.stringify({ globalInstructions: null }));
  });

  it("adds the required AgentLine header to voice secretary audio calls", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        transcript: "hi",
        talkerText: "hello",
        audioBase64: "SUQz",
        audioContentType: "audio/mpeg",
        result: {},
      }),
    } as Response);

    await api.startVoiceSecretaryAudioCall({
      projectPath: "/tmp/project",
      audio: new Blob(["wav"], { type: "audio/wav" }),
    });

    const lastCall = fetchMock.mock.calls.at(-1);
    const [url, request] = lastCall ?? [];
    expect(url).toBe("/api/voice-secretary/calls/audio");
    expect(request?.headers).toMatchObject({
      "X-AgentLine-Request": "true",
    });
  });
});
