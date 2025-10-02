'use client';

import { Authenticated, Unauthenticated, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ChatLayout } from '@/components/chat/ChatLayout';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const viewer = bootstrap?.viewer ?? null;
  const activeSession = activeSessionId && sessions ? sessions.find((session) => session.id === activeSessionId) ?? null : null;

  const handleSelectSession = useCallback((sessionId: Id<'learningSessions'>) => {
    setActiveSessionId((current) => (current === sessionId ? current : sessionId));
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
    <ChatLayout
      header={<WorkspaceTopBar user={user} onSignOut={signOut} />}
      sidebar={
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
        />
      }
      main={<SessionLanding viewer={viewer} session={activeSession} hasSessions={sessions.length > 0} />}
    />
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
}: {
  sessions: SessionSummary[];
  activeSessionId: Id<'learningSessions'> | null;
  onSelectSession: (sessionId: Id<'learningSessions'>) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sessions</h2>
        <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">{sessions.length}</span>
      </div>
      <nav className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions yet—use the main panel to create your first topic.</p>
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
}: {
  viewer: ViewerSummary;
  session: SessionSummary | null;
  hasSessions: boolean;
}) {
  if (!hasSessions) {
    return <EmptySessionState viewer={viewer} />;
  }

  if (!session) {
    return <MissingSessionSelectionState />;
  }

  return <SessionOverviewCard session={session} />;
}

function EmptySessionState({ viewer }: { viewer: ViewerSummary }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-semibold">Welcome{viewer?.name ? `, ${viewer.name}` : ''}!</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Use this workspace to design guided learning sessions. Start by drafting a topic plan and we will track your progress phase by phase.
      </p>
    </div>
  );
}

function MissingSessionSelectionState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
      <h3 className="text-sm font-medium">Select a session to view its progress</h3>
      <p className="max-w-sm text-sm">Pick any session from the sidebar to continue learning.</p>
    </div>
  );
}

function SessionOverviewCard({ session }: { session: SessionSummary }) {
  const phaseProgress = session.totalPhases > 0 ? Math.round((session.completedPhases / session.totalPhases) * 100) : 0;
  const termProgress = session.totalTerms > 0 ? Math.round((session.completedTerms / session.totalTerms) * 100) : 0;
  const currentPhaseLabel =
    session.currentPhaseIndex !== null ? `Currently in phase ${session.currentPhaseIndex + 1} of ${session.totalPhases}` : 'Phase status pending';

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{session.topic}</h1>
        <p className="text-sm text-muted-foreground">{currentPhaseLabel}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SessionMetric label="Phases complete" value={`${session.completedPhases}/${session.totalPhases}`} hint={`${phaseProgress}%`} />
        <SessionMetric label="Key terms covered" value={`${session.completedTerms}/${session.totalTerms}`} hint={`${termProgress}%`} />
        <SessionMetric
          label="Created"
          value={new Date(session.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        />
        <SessionMetric
          label="Last updated"
          value={new Date(session.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        />
      </div>
      <div className="rounded-md border border-dashed border-slate-300 bg-muted/30 p-4 text-sm text-muted-foreground dark:border-slate-700/70">
        Session transcripts and AI prompts will appear here once the intake flow is wired up.
      </div>
    </div>
  );
}

function SessionMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-background p-4 shadow-sm dark:border-slate-700">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
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
