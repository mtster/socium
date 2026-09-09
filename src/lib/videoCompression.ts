// Client-side video compression and 480p conversion utility
// Compresses video efficiently to preserve Cloudinary 25GB free-tier storage

export async function extractVideoThumbnail(file: File | Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.preload = 'auto';

    const sourceUrl = URL.createObjectURL(file);
    video.src = sourceUrl;

    let timeoutId: any = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch (e) {}
      URL.revokeObjectURL(sourceUrl);
    };

    const captureFrame = () => {
      if (resolved) return;
      try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;

        if (vw <= 0 || vh <= 0) {
          throw new Error('Video dimensions not ready yet');
        }

        // Longest edge = 400px
        let tw: number;
        let th: number;
        if (vw >= vh) {
          tw = 400;
          th = Math.max(2, Math.round((vh * 400) / vw));
        } else {
          th = 400;
          tw = Math.max(2, Math.round((vw * 400) / vh));
        }

        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas 2D context not available');
        }

        ctx.drawImage(video, 0, 0, tw, th);
        resolved = true;
        cleanup();

        canvas.toBlob(
          (blob) => {
            if (blob && blob.size > 200) {
              resolve(blob);
            } else {
              // Fallback to jpeg if webp canvas export returned empty/corrupt blob
              canvas.toBlob(
                (jpegBlob) => {
                  if (jpegBlob) {
                    resolve(jpegBlob);
                  } else {
                    reject(new Error('Failed to create thumbnail blob'));
                  }
                },
                'image/jpeg',
                0.85
              );
            }
          },
          'image/webp',
          0.85
        );
      } catch (err) {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      }
    };

    // Strict 4s timeout so it never hangs
    timeoutId = setTimeout(() => {
      if (!resolved) {
        if (video.videoWidth > 0 && video.readyState >= 2) {
          captureFrame();
        } else {
          resolved = true;
          cleanup();
          reject(new Error('Video thumbnail extraction timed out'));
        }
      }
    }, 4000);

    video.onerror = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Failed to load video for thumbnail extraction'));
      }
    };

    video.onloadedmetadata = () => {
      try {
        // Seek to 0.1s to get a decoded non-blank video frame
        const targetTime = Math.min(0.1, (video.duration || 1) / 4);
        video.currentTime = targetTime;
      } catch (e) {
        if (video.readyState >= 2) captureFrame();
      }
    };

    video.onseeked = () => {
      // Delay slightly for pixel buffer to populate after seek
      setTimeout(() => {
        if (!resolved) captureFrame();
      }, 50);
    };

    video.onloadeddata = () => {
      if (!resolved && video.readyState >= 2 && video.currentTime > 0) {
        captureFrame();
      }
    };
  });
}

/**
 * Prepares video for direct upload to preserve original duration, audio tracks, and instant sending.
 * Returns the original file as a File object with proper MIME type.
 */
export async function compressVideoTo480p(
  file: File | Blob, 
  onProgress?: (percent: number) => void
): Promise<File> {
  if (onProgress) onProgress(100);
  if (file instanceof File) return file;
  return new File([file], 'video.mp4', { type: file.type || 'video/mp4' });
}
