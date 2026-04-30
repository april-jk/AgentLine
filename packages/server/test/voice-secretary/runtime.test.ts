import { describe, expect, it } from "vitest";
import { VoiceSecretaryRuntimeManager } from "../../src/voice-secretary/runtime.js";

describe("VoiceSecretaryRuntimeManager", () => {
  it("keeps recent talker context across voice sessions in the same project", () => {
    const runtime = new VoiceSecretaryRuntimeManager();
    const first = runtime.getOrCreateSession({
      voiceSessionId: "voice-1",
      projectPath: "/tmp/project-a",
      assistantMemory: {
        version: 1,
        updatedAt: "2026-04-30T00:00:00.000Z",
        memoryFilePath: "/tmp/assistant-memory.json",
        userProfile: {
          language: "zh-CN",
          style: ["口语化"],
        },
        relationshipSummary: ["用户希望像秘书一样直接回答。"],
        recentConversationDigest: ["最近一直在修 Voice Secretary。"],
        spokenStyleHints: ["先说结论。"],
      },
    });

    runtime.addTranscriptTurn(first, {
      id: "turn-1",
      at: "2026-04-29T00:00:00.000Z",
      speaker: "user",
      text: "先给我说一下这个项目是干嘛的",
      source: "typed",
    });
    runtime.addTranscriptTurn(first, {
      id: "turn-2",
      at: "2026-04-29T00:00:01.000Z",
      speaker: "talker",
      text: "这个项目主要是一个移动端监督台。",
      source: "tts",
    });

    const second = runtime.getOrCreateSession({
      voiceSessionId: "voice-2",
      projectPath: "/tmp/project-a",
    });
    const context = runtime.buildTalkerContext(second);

    expect(context.assistantMemory?.spokenStyleHints).toEqual(["先说结论。"]);
    expect(context.recentTurns).toEqual([
      {
        speaker: "user",
        text: "先给我说一下这个项目是干嘛的",
        at: "2026-04-29T00:00:00.000Z",
      },
      {
        speaker: "talker",
        text: "这个项目主要是一个移动端监督台。",
        at: "2026-04-29T00:00:01.000Z",
      },
    ]);
  });
});
