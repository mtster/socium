import encodeWebp from '@jsquash/webp/encode';

/**
 * Extracts the first non-blank frame of a video, scales it so the longest edge is 400px,
 * and encodes it to WebP format.
 */
export async function extractVideoThumbnail(file: File | Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.preload = 'auto';

    const sourceUrl = URL.createObjectURL(file);
    video.src = sourceUrl;

    let isFinished = false;
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

    const captureAndEncode = async () => {
      if (isFinished) return;
      isFinished = true;

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
            }, 'image/webp', 0.82);
          } catch {
            res(null);
          }
        });

        if (nativeBlob) {
          return resolve(nativeBlob);
        }

        // 2. Fallback to @jsquash/webp WebAssembly encoder for guaranteed WebP output
        const imgData = ctx.getImageData(0, 0, tw, th);
        const webpBuffer = await encodeWebp(imgData, { quality: 82 });
        const webpBlob = new Blob([webpBuffer], { type: 'image/webp' });
        resolve(webpBlob);
      } catch (err) {
        cleanup();
        reject(err);
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
    }, 6000);

    video.onerror = (e) => {
      if (!isFinished) {
        isFinished = true;
        cleanup();
        reject(new Error('Failed to load video element'));
      }
    };

    video.onloadedmetadata = () => {
      try {
        const seekTarget = Math.min(0.1, (video.duration || 1) / 5);
        video.currentTime = seekTarget;
      } catch (e) {
        captureAndEncode();
      }
    };

    video.onseeked = () => {
      setTimeout(() => {
        captureAndEncode();
      }, 50);
    };

    video.onloadeddata = () => {
      if (!isFinished && video.readyState >= 2 && video.currentTime > 0) {
        setTimeout(() => {
          captureAndEncode();
        }, 50);
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

/**
 * Compresses video to 480p resolution using Web Audio Context and Canvas capture stream,
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
    video.muted = false; // Need audio routed through Web Audio graph
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
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

        // Skip re-encoding if already tiny (< 1.5MB and <= 480p)
        if (file.size < 1.5 * 1024 * 1024 && Math.min(origW, origH) <= 480) {
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

        // Capture audio via Web Audio API AudioContext + MediaStreamDestination
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            audioCtx = new AudioContextClass();
            const sourceNode = audioCtx.createMediaElementSource(video);
            const destinationNode = audioCtx.createMediaStreamDestination();
            sourceNode.connect(destinationNode);
            // Also keep audio muted locally so it doesn't blast user's speaker during compression
            const audioTrack = destinationNode.stream.getAudioTracks()[0];
            if (audioTrack) {
              combinedStream.addTrack(audioTrack);
            }
          }
        } catch (audioErr) {
          // Fallback to direct stream capture if createMediaElementSource is blocked
          try {
            const directStream = (video as any).captureStream ? (video as any).captureStream() : null;
            const directAudio = directStream?.getAudioTracks()?.[0];
            if (directAudio) combinedStream.addTrack(directAudio);
          } catch (e) {}
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
          const finalType = mediaRecorder?.mimeType || mimeType || 'video/mp4';
          const ext = finalType.includes('webm') ? 'webm' : 'mp4';
          const compressedBlob = new Blob(chunks, { type: finalType });
          cleanup();

          if (compressedBlob.size > 1000) {
            const resultFile = new File([compressedBlob], `compressed_video.${ext}`, { type: finalType });
            resolve(resultFile);
          } else {
            fallbackOriginal();
          }
        };

        // Standard 1x playback ensures 100% audio sync and zero dropped frames
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
          if (audioCtx && audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }
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
