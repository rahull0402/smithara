// Tests for api/contact.js. Run from the project root: node --test
// Google Apps Script is mocked via global fetch; no network requests or emails are sent.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const handler = createRequire(import.meta.url)('../api/contact.js');
const GAS_URL = 'https://script.google.com/macros/s/test-deployment/exec';
const SECRET = 'test-secret-value';
const VALID = { name: 'Test Patient', phone: '+91 98765 43210', treatment: 'Root Canal Treatment', message: 'Tooth pain on the lower left side.' };

let calls, logs, realFetch, realError;

function mockFetch(impl) {
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init); };
}
const gasReply = (obj, status = 200) => () => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

async function call({ method = 'POST', body = VALID, headers = {} } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from(method === 'POST' ? [Buffer.from(raw)] : []);
  req.method = method;
  req.headers = { host: 'smithara.example', 'content-type': 'application/json', origin: 'https://smithara.example', ...headers };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body), headers: res.headers };
}

beforeEach(() => {
  calls = []; logs = [];
  realFetch = globalThis.fetch; realError = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  process.env.GOOGLE_APPS_SCRIPT_URL = GAS_URL;
  process.env.GOOGLE_APPS_SCRIPT_SECRET = SECRET;
  mockFetch(gasReply({ success: true, message: 'Appointment enquiry submitted successfully.' }));
});
afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });

test('valid enquiry is forwarded with the secret and reports success', async () => {
  const r = await call();
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { success: true, message: 'Appointment enquiry submitted successfully.' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GAS_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'follow');
  const sent = Object.fromEntries(calls[0].init.body);
  assert.deepEqual(sent, { secret: SECRET, ...VALID });
});

test('response never echoes the secret', async () => {
  const r = await call();
  assert.ok(!JSON.stringify(r).includes(SECRET));
});

for (const field of ['name', 'phone', 'treatment', 'message']) {
  test(`missing ${field} is rejected without calling Apps Script`, async () => {
    const body = { ...VALID }; delete body[field];
    const r = await call({ body });
    assert.equal(r.status, 400);
    assert.equal(r.json.success, false);
    assert.ok(r.json.errors[field]);
    assert.equal(calls.length, 0);
  });
  test(`whitespace-only ${field} is rejected`, async () => {
    const r = await call({ body: { ...VALID, [field]: '   \n ' } });
    assert.equal(r.status, 400);
    assert.ok(r.json.errors[field]);
    assert.equal(calls.length, 0);
  });
}

test('invalid phone numbers are rejected', async () => {
  for (const phone of ['12345', '5876543210', '98765432101', 'abcdefghij', '+1 202 555 0143']) {
    const r = await call({ body: { ...VALID, phone } });
    assert.equal(r.status, 400, phone);
    assert.ok(r.json.errors.phone, phone);
  }
  assert.equal(calls.length, 0);
});

test('accepted phone formats, including numbers starting with 91', async () => {
  for (const phone of ['9876543210', '9123456789', '+919876543210', '09876543210', '(987) 654-3210']) {
    const r = await call({ body: { ...VALID, phone } });
    assert.equal(r.status, 200, phone);
  }
});

test('over-long fields and unknown treatments are rejected', async () => {
  assert.equal((await call({ body: { ...VALID, name: 'a'.repeat(101) } })).status, 400);
  assert.equal((await call({ body: { ...VALID, message: 'a'.repeat(2001) } })).status, 400);
  assert.equal((await call({ body: { ...VALID, treatment: 'Free iPhone' } })).status, 400);
  assert.equal((await call({ body: { ...VALID, name: ['x', 'y'] } })).status, 400);
  assert.equal(calls.length, 0);
});

test('Apps Script success:false is reported as failure', async () => {
  mockFetch(gasReply({ success: false, message: 'Unable to process the enquiry. Please try again.' }));
  const r = await call();
  assert.equal(r.status, 502);
  assert.equal(r.json.success, false);
});

test('invalid secret (HTTP 200 with success:false) is reported as failure', async () => {
  mockFetch(gasReply({ success: false, message: 'Unauthorized request.' }));
  const r = await call();
  assert.equal(r.status, 502);
  assert.equal(r.json.success, false);
});

test('HTTP 200 without a JSON success flag is not treated as success', async () => {
  mockFetch(gasReply('<!DOCTYPE html><html>Sign in</html>'));
  assert.equal((await call()).json.success, false);
  mockFetch(gasReply({ message: 'ok' }));
  assert.equal((await call()).json.success, false);
  mockFetch(gasReply({ success: 'true' }));
  assert.equal((await call()).json.success, false);
});

test('Apps Script HTTP error is reported as failure', async () => {
  mockFetch(gasReply({ success: true }, 500));
  assert.equal((await call()).status, 502);
});

test('network failure / timeout is reported as failure', async () => {
  mockFetch(() => { throw new TypeError('fetch failed'); });
  const r = await call();
  assert.equal(r.status, 502);
  assert.equal(r.json.success, false);
});

test('missing configuration fails closed', async () => {
  delete process.env.GOOGLE_APPS_SCRIPT_SECRET;
  const r = await call();
  assert.equal(r.status, 500);
  assert.equal(r.json.success, false);
  assert.equal(calls.length, 0);
});

test('logs never contain patient details or the secret', async () => {
  mockFetch(gasReply({ success: false, message: 'Unauthorized request.' }));
  await call();
  mockFetch(() => { throw new TypeError('fetch failed'); });
  await call();
  const all = logs.join('\n');
  assert.ok(logs.length > 0);
  for (const v of [SECRET, VALID.name, '98765', VALID.message]) assert.ok(!all.includes(v), v);
});

test('request guards: method, content type, origin, size, malformed JSON', async () => {
  const get = await call({ method: 'GET' });
  assert.equal(get.status, 405);
  assert.equal(get.headers.allow, 'POST');
  assert.equal((await call({ headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await call({ headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call({ headers: { origin: undefined } })).status, 200);
  assert.equal((await call({ headers: { 'content-length': '50000' } })).status, 413);
  assert.equal((await call({ body: { ...VALID, pad: 'x'.repeat(20000) } })).status, 400);
  assert.equal((await call({ body: '{not json' })).status, 400);
  assert.equal((await call({ body: '[1,2]' })).status, 400);
  assert.equal(calls.length, 1);
});

test('uses a body already parsed by the Vercel runtime', async () => {
  const req = Readable.from([]);
  req.method = 'POST';
  req.headers = { host: 'smithara.example', 'content-type': 'application/json' };
  req.body = VALID;
  const res = { setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).success, true);
});
