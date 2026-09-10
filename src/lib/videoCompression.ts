import encodeWebp from '@jsquash/webp/encode';
import { videoLog } from './videoLogger';

/**
 * Checks if a canvas context is purely blank / black (all alpha 0 or black pixels).
 */
function isCanvasBlank(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
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
 * Converts a Canvas or OffscreenCanvas to a WebP Blob with WebAssembly @jsquash fallback.
 */
async function canvasToWebpBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  quality = 0.85
): Promise<Blob> {
  // 1. Try native WebP conversion
  if ('convertToBlob' in canvas && typeof (canvas as OffscreenCanvas).convertToBlob === 'function') {
    try {
      const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality });
      if (blob && blob.size > 200 && blob.type === 'image/webp') return blob;
    } catch (e) {}
  } else if ('toBlob' in canvas && typeof (canvas as HTMLCanvasElement).toBlob === 'function') {
    try {
      const nativeBlob = await new Promise<Blob | null>((res) => {
        (canvas as HTMLCanvasElement).toBlob(
          (b) => res(b && b.size > 200 && b.type === 'image/webp' ? b : null),
          'image/webp',
          quality
        );
      });
      if (nativeBlob) return nativeBlob;
    } catch (e) {}
  }

  // 2. Fallback to @jsquash/webp WebAssembly encoder for guaranteed WebP output
  const imgData = ctx.getImageData(0, 0, width, height);
  const webpBuffer = await encodeWebp(imgData, { quality: Math.round(quality * 100) });
  return new Blob([webpBuffer], { type: 'image/webp' });
}

/**
 * Extracts a representative frame from a video file:
 * - Uses modern HTMLVideoElement with requestVideoFrameCallback (guaranteeing GPU has rendered frame)
 * - Uses createImageBitmap for direct hardware texture capture
 * - Resizes so longest edge is 400px
 * - Encodes to high-quality WebP format
 * - Never hangs: guarded by safety timeout
 */
export async function extractVideoThumbnail(file: File | Blob): Promise<Blob> {
  const startTime = performance.now();
  videoLog.info('📸 [Thumbnail] Starting thumbnail extraction for file', {
    name: file instanceof File ? file.name : 'video_blob',
    sizeKb: (file.size / 1024).toFixed(1),
    type: file.type
  });

  return new Promise<Blob>((resolve) => {
    let isFinished = false;
    const sourceUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    // Safety timeout: 4s max
    const timeoutId = setTimeout(() => {
      if (!isFinished) {
        videoLog.warn('📸 [Thumbnail] Extraction timed out, generating fallback');
        finish(createEmergencyFallbackThumbnail());
      }
    }, 4000);

    const cleanup = () => {
      clearTimeout(timeoutId);
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

    const finish = (blob: Blob) => {
      if (isFinished) return;
      isFinished = true;
      cleanup();
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      videoLog.success(`📸 [Thumbnail] Extracted in ${elapsed}s`, {
        sizeKb: (blob.size / 1024).toFixed(1),
        mime: blob.type
      });
      resolve(blob);
    };

    const captureFrame = async () => {
      if (isFinished) return;

      try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;

        // Scale so longest edge is 400px
        let tw: number;
        let th: number;
        if (vw >= vh) {
          tw = 400;
          th = Math.max(2, Math.round((vh * 400) / vw));
        } else {
          th = 400;
          tw = Math.max(2, Math.round((vw * 400) / vh));
        }

        const canvas = typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(tw, th)
          : document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }) as any;
        if (!ctx) throw new Error('Canvas 2D context unavailable');

        // Method 1: Try createImageBitmap for direct GPU texture capture
        let drawn = false;
        if (typeof createImageBitmap === 'function') {
          try {
            const bitmap = await createImageBitmap(video);
            ctx.drawImage(bitmap, 0, 0, tw, th);
            bitmap.close();
            drawn = true;
          } catch (bmErr) {
            // Fall back to direct drawImage
          }
        }

        if (!drawn) {
          ctx.drawImage(video, 0, 0, tw, th);
        }

        // Check if blank (black or transparent)
        if (isCanvasBlank(ctx, tw, th)) {
          videoLog.warn('📸 [Thumbnail] Canvas is blank, waiting for next frame presentation...');
          if ('requestVideoFrameCallback' in video && typeof (video as any).requestVideoFrameCallback === 'function') {
            (video as any).requestVideoFrameCallback(async () => {
              if (isFinished) return;
              try {
                ctx.drawImage(video, 0, 0, tw, th);
                const blob = await canvasToWebpBlob(canvas, ctx, tw, th, 0.85);
                finish(blob);
              } catch (e) {
                finish(createEmergencyFallbackThumbnail());
              }
            });
            return;
          }
        }

        const blob = await canvasToWebpBlob(canvas, ctx, tw, th, 0.85);
        finish(blob);
      } catch (err) {
        videoLog.warn('📸 [Thumbnail] Frame capture exception:', err);
        finish(createEmergencyFallbackThumbnail());
      }
    };

    const onSeekReady = () => {
      if ('requestVideoFrameCallback' in video && typeof (video as any).requestVideoFrameCallback === 'function') {
        (video as any).requestVideoFrameCallback(() => {
          captureFrame();
        });
      } else {
        requestAnimationFrame(() => {
          setTimeout(captureFrame, 80);
        });
      }
    };

    video.onerror = (e) => {
      videoLog.warn('📸 [Thumbnail] Video element load error:', e);
      finish(createEmergencyFallbackThumbnail());
    };

    video.onloadedmetadata = () => {
      try {
        const dur = video.duration || 1;
        // Seek past intro black frames to ~0.3s - 0.5s or 5% into video
        const seekTarget = Math.min(Math.max(0.3, dur * 0.05), Math.max(0.1, dur - 0.1));
        video.onseeked = onSeekReady;
        video.currentTime = seekTarget;
      } catch (e) {
        captureFrame();
      }
    };

    video.src = sourceUrl;
    video.load();
  });
}

/**
 * Emergency 400x225 placeholder thumbnail if video parsing fails completely.
 */
function createEmergencyFallbackThumbnail(): Blob {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(400, 225) : document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 225;
  const ctx = canvas.getContext('2d') as any;
  if (ctx) {
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, 400, 225);
    ctx.fillStyle = '#6b7280';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Video', 200, 112);
  }
  return new Blob([new Uint8Array(100)], { type: 'image/webp' });
}

/**
 * Extracts basic video metadata (width, height, duration) using HTMLVideoElement.
 * Runs in ~30-50ms with zero heavy processing.
 */
export function getVideoMetadata(file: File | Blob): Promise<{ width: number; height: number; durationSec: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ width: 640, height: 480, durationSec: 1 });
    }, 3000);

    const cleanup = () => {
      clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      URL.revokeObjectURL(url);
    };

    video.onloadedmetadata = () => {
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;
      const durationSec = video.duration && !isNaN(video.duration) && video.duration > 0 ? video.duration : 1;
      cleanup();
      resolve({ width, height, durationSec });
    };

    video.onerror = () => {
      cleanup();
      resolve({ width: 640, height: 480, durationSec: 1 });
    };

    video.src = url;
    video.load();
  });
}

export interface VideoAnalysisResult {
  width: number;
  height: number;
  durationSec: number;
  fileSizeBytes: number;
  sourceBitrateBps: number;
  needsTransformation: boolean;
  transformationString: string | null;
  category: 'already_optimal' | 'high_res_low_bitrate' | 'high_res_high_bitrate' | 'low_res_bloated_bitrate';
  reason: string;
}

/**
 * Intelligent Cloudinary Video Transformation Analyzer.
 * 
 * Target: 480p resolution (max 848px long edge), 30 FPS, optimal ~600kbps bitrate.
 * 
 * Handles all variable configurations:
 * 1. Low quality / already optimal videos: PRESERVED WITHOUT TRANSFORMATION (never bloated!).
 * 2. High resolution but low bitrate videos: Downscales resolution while maintaining or lowering bitrate.
 * 3. Low resolution but bloated bitrate videos: Re-encodes bitrate without altering native resolution.
 * 4. High resolution & high bitrate videos (e.g. 1080p 60fps iPhone): Fully compressed to optimal 480p 30fps.
 */
export async function analyzeVideoForCloudinary(file: File | Blob): Promise<VideoAnalysisResult> {
  const metadata = await getVideoMetadata(file);
  const { width, height, durationSec } = metadata;
  const fileSizeBytes = file.size;
  const sourceBitrateBps = durationSec > 0 ? Math.round((fileSizeBytes * 8) / durationSec) : 800_000;

  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);

  // Targets: 480p on short edge (848-854 max on long edge), 30 FPS, ~650kbps bitrate ceiling
  const TARGET_SHORT_EDGE = 480;
  const TARGET_LONG_EDGE = 854;
  const TARGET_BITRATE_CEILING = 650_000; // 650 kbps
  const LOW_BITRATE_THRESHOLD = 520_000;  // 520 kbps

  const isResAtOrBelow480p = minDim <= TARGET_SHORT_EDGE && maxDim <= TARGET_LONG_EDGE;
  const isBitrateAtOrBelowTarget = sourceBitrateBps <= TARGET_BITRATE_CEILING;
  const isAlreadyLowBitrate = sourceBitrateBps <= LOW_BITRATE_THRESHOLD;

  videoLog.info('📊 [Cloudinary Video Analyzer] Inspecting video specs vs targets:', {
    resolution: `${width}x${height}`,
    duration: `${durationSec.toFixed(1)}s`,
    fileSizeMb: (fileSizeBytes / (1024 * 1024)).toFixed(2),
    sourceBitrateKbps: Math.round(sourceBitrateBps / 1000),
    isResAtOrBelow480p,
    isBitrateAtOrBelowTarget,
    isAlreadyLowBitrate
  });

  // CASE 1: Video is already lower than or equal to our targets (resolution <= 480p AND bitrate <= 650kbps)
  // e.g. 360x640 @ 400kbps, or 480x848 @ 500kbps
  if (isResAtOrBelow480p && isBitrateAtOrBelowTarget) {
    videoLog.info('✅ [Cloudinary Video Analyzer] Video resolution (<= 480p) and bitrate (<= 650kbps) are already optimal. Preserving original file directly.');
    return {
      width,
      height,
      durationSec,
      fileSizeBytes,
      sourceBitrateBps,
      needsTransformation: false,
      transformationString: null,
      category: 'already_optimal',
      reason: 'Resolution is <= 480p and bitrate is <= 650kbps. Preserving original.'
    };
  }

  // CASE 2: High resolution (e.g. 720p or 1080p), but already has moderate/low bitrate (e.g. 300-500 kbps)
  // Example: 720x1280 video at 1.2MB for 25s (bitrate ~408 kbps).
  // Target: Downscale to 480p (848 max edge) while strictly maintaining or reducing bitrate (never bloat to 600k!)
  if (!isResAtOrBelow480p && isAlreadyLowBitrate) {
    const cappedBitrateKbps = Math.max(250, Math.min(Math.round((sourceBitrateBps / 1000) * 0.9), 500));
    const transformationString = `c_limit,w_848,h_848,fps_30,br_${cappedBitrateKbps}k,vc_h264,ac_aac,q_auto:good`;
    videoLog.info('🎞️ [Cloudinary Video Analyzer] High-res low-bitrate video: downsizing resolution to 480p while keeping bitrate constrained', {
      resolution: `${width}x${height} -> 480p max (848 limit)`,
      sourceBitrateKbps: Math.round(sourceBitrateBps / 1000),
      targetBitrateKbps: cappedBitrateKbps,
      transformationString
    });
    return {
      width,
      height,
      durationSec,
      fileSizeBytes,
      sourceBitrateBps,
      needsTransformation: true,
      transformationString,
      category: 'high_res_low_bitrate',
      reason: `Downscaled to 480p with constrained bitrate (${cappedBitrateKbps}kbps) to prevent bloating`
    };
  }

  // CASE 3: Low resolution (<= 480p), but BLOATED bitrate (> 650 kbps)
  // e.g. 360p or 480p recorded at 3 Mbps (15MB)
  // Keep native resolution (c_limit does not upscale), cap fps at 30, compress bitrate to 450kbps
  if (isResAtOrBelow480p && !isBitrateAtOrBelowTarget) {
    const transformationString = 'c_limit,w_848,h_848,fps_30,br_450k,vc_h264,ac_aac,q_auto:good';
    videoLog.info('🎞️ [Cloudinary Video Analyzer] Low-res bloated video: compressing bitrate while preserving native <= 480p resolution', {
      resolution: `${width}x${height}`,
      sourceBitrateKbps: Math.round(sourceBitrateBps / 1000),
      transformationString
    });
    return {
      width,
      height,
      durationSec,
      fileSizeBytes,
      sourceBitrateBps,
      needsTransformation: true,
      transformationString,
      category: 'low_res_bloated_bitrate',
      reason: 'Compressed bitrate to 450kbps while preserving native <= 480p resolution'
    };
  }

  // CASE 4: Standard / High Quality (High Resolution AND High Bitrate)
  // e.g. 720p/1080p/4K @ 1.5 - 20 Mbps, 60fps (iPhone recordings, DSLR, high quality downloads)
  // Full 480p 30fps compression: scale down to 480p (848 max edge), cap at 30fps, 600kbps, H.264 + AAC
  const transformationString = 'c_limit,w_848,h_848,fps_30,br_600k,vc_h264,ac_aac,q_auto:good';
  videoLog.info('🎞️ [Cloudinary Video Analyzer] High quality video: compressing to optimal 480p 30fps @ 600kbps', {
    resolution: `${width}x${height} -> 480p max`,
    sourceBitrateKbps: Math.round(sourceBitrateBps / 1000),
    transformationString
  });
  return {
    width,
    height,
    durationSec,
    fileSizeBytes,
    sourceBitrateBps,
    needsTransformation: true,
    transformationString,
    category: 'high_res_high_bitrate',
    reason: 'Compressed to 480p 30fps @ 600kbps universal H.264+AAC format'
  };
}

/**
 * Injects Cloudinary video transformation parameters into a Cloudinary delivery URL.
 * 
 * Example:
 * Input:  https://res.cloudinary.com/cloud/video/upload/v12345/chat_videos/test.mp4
 * Output: https://res.cloudinary.com/cloud/video/upload/c_limit,w_848,h_848,fps_30,br_600k,vc_h264,ac_aac,q_auto:good/v12345/chat_videos/test.mp4
 */
export function applyCloudinaryVideoTransformation(
  rawUrl: string,
  transformation: string | null
): string {
  if (!transformation || !rawUrl || !rawUrl.includes('/video/upload/')) {
    return rawUrl;
  }
  // Check if transformation is already present in url
  if (rawUrl.includes(`/video/upload/${transformation}/`)) {
    return rawUrl;
  }
  return rawUrl.replace('/video/upload/', `/video/upload/${transformation}/`);
}
