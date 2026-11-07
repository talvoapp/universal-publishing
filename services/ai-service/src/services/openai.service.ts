/**
 * OpenAI provider adapter.
 *
 * Exposes a single `stream()` function that yields text deltas and
 * finally a `usage` object. The fallback service composes this with
 * the Anthropic adapter.
 *
 * Provider errors are normalized: any OpenAI error becomes a
 * `ProviderError` with a `retryable` flag the fallback layer uses to
 * decide whether to try the next provider.
 */

import OpenAI from 'openai';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { ProviderUnavailableError } from '@/utils/errors';
import type { SuggestInput } from '@/types/index';

const log = createLogger('openai.service');

// ============================================================
// TYPES
// ============================================================
export interface StreamChunk {
  delta: string;
}

export interface StreamResult {
  tokensIn: number;
  tokensOut: number;
  finishReason: string;
  model: string;
}

export interface StreamOptions {
  input: SuggestInput;
  signal: AbortSignal;
  onChunk: (chunk: StreamChunk) => Promise<void> | void;
}

// ============================================================
// CLIENT (lazy singleton)
// ============================================================
let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!config.providers.openai) {
    throw new ProviderUnavailableError('OpenAI not configured', 'OPENAI_DISABLED');
  }
  if (!client) {
    client = new OpenAI({
      apiKey: config.providers.openai.apiKey,
      timeout: config.providers.openai.timeoutMs,
    });
  }
  return client;
}

// ============================================================
// STREAM
// ============================================================
export async function stream(opts: StreamOptions): Promise<StreamResult> {
  const openai = getClient();
  const model = config.providers.openai!.model;
  const messages = buildMessages(opts.input);

  try {
    const stream = await openai.chat.completions.create(
      {
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: config.providers.openai!.maxOutputTokens,
        stream_options: { include_usage: true },
      },
      { signal: opts.signal },
    );

    let tokensIn = 0;
    let tokensOut = 0;
    let finishReason = 'stop';

    for await (const event of stream) {
      if (event.choices?.[0]?.delta?.content) {
        await opts.onChunk({ delta: event.choices[0].delta.content });
      }
      if (event.choices?.[0]?.finish_reason) {
        finishReason = event.choices[0].finish_reason;
      }
      if (event.usage) {
        tokensIn = event.usage.prompt_tokens;
        tokensOut = event.usage.completion_tokens;
      }
    }

    return { tokensIn, tokensOut, finishReason, model };
  } catch (err) {
    if (err instanceof OpenAI.APIUserAbortError) {
      throw err; // propagate abort — caller handles
    }
    const status = (err as { status?: number }).status;
    log.warn({ err, status }, 'OpenAI stream failed');
    throw new ProviderUnavailableError(
      `OpenAI stream failed${status ? ` (HTTP ${status})` : ''}`,
      'OPENAI_FAILED',
    );
  }
}

// ============================================================
// PROMPT BUILDING
// ============================================================
function buildMessages(input: SuggestInput): OpenAI.Chat.ChatCompletionMessageParam[] {
  const sys = [
    'You are an expert writing assistant embedded in a publishing platform.',
    'Respond with the edited or generated text only — no preamble, no explanation.',
    'Preserve the author\'s voice and tone unless explicitly asked to change it.',
  ].join(' ');

  const instruction =
    input.instruction ??
    defaultInstructionFor(input.operation);

  const toneNote = input.tone ? ` Target tone: ${input.tone}.` : '';
  const langNote = input.targetLanguage ? ` Output language: ${input.targetLanguage}.` : '';

  const userContent = [
    `Operation: ${input.operation}.${toneNote}${langNote}`,
    `Instruction: ${instruction}`,
    '',
    '--- TEXT ---',
    input.selection.text ?? '(no text supplied)',
    '--- END ---',
  ].join('\n');

  return [
    { role: 'system', content: sys },
    { role: 'user', content: userContent },
  ];
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