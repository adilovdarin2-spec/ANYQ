/**
 * Accepting a photograph of a piece of paper.
 *
 * A delivery note is the only record of what the driver actually brought, and
 * it leaves with him. Every argument about a short delivery is an argument
 * about a document nobody has any more.
 *
 * Nothing here decodes the image. The format is identified by its magic bytes
 * and the size is bounded, and that is the whole of it — a server that parses
 * image data is a server with an image-parsing vulnerability, and the only
 * thing needed is to hand the same bytes back to a browser later.
 */

/**
 * The cap, after the phone has shrunk it.
 *
 * The client resizes to about 1200px and re-encodes as JPEG, which lands around
 * 150 KB. Two megabytes is generous room above that and still small enough that
 * a shop receiving deliveries all day costs megabytes a month, not gigabytes.
 */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export const MAX_PHOTOS_PER_DOCUMENT = 5;

export type PhotoFailure =
  | { status: 'empty' }
  | { status: 'tooLarge'; bytes: number }
  | { status: 'notAnImage' }
  | { status: 'tooMany' };

export type PhotoResult =
  | { status: 'ok'; bytes: Buffer; mimeType: string }
  | PhotoFailure;

export function photoErrorMessage(failure: PhotoFailure): string {
  switch (failure.status) {
    case 'empty':
      return 'Фото не приложено';
    case 'tooLarge':
      return `Фото слишком большое — не больше ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} МБ`;
    case 'notAnImage':
      return 'Это не фотография — приложите снимок в JPEG, PNG, WebP или HEIC';
    case 'tooMany':
      return `К одному документу можно приложить не больше ${MAX_PHOTOS_PER_DOCUMENT} фото`;
    default:
      return 'Не удалось сохранить фото';
  }
}

/**
 * What the bytes actually are.
 *
 * Read from the content rather than taken from a declared content type, because
 * the declaration is whatever the caller chose to send. Getting this right is
 * what lets the bytes be served back with a correct type later without a
 * browser ever being asked to sniff them — which is where an image upload turns
 * into a stored cross-site scripting hole.
 */
export function detectImageType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // RIFF....WEBP
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  // HEIC and its relatives: an ISO base media file whose brand says so. An
  // iPhone photographs delivery notes in this by default.
  if (bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1', 'msf1'].includes(brand)) {
      return 'image/heic';
    }
  }

  return null;
}

/**
 * Checks a base64 payload and hands back the bytes.
 *
 * Length is checked before decoding: base64 is a third larger than what it
 * carries, so an oversized payload is refused without ever being allocated.
 */
export function readPhoto(base64: unknown, existingCount: number): PhotoResult {
  if (existingCount >= MAX_PHOTOS_PER_DOCUMENT) return { status: 'tooMany' };
  if (typeof base64 !== 'string' || base64.length === 0) return { status: 'empty' };

  // A data: URL is what a browser's canvas gives you, so the prefix is stripped
  // rather than refused — refusing it would mean every caller has to remember.
  const payload = base64.replace(/^data:[^;]+;base64,/, '');
  if (payload.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 4) {
    return { status: 'tooLarge', bytes: Math.floor((payload.length * 3) / 4) };
  }

  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length === 0) return { status: 'empty' };
  if (bytes.length > MAX_PHOTO_BYTES) return { status: 'tooLarge', bytes: bytes.length };

  const mimeType = detectImageType(bytes);
  if (!mimeType) return { status: 'notAnImage' };

  return { status: 'ok', bytes, mimeType };
}
