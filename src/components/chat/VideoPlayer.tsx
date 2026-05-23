import React, { useEffect, useRef } from 'react';

interface VideoPlayerProps {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function VideoPlayer({ stream, muted = false, className = "", style }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (stream) {
      if (videoEl.srcObject !== stream) {
        try {
          videoEl.srcObject = stream;
        } catch (e) {
          console.warn("Error assigning stream to video element:", e);
        }
      }
      // Guarantee play execution
      videoEl.play().catch(err => {
        // Safe rejection for browser autoplay permissions
        console.warn("Autoplay was caught/blocked - awaiting user interaction:", err);
      });
    } else {
      videoEl.srcObject = null;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={className}
      style={style}
    />
  );
}
