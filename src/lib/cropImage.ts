export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.src = url;
  });

export async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  rotation = 0
): Promise<File | null> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return null;
  }

  // set canvas size to match the bounding box
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas is empty'));
        return;
      }
      resolve(new File([blob], 'cropped.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  });
}

export interface CroppedProfileImages {
  lowResFile: File;
  highResFile: File;
}

export async function getCroppedProfileImages(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number }
): Promise<CroppedProfileImages> {
  const image = await createImage(imageSrc);

  // 1. High-Resolution Canvas (Optimized for full-screen / Cloudinary)
  // 1080x1080 is ideal: sharp on 4K/retina displays, but drastic reduction vs multi-MB iPhone HEIF/HEIC
  const maxHighResDim = 1080;
  const highResSize = Math.min(Math.max(pixelCrop.width, pixelCrop.height), maxHighResDim);
  
  const highResCanvas = document.createElement('canvas');
  highResCanvas.width = highResSize;
  highResCanvas.height = highResSize;

  const highResCtx = highResCanvas.getContext('2d');
  if (!highResCtx) throw new Error('Could not initialize high-res canvas context');

  highResCtx.imageSmoothingEnabled = true;
  highResCtx.imageSmoothingQuality = 'high';

  highResCtx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    highResSize,
    highResSize
  );

  // 2. Low-Resolution Canvas (Optimized for small circular avatars)
  // 192x192 px provides crisp 3x retina detail for 40-64px circle avatars,
  // and in WebP at 0.75 quality only takes ~6KB - 12KB
  const lowResSize = 192;
  const lowResCanvas = document.createElement('canvas');
  lowResCanvas.width = lowResSize;
  lowResCanvas.height = lowResSize;

  const lowResCtx = lowResCanvas.getContext('2d');
  if (!lowResCtx) throw new Error('Could not initialize low-res canvas context');

  lowResCtx.imageSmoothingEnabled = true;
  lowResCtx.imageSmoothingQuality = 'high';

  lowResCtx.drawImage(
    highResCanvas,
    0,
    0,
    highResSize,
    highResSize,
    0,
    0,
    lowResSize,
    lowResSize
  );

  // Export Low-Res WebP
  const lowResFile = await new Promise<File>((resolve, reject) => {
    lowResCanvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Failed to generate low-res image'));
        resolve(new File([blob], 'avatar.webp', { type: 'image/webp' }));
      },
      'image/webp',
      0.75
    );
  });

  // Export High-Res WebP
  const highResFile = await new Promise<File>((resolve, reject) => {
    highResCanvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Failed to generate high-res image'));
        resolve(new File([blob], 'avatar_hd.webp', { type: 'image/webp' }));
      },
      'image/webp',
      0.82
    );
  });

  return { lowResFile, highResFile };
}

