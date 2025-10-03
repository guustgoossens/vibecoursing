# Vibecoursing

Vibecoursing is an AI-guided conversational learning platform built with Next.js and Convex. Learners pick a topic, receive an AI-generated lesson plan, and progress through a chat experience that surfaces key terms, suggested follow-up prompts, and visible progress indicators. Authentication flows through WorkOS AuthKit and all AI interactions run via the Mistral SDK.

## Feature Highlights

- **Topic blueprints:** AI generates structured learning plans with phases, objectives, and key terms.
- **Conversational learning:** Chat UI records user + AI turns and renders optional follow-up prompts to keep momentum.
- **Progress tracking:** Phase progress, covered terms, and completion timelines update in real time.
- **Session persistence:** Sessions are stored in Convex so learners can pause and resume any topic.
- **Secure auth:** WorkOS AuthKit provides sign-in, session management, and middleware protection.

## Architecture Overview

- **Frontend:** Next.js (App Router), React 19, Tailwind CSS.
- **Backend:** Convex for database, queries, mutations, and server actions.
- **Auth:** WorkOS AuthKit middleware + hooks (`useAuth`, `withAuth`).
- **AI Layer:** Convex actions wrapping the Mistral Chat Completions API for plan generation, chat turns, follow-up prompts, and recaps.
- **Tooling:** TypeScript, ESLint, Prettier.

Directory map:
```
app/                Next.js routes, layouts, and client/server components
components/         Reusable UI building blocks
convex/             Convex schema, queries, mutations, actions, generated client
public/             Static assets served by Next.js
docs/               Product requirements and implementation roadmap
```

## Prerequisites

- Node.js 20+
- pnpm 8+ (adapt commands if you prefer npm)
- Convex CLI (`npm install -g convex`)
- WorkOS AuthKit project (Client ID, API Key, redirect URI)
- Mistral API key (and optional custom base URL)

## Setup & Local Development

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Create your environment file**
   ```bash
   cp .env.local.example .env.local
   ```
   Fill in the variables with your project credentials:
   - `WORKOS_CLIENT_ID`
   - `WORKOS_API_KEY`
   - `WORKOS_COOKIE_PASSWORD` (≥ 32 chars for session encryption)
   - `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
   - `MISTRAL_API_KEY`
   - `MISTRAL_BASE_URL` (defaults to `https://api.mistral.ai/v1`)

3. **Provision Convex**
   ```bash
   npx convex dev
   ```
   The first run links the project to a Convex deployment, regenerates types in `convex/_generated`, and opens the dashboard. Keep this command running in a terminal while developing.

4. **Run the full stack**
   ```bash
   pnpm dev
   ```
   This launches Next.js (`localhost:3000`) and Convex dev servers. Log in via `/sign-in` to access authenticated routes.

5. **Populate initial data (optional)**
   Use the Convex dashboard or scripts to seed learning sessions if you need demo content for the UI.

## Useful Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run Next.js + Convex dev servers in parallel |
| `pnpm build` | Build the Next.js app for production |
| `pnpm start` | Serve the production build |
| `pnpm lint` | Run the Next.js ESLint suite |
| `pnpm format` | Format files with Prettier |

Convex commands (`npx convex dev`, `npx convex dashboard`) can also be run directly when you need to manage deployments or inspect data.

## Testing & Quality

- **Static analysis:** `pnpm lint`
- **Formatting check:** `pnpm format --check`
- **Manual smoke test:**
  1. Start `pnpm dev`.
  2. Sign in via `/sign-in`.
  3. Create a topic, send a prompt, verify AI responses + follow-ups render, and confirm progress updates.

Automated tests are not yet wired up; if you add Vitest or Playwright, colocate specs alongside components and document the commands here. When interacting with the Mistral SDK in tests, mock network calls in Convex actions to keep runs deterministic.

## Deployment

1. Configure the same env vars (WorkOS + Mistral + Convex) in your hosting provider and Convex production deployment.
2. Build the app with `pnpm build`; serve it using `pnpm start` or your platform's adapter.
3. Promote your Convex deployment and update the generated `CONVEX_URL` in production `.env` files.
4. Verify the WorkOS redirect URI matches the deployed domain (`https://your-domain.com/callback`).

## Documentation & Planning

Product context, requirements, and phased delivery plans live in:
- `docs/project-requirement-document.md`
- `docs/mvp_implementation_phase.md`

Use these documents to guide feature scope, completion criteria, and future phases (onboarding, recaps, analytics).

## Support & Resources

- [Convex docs](https://docs.convex.dev/)
- [WorkOS AuthKit docs](https://workos.com/docs/authkit)
- [Mistral API reference](https://docs.mistral.ai/)

Issues and feature requests: open a ticket in the GitHub repository once published. Contributions are welcome—follow linting and formatting rules above to keep changes consistent.
