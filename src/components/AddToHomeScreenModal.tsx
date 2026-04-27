import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Share, PlusSquare, MoreVertical, MonitorSmartphone } from 'lucide-react';
import { useAddToHomeScreen } from '../lib/useAddToHomeScreen';

export default function AddToHomeScreenModal() {
  const { isInstallable, isStandalone, os, promptInstall } = useAddToHomeScreen();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if dismissed previously
    const hasDismissed = localStorage.getItem('socium_a2hs_dismissed');
    
    if (!isStandalone && isInstallable && !hasDismissed) {
      // Show after a small delay to not overwhelm the user immediately
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isInstallable, isStandalone]);

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem('socium_a2hs_dismissed', 'true');
  };

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex flex-col justify-end"
        onClick={handleDismiss}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="bg-[#111] border-t border-white/10 rounded-t-3xl p-6 pb-unsafe relative pb-safe"
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            onClick={handleDismiss}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white/10 rounded-full text-white/60 active:scale-95 transition-transform"
          >
            <X size={16} />
          </button>

          <div className="flex items-center space-x-3 mb-6">
            <div className="w-12 h-12 bg-black rounded-xl border border-white/10 flex items-center justify-center shrink-0">
               <MonitorSmartphone size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Install Socium</h2>
              <p className="text-xs text-white/50 font-medium">Get the native app experience</p>
            </div>
          </div>

          <p className="text-sm text-white/70 leading-relaxed mb-8">
            Add Socium to your home screen to be able to get notifications from your connections and have the best experience we provide. When you add to home screen it will take storage less than a single photo.
          </p>

          <div className="space-y-4 mb-8">
            {os === 'ios' ? (
              <>
                <div className="flex items-center space-x-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                  <p className="text-sm">Tap the <Share size={16} className="inline mx-1 text-blue-500" /> <b>Share</b> button below</p>
                </div>
                <div className="flex items-center space-x-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                  <p className="text-sm">Scroll and tap <PlusSquare size={16} className="inline mx-1" /> <b>Add to Home Screen</b></p>
                </div>
                <div className="flex items-center space-x-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                  <p className="text-sm">Tap <b>Add</b> in the top right corner</p>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center space-x-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                  <p className="text-sm">Tap the <MoreVertical size={16} className="inline mx-1" /> <b>Menu</b> icon</p>
                </div>
                <div className="flex items-center space-x-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                  <p className="text-sm">Tap <b>Add to Home Screen</b> or <b>Install app</b></p>
                </div>
                {os === 'android' && (
                  <button 
                    onClick={promptInstall}
                    className="w-full mt-4 bg-white text-black font-bold py-3 rounded-2xl active:scale-95 transition-transform"
                  >
                    Install Now
                  </button>
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
