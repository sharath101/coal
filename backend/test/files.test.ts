import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signUp, type SignedIn, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedIn;
let other: SignedIn;

beforeAll(async () => {
  t = await createTestApp();
  owner = await signUp(t.app, { name: 'File Owner', roleKey: 'dard' });
  other = await signUp(t.app, { name: 'File Other', roleKey: 'rd_head' });
});
afterAll(async () => {
  await t?.close();
});

const content = new TextEncoder().encode('%PDF-1.4 made-up test report');

async function startUpload(cookie: string, payload: Record<string, unknown>) {
  return t.app.inject({
    method: 'POST',
    url: '/api/v1/files/upload-url',
    headers: { cookie },
    payload,
  });
}

describe('file storage', () => {
  it('uploads through a short-lived link, records the hash, and downloads', async () => {
    const start = await startUpload(owner.cookie, {
      name: 'Lab report.pdf',
      size: content.length,
      origin: 'outside',
    });
    expect(start.statusCode).toBe(201);
    const { file, upload } = start.json();
    expect(file).toMatchObject({
      mimeType: 'application/pdf',
      status: 'pending',
      origin: 'outside',
      sha256: null,
    });

    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
    expect(put.status).toBe(200);

    const done = await t.app.inject({
      method: 'POST',
      url: `/api/v1/files/${file.id}/complete`,
      headers: { cookie: owner.cookie },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      status: 'uploaded',
      sha256: createHash('sha256').update(content).digest('hex'),
    });

    const link = await t.app.inject({
      method: 'GET',
      url: `/api/v1/files/${file.id}/link`,
      headers: { cookie: owner.cookie },
    });
    const download = await fetch(link.json().url);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(content);
    expect(download.headers.get('content-disposition')).toContain('Lab%20report.pdf');
  });

  it('keeps serving the checked bytes even if the upload link is used again', async () => {
    const original = new TextEncoder().encode('first');
    const { file, upload } = (
      await startUpload(owner.cookie, { name: 'swap.pdf', size: original.length })
    ).json();
    await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: original });
    const done = await t.app.inject({
      method: 'POST',
      url: `/api/v1/files/${file.id}/complete`,
      headers: { cookie: owner.cookie },
    });
    expect(done.json().sha256).toBe(createHash('sha256').update(original).digest('hex'));

    // Same size, different bytes, through the still-valid link.
    await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: new TextEncoder().encode('SWAPD'),
    });
    // A different size is refused by storage, because the declared length is signed.
    const bigger = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: new Uint8Array(2000),
    });
    expect(bigger.ok).toBe(false);

    const link = await t.app.inject({
      method: 'GET',
      url: `/api/v1/files/${file.id}/link`,
      headers: { cookie: owner.cookie },
    });
    const served = new Uint8Array(await (await fetch(link.json().url)).arrayBuffer());
    expect(served).toEqual(original);
  });

  it("doesn't let others use someone's file before it's attached anywhere", async () => {
    const start = await startUpload(owner.cookie, { name: 'private.docx', size: 10 });
    const { file } = start.json();

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/files/${file.id}/link`,
      headers: { cookie: other.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: 'NOT_ALLOWED',
      whoCan: ['The person who uploaded it'],
    });
  });

  it('refuses to finish before the file arrives', async () => {
    const { file } = (await startUpload(owner.cookie, { name: 'later.png', size: 10 })).json();
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/files/${file.id}/complete`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('UPLOAD_INCOMPLETE');
  });

  it('refuses file types COAL does not accept', async () => {
    const res = await startUpload(owner.cookie, { name: 'tool.exe', size: 10 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('UPLOAD_NOT_ALLOWED');
  });
});
