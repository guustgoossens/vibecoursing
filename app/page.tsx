'use client';

import { Authenticated, Unauthenticated, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ChatLayout } from '@/components/chat/ChatLayout';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import type { User } from '@workos-inc/node';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Doc, Id } from '@/convex/_generated/dataModel';

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

type ChannelSummary = {
  id: Id<'channels'>;
  name: string;
  description: string | null;
  isPrivate: boolean;
};

type PendingMessage = {
  clientId: string;
  channelId: Id<'channels'>;
  body: string;
  createdAt: number;
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
  const sendMessage = useMutation(api.chat.sendMessage);
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
  const channels = useQuery(api.chat.listChannels);
  const [activeChannelId, setActiveChannelId] = useState<Id<'channels'> | null>(null);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);

  useEffect(() => {
    if (channels === undefined) {
      return;
    }
    if (channels.length === 0) {
      if (activeChannelId !== null) {
        setActiveChannelId(null);
      }
      return;
    }
    if (!activeChannelId || !channels.some((channel) => channel.id === activeChannelId)) {
      setActiveChannelId(channels[0].id);
    }
  }, [channels, activeChannelId]);

  const handleSelectChannel = useCallback((channelId: Id<'channels'>) => {
    setActiveChannelId((current) => (current === channelId ? current : channelId));
  }, []);

  const handleSendMessage = useCallback(
    async (channelId: Id<'channels'>, body: string) => {
      const trimmed = body.trim();
      if (trimmed.length === 0) {
        return;
      }
      const clientId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      const createdAt = Date.now();
      const optimisticMessage: PendingMessage = {
        clientId,
        channelId,
        body: trimmed,
        createdAt,
      };
      setPendingMessages((current) => [...current, optimisticMessage]);
      try {
        await sendMessage({ channelId, body: trimmed });
        setPendingMessages((current) => current.filter((message) => message.clientId !== clientId));
      } catch (error) {
        setPendingMessages((current) => current.filter((message) => message.clientId !== clientId));
        throw error;
      }
    },
    [sendMessage]
  );

  const messagesResult = useQuery(
    api.chat.listMessages,
    activeChannelId ? { channelId: activeChannelId } : 'skip'
  );

  if (channels === undefined) {
    return (
      <ChatLayout
        header={<WorkspaceTopBar user={user} onSignOut={signOut} />}
        sidebar={<ChannelSidebarSkeleton />}
        main={<ChatPaneSkeleton />}
      />
    );
  }

  const viewer = bootstrap?.viewer ?? null;
  const activeChannel = activeChannelId
    ? channels.find((channel) => channel.id === activeChannelId) ?? null
    : null;

  return (
    <ChatLayout
      header={<WorkspaceTopBar user={user} onSignOut={signOut} />}
      sidebar={
        <ChannelSidebar
          channels={channels}
          activeChannelId={activeChannel?.id ?? null}
          onSelectChannel={handleSelectChannel}
        />
      }
      main={
        <ChatPane
          viewer={viewer}
          channel={activeChannel}
          messages={messagesResult ?? []}
          pendingMessages={pendingMessages}
          onSendMessage={handleSendMessage}
          isLoadingMessages={messagesResult === undefined && activeChannel !== null}
        />
      }
    />
  );
}

function WorkspaceTopBar({ user, onSignOut }: { user: User | null | undefined; onSignOut: () => void }) {
  return (
    <div className="flex h-14 items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground text-lg font-semibold text-background">
          VC
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold leading-none">Vibecoursing</span>
          <span className="text-xs text-muted-foreground">Chat workspace MVP</span>
        </div>
      </div>
      {user && <UserMenu user={user} onSignOut={onSignOut} />}
    </div>
  );
}

function ChannelSidebar({
  channels,
  activeChannelId,
  onSelectChannel,
}: {
  channels: ChannelSummary[];
  activeChannelId: Id<'channels'> | null;
  onSelectChannel: (channelId: Id<'channels'>) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channels</h2>
        <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">{channels.length}</span>
      </div>
      <nav className="flex-1 overflow-y-auto">
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">No channels yet—run the setup mutation to seed a default room.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {channels.map((channel) => {
              const isActive = channel.id === activeChannelId;
              return (
                <li key={channel.id}>
                  <button
                    type="button"
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      isActive
                        ? 'border-slate-300 bg-background text-foreground shadow-sm dark:border-slate-700'
                        : 'border-transparent bg-background/40 text-muted-foreground hover:border-slate-300 hover:bg-background hover:text-foreground dark:hover:border-slate-700'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => onSelectChannel(channel.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">#{channel.name}</span>
                      {channel.isPrivate && <span className="text-[10px] uppercase text-muted-foreground">Private</span>}
                    </div>
                    {channel.description && <p className="text-xs text-muted-foreground">{channel.description}</p>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      <p className="text-xs text-muted-foreground">
        Select a channel to jump between rooms. New channels appear here instantly when Convex data updates.
      </p>
    </>
  );
}

function ChannelSidebarSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="h-4 w-24 rounded bg-slate-300/50 dark:bg-slate-700/60" />
      <div className="flex flex-col gap-3">
        <div className="h-10 w-full rounded bg-slate-300/30 dark:bg-slate-700/40" />
        <div className="h-10 w-full rounded bg-slate-300/30 dark:bg-slate-700/40" />
        <div className="h-10 w-full rounded bg-slate-300/30 dark:bg-slate-700/40" />
      </div>
    </div>
  );
}

function ChatPane({
  viewer,
  channel,
  messages,
  pendingMessages,
  onSendMessage,
  isLoadingMessages,
}: {
  viewer: ViewerSummary;
  channel: ChannelSummary | null;
  messages: Doc<'messages'>[];
  pendingMessages: PendingMessage[];
  onSendMessage: (channelId: Id<'channels'>, body: string) => Promise<void>;
  isLoadingMessages: boolean;
}) {
  if (!channel) {
    return <EmptyChannelState viewer={viewer} />;
  }

  const optimisticMessages = pendingMessages.filter((message) => message.channelId === channel.id);
  const hasMessages = messages.length > 0 || optimisticMessages.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <h1 className="text-lg font-semibold">#{channel.name}</h1>
        {channel.description && <p className="text-sm text-muted-foreground">{channel.description}</p>}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoadingMessages ? (
          <LoadingMessages />
        ) : hasMessages ? (
          <MessageList messages={messages} pendingMessages={optimisticMessages} />
        ) : (
          <MessagesEmptyState channelName={channel.name} />
        )}
      </div>
      <div className="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
        <MessageComposer channelId={channel.id} onSend={onSendMessage} />
      </div>
    </div>
  );
}

function ChatPaneSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="h-16 border-b border-slate-200 bg-muted/30 dark:border-slate-800" />
      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        <div className="h-16 rounded-md bg-slate-300/30 dark:bg-slate-700/40" />
        <div className="h-16 rounded-md bg-slate-300/30 dark:bg-slate-700/40" />
        <div className="h-16 rounded-md bg-slate-300/30 dark:bg-slate-700/40" />
      </div>
      <div className="h-20 border-t border-slate-200 bg-muted/30 dark:border-slate-800" />
    </div>
  );
}

function MessageList({
  messages,
  pendingMessages,
}: {
  messages: Doc<'messages'>[];
  pendingMessages: PendingMessage[];
}) {
  return (
    <ul className="flex flex-col gap-3 text-sm">
      {messages.map((message) => (
        <li
          key={message._id}
          className="rounded-md border border-slate-200 bg-background px-4 py-3 shadow-sm dark:border-slate-700"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{message.authorId}</span>
            <time dateTime={new Date(message.sentAt).toISOString()}>
              {new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </time>
          </div>
          <p className="mt-1 text-sm text-foreground">{message.body}</p>
        </li>
      ))}
      {pendingMessages.map((message) => (
        <li
          key={message.clientId}
          className="rounded-md border border-dashed border-slate-300 bg-muted/40 px-4 py-3 text-sm text-muted-foreground shadow-sm dark:border-slate-700/70"
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-foreground">You</span>
            <span className="text-muted-foreground">Sending…</span>
          </div>
          <p className="mt-1 text-sm text-foreground">{message.body}</p>
        </li>
      ))}
    </ul>
  );
}

function LoadingMessages() {
  return (
    <div className="space-y-3">
      <div className="h-14 rounded-md bg-slate-300/30 dark:bg-slate-700/40" />
      <div className="h-14 rounded-md bg-slate-300/30 dark:bg-slate-700/40" />
      <div className="h-14 rounded-md bg-slate-300/30 dark:bg-slate-700/40" />
    </div>
  );
}

function MessageComposer({
  channelId,
  onSend,
}: {
  channelId: Id<'channels'>;
  onSend: (channelId: Id<'channels'>, body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const trimmed = draft.trim();
  const canSubmit = isOnline && trimmed.length > 0 && !isSubmitting;

  const performSubmit = useCallback(async () => {
    if (!canSubmit) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onSend(channelId, trimmed);
      setDraft('');
    } catch (sendError) {
      console.error('Failed to send message', sendError);
      setError('Something went wrong sending your message. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, channelId, onSend, trimmed]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await performSubmit();
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      await performSubmit();
    }
  };

  const statusLabel = !isOnline
    ? 'Offline — reconnect to send messages.'
    : 'Press ⌘+Enter (or Ctrl+Enter) to send';

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-md border border-slate-200 bg-background p-3 shadow-sm dark:border-slate-700"
    >
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        placeholder="Write a message"
        className="w-full resize-none rounded-md border border-slate-200 bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-foreground focus:ring-0 dark:border-slate-700"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{statusLabel}</span>
        <button
          type="submit"
          disabled={!canSubmit}
          className={`rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60 ${
            isSubmitting ? 'cursor-progress' : ''
          }`}
        >
          {isSubmitting ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!isOnline && <p className="text-xs text-yellow-600">You are offline. Messages will resume once you reconnect.</p>}
    </form>
  );
}

function EmptyChannelState({ viewer }: { viewer: ViewerSummary }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h2 className="text-lg font-semibold">Welcome{viewer?.name ? `, ${viewer.name}` : ''}!</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Seed a channel via the Phase 1 setup mutation to see your live chat history. The new layout is ready to stream
        messages once they exist.
      </p>
    </div>
  );
}

function MessagesEmptyState({ channelName }: { channelName: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <h3 className="text-sm font-medium">No messages in #{channelName} yet</h3>
      <p className="max-w-sm text-sm">
        The composer below will send the first message in the next step.
      </p>
    </div>
  );
}

function UnauthenticatedState() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <h1 className="text-3xl font-bold">Team chat workspace</h1>
      <p className="max-w-sm text-sm text-muted-foreground">Log in with WorkOS to explore the shared workspace.</p>
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

function UserMenu({ user, onSignOut }: { user: User; onSignOut: () => void }) {
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
