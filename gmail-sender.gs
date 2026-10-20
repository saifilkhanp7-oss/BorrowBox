/**
 * BorrowBox — Gmail sender (Google Apps Script)
 *
 * You can reuse the SAME script you made for Chronos – BorrowBox sends the
 * same request format. Just put the same URL and secret in Render.
 *
 * Making a new one:
 * 1. Go to https://script.google.com (signed in to the Gmail that should send emails) → New project.
 * 2. Paste this whole file. Change SECRET below to a long random text.
 * 3. Run testSend once (select it → Run) and allow the permissions.
 * 4. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 * 5. Copy the Web app URL → Render env var GMAIL_SCRIPT_URL. Put the SECRET in GMAIL_SCRIPT_SECRET.
 */
const SECRET = 'CHANGE-ME-to-a-long-random-secret';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d || d.secret !== SECRET) return reply({ ok: false, error: 'wrong secret' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.to || '')) return reply({ ok: false, error: 'bad address' });
    MailApp.sendEmail({
      to: d.to,
      subject: String(d.subject || 'BorrowBox').slice(0, 200),
      body: String(d.text || ''),
      htmlBody: String(d.html || ''),
      name: d.name || 'BorrowBox',
    });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to give the script permission to send mail. */
function testSend() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'BorrowBox test', 'The BorrowBox Gmail sender works.');
}
