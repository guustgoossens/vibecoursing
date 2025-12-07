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
  learningSessions: defineTable({
    userId: v.id('users'),
    topic: v.string(),
    tone: v.optional(v.string()),
    planTone: v.optional(v.string()),
    planSummary: v.optional(v.string()),
    currentPhaseIndex: v.optional(v.number()),
    totalPhases: v.number(),
    completedPhases: v.number(),
    totalTerms: v.number(),
    completedTerms: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_user_updatedAt', ['userId', 'updatedAt'])
    .index('by_updatedAt', ['updatedAt']),
  sessionPhases: defineTable({
    sessionId: v.id('learningSessions'),
    index: v.number(),
    name: v.string(),
    objective: v.string(),
    completedAt: v.optional(v.number()),
  })
    .index('by_session', ['sessionId'])
    .index('by_session_index', ['sessionId', 'index']),
  sessionTerms: defineTable({
    sessionId: v.id('learningSessions'),
    phaseIndex: v.number(),
    term: v.string(),
    firstCoveredAt: v.optional(v.number()),
    exposureCount: v.optional(v.number()),
  })
    .index('by_session', ['sessionId'])
    .index('by_session_term', ['sessionId', 'term'])
    .index('by_session_phase', ['sessionId', 'phaseIndex']),
  sessionMessages: defineTable({
    sessionId: v.id('learningSessions'),
    role: v.union(v.literal('user'), v.literal('assistant')),
    body: v.string(),
    createdAt: v.number(),
    termsCovered: v.optional(v.array(v.string())),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
  }).index('by_session_createdAt', ['sessionId', 'createdAt']),
  sessionFollowUps: defineTable({
    sessionId: v.id('learningSessions'),
    generatedForMessageId: v.id('sessionMessages'),
    prompt: v.string(),
    rationale: v.optional(v.string()),
    createdAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index('by_session', ['sessionId'])
    .index('by_message', ['generatedForMessageId']),
  userRateLimits: defineTable({
    userId: v.id('users'),
    windowStart: v.number(),
    requestCount: v.number(),
  }).index('by_user', ['userId']),
});
