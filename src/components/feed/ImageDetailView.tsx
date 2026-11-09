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

  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const touchStateRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    mode: 'none' | 'vertical' | 'horizontal' | 'pinch';
  }>({
    startX: 0,
    startY: 0,
    startTime: 0,
    mode: 'none'
  });

  // Preload all images
  useEffect(() => {
    images.forEach(src => {
      const img = new Image();
      img.src = src;
    });
  }, [images]);

  // Reset zoom scale and transform on image slide change
  useEffect(() => {
    if (transformRef.current) {
      transformRef.current.resetTransform(0);
    }
    setScale(1);
    setDragY(0);
    setDragX(0);
    setIsDragging(false);
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
      // 2 or more fingers -> pinch to zoom gesture
      touchStateRef.current.mode = 'pinch';
      setDragY(0);
      setDragX(0);
      setIsDragging(false);
      return;
    }

    const touch = e.touches[0];
    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      mode: 'none'
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // While zoomed in or pinching, let TransformWrapper handle 100% of gestures
    if (scale > 1.01 || touchStateRef.current.mode === 'pinch' || e.touches.length > 1) {
      return;
    }

    const touch = e.touches[0];
    const dx = touch.clientX - touchStateRef.current.startX;
    const dy = touch.clientY - touchStateRef.current.startY;

    if (touchStateRef.current.mode === 'none') {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absY > 8 && absY > absX) {
        touchStateRef.current.mode = 'vertical';
        setIsDragging(true);
      } else if (absX > 8 && absX > absY) {
        touchStateRef.current.mode = 'horizontal';
        setIsDragging(true);
      }
    }

    if (touchStateRef.current.mode === 'vertical') {
      setDragY(dy);
    } else if (touchStateRef.current.mode === 'horizontal') {
      // Elastic resistance if at edges
      const isAtLeftEdge = currentIndex === 0 && dx > 0;
      const isAtRightEdge = currentIndex === images.length - 1 && dx < 0;
      const factor = isAtLeftEdge || isAtRightEdge ? 0.25 : 0.8;
      setDragX(dx * factor);
    }
  };

  const handleTouchEnd = () => {
    const elapsed = Date.now() - touchStateRef.current.startTime;

    // Single tap detection to toggle controls visibility (matches chat video viewer)
    if (touchStateRef.current.mode === 'none' && !isDragging && elapsed < 260 && Math.abs(dragY) < 5 && Math.abs(dragX) < 5) {
      setShowControls(prev => !prev);
      touchStateRef.current.mode = 'none';
      return;
    }

    if (touchStateRef.current.mode === 'vertical') {
      const velocityY = Math.abs(dragY) / Math.max(elapsed, 1);
      
      // Dismiss if pulled down/up sufficiently or flicked
      if (Math.abs(dragY) > 90 || (Math.abs(dragY) > 40 && velocityY > 0.45)) {
        onClose();
        return;
      }
      setDragY(0);
    } else if (touchStateRef.current.mode === 'horizontal') {
      const velocityX = Math.abs(dragX) / Math.max(elapsed, 1);

      if ((dragX < -50 || (dragX < -25 && velocityX > 0.35)) && currentIndex < images.length - 1) {
        next();
      } else if ((dragX > 50 || (dragX > 25 && velocityX > 0.35)) && currentIndex > 0) {
        prev();
      }
      setDragX(0);
    }

    touchStateRef.current.mode = 'none';
    setIsDragging(false);
  };

  const handleScreenClick = (e: React.MouseEvent) => {
    if (Math.abs(dragY) > 5 || Math.abs(dragX) > 5) return;
    setShowControls(prev => !prev);
  };

  const backdropOpacity = Math.max(0.35, 1 - Math.abs(dragY) / 450);

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? '100%' : '-100%',
      opacity: 0,
      scale: 0.95
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
      scale: 1,
      transition: {
        x: { type: "spring", stiffness: 400, damping: 40, mass: 1 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.3 }
      }
    },
    exit: (dir: number) => ({
      zIndex: 0,
      x: dir < 0 ? '100%' : '-100%',
      opacity: 0,
      scale: 0.95,
      transition: {
        x: { type: "spring", stiffness: 400, damping: 40, mass: 1 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.3 }
      }
    })
  };

  return createPortal(
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        backgroundColor: `rgba(0, 0, 0, ${0.95 * backdropOpacity})`
      }}
      className="fixed inset-0 z-[500] backdrop-blur-3xl flex flex-col items-center justify-center p-0 select-none overflow-hidden touch-none"
      onClick={handleScreenClick}
    >
      {/* Top action bar with fade controls matching FullscreenVideoPlayer */}
      <div 
        className="absolute top-0 right-0 z-[600] p-6 pt-safe pointer-events-none transition-opacity duration-300"
        style={{ opacity: showControls ? 1 : 0 }}
      >
        <button 
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white active:scale-90 transition-all backdrop-blur-md border border-white/10 shadow-2xl pointer-events-auto"
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
              doubleClick={{
                disabled: false,
                mode: "toggle",
                step: 2.5,
                animationTime: 220,
              }}
              pinch={{
                disabled: false,
                step: 5,
              }}
              panning={{
                disabled: scale <= 1.01,
                velocityDisabled: false,
                limitToBounds: true,
              }}
              alignmentAnimation={{
                animationTime: 200,
              }}
              velocityAnimation={{
                sensitivityTouch: 1,
                animationTime: 220,
              }}
              onTransformed={(ref) => setScale(ref.state.scale)}
            >
              <TransformComponent 
                wrapperStyle={{ width: "100%", height: "100%" }} 
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
