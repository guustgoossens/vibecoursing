import { NextRequest } from 'next/server';
import { withAuth } from '@workos-inc/authkit-nextjs';
import { fetchAction } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';
import { Mistral } from '@mistralai/mistralai';

type StreamEvent =
  | { type: 'prepared'; payload: { userMessage: { id: string; body: string; createdAt: number } } }
  | { type: 'delta'; token: string }
  | { type: 'final'; result: unknown }
  | { type: 'error'; message: string };

const encoder = new TextEncoder();

async function streamEvents(
  request: NextRequest,
  accessToken: string,
  body: { sessionId: string; prompt: string; followUpId?: string; temperature?: number },
) {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  const sendEvent = async (event: StreamEvent) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  };

  const abortHandler = () => {
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

      let aggregated = '';
      let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;

      for await (const chunk of stream) {
        const delta = chunk.data?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          aggregated += delta;
          await sendEvent({ type: 'delta', token: delta });
        }

        const chunkUsage = chunk.data?.usage;
        if (chunkUsage) {
          usage = {
            promptTokens: chunkUsage.prompt_tokens ?? usage?.promptTokens,
            completionTokens: chunkUsage.completion_tokens ?? usage?.completionTokens,
            totalTokens: chunkUsage.total_tokens ?? usage?.totalTokens,
          };
        }
      }

      if (aggregated.trim().length === 0) {
        throw new Error('Mistral returned an empty response');
      }

      const turn = await fetchAction(api.mistral.finalizeSessionTurn, {
        sessionId: prepared.sessionId,
        userMessageId: prepared.userMessageId,
        assistantBody: aggregated,
        usage,
      }, { token: accessToken });

      await sendEvent({ type: 'final', result: turn });
    } catch (error) {
      console.error('Session turn streaming failed', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      await sendEvent({ type: 'error', message });
    } finally {
      request.signal.removeEventListener('abort', abortHandler);
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
      sessionId,
      prompt,
      followUpId: typeof followUpId === 'string' ? followUpId : undefined,
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
