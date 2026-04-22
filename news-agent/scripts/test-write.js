// scripts/test-write.js
// Run: node scripts/test-write.js
// Tests the full research → PDF → email pipeline with a sample story

import dotenv from "dotenv";
dotenv.config();

import { runResearchAndWrite } from "../src/researcher.js";

const testStory = {
  id: "test-001",
  source: "FDA",
  title: "FDA Approves New GLP-1 Weight Loss Drug With Cardiovascular Claims",
  summary:
    "The FDA has approved a new semaglutide-based medication for chronic weight management, with the manufacturer claiming significant cardiovascular risk reduction based on a 3-year trial of 17,000 patients.",
  link: "https://www.fda.gov/news-events/press-announcements",
  pubDate: new Date().toISOString(),
};

const testClassification = {
  score: 91,
  reason: "Major drug approval affecting millions; significant industry profit motive warrants scrutiny of cardiovascular claims.",
  angle: "Examine the actual effect sizes in the trial, who funded it, and what happens to patients who stop taking the drug.",
  potential_bias_sources: ["Novo Nordisk (manufacturer)", "KOLs with speaker fees", "obesity medicine societies with pharma funding"],
};

console.log("Running test pipeline...");
await runResearchAndWrite(testStory, testClassification, "Focus on long-term safety data and cost-effectiveness");