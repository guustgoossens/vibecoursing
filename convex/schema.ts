import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  users: defineTable({
    externalId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    onboardingCompletedAt: v.optional(v.number()),
  }).index('by_external_id', ['externalId']),
  channels: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    createdBy: v.id('users'),
    isPrivate: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_name', ['name'])
    .index('by_creator', ['createdBy']),
  channelMembers: defineTable({
    channelId: v.id('channels'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('member')),
    joinedAt: v.number(),
  })
    .index('by_channel_user', ['channelId', 'userId'])
    .index('by_user', ['userId'])
    .index('by_channel', ['channelId']),
  messages: defineTable({
    channelId: v.id('channels'),
    authorId: v.id('users'),
    body: v.string(),
    sentAt: v.number(),
  })
    .index('by_channel_sentAt', ['channelId', 'sentAt'])
    .index('by_author', ['authorId']),
});
