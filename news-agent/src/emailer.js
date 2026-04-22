// Console delivery instead of email
function deliverArticle(article, pdfPath, webLink) {
  console.log('\n=== FINAL ARTICLE ===');
  console.log(article);
  console.log(`PDF: ${pdfPath}`);
  console.log(`Web: ${webLink}`);
  console.log('=====================\n');
}

module.exports = { deliverArticle };