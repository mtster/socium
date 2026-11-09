import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { cn } from '@/src/lib/utils';

export function ImageDetailView({ images, initialIndex, onClose }: { images: string[], initialIndex: number, onClose: () => void }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState(0);
  const [scale, setScale] = useState(1);
  const [dragY, setDragY] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);

  // Gesture tracking refs
  const touchStartPosRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });
  const lastTapTimeRef = useRef<number>(0);
  const lastTapPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const singleTapTimerRef = useRef<any>(null);
  const isMultiTouchRef = useRef(false);
  const swipeModeRef = useRef<'none' | 'vertical' | 'horizontal'>('none');

  // Preload all images
  useEffect(() => {
    images.forEach(src => {
      const img = new Image();
      img.src = src;
    });
  }, [images]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    };
  }, []);

  // Reset zoom scale and transform on image slide change
  useEffect(() => {
    if (transformRef.current) {
      transformRef.current.resetTransform(0);
    }
    setScale(1);
    setDragY(0);
    setDragX(0);
    setIsDragging(false);
    swipeModeRef.current = 'none';
  }, [currentIndex]);

  const next = () => {
    if (currentIndex < images.length - 1) {
      setDirection(1);
      setLoading(true);
      setCurrentIndex(prev => prev + 1);
    }
  };

  const prev = () => {
    if (currentIndex > 0) {
      setDirection(-1);
      setLoading(true);
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 1) {
      // 2 or more fingers -> pinch gesture. Cancel swipe and single-tap immediately!
      isMultiTouchRef.current = true;
      swipeModeRef.current = 'none';
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      setDragX(0);
      setDragY(0);
      setIsDragging(false);
      return;
    }

    const touch = e.touches[0];
    touchStartPosRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    };
    swipeModeRef.current = 'none';
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // If multi-touch (pinch) or zoomed in, do NOT intercept swipe transitions
    if (isMultiTouchRef.current || e.touches.length > 1 || scale > 1.05) {
      return;
    }

    const touch = e.touches[0];
    const dx = touch.clientX - touchStartPosRef.current.x;
    const dy = touch.clientY - touchStartPosRef.current.y;

    if (swipeModeRef.current === 'none') {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absY > 10 && absY > absX * 1.15) {
        swipeModeRef.current = 'vertical';
        setIsDragging(true);
      } else if (absX > 10 && absX > absY * 1.15) {
        swipeModeRef.current = 'horizontal';
        setIsDragging(true);
      }
    }

    if (swipeModeRef.current === 'vertical') {
      setDragY(dy);
    } else if (swipeModeRef.current === 'horizontal') {
      // Elastic resistance if at edges
      const isAtLeftEdge = currentIndex === 0 && dx > 0;
      const isAtRightEdge = currentIndex === images.length - 1 && dx < 0;
      const factor = isAtLeftEdge || isAtRightEdge ? 0.25 : 0.85;
      setDragX(dx * factor);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isMultiTouchRef.current) {
      if (e.touches.length === 0) {
        isMultiTouchRef.current = false;
      }
      return;
    }

    const changedTouch = e.changedTouches[0];
    if (!changedTouch) return;

    const dx = changedTouch.clientX - touchStartPosRef.current.x;
    const dy = changedTouch.clientY - touchStartPosRef.current.y;
    const elapsed = Date.now() - touchStartPosRef.current.time;
    const isStationaryTap = Math.hypot(dx, dy) < 10;

    // TAP HANDLING (Single tap toggle controls / Double tap zoom to point)
    if (isStationaryTap && !isDragging) {
      const now = Date.now();
      const timeSinceLastTap = now - lastTapTimeRef.current;
      const distFromLastTap = Math.hypot(
        changedTouch.clientX - lastTapPosRef.current.x,
        changedTouch.clientY - lastTapPosRef.current.y
      );

      if (timeSinceLastTap < 320 && distFromLastTap < 45) {
        // Double tap confirmed! Cancel single tap toggle
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        lastTapTimeRef.current = 0;

        const currentScale = transformRef.current?.instance.transformState.scale || 1;
        if (currentScale > 1.05) {
          // Already zoomed in -> reset smoothly back to 1x
          transformRef.current?.resetTransform(220, "easeOut");
          setScale(1);
        } else {
          // At 1x -> zoom smoothly to 2.8x centered at tapped location
          const rect = containerRef.current?.getBoundingClientRect() || {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight
          };
          const tapX = changedTouch.clientX - rect.left;
          const tapY = changedTouch.clientY - rect.top;
          const currentX = transformRef.current?.instance.transformState.positionX || 0;
          const currentY = transformRef.current?.instance.transformState.positionY || 0;
          const targetScale = 2.8;

          const targetX = tapX - (targetScale / currentScale) * (tapX - currentX);
          const targetY = tapY - (targetScale / currentScale) * (tapY - currentY);

          transformRef.current?.setTransform(targetX, targetY, targetScale, 260, "easeOut");
          setScale(targetScale);
        }
        return;
      } else {
        // First tap: register position and schedule controls toggle
        lastTapTimeRef.current = now;
        lastTapPosRef.current = { x: changedTouch.clientX, y: changedTouch.clientY };

        if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = setTimeout(() => {
          setShowControls(prev => !prev);
          singleTapTimerRef.current = null;
        }, 280);
        return;
      }
    }

    // SWIPE HANDLING (Only when at 1x)
    if (scale <= 1.05) {
      if (swipeModeRef.current === 'vertical') {
        const velocityY = Math.abs(dragY) / Math.max(elapsed, 1);
        if (Math.abs(dragY) > 85 || (Math.abs(dragY) > 40 && velocityY > 0.45)) {
          onClose();
          return;
        }
        setDragY(0);
      } else if (swipeModeRef.current === 'horizontal') {
        const velocityX = Math.abs(dragX) / Math.max(elapsed, 1);
        if ((dragX < -45 || (dragX < -20 && velocityX > 0.35)) && currentIndex < images.length - 1) {
          next();
        } else if ((dragX > 45 || (dragX > 20 && velocityX > 0.35)) && currentIndex > 0) {
          prev();
        }
        setDragX(0);
      }
    }

    swipeModeRef.current = 'none';
    setIsDragging(false);
  };

  const backdropOpacity = Math.max(0.35, 1 - Math.abs(dragY) / 450);

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? '100%' : '-100%',
      opacity: 0,
      scale: 0.96
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
      scale: 1,
      transition: {
        x: { type: "spring", stiffness: 420, damping: 42, mass: 1 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.28 }
      }
    },
    exit: (dir: number) => ({
      zIndex: 0,
      x: dir < 0 ? '100%' : '-100%',
      opacity: 0,
      scale: 0.96,
      transition: {
        x: { type: "spring", stiffness: 420, damping: 42, mass: 1 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.28 }
      }
    })
  };

  return createPortal(
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        backgroundColor: `rgba(0, 0, 0, ${0.96 * backdropOpacity})`
      }}
      className="fixed inset-0 z-[500] backdrop-blur-3xl flex flex-col items-center justify-center p-0 select-none overflow-hidden touch-none"
    >
      {/* Top action bar with fade controls matching FullscreenVideoPlayer */}
      <div 
        className="absolute top-0 right-0 z-[600] p-6 pt-safe pointer-events-none transition-opacity duration-300"
        style={{ opacity: showControls ? 1 : 0 }}
      >
        <button 
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white active:scale-90 transition-all backdrop-blur-md border border-white/10 shadow-2xl pointer-events-auto cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close"
        >
          <X size={24} />
        </button>
      </div>

      <div 
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            style={{
              transform: `translate3d(${dragX}px, ${dragY}px, 0)`,
              transition: isDragging ? 'none' : 'transform 0.28s cubic-bezier(0.2, 0.9, 0.3, 1)'
            }}
            className="w-full h-full flex items-center justify-center relative"
          >
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            )}

            <TransformWrapper
              ref={transformRef}
              initialScale={1}
              minScale={1}
              maxScale={5}
              centerOnInit={true}
              doubleClick={{ disabled: true }}
              pinch={{
                disabled: false,
                step: 5,
              }}
              panning={{
                disabled: scale <= 1.02,
                velocityDisabled: false,
                limitToBounds: false,
              }}
              wheel={{
                disabled: false,
                step: 0.15,
              }}
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
              onPanningStop={(ref) => {
                setScale(ref.state.scale);
              }}
            >
              <TransformComponent 
                wrapperStyle={{ 
                  width: "100%", 
                  height: "100%", 
                  overflow: "hidden" 
                }} 
                contentStyle={{ 
                  width: "100%", 
                  height: "100%", 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center" 
                }}
              >
                <img 
                  src={images[currentIndex]} 
                  alt="" 
                  className="max-w-full max-h-full object-contain pointer-events-none select-none"
                  onLoad={() => setLoading(false)}
                  draggable={false}
                />
              </TransformComponent>
            </TransformWrapper>
          </motion.div>
        </AnimatePresence>

        {/* Bottom indicator with fade controls matching FullscreenVideoPlayer */}
        <div 
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center z-[550] pointer-events-none transition-opacity duration-300"
          style={{ opacity: showControls ? 1 : 0 }}
        >
          <span className="text-white/60 text-[11px] font-black tracking-[0.2em] uppercase mb-4 drop-shadow-md select-none">
            {currentIndex + 1} / {images.length}
          </span>
          <div className="flex space-x-1.5 p-2 bg-white/5 backdrop-blur-xl rounded-full border border-white/10">
            {images.map((_, i) => (
              <div 
                key={i} 
                className={cn(
                  "h-1.5 rounded-full transition-all duration-500", 
                  i === currentIndex ? "w-6 bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" : "w-1.5 bg-white/20"
                )} 
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>,
    document.body
  );
}

