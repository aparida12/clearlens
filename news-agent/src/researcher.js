const https = require('https');
const http = require('http');
const { URL } = require('url');

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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 12000,
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
    } catch (err) {
      reject(err);
    }
  });
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

async function researchTopic(item) {
  const sources = [];
  let primaryText = '';
  let primaryTitle = item.title;

  // Try fetching the full article
  if (item.link) {
    try {
      const html = await fetchHTML(item.link);
      const text = extractText(html);
      if (text.length > 200) {
        primaryText = text;
        sources.push({
          title: item.title,
          url: item.link,
          summary: text.slice(0, 500),
        });
      }
    } catch (err) {
      console.warn(`  Could not fetch article page: ${err.message}`);
    }
  }

  // Always include RSS summary as a source regardless
  if (item.summary && item.summary.length > 30) {
    sources.push({
      title: item.title,
      url: item.link || '',
      summary: item.summary,
    });
    // If fetch failed or returned too little, use summary as primary text
    if (primaryText.length < 200) {
      primaryText = `${item.title}. ${item.summary}`;
    }
  }

  // Last resort: just use the title
  if (primaryText.length < 50) {
    primaryText = item.title;
  }

  return {
    primaryTitle,
    primaryText,
    sources,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { researchTopic };

