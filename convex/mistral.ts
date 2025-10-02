import { internal } from './_generated/api';
import { action, internalMutation, internalQuery } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { ConvexError, v } from 'convex/values';

const DEFAULT_MODEL = 'mistral-large-latest';
const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';

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
produce up to three short follow-up prompt suggestions. Respond with JSON in the format:
{
  "prompts": [
    {
      "prompt": string,
      "rationale": string
    }
  ]
}`;

const RECAP_SYSTEM_PROMPT = `You are a concise learning companion. Summarize the learner's progress in under 120 words, reinforcing completed goals
and highlighting one suggestion for next time.`;

function cleanString(value?: string | null) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
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

function detectCoveredTerms(body: string, terms: Doc<'sessionTerms'>[]): Doc<'sessionTerms'>[] {
  const lowerBody = body.toLowerCase();
  const matches: Doc<'sessionTerms'>[] = [];
  for (const term of terms) {
    const candidate = term.term.trim().toLowerCase();
    if (candidate.length === 0) {
      continue;
    }
    if (lowerBody.includes(candidate)) {
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
    const remaining = termsForPhase.filter((term) => term.firstCoveredAt === undefined).map((term) => term.term);
    const completedTerms = termsForPhase.length - remaining.length;
    return {
      index: phase.index,
      name: phase.name,
      objective: phase.objective,
      totalTerms: termsForPhase.length,
      completedTerms,
      remainingTerms: remaining,
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

async function callMistral({ ctx: _ctx, model, temperature, maxTokens, systemPrompt, messages }: CallMistralOptions) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new ConvexError('MISTRAL_API_KEY_NOT_CONFIGURED');
  }

  const baseUrl = process.env.MISTRAL_BASE_URL ?? DEFAULT_BASE_URL;
  const payloadMessages: ChatMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

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

    let prompts: unknown;
    try {
      prompts = JSON.parse(content);
    } catch (error) {
      console.error('Follow-up JSON parse failed', { error, content });
      throw new ConvexError('MISTRAL_FOLLOWUP_PARSE_FAILED');
    }

    return { prompts, usage, raw };
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

export const runSessionTurn = action({
  args: {
    sessionId: v.id('learningSessions'),
    prompt: v.string(),
    followUpId: v.optional(v.id('sessionFollowUps')),
    temperature: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SessionTurnResult> => {
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

    const trimmedPrompt = cleanString(args.prompt);
    if (!trimmedPrompt) {
      throw new ConvexError('EMPTY_MESSAGE');
    }

    const sessionContext = (await ctx.runQuery(internal.mistral.getSessionContextForTurn, {
      sessionId: args.sessionId,
      userId: user._id,
    })) as SessionContextForTurn;

    const { session, phases, terms, transcript } = sessionContext;

    const userMessageResult = (await ctx.runMutation(internal.mistral.logSessionUserMessage, {
      sessionId: args.sessionId,
      userId: user._id,
      body: trimmedPrompt,
      followUpId: args.followUpId ?? undefined,
    })) as LoggedUserMessage;

    const termState = new Map<Id<'sessionTerms'>, Doc<'sessionTerms'>>();
    for (const term of terms) {
      termState.set(term._id, term);
    }

    const phaseProgressBefore = buildPhaseProgress(phases, termState);
    const planContext = buildPlanContext(session, phaseProgressBefore);

    const transcriptMessages: ChatMessage[] = transcript.map((message) => ({
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

    const { content, usage } = await callMistral({
      ctx,
      messages: messagesForMistral,
      temperature: args.temperature ?? 0.6,
      maxTokens: 600,
      systemPrompt:
        'You are Vibecoursing, an enthusiastic and empathetic learning companion. Provide actionable guidance, keep replies under 180 words, and favour follow-up questions that reinforce key terms.',
    });
    const assistantBody = content.trim();

    const turnResult = (await ctx.runMutation(internal.mistral.recordAssistantTurn, {
      sessionId: args.sessionId,
      assistantBody,
      usage: usage ?? undefined,
    })) as RecordedAssistantTurn;

    return {
      session: turnResult.session,
      userMessage: userMessageResult.message,
      assistantMessage: turnResult.assistantMessage,
      newlyCoveredTerms: turnResult.newlyCoveredTerms,
      phaseProgress: turnResult.phaseProgress,
    };
  },
});
