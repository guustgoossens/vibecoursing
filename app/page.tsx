'use client';

import { Authenticated, Unauthenticated, useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import type { User } from '@workos-inc/node';
import { useEffect, useMemo } from 'react';

type DerivedProfile = {
  email?: string;
  name?: string;
  avatarUrl?: string;
};

function deriveProfileFields(user: User | null | undefined): DerivedProfile {
  if (!user) {
    return {};
  }
  const first = (user as Record<string, unknown>).firstName;
  const last = (user as Record<string, unknown>).lastName;
  const nameParts = [first, last]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  const email = typeof user.email === 'string' && user.email.length > 0 ? user.email : undefined;
  const name = nameParts.length > 0 ? nameParts.join(' ') : email;
  const avatarCandidate = (user as Record<string, unknown>).profilePictureUrl ?? (user as Record<string, unknown>).photoUrl;
  const avatarUrl = typeof avatarCandidate === 'string' && avatarCandidate.length > 0 ? avatarCandidate : undefined;

  return {
    email,
    name: name ?? undefined,
    avatarUrl,
  };
}

export default function Home() {
  const { user, signOut } = useAuth();

  return (
    <>
      <header className="sticky top-0 z-10 bg-background p-4 border-b-2 border-slate-200 dark:border-slate-800 flex flex-row justify-between items-center">
        Vibecoursing
        {user && <UserMenu user={user} onSignOut={signOut} />}
      </header>
      <main className="p-8 flex flex-col gap-8">
        <h1 className="text-4xl font-bold text-center">Team chat workspace</h1>
        <Authenticated>
          <Content />
        </Authenticated>
        <Unauthenticated>
          <SignInForm />
        </Unauthenticated>
      </main>
    </>
  );
}

function SignInForm() {
  return (
    <div className="flex flex-col gap-8 w-96 mx-auto">
      <p>Log in to explore the shared workspace.</p>
      <a href="/sign-in">
        <button className="bg-foreground text-background px-4 py-2 rounded-md">Sign in</button>
      </a>
      <a href="/sign-up">
        <button className="bg-foreground text-background px-4 py-2 rounded-md">Sign up</button>
      </a>
    </div>
  );
}

function Content() {
  const { user } = useAuth();
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

  const bootstrap = useQuery(api.chat.bootstrap);
  const activeChannelId = bootstrap?.channels?.[0]?.id;
  const messagesResult = useQuery(api.chat.listMessages, activeChannelId ? { channelId: activeChannelId } : 'skip');

  if (!bootstrap) {
    return <div className="mx-auto text-sm text-muted-foreground">Loading workspace…</div>;
  }

  const { viewer, channels } = bootstrap;
  const activeChannel = channels[0] ?? null;
  const messages = messagesResult ?? [];

  return (
    <div className="flex flex-col gap-8 max-w-3xl mx-auto w-full">
      <section className="flex flex-col gap-2 bg-slate-200 dark:bg-slate-800 p-4 rounded-md">
        <h2 className="text-xl font-semibold">Welcome{viewer?.name ? `, ${viewer.name}` : ''}!</h2>
        <p className="text-sm text-muted-foreground">
          WorkOS is already handling authentication. Phase 1 focuses on making sure your Convex data layer is ready for
          real chat traffic.
        </p>
      </section>

      <section className="flex flex-col gap-3 bg-slate-200 dark:bg-slate-800 p-4 rounded-md">
        <h3 className="text-lg font-semibold">Channels</h3>
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">No channels yet—finish the setup mutation to see the default workspace.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {channels.map((channel) => (
              <li
                key={channel.id}
                className={`flex flex-col rounded-md border px-3 py-2 text-sm ${
                  channel.id === activeChannel?.id ? 'border-foreground' : 'border-transparent'
                }`}
              >
                <span className="font-medium">#{channel.name}</span>
                {channel.description && <span className="text-muted-foreground">{channel.description}</span>}
                {channel.isPrivate && <span className="text-xs text-muted-foreground">Private</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 bg-slate-200 dark:bg-slate-800 p-4 rounded-md">
        <h3 className="text-lg font-semibold">Latest in #{activeChannel?.name ?? 'workspace'}</h3>
        {activeChannel === null ? (
          <p className="text-sm text-muted-foreground">Create or seed a channel to see conversation history.</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet—Phase 2 will layer the composer and live updates.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((message) => (
              <li key={message._id} className="rounded-md bg-background px-3 py-2 text-sm">
                <span className="font-medium">{message.authorId}</span>
                <span className="mx-2 text-xs text-muted-foreground">
                  {new Date(message.sentAt).toLocaleString()}
                </span>
                <p>{message.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col">
        <p className="text-lg font-bold">Useful resources:</p>
        <div className="flex gap-2">
          <div className="flex flex-col gap-2 w-1/2">
            <ResourceCard
              title="Convex docs"
              description="Reference for schemas, queries, and mutations."
              href="https://docs.convex.dev/home"
            />
            <ResourceCard
              title="Stack articles"
              description="Deep dives on Convex architecture decisions."
              href="https://stack.convex.dev"
            />
          </div>
          <div className="flex flex-col gap-2 w-1/2">
            <ResourceCard
              title="Templates"
              description="Jump-start prototypes with real-world patterns."
              href="https://www.convex.dev/templates"
            />
            <ResourceCard
              title="Discord"
              description="Visit the Convex community for help and inspiration."
              href="https://www.convex.dev/community"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function ResourceCard({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <div className="flex flex-col gap-2 bg-slate-200 dark:bg-slate-800 p-4 rounded-md h-28 overflow-auto">
      <a href={href} className="text-sm underline hover:no-underline">
        {title}
      </a>
      <p className="text-xs">{description}</p>
    </div>
  );
}

function UserMenu({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const derivedProfile = useMemo(() => deriveProfileFields(user), [user]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">{derivedProfile.email ?? 'Unknown user'}</span>
      <button onClick={onSignOut} className="bg-red-500 text-white px-3 py-1 rounded-md text-sm hover:bg-red-600">
        Sign out
      </button>
    </div>
  );
}
