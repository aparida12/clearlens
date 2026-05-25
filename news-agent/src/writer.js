const https = require('https');
require('dotenv').config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = 'llama-3.3-70b-versatile';

function groqRequest(messages, maxTokens = 2000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.4,
      messages,
    });
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
        } catch (err) {
          reject(new Error('Failed to parse Groq response'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function generateArticle(item, research) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');
  const sourceContent = research.primaryText || (research.sources || []).map(s => s.summary || '').join('\n\n');
  if (!sourceContent || sourceContent.length < 30) throw new Error('Not enough source content');

  const systemPrompt = `You are a senior journalist at ClearLens. Write factual news articles based ONLY on the source content provided. Never invent facts. Never use placeholder text like "Development 1" or "More research is needed." Write 350-500 words in plain journalism prose.

OUTPUT FORMAT:
HEADLINE: [specific headline]
SUMMARY: [2-3 sentence summary]
BODY: [4-6 paragraphs of real journalism]
TAKEAWAY: [one sentence key point]`;

  const userPrompt = `Write a ClearLens article based on this content:\n\nORIGINAL HEADLINE: ${item.title}\n\nSOURCE CONTENT:\n${sourceContent}`;

  return groqRequest([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], 2000);
}

async function generateSocialContent(article, headline) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');

  const systemPrompt = `You are a viral social media strategist for ClearLens. Generate platform-native posts optimized for maximum reach. Base everything only on the article provided.

OUTPUT FORMAT:
TWITTER: [max 280 chars including hashtags]
LINKEDIN: [professional, 150-200 words, 3-5 hashtags]
INSTAGRAM: [strong hook, 100-150 words, 10-15 hashtags at end]
TIKTOK: [casual spoken script for 30-60 second video]
FACEBOOK: [conversational, 80-120 words, 2-3 hashtags]
THREADS: [casual, max 500 chars, 2-3 hashtags]`;

  const userPrompt = `Generate social posts for this article:\n\nHEADLINE: ${headline}\n\nARTICLE:\n${article}`;

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

module.exports = { generateArticle, generateSocialContent, parseArticle, parseSocial };
