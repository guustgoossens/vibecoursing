import { internal } from './_generated/api';
import { action, internalMutation, internalQuery } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { ConvexError, v } from 'convex/values';

const DEFAULT_MODEL = 'mistral-large-latest';
const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';
const RETRYABLE_STATUS = 429;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 400;
const DEFAULT_CHAT_MODEL = DEFAULT_MODEL;
const DEFAULT_CHAT_TEMPERATURE = 0.6;
const DEFAULT_CHAT_MAX_TOKENS = 2560;

type ChatRole = 'system' | 'user' | 'assistant';

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type MistralUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

type CallMistralOptions = {
  ctx: ActionCtx;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  messages: ChatMessage[];
};

type PhaseProgress = {
  index: number;
  name: string;
  objective: string;
  totalTerms: number;
  completedTerms: number;
  remainingTerms: string[];
  coveredTerms: string[];
  isComplete: boolean;
};

const messageSchema = v.object({
  role: v.union(v.literal('system'), v.literal('user'), v.literal('assistant')),
  content: v.string(),
});

const PLAN_SYSTEM_PROMPT = `You are an expert instructional designer assisting the Vibecoursing team.
Given a topic and optional learner context, respond with a concise JSON object that contains:
{
  "topic": string,
  "phases": [
    {
      "name": string,
      "objective": string,
      "keyTerms": string[]
    }
  ],
  "tone": string
}
Ensure the JSON is valid and contains 2-4 phases with at least three key terms each.`;

const FOLLOW_UP_SYSTEM_PROMPT = `You are a Socratic teaching assistant. Based on the recent conversation and the remaining key terms,
produce exactly three short follow-up question suggestions. Each prompt must be phrased as a question, stay under 120 characters,
and include a one sentence rationale explaining why it helps the learner progress. Respond with JSON in the format:
{
  "prompts": [
    {
      "prompt": string,
      "rationale": string
    }
  ]
}
Only include the JSON payload.`;

const RECAP_SYSTEM_PROMPT = `You are a concise learning companion. Summarize the learner's progress in under 120 words, reinforcing completed goals
and highlighting one suggestion for next time.`;

const SESSION_INTRO_SYSTEM_PROMPT = `You are Vibecoursing, a warm and proactive learning companion. Welcome the learner to their new topic, summarise what the plan covers, and recommend where to begin. Keep the response under 160 words and finish with an open question inviting them to dive in. Avoid markdown headings.`;

function cleanString(value?: string | null) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function normaliseForMatching(value: string): string {
  const withoutDiacritics = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  return withoutDiacritics
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseFollowUpPrompt(value?: string | null) {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return undefined;
  }
  const collapsed = cleaned.replace(/\s+/g, ' ');
  return collapsed.endsWith('?') ? collapsed : `${collapsed}?`;
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\n([\s\S]+?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  if (trimmed.startsWith('```')) {
    const withoutFence = trimmed.replace(/^```[a-zA-Z0-9]*\n?/, '').replace(/```$/, '');
    return withoutFence.trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  return trimmed;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requireUser(ctx: ActionCtx): Promise<Doc<'users'>> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError('NOT_AUTHENTICATED');
  }

  const user = (await ctx.runQuery(internal.mistral.getUserByExternalId, {
    externalId: identity.subject,
  })) as Doc<'users'> | null;

  if (!user) {
    throw new ConvexError('USER_PROFILE_MISSING');
  }

  return user;
}

type FollowUpSuggestion = {
  prompt: string;
  rationale: string | null;
};

function normaliseFollowUpSuggestions(payload: unknown): FollowUpSuggestion[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const rawPrompts = Array.isArray((payload as { prompts?: unknown }).prompts)
    ? ((payload as { prompts: unknown[] }).prompts)
    : [];

  const suggestions: FollowUpSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of rawPrompts) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const prompt = normaliseFollowUpPrompt((entry as { prompt?: unknown }).prompt as string | undefined);
    if (!prompt) {
      continue;
    }
    const signature = prompt.toLowerCase();
    if (seen.has(signature)) {
      continue;
    }
    const rationale = cleanString((entry as { rationale?: unknown }).rationale as string | undefined) ?? null;
    suggestions.push({ prompt, rationale });
    seen.add(signature);
    if (suggestions.length === 3) {
      break;
    }
  }

  return suggestions;
}

function ensureFollowUpCount(params: {
  suggestions: FollowUpSuggestion[];
  remainingTerms: string[];
  targetCount: number;
}): FollowUpSuggestion[] {
  const { suggestions, remainingTerms, targetCount } = params;
  if (suggestions.length >= targetCount) {
    return suggestions.slice(0, targetCount);
  }

  const result: FollowUpSuggestion[] = [...suggestions];
  const seen = new Set(result.map((item) => item.prompt.toLowerCase()));

  const uniqueRemainingTerms: string[] = [];
  const seenTerms = new Set<string>();
  for (const term of remainingTerms) {
    const cleaned = cleanString(term);
    if (!cleaned) {
      continue;
    }
    const signature = cleaned.toLowerCase();
    if (seenTerms.has(signature)) {
      continue;
    }
    seenTerms.add(signature);
    uniqueRemainingTerms.push(cleaned);
  }

  for (const term of uniqueRemainingTerms) {
    if (result.length >= targetCount) {
      break;
    }
    const prompt = normaliseFollowUpPrompt(`Can we explore "${term}" next`);
    if (!prompt) {
      continue;
    }
    const signature = prompt.toLowerCase();
    if (seen.has(signature)) {
      continue;
    }
    result.push({
      prompt,
      rationale: `Reinforces the remaining key term "${term}".`,
    });
    seen.add(signature);
  }

  if (result.length < targetCount) {
    const genericFallbacks = [
      {
        prompt: 'What should I practise next to keep making progress',
        rationale: 'Keeps the learner focused when no specific key terms remain.',
      },
      {
        prompt: 'Could you suggest an example so I can apply this now',
        rationale: 'Encourages immediate application of the latest concept.',
      },
    ];

    for (const fallback of genericFallbacks) {
      if (result.length >= targetCount) {
        break;
      }
      const prompt = normaliseFollowUpPrompt(fallback.prompt);
      if (!prompt) {
        continue;
      }
      const signature = prompt.toLowerCase();
      if (seen.has(signature)) {
        continue;
      }
      result.push({ prompt, rationale: fallback.rationale });
      seen.add(signature);
    }
  }

  return result.slice(0, targetCount);
}

async function generateFollowUpSuggestions(
  ctx: ActionCtx,
  transcript: ChatMessage[],
  remainingTerms: string[]
): Promise<FollowUpSuggestion[]> {
  try {
    const { content } = await callMistral({
      ctx,
      messages: [
        {
          role: 'user',
          content: `Recent transcript:\n${JSON.stringify(transcript)}\nRemaining key terms to cover: ${remainingTerms.join(', ') || 'none'}.`,
        },
      ],
      temperature: 0.5,
      maxTokens: 400,
      systemPrompt: FOLLOW_UP_SYSTEM_PROMPT,
    });

    const jsonPayload = extractJsonPayload(content);
    const parsed = JSON.parse(jsonPayload);
    return normaliseFollowUpSuggestions(parsed);
  } catch (error) {
    console.error('Follow-up suggestion generation failed', { error, remainingTerms });
    return [];
  }
}

async function refreshFollowUpSuggestions(params: {
  ctx: ActionCtx;
  sessionId: Id<'learningSessions'>;
  transcriptWithAssistant: ChatMessage[];
  phaseProgress: PhaseProgress[];
  assistantMessage: { id: Id<'sessionMessages'>; createdAt: number };
}): Promise<void> {
  const { ctx, sessionId, transcriptWithAssistant, phaseProgress, assistantMessage } = params;
  const remainingTerms = phaseProgress.flatMap((phase) => phase.remainingTerms);
  await sleep(1000);
  const suggestions = await generateFollowUpSuggestions(ctx, transcriptWithAssistant, remainingTerms);
  const completedSuggestions = ensureFollowUpCount({
    suggestions,
    remainingTerms,
    targetCount: 3,
  });

  await ctx.runMutation(internal.mistral.replaceSessionFollowUps, {
    sessionId,
    generatedForMessageId: assistantMessage.id,
    suggestions: completedSuggestions.map((suggestion) => ({
      prompt: suggestion.prompt,
      rationale: suggestion.rationale ?? undefined,
    })),
    createdAt: assistantMessage.createdAt,
  });
}

function detectCoveredTerms(body: string, terms: Doc<'sessionTerms'>[]): Doc<'sessionTerms'>[] {
  const normalisedBody = normaliseForMatching(body);
  const matches: Doc<'sessionTerms'>[] = [];
  for (const term of terms) {
    const candidate = term.term.trim();
    if (candidate.length === 0) {
      continue;
    }
    const normalisedCandidate = normaliseForMatching(candidate.split('(')[0] || candidate);
    if (normalisedCandidate.length === 0) {
      continue;
    }
    if (normalisedBody.includes(normalisedCandidate)) {
      matches.push(term);
    }
  }
  return matches;
}

function buildPhaseProgress(
  phases: Doc<'sessionPhases'>[],
  termState: Map<Id<'sessionTerms'>, Doc<'sessionTerms'>>
): PhaseProgress[] {
  return phases.map((phase) => {
    const termsForPhase: Doc<'sessionTerms'>[] = [];
    for (const term of termState.values()) {
      if (term.phaseIndex === phase.index) {
        termsForPhase.push(term);
      }
    }
    const coveredTerms = termsForPhase
      .filter((term) => term.firstCoveredAt !== undefined)
      .map((term) => term.term)
      .sort((a, b) => a.localeCompare(b));
    const remaining = termsForPhase
      .filter((term) => term.firstCoveredAt === undefined)
      .map((term) => term.term)
      .sort((a, b) => a.localeCompare(b));
    const completedTerms = coveredTerms.length;
    return {
      index: phase.index,
      name: phase.name,
      objective: phase.objective,
      totalTerms: termsForPhase.length,
      completedTerms,
      remainingTerms: remaining,
      coveredTerms,
      isComplete: termsForPhase.length > 0 && remaining.length === 0,
    };
  });
}

function buildPlanContext(session: Doc<'learningSessions'>, phaseProgress: PhaseProgress[]) {
  return {
    topic: session.topic,
    tone: session.planTone ?? session.tone ?? null,
    phases: phaseProgress.map((phase) => ({
      index: phase.index,
      name: phase.name,
      objective: phase.objective,
      remainingTerms: phase.remainingTerms,
      completedTerms: phase.completedTerms,
      totalTerms: phase.totalTerms,
    })),
  };
}

const mistralUsageValidator = v.object({
  promptTokens: v.optional(v.number()),
  completionTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
});

type SessionContextForTurn = {
  session: Doc<'learningSessions'>;
  phases: Doc<'sessionPhases'>[];
  terms: Doc<'sessionTerms'>[];
  transcript: Doc<'sessionMessages'>[];
};

type LoggedUserMessage = {
  message: {
    id: Id<'sessionMessages'>;
    body: string;
    createdAt: number;
  };
};

type RecordedAssistantTurn = {
  session: {
    id: Id<'learningSessions'>;
    topic: string;
    completedTerms: number;
    totalTerms: number;
    completedPhases: number;
    totalPhases: number;
    currentPhaseIndex: number | null;
    updatedAt: number;
  };
  assistantMessage: {
    id: Id<'sessionMessages'>;
    body: string;
    createdAt: number;
    termsCovered: string[];
    usage: MistralUsage | null;
  };
  newlyCoveredTerms: string[];
  phaseProgress: PhaseProgress[];
};

type SessionTurnResult = {
  session: RecordedAssistantTurn['session'];
  userMessage: LoggedUserMessage['message'];
  assistantMessage: RecordedAssistantTurn['assistantMessage'];
  newlyCoveredTerms: string[];
  phaseProgress: PhaseProgress[];
};

type PreparedSessionTurn = {
  sessionId: Id<'learningSessions'>;
  userMessageId: Id<'sessionMessages'>;
  userMessage: LoggedUserMessage['message'];
  messagesForMistral: ChatMessage[];
  temperature: number;
  maxTokens: number;
  model: string;
};

type PrepareSessionTurnParams = {
  sessionId: Id<'learningSessions'>;
  prompt: string;
  followUpId?: Id<'sessionFollowUps'>;
  temperature?: number;
};

type FinalizeSessionTurnParams = {
  sessionId: Id<'learningSessions'>;
  userMessageId: Id<'sessionMessages'>;
  assistantBody: string;
  usage?: MistralUsage;
};

export const getUserByExternalId = internalQuery({
  args: {
    externalId: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'users'> | null> => {
    return ctx.db
      .query('users')
      .withIndex('by_external_id', (q) => q.eq('externalId', args.externalId))
      .unique();
  },
});

export const getSessionContextForTurn = internalQuery({
  args: {
    sessionId: v.id('learningSessions'),
    userId: v.id('users'),
  },
  handler: async (ctx, args): Promise<SessionContextForTurn> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== args.userId) {
      throw new ConvexError('SESSION_NOT_FOUND');
    }

    const phases = await ctx.db
      .query('sessionPhases')
      .withIndex('by_session_index', (q) => q.eq('sessionId', args.sessionId))
      .collect();
    phases.sort((a, b) => a.index - b.index);

    const terms = await ctx.db
      .query('sessionTerms')
      .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
      .collect();

    const transcript = await ctx.db
      .query('sessionMessages')
      .withIndex('by_session_createdAt', (q) => q.eq('sessionId', args.sessionId))
      .order('desc')
      .take(40);
    transcript.reverse();

    return {
      session,
      phases,
      terms,
      transcript,
    };
  },
});

export const logSessionUserMessage = internalMutation({
  args: {
    sessionId: v.id('learningSessions'),
    userId: v.id('users'),
    body: v.string(),
    followUpId: v.optional(v.id('sessionFollowUps')),
  },
  handler: async (ctx, args): Promise<LoggedUserMessage> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== args.userId) {
      throw new ConvexError('SESSION_NOT_FOUND');
    }

    const trimmed = cleanString(args.body);
    if (!trimmed) {
      throw new ConvexError('EMPTY_MESSAGE');
    }
    if (trimmed.length > 2000) {
      throw new ConvexError('MESSAGE_TOO_LONG');
    }

    const createdAt = Date.now();
    const messageId = await ctx.db.insert('sessionMessages', {
      sessionId: session._id,
      role: 'user',
      body: trimmed,
      createdAt,
    });

    if (args.followUpId) {
      const followUp = await ctx.db.get(args.followUpId);
      if (!followUp || followUp.sessionId !== session._id) {
        throw new ConvexError('FOLLOW_UP_NOT_FOUND');
      }
      await ctx.db.patch(followUp._id, { usedAt: createdAt });
    }

    return {
      message: {
        id: messageId,
        body: trimmed,
        createdAt,
      },
    };
  },
});

export const replaceSessionFollowUps = internalMutation({
  args: {
    sessionId: v.id('learningSessions'),
    generatedForMessageId: v.id('sessionMessages'),
    suggestions: v.array(
      v.object({
        prompt: v.string(),
        rationale: v.optional(v.string()),
      })
    ),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new ConvexError('SESSION_NOT_FOUND');
    }

    const existing = await ctx.db
      .query('sessionFollowUps')
      .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
      .collect();

    for (const followUp of existing) {
      if (followUp.usedAt === undefined) {
        await ctx.db.delete(followUp._id);
      }
    }

    for (const suggestion of args.suggestions) {
      await ctx.db.insert('sessionFollowUps', {
        sessionId: args.sessionId,
        generatedForMessageId: args.generatedForMessageId,
        prompt: suggestion.prompt,
        rationale: suggestion.rationale ?? undefined,
        createdAt: args.createdAt,
      });
    }

    return { stored: args.suggestions.length };
  },
});

export const recordAssistantTurn = internalMutation({
  args: {
    sessionId: v.id('learningSessions'),
    assistantBody: v.string(),
    usage: v.optional(mistralUsageValidator),
  },
  handler: async (ctx, args): Promise<RecordedAssistantTurn> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new ConvexError('SESSION_NOT_FOUND');
    }

    const assistantBody = cleanString(args.assistantBody);
    if (!assistantBody) {
      throw new ConvexError('EMPTY_MESSAGE');
    }

    const phaseDocs = await ctx.db
      .query('sessionPhases')
      .withIndex('by_session_index', (q) => q.eq('sessionId', session._id))
      .collect();
    phaseDocs.sort((a, b) => a.index - b.index);

    const termDocs = await ctx.db
      .query('sessionTerms')
      .withIndex('by_session', (q) => q.eq('sessionId', session._id))
      .collect();

    const termState = new Map<Id<'sessionTerms'>, Doc<'sessionTerms'>>();
    for (const term of termDocs) {
      termState.set(term._id, term);
    }

    const coveredTerms = detectCoveredTerms(assistantBody, termDocs);
    const coveredTermNames = Array.from(new Set(coveredTerms.map((term) => term.term)));
    const newlyCoveredTerms: string[] = [];

    const assistantCreatedAt = Date.now();
    for (const term of coveredTerms) {
      const current = termState.get(term._id);
      if (!current) {
        continue;
      }
      const exposureCount = (current.exposureCount ?? 0) + 1;
      const firstCoveredAt = current.firstCoveredAt ?? assistantCreatedAt;
      await ctx.db.patch(term._id, {
        exposureCount,
        firstCoveredAt,
      });
      termState.set(term._id, {
        ...current,
        exposureCount,
        firstCoveredAt,
      });
      if (!current.firstCoveredAt) {
        newlyCoveredTerms.push(term.term);
      }
    }

    const assistantMessageId = await ctx.db.insert('sessionMessages', {
      sessionId: session._id,
      role: 'assistant',
      body: assistantBody,
      createdAt: assistantCreatedAt,
      termsCovered: coveredTermNames,
      promptTokens: args.usage?.promptTokens,
      completionTokens: args.usage?.completionTokens,
      totalTokens: args.usage?.totalTokens,
    });

    const usagePayload: MistralUsage | null = args.usage
      ? {
          promptTokens: args.usage.promptTokens,
          completionTokens: args.usage.completionTokens,
          totalTokens: args.usage.totalTokens,
        }
      : null;

    const phaseProgressAfter = buildPhaseProgress(phaseDocs, termState);
    const completedTermsCount = Array.from(termState.values()).filter((term) => term.firstCoveredAt !== undefined)
      .length;
    const completedPhasesCount = phaseProgressAfter.filter((phase) => phase.isComplete).length;
    const nextPhase = phaseProgressAfter.find((phase) => !phase.isComplete);
    const currentPhaseIndex = nextPhase ? nextPhase.index : null;

    await ctx.db.patch(session._id, {
      updatedAt: assistantCreatedAt,
      completedTerms: completedTermsCount,
      completedPhases: completedPhasesCount,
      currentPhaseIndex: currentPhaseIndex ?? undefined,
    });

    const updatedSession = await ctx.db.get(session._id);
    if (!updatedSession) {
      throw new ConvexError('SESSION_NOT_FOUND_AFTER_UPDATE');
    }

    return {
      session: {
        id: updatedSession._id,
        topic: updatedSession.topic,
        completedTerms: updatedSession.completedTerms,
        totalTerms: updatedSession.totalTerms,
        completedPhases: updatedSession.completedPhases,
        totalPhases: updatedSession.totalPhases,
        currentPhaseIndex: updatedSession.currentPhaseIndex ?? null,
        updatedAt: updatedSession.updatedAt,
      },
      assistantMessage: {
        id: assistantMessageId,
        body: assistantBody,
        createdAt: assistantCreatedAt,
        termsCovered: coveredTermNames,
        usage: usagePayload,
      },
      newlyCoveredTerms,
      phaseProgress: phaseProgressAfter,
    };
  },
});

async function prepareSessionTurnForUser(
  ctx: ActionCtx,
  user: Doc<'users'>,
  params: PrepareSessionTurnParams,
): Promise<PreparedSessionTurn> {
  const trimmedPrompt = cleanString(params.prompt);
  if (!trimmedPrompt) {
    throw new ConvexError('EMPTY_MESSAGE');
  }

  const sessionContext = (await ctx.runQuery(internal.mistral.getSessionContextForTurn, {
    sessionId: params.sessionId,
    userId: user._id,
  })) as SessionContextForTurn;

  const userMessageResult = (await ctx.runMutation(internal.mistral.logSessionUserMessage, {
    sessionId: params.sessionId,
    userId: user._id,
    body: trimmedPrompt,
    followUpId: params.followUpId ?? undefined,
  })) as LoggedUserMessage;

  const termState = new Map<Id<'sessionTerms'>, Doc<'sessionTerms'>>();
  for (const term of sessionContext.terms) {
    termState.set(term._id, term);
  }

  const phaseProgressBefore = buildPhaseProgress(sessionContext.phases, termState);
  const planContext = buildPlanContext(sessionContext.session, phaseProgressBefore);

  const transcriptMessages: ChatMessage[] = sessionContext.transcript.map((message) => ({
    role: message.role,
    content: message.body,
  }));
  transcriptMessages.push({ role: 'user', content: trimmedPrompt });

  const planMessage: ChatMessage | null = planContext
    ? {
        role: 'system',
        content: `Learning plan context:\n${JSON.stringify(planContext)}`,
      }
    : null;

  const messagesForMistral = planMessage ? [planMessage, ...transcriptMessages] : transcriptMessages;

  const temperature = params.temperature ?? DEFAULT_CHAT_TEMPERATURE;

  return {
    sessionId: params.sessionId,
    userMessageId: userMessageResult.message.id,
    userMessage: userMessageResult.message,
    messagesForMistral,
    temperature,
    maxTokens: DEFAULT_CHAT_MAX_TOKENS,
    model: DEFAULT_CHAT_MODEL,
  };
}

async function finalizeSessionTurnForUser(
  ctx: ActionCtx,
  user: Doc<'users'>,
  params: FinalizeSessionTurnParams,
): Promise<SessionTurnResult> {
  const assistantBody = cleanString(params.assistantBody);
  if (!assistantBody) {
    throw new ConvexError('EMPTY_MESSAGE');
  }

  const turnResult = (await ctx.runMutation(internal.mistral.recordAssistantTurn, {
    sessionId: params.sessionId,
    assistantBody,
    usage: params.usage
      ? {
          promptTokens: params.usage.promptTokens,
          completionTokens: params.usage.completionTokens,
          totalTokens: params.usage.totalTokens,
        }
      : undefined,
  })) as RecordedAssistantTurn;

  const sessionContextAfter = (await ctx.runQuery(internal.mistral.getSessionContextForTurn, {
    sessionId: params.sessionId,
    userId: user._id,
  })) as SessionContextForTurn;

  const transcriptWithAssistant: ChatMessage[] = sessionContextAfter.transcript.map((message) => ({
    role: message.role,
    content: message.body,
  }));

  await refreshFollowUpSuggestions({
    ctx,
    sessionId: params.sessionId,
    transcriptWithAssistant,
    phaseProgress: turnResult.phaseProgress,
    assistantMessage: {
      id: turnResult.assistantMessage.id,
      createdAt: turnResult.assistantMessage.createdAt,
    },
  });

  const userMessageDoc = sessionContextAfter.transcript.find(
    (message) => message._id === params.userMessageId && message.role === 'user',
  );

  if (!userMessageDoc) {
    throw new ConvexError('USER_MESSAGE_NOT_FOUND');
  }

  return {
    session: turnResult.session,
    userMessage: {
      id: userMessageDoc._id,
      body: userMessageDoc.body,
      createdAt: userMessageDoc.createdAt,
    },
    assistantMessage: turnResult.assistantMessage,
    newlyCoveredTerms: turnResult.newlyCoveredTerms,
    phaseProgress: turnResult.phaseProgress,
  };
}

async function callMistral({ ctx: _ctx, model, temperature, maxTokens, systemPrompt, messages }: CallMistralOptions) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new ConvexError('MISTRAL_API_KEY_NOT_CONFIGURED');
  }

  const baseUrl = process.env.MISTRAL_BASE_URL ?? DEFAULT_BASE_URL;
  const payloadMessages: ChatMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: model ?? DEFAULT_MODEL,
        temperature: temperature ?? 0.4,
        max_tokens: maxTokens ?? 800,
        messages: payloadMessages,
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      console.error('Mistral API error', response.status, text);
      const shouldRetry = response.status === RETRYABLE_STATUS && attempt < MAX_RETRIES;
      if (shouldRetry) {
        const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(backoffMs);
        attempt += 1;
        continue;
      }
      throw new ConvexError('MISTRAL_REQUEST_FAILED');
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch (error) {
      console.error('Failed to parse Mistral response JSON', { error, text });
      throw new ConvexError('MISTRAL_INVALID_JSON');
    }

    const content: string | undefined = json?.choices?.[0]?.message?.content;
    if (!content) {
      console.error('Mistral response missing content', json);
      throw new ConvexError('MISTRAL_EMPTY_RESPONSE');
    }

    const usage: MistralUsage = {
      promptTokens: json?.usage?.prompt_tokens,
      completionTokens: json?.usage?.completion_tokens,
      totalTokens: json?.usage?.total_tokens,
    };

    return {
      content,
      usage,
      raw: json,
    };
  }

  throw new ConvexError('MISTRAL_REQUEST_FAILED');
}

export const chatTurn = action({
  args: {
    messages: v.array(messageSchema),
    planContext: v.optional(v.any()),
    temperature: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const planMessage: ChatMessage | null = args.planContext
      ? {
          role: 'system',
          content: `Learning plan context:\n${JSON.stringify(args.planContext)}`,
        }
      : null;

    const messages: ChatMessage[] = planMessage ? [planMessage, ...args.messages] : args.messages;

    const { content, usage, raw } = await callMistral({
      ctx,
      messages,
      temperature: args.temperature ?? 0.6,
      maxTokens: 600,
      systemPrompt:
        'You are Vibecoursing, an enthusiastic and empathetic learning companion. Provide actionable guidance, keep replies under 180 words, and favour follow-up questions that reinforce key terms.',
    });

    return {
      message: content.trim(),
      usage,
      raw,
    };
  },
});

export const generatePlan = action({
  args: {
    topic: v.string(),
    learnerProfile: v.optional(v.string()),
    tone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { content, usage, raw } = await callMistral({
      ctx,
      messages: [
        {
          role: 'user',
          content: `Topic: ${args.topic}\nLearner profile: ${args.learnerProfile ?? 'General adult self-learner.'}\nPreferred tone: ${args.tone ?? 'Encouraging and pragmatic.'}`,
        },
      ],
      maxTokens: 1200,
      temperature: 0.3,
      systemPrompt: PLAN_SYSTEM_PROMPT,
    });

    let plan: unknown;
    const jsonPayload = extractJsonPayload(content);
    try {
      plan = JSON.parse(jsonPayload);
    } catch (error) {
      console.error('Plan generation JSON parse failed', { error, content });
      throw new ConvexError('MISTRAL_PLAN_PARSE_FAILED');
    }

    return { plan, usage, raw };
  },
});

export const generateFollowUps = action({
  args: {
    transcript: v.array(messageSchema),
    remainingTerms: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const seedMessages: ChatMessage[] = [
      {
        role: 'user',
        content: `Recent transcript:\n${JSON.stringify(args.transcript)}\nRemaining key terms to cover: ${(args.remainingTerms ?? []).join(', ') || 'none'}.`,
      },
    ];

    const { content, usage, raw } = await callMistral({
      ctx,
      messages: seedMessages,
      temperature: 0.5,
      maxTokens: 400,
      systemPrompt: FOLLOW_UP_SYSTEM_PROMPT,
    });

    const jsonPayload = extractJsonPayload(content);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonPayload);
    } catch (error) {
      console.error('Follow-up JSON parse failed', { error, content });
      throw new ConvexError('MISTRAL_FOLLOWUP_PARSE_FAILED');
    }

    const suggestions = normaliseFollowUpSuggestions(parsed);

    return { prompts: suggestions, suggestions, usage, raw };
  },
});

export const refreshSessionFollowUps = action({
  args: {
    sessionId: v.id('learningSessions'),
    assistantMessageId: v.optional(v.id('sessionMessages')),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError('NOT_AUTHENTICATED');
    }

    const user = (await ctx.runQuery(internal.mistral.getUserByExternalId, {
      externalId: identity.subject,
    })) as Doc<'users'> | null;
    if (!user) {
      throw new ConvexError('USER_PROFILE_MISSING');
    }

    const sessionContext = (await ctx.runQuery(internal.mistral.getSessionContextForTurn, {
      sessionId: args.sessionId,
      userId: user._id,
    })) as SessionContextForTurn;

    if (sessionContext.transcript.length === 0) {
      return { refreshed: false, reason: 'NO_MESSAGES' } as const;
    }

    let targetIndex = -1;
    if (args.assistantMessageId) {
      targetIndex = sessionContext.transcript.findIndex(
        (message) => message._id === args.assistantMessageId && message.role === 'assistant'
      );
    }

    if (targetIndex === -1) {
      for (let index = sessionContext.transcript.length - 1; index >= 0; index -= 1) {
        const candidate = sessionContext.transcript[index];
        if (candidate.role === 'assistant') {
          targetIndex = index;
          break;
        }
      }
    }

    if (targetIndex === -1) {
      return { refreshed: false, reason: 'NO_ASSISTANT_MESSAGE' } as const;
    }

    const assistantMessage = sessionContext.transcript[targetIndex];
    const transcriptWithAssistant: ChatMessage[] = sessionContext.transcript
      .slice(0, targetIndex + 1)
      .map((message) => ({ role: message.role, content: message.body }));

    const termState = new Map<Id<'sessionTerms'>, Doc<'sessionTerms'>>();
    for (const term of sessionContext.terms) {
      termState.set(term._id, term);
    }
    const phaseProgress = buildPhaseProgress(sessionContext.phases, termState);

    await refreshFollowUpSuggestions({
      ctx,
      sessionId: args.sessionId,
      transcriptWithAssistant,
      phaseProgress,
      assistantMessage: { id: assistantMessage._id, createdAt: assistantMessage.createdAt },
    });

    return { refreshed: true } as const;
  },
});

export const generateRecap = action({
  args: {
    transcript: v.array(messageSchema),
    completedTerms: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { content, usage, raw } = await callMistral({
      ctx,
      messages: [
        {
          role: 'user',
          content: `Provide a recap with emphasis on the completed terms: ${(args.completedTerms ?? []).join(', ') || 'none'}. Recent transcript:\n${JSON.stringify(args.transcript)}`,
        },
      ],
      temperature: 0.4,
      maxTokens: 300,
      systemPrompt: RECAP_SYSTEM_PROMPT,
    });

    return {
      recap: content.trim(),
      usage,
    raw,
  };
  },
});

export const prepareSessionTurn = action({
  args: {
    sessionId: v.id('learningSessions'),
    prompt: v.string(),
    followUpId: v.optional(v.id('sessionFollowUps')),
    temperature: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return prepareSessionTurnForUser(ctx, user, args as PrepareSessionTurnParams);
  },
});

export const finalizeSessionTurn = action({
  args: {
    sessionId: v.id('learningSessions'),
    userMessageId: v.id('sessionMessages'),
    assistantBody: v.string(),
    usage: v.optional(mistralUsageValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return finalizeSessionTurnForUser(ctx, user, args as FinalizeSessionTurnParams);
  },
});

export const runSessionTurn = action({
  args: {
    sessionId: v.id('learningSessions'),
    prompt: v.string(),
    followUpId: v.optional(v.id('sessionFollowUps')),
    temperature: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SessionTurnResult> => {
    const user = await requireUser(ctx);

    const prepared = await prepareSessionTurnForUser(ctx, user, {
      sessionId: args.sessionId,
      prompt: args.prompt,
      followUpId: args.followUpId ?? undefined,
      temperature: args.temperature ?? undefined,
    });

    const { content, usage } = await callMistral({
      ctx,
      messages: prepared.messagesForMistral,
      model: prepared.model,
      temperature: prepared.temperature,
      maxTokens: prepared.maxTokens,
      systemPrompt:
        'You are Vibecoursing, an enthusiastic and empathetic learning companion. Provide actionable guidance, keep replies under 180 words, and favour follow-up questions that reinforce key terms.',
    });

    return finalizeSessionTurnForUser(ctx, user, {
      sessionId: prepared.sessionId,
      userMessageId: prepared.userMessageId,
      assistantBody: content,
      usage,
    });
  },
});

export const startSessionIntroduction = action({
  args: {
    sessionId: v.id('learningSessions'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError('NOT_AUTHENTICATED');
    }

    const user = (await ctx.runQuery(internal.mistral.getUserByExternalId, {
      externalId: identity.subject,
    })) as Doc<'users'> | null;
    if (!user) {
      throw new ConvexError('USER_PROFILE_MISSING');
    }

    const sessionContext = (await ctx.runQuery(internal.mistral.getSessionContextForTurn, {
      sessionId: args.sessionId,
      userId: user._id,
    })) as SessionContextForTurn;

    if (sessionContext.transcript.length > 0) {
      return { alreadyInitialized: true };
    }

    const termState = new Map<Id<'sessionTerms'>, Doc<'sessionTerms'>>();
    for (const term of sessionContext.terms) {
      termState.set(term._id, term);
    }

    const phaseProgressBefore = buildPhaseProgress(sessionContext.phases, termState);
    const planContext = buildPlanContext(sessionContext.session, phaseProgressBefore);

    const introMessage: ChatMessage = {
      role: 'user',
      content: `Learning plan context:\n${JSON.stringify(planContext)}\nDraft a friendly welcome that previews the phases, highlights the first suggested action, and invites the learner to respond.`,
    };

    const { content, usage } = await callMistral({
      ctx,
      messages: [introMessage],
      temperature: 0.45,
      maxTokens: 420,
      systemPrompt: SESSION_INTRO_SYSTEM_PROMPT,
    });

    const assistantBody = content.trim();

    const turnResult = (await ctx.runMutation(internal.mistral.recordAssistantTurn, {
      sessionId: args.sessionId,
      assistantBody,
      usage: usage ?? undefined,
    })) as RecordedAssistantTurn;

    const transcriptMessages: ChatMessage[] = sessionContext.transcript.map((message) => ({
      role: message.role,
      content: message.body,
    }));
    const transcriptWithAssistant: ChatMessage[] = [...transcriptMessages, { role: 'assistant', content: assistantBody }];

    await refreshFollowUpSuggestions({
      ctx,
      sessionId: args.sessionId,
      transcriptWithAssistant,
      phaseProgress: turnResult.phaseProgress,
      assistantMessage: {
        id: turnResult.assistantMessage.id,
        createdAt: turnResult.assistantMessage.createdAt,
      },
    });

    return {
      alreadyInitialized: false,
      session: turnResult.session,
      assistantMessage: turnResult.assistantMessage,
      phaseProgress: turnResult.phaseProgress,
    };
  },
});
