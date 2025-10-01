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
      return { viewer: null, channels: [] as ChannelSummary[] };
    }

    const user = await fetchUserBySubject(ctx, identity.subject);
    const viewer = await resolveViewer(user);
    const channels = await listVisibleChannels(ctx, user);

    return { viewer, channels };
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
