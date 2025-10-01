# Vibecoursing Product Requirement Document

## Product Snapshot
- **Product Name:** Vibecoursing
- **Tagline:** AI-guided conversational learning with structured progress tracking
- **Summary:** Web app powered by Mistral’s SDK that delivers conversational lessons, proactive follow-up questions, and visible progress indicators so self-directed learners can build knowledge in focused topics.
- **Objectives:** Deliver engaging chat-based learning journeys; keep learners progressing via guided prompts and topic structure; visualize progress to reinforce motivation; ship a lean MVP that is easy to extend later.

## Success Metrics
- **Active learners:** 30% of new sign-ups complete two phases within their first week.
- **Engagement:** Average session ≥12 minutes with ≥8 follow-up prompts chosen per session.
- **Learning outcomes:** 70% of learners self-report improved understanding post-phase; ≥80% of glossary terms per phase surfaced in conversation.
- **Retention:** 40% return within 3 days; 25% complete a second topic in 14 days.

## Target Audience
- Self-directed knowledge seekers needing structure around curiosity-driven topics.
- Skills upgraders seeking quick refreshers with visible checkpoints.
- Lifelong learners experimenting with new subjects and comfortable in chat interfaces.
- Initial launch: English UI, desktop-first, responsive web.

## User Stories
1. Pick or accept AI-suggested topic and start immediately.
2. Review AI-generated plan with phases, terms, and objectives.
3. Ask custom questions; receive and select AI follow-up prompts.
4. Watch progress bar and learned-terms list update in real time.
5. Revisit past sessions from sidebar to continue learning.
6. Receive onboarding cues that explain the learning flow.

## Assumptions
- Users accept AI-generated plans without manual editing.
- Mistral SDK handles follow-up prompt creation and topic scaffolding.
- Convex provides reliable storage for conversations, plans, and progress.
- Learning progress is exposure-based (terms surfaced) rather than mastery testing.
- Users keep sessions short-to-medium; offline use not required.

## Constraints
- Comply with Mistral rate limits and context window.
- Keep UI minimal and readable for MVP; avoid feature creep (no emails, marketplace, collaboration).
- Progress calculations must be deterministic and explainable.
- Desktop-first; responsive layout must still support progress elements.
- Single-language launch; multi-language deferred.

## Functional Requirements
- **FR1 Topic Setup:** User enters a topic or picks suggestion; AI generates fixed learning plan (phases, terms, objectives) without user editing.
- **FR2 Conversational AI:** Chat interface sends user inputs to Mistral; returns answer plus three follow-up prompts.
- **FR3 Follow-up Prompts:** Tappable chips append prompt and trigger new exchange; track which prompts were used.
- **FR4 Progress Tracking:** System marks terms as covered when surfaced in conversation; progress bar reflects percent of current phase and overall plan.
- **FR5 Learned Terms Panel:** Dedicated UI showing covered terms with completion indicator.
- **FR6 Conversation History Sidebar:** Persist sessions (topic title, timestamp, progress) and reload on selection.
- **FR7 Session Persistence:** Store transcripts, plan metadata, and progress state in Convex; restore on refresh.
- **FR8 Onboarding Nudges:** Lightweight tooltips for first-time users highlighting follow-up prompts, progress bar, and topic plan.
- **FR9 Account/Auth:** Email/password or OAuth for persistence across devices; guest mode optional but warns about loss of data.
- **FR10 Settings:** Minimal controls (toggle follow-up prompts, adjust response length, reset topic progress).
- **FR11 Recap Prompt (Optional for MVP):** Offer short AI-generated recap after phase completion; no quizzes yet.

## Non-Functional Requirements
- **Latency:** Average AI response <3 seconds.
- **Availability:** ≥99% outside maintenance.
- **Scalability:** Support 1,000 concurrent sessions.
- **Security:** Encrypt data in transit/at rest; protect conversation history.
- **Compliance:** Transparent data policy with delete option.
- **Accessibility:** WCAG 2.1 AA for colors, typography, keyboard navigation.
- **Observability:** Monitor topic creation, follow-up usage, phase completion.

## User Journeys
1. Topic initiation → AI-generated plan → user accepts → chat starts.
2. Active learning session → AI answer plus follow-ups → user selects prompt → progress updates in panel.
3. Phase progression → progress bar advances as terms exposed → user views remaining terms.
4. Session return → user picks session from sidebar → conversation history and progress restored.
5. Phase completion → recap offered → user either continues next phase or ends session (no mastery quiz).

## UI & UX Notes
- Familiar chat layout with follow-up prompt chips beneath AI messages.
- Left sidebar listing sessions with topic names and progress percentages.
- Right/top panel for plan overview, progress bar, and learned terms; collapsible on small screens.
- Subtle animation on progress updates; tooltips for first session.
- Color palette signals progress states while maintaining readability.
- Provide quick link to full phase plan from progress panel.

## Technical Considerations
- **Frontend:** Next.js app; consider streaming responses for responsiveness.
- **State management:** React context or Zustand for chat and progress state.
- **Backend:** Next.js API routes or server actions interfacing with Mistral SDK.
- **Storage:** Convex collections for Users, Sessions, Topics, Phases, Terms, Messages, Progress logs.
- **Metadata tagging:** AI responses tagged to detect when terms are covered; store in Convex.
- **Logging:** Securely log prompts/responses for QA while respecting privacy settings.
- **Feature flags:** Gate future enhancements without complicating MVP.

## Analytics & Instrumentation
- Track topic creation, session starts/ends, follow-up prompt selections, term coverage, and phase completion.
- Measure time-on-session, ratio of custom vs follow-up prompts, and drop-off phase.
- Collect optional thumbs-up/down feedback on AI responses for future tuning.

## Out of Scope (MVP)
- User-editable topic plans.
- Marketplace or curated topic catalog.
- Mastery-based assessments or quizzes.
- Retention hooks (emails, streaks, notifications).
- Collaborative learning or instructor tooling.
- Mobile-native apps, multi-language support, external content ingestion.

## Risks & Mitigations
- **AI hallucination:** Refine system prompts, consider retrieval augmentation, add contextual disclaimers.
- **Progress inaccuracies:** Define deterministic rules; allow manual reset if progress feels wrong.
- **UI clutter:** Validate via usability tests; keep optional panels collapsible.
- **Topic quality cold start:** Provide preset popular topics for quick start and iteratively refine prompt engineering.
- **Data privacy:** Maintain clear policy, user-controlled deletion, and secure storage in Convex.

## Resolved Decisions
- Topic plans remain AI-generated and fixed in MVP.
- No marketplace or curated catalog at launch.
- Progress focuses on exposure (terms surfaced), not mastery quizzes.
- No retention emails or hooks initially.
- No collaboration features planned for MVP.

## Next Steps
1. Prototype chat + progress UI; test comprehension of progress indicators.
2. Define Convex schema and progress-tracking logic (term tagging, phase completion criteria).
3. Draft Mistral system prompts for plan creation, conversational guidance, follow-up questions, and recap.
4. Instrument analytics events for core flows; set up monitoring dashboards.
5. Run user tests on early build to validate usability and pacing before feature expansion.

> **Potential follow-up:**
> 1. Prioritize implementation milestones (frontend vs backend).
> 2. Outline Convex schema in detail.
> 3. Draft initial prompt templates.
