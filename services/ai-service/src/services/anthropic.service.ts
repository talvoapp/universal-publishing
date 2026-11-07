/**
 * Anthropic provider adapter — same interface as openai.service.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { ProviderUnavailableError } from '@/utils/errors';
import type { SuggestInput } from '@/types/index';
import type { StreamResult } from '@/services/openai.service';

const log = createLogger('anthropic.service');

export interface StreamOptions {
  input: SuggestInput;
  signal: AbortSignal;
  onChunk: (chunk: { delta: string }) => Promise<void> | void;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!config.providers.anthropic) {
    throw new ProviderUnavailableError('Anthropic not configured', 'ANTHROPIC_DISABLED');
  }
  if (!client) {
    client = new Anthropic({
      apiKey: config.providers.anthropic.apiKey,
      timeout: config.providers.anthropic.timeoutMs,
    });
  }
  return client;
}

export async function stream(opts: StreamOptions): Promise<StreamResult> {
  const anthropic = getClient();
  const model = config.providers.anthropic!.model;

  const sys =
    'You are an expert writing assistant. Respond with the edited or generated text only — no preamble, no explanation.';

  const instruction = opts.input.instruction ?? defaultInstructionFor(opts.input.operation);
  const toneNote = opts.input.tone ? ` Target tone: ${opts.input.tone}.` : '';
  const langNote = opts.input.targetLanguage ? ` Output language: ${opts.input.targetLanguage}.` : '';

  const userContent = [
    `Operation: ${opts.input.operation}.${toneNote}${langNote}`,
    `Instruction: ${instruction}`,
    '',
    '--- TEXT ---',
    opts.input.selection.text ?? '(no text supplied)',
    '--- END ---',
  ].join('\n');

  try {
    const stream = await anthropic.messages.create(
      {
        model,
        max_tokens: config.providers.anthropic!.maxOutputTokens,
        system: sys,
        messages: [{ role: 'user', content: userContent }],
        stream: true,
      },
      { signal: opts.signal },
    );

    let tokensIn = 0;
    let tokensOut = 0;
    let finishReason = 'stop';

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        await opts.onChunk({ delta: event.delta.text });
      }
      if (event.type === 'message_start') {
        tokensIn = event.message.usage.input_tokens;
      }
      if (event.type === 'message_delta') {
        if (event.usage?.output_tokens) tokensOut = event.usage.output_tokens;
        if (event.delta.stop_reason) finishReason = event.delta.stop_reason;
      }
    }

    return { tokensIn, tokensOut, finishReason, model };
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) throw err;
    const status = (err as { status?: number }).status;
    log.warn({ err, status }, 'Anthropic stream failed');
    throw new ProviderUnavailableError(
      `Anthropic stream failed${status ? ` (HTTP ${status})` : ''}`,
      'ANTHROPIC_FAILED',
    );
  }
}

function defaultInstructionFor(op: SuggestInput['operation']): string {
  switch (op) {
    case 'grammar':   return 'Fix all grammar, punctuation, and spelling errors. Do not change meaning.';
    case 'rephrase':  return 'Rewrite the text while preserving its meaning.';
    case 'summarize': return 'Produce a concise summary in 1-3 sentences.';
    case 'expand':    return 'Expand the text with more detail and examples, keeping the same voice.';
    case 'generate':  return 'Write new text based on the instruction, matching the provided style.';
  }
}