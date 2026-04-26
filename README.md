# AgentLine

Give AI agents a phone line.

AgentLine is an early-stage open-source project for turning phone calls into an operator-grade control surface for AI agents.

The core idea is simple: a low-latency voice secretary handles the live call, captures intent, asks short clarifying questions, and hands structured work to stronger back-office agents such as Codex, Claude Code, or domain-specific LLM workers. When more human input is needed, AgentLine can call back instead of forcing the user to sit in a chat thread.

## Why This Exists

Text chat is not the final interface for daily human-AI collaboration. A better interface is closer to calling a competent assistant:

1. You say what you need.
2. The assistant confirms enough detail to avoid obvious mistakes.
3. Slower reasoning and execution happen in the background.
4. The assistant calls back only when confirmation, missing context, or final delivery matters.

Most current voice-agent projects focus on customer support or appointment booking. Most coding-agent bridge projects focus on Telegram, Discord, web dashboards, or terminal control. AgentLine sits between those two worlds: telephony-native conversation at the front, agent-native execution at the back.

## Initial Scope

AgentLine starts as a small, explicit core rather than a giant platform.

- Phone bridge: inbound and outbound call primitives through SIP/Twilio-compatible adapters.
- Talker: low-latency voice secretary responsible for live conversation quality.
- Task broker: turns spoken intent into a structured task packet.
- Agent adapters: dispatches structured work to Codex, Claude Code, or other executors.
- Callback loop: calls the human back when a task needs clarification or approval.

## Non-Goals For The First Version

- A generic call-center SaaS.
- A replacement for Codex or Claude Code.
- A fake terminal over the phone.
- Multi-tenant enterprise controls before the single-operator flow works.

## Architecture Sketch

```text
Human
  |
  | phone call
  v
Phone Adapter
  |
  | audio/events
  v
Talker
  |
  | structured intent
  v
Task Broker
  |
  +--> Codex Adapter
  +--> Claude Code Adapter
  +--> Custom Agent Adapter
  |
  | missing info / approval / result
  v
Callback Coordinator
  |
  | outbound call / IM / email
  v
Human
```

## Repository Status

This repository is the seed for the project. The first implementation milestone is a local developer loop that can:

1. accept a simulated call transcript,
2. produce a structured task packet,
3. route it to a stub executor,
4. return a callback decision.

After that, the phone adapter can be wired to Twilio Media Streams or SIP/RTP.

## Development

```bash
npm install
npm run check
npm test
npm run mvp
npm run start
```

The current code is intentionally minimal and dependency-free. `npm run mvp`
runs the local transcript-to-callback loop and writes inspectable JSON under
`.agentline/runs/`.
