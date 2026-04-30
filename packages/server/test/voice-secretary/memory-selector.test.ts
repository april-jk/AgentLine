import { describe, expect, it } from "vitest";
import { selectTalkerMemory } from "../../src/voice-secretary/memory-selector.js";
import type { TalkerContextFrame } from "../../src/voice-secretary/types.js";

function createContext(): TalkerContextFrame {
  return {
    assistantMemory: {
      version: 1,
      updatedAt: "2026-04-30T00:00:00.000Z",
      memoryFilePath: "/tmp/assistant-memory.json",
      userProfile: {
        language: "zh-CN",
        style: ["口语化", "简洁"],
      },
      relationshipSummary: ["用户希望像秘书一样直接回答。"],
      recentConversationDigest: [
        "最近一直在修 Voice Secretary 的语音链路。",
        "用户反复追问最近提交和语音实现。",
      ],
      spokenStyleHints: ["先说结论。", "不要念路径。"],
    },
    projectIndex: {
      indexVersion: 3,
      projectName: "AgentLine",
      projectPath: "/tmp/project",
      generatedAt: "2026-04-30T00:00:00.000Z",
      projectPositioning: "一个面向手机端的自托管 AI 代理监督台。",
      currentCapabilities: ["移动端监督", "多会话管理"],
      voiceSecretaryStatus: ["已接入火山 ASR/TTS"],
      coreModules: ["客户端", "服务端"],
      recentFocus: ["Voice Secretary", "Git Worktrees"],
      knownNextSteps: ["继续收口语音体验"],
      latestCommitSummary: "最近一次提交主要在修语音秘书的调试证据。",
      latestCommitFiles: ["packages/server/src/routes/voice-secretary.ts"],
      topLevelEntries: ["packages/", "docs/"],
      notableFiles: ["README.md"],
      summary: "项目摘要",
    },
    projectMemory: {
      projectPath: "/tmp/project",
      updatedAt: "2026-04-30T00:00:00.000Z",
      memoryFilePath: "/tmp/project-memory.json",
      recentTurns: [
        {
          speaker: "user",
          text: "先介绍一下项目背景",
          at: "2026-04-30T00:00:01.000Z",
        },
        {
          speaker: "talker",
          text: "这是一个移动端监督台。",
          at: "2026-04-30T00:00:02.000Z",
        },
      ],
      stableFacts: [
        "最近一次提交主要在修语音秘书的调试证据。",
        "现在语音识别和语音合成都走火山引擎。",
        "Talker 需要口语化输出。",
      ],
      workerFindings: [
        {
          at: "2026-04-30T00:00:03.000Z",
          topic: "最近提交",
          summary: "最近一次提交主要在修语音秘书的调试证据和专家回灌。",
          confidence: "high",
          source: "worker",
          promotable: true,
        },
        {
          at: "2026-04-30T00:00:04.000Z",
          topic: "语音链路",
          summary: "正式识别和合成都走火山引擎，前端只负责录音和展示。",
          confidence: "high",
          source: "worker",
          promotable: true,
        },
      ],
      recentChangesDigest: ["最近在修 Voice Secretary 的语音链路。"],
      openQuestions: ["先介绍一下项目背景"],
      spokenHints: ["避免长路径。", "像秘书一样对话。"],
      summaryNotes: ["Talker 记忆已初始化。"],
      latestWorkerMessage: "正式识别和合成都走火山引擎。",
    },
    recentTurns: [
      {
        speaker: "user",
        text: "先介绍一下项目背景",
        at: "2026-04-30T00:00:01.000Z",
      },
      {
        speaker: "talker",
        text: "这是一个移动端监督台。",
        at: "2026-04-30T00:00:02.000Z",
      },
    ],
    latestWorkerMessage: "正式识别和合成都走火山引擎。",
    workerStatus: "completed",
  };
}

describe("selectTalkerMemory", () => {
  it("prioritizes commit-related memory for latest-commit questions", () => {
    const packet = selectTalkerMemory("最近一次提交是什么？", createContext());

    expect(packet.relevantStableFacts[0]).toContain("最近一次提交");
    expect(packet.relevantWorkerFindings[0]?.topic).toBe("最近提交");
    expect(packet.relevantRecentChanges[0]).toContain("语音链路");
    expect(packet.assistantStyleHints).toContain("先说结论。");
  });

  it("prioritizes speech-stack memory for ASR/TTS questions", () => {
    const packet = selectTalkerMemory(
      "现在这个语音识别和合成是怎么实现的？",
      createContext(),
    );

    expect(packet.relevantStableFacts[0]).toContain("火山引擎");
    expect(packet.relevantWorkerFindings[0]?.topic).toBe("语音链路");
    expect(packet.relevantOpenQuestions[0]).toContain("先介绍一下项目背景");
    expect(packet.projectBrief).toContain("自托管 AI 代理监督台");
    expect(packet.recentTurns).toHaveLength(2);
  });
});
