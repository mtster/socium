import encodeWebp from '@jsquash/webp/encode';

/**
 * Checks if a canvas context is purely blank / black (all alpha 0 or black pixels).
 */
function isCanvasBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const imgData = ctx.getImageData(0, 0, width, height).data;
    let nonBlackCount = 0;
    // Step through sampled pixels
    for (let i = 0; i < imgData.length; i += 16) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      const a = imgData[i + 3];
      if (a > 10 && (r > 15 || g > 15 || b > 15)) {
        nonBlackCount++;
        if (nonBlackCount > 8) return false;
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Extracts a representative frame (seeking past the initial blank frames to ~0.5s-1.0s or 3rd frame),
 * scales it so the longest edge is 400px, and encodes it to WebP format.
 */
export async function extractVideoThumbnail(file: File | Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.preload = 'auto';

    const sourceUrl = URL.createObjectURL(file);
    video.src = sourceUrl;

    let isFinished = false;
    let timeoutId: any = null;
    let retryAttempt = 0;

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

    const captureAndEncode = async () => {
      if (isFinished) return;

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
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas 2D context unavailable');

        ctx.drawImage(video, 0, 0, tw, th);

        // Check if the frame captured is black/blank. If so and retryAttempt < 2, seek forward and retry
        if (isCanvasBlank(ctx, tw, th) && retryAttempt < 2) {
          retryAttempt++;
          const duration = video.duration || 1;
          const nextSeek = Math.min(duration * 0.25 + retryAttempt * 0.8, Math.max(0.2, duration - 0.2));
          video.currentTime = nextSeek;
          return;
        }

        isFinished = true;
        cleanup();

        // 1. Try native WebP blob export
        const nativeBlob = await new Promise<Blob | null>((res) => {
          try {
            canvas.toBlob((b) => {
              if (b && b.size > 200 && b.type === 'image/webp') {
                res(b);
              } else {
                res(null);
              }
            }, 'image/webp', 0.85);
          } catch {
            res(null);
          }
        });

        if (nativeBlob) {
          return resolve(nativeBlob);
        }

        // 2. Fallback to @jsquash/webp WebAssembly encoder for guaranteed WebP output
        const imgData = ctx.getImageData(0, 0, tw, th);
        const webpBuffer = await encodeWebp(imgData, { quality: 85 });
        const webpBlob = new Blob([webpBuffer], { type: 'image/webp' });
        resolve(webpBlob);
      } catch (err) {
        if (!isFinished) {
          isFinished = true;
          cleanup();
          reject(err);
        }
      }
    };

    timeoutId = setTimeout(() => {
      if (!isFinished) {
        if (video.videoWidth > 0) {
          captureAndEncode();
        } else {
          isFinished = true;
          cleanup();
          reject(new Error('Video thumbnail extraction timed out'));
        }
      }
    }, 7000);

    video.onerror = () => {
      if (!isFinished) {
        isFinished = true;
        cleanup();
        reject(new Error('Failed to load video element'));
      }
    };

    video.onloadedmetadata = () => {
      try {
        const dur = video.duration || 1;
        // Seek past intro black frames to ~0.5s - 1.0s or the 3rd frame
        const seekTarget = Math.min(Math.max(0.5, dur * 0.08), Math.max(0.1, dur - 0.1));
        video.currentTime = seekTarget;
      } catch (e) {
        captureAndEncode();
      }
    };

    video.onseeked = () => {
      // Delay slightly to let the browser video pipeline finish hardware decode on the frame
      setTimeout(() => {
        captureAndEncode();
      }, 100);
    };
  });
}

export function getSupportedVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm'
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * Compresses video to 480p resolution using Web Audio / MediaStream and Canvas capture stream,
 * maintaining full duration and preserving audio tracks cleanly.
 */
export async function compressVideoTo480p(
  file: File | Blob,
  onProgress?: (percent: number) => void
): Promise<File> {
  return new Promise((resolve) => {
    // If MediaRecorder or Canvas capture stream is unsupported, return fallback
    if (
      typeof window === 'undefined' ||
      typeof MediaRecorder === 'undefined' ||
      typeof HTMLCanvasElement.prototype.captureStream === 'undefined'
    ) {
      const fallback = file instanceof File ? file : new File([file], 'video.mp4', { type: file.type || 'video/mp4' });
      return resolve(fallback);
    }

    const video = document.createElement('video');
    // Keeping muted = true prevents browser autoplay NotAllowedError
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.preload = 'auto';

    const sourceUrl = URL.createObjectURL(file);
    video.src = sourceUrl;

    let isDone = false;
    let animFrameId: number | null = null;
    let intervalId: any = null;
    let mediaRecorder: MediaRecorder | null = null;
    let combinedStream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let timeoutId: any = null;

    const cleanup = () => {
      if (isDone) return;
      isDone = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      if (animFrameId) cancelAnimationFrame(animFrameId);
      try {
        if (combinedStream) {
          combinedStream.getTracks().forEach((t) => t.stop());
        }
        if (audioCtx && audioCtx.state !== 'closed') {
          audioCtx.close();
        }
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch (e) {}
      URL.revokeObjectURL(sourceUrl);
    };

    const fallbackOriginal = () => {
      cleanup();
      const fallback = file instanceof File ? file : new File([file], 'video.mp4', { type: file.type || 'video/mp4' });
      resolve(fallback);
    };

    video.onerror = () => {
      console.warn('[videoCompression] Video load error, falling back to original');
      fallbackOriginal();
    };

    video.onloadedmetadata = async () => {
      try {
        const origW = video.videoWidth || 640;
        const origH = video.videoHeight || 480;
        const duration = video.duration || 1;

        // Skip re-encoding if already tiny (< 1.2MB and <= 480p)
        if (file.size < 1.2 * 1024 * 1024 && Math.min(origW, origH) <= 480) {
          cleanup();
          const orig = file instanceof File ? file : new File([file], 'video.mp4', { type: file.type || 'video/mp4' });
          return resolve(orig);
        }

        // Calculate 480p dimensions preserving aspect ratio (must be even integers)
        let targetW: number;
        let targetH: number;
        if (origW >= origH) {
          targetH = Math.min(480, origH);
          targetW = Math.round((origW * (targetH / origH)) / 2) * 2;
        } else {
          targetW = Math.min(480, origW);
          targetH = Math.round((origH * (targetW / origW)) / 2) * 2;
        }
        targetW = Math.max(2, targetW);
        targetH = Math.max(2, targetH);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return fallbackOriginal();

        const canvasStream = canvas.captureStream(24);
        const videoTrack = canvasStream.getVideoTracks()[0];
        if (!videoTrack) return fallbackOriginal();

        combinedStream = new MediaStream([videoTrack]);

        // Capture audio track natively or via Web Audio API
        try {
          const directStream = (video as any).captureStream ? (video as any).captureStream() : ((video as any).mozCaptureStream ? (video as any).mozCaptureStream() : null);
          const directAudio = directStream?.getAudioTracks()?.[0];
          if (directAudio) {
            combinedStream.addTrack(directAudio);
          } else {
            // Web Audio fallback
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
              audioCtx = new AudioContextClass();
              if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
              }
              const sourceNode = audioCtx.createMediaElementSource(video);
              const destinationNode = audioCtx.createMediaStreamDestination();
              sourceNode.connect(destinationNode);
              const audioTrack = destinationNode.stream.getAudioTracks()[0];
              if (audioTrack) {
                combinedStream.addTrack(audioTrack);
              }
            }
          }
        } catch (audioErr) {
          console.warn('[videoCompression] Audio track capture note:', audioErr);
        }

        const mimeType = getSupportedVideoMimeType();
        // 800 kbps for video + 96 kbps audio gives crisp 480p at ~6MB per minute
        const mrOptions: MediaRecorderOptions = {
          videoBitsPerSecond: 800_000,
          audioBitsPerSecond: 96_000,
          ...(mimeType ? { mimeType } : {})
        };

        try {
          mediaRecorder = new MediaRecorder(combinedStream, mrOptions);
        } catch (e) {
          mediaRecorder = new MediaRecorder(combinedStream);
        }

        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          const finalType = mediaRecorder?.mimeType || mimeType || 'video/webm';
          const ext = finalType.includes('mp4') ? 'mp4' : 'webm';
          const compressedBlob = new Blob(chunks, { type: finalType });
          cleanup();

          if (compressedBlob.size > 1000) {
            const resultFile = new File([compressedBlob], `compressed_video.${ext}`, { type: finalType });
            resolve(resultFile);
          } else {
            fallbackOriginal();
          }
        };

        video.playbackRate = 1.0;

        // Dynamic safety timeout based on video length + 10s buffer
        const safetyTimeoutMs = Math.max(duration * 1000 + 10000, 15000);
        timeoutId = setTimeout(() => {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            try {
              mediaRecorder.stop();
            } catch (e) {
              fallbackOriginal();
            }
          } else {
            fallbackOriginal();
          }
        }, safetyTimeoutMs);

        mediaRecorder.start(250);

        const renderFrame = () => {
          if (isDone) return;
          if (!video.paused && !video.ended) {
            ctx.drawImage(video, 0, 0, targetW, targetH);
            if (onProgress && duration > 0) {
              const pct = Math.min(Math.round((video.currentTime / duration) * 100), 99);
              onProgress(pct);
            }
          }
          if ('requestVideoFrameCallback' in video) {
            (video as any).requestVideoFrameCallback(renderFrame);
          } else {
            animFrameId = requestAnimationFrame(renderFrame);
          }
        };

        intervalId = setInterval(() => {
          if (isDone || video.ended) return;
          if (!video.paused) {
            ctx.drawImage(video, 0, 0, targetW, targetH);
          }
        }, 33);

        video.onended = () => {
          if (onProgress) onProgress(100);
          setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              try {
                mediaRecorder.stop();
              } catch (e) {
                fallbackOriginal();
              }
            }
          }, 200);
        };

        try {
          await video.play();
        } catch (playErr) {
          console.warn('[videoCompression] Playback initiation failed, falling back to original:', playErr);
          fallbackOriginal();
          return;
        }

        renderFrame();
      } catch (err) {
        console.error('[videoCompression] Compression pipeline error:', err);
        fallbackOriginal();
      }
    };
  });
}
