// Forewarn Worker. Routes /agents/place-agent/<place> to the place's agent (chat over WebSocket)
// and /api/ask to a one-shot checked answer, for testing from the command line.
import { routeAgentRequest } from 'agents';
import { AIChatAgent } from '@cloudflare/ai-chat';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { model, SYSTEM, makeTools, checkNumbers, answer, type Env } from './harness';

// One agent per place. Later: followers, what it said last time, the 6-hourly check.
export class PlaceAgent extends AIChatAgent<Env> {
  async onChatMessage(onFinish: Parameters<AIChatAgent<Env>['onChatMessage']>[0], options?: Parameters<AIChatAgent<Env>['onChatMessage']>[1]) {
    const results: unknown[] = [];
    const last = this.messages.at(-1);
    const question = last?.parts?.map((p) => ('text' in p ? p.text : '')).join(' ') ?? '';
    const result = streamText({
      model: model(this.env), system: SYSTEM, tools: makeTools(results),
      messages: await convertToModelMessages(this.messages),
      stopWhen: stepCountIs(4), maxOutputTokens: 3000, providerOptions: { baseten: { reasoningEffort: 'low' } },
      abortSignal: options?.abortSignal,
      onFinish: async (event) => {
        // A streamed answer cannot be unsent, so for now the checker logs. The plan: hold the
        // final text until it passes, and stream the tool steps and 3D actions meanwhile.
        const bad = checkNumbers(event.text, results, question);
        if (bad.length) console.warn('checker: numbers not in tool results', bad);
        await onFinish(event as never);
      },
    });
    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/ask') {
      const q = url.searchParams.get('q');
      if (!q) return Response.json({ error: 'Add ?q= with a question.' }, { status: 400 });
      return Response.json(await answer(env, q));
    }
    return (await routeAgentRequest(req, env)) ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
