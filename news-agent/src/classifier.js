// Simple keyword-based scoring instead of AI
function scoreImpact(item) {
  const keywords = ['breaking', 'major', 'crisis', 'approval', 'ban', 'launch', 'policy'];
  const title = item.title.toLowerCase();
  const summary = item.summary.toLowerCase();

  let score = 10; // Base score

  for (const keyword of keywords) {
    if (title.includes(keyword) || summary.includes(keyword)) {
      score += 20;
    }
  }

  // Population impact indicators
  if (summary.includes('million') || summary.includes('billion') || summary.includes('global')) {
    score += 30;
  }

  return Math.min(100, score);
}

module.exports = { scoreImpact };