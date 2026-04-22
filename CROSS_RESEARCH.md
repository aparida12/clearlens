# Cross-Research Agent – Documentation

## Overview

The Cross-Research Agent automatically expands individual health findings with corroborating evidence from multiple authoritative sources (PubMed, arXiv, news feeds, etc.). It compiles comprehensive research reports that verify and contextualize your findings.

## Features

### 1. **Multi-Source Research**
- **PubMed Central:** 8+ peer-reviewed studies filtered by relevance
- **arXiv:** Academic preprints for emerging research (optional)
- **News Feeds:** Reuters Health, Google News, public RSS feeds
- **Rate-limited API calls** to prevent blocking

### 2. **Smart Keyword Extraction**
- Automatically extracts medical terms and proper nouns from findings
- Generates focused search queries for high-precision results
- Contextualizes findings within broader research landscapes

### 3. **Reliability Assessment**
- **High:** ≥5 corroborating peer-reviewed studies
- **Medium:** 2-4 studies
- **Low:** <2 studies
- Displays confidence metrics in results

### 4. **Research Depths**

#### Quick (Development)
- PubMed search only
- 30 seconds

#### Medium (Recommended)
- PubMed + News feeds
- 1-2 minutes

#### Deep
- PubMed + News + arXiv
- 2-3 minutes

## Integration

### Web Interface

#### On Editorial Desk (`/desk`)
1. Each article card has a **🔍 Research** button
2. Click to trigger cross-research (medium depth by default)
3. Results compile into a new entry displaying:
   - Peer-reviewed studies
   - News coverage
   - Academic preprints
   - Reliability assessment

#### Access Research Results
- Navigate to `/research/<id>` after research completes
- Or click "Research" result link from desk

### API Endpoint

```bash
# POST /api/cross-research/<article_id>
# Trigger cross-research on an article

curl -X POST http://127.0.0.1:5000/api/cross-research/1 \
  -H "Content-Type: application/json" \
  -d '{"depth": "medium"}'

# Response:
# {
#   "success": true,
#   "research_id": 3,
#   "sources_found": 18,
#   "reliability": "high"
# }
```

### Standalone Python Usage

```python
from cross_researcher import CrossResearcher
import os

researcher = CrossResearcher(ncbi_api_key=os.getenv("NCBI_API_KEY"))

# Example finding
finding = {
    "title": "New COVID-19 Variant Shows Increased Transmissibility",
    "text": "Recent studies indicate increased transmissibility...",
    "source": "CDC",
    "date": "2026-04-10",
}

# Run research
report = researcher.cross_research_finding(finding, depth="medium")

# Generate article
article = researcher.generate_research_article(finding, report)
print(article)

# Save to web database
researcher.save_research_to_db("processed_items.db", finding, report, article)
```

## Database Schema

### `cross_research` Table
```sql
CREATE TABLE cross_research (
    id INTEGER PRIMARY KEY,
    article_id INTEGER,                -- Link to uploaded_articles
    original_title TEXT,
    original_source TEXT,
    original_date TEXT,
    research_date TEXT,                -- When research was conducted
    keywords TEXT,                     -- Comma-separated keywords used
    reliability_score TEXT,            -- high|medium|low
    total_sources_found INTEGER,       -- Number of sources discovered
    research_data JSON,                -- Full research report (JSON)
    article_content TEXT,              -- Formatted research article
    created_at TEXT,
    FOREIGN KEY(article_id) REFERENCES uploaded_articles(id)
);
```

## Configuration

### Environment Variables

```bash
# Optional: Use NCBI API key for higher request limits
NCBI_API_KEY=your-api-key-here

# Get free API key at:
# https://www.ncbi.nlm.nih.gov/account/register/
```

### Rate Limiting

- Automatic 0.5s delay between API calls to prevent blocking
- Respects timeout settings (20 seconds per request)
- Retries on transient failures

## Output Example

A cross-research report includes:

```
# Research Analysis: New Vaccine Variant

## Executive Summary
Searched 24 peer-reviewed and news sources...

## Corroborating Studies
- Study 1 from PubMed with authors, date, summary, link
- Study 2 from PubMed...

## Related News Coverage
- Reuters report on vaccine effectiveness
- WHO statement on variant monitoring

## Complementary Preprints
- arXiv studies on variant transmission

## Reliability Assessment: HIGH
```

## Workflow Example

1. **Upload Finding:**
   - Submit article to `/desk` desk form (PDF, TXT, or paste)

2. **Publish:**
   - Finding appears in grid with 🔍 Research button

3. **Trigger Research:**
   - Click button → API calls run in background
   - Results compile into cross-research report

4. **View Results:**
   - Navigate to `/research/<id>` to see full analysis
   - Displayed on front page as supporting evidence

5. **Share:**
   - Link to research report
   - Includes all sources for verification

## Limitations

- Free API tier has rate limits
- arXiv searches may have lower precision
- News feeds are public sources (may include misinformation)
- No machine learning ranking (uses simple relevance filtering)

## Future Enhancements

- [ ] Bias detection per source
- [ ] Automated fact-checking with claim extraction
- [ ] Real-time news alerts for related stories
- [ ] Citation network visualization
- [ ] Regulatory database integration (FDA approvals, trials)
- [ ] Multilingual search support
- [ ] Geographic spread analysis

## Troubleshooting

### Research times out
```
→ Check internet connection
→ Try "quick" depth instead of "deep"
→ Wait a few minutes and retry
```

### "No sources found"
```
→ Medical terms may be too specific
→ Try simpler keywords manually
→ Add NCBI API key for higher rate limits
```

### API errors
```
→ PubMed/arXiv APIs sometimes have maintenance windows
→ Check ncbi.nlm.nih.gov and arxiv.org status
→ Retry with different depth
```

## References

- **PubMed API:** https://www.ncbi.nlm.nih.gov/research/bionlm/api/
- **arXiv API:** https://arxiv.org/help/api/
- **RSS Feeds:** Industry standard syndication formats

---

**Version:** 1.0  
**Last Updated:** April 2026  
**Status:** Production-Ready
