import nodemailer from "nodemailer";

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number.parseInt(String(process.env.SMTP_PORT || "587"), 10);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !user || !pass || !from) {
    return null;
  }

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth: { user, pass },
    from,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatArticleText(article, articleUrl) {
  const lines = [
    `SECTION: ${String(article?.section || "")}`,
    `HEADLINE: ${String(article?.headline || "")}`,
    `SUBHEADLINE: ${String(article?.subheadline || "")}`,
    `BYLINE: ${String(article?.byline || "")}`,
    `DATE: ${String(article?.date || "")}`,
    `LOCATION: ${String(article?.location || "")}`,
    "",
    String(article?.body || ""),
    "",
    `Read online: ${articleUrl}`,
  ];

  return lines.join("\n").trim();
}

function formatArticleHtml(article, articleUrl) {
  const bodyParagraphs = String(article?.body || "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 16px;line-height:1.7;">${escapeHtml(paragraph)}</p>`)
    .join("");

  return `
    <div style="font-family:Georgia, 'Times New Roman', serif;color:#111111;background:#ffffff;padding:32px;">
      <div style="max-width:720px;margin:0 auto;">
        <div style="font-family:Arial, sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#666666;margin-bottom:12px;">
          ${escapeHtml(article?.section || "ClearLens")}
        </div>
        <h1 style="font-size:34px;line-height:1.1;margin:0 0 12px;font-weight:700;">${escapeHtml(article?.headline || "Requested article")}</h1>
        <p style="font-family:Arial, sans-serif;font-size:15px;line-height:1.6;color:#333333;margin:0 0 18px;">${escapeHtml(article?.subheadline || "")}</p>
        <div style="font-family:Arial, sans-serif;font-size:12px;color:#666666;margin-bottom:24px;">
          ${escapeHtml(article?.byline || "")}${article?.date ? ` · ${escapeHtml(article.date)}` : ""}${article?.location ? ` · ${escapeHtml(article.location)}` : ""}
        </div>
        <div style="font-size:18px;line-height:1.8;color:#111111;">${bodyParagraphs}</div>
        <div style="margin-top:28px;padding-top:16px;border-top:1px solid #d9d9d9;font-family:Arial, sans-serif;font-size:13px;line-height:1.6;">
          <a href="${escapeHtml(articleUrl)}" style="color:#111111;text-decoration:underline;">Read the article on ClearLens</a>
        </div>
      </div>
    </div>
  `;
}

export async function sendArticleEmail({ to, article, articleUrl }) {
  const config = getSmtpConfig();
  if (!config) {
    throw new Error("SMTP email configuration is missing");
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  const subject = `[ClearLens] ${String(article?.headline || "Requested article")}`;
  const text = formatArticleText(article, articleUrl);
  const html = formatArticleHtml(article, articleUrl);

  await transporter.sendMail({
    from: config.from,
    to,
    subject,
    text,
    html,
  });
}
