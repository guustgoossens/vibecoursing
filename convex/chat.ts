import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

type Identity = NonNullable<Awaited<ReturnType<QueryCtx['auth']['getUserIdentity']>>>;
type AnyCtx = QueryCtx | MutationCtx;

type Viewer = {
  id: Id<'users'>;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

type ChannelSummary = {
  id: Id<'channels'>;
  name: string;
  description: string | null;
  isPrivate: boolean;
};

type PlanPhaseInput = {
  name: string;
  objective: string;
  keyTerms: string[];
};

type GeneratedPlanPayload = {
  topic: string;
  tone?: string;
  summary?: string;
  phases: PlanPhaseInput[];
};

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

type SessionPhase = {
  id: Id<'sessionPhases'>;
  index: number;
  name: string;
  objective: string;
  completedAt: number | null;
};

type SessionTerm = {
  id: Id<'sessionTerms'>;
  phaseIndex: number;
  term: string;
  firstCoveredAt: number | null;
  exposureCount: number;
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

type SessionFollowUp = {
  id: Id<'sessionFollowUps'>;
  prompt: string;
  rationale: string | null;
  createdAt: number;
  usedAt: number | null;
};

type SessionPhaseProgress = {
  index: number;
  name: string;
  objective: string;
  totalTerms: number;
  completedTerms: number;
  remainingTerms: string[];
  isComplete: boolean;
};

function cleanString(value?: string | null) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

async function requireIdentity(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError('NOT_AUTHENTICATED');
  }
  return identity;
}

async function fetchUserBySubject(ctx: AnyCtx, subject: string) {
  return ctx.db
    .query('users')
    .withIndex('by_external_id', (q) => q.eq('externalId', subject))
    .unique();
}

function normaliseProfile(identity: Identity, overrides: { email?: string | null; name?: string | null; avatarUrl?: string | null }) {
  const email = cleanString(overrides.email ?? identity.email);
  const derivedName =
    cleanString(overrides.name ?? identity.name) ??
    cleanString([identity.givenName, identity.familyName].filter((part) => cleanString(part) !== undefined).join(' ')) ??
    email;
  const avatarUrl = cleanString(overrides.avatarUrl ?? identity.pictureUrl);
  return {
    email,
    name: derivedName,
    avatarUrl,
  };
}

async function ensureDefaultChannel(ctx: MutationCtx, userId: Id<'users'>) {
  const existingChannel = await ctx.db.query('channels').take(1);
  if (existingChannel.length > 0) {
    return;
  }
  const createdAt = Date.now();
  const channelId = await ctx.db.insert('channels', {
    name: 'general',
    description: 'Default space for everyone to chat.',
    createdBy: userId,
    isPrivate: false,
    createdAt,
  });
  await ctx.db.insert('channelMembers', {
    channelId,
    userId,
    role: 'owner',
    joinedAt: createdAt,
  });
}

async function resolveViewer(user: Doc<'users'> | null): Promise<Viewer | null> {
  if (!user) {
    return null;
  }
  return {
    id: user._id,
    email: user.email ?? null,
    name: user.name ?? null,
    avatarUrl: user.avatarUrl ?? null,
  };
}

async function listVisibleChannels(ctx: QueryCtx, user: Doc<'users'> | null): Promise<ChannelSummary[]> {
  if (!user) {
    return [];
  }
  const membershipDocs = await ctx.db
    .query('channelMembers')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .collect();
  const membershipSet = new Set(membershipDocs.map((m) => m.channelId));

  const channels = await ctx.db.query('channels').collect();

  return channels
    .filter((channel) => !channel.isPrivate || membershipSet.has(channel._id) || channel.createdBy === user._id)
    .map((channel) => ({
      id: channel._id,
      name: channel.name,
      description: channel.description ?? null,
      isPrivate: channel.isPrivate,
    }));
}

async function ensureUser(ctx: MutationCtx, identity: Identity): Promise<Doc<'users'>> {
  const existing = await fetchUserBySubject(ctx, identity.subject);
  if (existing) {
    return existing;
  }

  const profile = normaliseProfile(identity, {});
  const insertDoc: {
    externalId: string;
    email?: string;
    name?: string;
    avatarUrl?: string;
  } = {
    externalId: identity.subject,
  };

  if (profile.email !== undefined) {
    insertDoc.email = profile.email;
  }
  if (profile.name !== undefined) {
    insertDoc.name = profile.name;
  }
  if (profile.avatarUrl !== undefined) {
    insertDoc.avatarUrl = profile.avatarUrl;
  }

  const userId = await ctx.db.insert('users', insertDoc);
  await ensureDefaultChannel(ctx, userId);

  const created = await ctx.db.get(userId);
  if (!created) {
    throw new ConvexError('USER_CREATION_FAILED');
  }
  return created;
}

function mapSessionDocToSummary(session: Doc<'learningSessions'>): SessionSummary {
  return {
    id: session._id,
    topic: session.topic,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    currentPhaseIndex: session.currentPhaseIndex ?? null,
    completedPhases: session.completedPhases,
    totalPhases: session.totalPhases,
    completedTerms: session.completedTerms,
    totalTerms: session.totalTerms,
  };
}

async function listSessionSummaries(ctx: QueryCtx, user: Doc<'users'>): Promise<SessionSummary[]> {
  const sessions = await ctx.db
    .query('learningSessions')
    .withIndex('by_user_updatedAt', (q) => q.eq('userId', user._id))
    .order('desc')
    .collect();

  return sessions.map(mapSessionDocToSummary);
}

function mapPhaseDoc(phase: Doc<'sessionPhases'>): SessionPhase {
  return {
    id: phase._id,
    index: phase.index,
    name: phase.name,
    objective: phase.objective,
    completedAt: phase.completedAt ?? null,
  };
}

function mapTermDoc(term: Doc<'sessionTerms'>): SessionTerm {
  return {
    id: term._id,
    phaseIndex: term.phaseIndex,
    term: term.term,
    firstCoveredAt: term.firstCoveredAt ?? null,
    exposureCount: term.exposureCount ?? 0,
  };
}

function buildPhaseProgressSnapshot(
  phases: Doc<'sessionPhases'>[],
  termState: Map<Id<'sessionTerms'>, Doc<'sessionTerms'>>
): SessionPhaseProgress[] {
  return phases.map((phase) => {
    const termsForPhase: Doc<'sessionTerms'>[] = [];
    for (const term of termState.values()) {
      if (term.phaseIndex === phase.index) {
        termsForPhase.push(term);
      }
    }
    const remainingTerms = termsForPhase
      .filter((term) => term.firstCoveredAt === undefined)
      .map((term) => term.term)
      .sort((a, b) => a.localeCompare(b));
    const completedTerms = termsForPhase.length - remainingTerms.length;
    return {
      index: phase.index,
      name: phase.name,
      objective: phase.objective,
      totalTerms: termsForPhase.length,
      completedTerms,
      remainingTerms,
      isComplete: termsForPhase.length > 0 && remainingTerms.length === 0,
    };
  });
}

export const syncUserProfile = mutation({
  args: {
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const existing = await fetchUserBySubject(ctx, identity.subject);
    const profile = normaliseProfile(identity, args);
    let userId: Id<'users'>;

    if (!existing) {
      const insertDoc: {
        externalId: string;
        email?: string;
        name?: string;
        avatarUrl?: string;
      } = {
        externalId: identity.subject,
      };
      if (profile.email !== undefined) {
        insertDoc.email = profile.email;
      }
      if (profile.name !== undefined) {
        insertDoc.name = profile.name;
      }
      if (profile.avatarUrl !== undefined) {
        insertDoc.avatarUrl = profile.avatarUrl;
      }
      userId = await ctx.db.insert('users', insertDoc);
    } else {
      userId = existing._id;
      const updates: Partial<Doc<'users'>> = {};
      if (profile.email !== undefined && existing.email !== profile.email) {
        updates.email = profile.email;
      }
      if (profile.name !== undefined && existing.name !== profile.name) {
        updates.name = profile.name;
      }
      if (profile.avatarUrl !== undefined && existing.avatarUrl !== profile.avatarUrl) {
        updates.avatarUrl = profile.avatarUrl;
      }
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existing._id, updates);
      }
    }

    await ensureDefaultChannel(ctx, userId);

    return { userId };
  },
});

export const bootstrap = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { viewer: null, channels: [] as ChannelSummary[], sessions: [] as SessionSummary[] };
    }

    const user = await fetchUserBySubject(ctx, identity.subject);
    const viewer = await resolveViewer(user);
    const channels = await listVisibleChannels(ctx, user);
    const sessions = user ? await listSessionSummaries(ctx, user) : [];

    return { viewer, channels, sessions };
  },
});

export const listChannels = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const user = await fetchUserBySubject(ctx, identity.subject);
    if (!user) {
      return [] as ChannelSummary[];
    }
    return listVisibleChannels(ctx, user);
  },
});

export const listMessages = query({
  args: {
    channelId: v.id('channels'),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const user = await fetchUserBySubject(ctx, identity.subject);
    if (!user) {
      throw new ConvexError('USER_PROFILE_MISSING');
    }

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError('CHANNEL_NOT_FOUND');
    }

    if (channel.isPrivate && channel.createdBy !== user._id) {
      const membership = await ctx.db
        .query('channelMembers')
        .withIndex('by_channel_user', (q) => q.eq('channelId', args.channelId).eq('userId', user._id))
        .unique();
      if (!membership) {
        throw new ConvexError('NOT_AUTHORIZED');
      }
    }

    const results = await ctx.db
      .query('messages')
      .withIndex('by_channel_sentAt', (q) => q.eq('channelId', args.channelId))
      .order('desc')
      .take(50);

    return results.reverse();
  },
});

export const sendMessage = mutation({
  args: {
    channelId: v.id('channels'),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const profile = normaliseProfile(identity, {});
    const existingUser = await fetchUserBySubject(ctx, identity.subject);

    let userId: Id<'users'>;
    if (!existingUser) {
      const insertDoc: {
        externalId: string;
        email?: string;
        name?: string;
        avatarUrl?: string;
      } = {
        externalId: identity.subject,
      };
      if (profile.email !== undefined) {
        insertDoc.email = profile.email;
      }
      if (profile.name !== undefined) {
        insertDoc.name = profile.name;
      }
      if (profile.avatarUrl !== undefined) {
        insertDoc.avatarUrl = profile.avatarUrl;
      }
      userId = await ctx.db.insert('users', insertDoc);
      await ensureDefaultChannel(ctx, userId);
    } else {
      userId = existingUser._id;
    }

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError('CHANNEL_NOT_FOUND');
    }

    if (channel.isPrivate && channel.createdBy !== userId) {
      const membership = await ctx.db
        .query('channelMembers')
        .withIndex('by_channel_user', (q) => q.eq('channelId', args.channelId).eq('userId', userId))
        .unique();
      if (!membership) {
        throw new ConvexError('NOT_AUTHORIZED');
      }
    }

    const trimmed = cleanString(args.body);
    if (!trimmed) {
      throw new ConvexError('EMPTY_MESSAGE');
    }
    if (trimmed.length > 2000) {
      throw new ConvexError('MESSAGE_TOO_LONG');
    }

    const sentAt = Date.now();
    const messageId = await ctx.db.insert('messages', {
      channelId: args.channelId,
      authorId: userId,
      body: trimmed,
      sentAt,
    });

    return { messageId };
  },
});

export const sessionBootstrap = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { viewer: null, sessions: [] as SessionSummary[] };
    }

    const user = await fetchUserBySubject(ctx, identity.subject);
    if (!user) {
      return { viewer: null, sessions: [] as SessionSummary[] };
    }

    const viewer = await resolveViewer(user);
    const sessions = await listSessionSummaries(ctx, user);

    return { viewer, sessions };
  },
});

export const listLearningSessions = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const user = await fetchUserBySubject(ctx, identity.subject);
    if (!user) {
      throw new ConvexError('USER_PROFILE_MISSING');
    }

    return listSessionSummaries(ctx, user);
  },
});

export const getSessionOverview = query({
  args: {
    sessionId: v.id('learningSessions'),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const user = await fetchUserBySubject(ctx, identity.subject);
    if (!user) {
      throw new ConvexError('USER_PROFILE_MISSING');
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) {
      throw new ConvexError('SESSION_NOT_FOUND');
    }

    const phaseDocs = await ctx.db
      .query('sessionPhases')
      .withIndex('by_session_index', (q) => q.eq('sessionId', args.sessionId))
      .collect();
    phaseDocs.sort((a, b) => a.index - b.index);

    const termDocs = await ctx.db
      .query('sessionTerms')
      .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
      .collect();

    const termsByPhase = new Map<number, SessionTerm[]>();
    for (const term of termDocs.map(mapTermDoc)) {
      const bucket = termsByPhase.get(term.phaseIndex);
      if (bucket) {
        bucket.push(term);
      } else {
        termsByPhase.set(term.phaseIndex, [term]);
      }
    }

    for (const list of termsByPhase.values()) {
      list.sort((a, b) => a.term.localeCompare(b.term));
    }

    return {
      session: mapSessionDocToSummary(session),
      phases: phaseDocs.map((phaseDoc) => ({
        ...mapPhaseDoc(phaseDoc),
        terms: termsByPhase.get(phaseDoc.index) ?? [],
      })),
    };
  },
});

export const getSessionTranscript = query({
  args: {
    sessionId: v.id('learningSessions'),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const user = await fetchUserBySubject(ctx, identity.subject);
    if (!user) {
      throw new ConvexError('USER_PROFILE_MISSING');
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) {
      throw new ConvexError('SESSION_NOT_FOUND');
    }

    const messageDocs = await ctx.db
      .query('sessionMessages')
      .withIndex('by_session_createdAt', (q) => q.eq('sessionId', args.sessionId))
      .order('asc')
      .collect();

    const followUpDocs = await ctx.db
      .query('sessionFollowUps')
      .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
      .collect();
    followUpDocs.sort((a, b) => a.createdAt - b.createdAt);

    const phaseDocs = await ctx.db
      .query('sessionPhases')
      .withIndex('by_session_index', (q) => q.eq('sessionId', args.sessionId))
      .collect();
    phaseDocs.sort((a, b) => a.index - b.index);

    const termDocs = await ctx.db
      .query('sessionTerms')
      .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
      .collect();

    const termState = new Map<Id<'sessionTerms'>, Doc<'sessionTerms'>>();
    for (const term of termDocs) {
      termState.set(term._id, term);
    }

    const phaseProgress = buildPhaseProgressSnapshot(phaseDocs, termState);

    const messages: SessionTranscriptMessage[] = messageDocs.map((message) => ({
      id: message._id,
      role: message.role,
      body: message.body,
      createdAt: message.createdAt,
      termsCovered: message.termsCovered ?? [],
      promptTokens: message.promptTokens ?? null,
      completionTokens: message.completionTokens ?? null,
      totalTokens: message.totalTokens ?? null,
    }));

    const followUps: SessionFollowUp[] = followUpDocs.map((followUp) => ({
      id: followUp._id,
      prompt: followUp.prompt,
      rationale: followUp.rationale ?? null,
      createdAt: followUp.createdAt,
      usedAt: followUp.usedAt ?? null,
    }));

    return {
      session: mapSessionDocToSummary(session),
      messages,
      followUps,
      phaseProgress,
    };
  },
});

export const createLearningSession = mutation({
  args: {
    plan: v.object({
      topic: v.string(),
      tone: v.optional(v.string()),
      summary: v.optional(v.string()),
      phases: v.array(
        v.object({
          name: v.string(),
          objective: v.string(),
          keyTerms: v.array(v.string()),
        })
      ),
    }),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const user = await ensureUser(ctx, identity);

    const plan: GeneratedPlanPayload = args.plan;

    const topic = cleanString(plan.topic);
    if (!topic) {
      throw new ConvexError('PLAN_TOPIC_REQUIRED');
    }
    if (plan.phases.length === 0) {
      throw new ConvexError('PLAN_PHASES_REQUIRED');
    }

    const preparedPhases = plan.phases.map((phase: PlanPhaseInput, index) => {
      const name = cleanString(phase.name);
      const objective = cleanString(phase.objective);
      const keyTerms = phase.keyTerms
        .map((term) => cleanString(term))
        .filter((term): term is string => term !== undefined);

      if (!name || !objective) {
        throw new ConvexError('PLAN_PHASE_INVALID');
      }
      if (keyTerms.length === 0) {
        throw new ConvexError('PLAN_PHASE_TERMS_REQUIRED');
      }

      return {
        index,
        name,
        objective,
        keyTerms,
      };
    });

    const tone = cleanString(plan.tone);
    const summary = cleanString(plan.summary);
    const totalTerms = preparedPhases.reduce((acc, phase) => acc + phase.keyTerms.length, 0);
    const now = Date.now();

    const sessionId = await ctx.db.insert('learningSessions', {
      userId: user._id,
      topic,
      tone: tone ?? undefined,
      planTone: tone ?? undefined,
      planSummary: summary ?? undefined,
      currentPhaseIndex: 0,
      totalPhases: preparedPhases.length,
      completedPhases: 0,
      totalTerms,
      completedTerms: 0,
      createdAt: now,
      updatedAt: now,
    });

    for (const phase of preparedPhases) {
      await ctx.db.insert('sessionPhases', {
        sessionId,
        index: phase.index,
        name: phase.name,
        objective: phase.objective,
      });

      for (const term of phase.keyTerms) {
        await ctx.db.insert('sessionTerms', {
          sessionId,
          phaseIndex: phase.index,
          term,
          exposureCount: 0,
        });
      }
    }

    const session = await ctx.db.get(sessionId);
    if (!session) {
      throw new ConvexError('SESSION_CREATION_FAILED');
    }

    return {
      sessionId,
      session: mapSessionDocToSummary(session),
    };
  },
});
