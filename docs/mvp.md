# AgentLine MVP

## Goal

Prove that a human can start work by phone without staying in a chat UI.

The MVP should feel like calling a capable secretary. The secretary should not solve everything live. It should collect enough context, hand work to a stronger agent, and call back when more input is needed.

## Phase 0: Local Loop

- Parse a simulated transcript into a task packet.
- Route the task packet to a stub executor.
- Return a callback decision.
- Store the transcript, task packet, and decision as inspectable JSON.

Acceptance:

- One command runs the whole local loop.
- The output clearly shows whether the system should call back, continue background work, or mark the task complete.

Implementation status: complete in the local developer loop.

Verification:

```bash
npm run check
npm test
npm run mvp
```

The MVP command writes full run records to `.agentline/runs/` and prints a
short summary containing the run ID, task ID, execution status, callback
decision, and JSON output path.

## Phase 1: Text Control Surface

- Add a CLI or HTTP endpoint for submitting transcripts.
- Add durable task IDs.
- Add a simple adapter interface for Codex, Claude Code, and mock executors.

Acceptance:

- A developer can replay the same transcript and get a stable task ID plus state transition.

## Phase 2: Phone Adapter

- Add Twilio Media Streams or SIP adapter.
- Stream partial transcript events into the talker.
- Keep the first phone loop narrow: inbound call, summary, confirmation, callback decision.

Acceptance:

- A real call can create a task packet.
- A callback can be triggered from a stored decision.

## Phase 3: Agent Execution

- Wire Codex and Claude Code adapters.
- Add approval gates for actions that touch files, services, payments, or external accounts.
- Add timeout and fallback handling.

Acceptance:

- A phone-created task can dispatch to a local coding agent and return a human-readable progress update.
