import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { createPortal } from 'react-dom';

interface ProfileImageViewerProps {
  viewingImage: string | null;
  setViewingImage: (v: string | null) => void;
}

export function ProfileImageViewer({ viewingImage, setViewingImage }: ProfileImageViewerProps) {
  return (
    <AnimatePresence>
      {viewingImage && createPortal(
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] bg-black/95 backdrop-blur-md flex items-center justify-center overflow-hidden"
          onClick={() => setViewingImage(null)}
        >
          <button 
            className="absolute top-10 right-6 z-[600] p-3 bg-white/10 rounded-full text-white active:scale-90 transition-all backdrop-blur-md border border-white/10 shadow-2xl"
            onClick={(e) => { e.stopPropagation(); setViewingImage(null); }}
          >
            <X size={24} />
          </button>
          
          <div className="w-full h-full flex items-center justify-center p-4">
            <TransformWrapper
              initialScale={1}
              minScale={1}
              maxScale={4}
              centerOnInit={true}
            >
              <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
                <motion.div
                  drag="y"
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={0.6}
                  onDragEnd={(_, info) => {
                    if (Math.abs(info.offset.y) > 80) setViewingImage(null);
                  }}
                  className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing"
                  onClick={(e) => e.stopPropagation()}
                >
                  <motion.img 
                    layoutId="profile-pfp"
                    src={viewingImage} 
                    alt="Profile" 
                    className="max-w-[95vw] max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/5"
                  />
                </motion.div>
              </TransformComponent>
            </TransformWrapper>
          </div>
        </motion.div>,
        document.body
      )}
    </AnimatePresence>
  );
}
