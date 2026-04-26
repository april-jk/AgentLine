# AgentLine Agent Guide

AgentLine turns phone calls into a control surface for AI agents.

## Working Principles

- Keep the phone experience first: low latency, short turns, clear confirmation.
- Separate the live talker from slower back-office reasoning.
- Prefer explicit structured task packets over ad hoc transcript parsing.
- Do not add external services or dependencies without documenting why they are needed.
- Keep secrets out of the repository. Use `.env` locally and document required variables.

## Implementation Direction

The first useful system should prove the loop before real telephony:

1. transcript in,
2. structured task packet out,
3. executor adapter invoked,
4. callback decision returned.

Only after this loop is stable should Twilio, SIP, LiveKit, or Realtime integrations be added.

## Verification

Every behavioral change should include one of:

- a focused unit test,
- a runnable fixture,
- a documented manual verification command.

For early scaffolding, `npm run check` is the minimum verification command.

