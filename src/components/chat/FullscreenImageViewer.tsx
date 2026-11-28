import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Download } from 'lucide-react';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';

interface FullscreenImageViewerProps {
  src: string;
  onClose: () => void;
  onSave: () => void;
}

export function FullscreenImageViewer({ src, onClose, onSave }: FullscreenImageViewerProps) {
  const [showControls, setShowControls] = useState(true);
  const [scale, setScale] = useState(1);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);

  const touchStartRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });
  const isMultiTouchRef = useRef(false);
  const isVerticalSwipeRef = useRef(false);
  const wasDraggedRef = useRef(false);
  const lastTouchEndTimeRef = useRef(0);
  const lastTapTimeRef = useRef(0);
  const lastTapPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    if (e.touches.length > 1) {
      isMultiTouchRef.current = true;
      isVerticalSwipeRef.current = false;
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      setDragY(0);
      setIsDragging(false);
      return;
    }

    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
    isVerticalSwipeRef.current = false;
    wasDraggedRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isMultiTouchRef.current || e.touches.length > 1 || scale > 1.02) {
      return;
    }

    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;

    if (!isVerticalSwipeRef.current) {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      // Lock into vertical swipe when downward/vertical motion dominates horizontal jitter
      if (absY > 8 && absY > absX * 1.15) {
        isVerticalSwipeRef.current = true;
        wasDraggedRef.current = true;
        setIsDragging(true);
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
      }
    }

    if (isVerticalSwipeRef.current) {
      // 1:1 silky tracking downward, subtle rubber-band resistance upward
      const trackedY = dy >= 0 ? dy : dy * 0.22;
      setDragY(trackedY);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    lastTouchEndTimeRef.current = Date.now();

    if (isMultiTouchRef.current) {
      if (e.touches.length === 0) {
        isMultiTouchRef.current = false;
      }
      return;
    }

    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    const changedTouch = e.changedTouches[0];
    if (!changedTouch) return;

    const dx = changedTouch.clientX - touchStartRef.current.x;
    const dy = changedTouch.clientY - touchStartRef.current.y;
    const elapsed = Math.max(Date.now() - touchStartRef.current.time, 1);

    if (isVerticalSwipeRef.current) {
      const effectiveDrag = dy >= 0 ? dy : 0;
      const velocityY = effectiveDrag / elapsed; // px/ms

      if (effectiveDrag > 95 || (effectiveDrag > 36 && velocityY > 0.42)) {
        isVerticalSwipeRef.current = false;
        setIsDragging(false);
        onClose();
        return;
      }

      isVerticalSwipeRef.current = false;
      setIsDragging(false);
      setDragY(0);
      return;
    }

    // Tap / Double-tap handling
    const isStationaryTap = Math.hypot(dx, dy) < 10;
    if (isStationaryTap) {
      const now = Date.now();
      const timeSinceLastTap = now - lastTapTimeRef.current;
      const distFromLastTap = Math.hypot(
        changedTouch.clientX - lastTapPosRef.current.x,
        changedTouch.clientY - lastTapPosRef.current.y
      );

      if (timeSinceLastTap < 290 && distFromLastTap < 45) {
        // Double tap -> zoom toggle
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        lastTapTimeRef.current = 0;

        const currentScale = transformRef.current?.instance.transformState.scale || 1;
        if (currentScale > 1.05) {
          transformRef.current?.resetTransform(220, 'easeOut');
          setScale(1);
        } else {
          const rect = containerRef.current?.getBoundingClientRect() || {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight,
          };
          const tapX = changedTouch.clientX - rect.left;
          const tapY = changedTouch.clientY - rect.top;
          const currentX = transformRef.current?.instance.transformState.positionX || 0;
          const currentY = transformRef.current?.instance.transformState.positionY || 0;
          const targetScale = 2.6;
          const targetX = tapX - (targetScale / currentScale) * (tapX - currentX);
          const targetY = tapY - (targetScale / currentScale) * (tapY - currentY);
          transformRef.current?.setTransform(targetX, targetY, targetScale, 240, 'easeOut');
          setScale(targetScale);
        }
        return;
      }

      lastTapTimeRef.current = now;
      lastTapPosRef.current = { x: changedTouch.clientX, y: changedTouch.clientY };

      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = setTimeout(() => {
        setShowControls(prev => !prev);
        singleTapTimerRef.current = null;
      }, 240);
    }
  };

  // Desktop mouse click handler (ignored right after touch events so it never double-toggles)
  const handleDesktopClick = (e: React.MouseEvent) => {
    if (Date.now() - lastTouchEndTimeRef.current < 550) return;
    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    setShowControls(prev => !prev);
  };

  const positiveDrag = Math.max(0, dragY);
  const backdropAlpha = Math.max(0.15, 1 - positiveDrag / 400);
  const dragScale = 1 - Math.min(0.16, positiveDrag / 1400);
  const controlsOpacity = showControls && !isDragging ? 1 : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{ backgroundColor: `rgba(0, 0, 0, ${backdropAlpha})` }}
      className="fixed inset-0 z-[600] select-none overflow-hidden touch-none"
      onClick={handleDesktopClick}
    >
      {/* Top Action Buttons matching FullscreenVideoPlayer */}
      <div
        className="absolute top-0 left-0 right-0 z-[610] p-4 pt-safe flex items-center justify-between pointer-events-none transition-opacity duration-300"
        style={{ opacity: controlsOpacity }}
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

      {/* Swipe-Down + Pinch-Zoom Media Container */}
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            transform: `translate3d(0, ${dragY}px, 0) scale(${dragScale})`,
            transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <TransformWrapper
            ref={transformRef}
            initialScale={1}
            minScale={1}
            maxScale={5}
            centerOnInit
            doubleClick={{ disabled: true }}
            pinch={{ disabled: false, step: 5 }}
            panning={{
              disabled: scale <= 1.02,
              velocityDisabled: false,
            }}
            wheel={{ disabled: false, step: 0.15 }}
            onTransformed={(ref) => {
              setScale(ref.state.scale);
            }}
            onZoomStop={(ref) => {
              setScale(ref.state.scale);
              if (ref.state.scale < 1.05) {
                ref.resetTransform(180, 'easeOut');
                setScale(1);
              }
            }}
          >
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%', overflow: 'hidden' }}
              contentStyle={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={src}
                alt=""
                draggable={false}
                className="max-w-full max-h-screen object-contain pointer-events-none select-none"
              />
            </TransformComponent>
          </TransformWrapper>
        </div>
      </div>
    </motion.div>
  );
}
