import ArticleView from "@/components/ArticleView";

const sampleArticle = {
  section: "Health",
  headline: "Semaglutide’s Heart Benefit Reshapes Obesity Treatment",
  subheadline:
    "A major cardiovascular trial is accelerating clinical use, while cost, safety, and access concerns remain unresolved.",
  byline: "ClearLens Staff",
  date: "April 18, 2026",
  location: "CHICAGO —",
  body: [
    "A landmark international trial found that semaglutide reduced major cardiovascular events by 20% in adults with overweight or obesity who did not have diabetes, marking the first large randomized evidence that a weight-loss drug can directly lower heart attack and stroke risk in this population.",
    "That result is landing at a moment when obesity policy and prescribing practice are shifting quickly. The CDC estimates that U.S. adult obesity prevalence remains above 40%, and health systems are increasingly treating obesity as a chronic disease rather than a lifestyle issue.",
    "The strongest evidence came from the SELECT trial, led by Dr. A. Michael Lincoff of Cleveland Clinic and published in The New England Journal of Medicine in 2023. The study randomized 17,604 adults across multiple countries and tracked major adverse cardiovascular events over several years, reporting a statistically significant reduction in risk among patients receiving semaglutide versus placebo.",
    "A credible dissent remains, centered on affordability, tolerability, and what happens after discontinuation. Commentators have argued that high launch prices and uneven insurance coverage could widen disparities even if clinical efficacy is strong.",
    "The evidence base is therefore strong on near- to mid-term cardiovascular benefit, but less settled on long-term implementation at population scale. Regulators, payers, and clinicians now face a practical test: whether they can pair outcomes-driven prescribing with sustained access, monitoring, and equity safeguards.",
  ].join("\n\n"),
  pullQuote:
    "A landmark international trial found that semaglutide reduced major cardiovascular events by 20% in adults with overweight or obesity who did not have diabetes.",
  sources: [
    'Lincoff, A. Michael, et al. "Semaglutide and Cardiovascular Outcomes in Obesity without Diabetes." The New England Journal of Medicine. 2023.',
    'U.S. Food and Drug Administration. "FDA Approves First Treatment to Reduce Risk of Serious Heart Problems." 2024.',
    'Centers for Disease Control and Prevention. "Adult Obesity Facts." 2024.',
    'Ross, Joseph S., et al. "Coverage, Affordability, and Access Challenges for GLP-1 Therapies." JAMA. 2024.',
  ],
  meta: {
    bias_score: 0.0,
    tags: ["Obesity", "Cardiovascular Disease", "GLP-1"],
    word_count: 658,
    confidence: "medium",
  },
};

export default function ArticlePreviewPage() {
  return <ArticleView article={sampleArticle} />;
}
