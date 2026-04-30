# Voice Secretary

AgentLine should treat voice calls as a first-class human interface for AI agents.
The first version is not a phone chatbot. It is a secretary layer that lets a
human speak naturally, turns that conversation into structured work, delegates
real execution to existing AgentLine provider sessions, and calls back only when
human confirmation is needed.

## Product Thesis

Future human-agent interaction will often start as a call. The caller should be
able to say what they need in a few short turns, leave the line, and trust the
system to either finish the work or call back with a specific question.

AgentLine's role is to coordinate that loop:

```text
Human call
  -> Volcengine ASR
  -> Talker
  -> ProjectPlanner
  -> ExecutorAgentSession
  -> ProjectPlanner
  -> Talker
  -> Volcengine TTS / message / callback
```

## Roles

### Talker

The Talker is the real-time secretary in the call.

It is optimized for:
- fast responses
- short, natural turns
- interruption-friendly dialogue
- collecting missing information
- telling the user when the system will continue asynchronously

It must not:
- read full repositories
- modify files
- run tests
- create normal AgentLine conversation records for its ephemeral reasoning
- expose long agent internals during a call

### ProjectPlanner

The ProjectPlanner is a read-only project analyst and task dispatcher.

It reads project context, such as:
- `AGENTS.md`
- `CLAUDE.md`
- README files
- docs
- relevant code structure
- current repository state, read-only

It outputs structured task packets, execution prompts, risk notes, and callback
questions. It does not mutate files.

### ExecutorAgentSession

The ExecutorAgentSession is the existing formal agent session that performs real
work. It can be Codex, Claude, OpenCode, or another AgentLine provider.

Only this layer can:
- edit files
- run commands
- run tests
- create commits
- produce auditable execution history

## Design Documents

- [architecture.md](./architecture.md) defines the runtime architecture and data flow.
- [contracts.md](./contracts.md) defines the core data structures and adapter contracts.
- [memory-system.md](./memory-system.md) defines the local persistent memory model for Talker, Worker write-back, and project initialization.
- [memory-implementation-plan.md](./memory-implementation-plan.md) maps the memory design into concrete files, stages, interfaces, and verification steps.
- [mvp-plan.md](./mvp-plan.md) defines the first buildable milestone.
- [safety-boundaries.md](./safety-boundaries.md) defines permission and audit rules.
- [volcengine-speech.md](./volcengine-speech.md) defines the ASR and TTS provider
  configuration.

## First Milestone

Build a Web Voice demo before integrating real telephony:

1. Browser microphone input is transcribed by ASR.
2. Talker responds quickly through TTS.
3. Talker emits a `PlannerRequest`.
4. ProjectPlanner reads the selected project and prepares an `ExecutionTask`.
5. AgentLine creates an ExecutorAgentSession for actual implementation work.
6. ProjectPlanner summarizes the result.
7. Talker reports back or creates a callback request.

The milestone is complete when a user can say:

> Help me understand what this project should do next.

AgentLine should answer immediately, analyze the selected project in the
background, then return a short spoken summary and a concrete next-step question.
