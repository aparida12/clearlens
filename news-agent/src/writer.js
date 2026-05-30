const https = require('https');
require('dotenv').config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = 'llama-3.3-70b-versatile';

function groqRequest(messages, maxTokens = 2000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature: 0.4, messages });
    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.choices[0].message.content.trim());
        } catch (err) { reject(new Error('Failed to parse Groq response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Score each source's stance on the central claim
async function scoreSources(sources, topic) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');

  const sourceList = sources.map((s, i) =>
    `SOURCE ${i + 1} (${s.outlet}):\n${(s.content || s.snippet || '').slice(0, 800)}`
  ).join('\n\n---\n\n');

  const prompt = `You are analyzing news sources for bias and stance detection.

TOPIC: "${topic}"

SOURCES:
${sourceList}

For each source, determine its stance on the central claim of the topic.
Respond ONLY with valid JSON in this exact format, nothing else:
{
  "centralClaim": "one sentence stating the main claim being evaluated",
  "sources": [
    {"outlet": "outlet name", "stance": "supports|disputes|mixed|neutral", "reason": "one sentence explanation"}
  ],
  "consensusSummary": "one sentence summarizing overall agreement or disagreement"
}`;

  const raw = await groqRequest([{ role: 'user', content: prompt }], 1000);

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    // Return a basic structure if parsing fails
    return {
      centralClaim: topic,
      sources: sources.map(s => ({ outlet: s.outlet, stance: 'neutral', reason: 'Analysis unavailable' })),
      consensusSummary: 'Multiple sources covered this topic.',
    };
  }
}

// Generate the main article
async function generateArticle(item, research) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');

  const sourceContent = research.sources.map((s, i) =>
    `SOURCE ${i + 1} - ${s.outlet}:\n${(s.content || s.snippet || '').slice(0, 1500)}`
  ).join('\n\n---\n\n');

  if (!sourceContent || sourceContent.length < 50) throw new Error('Not enough source content');

  const systemPrompt = `You are a senior journalist at ClearLens, an AI transparency news platform committed to unbiased reporting. Your job is to synthesize multiple sources into a single balanced article.

STRICT RULES:
- Use ONLY facts present in the provided sources. Never invent or hallucinate.
- Present ALL perspectives fairly. Do not favor any political side.
- When sources disagree, clearly explain both positions.
- Never use placeholder text like "Development 1" or "More research is needed."
- Write in plain, direct journalism prose. 400-550 words.
- Do not include a byline or publication name.

OUTPUT FORMAT (use exactly these headers):
HEADLINE: [specific, neutral headline]
SUMMARY: [2-3 sentence balanced summary]
BODY: [5-6 paragraphs presenting all perspectives]
TAKEAWAY: [one neutral sentence summarizing the state of evidence]`;

  const userPrompt = `Write a balanced ClearLens article synthesizing these ${research.sources.length} sources on: "${research.query}"

${sourceContent}`;

  return groqRequest([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], 2000);
}

// Generate social content
async function generateSocialContent(article, headline) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');

  const systemPrompt = `You are a viral social media strategist for ClearLens, an unbiased AI news platform. Generate platform-native posts optimized for maximum reach. Base everything only on the article. Never take political sides.

OUTPUT FORMAT:
TWITTER: [max 280 chars including hashtags]
LINKEDIN: [professional, 150-200 words, 3-5 hashtags]
INSTAGRAM: [strong hook, 100-150 words, 10-15 hashtags at end]
TIKTOK: [casual spoken script for 30-60 second video]
FACEBOOK: [conversational, 80-120 words, 2-3 hashtags]
THREADS: [casual, max 500 chars, 2-3 hashtags]`;

  const userPrompt = `Generate social posts for:\nHEADLINE: ${headline}\n\nARTICLE:\n${article}`;

  return groqRequest([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], 1500);
}

function parseArticle(raw) {
  const get = (key) => {
    const match = raw.match(new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n[A-Z]+:|$)`));
    return match ? match[1].trim() : '';
  };
  return {
    headline: get('HEADLINE'),
    summary: get('SUMMARY'),
    body: get('BODY'),
    takeaway: get('TAKEAWAY'),
    raw,
  };
}

function parseSocial(raw) {
  if (!raw) return {};
  const get = (key) => {
    const match = raw.match(new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\n[A-Z]+:|$)`));
    return match ? match[1].trim() : '';
  };
  return {
    twitter: get('TWITTER'),
    linkedin: get('LINKEDIN'),
    instagram: get('INSTAGRAM'),
    tiktok: get('TIKTOK'),
    facebook: get('FACEBOOK'),
    threads: get('THREADS'),
  };
}

module.exports = { generateArticle, generateSocialContent, scoreSources, parseArticle, parseSocial };
