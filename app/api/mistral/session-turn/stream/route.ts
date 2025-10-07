import { NextRequest } from 'next/server';
import { withAuth } from '@workos-inc/authkit-nextjs';
import { fetchAction } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';
import { Mistral } from '@mistralai/mistralai';
import { Id } from '@/convex/_generated/dataModel';

type StreamEvent =
  | { type: 'prepared'; payload: { userMessage: { id: string; body: string; createdAt: number } } }
  | { type: 'delta'; token: string }
  | { type: 'final'; result: unknown }
  | { type: 'error'; message: string };

const encoder = new TextEncoder();
const STREAM_LOG_PREFIX = '[MistralStream]';

async function streamEvents(
  request: NextRequest,
  accessToken: string,
  body: {
    sessionId: Id<'learningSessions'>;
    prompt: string;
    followUpId?: Id<'sessionFollowUps'>;
    temperature?: number;
  },
) {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  const sendEvent = async (event: StreamEvent) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  };

  const abortHandler = () => {
    console.warn(`${STREAM_LOG_PREFIX} client aborted stream`, {
      sessionId: body.sessionId,
    });
    writer.close().catch(() => {
      // noop
    });
  };

  request.signal.addEventListener('abort', abortHandler);

  (async () => {
    try {
      const prepared = await fetchAction(api.mistral.prepareSessionTurn, {
        sessionId: body.sessionId,
        prompt: body.prompt,
        followUpId: body.followUpId,
        temperature: body.temperature,
      }, { token: accessToken });

      console.info(`${STREAM_LOG_PREFIX} prepared turn`, {
        sessionId: prepared.sessionId,
        userMessageId: prepared.userMessageId,
        followUpId: body.followUpId ?? null,
        model: prepared.model,
        temperature: prepared.temperature,
        maxTokens: prepared.maxTokens,
      });

      await sendEvent({
        type: 'prepared',
        payload: { userMessage: prepared.userMessage },
      });

      const apiKey = process.env.MISTRAL_API_KEY;
      if (!apiKey) {
        throw new Error('MISTRAL_API_KEY_NOT_CONFIGURED');
      }

      const client = new Mistral({ apiKey });
      const stream = await client.chat.stream({
        model: prepared.model,
        temperature: prepared.temperature,
        maxTokens: prepared.maxTokens,
        messages: prepared.messagesForMistral,
      });

      console.info(`${STREAM_LOG_PREFIX} started mistral stream`, {
        sessionId: prepared.sessionId,
        userMessageId: prepared.userMessageId,
        promptLength: body.prompt.length,
      });

      let aggregated = '';
      let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
      let chunkIndex = 0;
      let lastFinishReason: string | null = null;

      for await (const chunk of stream) {
        chunkIndex += 1;
        const deltaPayload = chunk.data?.choices?.[0]?.delta?.content;
        let deltaText = '';
        if (typeof deltaPayload === 'string') {
          deltaText = deltaPayload;
        } else if (Array.isArray(deltaPayload)) {
          deltaText = deltaPayload
            .map((part) => {
              if (!part) {
                return '';
              }
              if (typeof part === 'string') {
                return part;
              }
              const chunkPart = part as {
                text?: unknown;
                content?: unknown;
                delta?: unknown;
              };
              const maybeText =
                typeof chunkPart.text === 'string'
                  ? chunkPart.text
                  : typeof chunkPart.content === 'string'
                    ? chunkPart.content
                    : typeof chunkPart.delta === 'string'
                      ? chunkPart.delta
                      : '';
              return maybeText ?? '';
            })
            .join('');
        }

        const finishReason = chunk.data?.choices?.[0]?.finishReason ?? null;
        const hasUsage = Boolean(chunk.data?.usage);

        if (finishReason) {
          lastFinishReason = finishReason;
        }

        if (deltaText.length > 0) {
          aggregated += deltaText;
          await sendEvent({ type: 'delta', token: deltaText });
          console.info(`${STREAM_LOG_PREFIX} delta`, {
            sessionId: prepared.sessionId,
            userMessageId: prepared.userMessageId,
            chunkIndex,
            deltaLength: deltaText.length,
            aggregatedLength: aggregated.length,
            finishReason,
          });
        }

        if (finishReason || (!deltaText && hasUsage)) {
          console.info(`${STREAM_LOG_PREFIX} non-content chunk`, {
            sessionId: prepared.sessionId,
            userMessageId: prepared.userMessageId,
            chunkIndex,
            finishReason,
            hasUsage,
          });
        }

        const chunkUsage = chunk.data?.usage;
        if (chunkUsage) {
          usage = {
            promptTokens: chunkUsage.promptTokens ?? usage?.promptTokens,
            completionTokens: chunkUsage.completionTokens ?? usage?.completionTokens,
            totalTokens: chunkUsage.totalTokens ?? usage?.totalTokens,
          };
          console.info(`${STREAM_LOG_PREFIX} usage update`, {
            sessionId: prepared.sessionId,
            userMessageId: prepared.userMessageId,
            usage,
          });
        }
      }

      if (aggregated.trim().length === 0) {
        throw new Error('Mistral returned an empty response');
      }

      console.info(`${STREAM_LOG_PREFIX} finalizing turn`, {
        sessionId: prepared.sessionId,
        userMessageId: prepared.userMessageId,
        aggregatedLength: aggregated.length,
      });

      const turn = await fetchAction(api.mistral.finalizeSessionTurn, {
        sessionId: prepared.sessionId,
        userMessageId: prepared.userMessageId,
        assistantBody: aggregated,
        usage,
      }, { token: accessToken });

      const persistedBody =
        typeof turn.assistantMessage?.body === 'string' ? turn.assistantMessage.body : null;
      const assistantBodyLength = persistedBody?.length ?? null;
      const persistedMismatch = persistedBody && persistedBody !== aggregated;

      if (persistedMismatch) {
        console.warn(`${STREAM_LOG_PREFIX} persisted body mismatch`, {
          sessionId: prepared.sessionId,
          userMessageId: prepared.userMessageId,
          aggregatedLength: aggregated.length,
          persistedLength: assistantBodyLength,
        });
      }

      console.info(`${STREAM_LOG_PREFIX} finalized`, {
        sessionId: prepared.sessionId,
        userMessageId: prepared.userMessageId,
        assistantMessageId: turn.assistantMessage?.id ?? null,
        completionTokens: turn.assistantMessage?.usage?.completionTokens ?? null,
        assistantBodyLength,
      });

      await sendEvent({
        type: 'final',
        result: {
          ...turn,
          streamMeta: {
            finishReason: lastFinishReason,
          },
        },
      });
    } catch (error) {
      console.error(`${STREAM_LOG_PREFIX} stream failed`, {
        sessionId: body.sessionId,
        error,
      });
      const message = error instanceof Error ? error.message : 'Unknown error';
      await sendEvent({ type: 'error', message });
    } finally {
      request.signal.removeEventListener('abort', abortHandler);
      console.info(`${STREAM_LOG_PREFIX} closing stream`, {
        sessionId: body.sessionId,
      });
      await writer.close();
    }
  })();

  return readable;
}

export async function POST(request: NextRequest) {
  let accessToken: string | null = null;
  try {
    const auth = await withAuth();
    accessToken = auth.accessToken ?? null;
  } catch (error) {
    console.error('withAuth failed for streaming route', error);
    return new Response('Unauthorized', { status: 401 });
  }

  if (!accessToken) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!payload || typeof payload !== 'object') {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { sessionId, prompt, followUpId, temperature } = payload as {
    sessionId?: unknown;
    prompt?: unknown;
    followUpId?: unknown;
    temperature?: unknown;
  };

  if (typeof sessionId !== 'string' || typeof prompt !== 'string') {
    return new Response(JSON.stringify({ error: 'sessionId and prompt are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const readable = await streamEvents(
    request,
    accessToken,
    {
      sessionId: sessionId as Id<'learningSessions'>,
      prompt,
      followUpId:
        typeof followUpId === 'string' ? (followUpId as Id<'sessionFollowUps'>) : undefined,
      temperature: typeof temperature === 'number' ? temperature : undefined,
    },
  );

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
