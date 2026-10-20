// Sends email through your Google Apps Script sender (same one as Chronos).
// Set GMAIL_SCRIPT_URL + GMAIL_SCRIPT_SECRET. Without them, emails are printed in the server log
// (and the login code is shown on screen when running locally or with OTP_DEMO_MODE=true).
import { escapeHtml, publicBaseUrl } from './util.js';

const APP = 'BorrowBox';
const ACCENT = '#1d7a5f';

export function emailMode() {
  return process.env.GMAIL_SCRIPT_URL && process.env.GMAIL_SCRIPT_SECRET ? 'apps-script' : 'none';
}

function wrap(innerHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#18201c">
  <div style="font-size:20px;font-weight:700;margin-bottom:16px"><span style="color:${ACCENT}">&#9632;</span> ${APP}</div>
  ${innerHtml}
  <p style="margin:24px 0 0;color:#6b746f;font-size:12px">You get this because you are in a ${APP} circle. You can turn these emails off in Settings.</p>
</div>`;
}

async function send(to, subject, text, html) {
  if (emailMode() === 'none') {
    console.log(`\n[EMAIL to ${to}] ${subject}\n${text}\n`);
    return { dev: true };
  }
  const res = await fetch(process.env.GMAIL_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: process.env.GMAIL_SCRIPT_SECRET, to, subject, text, html, name: APP }),
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.text();
  let data = {};
  try { data = JSON.parse(body); } catch { /* a Google sign-in page means the script access is not "Anyone" */ }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'the Gmail script did not accept the request (check the script URL, the secret, and that access is set to "Anyone")');
  }
  return { dev: false };
}

export async function sendCodeEmail(to, code, name) {
  const subject = `${code} is your ${APP} code`;
  const text = `Hi ${name || 'there'},\n\nYour ${APP} login code is ${code}.\nIt expires in 10 minutes.\n\nIf you didn't ask for this, you can ignore this email.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#18201c">
  <div style="font-size:20px;font-weight:700;margin-bottom:16px"><span style="color:${ACCENT}">&#9632;</span> ${APP}</div>
  <p style="margin:0 0 12px">Hi ${escapeHtml(name || 'there')},</p>
  <p style="margin:0 0 16px">Your login code is:</p>
  <div style="font-size:34px;font-weight:700;letter-spacing:8px;background:#eef5f1;border-radius:12px;padding:16px;text-align:center">${code}</div>
  <p style="margin:16px 0 0;color:#6b746f;font-size:13px">It expires in 10 minutes. If you didn't ask for this, you can ignore this email.</p>
</div>`;
  const r = await send(to, subject, text, html);
  return { dev: r.dev && (process.env.NODE_ENV !== 'production' || process.env.OTP_DEMO_MODE === 'true') };
}

export async function sendNoticeEmail(to, name, title, body, link) {
  const base = publicBaseUrl();
  const url = link && base ? `${base}${link}` : null;
  const text = `Hi ${name || 'there'},\n\n${title}\n${body || ''}\n${url ? `\nOpen: ${url}\n` : ''}`;
  const html = wrap(`<p style="margin:0 0 10px">Hi ${escapeHtml(name || 'there')},</p>
  <p style="margin:0 0 8px;font-size:16px;font-weight:700">${escapeHtml(title)}</p>
  ${body ? `<p style="margin:0 0 16px;color:#38423d">${escapeHtml(body)}</p>` : ''}
  ${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700">Open BorrowBox</a>` : ''}`);
  return send(to, `${title} – ${APP}`, text, html);
}
