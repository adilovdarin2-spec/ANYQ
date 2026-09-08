/**
 * Shrinking a photograph before it leaves the phone.
 *
 * A modern phone camera produces four megabytes of a piece of paper, and all
 * anybody needs is to be able to read the quantities on it. Sending the
 * original would cost the shop its connection on a bad morning and the server
 * its storage, for no gain: a delivery note at 1200px is legible and lands
 * around 150 KB.
 *
 * Done here rather than on the server deliberately. Resizing server-side means
 * the big file travels anyway — which is the expensive part on a warehouse
 * connection — and means the server decoding untrusted image data, which is
 * exactly the thing worth not doing.
 */

import { translate } from './i18n';
import { getLanguage } from './i18n/useLanguage';

/**
 * One phrase, outside React.
 *
 * These modules are not components and cannot use the hook, so they read the
 * current language directly. The strings here are only ever fallbacks for when
 * the server said nothing — which is the offline case, and the one where a
 * cashier most needs to understand what happened.
 */
function say(key: Parameters<typeof translate>[1]): string {
  return translate(getLanguage(), key);
}

/** The long edge, after shrinking. Enough to read a handwritten quantity. */
export const MAX_PHOTO_EDGE = 1200;

/** Re-encoded at this quality, which is where paper stops looking worse. */
export const PHOTO_QUALITY = 0.72;

export interface PreparedPhoto {
  /** Base64 without a data: prefix, which is what the server reads. */
  base64: string;
  width: number;
  height: number;
}

function scaleToFit(width: number, height: number, edge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  // Never enlarged: a photo already smaller than the limit is left alone rather
  // than blown up into a bigger, blurrier file.
  if (longest <= edge) return { width, height };
  const factor = edge / longest;
  return { width: Math.round(width * factor), height: Math.round(height * factor) };
}

/**
 * Reads a file the camera or the gallery gave us and shrinks it.
 *
 * Goes through an ImageBitmap where the browser has one, because it decodes off
 * the main thread — a four-megapixel decode on the UI thread freezes the till
 * for a second, which on a device somebody is holding reads as a crash.
 */
export async function preparePhoto(file: File, edge = MAX_PHOTO_EDGE): Promise<PreparedPhoto> {
  const source = await loadImage(file);
  const size = scaleToFit(source.width, source.height, edge);

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(say('net.photoProcessFailed'));
  context.drawImage(source as CanvasImageSource, 0, 0, size.width, size.height);

  // JPEG, whatever came in. A phone's HEIC is smaller but a browser cannot be
  // relied on to display it, and a photo nobody can open is not evidence.
  const dataUrl = canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
  if ('close' in source && typeof source.close === 'function') source.close();

  return {
    base64: dataUrl.replace(/^data:[^;]+;base64,/, ''),
    width: size.width,
    height: size.height,
  };
}

type DecodedImage = (ImageBitmap | HTMLImageElement) & { width: number; height: number; close?: () => void };

async function loadImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return (await createImageBitmap(file)) as DecodedImage;
    } catch {
      // Safari has historically refused some HEIC files here while the <img>
      // path below handles them, so this falls through rather than failing.
    }
  }

  return new Promise<DecodedImage>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image as DecodedImage);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(say('net.photoReadFailed')));
    };
    image.src = url;
  });
}

export { scaleToFit };
