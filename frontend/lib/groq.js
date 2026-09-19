import Groq from 'groq-sdk'

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
})

// Token-optimized model budget: cheap model for classification/analysis,
// higher-end model only for quality-sensitive long-form writing.
// GPT-OSS returns the answer in `content` (reasoning goes to a separate field),
// which matches how callAI reads responses; Qwen3 emits inline thinking that
// breaks our JSON extraction. Model IDs depend on Groq account access.
export const CHEAP_MODEL = 'openai/gpt-oss-20b';
export const ARTICLE_MODEL = 'openai/gpt-oss-120b';

// Cap the number of sources packed into a prompt. Long source lists mostly
// repeat redundant facts and inflate input tokens without helping quality.
export function capSourcesForPrompt(sources, max = 5) {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, max);
}

export async function callAI(systemPrompt, userMessage, options = {}) {
  const response = await groq.chat.completions.create({
    model: options.model || ARTICLE_MODEL,
    max_tokens: options.maxTokens || 2000,
    temperature: options.temperature || 0.8,
    reasoning_effort: options.reasoningEffort || 'low',
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userMessage }
    ]
  })
  return response.choices[0]?.message?.content || ''
}
