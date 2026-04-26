# Voice Secretary Safety Boundaries

## Hard Rule

ProjectPlanner must be read-only.

All repository mutations must happen in an ExecutorAgentSession created through
AgentLine's existing provider/session system.

## Permission Table

| Capability | Talker | ProjectPlanner | ExecutorAgentSession |
| --- | --- | --- | --- |
| Speak to user | Yes | No | No |
| Maintain ephemeral call context | Yes | No | No |
| Read transcript | Yes | Yes | Optional |
| Read project docs | No | Yes | Yes |
| Read source files | No | Yes | Yes |
| Write files | No | No | Yes |
| Run tests | No | No | Yes |
| Stage/commit/push | No | No | Yes, when explicitly requested |
| Create callback request | Yes | Yes | No |
| Create execution task | No | Yes | No |

## Audit Requirements

Every write-capable action must be traceable to a formal provider session.

Required references:
- call session id
- planner run id
- execution task id
- provider session id
- project path
- final executor report

## Talker Privacy

The Talker may need fast model access, but its raw realtime reasoning should not
be stored as a normal project session. Store only what is necessary for user
experience and audit:
- caller transcript
- Talker spoken responses
- structured planner requests
- callback decisions

Do not store hidden chain-of-thought or low-level provider events for Talker.

## ProjectPlanner Read-Only Enforcement

Implementation should make write access hard to reach:
- expose read-only repository APIs to ProjectPlanner
- do not pass shell execution tools to ProjectPlanner
- do not pass patch/apply/write tools to ProjectPlanner
- make `ExecutionTask` the only handoff path for write-capable work
- fail closed if ProjectPlanner attempts a mutation

## Executor Session Isolation

Executor sessions should use existing AgentLine safety controls:
- project instructions are loaded from the target repo
- permission mode is explicit
- file changes are visible in session history
- tests and command output are auditable
- commits happen only when requested

## Callback Safety

Callbacks should be short and bounded.

The Talker should call back for:
- missing required information
- approval before high-risk work
- completed work that the user asked to hear about
- failed work that needs a decision

The Talker should not call back repeatedly without a user-approved retry policy.

## Provider API Boundary

Prefer existing AgentLine provider adapters and public provider APIs. If the
Talker needs a faster model path, implement it as a separate ephemeral model
adapter with explicit storage rules. Do not route Talker activity through normal
project sessions just to reuse UI plumbing.
