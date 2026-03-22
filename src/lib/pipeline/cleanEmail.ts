// These local parts are always rejected regardless of domain
const REJECT_LOCALS = new Set([
  'noemail', 'no-email', 'no-reply', 'noreply', 'donotreply', 'do-not-reply',
]);

// These are only rejected with generic domains like gmail.com
const PLACEHOLDER_LOCALS = new Set([
  'name', 'user', 'domain', 'youremail',
]);

const PLACEHOLDER_FULL = new Set([
  'name@domain.com',
  'user@domain.com',
  'domain@gmail.com',
  'firstchoicetempagency@gmail.com',
]);

const IMAGE_EXTS = /\.(png|jpg|jpeg|svg|webp|gif)$/i;

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Known TLDs we expect — used to strip trailing garbage after the TLD
const TLDS = /\.(ca|com|net|org|io|co|info|biz|us|uk|au|de|fr|nz|in)(.*)/i;

export function cleanEmail(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let email = raw.trim().toLowerCase();

  // URL-decode
  try {
    email = decodeURIComponent(email);
  } catch { /* leave as-is if malformed */ }

  // Strip leading "mailto:" or "email" prefix before local part
  email = email.replace(/^mailto:/, '');
  email = email.replace(/^email(?=[a-z])/, '');

  // If junk precedes an "email" or "mailto" marker, extract from there
  // e.g. canalsveneerscontactcontactphone780-420-6073emailreception@foo.ca → reception@foo.ca
  const emailMarker = email.search(/(?:email|mailto:?)(?=[a-z])/i);
  if (emailMarker > 0) {
    email = email.slice(emailMarker).replace(/^email:?|^mailto:?/, '');
  }

  // Strip phone+dot prefix: 780.472.9494whiteoaksdental@live.ca
  email = email.replace(/^[\d][\d.\-()]+(?=[a-z])/i, '');

  // Reject: contains "null" anywhere
  if (email.includes('null')) return null;

  // Reject: no @, spaces
  if (!email.includes('@')) return null;
  if (/\s/.test(email)) return null;

  // Reject: starts with digits followed by non-digit before @
  // e.g. 4446484info@, 439-6472reception@, 780-462-9200info@
  if (/^[\d][\d\-.()\s]*[a-z]/i.test(email.split('@')[0])) return null;

  // Reject: starts with alphanumeric codes like 3v1, 4l2, 2l8
  if (/^\d[a-z]\d/i.test(email.split('@')[0])) return null;

  // Reject: image file references
  if (IMAGE_EXTS.test(email)) return null;

  // Reject: chosen-sprite and similar non-email local parts
  const local = email.split('@')[0];
  if (/sprite|chosen|css|\.js$|\.css$/.test(local)) return null;


  // Strip trailing garbage after valid TLD
  const atIdx = email.indexOf('@');
  const domain = email.slice(atIdx + 1);
  const tldMatch = domain.match(TLDS);
  if (tldMatch) {
    const cleanDomain = domain.slice(0, tldMatch.index! + tldMatch[1].length + 1);
    email = email.slice(0, atIdx + 1) + cleanDomain;
  }

  // Reject: placeholder domains
  const finalDomain = email.split('@')[1];
  if (finalDomain === 'domain.com' || finalDomain === 'youremail.com') return null;

  // Reject: placeholder full addresses
  if (PLACEHOLDER_FULL.has(email)) return null;

  // Reject: always-invalid local parts (noemail, noreply, etc.) on any domain
  const finalLocal = email.split('@')[0];
  if (REJECT_LOCALS.has(finalLocal)) return null;

  // Reject: placeholder local parts with generic domains
  if (PLACEHOLDER_LOCALS.has(finalLocal) && finalDomain === 'gmail.com') return null;

  // Final validation
  if (!VALID_EMAIL.test(email)) return null;

  return email;
}
