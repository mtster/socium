import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { cn } from '@/src/lib/utils';

export function ImageDetailView({ images, initialIndex, onClose }: { images: string[], initialIndex: number, onClose: () => void }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState(0);
  const [scale, setScale] = useState(1);
  const [isMultiTouch, setIsMultiTouch] = useState(false);

  // Preload all images
  useEffect(() => {
    images.forEach(src => {
      const img = new Image();
      img.src = src.includes('cloudinary') ? src.replace('/upload/', '/upload/q_auto,f_auto/') : src;
    });
  }, [images]);

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

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? '100%' : '-100%',
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
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? '100%' : '-100%',
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
      className="fixed inset-0 z-[500] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center p-0"
    >
      <button 
        className="absolute top-10 right-6 z-[600] p-3 bg-white/10 rounded-full text-white active:scale-90 transition-all backdrop-blur-md border border-white/10 shadow-2xl"
        onClick={onClose}
      >
        <X size={24} />
      </button>

      <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            className="w-full h-full flex items-center justify-center touch-none"
            drag={scale <= 1.01 ? "both" : false}
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            dragElastic={0.15}
            dragDirectionLock
            onTouchStart={(e) => {
              if (e.touches.length > 1) {
                setIsMultiTouch(true);
              }
            }}
            onTouchEnd={(e) => {
              if (e.touches.length === 0) {
                setTimeout(() => setIsMultiTouch(false), 200);
              }
            }}
            onDragEnd={(_, info) => {
              if (scale > 1.01 || isMultiTouch) return;
              const xThreshold = 60;
              const yThreshold = 100;
              
              if (Math.abs(info.offset.y) > yThreshold && Math.abs(info.offset.y) > Math.abs(info.offset.x) * 1.5) {
                  onClose();
              } else if (info.offset.x > xThreshold) {
                  prev();
              } else if (info.offset.x < -xThreshold) {
                  next();
              }
            }}
          >
            <TransformWrapper
              initialScale={1}
              minScale={1}
              maxScale={4}
              centerOnInit={true}
              panning={{ disabled: scale <= 1.01, velocityDisabled: false }}
              onTransformed={(ref) => setScale(ref.state.scale)}
            >
              <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
                <div className="relative w-full h-full flex items-center justify-center">
                   {loading && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                  <img 
                    src={images[currentIndex].includes('cloudinary') ? images[currentIndex].replace('/upload/', '/upload/q_auto,f_auto/') : images[currentIndex]} 
                    alt="" 
                    className="max-w-full max-h-full object-contain pointer-events-auto"
                    onLoad={() => setLoading(false)}
                    draggable={false}
                  />
                </div>
              </TransformComponent>
            </TransformWrapper>
          </motion.div>
        </AnimatePresence>

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center z-[550]">
          <span className="text-white/60 text-[11px] font-black tracking-[0.2em] uppercase mb-4 drop-shadow-md">
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
