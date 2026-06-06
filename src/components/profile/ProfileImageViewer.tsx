import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Download } from 'lucide-react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

interface ProfileImageViewerProps {
  viewingImage: string | null;
  setViewingImage: (v: string | null) => void;
}

export function ProfileImageViewer({ viewingImage, setViewingImage }: ProfileImageViewerProps) {
  const [isZoomed, setIsZoomed] = useState(false);

  const saveToDevice = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], `${filename}.jpg`, { type: blob.type });
      
      const blobUrl = window.URL.createObjectURL(blob);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
        } catch (shareErr: any) {
          if (shareErr.name === 'AbortError' || shareErr.message?.toLowerCase().includes('cancel')) {
            window.URL.revokeObjectURL(blobUrl);
            return;
          }
          // Same-origin fallback download
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = `${filename}.jpg`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } else {
        // Same-origin fallback download
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${filename}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error("Profile picture download error:", e);
    }
  };

  return (
    <AnimatePresence>
      {viewingImage && (
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }} 
          className="fixed inset-0 z-[10000] bg-black touch-none cursor-grab active:cursor-grabbing"
          drag={isZoomed ? false : "y"}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.25}
          onDragEnd={(event, info) => {
            if (isZoomed) return;
            const threshold = 100;
            const velocityThreshold = 400;
            if (
              Math.abs(info.offset.y) > threshold ||
              Math.abs(info.velocity.y) > velocityThreshold
            ) {
              setViewingImage(null);
            }
          }}
        >
          <button 
            onClick={() => setViewingImage(null)} 
            className="absolute z-[10100] top-safe right-4 mt-4 p-3 bg-white/10 text-white rounded-full active:scale-90 transition-transform"
          >
            <X size={24} />
          </button>
          
          <div className="w-full h-full">
            <TransformWrapper 
              centerOnInit
              initialScale={1}
              minScale={1}
              maxScale={4}
              wheel={{ disabled: false, step: 0.05 }}
              pinch={{ step: 1.5 }}
              doubleTap={{ disabled: false, step: 0.3 }}
              onTransformed={(ref) => {
                setIsZoomed(ref.state.scale > 1.01);
              }}
            >
              <TransformComponent 
                wrapperStyle={{ width: "100%", height: "100%" }} 
                contentStyle={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <img src={viewingImage} className="max-w-full max-h-screen object-contain pointer-events-none" alt="Profile" />
              </TransformComponent>
            </TransformWrapper>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
