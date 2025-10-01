import { action } from './_generated/server';
import type { ActionCtx } from './_generated/server';
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
