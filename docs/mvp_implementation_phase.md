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
- **Data plumbing**: Use Convex React hooks (`useQuery`, `useMutation`) to populate the channel list and stream messages in real time; fall back to placeholder skeleton states while loading.
- **Message composer**: Wire the composer to the send-message mutation with optimistic updates and disabled state when offline/unauthenticated.
- **State hygiene**: Handle empty channel states, auth edge cases (show sign-in CTA if session missing), and a basic error toast/toastless inline message for mutation failures.
- **Acceptance**: Authenticated users see live channel updates, can send messages from the UI, and changes propagate instantly across open clients.

## Phase 3 – CRUD & Polish
- **Channel management**: Add create/rename/delete flows with simple modals, reuse Convex mutations with validation (unique names, authorisation checks), and surface confirmation prompts for destructive actions.
- **Membership controls**: Leverage `channelMembers` for inviting/removing users (start with email-based invites or simple public/private toggle) while respecting WorkOS identities.
- **Message refinement**: Support edit/delete for the author’s messages, writing audit metadata (edited flag, deleted marker) so history stays consistent.
- **Quality pass**: Add smoke tests for critical Convex functions, ensure Tailwind components meet accessibility basics, and capture follow-up tasks (typing indicators, file uploads) in backlog.
- **Acceptance**: Team can manage channels and messages end-to-end with guardrails, and the codebase is ready for incremental enhancements without refactors.

Deliver this MVP iteratively—ship Phase 1 to unblock backend work, layer Phase 2 UI quickly for feedback, then add Phase 3 refinement once core flows feel right.
