const https = require('https');
const http = require('http');
const { URL } = require('url');
require('dotenv').config();

const SERPER_API_KEY = process.env.SERPER_API_KEY;

function searchSources(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ q: query, num: 8, gl: 'us', hl: 'en' });
    const options = {
      hostname: 'google.serper.dev',
      path: '/news',
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data).news || []); }
        catch (err) { reject(new Error('Failed to parse Serper response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchHTML(rawUrl) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(rawUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 10000,
      };
      const req = lib.request(options, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return fetchHTML(res.headers.location).then(resolve).catch(reject);
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    } catch (err) { reject(err); }
  });
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ')
    .trim().slice(0, 4000);
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return url; }
}

function buildSearchQuery(title) {
  return title.replace(/['"""]/g, '')
    .replace(/\b(breaking|exclusive|watch|just in|update)\b/gi, '')
    .trim().slice(0, 100);
}

async function researchTopic(item) {
  if (!SERPER_API_KEY) throw new Error('SERPER_API_KEY is not set');

  const query = buildSearchQuery(item.title);
  console.log(`  Searching: "${query}"`);

  let searchResults = [];
  try { searchResults = await searchSources(query); }
  catch (err) { console.warn(`  Search failed: ${err.message}`); }

  const sources = [];
  for (const result of searchResults.slice(0, 6)) {
    const source = {
      title: result.title || '',
      url: result.link || '',
      outlet: result.source || extractDomain(result.link || ''),
      snippet: result.snippet || '',
      publishedAt: result.date || '',
      content: '',
    };

    if (result.link) {
      try {
        const html = await fetchHTML(result.link);
        const text = extractText(html);
        if (text.length > 200) source.content = text;
      } catch (err) {}
    }

    if (!source.content && source.snippet) source.content = source.snippet;
    if (source.content || source.snippet) sources.push(source);
    await new Promise(r => setTimeout(r, 500));
  }

  if (sources.length === 0) {
    sources.push({
      title: item.title,
      url: item.link || '',
      outlet: item.source || 'RSS Feed',
      snippet: item.summary || '',
      content: item.summary || item.title,
      publishedAt: item.pubDate || '',
    });
  }

  return { query, originalTitle: item.title, sources, fetchedAt: new Date().toISOString() };
}

module.exports = { researchTopic };
