'use client';

import { Authenticated, Unauthenticated, useAction, useMutation, useQuery } from 'convex/react';
import AuthPage from '@/app/auth/page';
import { api } from '@/convex/_generated/api';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type { Components as ReactMarkdownComponents, ExtraProps } from 'react-markdown';
import type { Id } from '@/convex/_generated/dataModel';

type MarkdownCodeProps = ComponentPropsWithoutRef<'code'> & ExtraProps & {
  inline?: boolean;
};

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

const omitClassName = <T extends { className?: string }>(props: T) => {
  const { className, ...rest } = props;
  void className;
  return rest;
};

const markdownComponents: ReactMarkdownComponents = {
  p: ({ children, ...props }) => (
    <p
      {...omitClassName(props)}
      className="text-sm leading-6 text-foreground [&:not(:first-child)]:mt-3"
    >
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <strong {...omitClassName(props)} className="font-semibold text-foreground">
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em {...omitClassName(props)} className="italic text-foreground">
      {children}
    </em>
  ),
  ul: ({ children, ...props }) => (
    <ul
      {...omitClassName(props)}
      className="ml-5 list-disc space-y-1 text-sm leading-6 text-foreground"
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      {...omitClassName(props)}
      className="ml-5 list-decimal space-y-1 text-sm leading-6 text-foreground"
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li
      {...omitClassName(props)}
      className="text-sm leading-6 text-foreground marker:text-muted-foreground"
    >
      {children}
    </li>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      {...omitClassName(props)}
      className="border-l-2 border-slate-300 pl-3 text-sm italic text-muted-foreground dark:border-slate-700"
    >
      {children}
    </blockquote>
  ),
  a: ({ children, href, ...props }) => (
    <a
      {...omitClassName(props)}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
    >
      {children}
    </a>
  ),
  hr: (props) => (
    <hr {...omitClassName(props)} className="my-4 border-slate-200 dark:border-slate-700" />
  ),
  code: ({ inline, className, children, ...props }: MarkdownCodeProps) => {
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
        {...omitClassName(props)}
        className="w-full table-auto text-left text-sm text-foreground"
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th
      {...omitClassName(props)}
      className="border-b border-slate-200 px-3 py-2 text-left font-semibold dark:border-slate-700"
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      {...omitClassName(props)}
      className="border-b border-slate-200 px-3 py-2 align-top dark:border-slate-700"
    >
      {children}
    </td>
  ),
};

const followUpMarkdownComponents: ReactMarkdownComponents = {
  p: ({ children, ...props }) => (
    <span {...omitClassName(props)} className="inline text-xs font-semibold leading-snug">
      {children}
    </span>
  ),
  strong: ({ children, ...props }) => (
    <strong {...omitClassName(props)} className="font-semibold">
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em {...omitClassName(props)} className="italic">
      {children}
    </em>
  ),
  code: ({ children, ...props }) => (
    <code {...omitClassName(props)} className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
      {children}
    </code>
  ),
  ul: ({ children, ...props }) => (
    <span {...omitClassName(props)} className="inline">
      {children}
    </span>
  ),
  ol: ({ children, ...props }) => (
    <span {...omitClassName(props)} className="inline">
      {children}
    </span>
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
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobileCourseOpen, setIsMobileCourseOpen] = useState(false);

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
  const hasSessions = sessions?.length ? sessions.length > 0 : false;

  const openMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(true);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(false);
  }, []);

  const openMobileCourse = useCallback(() => {
    setIsMobileCourseOpen(true);
  }, []);

  const closeMobileCourse = useCallback(() => {
    setIsMobileCourseOpen(false);
  }, []);

  const handleSelectSession = useCallback(
    (sessionId: Id<'learningSessions'>) => {
      setActiveSessionId((current) => (current === sessionId ? current : sessionId));
      closeMobileSidebar();
    },
    [closeMobileSidebar]
  );

  const handleSessionCreated = useCallback(
    (sessionId: Id<'learningSessions'>) => {
      setActiveSessionId(sessionId);
      setIsIntakeOpen(false);
      closeMobileSidebar();
      closeMobileCourse();
    },
    [closeMobileCourse, closeMobileSidebar]
  );

  const openIntake = useCallback(() => {
    setIsIntakeOpen(true);
    closeMobileSidebar();
  }, [closeMobileSidebar]);

  const closeIntake = useCallback(() => {
    setIsIntakeOpen(false);
  }, []);

  const handleSignOut = useCallback(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const returnTo = origin ? `${origin}/auth?mode=signin` : '/auth?mode=signin';
    void signOut({ returnTo });
  }, [signOut]);

  if (bootstrap === undefined || sessions === undefined) {
    return (
      <WorkspaceShell
        sidebar={<SessionSidebarSkeleton />}
        main={<SessionMainSkeleton />}
        course={<CourseDashboardSkeleton user={user} onSignOut={handleSignOut} />}
        onOpenSidebar={openMobileSidebar}
        onOpenCourse={openMobileCourse}
        onCloseSidebar={closeMobileSidebar}
        onCloseCourse={closeMobileCourse}
        isSidebarOpen={isMobileSidebarOpen}
        isCourseOpen={isMobileCourseOpen}
      />
    );
  }

  const sidebarContent = (
    <SessionSidebar
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSelectSession={handleSelectSession}
      onStartNewSession={openIntake}
    />
  );

  let mainContent: ReactNode;
  let courseContent: ReactNode;

  if (!hasSessions) {
    mainContent = <NoSessionsView viewer={viewer} onSessionCreated={handleSessionCreated} />;
    courseContent = <CourseDashboardEmpty user={user} onSignOut={handleSignOut} />;
  } else if (!activeSession) {
    mainContent = <MissingSelectionView onStartNewSession={openIntake} />;
    courseContent = <CourseDashboardPlaceholder user={user} onSignOut={handleSignOut} />;
  } else {
    mainContent = (
      <SessionExperience
        session={activeSession}
        transcript={transcript}
        onStartNewSession={openIntake}
      />
    );
    courseContent = (
      <CourseDashboardPanel
        user={user}
        onSignOut={handleSignOut}
        session={activeSession}
        transcript={transcript}
      />
    );
  }

  return (
    <>
      <WorkspaceShell
        sidebar={sidebarContent}
        main={mainContent}
        course={courseContent}
        onOpenSidebar={openMobileSidebar}
        onOpenCourse={openMobileCourse}
        onCloseSidebar={closeMobileSidebar}
        onCloseCourse={closeMobileCourse}
        isSidebarOpen={isMobileSidebarOpen}
        isCourseOpen={isMobileCourseOpen}
      />
      <SessionIntakeModal
        open={isIntakeOpen}
        onClose={closeIntake}
        onSessionCreated={handleSessionCreated}
      />
    </>
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
    <div className="flex h-full flex-col text-sidebar-foreground">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Vibecoursing</h1>
        <p className="mt-1 text-xs text-muted-foreground">Learning companion</p>
      </div>
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <span>Sessions</span>
        <button
          type="button"
          onClick={onStartNewSession}
          className="rounded-md border border-sidebar bg-sidebar-accent px-3 py-1 text-[11px] font-medium text-sidebar-foreground shadow-sm transition hover:border-sidebar-ring hover:bg-sidebar-accent/80"
        >
          New
        </button>
      </div>
      <nav className="mt-4 flex-1 overflow-y-auto pr-1">
        {sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-sidebar bg-sidebar/60 px-3 py-4 text-sm text-muted-foreground">
            No sessions yet—start with a new topic to draft your first plan.
          </div>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const progress = session.totalTerms > 0 ? Math.round((session.completedTerms / session.totalTerms) * 100) : 0;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`group w-full rounded-xl border px-4 py-3 text-left shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring ${
                      isActive
                        ? 'border-sidebar-ring bg-sidebar-accent'
                        : 'border-transparent bg-card hover:border-sidebar-ring/40 hover:bg-sidebar-accent/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className={`font-medium leading-snug ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {session.topic}
                      </span>
                      <span className="text-[10px] font-semibold uppercase text-muted-foreground">{progress}%</span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar percent={progress} className="h-1.5" />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Updated {new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      <div className="mt-6 rounded-lg border border-dashed border-sidebar px-3 py-3 text-xs text-muted-foreground">
        Learning sessions capture your transcript, phases, and tracked terms.
      </div>
    </div>
  );
}

function SessionSidebarSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="h-6 w-40 rounded bg-muted/60" />
      <div className="h-4 w-20 rounded bg-muted/60" />
      <div className="flex flex-col gap-3">
        <div className="h-20 w-full rounded-xl bg-muted/50" />
        <div className="h-20 w-full rounded-xl bg-muted/50" />
        <div className="h-20 w-full rounded-xl bg-muted/50" />
      </div>
      <div className="mt-auto h-16 w-full rounded-lg border border-dashed border-muted" />
    </div>
  );
}

function NoSessionsView({
  viewer,
  onSessionCreated,
}: {
  viewer: ViewerSummary;
  onSessionCreated: (sessionId: Id<'learningSessions'>) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-8 py-10">
        <EmptySessionState viewer={viewer} />
        <SessionIntake onSessionCreated={onSessionCreated} />
      </div>
    </div>
  );
}

function MissingSelectionView({ onStartNewSession }: { onStartNewSession: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background px-8 py-10 text-center">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <MissingSessionSelectionState />
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-6 text-sm text-muted-foreground">
          <p>Select a session in the sidebar or start a new one to begin learning.</p>
          <button
            type="button"
            onClick={onStartNewSession}
            className="mt-4 inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition hover:border-primary hover:text-primary"
          >
            Start a new session
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionExperience({
  session,
  transcript,
  onStartNewSession,
}: {
  session: SessionSummary;
  transcript: SessionTranscriptData | undefined;
  onStartNewSession: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-hidden">
        <SessionTranscriptPanel
          session={session}
          transcript={transcript}
          onStartNewSession={onStartNewSession}
        />
      </div>
    </div>
  );
}

function EmptySessionState({ viewer }: { viewer: ViewerSummary }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center shadow-sm">
      <h2 className="text-xl font-semibold text-foreground">Welcome{viewer?.name ? `, ${viewer.name}` : ''}!</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
        Use the intake form below to craft your first guided learning session. Vibecoursing will transform a topic into phases and key terms to track.
      </p>
    </div>
  );
}

function MissingSessionSelectionState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-8 text-center text-muted-foreground shadow-sm">
      <h3 className="text-base font-semibold text-foreground">Select a session to view its progress</h3>
      <p className="mx-auto mt-3 max-w-sm text-sm">
        Pick any session from the sidebar or use the New button to draft a fresh learning topic.
      </p>
    </div>
  );
}

function CourseDashboardContent({
  session,
  phaseProgress,
  variant = 'sidebar',
}: {
  session: SessionSummary;
  phaseProgress?: SessionPhaseProgress[];
  variant?: 'sidebar' | 'compact';
}) {
  const phasePercent = session.totalPhases > 0 ? Math.round((session.completedPhases / session.totalPhases) * 100) : 0;
  const termPercent = session.totalTerms > 0 ? Math.round((session.completedTerms / session.totalTerms) * 100) : 0;
  const nextPhase = phaseProgress?.find((phase) => !phase.isComplete) ?? null;
  const allPhasesComplete = phaseProgress ? phaseProgress.every((phase) => phase.isComplete) : false;
  const learnedTerms = phaseProgress ? Array.from(new Set(phaseProgress.flatMap((phase) => phase.coveredTerms))) : [];
  const displayedLearnedTerms = learnedTerms.slice(0, variant === 'sidebar' ? 18 : 12);
  const focusTerms = nextPhase ? nextPhase.remainingTerms.slice(0, 6) : [];

  const containerClasses = variant === 'compact' ? 'space-y-5' : 'space-y-6';
  const titleClasses = variant === 'compact' ? 'text-lg font-semibold' : 'text-xl font-bold';

  return (
    <div className={containerClasses}>
      <div>
        <h2 className={`${titleClasses} leading-tight text-foreground`}>{session.topic}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {session.currentPhaseIndex !== null
            ? `Currently in phase ${session.currentPhaseIndex + 1} of ${session.totalPhases}`
            : 'Phase status pending'}
        </p>
      </div>
      <div className="space-y-4">
        <ProgressStat
          label="Overall progress"
          percent={phasePercent}
          detail={`${session.completedPhases}/${session.totalPhases}`}
        />
        <ProgressStat
          label="Key terms covered"
          percent={termPercent}
          detail={`${session.completedTerms}/${session.totalTerms}`}
        />
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div>Created: {new Date(session.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
        <div>Last updated: {new Date(session.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
      </div>
      {phaseProgress && phaseProgress.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold tracking-wider text-muted-foreground">Pulse summary</h3>
          <PhaseProgressList phases={phaseProgress} />
        </div>
      )}
      {phaseProgress && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold tracking-wider text-muted-foreground">Legend terms</h3>
          <LegendTermsSection
            focusTerms={focusTerms}
            learnedTerms={displayedLearnedTerms}
            nextPhase={nextPhase}
            allComplete={allPhasesComplete}
            hasMoreLearned={learnedTerms.length > displayedLearnedTerms.length}
          />
        </div>
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
        <span className="font-semibold tracking-wider uppercase text-muted-foreground">{label}</span>
        <span className="text-xs font-medium text-foreground">{detail}</span>
      </div>
      <ProgressBar percent={percent} className="h-2" />
    </div>
  );
}

function ProgressBar({ percent, className = 'h-2' }: { percent: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={`w-full overflow-hidden rounded-full bg-muted ${className}`}>
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${clamped}%` }} />
    </div>
  );
}

function PhaseProgressList({ phases }: { phases: SessionPhaseProgress[] }) {
  return (
    <ul className="space-y-3">
      {phases.map((phase) => {
        const percent = phase.totalTerms > 0 ? Math.round((phase.completedTerms / phase.totalTerms) * 100) : 0;
        const remaining = phase.remainingTerms.slice(0, 5);
        const hasMoreRemaining = phase.remainingTerms.length > remaining.length;
        return (
          <li key={phase.index} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-medium leading-tight text-foreground">{phase.name}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {phase.completedTerms}/{phase.totalTerms}
              </span>
            </div>
            <ProgressBar percent={percent} className="h-1.5" />
            {remaining.length > 0 && (
              <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                {remaining.map((term) => (
                  <span key={`${phase.index}-${term}`} className="rounded-full border border-border px-2 py-0.5">
                    {term}
                  </span>
                ))}
                {hasMoreRemaining && (
                  <span className="rounded-full border border-dashed border-border px-2 py-0.5">+ more</span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LegendTermsSection({
  focusTerms,
  learnedTerms,
  nextPhase,
  allComplete,
  hasMoreLearned,
}: {
  focusTerms: string[];
  learnedTerms: string[];
  nextPhase: SessionPhaseProgress | null;
  allComplete: boolean;
  hasMoreLearned: boolean;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card px-4 py-4 shadow-sm">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-primary">Your focus</div>
        {focusTerms.length > 0 ? (
          <ul className="mt-2 space-y-2 text-sm text-foreground">
            {focusTerms.map((term) => (
              <li key={term} className="flex items-start gap-2">
                <span className="mt-1 text-muted-foreground">•</span>
                <span>{term}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Focus updates after the assistant introduces the next phase.</p>
        )}
      </div>
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Learned terms</span>
        {learnedTerms.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-primary">
            {learnedTerms.map((term) => (
              <span key={`learned-${term}`} className="rounded-full bg-primary/10 px-2 py-1">
                {term}
              </span>
            ))}
            {hasMoreLearned && (
              <span className="rounded-full border border-dashed border-border px-2 py-1 text-muted-foreground">
                + more terms tracked
              </span>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Complete a turn to start tracking learned terms.</p>
        )}
      </div>
      <div className="rounded-md border border-dashed border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
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

function CourseDashboardShell({
  user,
  onSignOut,
  children,
}: {
  user: AuthLikeUser | null | undefined;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const profile = deriveProfileFields(user);
  const displayName = profile.name ?? profile.email ?? 'Learner';

  return (
    <div className="flex h-full flex-col bg-card text-foreground">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <span className="text-sm font-semibold leading-tight">{displayName}</span>
          {profile.email && <span className="text-xs text-muted-foreground">{profile.email}</span>}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary"
        >
          Sign out
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
      <div className="h-4 gradient-stripe" />
    </div>
  );
}

function CourseDashboardPanel({
  user,
  onSignOut,
  session,
  transcript,
}: {
  user: AuthLikeUser | null | undefined;
  onSignOut: () => void;
  session: SessionSummary;
  transcript: SessionTranscriptData | undefined;
}) {
  return (
    <CourseDashboardShell user={user} onSignOut={onSignOut}>
      <CourseDashboardContent session={session} phaseProgress={transcript?.phaseProgress} />
    </CourseDashboardShell>
  );
}

function CourseDashboardEmpty({
  user,
  onSignOut,
}: {
  user: AuthLikeUser | null | undefined;
  onSignOut: () => void;
}) {
  return (
    <CourseDashboardShell user={user} onSignOut={onSignOut}>
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>No sessions yet. Draft a learning topic to unlock your personalised pulse and legend tracker.</p>
        <p className="text-xs">Once a session is created, Vibecoursing will surface your plan, phases, and tracked terms here.</p>
      </div>
    </CourseDashboardShell>
  );
}

function CourseDashboardPlaceholder({
  user,
  onSignOut,
}: {
  user: AuthLikeUser | null | undefined;
  onSignOut: () => void;
}) {
  return (
    <CourseDashboardShell user={user} onSignOut={onSignOut}>
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>Select a session from the sidebar to review its phases and tracked terms.</p>
        <p className="text-xs">Need a fresh topic? Use the New button in the session list to spin up another plan.</p>
      </div>
    </CourseDashboardShell>
  );
}

function CourseDashboardSkeleton({}: { user: AuthLikeUser | null | undefined; onSignOut: () => void }) {
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="h-5 w-32 rounded bg-muted/60" />
        <div className="h-7 w-20 rounded bg-muted/60" />
      </div>
      <div className="flex-1 space-y-4 overflow-hidden px-6 py-6">
        <div className="h-6 w-3/4 rounded bg-muted/60" />
        <div className="space-y-3">
          <div className="h-4 w-32 rounded bg-muted/50" />
          <div className="h-4 w-full rounded bg-muted/40" />
          <div className="h-4 w-full rounded bg-muted/40" />
        </div>
        <div className="space-y-3">
          <div className="h-20 rounded-lg bg-muted/40" />
          <div className="h-20 rounded-lg bg-muted/40" />
        </div>
      </div>
      <div className="h-4 gradient-stripe" />
    </div>
  );
}

function WorkspaceShell({
  sidebar,
  main,
  course,
  onOpenSidebar,
  onOpenCourse,
  onCloseSidebar,
  onCloseCourse,
  isSidebarOpen,
  isCourseOpen,
}: {
  sidebar: ReactNode;
  main: ReactNode;
  course: ReactNode;
  onOpenSidebar: () => void;
  onOpenCourse: () => void;
  onCloseSidebar: () => void;
  onCloseCourse: () => void;
  isSidebarOpen: boolean;
  isCourseOpen: boolean;
}) {
  return (
    <div className="flex h-[100svh] w-full flex-col overflow-hidden bg-background text-foreground md:flex-row">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:border-primary hover:text-primary"
        >
          Sessions
        </button>
        <span className="text-sm font-semibold text-foreground">Vibecoursing</span>
        <button
          type="button"
          onClick={onOpenCourse}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:border-primary hover:text-primary"
        >
          Progress
        </button>
      </header>
      <div className="flex h-full flex-1 overflow-hidden">
        <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-sidebar bg-sidebar text-sidebar-foreground md:flex">
          <div className="flex h-full flex-col overflow-hidden px-6 py-6">{sidebar}</div>
        </aside>
        <main className="flex h-full flex-1 flex-col overflow-hidden bg-background">{main}</main>
        <aside className="hidden h-full w-80 shrink-0 flex-col border-l border-border bg-card xl:flex">
          {course}
        </aside>
      </div>
      <MobileOverlayPanel open={isSidebarOpen} onClose={onCloseSidebar} title="Sessions" side="left">
        <div className="flex h-full flex-col px-2">
          <div className="flex h-full flex-col rounded-2xl border border-transparent bg-sidebar px-4 py-5 text-sidebar-foreground shadow-lg">
            {sidebar}
          </div>
        </div>
      </MobileOverlayPanel>
      <MobileOverlayPanel open={isCourseOpen} onClose={onCloseCourse} title="Progress" side="right">
        <div className="flex h-full flex-col">{course}</div>
      </MobileOverlayPanel>
    </div>
  );
}

function MobileOverlayPanel({
  open,
  onClose,
  title,
  children,
  side = 'left',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  side?: 'left' | 'right';
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        className={`relative z-10 flex h-full w-full max-w-md flex-col bg-background shadow-2xl ${
          side === 'right' ? 'ml-auto' : 'mr-auto'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}


function SessionTranscriptPanel({
  session,
  transcript,
  onStartNewSession,
}: {
  session: SessionSummary;
  transcript: SessionTranscriptData | undefined;
  onStartNewSession: () => void;
}) {
  const sessionId = session.id;
  const refreshSessionFollowUps = useAction(api.mistral.refreshSessionFollowUps);
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFollowUp, setSelectedFollowUp] = useState<Id<'sessionFollowUps'> | null>(null);
  const [streamingAssistant, setStreamingAssistant] = useState<string | null>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const lastFollowUpRefreshMessageId = useRef<Id<'sessionMessages'> | null>(null);
  const streamingBufferRef = useRef('');
  const streamingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamingActiveRef = useRef(false);

  const isLoading = transcript === undefined;
  const rawMessages = transcript?.messages;
  const messages = useMemo(() => rawMessages ?? [], [rawMessages]);
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
  }, [messages.length, streamingAssistant]);

  useEffect(() => {
    if (!latestAssistantMessageId) {
      lastFollowUpRefreshMessageId.current = null;
      return;
    }
    if (followUps.length > 0) {
      lastFollowUpRefreshMessageId.current = latestAssistantMessageId;
      return;
    }
    if (lastFollowUpRefreshMessageId.current === latestAssistantMessageId) {
      return;
    }
    lastFollowUpRefreshMessageId.current = latestAssistantMessageId;
    void refreshSessionFollowUps({
      sessionId,
      assistantMessageId: latestAssistantMessageId,
    }).catch((err) => {
      console.error('Failed to refresh follow-up prompts', err);
      lastFollowUpRefreshMessageId.current = null;
    });
  }, [followUps.length, latestAssistantMessageId, refreshSessionFollowUps, sessionId]);

  useEffect(() => {
    if (!selectedFollowUp) {
      return;
    }
    if (!followUps.some((item) => item.id === selectedFollowUp)) {
      setSelectedFollowUp(null);
    }
  }, [followUps, selectedFollowUp]);

  type StreamEvent =
    | { type: 'prepared'; payload?: { userMessage: { id: string; body: string; createdAt: number } } }
    | { type: 'delta'; token: string }
    | { type: 'final'; result: unknown }
    | { type: 'error'; message: string };

  const stopStreamingTimer = useCallback(() => {
    if (streamingTimerRef.current !== null) {
      clearInterval(streamingTimerRef.current);
      streamingTimerRef.current = null;
    }
  }, []);

  const flushStreamingBuffer = useCallback(() => {
    const CHARS_PER_TICK = 8;
    const queue = streamingBufferRef.current;

    if (queue.length === 0) {
      if (!streamingActiveRef.current) {
        stopStreamingTimer();
        setStreamingAssistant(null);
      }
      return;
    }

    const chunkLength = Math.min(CHARS_PER_TICK, queue.length);
    const chunk = queue.slice(0, chunkLength);
    streamingBufferRef.current = queue.slice(chunkLength);
    setStreamingAssistant((prev) => (prev ?? '') + chunk);
  }, [stopStreamingTimer]);

  const ensureStreamingTimer = useCallback(() => {
    if (streamingTimerRef.current !== null) {
      return;
    }
    streamingTimerRef.current = window.setInterval(flushStreamingBuffer, 60);
  }, [flushStreamingBuffer]);

  useEffect(() => {
    return () => {
      stopStreamingTimer();
    };
  }, [stopStreamingTimer]);

  const sendTurn = useCallback(
    async (options?: { prompt?: string; followUpId?: Id<'sessionFollowUps'> }) => {
      const sourcePrompt = options?.prompt ?? draft;
      const trimmed = sourcePrompt.trim();
      if (trimmed.length === 0) {
        setError('Enter a message to continue the session.');
        return;
      }

      setIsSubmitting(true);
      setError(null);

      const payload = {
        sessionId,
        prompt: trimmed,
        followUpId: options?.followUpId ?? selectedFollowUp ?? undefined,
      };

      try {
        setDraft('');
        streamingActiveRef.current = true;
        streamingBufferRef.current = '';
        setStreamingAssistant('');
        ensureStreamingTimer();

      const response = await fetch('/api/mistral/session-turn/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok || !response.body) {
          const errorText = await response.text();
          throw new Error(errorText || 'Failed to start the streaming response.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamError: string | null = null;
        let sawFinal = false;

        const applyEvent = (event: StreamEvent) => {
          switch (event.type) {
            case 'delta':
              streamingBufferRef.current += event.token;
              ensureStreamingTimer();
              flushStreamingBuffer();
              break;
            case 'error':
              streamError = event.message;
              setError(event.message);
              streamingActiveRef.current = false;
              streamingBufferRef.current = '';
              setStreamingAssistant(null);
              break;
            case 'final':
              sawFinal = true;
              streamingActiveRef.current = false;
              if (event.result && typeof event.result === 'object') {
                const maybeAssistant = (event.result as { assistantMessage?: { body?: string } }).assistantMessage?.body;
                if (typeof maybeAssistant === 'string') {
                  setStreamingAssistant(maybeAssistant);
                }
              }
              flushStreamingBuffer();
              setSelectedFollowUp(null);
              break;
            default:
              break;
          }
        };

        const processBufferedEvents = () => {
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            const dataLine = rawEvent
              .split('\n')
              .find((line) => line.startsWith('data: '));

            if (dataLine) {
              const jsonPayload = dataLine.slice(6);
              if (jsonPayload) {
                try {
                  const parsed = JSON.parse(jsonPayload) as StreamEvent;
                  applyEvent(parsed);
                  if (parsed.type === 'error') {
                    return false;
                  }
                } catch (parseError) {
                  console.error('Failed to parse streaming event', parseError);
                }
              }
            }

            boundary = buffer.indexOf('\n\n');
          }
          return true;
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          const shouldContinue = processBufferedEvents();
          if (!shouldContinue || streamError) {
            await reader.cancel();
            break;
          }
        }

        if (buffer.length > 0) {
          processBufferedEvents();
        }

        if (streamError) {
          throw new Error(streamError);
        }

        if (!sawFinal) {
          throw new Error('Streaming ended before completion.');
        }
      } catch (err) {
        console.error('Failed to stream session turn', err);
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Something went wrong while generating a response.';
        setError(message);
        setDraft(sourcePrompt);
        streamingActiveRef.current = false;
        streamingBufferRef.current = '';
        setStreamingAssistant(null);
      } finally {
        if (!streamingActiveRef.current && streamingBufferRef.current.length === 0) {
          stopStreamingTimer();
        }
        setIsSubmitting(false);
      }
    },
    [draft, ensureStreamingTimer, flushStreamingBuffer, selectedFollowUp, sessionId, stopStreamingTimer]
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
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 md:gap-4 md:px-5">
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Session transcript
          </span>
          <h3 className="text-lg font-semibold leading-tight text-foreground">{session.topic}</h3>
          <p className="text-sm text-muted-foreground">
            {session.currentPhaseIndex !== null
              ? `Phase ${session.currentPhaseIndex + 1} of ${session.totalPhases}`
              : 'Phase status pending'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
          <button
            type="button"
            onClick={onStartNewSession}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary"
          >
            New session
          </button>
        </div>
      </div>
      <div ref={messageContainerRef} className="flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-4">
        {isLoading ? (
          <TranscriptSkeleton />
        ) : messages.length === 0 ? (
          <EmptyTranscriptState />
        ) : (
          <TranscriptMessageList messages={messages} streamingAssistant={streamingAssistant} />
        )}
      </div>
      <div className="space-y-3 border-t border-border bg-background px-3 py-3 md:px-4 md:py-4">
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

function TranscriptMessageList({
  messages,
  streamingAssistant,
}: {
  messages: SessionTranscriptMessage[];
  streamingAssistant: string | null;
}) {
  const seenMessageIds = useRef(new Set<Id<'sessionMessages'>>());

  return (
    <ul className="flex flex-col gap-4">
      {messages.map((message) => {
        const hasSeen = seenMessageIds.current.has(message.id);
        if (!hasSeen) {
          seenMessageIds.current.add(message.id);
        }
        const baseClasses = `rounded-xl border px-4 py-3 text-sm shadow-sm transition ${
          message.role === 'assistant'
            ? 'border-border bg-card text-foreground'
            : 'border-primary/40 bg-primary/10 text-foreground'
        }`;
        const animationClass = hasSeen ? '' : 'animate-fade-in-up';

        return (
          <li key={message.id} className={`${baseClasses} ${animationClass}`.trim()}>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold tracking-wide text-foreground">
                {message.role === 'assistant' ? 'Vibecoursing' : 'You'}
              </span>
              <span>{formatTimestamp(message.createdAt)}</span>
            </div>
            <TranscriptMessageBody body={message.body} />
            {message.termsCovered.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {message.termsCovered.map((term) => (
                  <span
                    key={`${message.id}-${term}`}
                    className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                  >
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
        );
      })}
      {streamingAssistant !== null && (
        <li
          key="pending-assistant"
          className="rounded-xl border border-border bg-card text-foreground px-4 py-3 text-sm shadow-sm animate-pulse"
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold tracking-wide text-foreground">Vibecoursing</span>
            <span>Streaming…</span>
          </div>
          {streamingAssistant.trim().length > 0 ? (
            <TranscriptMessageBody body={streamingAssistant} />
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Generating a response…</p>
          )}
        </li>
      )}
    </ul>
  );
}

function TranscriptMessageBody({ body }: { body: string }) {
  if (!body || body.trim().length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-3 text-sm leading-6 text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {body}
      </ReactMarkdown>
    </div>
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
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        Follow-up questions will appear here once the assistant suggests them.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Suggested follow-up questions
      </span>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {followUps.map((followUp) => {
          const isSelected = followUp.id === selectedId;
          const ariaLabel = followUp.rationale ? `${followUp.prompt}. ${followUp.rationale}` : followUp.prompt;
          return (
            <button
              key={followUp.id}
              type="button"
              className={`inline-flex items-center justify-center gap-1 rounded-full border px-3 py-1 text-left transition ${
                isSelected
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-background text-foreground hover:border-primary hover:text-primary'
              } whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60`}
              onClick={() => onSelect(followUp)}
              disabled={disabled}
              title={followUp.rationale ?? undefined}
              aria-label={ariaLabel}
            >
              <span
                className={`text-xs font-semibold leading-snug ${
                  isSelected ? 'text-primary-foreground' : 'text-foreground'
                }`}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={followUpMarkdownComponents}>
                  {followUp.prompt}
                </ReactMarkdown>
              </span>
            </button>
          );
        })}
      </div>
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
        className="w-full min-h-[120px] resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-0"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{draft.length}/{MAX_PROMPT_LENGTH} characters</span>
        <span>Press ⌘+Enter (or Ctrl+Enter) to send</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : (
          <span className="text-xs text-muted-foreground italic">Turns sync automatically to your learning plan.</span>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className={`inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${
            isSubmitting ? 'cursor-progress opacity-80' : ''
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
    <div className="space-y-4">
      <div className="h-24 rounded-xl bg-muted/60" />
      <div className="h-24 rounded-xl bg-muted/60" />
      <div className="h-24 rounded-xl bg-muted/60" />
    </div>
  );
}

function EmptyTranscriptState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <h4 className="text-sm font-medium text-foreground">No messages yet</h4>
      <p className="max-w-sm text-xs text-muted-foreground">
        Kick off the session with a question or reflection. We will track progress against your plan.
      </p>
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
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-lg">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-xs font-medium text-muted-foreground transition hover:text-primary"
        >
          Close
        </button>
      )}
      {isSubmitting && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-card/90 px-6 text-center backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <span className="sr-only">Generating your learning session…</span>
            <div
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary/30 border-t-primary"
            >
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-b-transparent" />
            </div>
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
      <h3 className="text-lg font-semibold text-foreground">Start a new learning session</h3>
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
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-0"
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
            className="w-full resize-y rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-0"
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
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-0"
          />
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <span className="text-xs text-muted-foreground">Plans save instantly so you can jump into a session right away.</span>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${
              isSubmitting ? 'cursor-progress opacity-80' : ''
            }`}
          >
            {isSubmitting ? 'Generating…' : 'Generate plan'}
          </button>
        </div>
        {error && (
          <p className="text-xs text-destructive" role="alert" aria-live="assertive">
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
    <div className="mt-4 rounded-2xl border border-dashed border-border bg-muted/40 p-4 text-sm text-foreground shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plan saved</span>
      <h4 className="mt-2 text-base font-semibold text-foreground">{plan.topic}</h4>
      {plan.summary && <p className="text-sm text-muted-foreground">{plan.summary}</p>}
      <ol className="mt-3 space-y-3">
        {plan.phases.map((phase, index) => (
          <li key={`${phase.name}-${index}`} className="rounded-xl border border-border bg-card p-3 shadow-sm">
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
    <div className="flex h-full flex-col gap-6 px-8 py-8">
      <div className="h-6 w-2/3 rounded bg-muted/60" />
      <div className="flex-1 rounded-2xl border border-border bg-card" />
    </div>
  );
}

function UnauthenticatedState() {
  return <AuthPage />;
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

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
