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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
      const file = new File([blob], `${filename}.${ext}`, { type: blob.type || 'image/jpeg' });
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (shareErr: any) {
          if (shareErr.name === 'AbortError' || shareErr.message?.toLowerCase().includes('cancel')) {
            return;
          }
        }
      }

      // Same-origin fallback download
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${filename}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 2000);
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
          dragElastic={0.15}
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
