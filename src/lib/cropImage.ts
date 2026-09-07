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

import encodeWebp from '@jsquash/webp/encode';

async function exportCanvasToWebp(
  canvas: HTMLCanvasElement,
  quality: number,
  filename: string
): Promise<File> {
  // 1. Try native canvas WebP export
  const nativeBlob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(
        (b) => {
          if (b && b.type === 'image/webp') {
            resolve(b);
          } else {
            resolve(null);
          }
        },
        'image/webp',
        quality
      );
    } catch {
      resolve(null);
    }
  });

  if (nativeBlob) {
    return new File([nativeBlob], filename, { type: 'image/webp' });
  }

  // 2. Use @jsquash/webp (WebAssembly) to encode raw ImageData to WebP exclusively
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context for WebP encoding');

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const webpBuffer = await encodeWebp(imageData, {
    quality: Math.round(quality * 100),
  });

  const webpBlob = new Blob([webpBuffer], { type: 'image/webp' });
  return new File([webpBlob], filename, { type: 'image/webp' });
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
  // 1080x1080 provides high fidelity on Retina screens while reducing multi-MB images down to ~60-120KB
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

  // Export Low-Res WebP exclusively
  const lowResFile = await exportCanvasToWebp(lowResCanvas, 0.75, 'avatar.webp');

  // Export High-Res WebP exclusively
  const highResFile = await exportCanvasToWebp(highResCanvas, 0.80, 'avatar_hd.webp');

  return { lowResFile, highResFile };
}

