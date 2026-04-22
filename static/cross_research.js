/**
 * Cross-Research API Client
 * Handles triggering and monitoring cross-research on articles
 */

async function runCrossResearch(articleId, depth = 'medium') {
  const button = document.querySelector(`[data-research-button="${articleId}"]`);
  if (button) button.disabled = true;

  try {
    const response = await fetch(`/api/cross-research/${articleId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ depth }),
    });

    if (!response.ok) {
      const error = await response.json();
      alert(`Error: ${error.error}`);
      if (button) button.disabled = false;
      return;
    }

    const result = await response.json();
    if (result.success) {
      alert(
        `✓ Research complete!\nFound ${result.sources_found} sources\nReliability: ${result.reliability}`
      );
      // Redirect to research results
      window.location.href = `/research/${result.research_id}`;
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
    if (button) button.disabled = false;
  }
}

// Auto-initialize cross-research buttons
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-research-btn]').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const articleId = button.dataset.researchBtn;
      const depth = button.dataset.depth || 'medium';
      runCrossResearch(articleId, depth);
    });
  });
});
