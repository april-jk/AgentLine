# Voice Secretary Memory Implementation Plan

This document turns the memory-system design into an implementation plan for the
current AgentLine codebase.

It is intentionally practical:

- which files should change
- which modules should be added
- what each stage is responsible for
- how to verify each stage

The target is a local, lightweight memory system that improves Talker quality
without making voice interaction slow.

## Current Baseline

The current Voice Secretary implementation already has a partial foundation:

- `packages/server/src/voice-secretary/knowledge-store.ts`
  - project index generation
  - project talker memory persistence
- `packages/server/src/voice-secretary/runtime.ts`
  - per-voice-session runtime state
  - recent turns
  - worker hook storage
- `packages/server/src/voice-secretary/simulated.ts`
  - Talker / Planner / Worker orchestration
- `packages/server/src/voice-secretary/deterministic-brief.ts`
  - deterministic direct-answer generation
- `packages/server/src/voice-secretary/talker-llm.ts`
  - custom-API Talker generation

This means the work is not greenfield. The right approach is refactor plus
extension.

## Guiding Rules

1. Keep Talker latency low.
   Every new memory feature must be cheap to read.

2. Prefer structured summaries over raw logs.
   Raw logs can be stored for evidence, but should not be injected into Talker.

3. Do not block the first spoken response on heavy memory work.
   Initialization and memory rebuilding should happen in the background or on a
   dedicated Worker task.

4. Keep the memory local and inspectable.
   Users should be able to understand what is stored and where.

## Target File Layout

The target data layout should become:

```text
~/.agentline/voice-secretary/
  assistant-memory.json
  projects/
    <projectId>/
      project-index.json
      project-memory.json
      project-transcript.jsonl
```

Notes:

- `assistant-memory.json` is global to the user and Talker relationship.
- `project-index.json` stores stable initial project facts.
- `project-memory.json` stores structured evolving knowledge.
- `project-transcript.jsonl` stores append-only raw events.

## Phase Breakdown

## Phase 1: Restructure the Store Layer

### Goal

Split the current mixed memory implementation into explicit assistant-level and
project-level layers.

### Existing Files To Change

- `packages/server/src/voice-secretary/knowledge-store.ts`
- `packages/server/src/voice-secretary/types.ts`

### Suggested New Modules

- `packages/server/src/voice-secretary/assistant-memory-store.ts`
- `packages/server/src/voice-secretary/project-memory-store.ts`

### Responsibilities

#### `assistant-memory-store.ts`

Should own:

- load assistant memory
- initialize missing assistant memory
- merge user preference updates
- expose a compact summary for Talker

#### `project-memory-store.ts`

Should own:

- create and manage the per-project memory directory
- read and write `project-index.json`
- read and write `project-memory.json`
- append raw events to `project-transcript.jsonl`

### Type Changes

Expand `types.ts` to include explicit shapes for:

- `AssistantMemory`
- `ProjectIndex`
- `ProjectMemory`
- `ProjectTranscriptEvent`
- `TalkerMemoryPacket`

### Acceptance

- code no longer treats project memory as one generic blob
- assistant memory and project memory are separate concepts in code
- missing files are auto-created locally

## Phase 2: Project Initialization

### Goal

Ensure that the first time Voice Secretary is used on a project, Talker gets a
real starter dossier instead of beginning blind.

### Existing Files To Change

- `packages/server/src/voice-secretary/simulated.ts`
- `packages/server/src/voice-secretary/runtime.ts`
- `packages/server/src/routes/voice-secretary.ts`

### Suggested New Modules

- `packages/server/src/voice-secretary/project-memory-initializer.ts`

### Responsibilities

The initializer should:

- detect whether `project-index.json` exists
- detect whether it is stale or invalid
- create an initialization task when needed

### Initialization Trigger Rules

Run initialization when:

- index missing
- index version mismatch
- index older than the configured freshness window and repo changed

### Initialization Task Shape

The initializer should ask a real Worker to:

- read `README.md`
- read `AGENTS.md`
- read `CLAUDE.md`
- read Voice Secretary docs and roadmap
- inspect top-level entries
- inspect recent commits
- produce structured project facts

### Output

The initializer should write:

- `project-index.json`
- starter `project-memory.json`

### Acceptance

- first-time use of a project yields a useful spoken intro
- Talker no longer defaults to generic filler when project memory is empty

## Phase 3: Worker Write-Back Normalization

### Goal

Convert Worker output into durable, structured project knowledge.

### Existing Files To Change

- `packages/server/src/voice-secretary/runtime.ts`
- `packages/server/src/voice-secretary/simulated.ts`
- `packages/server/src/routes/voice-secretary.ts`

### Suggested New Modules

- `packages/server/src/voice-secretary/project-memory-writer.ts`

### Responsibilities

When Worker finishes:

1. append a raw event to `project-transcript.jsonl`
2. extract a short structured finding
3. merge the finding into `project-memory.json`

### Suggested Write-Back Categories

- latest commit
- current progress
- module explanation
- speech stack
- bug/fix status
- next steps

### Promotion Rules

Some findings should remain transient; some should become stable facts.

Promote to `stableFacts` only if:

- high confidence
- likely durable across future sessions
- not phrased as a temporary hypothesis

### Acceptance

- a Worker answer from one session helps Talker in later sessions
- Talker does not need to ask the same project question repeatedly

## Phase 4: Compact Memory Selection

### Goal

Build a small Talker-facing context packet per turn instead of injecting every
memory source directly.

### Existing Files To Change

- `packages/server/src/voice-secretary/simulated.ts`
- `packages/server/src/voice-secretary/talker-llm.ts`
- `packages/server/src/voice-secretary/codex-ephemeral.ts`

### Suggested New Modules

- `packages/server/src/voice-secretary/memory-selector.ts`

### Responsibilities

For each user turn, select:

- assistant style summary
- compact project brief
- relevant stable facts
- latest worker finding
- recent 2 to 4 turns
- current worker status

### Hard Limits

The selector should enforce size limits such as:

- assistant summary: max 6 entries
- stable facts: max 5
- worker findings: max 2
- recent turns: max 4
- spoken hints: max 3

### Acceptance

- Talker responses improve with memory
- latency remains stable
- prompts stay readable and bounded

## Phase 5: Spoken Glossary and Avoid Rules

### Goal

Make memory useful for speech, not just for technical correctness.

### Existing Files To Change

- `packages/server/src/voice-secretary/deterministic-brief.ts`
- `packages/server/src/voice-secretary/talker-llm.ts`
- `packages/server/src/voice-secretary/knowledge-store.ts` or its replacement

### Responsibilities

Add support for:

- project spoken glossary
- project spoken hints
- assistant avoid list

### Examples

- `packages/server/src/routes/...` -> `服务端路由`
- `packages/client/...` -> `前端页面`
- `ASR` -> `语音识别`
- `TTS` -> `语音合成`
- `Git Worktrees` -> `多工作区分支能力`

### Acceptance

- Talker stops leaking long paths
- Talker stops sounding like it is reading logs
- technical answers are still accurate but more spoken

## Phase 6: Refresh and Maintenance Rules

### Goal

Keep memory from drifting or bloating.

### Suggested New Modules

- `packages/server/src/voice-secretary/memory-maintenance.ts`

### Responsibilities

- compact repetitive findings
- trim old low-value notes
- refresh stale indexes
- preserve durable facts

### Suggested Policies

- `stableFacts`: max 16
- `workerFindings`: max 24
- `recentChangesDigest`: max 10
- `spokenHints`: max 12

### Acceptance

- memory files remain understandable
- growth is bounded
- no visible slowdown from long-term use

## Module-by-Module Mapping

## Existing Modules To Refactor

### `knowledge-store.ts`

Current role:

- mixed project index and project talker memory owner

Target role:

- either split into dedicated stores
- or become a facade over the dedicated stores

### `runtime.ts`

Current role:

- in-memory voice session state
- worker hook and latest worker data

Target role:

- keep runtime-only scratch state
- reference durable memory rather than duplicating long-term facts

### `simulated.ts`

Current role:

- main orchestration layer
- builds Talker context

Target role:

- call `MemorySelector`
- trigger project initialization
- write back normalized Worker findings

### `talker-llm.ts`

Current role:

- call custom LLM
- do response sanitization

Target role:

- consume a compact, structured `TalkerMemoryPacket`
- avoid reading raw file paths or raw long summaries directly

## New Suggested Interfaces

### `AssistantMemoryStore`

```ts
interface AssistantMemoryStore {
  load(): Promise<AssistantMemory>;
  update(patch: Partial<AssistantMemory>): Promise<AssistantMemory>;
  summarizeForTalker(): Promise<string[]>;
}
```

### `ProjectMemoryStore`

```ts
interface ProjectMemoryStore {
  ensureProject(projectPath: string): Promise<ProjectMemoryArtifacts>;
  readIndex(projectPath: string): Promise<ProjectIndex>;
  readMemory(projectPath: string): Promise<ProjectMemory>;
  appendTranscriptEvent(
    projectPath: string,
    event: ProjectTranscriptEvent,
  ): Promise<void>;
  mergeWorkerFinding(
    projectPath: string,
    finding: WorkerFinding,
  ): Promise<ProjectMemory>;
}
```

### `ProjectMemoryInitializer`

```ts
interface ProjectMemoryInitializer {
  ensureInitialized(projectPath: string): Promise<InitializationStatus>;
}
```

### `MemorySelector`

```ts
interface MemorySelector {
  buildTalkerPacket(args: {
    projectPath: string;
    userIntent: string;
    recentTurns: TalkerContextTurn[];
    workerStatus?: VoiceWorkerStatus;
  }): Promise<TalkerMemoryPacket>;
}
```

## Validation Plan

## Unit Tests

Add or extend tests for:

- assistant memory initialization
- project index creation
- project memory write-back
- transcript append behavior
- selector size limits
- glossary replacement

Suggested files:

- `packages/server/test/voice-secretary/assistant-memory-store.test.ts`
- `packages/server/test/voice-secretary/project-memory-store.test.ts`
- `packages/server/test/voice-secretary/memory-selector.test.ts`

## Integration Tests

Extend existing Voice Secretary tests to verify:

- first-use initialization path
- Worker finding persistence
- later Talker answer improvement from prior memory

Suggested files:

- `packages/server/test/voice-secretary/simulated.test.ts`
- `packages/server/test/routes/voice-secretary.test.ts`

## Manual Verification

Use the typed path first:

1. ask a project overview question on a fresh project
2. verify first-use initialization creates the project files
3. ask a deeper project question
4. let Worker answer
5. ask the same topic again in a later turn
6. verify Talker is now better without waiting as long

Then verify the voice path:

1. same project
2. short voice questions
3. ensure latency remains acceptable
4. ensure spoken output stays short and oral

## Migration Strategy

Because partial memory already exists, migration should be incremental.

### Strategy

1. continue reading old project memory if present
2. write new-format files alongside current data
3. add a version field to all new memory files
4. rebuild invalid or stale memory lazily

### Important Rule

Do not try to migrate every historical file eagerly at startup.

Lazy migration is safer:

- lower startup risk
- lower latency spike
- fewer failure modes

## Recommended Delivery Order

If implementation starts after this document, the recommended order is:

1. refactor store layer
2. add assistant memory
3. add project initialization
4. add Worker write-back normalization
5. add compact memory selector
6. add glossary and avoid rules
7. add maintenance/refresh rules

## Definition of Done

This memory implementation is complete enough for the first real rollout when:

1. Talker can give a useful first project intro without sounding blank
2. Worker findings survive across sessions
3. Talker gets better at the same project over time
4. responses stay short and spoken
5. latency does not noticeably regress
6. all memory stays local and auditable
