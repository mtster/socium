import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { getCroppedImg } from '@/src/lib/cropImage';
import imageCompression from 'browser-image-compression';

interface ImageCropperModalProps {
  imageSrc: string;
  onClose: () => void;
  onComplete: (file: File) => void;
}

export default function ImageCropperModal({ imageSrc, onClose, onComplete }: ImageCropperModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    try {
      setIsProcessing(true);
      const croppedFile = await getCroppedImg(imageSrc, croppedAreaPixels);
      if (!croppedFile) throw new Error('Failed to crop');

      // Compress image
      const options = {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 800,
        useWebWorker: true,
        fileType: 'image/jpeg' as const
      };
      
      const compressedFile = await imageCompression(croppedFile, options);
      onComplete(compressedFile);
    } catch (e) {
      console.error(e);
      alert('Error cropping image');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed inset-0 z-[100] bg-black flex flex-col pt-safe pb-safe"
    >
      <div className="flex items-center justify-between px-4 h-16 shrink-0 relative z-10 bg-black/50 backdrop-blur">
        <button onClick={onClose} className="text-white/60 p-2" disabled={isProcessing}>
          <X size={24} />
        </button>
        <span className="text-sm font-bold uppercase tracking-widest text-white/50">Move and Scale</span>
        <button 
          onClick={handleSave} 
          disabled={isProcessing}
          className="text-white font-bold p-2 active:scale-95 transition-transform"
        >
          {isProcessing ? 'Saving...' : 'Done'}
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
    </motion.div>
  );
}
