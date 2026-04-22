const { generateArticle } = require('./writer');
const { deliverArticle } = require('./emailer');
const puppeteer = require('puppeteer');
const fs = require('fs');

async function researchTopic(item) {
  // Mock research - no external APIs
  return {
    facts: ['Mock fact 1', 'Mock fact 2'],
    sources: [
      { title: 'Mock Source 1', url: 'https://example.com/1', summary: 'Summary 1' },
      { title: 'Mock Source 2', url: 'https://example.com/2', summary: 'Summary 2' }
    ],
    perspectives: ['Perspective 1', 'Perspective 2']
  };
}

async function runResearchAndWrite(story, classification, focus) {
  console.log('Researching topic...');
  const research = await researchTopic(story);

  console.log('Generating article...');
  const article = await generateArticle(story, research);

  console.log('Creating PDF...');
  const pdfPath = await generatePDF(article);

  console.log('Delivering...');
  await deliverArticle(article, pdfPath, 'https://example.com/article');

  console.log('Test complete');
}

async function generatePDF(article) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(`<html><body><pre>${article}</pre></body></html>`);
  const pdfPath = './article.pdf';
  await page.pdf({ path: pdfPath, format: 'A4' });
  await browser.close();
  return pdfPath;
}

module.exports = { researchTopic, runResearchAndWrite };