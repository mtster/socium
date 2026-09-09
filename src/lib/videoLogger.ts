/**
 * Dedicated logger for the video processing and sending pipeline.
 * Formats logs with high visibility in Eruda DevTools and browser console.
 */

const LOG_PREFIX = '[VIDEO PIPELINE 🎬]';

export const videoLog = {
  info: (step: string, details?: any) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    if (details !== undefined) {
      console.log(`%c${LOG_PREFIX} [${timestamp}] ${step}`, 'color: #38bdf8; font-weight: bold;', details);
    } else {
      console.log(`%c${LOG_PREFIX} [${timestamp}] ${step}`, 'color: #38bdf8; font-weight: bold;');
    }
  },

  success: (step: string, details?: any) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    if (details !== undefined) {
      console.log(`%c${LOG_PREFIX} [${timestamp}] ✅ ${step}`, 'color: #4ade80; font-weight: bold;', details);
    } else {
      console.log(`%c${LOG_PREFIX} [${timestamp}] ✅ ${step}`, 'color: #4ade80; font-weight: bold;');
    }
  },

  warn: (step: string, details?: any) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    if (details !== undefined) {
      console.warn(`${LOG_PREFIX} [${timestamp}] ⚠️ ${step}`, details);
    } else {
      console.warn(`${LOG_PREFIX} [${timestamp}] ⚠️ ${step}`);
    }
  },

  error: (step: string, error?: any) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    console.error(`${LOG_PREFIX} [${timestamp}] ❌ ${step}`, error || '');
  },

  progress: (percent: number, currentFrame?: number, totalFrames?: number) => {
    const frameInfo = totalFrames ? ` (Frame ${currentFrame}/${totalFrames})` : '';
    console.log(`%c${LOG_PREFIX} ⏳ Transcoding: ${percent}%${frameInfo}`, 'color: #fbbf24; font-weight: 600;');
  }
};
