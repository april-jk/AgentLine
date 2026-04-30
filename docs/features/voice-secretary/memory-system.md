# Voice Secretary Memory System

This document defines a lightweight local memory system for Voice Secretary.

The goal is not to build a general agent knowledge platform. The goal is to
make Talker feel like a competent secretary:

- it should remember how the user likes to talk
- it should remember what has already been discussed
- it should become more familiar with a project over time
- it should stay fast enough for voice interaction

The design is intentionally small. It borrows the useful part of Hermes-style
persistent memory, but does not adopt the heavier search and long-history
retrieval model.

## Design Goals

1. Preserve the "voice assistant" feel.
   Talker must answer in a few seconds, so every memory layer must be cheap to
   read and cheap to summarize.

2. Separate user-level knowledge from project-level knowledge.
   The assistant should remember how this user likes to talk, while each
   project should keep its own facts and evolving understanding.

3. Prefer structured facts over raw transcript replay.
   Raw logs can be stored, but Talker should read a compact summary, not full
   historical conversations.

4. Support gradual enrichment by Worker.
   Talker starts from a small project dossier, then learns from each Worker run.

5. Keep all memory local.
   No cloud store, no external vector DB, no hidden remote dependency.

## Non-Goals

This v1 memory system does not try to provide:

- semantic vector retrieval
- cross-project global reasoning
- unlimited session search
- autonomous skill generation
- long-form transcript injection into every Talker turn

Those may be added later, but they are explicitly out of scope for the first
practical implementation.

## Memory Layers

The recommended structure is "2 + 1" layers:

1. Assistant memory
2. Project memory
3. Session scratch memory

Only the first two need durable local files. The third can stay mostly in
runtime state.

### Layer 1: Assistant Memory

Purpose:

- remember the user's communication preferences
- remember the long-lived "relationship context" between the user and Talker
- keep Talker consistent across projects

Location:

`~/.agentline/voice-secretary/assistant-memory.json`

Suggested schema:

```json
{
  "version": 1,
  "updatedAt": "2026-04-30T00:00:00.000Z",
  "userProfile": {
    "language": "zh-CN",
    "style": [
      "口语化",
      "简洁",
      "不要 markdown",
      "避免长路径",
      "像秘书对话"
    ]
  },
  "relationshipSummary": [
    "用户最近主要在完善 Voice Secretary 的真实语音链路",
    "用户希望 Talker 更像秘书，而不是日志阅读器"
  ],
  "recentConversationDigest": [
    "最近反复讨论火山 ASR/TTS、Talker 口语化、项目记忆"
  ],
  "avoidList": [
    "不要念文件路径",
    "不要念 markdown 结构",
    "不要把未确认信息说成已经完成"
  ]
}
```

### Layer 2: Project Memory

This is the main knowledge layer for Talker.

Each project gets its own memory directory.

Location:

`~/.agentline/voice-secretary/projects/<projectId>/`

Files:

- `project-index.json`
- `project-memory.json`
- `project-transcript.jsonl`

#### 2.1 `project-index.json`

Purpose:

- store stable project facts
- provide the first usable context when Talker sees a project for the first time
- avoid the "Talker knows nothing" problem

This file is created during project initialization.

Suggested schema:

```json
{
  "version": 1,
  "initializedAt": "2026-04-30T00:00:00.000Z",
  "lastRefreshedAt": "2026-04-30T00:00:00.000Z",
  "projectPath": "/Users/example/code/AgentLine",
  "projectName": "AgentLine",
  "positioning": "这是一个手机优先的 AI 代理监督台",
  "spokenProjectBrief": "这是一个可以在手机上监督和接管 AI 代理工作的项目。",
  "coreCapabilities": [
    "查看和续接多 provider 会话",
    "移动端监督",
    "语音秘书"
  ],
  "coreModules": [
    {
      "name": "client",
      "purpose": "前端界面"
    },
    {
      "name": "server",
      "purpose": "服务端与 provider 集成"
    },
    {
      "name": "relay",
      "purpose": "远程中继"
    }
  ],
  "importantTerms": {
    "ASR": "语音识别",
    "TTS": "语音合成",
    "Voice Secretary": "语音秘书"
  },
  "recentCommitDigest": "最近主要在修 Voice Secretary 的语音链路和 Talker 体验。"
}
```

#### 2.2 `project-memory.json`

Purpose:

- capture evolving project understanding
- store facts learned from Worker
- store short summaries that make later Talker turns better

Suggested schema:

```json
{
  "version": 1,
  "updatedAt": "2026-04-30T00:00:00.000Z",
  "stableFacts": [
    "正式语音识别链路走火山 ASR",
    "字节 TTS 已经改成分块合成"
  ],
  "workerFindings": [
    {
      "at": "2026-04-30T00:00:00.000Z",
      "topic": "最近一次提交",
      "summary": "最近一次提交主要在修语音秘书的调试证据和专家回灌",
      "confidence": "high",
      "source": "worker",
      "promotable": true
    }
  ],
  "recentChangesDigest": [
    "最近重点在 Talker 口语化、TTS 分块和项目记忆"
  ],
  "openQuestions": [
    "真实语音播放体验是否已经稳定"
  ],
  "spokenHints": [
    "回答时先说结论",
    "提到模块时说前端页面和服务端路由，不要说具体路径"
  ]
}
```

#### 2.3 `project-transcript.jsonl`

Purpose:

- store raw, append-only project memory events
- preserve the source material for later summarization
- avoid losing evidence from Worker findings and Talker dialogue

This file is not injected directly into Talker context.

Example events:

```json
{"type":"talker-turn","at":"...","speaker":"user","text":"项目现在怎么样？"}
{"type":"talker-turn","at":"...","speaker":"talker","text":"现在重点还在语音秘书这条线。"}
{"type":"worker-finding","at":"...","topic":"最近提交","summary":"最近一次提交主要在修语音秘书调试证据。"}
```

### Layer 3: Session Scratch Memory

Purpose:

- preserve the local context of the current call
- avoid losing immediate follow-up context
- support "what are we talking about right now?"

This layer should stay mostly in runtime state, not as a large durable file.

Recommended contents:

- current user question
- recent 2 to 4 turns
- whether Worker is running
- last pending Worker callback

This is already close to the current `voiceSession` runtime model and should be
extended rather than rebuilt from scratch.

## Initialization Flow

The first time Talker is used on a project, the system should initialize the
project memory with help from a real AgentLine Worker.

This is important because Talker has no native code-reading ability of its own.
Without initialization, it starts nearly blind.

### Trigger Conditions

Initialize when any of these is true:

- `project-index.json` does not exist
- `project-index.json` exists but is stale or invalid
- the user explicitly asks to rebuild project memory

Recommended stale condition:

- index older than 24 hours and repository has new commits

### Initialization Actor

Use the current user-selected AgentLine Worker.

Do not let Talker perform the initialization directly.

### Initialization Scope

Keep it deliberately small:

- read `README.md`
- read `AGENTS.md`
- read `CLAUDE.md`
- read `docs/roadmap`
- read Voice Secretary docs if relevant
- inspect top-level directory structure
- inspect the most recent 1 to 5 git commits
- inspect a few key entry files when needed

Do not:

- full-repo scan every file
- generate embeddings
- summarize the entire source tree

### Initialization Output

The initialization task must produce:

- `project-index.json`
- initial `project-memory.json`
- first `stableFacts`
- first `spokenProjectBrief`

## Worker Write-Back Flow

Worker is the main producer of project learning.

Each time Worker finishes a useful read-only or implementation-oriented pass:

1. Store the raw result into `project-transcript.jsonl`
2. Convert it into a short structured memory update
3. Merge that update into `project-memory.json`

### Write-Back Event Shape

Recommended normalized event:

```json
{
  "at": "2026-04-30T00:00:00.000Z",
  "topic": "语音识别实现",
  "summary": "前端实时字幕用浏览器 Web Speech API，正式转写走服务端火山 ASR",
  "confidence": "high",
  "source": "worker",
  "promotable": true
}
```

### Promotion Rule

Some Worker findings should become stable facts.

Promotion conditions:

- repeated across multiple runs
- high confidence
- clearly phrased as a durable fact

Examples:

- "正式 ASR 走火山引擎"
- "当前语音输出只允许字节 TTS，不再回退到浏览器合成"

Do not promote temporary or uncertain statements.

## Talker Read Path

The performance rule is simple:

Talker must never read the entire memory corpus for a single answer.

Instead, build a compact per-turn context packet.

### Recommended Per-Turn Context Packet

1. Assistant memory
   - 3 to 6 relevant user/style lines

2. Project index
   - `spokenProjectBrief`
   - 2 to 4 core capabilities

3. Project memory
   - 3 to 5 `stableFacts`
   - 1 to 2 latest `workerFindings`
   - 2 to 3 `spokenHints`

4. Session scratch
   - recent 2 to 4 turns
   - current user intent
   - current Worker status

This packet should be assembled before every Talker answer.

### Selection Strategy

For each user turn:

1. classify the question
2. load only the most relevant memory slices
3. generate a short spoken response

Common question classes:

- project overview
- current progress
- latest commit
- module explanation
- speech stack explanation
- next step recommendation
- deep question requiring Worker follow-up

## Spoken Glossary

To keep Talker natural, add a small project-level spoken glossary.

This should convert code-like terms into spoken Chinese.

Examples:

- `packages/server/src/routes/...` -> `服务端路由`
- `packages/client/...` -> `前端页面`
- `ASR` -> `语音识别`
- `TTS` -> `语音合成`
- `Git Worktrees` -> `多工作区分支能力`
- `Diff Viewer` -> `变更查看能力`

This glossary should be stored in `project-index.json` or
`project-memory.json`, not hardcoded into the LLM prompt only.

## Avoid List

The memory system should explicitly support things Talker must avoid saying.

Recommended examples:

- do not read long file paths
- do not expose markdown formatting
- do not list too many modules in one answer
- do not claim unfinished work is already complete

This can live in `assistant-memory.json` and be refined over time.

## Retrieval and Performance Rules

This section is critical.

### Hard Limits

- never inject full transcript files into Talker
- never inject all Worker history into a single answer
- never block a live Talker answer on a heavy memory rebuild
- never run project initialization synchronously in the first user-facing reply

### Latency Strategy

Use this pattern:

1. Talker answers immediately from current compact memory
2. If needed, Worker continues in the background
3. Worker writes back findings
4. Talker uses the new findings in later turns

This keeps the call responsive.

### Summary Compression

When `project-memory.json` grows:

- merge repetitive findings
- drop low-value duplicates
- retain only recent or durable facts

Recommended limits:

- `stableFacts`: max 16
- `workerFindings`: max 24
- `spokenHints`: max 12
- `recentChangesDigest`: max 10

## Recommended Implementation Shape

The current codebase already has a partial foundation:

- `knowledge-store.ts`
- `project index`
- `talker memory`
- `worker hook write-back`
- `voiceSession` runtime context

So the implementation should be a refactor and extension, not a greenfield
system.

### Recommended Work Order

1. Split the current memory layer into:
   - assistant memory
   - project index
   - project memory

2. Add project initialization task

3. Normalize Worker write-back into structured memory updates

4. Add compact context assembly for Talker

5. Add spoken glossary and avoid list support

## Suggested Interfaces

### `AssistantMemoryStore`

Responsibilities:

- load and persist assistant memory
- merge style and user-preference updates
- expose compact talker-facing summary

### `ProjectMemoryStore`

Responsibilities:

- manage per-project directory
- create and refresh `project-index.json`
- append transcript events
- merge structured Worker findings
- build compact talker-facing memory packet

### `ProjectMemoryInitializer`

Responsibilities:

- create the first project dossier through Worker
- guard against repeated expensive initialization
- refresh stale indexes when needed

### `MemorySelector`

Responsibilities:

- choose which slices to inject for the current question
- enforce token/size budget
- avoid dumping irrelevant memory into Talker

## Feasibility Assessment

This design is high-feasibility for the current AgentLine codebase.

Reasons:

- the repository already has a project index and talker memory foundation
- the runtime already tracks recent turns and Worker callbacks
- the main missing piece is clearer layering and a better initialization path

Main technical risks:

1. over-collecting memory and making Talker slower
2. writing back Worker findings in a code-heavy style
3. letting old summaries become stale

Mitigations:

- keep strict memory-size limits
- store structured facts, not long prose
- periodically refresh project index on clear triggers only

## Recommended v1 Scope

Ship these first:

- assistant memory
- project index
- project memory
- transcript event archive
- first-use initialization
- Worker write-back normalization
- compact context selection
- spoken glossary

Delay these:

- vector DB
- semantic search
- cross-project reasoning
- autonomous skill memory
- heavy session search

## Acceptance Criteria

The memory system is good enough for v1 when all of these are true:

1. On the first project use, Talker is not blank and can give a useful project
   introduction.
2. After a few Worker-assisted turns, Talker becomes noticeably better at
   answering project-specific questions.
3. Talker answers stay short and spoken, instead of drifting into file-path or
   markdown-heavy output.
4. Memory growth does not noticeably slow down the voice interaction loop.
5. All memory remains local and inspectable on disk.
