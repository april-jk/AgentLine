# Voice Secretary Architecture

## Goal

Add a voice-native secretary layer without weakening AgentLine's existing audit
and execution model. Voice should become a new control surface, not a hidden
write-capable agent.

## Runtime Flow

```text
ChannelAdapter
  receives audio or text from web voice, phone, Telegram, Feishu, etc.

ASRAdapter
  converts speech to text through Volcengine streaming ASR

TalkerOrchestrator
  manages a low-latency ephemeral secretary model session
  speaks quickly, asks clarifying questions, and emits planner requests

ProjectPlanner
  reads project context only
  creates structured ExecutionTask packets for formal agent sessions

ExecutorAgentAdapter
  creates or resumes a real AgentLine provider session
  delegates actual code changes to Codex, Claude, OpenCode, etc.

ProjectPlanner
  compresses execution reports into caller-facing summaries

TTSAdapter
  speaks the Talker response through Volcengine TTS

CallbackScheduler
  creates a callback when human input is needed later
```

## Component Boundaries

### Speech Adapters

The first speech provider is Volcengine.

`VolcengineASRAdapter` owns streaming recognition over the official ASR
WebSocket API. `VolcengineTTSAdapter` owns speech synthesis over the official
TTS WebSocket API. Both adapters run server-side so browser and phone clients
never receive provider credentials.

The rest of the Voice Secretary feature should only consume normalized
`ASRAdapter` and `TTSAdapter` contracts. Provider request signing, binary packet
formatting, endpoint selection, and token handling stay inside these adapters.

See [volcengine-speech.md](./volcengine-speech.md) for endpoints, environment
variables, and usage rules.

### ChannelAdapter

Channel adapters normalize communication platforms. A call, a Telegram voice
message, and a Feishu voice note should become the same internal event shape.

Initial adapters:
- `web-voice`: browser microphone and speakers
- `simulated-call`: text fixture for tests

Later adapters:
- `phone`: Twilio, SIP, LiveKit, or another telephony gateway
- `telegram`
- `feishu`

### TalkerOrchestrator

The Talker should use a lightweight, low-latency model path. Its session should
be ephemeral and should not appear as a normal AgentLine project session.

Allowed operations:
- maintain short-term call context
- ask the user clarifying questions
- decide whether to pause and delegate
- transform user speech into `PlannerRequest`
- read completed planner summaries
- produce TTS-ready responses

Forbidden operations:
- repository writes
- direct shell execution
- direct git operations
- long-running project analysis
- creating persistent provider conversation history as itself

### ProjectPlanner

The ProjectPlanner is the bridge between voice intent and project execution. It
is read-only by design.

Allowed operations:
- read project instructions and docs
- inspect file names and relevant snippets
- classify task risk
- choose a recommended executor provider
- generate an execution prompt
- generate callback questions
- summarize executor reports for the Talker

Forbidden operations:
- file writes
- applying patches
- staging, committing, or pushing
- running destructive commands
- performing the requested implementation itself

### ExecutorAgentAdapter

This layer should reuse AgentLine's existing provider capabilities instead of
building a parallel execution stack.

The adapter should be able to:
- create a new Codex/Claude/OpenCode session in a project
- pass an execution prompt
- stream or poll status
- return final reports and references
- preserve normal AgentLine audit history

Executor sessions are the only layer allowed to perform code changes.

## State Model

```text
CallSession
  durable record of a voice interaction and its callbacks

TalkerSession
  ephemeral low-latency model context, not a normal AgentLine session

PlannerRun
  read-only project analysis and dispatch record

ExecutorAgentSession
  formal provider session that performs real work

CallbackRequest
  scheduled or immediate outbound contact request
```

## Why This Split Matters

Phone interaction is latency-sensitive. A human calling a secretary expects an
immediate answer, not a long silence while an agent reads the repository.

Code execution is audit-sensitive. Real file changes must stay inside existing
AgentLine provider sessions, where diffs, logs, tests, and commits can be
reviewed.

The Talker makes the system feel human. The ProjectPlanner makes it context
aware. The ExecutorAgentSession makes it capable and auditable.
