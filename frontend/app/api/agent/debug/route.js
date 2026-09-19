import { NextResponse } from 'next/server'
import { callAI } from '@/lib/groq'

export async function GET() {
  const results = {}

  // Check env vars exist
  results.env = {
    GROQ_API_KEY: !!process.env.GROQ_API_KEY ? 'SET' : 'MISSING',
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING',
    NEWS_API_KEY: !!process.env.NEWS_API_KEY ? 'SET' : 'MISSING',
    GNEWS_API_KEY: !!process.env.GNEWS_API_KEY ? 'SET' : 'MISSING',
    FINNHUB_API_KEY: !!process.env.FINNHUB_API_KEY ? 'SET' : 'MISSING',
    ALPHAVANTAGE_API_KEY: !!process.env.ALPHAVANTAGE_API_KEY ? 'SET' : 'MISSING',
    SLACK_WEBHOOK_URL: !!process.env.SLACK_WEBHOOK_URL ? 'SET' : 'MISSING',
    AGENT_SECRET: !!process.env.AGENT_SECRET ? 'SET' : 'MISSING',
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'MISSING',
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING',
  }

  // Test NewsAPI
  try {
    const res = await fetch(
      `https://newsapi.org/v2/top-headlines?language=en&pageSize=3&apiKey=${process.env.NEWS_API_KEY}`
    )
    const data = await res.json()
    results.newsapi = {
      status: res.status,
      ok: res.ok,
      articles_returned: data.articles?.length || 0,
      error: data.message || null
    }
  } catch (e) {
    results.newsapi = { error: e.message }
  }

  // Test GNews
  try {
    const res = await fetch(
      `https://gnews.io/api/v4/top-headlines?lang=en&max=3&apikey=${process.env.GNEWS_API_KEY}`
    )
    const data = await res.json()
    results.gnews = {
      status: res.status,
      ok: res.ok,
      articles_returned: data.articles?.length || 0,
      error: data.errors || null
    }
  } catch (e) {
    results.gnews = { error: e.message }
  }

  // Test Finnhub
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY}`
    )
    const data = await res.json()
    results.finnhub = {
      status: res.status,
      ok: res.ok,
      articles_returned: Array.isArray(data) ? data.length : 0,
      error: data?.error || null
    }
  } catch (e) {
    results.finnhub = { error: e.message }
  }

  // Test Alpha Vantage
  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&sort=LATEST&limit=3&apikey=${process.env.ALPHAVANTAGE_API_KEY}`
    )
    const data = await res.json()
    results.alphavantage = {
      status: res.status,
      ok: res.ok,
      articles_returned: Array.isArray(data?.feed) ? data.feed.length : 0,
      error: data?.Information || data?.Note || data?.["Error Message"] || null
    }
  } catch (e) {
    results.alphavantage = { error: e.message }
  }

  // Test Groq API
  try {
    const text = await callAI(
      null,
      'Reply with only the word: working',
      {
        model: 'openai/gpt-oss-20b',
        maxTokens: 50,
        temperature: 0,
      },
    )
    results.groq = {
      ok: true,
      response: text || null,
      error: null
    }
  } catch (e) {
    results.groq = {
      ok: false,
      response: null,
      error: e.message
    }
  }

  // Legacy Anthropic env (not used)
  try {
    results.anthropic = {
      configured: !!process.env.ANTHROPIC_API_KEY,
      note: 'Configured only as fallback; active calls use Groq'
    }
  } catch (e) {
    results.anthropic = { error: e.message }
  }

  // Test Supabase
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    const { data, error } = await supabase
      .from('articles')
      .select('id')
      .limit(1)
    results.supabase = {
      ok: !error,
      articles_in_db: data?.length ?? 0,
      error: error?.message || null
    }
  } catch (e) {
    results.supabase = { error: e.message }
  }

  // Test Slack
  try {
    if (process.env.SLACK_WEBHOOK_URL) {
      const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '🔧 ClearLens debug test — Slack connection working.' })
      })
      results.slack = {
        status: res.status,
        ok: res.ok
      }
    } else {
      results.slack = { error: 'SLACK_WEBHOOK_URL not set' }
    }
  } catch (e) {
    results.slack = { error: e.message }
  }

  return NextResponse.json(results, { status: 200 })
}
