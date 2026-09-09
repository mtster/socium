// Client-side video compression and 480p conversion utility
// Compresses video efficiently to preserve Cloudinary 25GB free-tier storage

export async function extractVideoThumbnail(file: File | Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const sourceUrl = URL.createObjectURL(file);
    video.src = sourceUrl;

    let cleanupDone = false;
    const cleanup = () => {
      if (cleanupDone) return;
      cleanupDone = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(sourceUrl);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video for thumbnail extraction'));
    };

    video.onloadeddata = () => {
      // Seek slightly into the video (0.05s) to guarantee first frame is available and avoid black frame
      video.currentTime = Math.min(0.05, (video.duration || 1) / 2);
    };

    video.onseeked = () => {
      try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;

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
          cleanup();
          return reject(new Error('Canvas 2D context not available'));
        }

        ctx.drawImage(video, 0, 0, tw, th);
        cleanup();

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create thumbnail WebP blob'));
            }
          },
          'image/webp',
          0.82
        );
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
  });
}

export function getSupportedVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

export async function compressVideoTo480p(
  file: File | Blob, 
  onProgress?: (percent: number) => void
): Promise<File> {
  return new Promise((resolve) => {
    // If MediaRecorder or canvas captureStream is not supported, safely return original
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
      const fallbackFile = file instanceof File ? file : new File([file], 'video.mp4', { type: 'video/mp4' });
      return resolve(fallbackFile);
    }

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const sourceUrl = URL.createObjectURL(file);
    video.src = sourceUrl;

    let cleanupDone = false;
    let animFrameId: number | null = null;
    let audioCtx: AudioContext | null = null;
    let mediaRecorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let timeoutId: any = null;

    const cleanup = () => {
      if (cleanupDone) return;
      cleanupDone = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (animFrameId) cancelAnimationFrame(animFrameId);
      try {
        if (stream) {
          stream.getTracks().forEach(t => t.stop());
        }
        if (audioCtx && audioCtx.state !== 'closed') {
          audioCtx.close().catch(() => {});
        }
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch (e) {}
      URL.revokeObjectURL(sourceUrl);
    };

    const failSafe = () => {
      cleanup();
      const fallbackFile = file instanceof File ? file : new File([file], 'video.mp4', { type: 'video/mp4' });
      resolve(fallbackFile);
    };

    video.onerror = () => {
      console.warn('[videoCompression] Video load error, using original file.');
      failSafe();
    };

    video.onloadedmetadata = async () => {
      try {
        const originalWidth = video.videoWidth || 640;
        const originalHeight = video.videoHeight || 480;
        const duration = video.duration || 1;

        // Skip compression if already tiny (< 1.5MB and small resolution)
        if (file.size < 1.5 * 1024 * 1024 && Math.min(originalWidth, originalHeight) <= 480) {
          cleanup();
          const orig = file instanceof File ? file : new File([file], 'video.mp4', { type: file.type || 'video/mp4' });
          return resolve(orig);
        }

        // Calculate 480p dimensions preserving aspect ratio with even dimensions
        let targetWidth: number;
        let targetHeight: number;

        if (originalWidth >= originalHeight) {
          // Landscape
          targetHeight = Math.min(480, originalHeight);
          targetWidth = Math.round((originalWidth * (targetHeight / originalHeight)) / 2) * 2;
        } else {
          // Portrait
          targetWidth = Math.min(480, originalWidth);
          targetHeight = Math.round((originalHeight * (targetWidth / originalWidth)) / 2) * 2;
        }

        // Ensure minimum even dimensions
        targetWidth = Math.max(2, targetWidth);
        targetHeight = Math.max(2, targetHeight);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

        if (!ctx || !canvas.captureStream) {
          return failSafe();
        }

        // 24fps capture stream from canvas
        const canvasStream = canvas.captureStream(24);
        const vTrack = canvasStream.getVideoTracks()[0];
        if (!vTrack) return failSafe();

        stream = new MediaStream([vTrack]);

        // Attempt to capture audio tracks
        try {
          // Check if direct video element captureStream is available for native audio
          const directStream = (video as any).captureStream ? (video as any).captureStream() : null;
          const directAudio = directStream?.getAudioTracks()?.[0];
          if (directAudio) {
            stream.addTrack(directAudio);
          } else {
            const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioCtxClass) {
              audioCtx = new AudioCtxClass();
              video.muted = false;
              video.volume = 1;
              const source = audioCtx.createMediaElementSource(video);
              const dest = audioCtx.createMediaStreamDestination();
              source.connect(dest);
              const aTrack = dest.stream.getAudioTracks()[0];
              if (aTrack) stream.addTrack(aTrack);
            }
          }
        } catch (audioErr) {
          console.warn('[videoCompression] Audio extraction warning, encoding video track only:', audioErr);
          video.muted = true;
        }

        const mimeType = getSupportedVideoMimeType();
        const options: MediaRecorderOptions = {
          videoBitsPerSecond: 750_000, // 750 kbps delivers crisp 480p with tiny file size
          ...(mimeType ? { mimeType } : {})
        };

        try {
          mediaRecorder = new MediaRecorder(stream, options);
        } catch (mrErr) {
          mediaRecorder = new MediaRecorder(stream);
        }

        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          const finalType = mediaRecorder?.mimeType || mimeType || 'video/mp4';
          const ext = finalType.includes('webm') ? 'webm' : 'mp4';
          const compressedBlob = new Blob(chunks, { type: finalType });
          cleanup();

          if (compressedBlob.size > 0) {
            const resultFile = new File([compressedBlob], `video_480p.${ext}`, { type: finalType });
            resolve(resultFile);
          } else {
            failSafe();
          }
        };

        // Keep normal 1.0x playback rate so video decodes without dropped frames and audio remains synchronized
        video.playbackRate = 1.0;

        // Dynamic timeout allowing full duration to complete without arbitrary 45s cutoff
        const maxTimeMs = Math.max(duration * 1200 + 10000, 15000);
        timeoutId = setTimeout(() => {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            try {
              mediaRecorder.stop();
            } catch (e) {
              failSafe();
            }
          } else {
            failSafe();
          }
        }, maxTimeMs);

        mediaRecorder.start(250);

        const renderFrame = () => {
          if (video.paused || video.ended || cleanupDone) return;
          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          if (onProgress && duration > 0) {
            const pct = Math.min(Math.round((video.currentTime / duration) * 100), 99);
            onProgress(pct);
          }
          if ('requestVideoFrameCallback' in video) {
            (video as any).requestVideoFrameCallback(renderFrame);
          } else {
            animFrameId = requestAnimationFrame(renderFrame);
          }
        };

        video.onended = () => {
          if (onProgress) onProgress(100);
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            setTimeout(() => {
              try {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                  mediaRecorder.stop();
                }
              } catch (e) {
                failSafe();
              }
            }, 100);
          }
        };

        try {
          await video.play();
        } catch (playErr) {
          video.muted = true;
          await video.play().catch(failSafe);
        }
        renderFrame();
      } catch (err) {
        console.error('[videoCompression] Compression error:', err);
        failSafe();
      }
    };
  });
}
