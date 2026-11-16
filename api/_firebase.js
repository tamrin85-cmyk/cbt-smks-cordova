import admin from 'firebase-admin';
import crypto from 'node:crypto';

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Environment variable FIREBASE_SERVICE_ACCOUNT_JSON belum diatur.');
  }
  let jsonText = raw.trim();
  if (!jsonText.startsWith('{')) {
    jsonText = Buffer.from(jsonText, 'base64').toString('utf8');
  }
  const parsed = JSON.parse(jsonText);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(parseServiceAccount())
  });
}

export const db = admin.firestore();

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET belum diatur atau terlalu pendek (min 16 karakter).');
  }
  return secret;
}

export function signToken(payload) {
  const data = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashPassword(raw) {
  return 'sha256:' + crypto.createHash('sha256').update(String(raw)).digest('hex');
}

export function verifyPassword(inputPass, storedPass) {
  const stored = String(storedPass || '').trim();
  const input = String(inputPass || '');
  if (!stored) return false;
  if (stored.startsWith('sha256:')) {
    return hashPassword(input) === stored;
  }
  return stored === input;
}

export function formatWibCompare(isoOrDate) {
  if (!isoOrDate) return null;
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return null;
  const parts = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hh}:${parts.minute}:${parts.second}`;
}

export function formatWibReadable(isoOrDate) {
  if (!isoOrDate) return '-';
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
}

export function parseWibInputToIso(str) {
  if (!str || String(str).trim() === '') return '';
  const clean = String(str).trim();
  if (clean.includes('+') || clean.endsWith('Z')) {
    const d = new Date(clean);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const normalized = clean.length === 16 ? `${clean}:00+07:00` : `${clean}+07:00`;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

let seeded = false;
export async function ensureInitialSeed() {
  if (seeded) return;
  const pengawasSnap = await db.collection('pengawas').limit(1).get();
  if (pengawasSnap.empty) {
    await db.collection('pengawas').add({
      user: 'smks',
      pass: hashPassword('Cordova'),
      nama: 'Super Administrator',
      role: 'Super Admin',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('pengawas').add({
      user: 'pengawas1',
      pass: hashPassword('guru123'),
      nama: 'Bapak Pengawas',
      role: 'Pengawas',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  const configDoc = await db.collection('settings').doc('app').get();
  if (!configDoc.exists) {
    await db.collection('settings').doc('app').set({
      logoUrl: 'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhD7mKvCj7XMXoZ3EGkFZ37RhLV42t8f6JOJRx8NZo5ehsSV0sM7eoErGMorImGx194-IuxEj6HHIVf-NsLeZaXdzumArgilOAr3AF6VpaQhCytLdDatqSz_mJ5W0MYvlih7ODJWklWHGkClRIsVr0fiwpbF4AEaxR2mEUWajlCrOCwv4WgLnNCRhhzqJg/w1200-h630-p-k-no-nu/logo%20smk%20kordova.png'
    });
  }
  seeded = true;
}
