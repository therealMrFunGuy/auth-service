import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM ?? "PlowProof <no-reply@example.com>";

type Mail = { to: string; subject: string; text: string; html: string; replyTo?: string };

/**
 * Sends through Resend when RESEND_API_KEY is set.
 * Without a key (local dev), prints the email to the terminal so you can click the link.
 */
export async function sendEmail({ to, subject, text, html, replyTo }: Mail) {
  if (!resend) {
    console.log(`\n── Email (dev, not sent) ──\nTo: ${to}\nSubject: ${subject}\n\n${text}\n──────────────────────────\n`);
    return;
  }
  const { error } = await resend.emails.send({ from: FROM, to, subject, text, html, replyTo });
  if (error) throw new Error(`Email to ${to} failed: ${error.message}`);
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buttonEmail(opts: { heading: string; body: string; cta: string; url: string; footer: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#EEF1F4;font-family:Arial,Helvetica,sans-serif;color:#15202B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:6px;border-top:6px solid #F2A900">
<tr><td style="padding:28px 28px 8px"><h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">${escape(opts.heading)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5">${escape(opts.body)}</p>
<a href="${opts.url}" style="display:inline-block;background:#15202B;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:4px">${escape(opts.cta)}</a>
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#5B6875">${escape(opts.footer)}</p></td></tr>
<tr><td style="padding:0 28px 28px"></td></tr></table></td></tr></table></body></html>`;
  const text = `${opts.heading}\n\n${opts.body}\n\n${opts.cta}: ${opts.url}\n\n${opts.footer}`;
  return { html, text };
}
