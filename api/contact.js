// POST /api/contact — appointment enquiry from Contact.dc.html.
// Validates the request, then forwards it (with the server-only secret) to the clinic's
// Google Apps Script web app, which emails the clinic. Nothing is stored here.
// Env: GOOGLE_APPS_SCRIPT_URL (the web app's /exec URL), GOOGLE_APPS_SCRIPT_SECRET (= CONFIG.API_SECRET).
'use strict';

const MAX_BODY_BYTES = 10 * 1024;
const UPSTREAM_TIMEOUT_MS = 25000; // keep below maxDuration in vercel.json
const LIMITS = { name: 100, phone: 20, treatment: 60, message: 2000 };
// Must match the <option> values in Contact.dc.html.
const TREATMENTS = new Set([
  'Teeth Whitening', 'Braces & Aligners', 'Root Canal Treatment', 'Dental Implants', 'Crowns & Bridges',
  'Dental Cleaning & Check-up', 'Cosmetic Dentistry', 'Gum Treatment', 'Pediatric Dentistry', 'Other',
]);
// Indian mobile number, optionally prefixed with +91, 91 or 0 (separators already stripped).
const PHONE_RE = /^(?:\+91|91|0)?[6-9]\d{9}$/;

function send(res, status, success, message, extra) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(Object.assign({ success, message }, extra)));
}

function header(req, name) {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v || '';
}

// Browsers always send Origin on a cross-site POST; reject any that isn't this site.
function isSameOrigin(req) {
  const origin = header(req, 'origin');
  if (!origin) return true;
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  try { return new URL(origin).host === host; } catch (e) { return false; }
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Returns the parsed object, or null if the body is missing, too large or not a JSON object.
async function readJson(req) {
  let body;
  try { body = req.body; } catch (e) { return null; } // Vercel's parser throws on malformed JSON
  if (body === undefined) {
    try { body = await readRaw(req); } catch (e) { return null; }
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return null;
    try { body = JSON.parse(body); } catch (e) { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function validate(body) {
  const v = {}, errors = {};
  for (const k of Object.keys(LIMITS)) {
    const raw = body[k];
    v[k] = typeof raw === 'string' ? raw.trim() : '';
    if (v[k].length > LIMITS[k]) errors[k] = 'Too long.';
  }
  if (v.name.length < 2 && !errors.name) errors.name = 'Please enter your full name.';
  if (!v.phone) errors.phone = 'Please enter a phone number.';
  else if (!errors.phone && !PHONE_RE.test(v.phone.replace(/[\s\-()]/g, ''))) errors.phone = 'Enter a valid 10-digit mobile number.';
  if (!TREATMENTS.has(v.treatment)) errors.treatment = 'Please select a treatment.';
  if (v.message.length < 3 && !errors.message) errors.message = 'Please tell us the reason for your enquiry.';
  return { values: v, errors };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, false, 'Method not allowed.');
  }
  if (!isSameOrigin(req)) return send(res, 403, false, 'Forbidden.');
  if (!/^application\/json\b/i.test(header(req, 'content-type'))) return send(res, 415, false, 'Expected a JSON request.');
  if (+header(req, 'content-length') > MAX_BODY_BYTES) return send(res, 413, false, 'Request too large.');

  const body = await readJson(req);
  if (!body) return send(res, 400, false, 'Invalid request.');
  const { values, errors } = validate(body);
  if (Object.keys(errors).length) return send(res, 400, false, 'Please check the highlighted fields.', { errors });

  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
  if (!url || !secret) {
    console.error('contact: GOOGLE_APPS_SCRIPT_URL or GOOGLE_APPS_SCRIPT_SECRET is not configured');
    return send(res, 500, false, 'Unable to process the enquiry. Please try again.');
  }

  // Apps Script answers a POST with a 302 to script.googleusercontent.com; fetch follows it (as a GET,
  // per spec) to reach the script's JSON output. A rejected secret still returns HTTP 200, so the
  // `success` flag in the body is the only reliable signal.
  let result;
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ secret, ...values }),
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await upstream.text();
    try { result = JSON.parse(text); } catch (e) { result = null; }
    if (!upstream.ok || !result || result.success !== true) {
      console.error('contact: Apps Script did not confirm the enquiry', upstream.status, result && typeof result.message === 'string' ? result.message.slice(0, 200) : '(non-JSON response)');
      return send(res, 502, false, 'Unable to process the enquiry. Please try again.');
    }
  } catch (e) {
    console.error('contact: Apps Script request failed:', e && e.name);
    return send(res, 502, false, 'Unable to process the enquiry. Please try again.');
  }

  return send(res, 200, true, 'Appointment enquiry submitted successfully.');
};
