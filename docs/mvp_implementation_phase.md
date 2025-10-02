# MVP Implementation Phases

Existing WorkOS AuthKit wiring already handles authentication and session priming. This plan assumes the current login/logout flow is stable and focuses on layering a chat MVP in three quick passes while reusing that auth context.
All AI-driven behaviors—including conversational replies, follow-up prompts, plan scaffolding, and recaps—must continue to run exclusively through the Mistral SDK to stay consistent with the requirements document.

## Phase 1 – Data & Backend Foundation
- **Audit WorkOS handoff**: Confirm the existing middleware protects the chat routes, ensure the Convex client receives the WorkOS user profile (user id/email) in `auth.getUserIdentity()`, and document any required metadata mapping.
- **Schema scaffolding**: Define initial Convex tables and indexes (`users`, `channels`, `channelMembers`, `messages`) with clear validators, ownership fields, and timestamps; seed a handful of records if helpful for quick UI bring-up.
- **Core functions**: Implement simple Convex queries/mutations for listing channels, fetching messages (paginated by `createdAt`), and inserting new messages. Guard them with auth checks using the already-working WorkOS identity.
- **Mistral SDK wiring**: Centralize all AI calls through Convex actions that wrap the Mistral Chat Completions API, with helpers for plan generation, follow-up prompts, and future recap flows while handling rate limits and error logging.
- **Local tooling**: Update any existing `docs/` scripts or lint rules to cover the new tables, and add concise notes on how to run Convex dev + Next.js simultaneously for anyone onboarding.
- **Developer setup**: After pulling, run `npx convex dev` once to regenerate `_generated` types and keep the Next.js + Convex dev servers aligned.
- **Acceptance**: Running `npx convex dev` plus `pnpm dev` yields connected clients that can read seeded channels/messages while authenticated via WorkOS.

## Phase 2 – Chat Interface Slice
- **Layout shell**: Build a minimal Next.js App Router layout with Tailwind—a left-side channel list, main chat window, message composer, and top bar showing WorkOS user info.
  - Implementation: `app/page.tsx` now composes the chat shell via `ChatLayout`, `ChannelSidebar`, and a dedicated top bar so the UI spans the full viewport.
- **Data plumbing**: Use Convex React hooks (`useQuery`, `useMutation`) to populate the channel list and stream messages in real time; fall back to placeholder skeleton states while loading.
  - Implementation: `useQuery(api.chat.listChannels)` drives the sidebar with selection state, while `useQuery(api.chat.listMessages)` streams updates per channel with auto-scroll and skeleton fallbacks.
- **Message composer**: Wire the composer to the send-message mutation with optimistic updates and disabled state when offline/unauthenticated.
  - Implementation: `MessageComposer` dispatches `api.chat.sendMessage` with local pending state, character limits, offline detection, and inline error feedback.
- **State hygiene**: Handle empty channel states, auth edge cases (show sign-in CTA if session missing), and a basic error toast/toastless inline message for mutation failures.
  - Implementation: Empty channel/message states surface direct guidance, inline mutation errors surface near the composer, and unauthenticated visitors hit the sign-in CTA.
- **Acceptance**: Authenticated users see live channel updates, can send messages from the UI, and changes propagate instantly across open clients.

## Phase 3 – AI Interaction Layer
- **Learning session bootstrap**: Introduce a topic intake flow that calls the `generatePlan` action, persists the plan (topic, phases, key terms) in Convex, and initializes a learning session tied to the WorkOS user.
- **AI-powered conversation**: Replace the human-only composer with an AI chat loop that pipes learner prompts to `chatTurn`, stores AI/user messages with role metadata, and renders Mistral follow-up prompts as selectable chips beneath responses.
- **Progress instrumentation**: Track term exposure per message, update phase/overall progress in Convex, and render real progress UI elements (plan summary panel, progress bar, learned terms list) alongside the conversation.
- **Session persistence**: Extend the sidebar to list learning sessions/topics with progress indicators and allow resuming by rehydrating plan and transcript state from Convex.
- **Acceptance**: Authenticated learners can launch a topic, converse with the AI, act on suggested follow-ups, and watch progress indicators update in real time, with session state restoring on refresh.

## Phase 4 – Guidance & Recap Polish
- **Follow-up refinements**: Capture telemetry on follow-up prompt usage, add optimistic UI states, and let learners hide/show prompt chips mid-session.
- **Recap & completion**: Trigger `generateFollowUps` and an early `generateRecap` action when phases complete, persisting summaries and nudging learners toward next steps.
- **Onboarding & tooltips**: Layer in first-run walkthroughs that explain the plan panel, follow-up prompts, and progress logic for new learners.
- **Quality + analytics pass**: Add client/server logging for AI interactions, ensure accessibility coverage for AI components, and expand docs on configuring Mistral env vars plus rate-limit mitigations.
- **Acceptance**: Learners receive structured follow-ups, completion recaps, and onboarding cues, with analytics capturing key AI engagement events.

Deliver this MVP iteratively—ship Phase 1 to unblock backend work, layer Phase 2 UI quickly for feedback, deepen the AI interaction in Phase 3, then polish guidance and analytics in Phase 4.
