// Simple template-based article generation
function generateArticle(item, research) {
  const article = `
Headline: ${item.title}

Executive Summary:
${item.summary}

Background:
This article covers recent developments in the news.

Key Developments:
- Development 1
- Development 2

Multiple Perspectives:
${research.perspectives.join('\n')}

Data & Evidence:
${research.facts.join('\n')}

Risks & Uncertainties:
Potential risks include unknown long-term effects.

Conclusion:
More research is needed.

Sources:
${research.sources.map(s => `${s.title}: ${s.url}`).join('\n')}
  `;

  return article;
}

module.exports = { generateArticle };