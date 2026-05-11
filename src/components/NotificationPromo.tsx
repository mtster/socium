import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface NotificationPromoProps {
  show: boolean;
  onClose: () => void;
}

const NotificationPromo: React.FC<NotificationPromoProps> = ({ show, onClose }) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          className="fixed top-[env(safe-area-inset-top,20px)] right-4 z-[200] w-72 bg-[#1c1c1c] border border-white/20 p-4 rounded-3xl shadow-2xl origin-top-right flex flex-col gap-3 mt-14"
        >
          <div className="absolute -top-2 right-4 w-4 h-4 bg-[#1c1c1c] border-t border-l border-white/20 rotate-45 transform" />
          <div className="relative z-10 flex flex-col gap-2">
            <h3 className="font-bold text-white text-base">Stay in the loop</h3>
            <p className="text-white/60 text-sm leading-tight">Turn on notifications to never miss a message. Tap the bell icon anytime.</p>
            <button 
              onClick={onClose}
              className="mt-2 text-sm font-bold bg-white text-black py-2 rounded-full w-full active:scale-95 transition-transform"
            >
              Got it
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NotificationPromo;
