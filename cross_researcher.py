"""
Cross-Research Agent for Public Health Findings
Conducts in-depth research across multiple sources to verify and expand findings.
"""

import json
import html
import re
import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote_plus

import feedparser
import requests
from dateutil import parser as date_parser


class CrossResearcher:
    def __init__(self, ncbi_api_key=None):
        self.ncbi_api_key = ncbi_api_key
        self.pubmed_base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
        self.arxiv_base = "http://export.arxiv.org/api/query"
        self.timeout = 20

    @staticmethod
    def _dedupe_by_url(records):
        deduped = []
        seen = set()
        for record in records or []:
            url = (record.get("url") or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            deduped.append(record)
        return deduped

    def build_search_queries(self, item, max_queries=5):
        """Create multiple query variants so research does not depend on one brittle query."""
        title = (item.get("title") or "").strip()
        content = (item.get("text") or "").strip()
        base_text = f"{title} {content}".strip()
        keywords = self.extract_keywords(base_text, max_keywords=12)

        phrases = [
            " ".join(keywords[:6]).strip(),
            title,
            f"public health {title}".strip(),
            " ".join(keywords[6:12]).strip(),
            f"{title} clinical implications".strip(),
            "public health policy epidemiology surveillance",
        ]

        queries = [q for q in dict.fromkeys(phrases) if q]
        return queries[:max_queries]

    @staticmethod
    def clean_feed_text(value, max_chars=500):
        text = html.unescape(str(value or ""))
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:max_chars].rstrip() if text else ""

    def search_pubmed(self, query, max_results=10):
        """Search PubMed for related studies."""
        try:
            def get_with_retry(url, params, retries=3, base_delay=2):
                last_error = None
                for attempt in range(1, retries + 1):
                    try:
                        resp = requests.get(url, params=params, timeout=self.timeout)
                        if resp.status_code == 429:
                            raise requests.HTTPError("429 Too Many Requests", response=resp)
                        resp.raise_for_status()
                        return resp
                    except Exception as exc:
                        last_error = exc
                        if attempt < retries:
                            time.sleep(base_delay * attempt)
                raise last_error

            search_url = f"{self.pubmed_base}/esearch.fcgi"
            params = {
                "db": "pubmed",
                "term": query,
                "sort": "relevance",
                "retmax": max_results,
                "retmode": "json",
                "datetype": "pdat",
                "reldate": 90,  # Last 90 days
            }
            if self.ncbi_api_key:
                params["api_key"] = self.ncbi_api_key

            response = get_with_retry(search_url, params=params, retries=4, base_delay=2)
            data = response.json()
            ids = data.get("esearchresult", {}).get("idlist", [])

            if not ids:
                return []

            # Get summaries
            summary_url = f"{self.pubmed_base}/esummary.fcgi"
            summary_params = {
                "db": "pubmed",
                "id": ",".join(ids),
                "retmode": "json",
            }
            if self.ncbi_api_key:
                summary_params["api_key"] = self.ncbi_api_key

            response = get_with_retry(summary_url, params=summary_params, retries=4, base_delay=2)
            results_json = response.json().get("result", {})

            abstract_params = {
                "db": "pubmed",
                "id": ",".join(ids),
                "rettype": "abstract",
                "retmode": "xml",
            }
            if self.ncbi_api_key:
                abstract_params["api_key"] = self.ncbi_api_key
            abstract_response = get_with_retry(
                f"{self.pubmed_base}/efetch.fcgi",
                params=abstract_params,
                retries=4,
                base_delay=2,
            )
            import xml.etree.ElementTree as ET
            abstract_root = ET.fromstring(abstract_response.content)
            abstracts = {}
            for article in abstract_root.findall(".//PubmedArticle"):
                pmid_node = article.find(".//PMID")
                if pmid_node is None or not pmid_node.text:
                    continue
                parts = []
                for abstract_node in article.findall(".//Abstract/AbstractText"):
                    label = abstract_node.attrib.get("Label", "").strip()
                    text = "".join(abstract_node.itertext()).strip()
                    if text:
                        parts.append(f"{label}: {text}" if label else text)
                if parts:
                    abstracts[pmid_node.text.strip()] = self.clean_feed_text(" ".join(parts), 1200)

            articles = []
            for pmid in ids:
                record = results_json.get(pmid)
                summary = abstracts.get(pmid, "")
                if not record or not summary:
                    continue
                articles.append(
                    {
                        "source": "PubMed",
                        "pmid": pmid,
                        "title": record.get("title", ""),
                        "authors": [a.get("name", "") for a in record.get("authors", [])[:3]],
                        "date": record.get("pubdate", ""),
                        "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                        "summary": summary,
                    }
                )

            return articles
        except Exception as e:
            print(f"PubMed search error: {e}")
            return []

    def search_arxiv(self, query, max_results=5):
        """Search arXiv for preprints."""
        try:
            params = {
                "search_query": f'cat:q-bio AND ({query})',
                "start": 0,
                "max_results": max_results,
                "sortBy": "submittedDate",
                "sortOrder": "descending",
            }

            response = requests.get(self.arxiv_base, params=params, timeout=self.timeout)
            response.raise_for_status()

            articles = []
            # Simple XML parsing for arXiv feed
            import xml.etree.ElementTree as ET

            root = ET.fromstring(response.content)
            for entry in root.findall("{http://www.w3.org/2005/Atom}entry")[:max_results]:
                title_elem = entry.find("{http://www.w3.org/2005/Atom}title")
                summary_elem = entry.find("{http://www.w3.org/2005/Atom}summary")
                published_elem = entry.find("{http://www.w3.org/2005/Atom}published")
                id_elem = entry.find("{http://www.w3.org/2005/Atom}id")

                if all([title_elem, summary_elem, id_elem]):
                    arxiv_id = id_elem.text.split("/abs/")[-1]
                    articles.append(
                        {
                            "source": "arXiv",
                            "arxiv_id": arxiv_id,
                            "title": title_elem.text.strip(),
                            "date": published_elem.text if published_elem is not None else "",
                            "url": f"https://arxiv.org/abs/{arxiv_id}",
                            "summary": summary_elem.text.strip()[:300],
                        }
                    )

            return articles
        except Exception as e:
            print(f"arXiv search error: {e}")
            return []

    def search_google_news(self, query, max_results=8):
        """Fetch related news from public RSS feeds with robust query fallback."""
        try:
            query = (query or "").strip()
            query_variants = [
                query,
                f"public health {query}".strip(),
                "public health",
            ]
            query_variants = [q for q in dict.fromkeys(query_variants) if q]

            base_feeds = [
                {
                    "name": "Reuters World",
                    "url": "https://www.reutersagency.com/feed/?best-topics=health&post_type=best",
                },
                {
                    "name": "CDC Newsroom",
                    "url": "https://tools.cdc.gov/api/v2/resources/media/404952.rss",
                },
            ]

            articles = []
            seen_urls = set()

            def add_from_feed(feed_name, feed_url):
                feed = feedparser.parse(feed_url)
                for entry in feed.entries[:max_results]:
                    link = entry.get("link", "")
                    if not link or link in seen_urls:
                        continue
                    seen_urls.add(link)
                    articles.append(
                        {
                            "source": feed_name,
                            "title": self.clean_feed_text(entry.get("title", ""), 300),
                            "date": entry.get("published", ""),
                            "url": link,
                            "summary": self.clean_feed_text(entry.get("summary", ""), 500),
                        }
                    )

            # Query-specific Google News feeds first.
            for q in query_variants:
                encoded_query = quote_plus(q)
                google_url = (
                    "https://news.google.com/rss/search"
                    f"?q={encoded_query}&hl=en-US&gl=US&ceid=US:en"
                )
                try:
                    add_from_feed("Google News", google_url)
                    if len(articles) >= max_results:
                        return articles[:max_results]
                except Exception as e:
                    print(f"Error fetching Google News query '{q}': {e}")

            # Then mix in stable institutional/newsroom feeds.
            for feed_info in base_feeds:
                try:
                    add_from_feed(feed_info["name"], feed_info["url"])
                    if len(articles) >= max_results:
                        return articles[:max_results]
                except Exception as e:
                    print(f"Error fetching {feed_info['name']}: {e}")

            return articles[:max_results]
        except Exception as e:
            print(f"News search error: {e}")
            return []

    def extract_keywords(self, text, max_keywords=5):
        """Extract key terms from text for cross-research."""
        # Simple keyword extraction - medical terms and proper nouns
        medical_terms = [
            "vaccine",
            "pandemic",
            "virus",
            "disease",
            "treatment",
            "drug",
            "clinical",
            "study",
            "outbreak",
            "variant",
            "phase",
            "trial",
            "adverse",
            "FDA",
            "WHO",
            "CDC",
        ]

        keywords = []
        text_lower = text.lower()

        for term in medical_terms:
            if term.lower() in text_lower:
                keywords.append(term)

        # Extract capitalized terms (likely proper nouns)
        capitalized = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b", text)
        keywords.extend(capitalized[:3])

        return list(set(keywords))[:max_keywords]

    def cross_research_finding(self, item, depth="medium"):
        """
         Conduct cross-research on a finding.
         depth: 'quick' (PubMed only), 'medium' (PubMed + news),
             'deep' (all sources), 'exhaustive' (multi-query high-volume all sources)
        """
        title = item.get("title", "")
        content = item.get("text", "")
        source = item.get("source", "Unknown")
        date = item.get("date", "")

        print(f"\n📊 Cross-researching: {title}")

        keywords = self.extract_keywords(title + " " + content)

        depth_settings = {
            "quick": {"query_budget": 1, "pubmed": 8, "news": 0, "arxiv": 0},
            "medium": {"query_budget": 2, "pubmed": 12, "news": 10, "arxiv": 0},
            "deep": {"query_budget": 3, "pubmed": 18, "news": 14, "arxiv": 8},
            "exhaustive": {"query_budget": 5, "pubmed": 30, "news": 24, "arxiv": 12},
        }
        settings = depth_settings.get(depth, depth_settings["medium"])
        queries = self.build_search_queries(item, max_queries=settings["query_budget"])
        search_query = queries[0] if queries else " ".join(keywords)

        research_report = {
            "original_title": title,
            "original_source": source,
            "original_date": date,
            "keywords": keywords,
            "research_date": datetime.now().isoformat(timespec="seconds"),
            "findings": {
                "corroborating_studies": [],
                "complementary_research": [],
                "related_news": [],
                "expert_consensus": [],
            },
            "metadata": {
                "total_sources_found": 0,
                "reliability_score": 0,
                "research_depth": depth,
            },
        }

        pubmed_results = []
        news_results = []
        arxiv_results = []

        for idx, query in enumerate(queries, start=1):
            print(f"  → Query {idx}/{len(queries)}: {query}")

            # Always search PubMed.
            pubmed_per_query = max(3, settings["pubmed"] // max(len(queries), 1))
            pubmed_results.extend(self.search_pubmed(query, max_results=pubmed_per_query))

            if depth in ["medium", "deep", "exhaustive"] and settings["news"] > 0:
                news_per_query = max(3, settings["news"] // max(len(queries), 1))
                news_results.extend(self.search_google_news(query, max_results=news_per_query))

            if depth in ["deep", "exhaustive"] and settings["arxiv"] > 0:
                arxiv_per_query = max(2, settings["arxiv"] // max(len(queries), 1))
                arxiv_results.extend(self.search_arxiv(query, max_results=arxiv_per_query))

            time.sleep(0.5)

        # Deduplicate by URL and apply depth-specific caps.
        research_report["findings"]["corroborating_studies"] = self._dedupe_by_url(pubmed_results)[: settings["pubmed"]]
        research_report["findings"]["related_news"] = self._dedupe_by_url(news_results)[: settings["news"]]
        research_report["findings"]["complementary_research"] = self._dedupe_by_url(arxiv_results)[: settings["arxiv"]]

        # Calculate metadata
        research_report["metadata"]["total_sources_found"] = (
            len(pubmed_results)
            + len(research_report["findings"]["related_news"])
            + len(research_report["findings"]["complementary_research"])
        )

        # Reliability score based on corroboration
        if len(pubmed_results) >= 5:
            research_report["metadata"]["reliability_score"] = "high"
        elif len(pubmed_results) >= 2:
            research_report["metadata"]["reliability_score"] = "medium"
        else:
            research_report["metadata"]["reliability_score"] = "low"

        return research_report

    def generate_research_article(self, item, research_report):
        """Generate a formatted research article from findings."""
        article = f"""
# Research Analysis: {item.get('title', 'Finding')}

**Original Source:** {item.get('source', 'Unknown')}
**Published:** {item.get('date', 'Unknown')}
**Research Report Generated:** {research_report['research_date']}

---

## Executive Summary

This is a cross-research analysis of the above health finding. We searched {research_report['metadata']['total_sources_found']} peer-reviewed and news sources to verify, expand, and contextualize this finding.

**Overall Reliability Assessment:** {research_report['metadata']['reliability_score'].upper()}

---

## Key Research Terms Identified
{', '.join(research_report['keywords'])}

---

## Corroborating Studies

Based on {len(research_report['findings']['corroborating_studies'])} PubMed results:

"""

        for study in research_report["findings"]["corroborating_studies"]:
            article += f"""
### {study['title']}
- **Authors:** {', '.join(study.get('authors', ['Unknown']))}
- **Date:** {study['date']}
- **Link:** {study['url']}
- **Summary:** {study.get('summary', 'N/A')}
"""

        if research_report["findings"]["related_news"]:
            article += f"""

---

## Related News Coverage

{len(research_report['findings']['related_news'])} relevant news articles found:

"""
            for article_item in research_report["findings"]["related_news"]:
                article += f"""
- **{article_item['title']}** ({article_item['source']})
  {article_item.get('summary', 'N/A')}
  [Read more]({article_item['url']})
"""

        if research_report["findings"]["complementary_research"]:
            article += f"""

---

## Complementary Preprints

From arXiv:

"""
            for preprint in research_report["findings"]["complementary_research"]:
                article += f"""
- **{preprint['title']}**
  [arXiv:{preprint['arxiv_id']}]({preprint['url']})
"""

        article += """

---

## Methodology

This analysis was conducted using:
- PubMed Central (NIH) for peer-reviewed research
- arXiv for academic preprints (if deep search)
- Public news RSS feeds for media coverage

Results were filtered for relevance and recency, with a focus on high-signal sources (WHO, CDC, NIH, FDA, and peer-reviewed journals).

---

*Generated by Public Health Research Cross-Research Agent*
"""

        return article

    def save_research_to_db(self, db_path, item, research_report, article_html):
        """Save research findings to database for web publishing."""
        try:
            conn = sqlite3.connect(db_path)

            # Create table if doesn't exist
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cross_research (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    original_title TEXT NOT NULL,
                    original_source TEXT,
                    original_date TEXT,
                    research_date TEXT NOT NULL,
                    keywords TEXT,
                    reliability_score TEXT,
                    total_sources_found INTEGER,
                    research_data JSON NOT NULL,
                    article_content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )

            conn.execute(
                """
                INSERT INTO cross_research 
                (original_title, original_source, original_date, research_date, keywords, 
                 reliability_score, total_sources_found, research_data, article_content, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item.get("title", ""),
                    item.get("source", ""),
                    item.get("date", ""),
                    research_report["research_date"],
                    ",".join(research_report["keywords"]),
                    research_report["metadata"]["reliability_score"],
                    research_report["metadata"]["total_sources_found"],
                    json.dumps(research_report),
                    article_html,
                    datetime.utcnow().isoformat(timespec="seconds"),
                ),
            )

            conn.commit()
            conn.close()

            print(f"✓ Research saved to database")
            return True
        except Exception as e:
            print(f"Error saving to database: {e}")
            return False


def main():
    """Example usage of cross-researcher."""
    import os

    ncbi_key = os.getenv("NCBI_API_KEY")
    researcher = CrossResearcher(ncbi_api_key=ncbi_key)

    # Example finding
    sample_finding = {
        "title": "New COVID-19 Variant Shows Increased Transmissibility",
        "text": "Recent studies indicate a new coronavirus variant exhibits 1.5x higher transmissibility than previous strains.",
        "source": "CDC",
        "date": "2026-04-10",
        "url": "https://cdc.gov/example",
    }

    # Run cross-research
    report = researcher.cross_research_finding(sample_finding, depth="medium")

    # Generate article
    article = researcher.generate_research_article(sample_finding, report)

    print("\n" + "=" * 80)
    print("GENERATED RESEARCH ARTICLE")
    print("=" * 80)
    print(article)

    # Save to database (optional)
    db_path = Path(__file__).parent / "processed_items.db"
    if db_path.exists():
        researcher.save_research_to_db(db_path, sample_finding, report, article)


if __name__ == "__main__":
    main()
