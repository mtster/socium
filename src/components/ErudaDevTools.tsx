import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Terminal } from 'lucide-react';
// @ts-ignore
import eruda from 'eruda';

export default function ErudaDevTools() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        eruda.init({
          defaults: {
            displaySize: 50,
            theme: 'Dark'
          }
        });
        setIsInitialized(true);
      } catch (err) {
        console.error('Failed to initialize eruda:', err);
      }
    }

    return () => {
      try {
        if (eruda && typeof eruda.destroy === 'function') {
          eruda.destroy();
        }
      } catch (err) {}
    };
  }, []);

  const handleToggle = () => {
    if (!isInitialized) return;
    try {
      // Toggle eruda panel visibility
      if (isOpen) {
        eruda.hide();
        setIsOpen(false);
      } else {
        eruda.show();
        setIsOpen(true);
      }
    } catch (err) {
      console.error('Failed to toggle eruda:', err);
    }
  };

  return (
    <div 
      ref={containerRef} 
      className="fixed inset-0 pointer-events-none z-[999999]"
      id="eruda-drag-container"
    >
      <motion.button
        id="eruda-toggle-btn"
        drag
        dragConstraints={containerRef}
        dragMomentum={false}
        dragElastic={0.08}
        onTap={handleToggle}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="pointer-events-auto fixed bottom-28 right-6 w-12 h-12 rounded-full bg-black/90 border border-white/10 text-white flex items-center justify-center shadow-[0_4px_24px_rgba(0,0,0,0.85)] cursor-pointer backdrop-blur-xl hover:border-white/20 active:border-white/35 select-none transition-colors duration-200"
        style={{ touchAction: 'none' }}
      >
        <Terminal size={18} className="text-white/80" />
      </motion.button>
    </div>
  );
}
