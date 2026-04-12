// chat/tasks/qa.ts

import { LlamaContext } from '../utils/types';
import { retrieveContext } from '../utils/rag/ragPipeline';

export const handleQA = async (
  context: LlamaContext,
  input: string,
  profileId?: string | null
): Promise<string> => {
  // ── RAG Retrieval ───────────────────────────────────────────────────────────
  let ragContext: string | null = null;

  if (profileId) {
    try {
      ragContext = await retrieveContext(input, profileId);
      console.log('[QA] RAG context retrieved:', ragContext ? 'YES (' + ragContext.length + ' chars)' : 'NONE');
    } catch (err) {
      console.warn('[QA] RAG retrieval failed:', err);
    }
  }

  // ── Build Prompt ──────────────────────────────────────────────────────────
  let finalPrompt = '';

  if (ragContext) {
    finalPrompt = 'You are Sundae, a helpful offline AI assistant running on the user\'s device.\n' +
      'Answer the user\'s question using ONLY the provided context below.\n' +
      'If the context does not contain enough information to answer, say "I don\'t have enough information in the uploaded documents to answer that."\n' +
      'Do NOT make up information. Stick strictly to what the context says.\n\n' +
      'Context:\n' + ragContext + '\n\n' +
      'Question:\n' + input;
  } else {
    finalPrompt = 'You are Sundae, a helpful offline AI assistant running on the user\'s device.\n' +
      'Answer clearly and concisely. If you don\'t know something, say so honestly.\n\n' +
      'Question: ' + input;
  }

  // ── Run LLM ──────────────────────────────────────────────────────────────
  const result = await context.completion({
    messages: [
      { role: 'user', content: finalPrompt }
    ],
    jinja: true,
    n_predict: 512,
    temperature: 0.1, // Ultra-low temp to stop creative hallucinations
    top_p: 0.9,
  });

  const response = result.text?.trim();

  if (!response) {
    throw new Error('Model returned empty response.');
  }

  return response;
};