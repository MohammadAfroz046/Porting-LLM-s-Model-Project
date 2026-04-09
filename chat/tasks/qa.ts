// chat/tasks/qa.ts

import { LlamaContext } from '../utils/types';

export const handleQA = async (
  context: LlamaContext,
  input: string
): Promise<string> => {
  let systemPrompt = `You are Sundae, a helpful offline AI assistant running on the user's device.
Answer clearly and concisely. If you don't know something, say so honestly.`;

  let userPrompt = input;


  // ── Build prompt ─────────────────────────────────────────────────────────────
  const prompt = `<|system|>
${systemPrompt}
<|user|>
${userPrompt}
<|assistant|>`;

  // ── Run LLM ──────────────────────────────────────────────────────────────────
  const result = await context.completion({
    prompt,
    n_predict: 512,
    temperature: 0.7,
    top_p: 0.9,
    stop: ['<|user|>', '<|system|>', '</s>'],
  });

  const response = result.text?.trim();

  if (!response) {
    throw new Error('Model returned empty response.');
  }

  return response;
};