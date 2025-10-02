'use client';

import { Authenticated, Unauthenticated, useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ChatLayout } from '@/components/chat/ChatLayout';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components as ReactMarkdownComponents } from 'react-markdown';
import type { Id } from '@/convex/_generated/dataModel';

type AuthLikeUser = {
  email?: string | null;
  firstName?: unknown;
  lastName?: unknown;
  profilePictureUrl?: unknown;
  photoUrl?: unknown;
};

type DerivedProfile = {
  email?: string;
  name?: string;
  avatarUrl?: string;
};

type ViewerSummary = {
  id: Id<'users'>;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
} | null;

type SessionSummary = {
  id: Id<'learningSessions'>;
  topic: string;
  createdAt: number;
  updatedAt: number;
  currentPhaseIndex: number | null;
  completedPhases: number;
  totalPhases: number;
  completedTerms: number;
  totalTerms: number;
};

type GeneratedPlanPhase = {
  name: string;
  objective: string;
  keyTerms: string[];
};

type GeneratedPlan = {
  topic: string;
  tone?: string;
  summary?: string;
  phases: GeneratedPlanPhase[];
};

type SessionTranscriptMessage = {
  id: Id<'sessionMessages'>;
  role: 'user' | 'assistant';
  body: string;
  createdAt: number;
  termsCovered: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type SessionFollowUpSuggestion = {
  id: Id<'sessionFollowUps'>;
  prompt: string;
  rationale: string | null;
  createdAt: number;
  usedAt: number | null;
  generatedForMessageId: Id<'sessionMessages'>;
};

type SessionPhaseProgress = {
  index: number;
  name: string;
  objective: string;
  totalTerms: number;
  completedTerms: number;
  remainingTerms: string[];
  coveredTerms: string[];
  isComplete: boolean;
};

type SessionTranscriptData = {
  session: SessionSummary;
  messages: SessionTranscriptMessage[];
  followUps: SessionFollowUpSuggestion[];
  phaseProgress: SessionPhaseProgress[];
};

class PlanValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlanValidationError';
    this.code = code;
    Object.setPrototypeOf(this, PlanValidationError.prototype);
  }
}

const MAX_PROMPT_LENGTH = 2000;

const markdownComponents: ReactMarkdownComponents = {
  p: ({ children, ...props }) => (
    <p
      {...props}
      className="text-sm leading-6 text-foreground [&:not(:first-child)]:mt-3"
    >
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <strong {...props} className="font-semibold text-foreground">
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em {...props} className="italic text-foreground">
      {children}
    </em>
  ),
  ul: ({ children, ...props }) => (
    <ul {...props} className="ml-5 list-disc space-y-1 text-sm leading-6 text-foreground">
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol {...props} className="ml-5 list-decimal space-y-1 text-sm leading-6 text-foreground">
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li {...props} className="text-sm leading-6 text-foreground marker:text-muted-foreground">
      {children}
    </li>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      {...props}
      className="border-l-2 border-slate-300 pl-3 text-sm italic text-muted-foreground dark:border-slate-700"
    >
      {children}
    </blockquote>
  ),
  a: ({ children, href, ...props }) => (
    <a
      {...props}
      href={href}
      className="font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
    >
      {children}
    </a>
  ),
  hr: (props) => <hr {...props} className="my-4 border-slate-200 dark:border-slate-700" />,
  code: ({ inline, className, children, ...props }) => {
    if (inline) {
      return (
        <code
          {...props}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {children}
        </code>
      );
    }

    return (
      <pre className="mt-3 overflow-x-auto rounded-md bg-slate-950/90 p-3 text-sm text-slate-100">
        <code {...props} className={className}>
          {children}
        </code>
      </pre>
    );
  },
  table: ({ children, ...props }) => (
    <div className="mt-3 overflow-x-auto">
      <table
        {...props}
        className="w-full table-auto text-left text-sm text-foreground"
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th {...props} className="border-b border-slate-200 px-3 py-2 text-left font-semibold dark:border-slate-700">
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td {...props} className="border-b border-slate-200 px-3 py-2 align-top dark:border-slate-700">
      {children}
    </td>
  ),
};

function deriveProfileFields(user: AuthLikeUser | null | undefined): DerivedProfile {
  if (!user) {
    return {};
  }
  const profileAwareUser = user;
  const toOptionalString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

  const first = toOptionalString(profileAwareUser.firstName);
  const last = toOptionalString(profileAwareUser.lastName);
  const nameParts = [first, last].filter((part): part is string => part !== undefined);
  const email = typeof user.email === 'string' && user.email.length > 0 ? user.email : undefined;
  const name = nameParts.length > 0 ? nameParts.join(' ') : email;
  const avatarCandidate =
    toOptionalString(profileAwareUser.profilePictureUrl) ?? toOptionalString(profileAwareUser.photoUrl);
  const avatarUrl = avatarCandidate;

  return {
    email,
    name: name ?? undefined,
    avatarUrl,
  };
}

export default function Home() {
  return (
    <>
      <Authenticated>
        <Content />
      </Authenticated>
      <Unauthenticated>
        <UnauthenticatedState />
      </Unauthenticated>
    </>
  );
}

function Content() {
  const { user, signOut } = useAuth();
  const syncUserProfile = useMutation(api.chat.syncUserProfile);
  const derivedProfile = useMemo(() => deriveProfileFields(user), [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    void syncUserProfile({
      email: derivedProfile.email,
      name: derivedProfile.name,
      avatarUrl: derivedProfile.avatarUrl,
    });
  }, [user, derivedProfile.email, derivedProfile.name, derivedProfile.avatarUrl, syncUserProfile]);

  const bootstrap = useQuery(api.chat.sessionBootstrap);
  const sessions = useQuery(api.chat.listLearningSessions);

  const [activeSessionId, setActiveSessionId] = useState<Id<'learningSessions'> | null>(null);
  const [isIntakeOpen, setIsIntakeOpen] = useState(false);

  useEffect(() => {
    if (sessions === undefined) {
      return;
    }
    if (sessions.length === 0) {
      if (activeSessionId !== null) {
        setActiveSessionId(null);
      }
      return;
    }
    if (!activeSessionId || !sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  const transcript = useQuery(
    api.chat.getSessionTranscript,
    activeSessionId ? { sessionId: activeSessionId } : 'skip'
  );

  const viewer = bootstrap?.viewer ?? null;
  const activeSession = activeSessionId && sessions ? sessions.find((session) => session.id === activeSessionId) ?? null : null;

  const handleSelectSession = useCallback((sessionId: Id<'learningSessions'>) => {
    setActiveSessionId((current) => (current === sessionId ? current : sessionId));
  }, []);

  const handleSessionCreated = useCallback((sessionId: Id<'learningSessions'>) => {
    setActiveSessionId(sessionId);
    setIsIntakeOpen(false);
  }, []);

  const openIntake = useCallback(() => {
    setIsIntakeOpen(true);
  }, []);

  const closeIntake = useCallback(() => {
    setIsIntakeOpen(false);
  }, []);

  if (bootstrap === undefined || sessions === undefined) {
    return (
      <ChatLayout
        header={<WorkspaceTopBar user={user} onSignOut={signOut} />}
        sidebar={<SessionSidebarSkeleton />}
        main={<SessionMainSkeleton />}
      />
    );
  }

  return (
    <>
      <ChatLayout
        header={<WorkspaceTopBar user={user} onSignOut={signOut} />}
        sidebar={
          <SessionSidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onStartNewSession={openIntake}
          />
        }
        main={
          <SessionLanding
            viewer={viewer}
            session={activeSession}
            hasSessions={sessions.length > 0}
            onSessionCreated={handleSessionCreated}
            transcript={transcript}
            onStartNewSession={openIntake}
          />
        }
      />
      <SessionIntakeModal
        open={isIntakeOpen}
        onClose={closeIntake}
        onSessionCreated={handleSessionCreated}
      />
    </>
  );
}

function WorkspaceTopBar({ user, onSignOut }: { user: AuthLikeUser | null | undefined; onSignOut: () => void }) {
  return (
    <div className="flex h-14 items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground text-lg font-semibold text-background">
          VC
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold leading-none">Vibecoursing</span>
          <span className="text-xs text-muted-foreground">Learning companion MVP</span>
        </div>
      </div>
      {user && <UserMenu user={user} onSignOut={onSignOut} />}
    </div>
  );
}

function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onStartNewSession,
}: {
  sessions: SessionSummary[];
  activeSessionId: Id<'learningSessions'> | null;
  onSelectSession: (sessionId: Id<'learningSessions'>) => void;
  onStartNewSession: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sessions</h2>
          <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">{sessions.length}</span>
        </div>
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm transition hover:border-foreground hover:text-foreground dark:border-slate-700"
          onClick={onStartNewSession}
        >
          New
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions yet—use the New button above to draft your first topic.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const progress = session.totalTerms > 0 ? Math.round((session.completedTerms / session.totalTerms) * 100) : 0;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      isActive
                        ? 'border-slate-300 bg-background text-foreground shadow-sm dark:border-slate-700'
                        : 'border-transparent bg-background/40 text-muted-foreground hover:border-slate-300 hover:bg-background hover:text-foreground dark:hover:border-slate-700'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{session.topic}</span>
                      <span className="text-[10px] uppercase text-muted-foreground">{progress}%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Updated {new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      <p className="text-xs text-muted-foreground">
        Learning sessions capture your topic plan, transcripts, and progress across key terms.
      </p>
    </>
  );
}

function SessionSidebarSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="h-4 w-28 rounded bg-slate-300/50 dark:bg-slate-700/60" />
      <div className="flex flex-col gap-3">
        <div className="h-12 w-full rounded bg-slate-300/30 dark:bg-slate-700/40" />
        <div className="h-12 w-full rounded bg-slate-300/30 dark:bg-slate-700/40" />
        <div className="h-12 w-full rounded bg-slate-300/30 dark:bg-slate-700/40" />
      </div>
      <div className="h-10 w-3/4 rounded bg-slate-300/30 dark:bg-slate-700/40" />
    </div>
  );
}

function SessionLanding({
  viewer,
  session,
  hasSessions,
  onSessionCreated,
  transcript,
  onStartNewSession,
}: {
  viewer: ViewerSummary;
  session: SessionSummary | null;
  hasSessions: boolean;
  onSessionCreated: (sessionId: Id<'learningSessions'>) => void;
  transcript: SessionTranscriptData | undefined;
  onStartNewSession: () => void;
}) {
  if (!hasSessions) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 px-6 py-8">
        <EmptySessionState viewer={viewer} />
        <SessionIntake onSessionCreated={onSessionCreated} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 px-6 py-8">
        <MissingSessionSelectionState />
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-slate-300 bg-muted/20 px-6 py-6 text-center text-muted-foreground dark:border-slate-700/70">
          <p className="text-sm">Select a session in the sidebar or start a new one to begin learning.</p>
          <button
            type="button"
            onClick={onStartNewSession}
            className="rounded-md border border-slate-300 bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition hover:border-foreground hover:text-foreground dark:border-slate-700"
          >
            Start a new session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 px-6 py-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(320px,1fr)] xl:items-start">
        <SessionTranscriptPanel sessionId={session.id} transcript={transcript} />
        <SessionOverviewCard session={session} phaseProgress={transcript?.phaseProgress} />
      </div>
    </div>
  );
}

function EmptySessionState({ viewer }: { viewer: ViewerSummary }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-slate-300 bg-muted/20 px-6 py-10 text-center dark:border-slate-700/70">
      <h2 className="text-lg font-semibold">Welcome{viewer?.name ? `, ${viewer.name}` : ''}!</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Use the intake form below to draft your first guided learning session. Vibecoursing will turn a topic into a phased plan and track your progress.
      </p>
    </div>
  );
}

function MissingSessionSelectionState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-slate-300 bg-muted/20 px-6 py-10 text-center text-muted-foreground dark:border-slate-700/70">
      <h3 className="text-sm font-medium text-foreground">Select a session to view its progress</h3>
      <p className="max-w-sm text-sm">Pick any session from the sidebar or use the New button to draft a fresh learning topic.</p>
    </div>
  );
}

function SessionOverviewCard({
  session,
  phaseProgress,
}: {
  session: SessionSummary;
  phaseProgress?: SessionPhaseProgress[];
}) {
  const phasePercent = session.totalPhases > 0 ? Math.round((session.completedPhases / session.totalPhases) * 100) : 0;
  const termPercent = session.totalTerms > 0 ? Math.round((session.completedTerms / session.totalTerms) * 100) : 0;
  const nextPhase = phaseProgress?.find((phase) => !phase.isComplete) ?? null;
  const allPhasesComplete = phaseProgress ? phaseProgress.every((phase) => phase.isComplete) : false;
  const learnedTerms = phaseProgress ? Array.from(new Set(phaseProgress.flatMap((phase) => phase.coveredTerms))) : [];
  const displayedLearnedTerms = learnedTerms.slice(0, 24);

  return (
    <div className="flex min-h-[460px] flex-col gap-5 rounded-md border border-slate-200 bg-background px-6 py-6 shadow-sm dark:border-slate-700">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{session.topic}</h1>
        <p className="text-sm text-muted-foreground">
          {session.currentPhaseIndex !== null
            ? `Currently in phase ${session.currentPhaseIndex + 1} of ${session.totalPhases}`
            : 'Phase status pending'}
        </p>
      </div>
      {phaseProgress && (
        <div className="space-y-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overall progress</span>
          <div className="space-y-3">
            <ProgressStat
              label="Phase progression"
              percent={phasePercent}
              detail={`${session.completedPhases}/${session.totalPhases}`}
            />
            <ProgressStat
              label="Key terms covered"
              percent={termPercent}
              detail={`${session.completedTerms}/${session.totalTerms}`}
            />
          </div>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <InfoField
          label="Created"
          value={new Date(session.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        />
        <InfoField
          label="Last updated"
          value={new Date(session.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        />
      </div>
      {phaseProgress && <PhaseProgressList phases={phaseProgress} />}
      {phaseProgress && (
        <LearnedTermsSection
          learnedTerms={displayedLearnedTerms}
          nextPhase={nextPhase}
          allComplete={allPhasesComplete}
          hasMore={learnedTerms.length > displayedLearnedTerms.length}
        />
      )}
    </div>
  );
}

function ProgressStat({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span>
        <span>{detail}</span>
      </div>
      <ProgressBar percent={percent} />
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700">
      <div className="h-2 rounded-full bg-foreground transition-all" style={{ width: `${clamped}%` }} />
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-background p-4 shadow-sm dark:border-slate-700">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function PhaseProgressList({ phases }: { phases: SessionPhaseProgress[] }) {
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-background p-4 shadow-sm dark:border-slate-700">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phase summary</span>
      <ul className="space-y-3">
        {phases.map((phase) => {
          const percent = phase.totalTerms > 0 ? Math.round((phase.completedTerms / phase.totalTerms) * 100) : 0;
          return (
            <li key={phase.index} className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{phase.name}</span>
                <span>
                  {phase.completedTerms}/{phase.totalTerms}
                </span>
              </div>
              <ProgressBar percent={percent} />
              {phase.remainingTerms.length > 0 && (
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  {phase.remainingTerms.map((term) => (
                    <span
                      key={`${phase.index}-${term}`}
                      className="rounded-full border border-slate-200 bg-muted/50 px-2 py-0.5 dark:border-slate-700"
                    >
                      {term}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LearnedTermsSection({
  learnedTerms,
  nextPhase,
  allComplete,
  hasMore,
}: {
  learnedTerms: string[];
  nextPhase: SessionPhaseProgress | null;
  allComplete: boolean;
  hasMore: boolean;
}) {
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-background p-4 shadow-sm dark:border-slate-700">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Learned terms</span>
      {learnedTerms.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {learnedTerms.map((term) => (
            <span
              key={`learned-${term}`}
              className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
            >
              {term}
            </span>
          ))}
          {hasMore && (
            <span className="rounded-full border border-slate-200 bg-muted/40 px-2 py-1 text-muted-foreground dark:border-slate-700">
              + more terms tracked
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Complete a turn to start tracking learned terms.</p>
      )}
      <div className="rounded-md border border-dashed border-slate-200 bg-muted/40 p-3 text-xs text-muted-foreground dark:border-slate-700">
        {allComplete ? (
          <span>All phases are complete. Reflect on your progress or spin up a new topic when ready.</span>
        ) : nextPhase ? (
          <span>
            Next focus: <span className="font-medium text-foreground">{nextPhase.name}</span>. {nextPhase.objective}
          </span>
        ) : (
          <span>Progress data is updating…</span>
        )}
      </div>
    </div>
  );
}


function SessionTranscriptPanel({
  sessionId,
  transcript,
}: {
  sessionId: Id<'learningSessions'>;
  transcript: SessionTranscriptData | undefined;
}) {
  const runSessionTurn = useAction(api.mistral.runSessionTurn);
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFollowUp, setSelectedFollowUp] = useState<Id<'sessionFollowUps'> | null>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);

  const isLoading = transcript === undefined;
  const messages = transcript?.messages ?? [];
  const latestAssistantMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate && candidate.role === 'assistant') {
        return candidate.id;
      }
    }
    return null;
  }, [messages]);
  const followUps = (transcript?.followUps ?? []).filter(
    (followUp) =>
      followUp.usedAt === null && (!latestAssistantMessageId || followUp.generatedForMessageId === latestAssistantMessageId)
  );

  useEffect(() => {
    if (!messageContainerRef.current) {
      return;
    }
    messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!selectedFollowUp) {
      return;
    }
    if (!followUps.some((item) => item.id === selectedFollowUp)) {
      setSelectedFollowUp(null);
    }
  }, [followUps, selectedFollowUp]);

  const sendTurn = useCallback(
    async (options?: { prompt?: string; followUpId?: Id<'sessionFollowUps'> }) => {
      const sourcePrompt = options?.prompt ?? draft;
      const trimmed = sourcePrompt.trim();
      if (trimmed.length === 0) {
        setError('Enter a message to continue the session.');
        return;
      }
      setDraft(sourcePrompt);
      setIsSubmitting(true);
      setError(null);
      try {
        await runSessionTurn({
          sessionId,
          prompt: trimmed,
          followUpId: options?.followUpId ?? selectedFollowUp ?? undefined,
        });
        setDraft('');
        setSelectedFollowUp(null);
      } catch (err) {
        console.error('Failed to run session turn', err);
        setError(normaliseSessionTurnError(err));
      } finally {
        setIsSubmitting(false);
      }
    },
    [draft, runSessionTurn, selectedFollowUp, sessionId]
  );

  const handleDraftChange = useCallback((value: string) => {
    setDraft(value);
    if (selectedFollowUp) {
      setSelectedFollowUp(null);
    }
  }, [selectedFollowUp]);

  const handleSelectFollowUp = useCallback(
    (followUp: SessionFollowUpSuggestion) => {
      if (isSubmitting) {
        return;
      }
      setSelectedFollowUp(followUp.id);
      setError(null);
      void sendTurn({ prompt: followUp.prompt, followUpId: followUp.id });
    },
    [isSubmitting, sendTurn]
  );

  return (
    <div className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-md border border-slate-200 bg-background shadow-sm dark:border-slate-700 xl:min-h-[620px]">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <h3 className="text-base font-semibold text-foreground">Session transcript</h3>
        {isLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>
      <div ref={messageContainerRef} className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <TranscriptSkeleton />
        ) : messages.length === 0 ? (
          <EmptyTranscriptState />
        ) : (
          <TranscriptMessageList messages={messages} />
        )}
      </div>
      <div className="space-y-3 border-t border-slate-200 px-6 py-4 dark:border-slate-700">
        <FollowUpSuggestions
          followUps={followUps}
          onSelect={handleSelectFollowUp}
          selectedId={selectedFollowUp}
          disabled={isSubmitting}
        />
        <SessionTurnComposer
          draft={draft}
          onDraftChange={handleDraftChange}
          onSubmit={sendTurn}
          isSubmitting={isSubmitting}
          error={error}
        />
      </div>
    </div>
  );
}

function TranscriptMessageList({ messages }: { messages: SessionTranscriptMessage[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {messages.map((message) => (
        <li
          key={message.id}
          className={`rounded-md border px-4 py-3 text-sm shadow-sm ${
            message.role === 'assistant'
              ? 'border-slate-200 bg-background text-foreground dark:border-slate-700'
              : 'border-slate-300 bg-muted/40 text-foreground dark:border-slate-600'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{message.role === 'assistant' ? 'Vibecoursing' : 'You'}</span>
            <span>{formatTimestamp(message.createdAt)}</span>
          </div>
          <TranscriptMessageBody body={message.body} />
          {message.termsCovered.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {message.termsCovered.map((term) => (
                <span key={`${message.id}-${term}`} className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                  {term}
                </span>
              ))}
            </div>
          )}
          {message.totalTokens !== null && (
            <div className="mt-2 text-xs text-muted-foreground">
              Tokens: prompt {message.promptTokens ?? 0}, completion {message.completionTokens ?? 0}, total {message.totalTokens}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function TranscriptMessageBody({ body }: { body: string }) {
  if (!body || body.trim().length === 0) {
    return null;
  }

  return (
    <ReactMarkdown
      className="mt-2 space-y-3 text-sm leading-6 text-foreground"
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
      linkTarget="_blank"
    >
      {body}
    </ReactMarkdown>
  );
}

function FollowUpSuggestions({
  followUps,
  onSelect,
  selectedId,
  disabled,
}: {
  followUps: SessionFollowUpSuggestion[];
  onSelect: (followUp: SessionFollowUpSuggestion) => void;
  selectedId: Id<'sessionFollowUps'> | null;
  disabled: boolean;
}) {
  if (followUps.length === 0) {
    return <p className="text-xs text-muted-foreground">Follow-up prompts will appear here once the assistant suggests them.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {followUps.map((followUp) => {
        const isSelected = followUp.id === selectedId;
        return (
          <button
            key={followUp.id}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs transition ${
              isSelected
                ? 'border-foreground bg-foreground text-background shadow-sm'
                : 'border-slate-200 bg-background text-muted-foreground hover:border-foreground hover:text-foreground dark:border-slate-700'
            }`}
            onClick={() => onSelect(followUp)}
            disabled={disabled}
            title={followUp.rationale ?? undefined}
          >
            {followUp.prompt}
          </button>
        );
      })}
    </div>
  );
}

function SessionTurnComposer({
  draft,
  onDraftChange,
  onSubmit,
  isSubmitting,
  error,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}) {
  const remaining = MAX_PROMPT_LENGTH - draft.length;
  const canSubmit = draft.trim().length > 0 && !isSubmitting;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit();
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      await onSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        maxLength={MAX_PROMPT_LENGTH}
        placeholder="Ask a question, reflect on a term, or request an example."
        className="w-full resize-y rounded-md border border-slate-200 bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-foreground focus:ring-0 dark:border-slate-700"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{remaining} characters left</span>
        <span>Press ⌘+Enter (or Ctrl+Enter) to send</span>
      </div>
      <div className="flex items-center justify-between">
        {error ? (
          <span className="text-xs text-red-500">{error}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Turns sync automatically to your learning plan.</span>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className={`rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60 ${
            isSubmitting ? 'cursor-progress' : ''
          }`}
        >
          {isSubmitting ? 'Sending…' : 'Send turn'}
        </button>
      </div>
    </form>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-20 rounded-md bg-slate-300/30 dark:bg-slate-700/40" />
      <div className="h-20 rounded-md bg-slate-300/30 dark:bg-slate-700/40" />
      <div className="h-20 rounded-md bg-slate-300/30 dark:bg-slate-700/40" />
    </div>
  );
}

function EmptyTranscriptState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <h4 className="text-sm font-medium">No messages yet</h4>
      <p className="max-w-sm text-xs">Kick off the session with a question or reflection. We will track progress against your plan.</p>
    </div>
  );
}

function SessionIntakeModal({
  open,
  onClose,
  onSessionCreated,
}: {
  open: boolean;
  onClose: () => void;
  onSessionCreated: (sessionId: Id<'learningSessions'>) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl">
        <SessionIntake onSessionCreated={onSessionCreated} onClose={onClose} />
      </div>
    </div>
  );
}

function SessionIntake({
  onSessionCreated,
  onClose,
}: {
  onSessionCreated: (sessionId: Id<'learningSessions'>) => void;
  onClose?: () => void;
}) {
  const generatePlan = useAction(api.mistral.generatePlan);
  const startSessionIntroduction = useAction(api.mistral.startSessionIntroduction);
  const createLearningSession = useMutation(api.chat.createLearningSession);

  const [topic, setTopic] = useState('');
  const [learnerProfile, setLearnerProfile] = useState('');
  const [tone, setTone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastPlan, setLastPlan] = useState<GeneratedPlan | null>(null);

  const canSubmit = topic.trim().length > 0 && !isSubmitting;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTopic = topic.trim();
    if (trimmedTopic.length === 0) {
      setError('Enter a topic to generate a learning plan.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    setLastPlan(null);

    try {
      const planResult = await generatePlan({
        topic: trimmedTopic,
        learnerProfile: learnerProfile.trim() || undefined,
        tone: tone.trim() || undefined,
      });

      const plan = normaliseGeneratedPlan(planResult.plan);
      const { sessionId } = await createLearningSession({ plan });

      await startSessionIntroduction({ sessionId });

      setLastPlan(plan);
      setSuccessMessage(`Created a new session for "${plan.topic}".`);
      setTopic('');
      setLearnerProfile('');
      setTone('');
      onSessionCreated(sessionId);
      if (onClose) {
        onClose();
      }
    } catch (err) {
      console.error('Session intake failed', err);
      setError(normaliseIntakeError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-md border border-slate-200 bg-background p-6 shadow-sm dark:border-slate-700">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          Close
        </button>
      )}
      {isSubmitting && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/85 px-6 text-center backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <span className="sr-only">Generating your learning session…</span>
            <div
              aria-hidden
              className="h-12 w-12 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground"
            />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Crafting your learning session…</p>
              <p className="text-xs text-muted-foreground">
                We are drafting your tailored plan, saving it, and preparing an introduction.
              </p>
            </div>
          </div>
          <ol className="w-full max-w-sm space-y-2 text-left text-xs text-muted-foreground">
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]" />
              <span>Generating phases and learning objectives</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.15)]" />
              <span>Saving the session to your workspace</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-purple-500 shadow-[0_0_0_4px_rgba(168,85,247,0.15)]" />
              <span>Preparing the assistant’s introduction</span>
            </li>
          </ol>
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">Start a new learning session</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Share a topic (and optional learner context). Vibecoursing will draft phases and key terms, then store the plan in Convex.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4" aria-busy={isSubmitting} aria-live="polite">
        <div className="flex flex-col gap-2">
          <label htmlFor="session-topic" className="text-sm font-medium text-foreground">
            Topic
          </label>
          <input
            id="session-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="e.g. Storytelling fundamentals for product demos"
            className="w-full rounded-md border border-slate-200 bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-foreground focus:ring-0 dark:border-slate-700"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="session-learner" className="text-sm font-medium text-foreground">
            Learner context (optional)
          </label>
          <textarea
            id="session-learner"
            value={learnerProfile}
            onChange={(event) => setLearnerProfile(event.target.value)}
            rows={3}
            placeholder="Who is this for? Prior knowledge, constraints, desired outcomes."
            className="w-full resize-y rounded-md border border-slate-200 bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-foreground focus:ring-0 dark:border-slate-700"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="session-tone" className="text-sm font-medium text-foreground">
            Preferred tone (optional)
          </label>
          <input
            id="session-tone"
            value={tone}
            onChange={(event) => setTone(event.target.value)}
            placeholder="Encouraging, pragmatic, playful..."
            className="w-full rounded-md border border-slate-200 bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-foreground focus:ring-0 dark:border-slate-700"
          />
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <span className="text-xs text-muted-foreground">Plans save instantly so you can jump into a session right away.</span>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60 ${
              isSubmitting ? 'cursor-progress' : ''
            }`}
          >
            {isSubmitting ? 'Generating…' : 'Generate plan'}
          </button>
        </div>
        {error && (
          <p className="text-xs text-red-500" role="alert" aria-live="assertive">
            {error}
          </p>
        )}
        {successMessage && (
          <p className="text-xs text-emerald-600" role="status" aria-live="polite">
            {successMessage}
          </p>
        )}
      </form>
      {lastPlan && <PlanPreview plan={lastPlan} />}
    </div>
  );
}

function PlanPreview({ plan }: { plan: GeneratedPlan }) {
  return (
    <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-muted/30 p-4 text-sm text-foreground shadow-sm dark:border-slate-700/70">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan saved</span>
      <h4 className="mt-2 text-base font-semibold text-foreground">{plan.topic}</h4>
      {plan.summary && <p className="text-sm text-muted-foreground">{plan.summary}</p>}
      <ol className="mt-3 space-y-3">
        {plan.phases.map((phase, index) => (
          <li key={`${phase.name}-${index}`} className="rounded-md border border-slate-200 bg-background p-3 shadow-sm dark:border-slate-700">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Phase {index + 1}</span>
              <span>{phase.name}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{phase.objective}</p>
            <div className="mt-2 text-xs text-muted-foreground">
              Key terms:{' '}
              <span className="font-medium text-foreground">{phase.keyTerms.join(', ')}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SessionMainSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-8">
      <div className="h-9 w-3/4 rounded bg-slate-300/30 dark:bg-slate-700/40" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-24 rounded bg-slate-300/30 dark:bg-slate-700/40" />
        <div className="h-24 rounded bg-slate-300/30 dark:bg-slate-700/40" />
        <div className="h-24 rounded bg-slate-300/30 dark:bg-slate-700/40" />
        <div className="h-24 rounded bg-slate-300/30 dark:bg-slate-700/40" />
      </div>
      <div className="flex-1 rounded bg-slate-300/30 dark:bg-slate-700/40" />
    </div>
  );
}

function UnauthenticatedState() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <h1 className="text-3xl font-bold">Learning sessions workspace</h1>
      <p className="max-w-sm text-sm text-muted-foreground">Log in with WorkOS to explore the guided learning companion.</p>
      <div className="flex flex-col gap-3">
        <a href="/sign-in">
          <button className="w-56 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">Sign in</button>
        </a>
        <a href="/sign-up">
          <button className="w-56 rounded-md border border-foreground px-4 py-2 text-sm font-medium text-foreground">
            Sign up
          </button>
        </a>
      </div>
    </div>
  );
}

function UserMenu({ user, onSignOut }: { user: AuthLikeUser; onSignOut: () => void }) {
  const derivedProfile = useMemo(() => deriveProfileFields(user), [user]);
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">{derivedProfile.email ?? 'Unknown user'}</span>
      <button onClick={onSignOut} className="rounded-md bg-red-500 px-3 py-1 text-sm font-medium text-white hover:bg-red-600">
        Sign out
      </button>
    </div>
  );
}

function normaliseGeneratedPlan(plan: unknown): GeneratedPlan {
  if (typeof plan !== 'object' || plan === null) {
    throw new PlanValidationError('plan.invalid', 'The generated plan was invalid. Please try again.');
  }

  const raw = plan as Record<string, unknown>;
  const topic = typeof raw.topic === 'string' ? raw.topic.trim() : '';
  if (!topic) {
    throw new PlanValidationError('plan.topic_missing', 'The generated plan did not include a topic.');
  }

  const phasesInput = Array.isArray(raw.phases) ? raw.phases : [];
  const phases: GeneratedPlanPhase[] = [];

  for (const candidate of phasesInput) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }
    const phaseRaw = candidate as Record<string, unknown>;
    const name = typeof phaseRaw.name === 'string' ? phaseRaw.name.trim() : '';
    const objective = typeof phaseRaw.objective === 'string' ? phaseRaw.objective.trim() : '';
    const keyTermsRaw = Array.isArray(phaseRaw.keyTerms) ? phaseRaw.keyTerms : [];
    const keyTerms = keyTermsRaw
      .map((term) => (typeof term === 'string' ? term.trim() : ''))
      .filter((term): term is string => term.length > 0);

    const uniqueTerms = Array.from(new Set(keyTerms));

    if (!name || !objective || uniqueTerms.length === 0) {
      continue;
    }

    phases.push({ name, objective, keyTerms: uniqueTerms });
  }

  if (phases.length === 0) {
    throw new PlanValidationError('plan.phases_missing', 'The generated plan did not contain any usable phases.');
  }

  const tone = typeof raw.tone === 'string' ? raw.tone.trim() : undefined;
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : undefined;

  return {
    topic,
    tone: tone && tone.length > 0 ? tone : undefined,
    summary: summary && summary.length > 0 ? summary : undefined,
    phases,
  };
}

function normaliseIntakeError(error: unknown): string {
  if (error instanceof PlanValidationError) {
    return error.message;
  }
  if (error instanceof Error) {
    const message = error.message ?? '';
    if (message.includes('MISTRAL_PLAN_PARSE_FAILED')) {
      return 'Mistral returned an invalid plan. Please try again.';
    }
    if (message.includes('MISTRAL_REQUEST_FAILED')) {
      return 'We could not reach Mistral. Try again in a moment.';
    }
    if (message.includes('MISTRAL_API_KEY_NOT_CONFIGURED')) {
      return 'Mistral API key is not configured on the server.';
    }
    if (message.includes('PLAN_TOPIC_REQUIRED')) {
      return 'The generated plan was missing a topic. Try rephrasing your prompt.';
    }
    if (message.includes('PLAN_PHASES_REQUIRED')) {
      return 'The generated plan did not include any phases. Please try again.';
    }
    if (message.includes('PLAN_PHASE_TERMS_REQUIRED')) {
      return 'At least one phase was missing key terms. Regenerate the plan to continue.';
    }
  }
  return 'Something went wrong while creating the session. Please try again.';
}

function normaliseSessionTurnError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message ?? '';
    if (message.includes('EMPTY_MESSAGE')) {
      return 'Message cannot be empty.';
    }
    if (message.includes('MISTRAL_REQUEST_FAILED')) {
      return 'The assistant could not respond. Try again in a moment.';
    }
    if (message.includes('MISTRAL_API_KEY_NOT_CONFIGURED')) {
      return 'Mistral API key is not configured on the server.';
    }
    if (message.includes('SESSION_NOT_FOUND')) {
      return 'Could not find that session. Refresh and try again.';
    }
  }
  return 'Failed to send the turn. Please try again.';
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
