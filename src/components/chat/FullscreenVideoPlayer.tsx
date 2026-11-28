import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, X, Download } from 'lucide-react';

interface FullscreenVideoPlayerProps {
  src: string;
  onClose: () => void;
  onSave: () => void;
}

// Format duration: e.g. "28s" if under 60s, "1:02" if over a minute
function formatDuration(secs: number): string {
  if (!secs || isNaN(secs) || secs <= 0) return '0s';
  const total = Math.round(secs);
  if (total < 60) {
    return `${total}s`;
  }
  const mins = Math.floor(total / 60);
  const remainingSecs = total % 60;
  return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
}

// Format growing timestamp: e.g. "00:01"
function formatTimestamp(secs: number): string {
  if (!secs || isNaN(secs) || secs < 0) return '00:00';
  const total = Math.floor(secs);
  const mins = Math.floor(total / 60);
  const remainingSecs = total % 60;
  return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
}

export function FullscreenVideoPlayer({ src, onClose, onSave }: FullscreenVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [isSwipingDown, setIsSwipingDown] = useState(false);
  const hideControlsTimerRef = useRef<any>(null);

  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isVerticalSwipeRef = useRef(false);
  const suppressNextClickRef = useRef(false);

  const resetHideTimer = useCallback(() => {
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (isPlaying && !isDragging && !isSwipingDown) {
      hideControlsTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3500);
    }
  }, [isPlaying, isDragging, isSwipingDown]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    };
  }, [resetHideTimer]);

  const togglePlayPause = (e?: React.MouseEvent | React.TouchEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;

    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
      setShowControls(true);
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    } else {
      v.play().catch(console.error);
      setIsPlaying(true);
      // When play is clicked, bottom player disappears and video starts playing
      setShowControls(false);
    }
  };

  // When the screen is clicked, toggle controls visibility while video continues playing
  const handleScreenClick = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setShowControls(prev => {
      const next = !prev;
      if (next) {
        resetHideTimer();
      }
      return next;
    });
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isDragging || e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-video-controls="true"]')) {
      swipeStartRef.current = null;
      return;
    }

    const touch = e.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    isVerticalSwipeRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!swipeStartRef.current || isDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeStartRef.current.x;
    const dy = touch.clientY - swipeStartRef.current.y;

    if (!isVerticalSwipeRef.current) {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absY > 10 && absY > absX * 1.15) {
        isVerticalSwipeRef.current = true;
        suppressNextClickRef.current = true;
        setIsSwipingDown(true);
        if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
      }
    }

    if (isVerticalSwipeRef.current) {
      const trackedY = dy >= 0 ? dy : dy * 0.22;
      setDragY(trackedY);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!swipeStartRef.current) return;
    const changedTouch = e.changedTouches[0];
    const dy = changedTouch ? changedTouch.clientY - swipeStartRef.current.y : 0;
    const elapsed = Math.max(Date.now() - swipeStartRef.current.time, 1);
    swipeStartRef.current = null;

    if (isVerticalSwipeRef.current) {
      const effectiveDrag = dy >= 0 ? dy : 0;
      const velocityY = effectiveDrag / elapsed;

      if (effectiveDrag > 95 || (effectiveDrag > 36 && velocityY > 0.42)) {
        isVerticalSwipeRef.current = false;
        setIsSwipingDown(false);
        onClose();
        return;
      }

      isVerticalSwipeRef.current = false;
      setIsSwipingDown(false);
      setDragY(0);
      resetHideTimer();
    }
  };

  const handleTimeUpdate = () => {
    if (!isDragging && videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setShowControls(true);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
    setCurrentTime(0);
  };

  const seekFromClientX = (clientX: number) => {
    if (!progressBarRef.current || !duration) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = clickX / rect.width;
    const newTime = ratio * duration;
    setCurrentTime(newTime);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsDragging(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    seekFromClientX(e.clientX);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.stopPropagation();
    seekFromClientX(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.stopPropagation();
    setIsDragging(false);
    seekFromClientX(e.clientX);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {}
    resetHideTimer();
  };

  const progressPercent = duration > 0 ? Math.min(Math.max((currentTime / duration) * 100, 0), 100) : 0;
  const positiveDrag = Math.max(0, dragY);
  const backdropAlpha = Math.max(0.15, 1 - positiveDrag / 400);
  const dragScale = 1 - Math.min(0.16, positiveDrag / 1400);
  const controlsVisible = showControls && !isSwipingDown;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{ backgroundColor: `rgba(0, 0, 0, ${backdropAlpha})` }}
      className="fixed inset-0 z-[700] flex flex-col justify-between select-none overflow-hidden touch-none"
      onClick={handleScreenClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Top Action Buttons */}
      <div 
        className="absolute top-0 left-0 right-0 z-[710] p-4 pt-safe flex items-center justify-between pointer-events-none transition-opacity duration-300"
        style={{ opacity: controlsVisible ? 1 : 0 }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSave();
          }}
          className="p-3 bg-white/10 hover:bg-white/20 active:scale-90 transition-all text-white rounded-full backdrop-blur-md pointer-events-auto"
          title="Save or Share"
        >
          <Download size={22} />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="p-3 bg-white/10 hover:bg-white/20 active:scale-90 transition-all text-white rounded-full backdrop-blur-md pointer-events-auto"
          title="Close"
        >
          <X size={22} />
        </button>
      </div>

      {/* Main Video Area */}
      <div
        className="flex-1 w-full h-full flex items-center justify-center relative min-h-0"
        style={{
          transform: `translate3d(0, ${dragY}px, 0) scale(${dragScale})`,
          transition: isSwipingDown ? 'none' : 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <video
          ref={videoRef}
          src={src}
          playsInline
          className="max-w-full max-h-full object-contain pointer-events-none"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
        />

        {/* Big Center Play Button Overlay when paused and controls visible */}
        <AnimatePresence>
          {!isPlaying && controlsVisible && (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={togglePlayPause}
              className="absolute z-[705] w-18 h-18 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white flex items-center justify-center shadow-2xl active:scale-90 hover:scale-105 transition-transform"
            >
              <Play size={32} className="fill-white" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Player Bar */}
      <AnimatePresence>
        {controlsVisible && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            data-video-controls="true"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-6 left-4 right-4 z-[710] pb-safe"
          >
            <div className="bg-black/80 backdrop-blur-xl border border-white/15 rounded-full px-4 py-3 flex items-center gap-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.8)]">
              {/* 1. Play / Pause Button */}
              <button
                onClick={togglePlayPause}
                className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shrink-0 active:scale-90 hover:bg-neutral-200 transition-all shadow-md"
              >
                {isPlaying ? (
                  <Pause size={16} className="fill-black" />
                ) : (
                  <Play size={16} className="fill-black" />
                )}
              </button>

              {/* 2. Growing Timestamp (e.g. 00:01) */}
              <span className="font-mono text-xs font-semibold text-white/90 shrink-0 select-none min-w-[38px] text-center">
                {formatTimestamp(currentTime)}
              </span>

              {/* 3. Responsive Progress Bar */}
              <div
                ref={progressBarRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className="flex-1 h-6 flex items-center cursor-pointer relative py-2 select-none group"
              >
                {/* Track background */}
                <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden relative">
                  {/* Filled Progress */}
                  <div
                    className="h-full bg-white rounded-full transition-[width] duration-75"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Scrubber Knob */}
                <div
                  className="absolute w-3.5 h-3.5 bg-white rounded-full shadow-lg pointer-events-none -translate-x-1/2 transition-transform duration-75 group-hover:scale-125"
                  style={{ left: `${progressPercent}%` }}
                />
              </div>

              {/* 4. Total Duration (e.g. 28s or 1:02) */}
              <span className="font-mono text-xs font-semibold text-white/60 shrink-0 select-none min-w-[34px] text-right">
                {formatDuration(duration)}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
