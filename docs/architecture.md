# Architecture Notes

AgentLine should keep realtime conversation concerns separate from agent execution concerns.

## Core Components

`PhoneAdapter`

Owns telephony provider details. It should emit normalized call events and accept normalized outbound audio or text-to-speech events.

`Talker`

Owns the live conversation. It should optimize for latency, turn-taking, interruption handling, and concise confirmation. It should not perform long-running reasoning.

`TaskBroker`

Owns structured task creation. It receives a conversation summary plus relevant transcript spans and produces a task packet.

`AgentAdapter`

Owns execution runtime details. Codex, Claude Code, local scripts, and future agents should fit behind the same adapter boundary.

`CallbackCoordinator`

Owns follow-up policy. It decides whether to call the human back, send an async message, ask for approval, or mark the task complete.

## Task Packet Shape

```json
{
  "id": "task_local_001",
  "source": "phone",
  "caller": {
    "displayName": "Unknown",
    "phoneNumber": "+10000000000"
  },
  "intent": "create_project",
  "summary": "Create a new project repository for a phone-native AI secretary.",
  "openQuestions": [],
  "constraints": [],
  "requiresHumanApproval": false
}
```

## Design Bias

- The live call should stay fast even when the task is complex.
- The system should prefer a callback over pretending it has enough information.
- Every adapter should be replaceable without rewriting the conversation loop.

