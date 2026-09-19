import { Resend } from "resend";
import { getSectionColorHex } from "@/lib/sectionColors";

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getArticleSummary(article) {
  const body = String(article?.body || "").trim();
  if (!body) return "";
  return body.split(/\n\s*\n/)[0].trim();
}

function buildSubscriptionConfirmationHtml({ email, topics = [], sections = [] }) {
  const destinationValues = sections.length > 0 ? sections : topics;
  const destination =
    destinationValues.length > 0
      ? destinationValues.includes("all")
        ? "All topics"
        : destinationValues.join(", ")
      : "All topics";

  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; border-bottom: 3px solid #1a1a1a; padding-bottom: 20px; margin-bottom: 32px;">
        <h1 style="font-size: 36px; font-weight: 700; letter-spacing: -1px; margin: 0;">ClearLens</h1>
        <p style="font-size: 11px; text-transform: uppercase; letter-spacing: 3px; color: #9b9b9b; margin: 6px 0 0;">Independent · Evidence-Based · Machine-Reported</p>
      </div>
      <p style="font-size: 16px; line-height: 1.6; color: #3d3d3d;">You're now subscribed to ClearLens. You'll receive articles in: <strong>${escapeHtml(destination)}</strong></p>
      <p style="font-size: 13px; color: #9b9b9b; margin-top: 32px;">To unsubscribe at any time, <a href="https://clearlens.ai/unsubscribe?email=${encodeURIComponent(email)}" style="color: #c9243f;">click here</a>.</p>
    </div>
  `;
}

function buildArticleEmailHtml({ article, articleUrl, headerText = "Read Full Article", unsubscribeEmail = "" }) {
  const summary = escapeHtml(getArticleSummary(article));
  const sectionColor = escapeHtml(getSectionColorHex(article?.section));
  const firstParagraph = summary || escapeHtml(String(article?.subheadline || "").trim());
  const pullQuote = escapeHtml(String(article?.pullQuote || article?.pull_quote || "").trim());
  const unsubscribeUrl = unsubscribeEmail ? `https://clearlens.ai/unsubscribe?email=${encodeURIComponent(unsubscribeEmail)}` : "https://clearlens.ai/unsubscribe";

  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; border-bottom: 3px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 28px;">
        <h1 style="font-size: 28px; font-weight: 700; letter-spacing: -1px; margin: 0;">ClearLens</h1>
      </div>
      <p style="font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: ${sectionColor}; margin-bottom: 8px;">${escapeHtml(article?.section || "")}</p>
      <h2 style="font-size: 26px; font-weight: 700; line-height: 1.15; color: #1a1a1a; margin: 0 0 12px;">${escapeHtml(article?.headline || "")}</h2>
      <p style="font-size: 16px; font-weight: 300; font-style: italic; color: #3d3d3d; line-height: 1.5; margin-bottom: 20px;">${escapeHtml(article?.subheadline || "")}</p>
      <p style="font-size: 15px; line-height: 1.75; color: #1a1a1a;">${firstParagraph}</p>
      <div style="margin: 28px 0; border-top: 3px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; padding: 16px 0;">
        <p style="font-family: Georgia, serif; font-style: italic; font-size: 18px; color: #1a1a1a; margin: 0;">${pullQuote}</p>
      </div>
      <a href="${escapeHtml(articleUrl)}" style="display: inline-block; background: #1a1a1a; color: white; font-family: sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; padding: 10px 24px; text-decoration: none;">${escapeHtml(headerText)}</a>
      <p style="font-size: 11px; color: #9b9b9b; margin-top: 40px; border-top: 0.5px solid #d4cfc8; padding-top: 16px;">You're receiving this because you subscribed to ClearLens ${escapeHtml(article?.section || "")} coverage. <a href="${unsubscribeUrl}" style="color: #c9243f;">Unsubscribe</a></p>
    </div>
  `;
}

export async function sendSubscriptionConfirmationEmail({ email, topics = [], sections = [] }) {
  const resend = getResendClient();
  if (!resend) {
    throw new Error("RESEND_API_KEY is missing");
  }

  await resend.emails.send({
    from: "ClearLens <hello@clearlens.ai>",
    to: email,
    subject: "You're subscribed to ClearLens",
    html: buildSubscriptionConfirmationHtml({ email, topics, sections }),
  });
}

export async function sendRequestedArticleEmail({ email, article, articleUrl }) {
  const resend = getResendClient();
  if (!resend) {
    throw new Error("RESEND_API_KEY is missing");
  }

  await resend.emails.send({
    from: "ClearLens <hello@clearlens.ai>",
    to: email,
    subject: `Your requested article: ${article?.headline || "ClearLens"}`,
    html: buildArticleEmailHtml({
      article,
      articleUrl,
      headerText: "Here's the article you requested",
      unsubscribeEmail: email,
    }),
  });
}
