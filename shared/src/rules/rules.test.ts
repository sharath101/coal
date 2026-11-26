import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  checkChatFile,
  checkUpload,
  chatFileKind,
  looksLikeImage,
} from './files';
import { normalizePersonName } from './names';

describe('checkChatFile', () => {
  const limit = 10 * 1024 * 1024;

  it('takes documents and pictures, and says which', () => {
    expect(chatFileKind('Report.PDF')).toBe('document');
    expect(chatFileKind('notes.txt')).toBe('document');
    expect(chatFileKind('photo.jpeg')).toBe('image');
    expect(checkChatFile({ name: 'rig.webp', size: 5 }, limit)).toEqual({
      ok: true,
      kind: 'image',
    });
  });

  it.each([
    [{ name: 'model.step', size: 10 }, 'type'],
    [{ name: 'sheet.xlsx', size: 10 }, 'type'],
    [{ name: 'phone.heic', size: 10 }, 'type'],
    [{ name: 'empty.pdf', size: 0 }, 'empty'],
    [{ name: 'big.pdf', size: limit + 1 }, 'size'],
  ])('refuses %o (%s)', (file, reason) => {
    expect(checkChatFile(file, limit)).toEqual({ ok: false, reason });
  });

  it('keeps to the setting, and never allows more than any upload', () => {
    expect(checkChatFile({ name: 'a.pdf', size: 2000 }, 1000)).toEqual({
      ok: false,
      reason: 'size',
    });
    expect(
      checkChatFile({ name: 'a.pdf', size: MAX_UPLOAD_BYTES + 1 }, MAX_UPLOAD_BYTES * 5),
    ).toEqual({ ok: false, reason: 'size' });
  });
});

describe('looksLikeImage', () => {
  it('checks the first bytes against the type the name claims', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(looksLikeImage('png', png)).toBe(true);
    expect(looksLikeImage('JPG', jpg)).toBe(true);
    expect(looksLikeImage('webp', webp)).toBe(true);
    expect(looksLikeImage('png', jpg)).toBe(false);
    expect(looksLikeImage('png', new TextEncoder().encode('<html>'))).toBe(false);
    expect(looksLikeImage('gif', png)).toBe(false);
  });
});

describe('checkUpload', () => {
  it('takes the content type from the extension, not from the browser', () => {
    expect(checkUpload({ name: 'Drawing.STEP', size: 10 })).toEqual({
      ok: true,
      contentType: 'model/step',
    });
  });

  it.each([
    [{ name: 'macro.exe', size: 10 }, 'type'],
    [{ name: 'no-extension', size: 10 }, 'type'],
    [{ name: 'empty.pdf', size: 0 }, 'empty'],
    [{ name: 'huge.pdf', size: MAX_UPLOAD_BYTES + 1 }, 'size'],
  ])('refuses %o (%s)', (file, reason) => {
    expect(checkUpload(file)).toEqual({ ok: false, reason });
  });
});

describe('person names', () => {
  it('are tidied before they are stored', () => {
    expect(normalizePersonName('  Asha   Example ')).toBe('Asha Example');
  });
});
