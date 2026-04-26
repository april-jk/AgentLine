# Voice Secretary MVP Plan

## MVP Objective

Prove the loop before real telephony:

```text
Browser voice input
  -> ASR transcript
  -> fast Talker response
  -> read-only ProjectPlanner analysis
  -> formal ExecutorAgentSession handoff
  -> Talker spoken summary or callback request
```

The MVP should use web voice or a simulated call adapter. Twilio, SIP, LiveKit,
Feishu, and Telegram should wait until the internal state machine is stable.

## Non-Goals

- No real phone gateway in the first milestone.
- No direct code editing by Talker.
- No direct code editing by ProjectPlanner.
- No separate hidden execution stack outside AgentLine provider sessions.
- No persistent Talker sessions in the normal project session list.

## Milestone 1: Documentation and Types

Deliverables:
- `docs/features/voice-secretary/` architecture and contract docs
- shared TypeScript interfaces for call sessions and task packets
- explicit permission checks that make ProjectPlanner read-only

Acceptance:
- The codebase has a clear `Talker -> ProjectPlanner -> ExecutorAgentSession`
  vocabulary.
- The no-write ProjectPlanner rule is documented and reflected in type names.

## Milestone 2: Simulated Call Loop

Deliverables:
- `SimulatedChannelAdapter`
- `CallSessionService`
- text-only Talker stub
- ProjectPlanner stub that reads `AGENTS.md`, `CLAUDE.md`, README, and docs
- fake ExecutorAgentAdapter for tests

Acceptance:
- A fixture can simulate a caller asking for project guidance.
- The Talker answers immediately.
- ProjectPlanner creates an `ExecutionTask`.
- The fake executor returns a report.
- Talker produces a final caller-facing summary.

Runnable fixture:

```bash
curl -X POST http://localhost:3400/api/voice-secretary/simulate \
  -H 'content-type: application/json' \
  -H 'x-agentline-request: true' \
  -d '{"projectPath":"/Users/watson/codingProj/AgentLine","utterance":"Help me understand what this project should do next."}'
```

The fixture is intentionally text-only. It proves the internal state machine
before Volcengine ASR/TTS or real ExecutorAgentSession creation is added.

To create a real AgentLine provider session from the same task packet, pass
`executorMode: "agentline"`:

```bash
curl -X POST http://localhost:3400/api/voice-secretary/simulate \
  -H 'content-type: application/json' \
  -H 'x-agentline-request: true' \
  -d '{"projectPath":"/Users/watson/codingProj/AgentLine","utterance":"Prepare the next implementation step.","executorMode":"agentline"}'
```

Read-only planner tasks use permission mode `plan` so Codex receives a
read-only sandboxed execution packet.

## Milestone 3: Web Voice Demo

Deliverables:
- browser microphone capture
- Volcengine ASR adapter
- Volcengine TTS adapter
- basic call UI under a feature flag
- call transcript view
- callback request list

Acceptance:
- User can speak a task.
- The Talker responds through audio.
- Planner analysis continues without blocking the call.
- Final spoken response is generated from a structured `TalkerBrief`.
- Provider credentials are loaded from server-side `.env` only and never reach
  the browser.

Implementation notes:
- Use the official Volcengine ASR WebSocket endpoint for streaming recognition.
- Use the official Volcengine TTS WebSocket endpoint for speech synthesis.
- Keep provider specifics inside `VolcengineASRAdapter` and
  `VolcengineTTSAdapter`.

## Milestone 4: Real Executor Handoff

Deliverables:
- Codex ExecutorAgentAdapter using existing AgentLine session creation paths
- provider session reference stored on the planner run
- executor status polling or streaming
- final executor report compression for Talker

Acceptance:
- A voice request can create a real Codex session in the selected project.
- Actual code changes happen only inside that Codex session.
- The voice feature links to the provider session for audit.
- Talker can say whether work finished, failed, or needs confirmation.

## Milestone 5: Callback Flow

Deliverables:
- `CallbackRequest` persistence
- retry and expiry handling
- user-facing callback queue
- simulated outbound callback adapter

Acceptance:
- Missing information creates a callback request.
- Completed execution can create a callback request.
- The Talker uses a short script generated from `TalkerBrief`.

## Later Integrations

After the core loop is stable:
- phone adapter
- Telegram adapter
- Feishu adapter
- outbound call scheduling
- multi-language Talker profiles
- interruption handling and barge-in

## First Test Fixture

Caller:

> Help me understand what this project should do next.

Expected behavior:

1. Talker says it will inspect the project and come back with a concise answer.
2. ProjectPlanner reads project instructions and docs.
3. ProjectPlanner creates either an answer or an `ExecutionTask`.
4. If an executor is needed, AgentLine creates a formal provider session.
5. Talker returns a short summary and asks one concrete next-step question.
