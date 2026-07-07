import sharp from 'sharp';

export interface OptimizedImage {
  buffer: Buffer;
  contentType: 'image/webp';
  width: number;
  height: number;
  originalSizeBytes: number;
  profile: string;
}

export class ImageOptimizer {
  public readonly profile: string;

  public constructor(
    private readonly maxWidth: number,
    private readonly maxHeight: number,
    private readonly quality: number,
  ) {
    this.profile = `webp-${maxWidth}x${maxHeight}-q${quality}-v1`;
  }

  public async optimize(input: Buffer): Promise<OptimizedImage> {
    const result = await sharp(input, { limitInputPixels: 100_000_000 })
      .rotate()
      .resize({
        width: this.maxWidth,
        height: this.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: this.quality, alphaQuality: 80, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: result.data,
      contentType: 'image/webp',
      width: result.info.width,
      height: result.info.height,
      originalSizeBytes: input.length,
      profile: this.profile,
    };
  }
}
