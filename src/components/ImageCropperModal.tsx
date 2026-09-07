import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { getCroppedProfileImages } from '@/src/lib/cropImage';
import { createPortal } from 'react-dom';

interface ImageCropperModalProps {
  imageSrc: string;
  onClose: () => void;
  onComplete: (lowResFile: File, highResFile: File) => void;
}

export default function ImageCropperModal({ imageSrc, onClose, onComplete }: ImageCropperModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('set-header-hidden', { detail: true }));
    return () => {
      window.dispatchEvent(new CustomEvent('set-header-hidden', { detail: false }));
    };
  }, []);

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    try {
      setIsProcessing(true);
      const { lowResFile, highResFile } = await getCroppedProfileImages(imageSrc, croppedAreaPixels);
      onComplete(lowResFile, highResFile);
    } catch (e) {
      console.error('Error cropping image:', e);
      alert('Error cropping image. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return createPortal(
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed inset-0 z-[10000] bg-black flex flex-col pt-safe pb-safe"
    >
      <div className="flex items-center justify-between px-4 h-16 shrink-0 relative z-10 bg-black/50 backdrop-blur">
        <button onClick={onClose} className="text-white/60 p-2" disabled={isProcessing}>
          <X size={24} />
        </button>
        <span className="text-sm font-bold uppercase tracking-widest text-white/50">Move and Scale</span>
        <button 
          onClick={handleSave} 
          disabled={isProcessing}
          className="bg-white text-black px-4 py-1.5 rounded-full font-bold text-xs active:scale-95 transition-transform hover:bg-white/90 disabled:opacity-50"
        >
          {isProcessing ? 'Saving...' : 'Submit'}
        </button>
      </div>

      <div className="flex-1 relative">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onCropComplete={onCropComplete}
          onZoomChange={setZoom}
          style={{
             containerStyle: { backgroundColor: 'black' },
             cropAreaStyle: { border: '2px solid rgba(255, 255, 255, 0.5)' }
          }}
        />
      </div>
    </motion.div>,
    document.body
  );
}
