import { describe, expect, it } from "vitest";
import {
  oralizeTalkerText,
  shapeSpokenSummary,
  shapeSuggestedNextUtterance,
  shapeTalkerBrief,
} from "../../src/voice-secretary/response-shaper.js";

describe("response-shaper", () => {
  it("oralizes markdown and code-like paths into speech-friendly text", () => {
    expect(
      oralizeTalkerText(
        "# 标题\n- 已接入 `/api/voice-secretary`，相关实现主要在 packages/server/src/routes/voice-secretary.ts。",
      ),
    ).toBe("标题 已接入 语音秘书接口，相关实现主要在 服务端相关模块。");
  });

  it("keeps spoken summaries short and sentence-shaped", () => {
    const shaped = shapeSpokenSummary(
      "这是第一句，主要讲项目现状。第二句继续补模块细节。第三句开始继续展开文件路径和更多实现说明。",
    );

    expect(shaped).toContain("这是第一句");
    expect(shaped).toContain("第二句");
    expect(shaped).not.toContain("第三句");
    expect(shaped.endsWith("。")).toBe(true);
  });

  it("turns next-step prompts into short spoken questions", () => {
    expect(
      shapeSuggestedNextUtterance(
        "下一步你想让我继续展开 packages/server/src/routes/voice-secretary.ts，还是先看最近一次提交？",
      ),
    ).toBe("你想让我继续展开 服务端相关模块，还是先看最近一次提交？");
  });

  it("shapes whole talker briefs into secretary-style replies", () => {
    const brief = shapeTalkerBrief({
      spokenSummary:
        "项目现在主要在修 Voice Secretary 的语音链路，服务端已经接上了 ASR 和 TTS。接下来更优先的是把输出变得更像秘书对话，同时避免继续念路径和 markdown。",
      suggestedNextUtterance:
        "下一步你想让我继续展开 packages/server/src/voice-secretary 这一层，还是先追最近一次提交？",
      factsToAvoidOverstating: [],
      questionsToAsk: [],
    });

    expect(brief.spokenSummary).toContain("语音链路");
    expect(brief.spokenSummary.length).toBeLessThanOrEqual(145);
    expect(brief.spokenSummary).not.toContain("packages/");
    expect(brief.suggestedNextUtterance.endsWith("？")).toBe(true);
    expect(brief.questionsToAsk[0]).toBe(brief.suggestedNextUtterance);
  });
});
