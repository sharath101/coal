import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, checkUpload } from './files';
import { normalizePersonName } from './names';

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
