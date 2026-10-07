function escapeHTML(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Converts TipTap-generated HTML into plain text, used for the
// email's plain-text alternative body and for the preheader snippet.
function htmlToPlainText(html = "") {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Turns a plain-text field (from a <textarea>) into <p> blocks, splitting
// on blank lines for paragraphs and single newlines into <br/>.
function textToParagraphs(text = "") {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.7;color:#333940;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
          p
        ).replace(/\n/g, "<br/>")}</p>`
    )
    .join("");
}

// Side-by-side intro block: text on the left, a supporting image on the
// right — Starburst's signature "White paper" layout. The image sits in
// a fixed box but uses object-fit: contain (not cover) so the full photo
// is always visible — nothing gets cropped off the edges regardless of
// the uploaded image's aspect ratio. Falls back to a single-column
// render if only one of the two is given.
function buildIntroHtml(introText, introImageSrc) {
  const paragraphs = textToParagraphs(introText);

  if (!paragraphs && !introImageSrc) return "";

  if (paragraphs && introImageSrc) {
    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px 0;">
      <tr>
        <td class="stack-column" valign="middle" style="width:58%;padding:0 20px 16px 0;">${paragraphs}</td>
        <td class="stack-column" valign="middle" align="center" style="width:42%;padding:0 0 16px 0;">
          <img src="${introImageSrc}" width="220" height="220" alt="" class="stack-column-img" style="display:block;width:220px;height:220px;object-fit:contain;border-radius:6px;border:0;outline:none;text-decoration:none;margin:0 auto;" />
        </td>
      </tr>
    </table>`;
  }

  if (introImageSrc) {
    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      <tr><td>
        <img src="${introImageSrc}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border-radius:6px;border:0;outline:none;text-decoration:none;" />
      </td></tr>
    </table>`;
  }

  return paragraphs;
}

// Shaded "In this article, discover:" box with bulleted highlights.
function buildHighlightsHtml(title, items) {
  const list = Array.isArray(items) ? items.filter((i) => i && i.trim()) : [];
  if (list.length === 0) return "";

  const rows = list
    .map(
      (item) => `
      <tr>
        <td style="padding:0 8px 10px 0;vertical-align:top;width:14px;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background-color:#00B5F9;margin-top:8px;"></span>
        </td>
        <td style="padding:0 0 10px 0;font-size:14.5px;line-height:1.6;color:#333940;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
          item
        )}</td>
      </tr>`
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;background-color:#f7fafc;border-radius:8px;">
      <tr><td style="padding:18px 20px;">
        ${
          title
            ? `<p style="margin:0 0 12px 0;font-size:14.5px;font-weight:700;color:#0f1115;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
                title
              )}</p>`
            : ""
        }
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
      </td></tr>
    </table>`;
}

// Centered text-link CTA (not a boxed button) — matches Starburst's
// "Read our latest white paper" style.
function buildCtaHtml(ctaText, ctaLink) {
  if (!ctaText || !ctaLink) return "";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px 0;">
      <tr><td align="center">
        <a href="${escapeHTML(
          ctaLink
        )}" target="_blank" style="font-size:15px;font-weight:700;color:#00B5F9;text-decoration:underline;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
    ctaText
  )} &rarr;</a>
      </td></tr>
    </table>`;
}

// Italic "Author's Note" block.
function buildAuthorNoteHtml(authorNote) {
  if (!authorNote || !authorNote.trim()) return "";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px 0;border-top:1px solid #eef0f3;">
      <tr><td style="padding-top:20px;">
        <p style="margin:0 0 8px 0;font-size:13px;font-weight:700;font-style:italic;color:#0f1115;font-family:'Segoe UI',Arial,sans-serif;">Author's Note</p>
        <p style="margin:0;font-size:14px;line-height:1.7;font-style:italic;color:#5b6472;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
          authorNote
        ).replace(/\n/g, "<br/>")}</p>
      </td></tr>
    </table>`;
}

// Row of circular contributor photos + names.
function buildContributorsHtml(contributors) {
  const list = Array.isArray(contributors) ? contributors.filter((c) => c && c.name) : [];
  if (list.length === 0) return "";

  const colWidth = Math.floor(100 / list.length);
  const cols = list
    .map(
      (c) => `
      <td align="center" valign="top" style="padding:0 10px 6px;width:${colWidth}%;">
        ${
          c.photoSrc
            ? `<img src="${c.photoSrc}" width="64" height="64" alt="${escapeHTML(
                c.name
              )}" style="display:block;margin:0 auto 8px;border-radius:50%;width:64px;height:64px;object-fit:cover;border:0;outline:none;" />`
            : ""
        }
        <p style="margin:0;font-size:12.5px;font-weight:600;color:#0f1115;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
          c.name
        )}</p>
      </td>`
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px 0;">
      <tr>${cols}</tr>
    </table>`;
}

// Website / Contact / LinkedIn / YouTube row — only shows the ones provided.
function buildSocialLinksHtml(socialLinks = {}) {
  const entries = [
    ["Website", socialLinks.website],
    ["Contact", socialLinks.contact],
    ["LinkedIn", socialLinks.linkedin],
    ["YouTube", socialLinks.youtube],
  ].filter(([, url]) => url && url.trim());

  if (entries.length === 0) return "";

  const linksHtml = entries
    .map(
      ([label, url]) =>
        `<a href="${escapeHTML(
          url.trim()
        )}" target="_blank" style="color:#00B5F9;text-decoration:none;font-weight:600;">${label}</a>`
    )
    .join(`<span style="color:#c2c9d3;padding:0 8px;">&bull;</span>`);

  return `<p style="margin:0 0 12px 0;font-size:12px;font-family:'Segoe UI',Arial,sans-serif;">${linksHtml}</p>`;
}

// Short teaser paragraph used ONLY in the email preview (never on the
// full article page) — a few sentences of the body content, truncated
// with an ellipsis, so there's a reason to click through to the full
// article instead of everything already being in the email.
function buildExcerptHtml(bodyText, maxLen = 220) {
  const trimmed = (bodyText || "").trim();
  if (!trimmed) return "";

  let excerpt = trimmed.slice(0, maxLen);
  // Don't cut off mid-word — trim back to the last full word boundary.
  if (trimmed.length > maxLen) {
    const lastSpace = excerpt.lastIndexOf(" ");
    if (lastSpace > 0) excerpt = excerpt.slice(0, lastSpace);
    excerpt += "…";
  }

  return `<p style="margin:0 0 18px 0;font-size:15px;line-height:1.7;color:#333940;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
    excerpt
  )}</p>`;
}

// Shared header/footer/wrapper markup used by both the full article
// render and the shortened email preview, so the two stay visually
// consistent (same fonts, colors, logo, footer) while differing only in
// which content sections are included in the middle.
function wrapEmailShell({ subject, preheader, taglineHtml, innerContentHtml, unsubLinkHtml, recipientDisplay, logoSrc }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${escapeHTML(subject)}</title>
<!--[if mso]>
<style type="text/css">
  table { border-collapse: collapse; }
</style>
<![endif]-->
<style>
  @media only screen and (max-width: 620px) {
    .email-container { width: 100% !important; }
    .email-padding { padding-left: 22px !important; padding-right: 22px !important; }
  }
  @media only screen and (max-width: 480px) {
    .stack-column {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      padding-right: 0 !important;
    }
    .stack-column-img {
      width: 100% !important;
      max-width: 280px !important;
      height: auto !important;
      aspect-ratio: 1 / 1;
    }
  }

  .nl-content h1, .nl-content h2, .nl-content h3 {
    margin: 24px 0 10px 0;
    color: #0f1115;
    font-family: 'Segoe UI', Arial, sans-serif;
    line-height: 1.3;
  }
  .nl-content h1 { font-size: 21px; }
  .nl-content h2 { font-size: 18px; }
  .nl-content h3 { font-size: 16px; font-weight: 700; }
  .nl-content p {
    margin: 0 0 16px 0;
    font-size: 15px;
    line-height: 1.7;
    color: #333940;
    font-family: 'Segoe UI', Arial, sans-serif;
  }
  .nl-content ul, .nl-content ol {
    margin: 0 0 16px 0;
    padding-left: 22px;
    color: #333940;
    font-size: 15px;
    line-height: 1.7;
    font-family: 'Segoe UI', Arial, sans-serif;
  }
  .nl-content li { margin-bottom: 6px; }
  .nl-content a { color: #00B5F9; text-decoration: underline; }
  .nl-content strong { color: #0f1115; }
  .nl-content img {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    margin: 14px 0;
    display: block;
  }
  .nl-content blockquote {
    margin: 0 0 16px 0;
    padding-left: 14px;
    border-left: 3px solid #00B5F9;
    color: #5b6472;
    font-style: italic;
  }
  .nl-content p:last-child { margin-bottom: 0; }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:'Segoe UI', Arial, sans-serif;">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">
    ${escapeHTML(preheader || "")}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;">

          ${taglineHtml}

          <!-- Centered logo -->
          <tr>
            <td align="center" style="padding:28px 24px 22px;">
              <img src="${logoSrc}" alt="Onnes Aerospace" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="email-padding" style="padding:8px 24px 8px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    ${innerContentHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

          <!-- Footer -->
          <tr>
            <td class="email-padding" align="center" style="padding:26px 24px 40px 24px;border-top:1px solid #eef0f3;">
              <p style="margin:0 0 10px 0;font-size:12.5px;font-weight:700;color:#0f1115;font-family:'Segoe UI',Arial,sans-serif;">Onnes Aerospace</p>
              <p style="margin:0 0 8px 0;font-size:11px;color:#8a94a3;font-family:'Segoe UI',Arial,sans-serif;">
                &copy; ${new Date().getFullYear()} Onnes Aerospace. All Rights Reserved.
              </p>
              <p style="margin:0;font-size:11px;color:#8a94a3;line-height:1.6;font-family:'Segoe UI',Arial,sans-serif;">
                ${unsubLinkHtml} your email address ( ${escapeHTML(recipientDisplay)} ) from our newsletter.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Builds the FULL newsletter HTML — every section included. Used for:
 *  - the stored copy shown in the admin dashboard's History "View" modal
 *  - the public article page's data (via publicBlogRoutes.js)
 *
 * This is NOT what gets emailed anymore — see buildEmailPreviewHTML below
 * for the shortened version actually sent to recipients.
 *
 * recipientEmail: pass the literal placeholder string used by the sender
 * (e.g. "%%RECIPIENT_EMAIL%%") to produce a template that gets
 * per-recipient personalized later, or omit it entirely for a
 * non-personalized/internal render (dashboard preview, stored copy).
 */
function buildNewsletterHTML({
  subject,
  eyebrow,
  headline,
  tagline,
  introText,
  introImageSrc,
  subheading,
  bodyHtml,
  highlightsTitle,
  highlights,
  ctaText,
  ctaLink,
  authorNote,
  contributors,
  socialLinks,
  preheader,
  unsubscribeEmail,
  recipientEmail,
  logoSrc,
}) {
  const taglineHtml = tagline && tagline.trim()
    ? `
    <tr>
      <td align="center" style="padding:14px 24px;background-color:#f7fafc;border-bottom:1px solid #eef0f3;">
        <p style="margin:0;font-size:12.5px;font-style:italic;font-weight:600;color:#00B5F9;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
          tagline
        )}</p>
      </td>
    </tr>`
    : "";

  const eyebrowHtml = eyebrow
    ? `<p style="margin:0 0 10px 0;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#00B5F9;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
        eyebrow
      )}</p>`
    : "";

  const introHtml = buildIntroHtml(introText, introImageSrc);

  const subheadingHtml = subheading && subheading.trim()
    ? `<h2 style="margin:6px 0 14px 0;font-size:17px;font-weight:800;color:#0f1115;line-height:1.4;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
        subheading
      )}</h2>`
    : "";

  const contentHtml = bodyHtml && bodyHtml.trim() && bodyHtml.trim() !== "<p></p>"
    ? `<div class="nl-content">${bodyHtml}</div>`
    : "";

  const highlightsHtml = buildHighlightsHtml(highlightsTitle, highlights);
  const ctaHtml = buildCtaHtml(ctaText, ctaLink);
  const authorNoteHtml = buildAuthorNoteHtml(authorNote);
  const contributorsHtml = buildContributorsHtml(contributors);
  const socialLinksHtml = buildSocialLinksHtml(socialLinks);

  const unsubLinkHtml = unsubscribeEmail
    ? `<a href="mailto:${escapeHTML(
        unsubscribeEmail
      )}?subject=Unsubscribe" style="color:#00B5F9;text-decoration:underline;font-weight:600;">Unsubscribe</a>`
    : "Unsubscribe";

  const recipientDisplay = recipientEmail || "your email";

  const innerContentHtml = `
    ${eyebrowHtml}
    <h1 style="margin:0 0 20px 0;font-size:25px;font-weight:800;color:#00B5F9;line-height:1.3;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
      headline
    )}</h1>
    ${introHtml}
    ${subheadingHtml}
    ${contentHtml}
    ${highlightsHtml}
    ${ctaHtml}
    ${authorNoteHtml}
    ${contributorsHtml}
  `;

  // The full render additionally includes the social links row directly
  // in the footer (the shortened email preview below keeps its footer
  // minimal — brand + unsubscribe only — to stay short).
  const html = wrapEmailShell({
    subject,
    preheader,
    taglineHtml,
    innerContentHtml,
    unsubLinkHtml,
    recipientDisplay,
    logoSrc,
  });

  // Splice the social links row into the footer, right after the brand
  // name line, without duplicating wrapEmailShell just for this one line.
  return html.replace(
    '<p style="margin:0 0 10px 0;font-size:12.5px;font-weight:700;color:#0f1115;font-family:\'Segoe UI\',Arial,sans-serif;">Onnes Aerospace</p>',
    '<p style="margin:0 0 10px 0;font-size:12.5px;font-weight:700;color:#0f1115;font-family:\'Segoe UI\',Arial,sans-serif;">Onnes Aerospace</p>' +
      socialLinksHtml
  );
}

/**
 * Builds the SHORTENED email preview — the version actually sent to
 * recipients' inboxes. Includes only: tagline, headline, intro (text +
 * image), subheading, a short excerpt of the body content, the
 * highlights teaser box, and the "Read the Full Article" CTA.
 *
 * Deliberately EXCLUDES: the full body content, author's note, and
 * contributors — those only ever appear on the full article page
 * (/blogs/:slug), which is the entire point of the CTA link existing.
 */
function buildEmailPreviewHTML({
  subject,
  eyebrow,
  headline,
  tagline,
  introText,
  introImageSrc,
  subheading,
  bodyText,
  highlightsTitle,
  highlights,
  ctaText,
  ctaLink,
  preheader,
  unsubscribeEmail,
  recipientEmail,
  logoSrc,
}) {
  const taglineHtml = tagline && tagline.trim()
    ? `
    <tr>
      <td align="center" style="padding:14px 24px;background-color:#f7fafc;border-bottom:1px solid #eef0f3;">
        <p style="margin:0;font-size:12.5px;font-style:italic;font-weight:600;color:#00B5F9;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
          tagline
        )}</p>
      </td>
    </tr>`
    : "";

  const eyebrowHtml = eyebrow
    ? `<p style="margin:0 0 10px 0;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#00B5F9;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
        eyebrow
      )}</p>`
    : "";

  const introHtml = buildIntroHtml(introText, introImageSrc);

  const subheadingHtml = subheading && subheading.trim()
    ? `<h2 style="margin:6px 0 14px 0;font-size:17px;font-weight:800;color:#0f1115;line-height:1.4;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
        subheading
      )}</h2>`
    : "";

  const excerptHtml = buildExcerptHtml(bodyText);
  const highlightsHtml = buildHighlightsHtml(highlightsTitle, highlights);
  const ctaHtml = buildCtaHtml(ctaText, ctaLink);

  const unsubLinkHtml = unsubscribeEmail
    ? `<a href="mailto:${escapeHTML(
        unsubscribeEmail
      )}?subject=Unsubscribe" style="color:#00B5F9;text-decoration:underline;font-weight:600;">Unsubscribe</a>`
    : "Unsubscribe";

  const recipientDisplay = recipientEmail || "your email";

  const innerContentHtml = `
    ${eyebrowHtml}
    <h1 style="margin:0 0 20px 0;font-size:25px;font-weight:800;color:#00B5F9;line-height:1.3;font-family:'Segoe UI',Arial,sans-serif;">${escapeHTML(
      headline
    )}</h1>
    ${introHtml}
    ${subheadingHtml}
    ${excerptHtml}
    ${highlightsHtml}
    ${ctaHtml}
  `;

  return wrapEmailShell({
    subject,
    preheader,
    taglineHtml,
    innerContentHtml,
    unsubLinkHtml,
    recipientDisplay,
    logoSrc,
  });
}

module.exports = { buildNewsletterHTML, buildEmailPreviewHTML, htmlToPlainText, escapeHTML };