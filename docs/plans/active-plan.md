# 1800anything - Active Plan

## Goal
SMS-based service marketplace: user texts problem → agent clarifies → sources providers → gets quotes → user picks → pays → booked.

## Architecture
- Hono HTTP server with Twilio webhook endpoint
- Postgres DB with 5 tables: users, tasks, messages, providers, quotes
- State machine on tasks: intake → clarifying → sourcing → quoting → awaiting_selection → completed
- OpenAI for: extracting structured data, parsing quotes
- Twilio for: inbound/outbound SMS/MMS
- Stripe payment links for payment

## Implementation Tasks

### TASK-001: Scaffolding + DB + Types
- package.json with dependencies
- tsconfig.json (strict)
- .env.example
- schema.sql with all 5 tables
- TypeScript types/enums

### TASK-002: Server + Routes
- Hono server entry point
- Twilio webhook route (handles both user and provider messages)

### TASK-003: Services
- taskService: load/create tasks, state transitions
- agentService: LLM-powered extraction + decision loop
- sourcingService: find providers (stubbed Google Places)
- quoteService: parse quotes, format options, handle selection
- messagingService: Twilio send/receive abstraction

### TASK-004: Integration Testing
- End-to-end flow test
- Verify webhook → task → agent → provider → quote → selection → payment → confirmation

## File Structure
```
src/
  server.ts
  types.ts
  routes/
    twilio.ts
  services/
    taskService.ts
    agentService.ts
    sourcingService.ts
    quoteService.ts
    messagingService.ts
  db/
    schema.sql
    client.ts
```

## Stubs for v1
- Google Places → hardcoded providers
- Stripe → static payment link
- Queue → synchronous processing
