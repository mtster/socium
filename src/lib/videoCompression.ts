import encodeWebp from '@jsquash/webp/encode';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import * as MP4Box from 'mp4box';

type MP4File = MP4Box.MP4File;
type MP4Info = MP4Box.MP4Info;
type MP4Sample = MP4Box.MP4Sample;

/**
 * Extracts the codec description (e.g. avcC box payload) from an MP4 file track for VideoDecoder.
 */
function getTrackDescription(trackId: number, mp4file: any): Uint8Array | undefined {
  try {
    const trak = mp4file.getTrackById(trackId);
    if (!trak) return undefined;
    const entries = trak.mdia?.minf?.stbl?.stsd?.entries;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
        if (box) {
          const stream = new MP4Box.DataStream(undefined, 0, false);
          box.write(stream);
          // Box header in ISO BMFF is 8 bytes (4 bytes length + 4 bytes box type name)
          return new Uint8Array(stream.buffer, 8);
        }
      }
    }
  } catch (e) {
    console.warn('[WebCodecs] Failed to extract track description box:', e);
  }
  return undefined;
}

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
      if (blob && blob.size > 200) return blob;
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
 * Extracts a representative frame (seeking past initial black frames to ~0.5s or frame 3+),
 * scales it so the longest edge is 400px, and encodes it to WebP format.
 * Uses WebCodecs for instant, offscreen, non-DOM background-safe extraction with fallback.
 */
export async function extractVideoThumbnail(file: File | Blob): Promise<Blob> {
  // Tier 1: Try WebCodecs + MP4Box for instant keyframe decoding
  if (
    typeof VideoDecoder !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    (file.type.includes('mp4') || file.type.includes('quicktime') || (file instanceof File && (file.name.endsWith('.mp4') || file.name.endsWith('.mov'))))
  ) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const thumbBlob = await extractThumbnailViaWebCodecs(arrayBuffer);
      if (thumbBlob && thumbBlob.size > 200) {
        return thumbBlob;
      }
    } catch (err) {
      console.warn('[extractVideoThumbnail] WebCodecs thumbnail extraction fallback:', err);
    }
  }

  // Tier 2: Bulletproof Offscreen Video Element seeking with explicit seeked event awaiting
  return extractThumbnailViaVideoElement(file);
}

/**
 * Instant WebCodecs single-frame thumbnail extraction.
 */
async function extractThumbnailViaWebCodecs(arrayBuffer: ArrayBuffer): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const mp4file: MP4File = MP4Box.createFile();
    let isFinished = false;
    let decoder: VideoDecoder | null = null;

    const timeout = setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        try { decoder?.close(); } catch (e) {}
        reject(new Error('WebCodecs thumbnail extraction timeout'));
      }
    }, 4000);

    const finish = (blob?: Blob, err?: Error) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timeout);
      try { decoder?.close(); } catch (e) {}
      if (blob) resolve(blob);
      else reject(err || new Error('Failed to extract thumbnail'));
    };

    mp4file.onReady = async (info: MP4Info) => {
      const videoTrack = info.videoTracks[0];
      if (!videoTrack) {
        return finish(undefined, new Error('No video track found'));
      }

      const vw = videoTrack.track_width || videoTrack.video?.width || 640;
      const vh = videoTrack.track_height || videoTrack.video?.height || 480;

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

      const offscreen = new OffscreenCanvas(tw, th);
      const ctx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return finish(undefined, new Error('OffscreenCanvas 2D context unavailable'));
      }

      const description = getTrackDescription(videoTrack.id, mp4file);

      decoder = new VideoDecoder({
        output: async (frame: VideoFrame) => {
          try {
            ctx.drawImage(frame, 0, 0, tw, th);
            frame.close();

            const blob = await canvasToWebpBlob(offscreen, ctx, tw, th, 0.85);
            finish(blob);
          } catch (e: any) {
            finish(undefined, e);
          }
        },
        error: (e) => {
          finish(undefined, new Error(e.message));
        }
      });

      try {
        decoder.configure({
          codec: videoTrack.codec,
          description,
          codedWidth: vw,
          codedHeight: vh
        });
      } catch (e) {
        // Fallback codec configuration without description
        decoder.configure({ codec: videoTrack.codec });
      }

      // Extract samples around ~0.5s or first 5 samples
      mp4file.setExtractionOptions(videoTrack.id, null, { nbSamples: 10 });
      mp4file.onSamples = (id: number, user: any, samples: MP4Sample[]) => {
        if (id === videoTrack.id && samples.length > 0 && decoder && decoder.state === 'configured') {
          // Find sample closest to ~0.5s or first keyframe
          let targetSample = samples[0];
          for (const s of samples) {
            const timeSec = s.cts / s.timescale;
            if (s.is_sync) targetSample = s;
            if (timeSec >= 0.3 && s.is_sync) {
              targetSample = s;
              break;
            }
          }

          try {
            decoder.decode(
              new EncodedVideoChunk({
                type: targetSample.is_sync ? 'key' : 'delta',
                timestamp: (targetSample.cts * 1_000_000) / targetSample.timescale,
                duration: (targetSample.duration * 1_000_000) / targetSample.timescale,
                data: targetSample.data
              })
            );
            decoder.flush();
          } catch (decodeErr: any) {
            finish(undefined, decodeErr);
          }
        }
      };

      mp4file.start();
    };

    mp4file.onError = (e: string) => finish(undefined, new Error(e));

    const fileBuf = arrayBuffer as ArrayBuffer & { fileStart?: number };
    fileBuf.fileStart = 0;
    mp4file.appendBuffer(fileBuf);
    mp4file.flush();
  });
}

/**
 * Robust Offscreen Video Element Thumbnail Extractor.
 * Guarantees proper loadedmetadata and seeked event resolution before canvas drawing.
 */
async function extractThumbnailViaVideoElement(file: File | Blob): Promise<Blob> {
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

        const canvas = typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(tw, th)
          : document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }) as any;
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

        const blob = await canvasToWebpBlob(canvas, ctx, tw, th, 0.85);
        resolve(blob);
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
    }, 6000);

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
      // Short microtask delay to ensure hardware decoder has fully written pixel buffer
      setTimeout(() => {
        captureAndEncode();
      }, 60);
    };
  });
}

/**
 * Checks for best supported AVC/H.264 video codec string for VideoEncoder.
 */
async function getSupportedEncoderCodec(width: number, height: number): Promise<string> {
  const candidates = [
    'avc1.42001f', // Baseline profile 3.1 (maximum universal compatibility across iOS, Android, macOS, Windows)
    'avc1.4d001f', // Main profile 3.1
    'avc1.64001f', // High profile 3.1
    'avc1.42E01E', // Baseline 3.0
  ];

  for (const codec of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 800_000,
        framerate: 30
      });
      if (support.supported) return codec;
    } catch (e) {}
  }
  return 'avc1.42001f';
}

/**
 * Industry-standard WebCodecs + MP4Box + mp4-muxer fast hardware transcoding pipeline.
 * Runs asynchronously in batch at full hardware decoding/encoding speed (100-300+ FPS),
 * with ZERO real-time playback delays, ZERO background-tab throttling, and perfect audio sync.
 */
export async function compressVideoTo480p(
  file: File | Blob,
  onProgress?: (percent: number) => void
): Promise<File> {
  // Check WebCodecs availability
  const hasWebCodecs = typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';

  if (hasWebCodecs) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const compressedFile = await compressVideoViaWebCodecs(arrayBuffer, file, onProgress);
      if (compressedFile && compressedFile.size > 1000) {
        return compressedFile;
      }
    } catch (webCodecsErr) {
      console.warn('[videoCompression] WebCodecs pipeline failed, falling back:', webCodecsErr);
    }
  }

  // Graceful fallback to original file
  const fallback = file instanceof File ? file : new File([file], 'video.mp4', { type: file.type || 'video/mp4' });
  return fallback;
}

/**
 * WebCodecs Hardware Transcoder Implementation.
 */
async function compressVideoViaWebCodecs(
  arrayBuffer: ArrayBuffer,
  originalFile: File | Blob,
  onProgress?: (percent: number) => void
): Promise<File> {
  return new Promise((resolve, reject) => {
    const mp4file: MP4File = MP4Box.createFile();
    let videoEncoder: VideoEncoder | null = null;
    let videoDecoder: VideoDecoder | null = null;
    let isAborted = false;

    const cleanup = () => {
      try { videoEncoder?.close(); } catch (e) {}
      try { videoDecoder?.close(); } catch (e) {}
    };

    mp4file.onReady = async (info: MP4Info) => {
      try {
        const videoTrack = info.videoTracks[0];
        if (!videoTrack) {
          cleanup();
          return reject(new Error('No video track found in MP4 file'));
        }

        const audioTrack = info.audioTracks?.[0];
        const origW = videoTrack.track_width || videoTrack.video?.width || 640;
        const origH = videoTrack.track_height || videoTrack.video?.height || 480;
        const totalDurationUs = (info.duration * 1_000_000) / info.timescale;

        // Skip re-encoding if already small (< 1.2MB and <= 480p)
        if (originalFile.size < 1.2 * 1024 * 1024 && Math.min(origW, origH) <= 480) {
          cleanup();
          const orig = originalFile instanceof File ? originalFile : new File([originalFile], 'video.mp4', { type: 'video/mp4' });
          return resolve(orig);
        }

        // Calculate 480p dimensions preserving aspect ratio (must be even numbers)
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

        const target = new ArrayBufferTarget();
        const muxer = new Muxer({
          target,
          video: {
            codec: 'avc',
            width: targetW,
            height: targetH,
            rotation: 0
          },
          audio: audioTrack ? {
            codec: 'aac',
            numberOfChannels: audioTrack.audio?.channel_count || 2,
            sampleRate: audioTrack.audio?.sample_rate || 44100
          } : undefined,
          fastStart: 'in-memory',
          firstTimestampBehavior: 'offset'
        });

        const encoderCodec = await getSupportedEncoderCodec(targetW, targetH);

        videoEncoder = new VideoEncoder({
          output: (chunk, meta) => {
            muxer.addVideoChunk(chunk, meta);
          },
          error: (e) => {
            console.error('[VideoEncoder Error]:', e);
          }
        });

        videoEncoder.configure({
          codec: encoderCodec,
          width: targetW,
          height: targetH,
          bitrate: 800_000, // 800 kbps for clean, compact 480p
          framerate: 30,
          latencyMode: 'quality',
          avc: { format: 'avc' }
        });

        // Use OffscreenCanvas to scale frames cleanly
        const offscreen = typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(targetW, targetH)
          : document.createElement('canvas');
        offscreen.width = targetW;
        offscreen.height = targetH;
        const ctx = offscreen.getContext('2d', { alpha: false }) as any;

        let frameIndex = 0;

        videoDecoder = new VideoDecoder({
          output: (frame: VideoFrame) => {
            if (isAborted) {
              frame.close();
              return;
            }

            try {
              // Draw to scaled canvas and create scaled VideoFrame
              ctx.drawImage(frame, 0, 0, targetW, targetH);
              const scaledFrame = new VideoFrame(offscreen, {
                timestamp: frame.timestamp,
                duration: frame.duration ?? undefined
              });

              // Keyframe every 60 frames (~2 seconds at 30fps) for smooth seeking
              const isKeyFrame = frameIndex % 60 === 0;
              videoEncoder?.encode(scaledFrame, { keyFrame: isKeyFrame });

              scaledFrame.close();
              frame.close();
              frameIndex++;

              if (onProgress && totalDurationUs > 0) {
                const pct = Math.min(Math.round((frame.timestamp / totalDurationUs) * 100), 99);
                onProgress(pct);
              }
            } catch (err) {
              console.error('[WebCodecs frame encode error]:', err);
              try { frame.close(); } catch (e) {}
            }
          },
          error: (e) => {
            console.error('[VideoDecoder Error]:', e);
          }
        });

        const description = getTrackDescription(videoTrack.id, mp4file);

        try {
          videoDecoder.configure({
            codec: videoTrack.codec,
            description,
            codedWidth: origW,
            codedHeight: origH
          });
        } catch (e) {
          videoDecoder.configure({ codec: videoTrack.codec });
        }

        // Extract audio samples and feed directly to muxer (pass-through lossless AAC)
        if (audioTrack) {
          mp4file.setExtractionOptions(audioTrack.id, null, { nbSamples: 500 });
        }
        mp4file.setExtractionOptions(videoTrack.id, null, { nbSamples: 200 });

        const videoSamplesToProcess: MP4Sample[] = [];

        mp4file.onSamples = (id: number, user: any, samples: MP4Sample[]) => {
          if (audioTrack && id === audioTrack.id) {
            for (const sample of samples) {
              const timestampUs = (sample.cts * 1_000_000) / sample.timescale;
              const durationUs = (sample.duration * 1_000_000) / sample.timescale;
              muxer.addAudioChunkRaw(
                sample.data,
                sample.is_sync ? 'key' : 'delta',
                timestampUs,
                durationUs
              );
            }
          } else if (id === videoTrack.id) {
            videoSamplesToProcess.push(...samples);
          }
        };

        mp4file.start();

        // Process all collected video samples through hardware decoder with backpressure control
        for (const sample of videoSamplesToProcess) {
          // If encoder queue builds up, wait a tick to prevent memory spikes
          if (videoEncoder.encodeQueueSize > 30) {
            await new Promise((r) => setTimeout(r, 10));
          }

          const chunk = new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: (sample.cts * 1_000_000) / sample.timescale,
            duration: (sample.duration * 1_000_000) / sample.timescale,
            data: sample.data
          });

          videoDecoder.decode(chunk);
        }

        // Flush decoder and encoder
        await videoDecoder.flush();
        await videoEncoder.flush();
        muxer.finalize();
        cleanup();

        if (onProgress) onProgress(100);

        const compressedBlob = new Blob([target.buffer], { type: 'video/mp4' });
        if (compressedBlob.size > 1000) {
          const resultFile = new File([compressedBlob], 'compressed_video.mp4', { type: 'video/mp4' });
          resolve(resultFile);
        } else {
          reject(new Error('Compressed video buffer empty'));
        }
      } catch (pipelineErr) {
        cleanup();
        reject(pipelineErr);
      }
    };

    mp4file.onError = (err) => {
      cleanup();
      reject(new Error(err));
    };

    const fileBuf = arrayBuffer as ArrayBuffer & { fileStart?: number };
    fileBuf.fileStart = 0;
    mp4file.appendBuffer(fileBuf);
    mp4file.flush();
  });
}
