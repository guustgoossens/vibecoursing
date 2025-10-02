import { action } from './_generated/server';
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

async function fetchUserByExternalId(ctx: ActionCtx, externalId: string) {
  return ctx.db
    .query('users')
    .withIndex('by_external_id', (q) => q.eq('externalId', externalId))
    .unique();
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
    try {
      plan = JSON.parse(content);
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
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError('NOT_AUTHENTICATED');
    }

    const user = await fetchUserByExternalId(ctx, identity.subject);
    if (!user) {
      throw new ConvexError('USER_PROFILE_MISSING');
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== user._id) {
      throw new ConvexError('SESSION_NOT_FOUND');
    }

    let followUp: Doc<'sessionFollowUps'> | null = null;
    if (args.followUpId) {
      followUp = await ctx.db.get(args.followUpId);
      if (!followUp || followUp.sessionId !== session._id) {
        throw new ConvexError('FOLLOW_UP_NOT_FOUND');
      }
    }

    const trimmedPrompt = cleanString(args.prompt);
    if (!trimmedPrompt) {
      throw new ConvexError('EMPTY_MESSAGE');
    }

    const userCreatedAt = Date.now();
    const userMessageId = await ctx.db.insert('sessionMessages', {
      sessionId: session._id,
      role: 'user',
      body: trimmedPrompt,
      createdAt: userCreatedAt,
    });

    if (followUp) {
      await ctx.db.patch(followUp._id, { usedAt: userCreatedAt });
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

    const phaseProgressBefore = buildPhaseProgress(phaseDocs, termState);
    const planContext = buildPlanContext(session, phaseProgressBefore);

    const transcriptDocs = await ctx.db
      .query('sessionMessages')
      .withIndex('by_session_createdAt', (q) => q.eq('sessionId', session._id))
      .order('desc')
      .take(40);
    transcriptDocs.reverse();

    const transcriptMessages: ChatMessage[] = transcriptDocs.map((message) => ({
      role: message.role,
      content: message.body,
    }));

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
    const assistantCreatedAt = Date.now();
    const coveredTerms = detectCoveredTerms(assistantBody, termDocs);
    const coveredTermNames = Array.from(new Set(coveredTerms.map((term) => term.term)));
    const newlyCoveredTerms: string[] = [];

    for (const term of coveredTerms) {
      const currentState = termState.get(term._id);
      if (!currentState) {
        continue;
      }
      const exposureCount = (currentState.exposureCount ?? 0) + 1;
      const firstCoveredAt = currentState.firstCoveredAt ?? assistantCreatedAt;
      await ctx.db.patch(term._id, {
        exposureCount,
        firstCoveredAt,
      });
      termState.set(term._id, {
        ...currentState,
        exposureCount,
        firstCoveredAt,
      });
      if (!currentState.firstCoveredAt) {
        newlyCoveredTerms.push(term.term);
      }
    }

    const assistantMessageId = await ctx.db.insert('sessionMessages', {
      sessionId: session._id,
      role: 'assistant',
      body: assistantBody,
      createdAt: assistantCreatedAt,
      termsCovered: coveredTermNames,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      totalTokens: usage?.totalTokens,
    });

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
      userMessage: {
        id: userMessageId,
        body: trimmedPrompt,
        createdAt: userCreatedAt,
      },
      assistantMessage: {
        id: assistantMessageId,
        body: assistantBody,
        createdAt: assistantCreatedAt,
        termsCovered: coveredTermNames,
        usage,
      },
      newlyCoveredTerms,
      phaseProgress: phaseProgressAfter,
    };
  },
});
