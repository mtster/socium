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

function checkWebpSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

async function exportCanvasToCompressedBlob(
  canvas: HTMLCanvasElement,
  quality: number,
  defaultFilename: string
): Promise<File> {
  const supportsWebP = checkWebpSupport();
  const primaryFormat = supportsWebP ? 'image/webp' : 'image/jpeg';
  const cleanBase = defaultFilename.replace(/\.[^.]+$/, '');
  const primaryExt = supportsWebP ? '.webp' : '.jpg';
  const initialFilename = `${cleanBase}${primaryExt}`;

  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Canvas export failed'));

        // If the browser silently fell back to uncompressed image/png (common in some WebKit/Safari engines),
        // re-encode immediately as image/jpeg so it never balloons to a 1.6MB PNG
        if (blob.type === 'image/png') {
          canvas.toBlob(
            (jpegBlob) => {
              if (!jpegBlob) return resolve(new File([blob], `${cleanBase}.png`, { type: 'image/png' }));
              resolve(new File([jpegBlob], `${cleanBase}.jpg`, { type: 'image/jpeg' }));
            },
            'image/jpeg',
            quality
          );
          return;
        }

        resolve(new File([blob], initialFilename, { type: blob.type }));
      },
      primaryFormat,
      quality
    );
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

  // Export Low-Res WebP (with JPEG fallback)
  const lowResFile = await exportCanvasToCompressedBlob(lowResCanvas, 0.75, 'avatar.webp');

  // Export High-Res WebP (with JPEG fallback)
  const highResFile = await exportCanvasToCompressedBlob(highResCanvas, 0.80, 'avatar_hd.webp');

  return { lowResFile, highResFile };
}

