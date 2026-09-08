import { describe, it, expect } from 'vitest';
import {
  detectImageType,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_DOCUMENT,
  photoErrorMessage,
  readPhoto,
} from './photos';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(20),
]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)]);
const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('heic'), Buffer.alloc(20)]);

describe('detectImageType', () => {
  it('recognises the formats a phone produces', () => {
    expect(detectImageType(jpeg)).toBe('image/jpeg');
    expect(detectImageType(png)).toBe('image/png');
    expect(detectImageType(webp)).toBe('image/webp');
    // An iPhone photographs delivery notes in HEIC by default.
    expect(detectImageType(heic)).toBe('image/heic');
  });

  it('reads the content, not a declared type', () => {
    // The declaration is whatever the caller chose to send. Trusting it is how
    // an image upload becomes a stored cross-site scripting hole.
    const html = Buffer.from('<script>alert(1)</script>                ');
    expect(detectImageType(html)).toBeNull();
  });

  it('refuses a file too short to identify', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('refuses an ISO media file that is not a photo', () => {
    // An mp4 is the same container shape; only the brand says what it holds.
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('isom'), Buffer.alloc(20)]);
    expect(detectImageType(mp4)).toBeNull();
  });
});

describe('readPhoto', () => {
  it('accepts a photo and says what it is', () => {
    const result = readPhoto(jpeg.toString('base64'), 0);
    expect(result).toMatchObject({ status: 'ok', mimeType: 'image/jpeg' });
  });

  it('accepts the data: URL a browser canvas produces', () => {
    // Refusing the prefix would mean every caller has to remember to strip it.
    const result = readPhoto(`data:image/jpeg;base64,${jpeg.toString('base64')}`, 0);
    expect(result).toMatchObject({ status: 'ok', mimeType: 'image/jpeg' });
  });

  it('refuses nothing at all', () => {
    expect(readPhoto('', 0)).toEqual({ status: 'empty' });
    expect(readPhoto(undefined, 0)).toEqual({ status: 'empty' });
    expect(readPhoto(42, 0)).toEqual({ status: 'empty' });
  });

  it('refuses something that is not an image', () => {
    const text = Buffer.from('это не фотография, а просто текст').toString('base64');
    expect(readPhoto(text, 0)).toEqual({ status: 'notAnImage' });
  });

  it('refuses an oversized payload before decoding it', () => {
    // Base64 is a third larger than what it carries, so the length check comes
    // first and the bytes are never allocated.
    const huge = 'A'.repeat(Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 8);
    const result = readPhoto(huge, 0);
    expect(result.status).toBe('tooLarge');
  });

  it('refuses one photo too many', () => {
    expect(readPhoto(jpeg.toString('base64'), MAX_PHOTOS_PER_DOCUMENT)).toEqual({ status: 'tooMany' });
  });

  it('allows the last permitted photo', () => {
    expect(readPhoto(jpeg.toString('base64'), MAX_PHOTOS_PER_DOCUMENT - 1)).toMatchObject({ status: 'ok' });
  });

  it('refuses base64 that decodes to nothing', () => {
    expect(readPhoto('====', 0)).toEqual({ status: 'empty' });
  });
});

describe('what the storeman is told', () => {
  it('says the limit in megabytes, not bytes', () => {
    expect(photoErrorMessage({ status: 'tooLarge', bytes: 9_000_000 })).toContain('2 МБ');
  });

  it('names the formats that work', () => {
    expect(photoErrorMessage({ status: 'notAnImage' })).toContain('JPEG');
  });

  it('says how many photos are allowed', () => {
    expect(photoErrorMessage({ status: 'tooMany' })).toContain(String(MAX_PHOTOS_PER_DOCUMENT));
  });
});
