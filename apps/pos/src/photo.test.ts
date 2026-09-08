import { describe, it, expect } from 'vitest';
import { MAX_PHOTO_EDGE, scaleToFit } from './photo';

describe('scaleToFit', () => {
  it('shrinks a phone photo to the long edge', () => {
    // A modern camera gives 4032×3024; all anybody needs is to read the
    // quantities written on the paper.
    expect(scaleToFit(4032, 3024, 1200)).toEqual({ width: 1200, height: 900 });
  });

  it('keeps the orientation it was taken in', () => {
    expect(scaleToFit(3024, 4032, 1200)).toEqual({ width: 900, height: 1200 });
  });

  it('leaves a photo already small enough alone', () => {
    // Rather than blowing it up into a bigger, blurrier file.
    expect(scaleToFit(800, 600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('leaves one exactly at the limit alone', () => {
    expect(scaleToFit(1200, 900, 1200)).toEqual({ width: 1200, height: 900 });
  });

  it('handles a square', () => {
    expect(scaleToFit(2000, 2000, 1200)).toEqual({ width: 1200, height: 1200 });
  });

  it('rounds to whole pixels, because a canvas cannot be a fraction wide', () => {
    const result = scaleToFit(1001, 333, 1000);
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
  });

  it('defaults to an edge that keeps handwriting legible', () => {
    expect(MAX_PHOTO_EDGE).toBe(1200);
  });
});
