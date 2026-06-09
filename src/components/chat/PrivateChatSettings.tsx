import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ChevronRight, Lock, ShieldCheck } from 'lucide-react';
import { ChatListItemType } from '@/src/types/chat';
import { VaultModal } from './VaultModal';

interface PrivateChatSettingsProps {
  currentUserId: string;
  activeChat: ChatListItemType;
  onClose: () => void;
}

export function PrivateChatSettings({ currentUserId, activeChat, onClose }: PrivateChatSettingsProps) {
  const [showVault, setShowVault] = useState(false);

  return (
    <>
      <motion.div 
         initial={{ x: '100%', opacity: 1 }} 
         animate={{ x: 0, opacity: 1 }} 
         exit={{ x: '100%', opacity: 1 }} 
         transition={{ type: 'tween', duration: 0.35, ease: 'easeOut' }} 
         className="fixed inset-0 z-[70] flex flex-col bg-black w-full border-white/5 overflow-hidden select-none"
      >
        {/* Header */}
        <div className="p-4 pt-safe flex items-center gap-4 border-b border-white/10 bg-black/80 backdrop-blur-xl shrink-0">
           <button onClick={onClose} className="p-2 -ml-2 text-white/80 active:scale-90 transition-transform">
             <ArrowLeft size={24} />
           </button>
           <h1 className="text-[17px] font-bold text-white flex-1">Chat Settings</h1>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-safe">
          <div className="p-8 flex flex-col items-center border-b border-white/5 bg-gradient-to-b from-[#1c1c1c]/50 to-transparent">
            {/* Recipient Profile Picture */}
            <div className="relative mb-6 z-10">
              <div className="w-[120px] h-[120px] rounded-full overflow-hidden bg-white/5 shadow-2xl ring-1 ring-white/10">
                {activeChat.avatar_url ? (
                  <img src={activeChat.avatar_url} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-white/5 flex items-center justify-center font-bold text-3xl text-white/40">
                    {(activeChat.name?.charAt(0) || '?').toUpperCase()}
                  </div>
                )}
              </div>
            </div>
            
            {/* Recipient Name */}
            <h2 className="text-[26px] tracking-tight font-bold text-white max-w-[250px] truncate select-text">
              {activeChat.name || 'Private Chat'}
            </h2>
            
            {/* Safe / Secure Encryption status description */}
            <div className="flex items-center gap-1.5 text-xs text-white/40 mt-3 font-semibold tracking-wider uppercase">
              <Lock size={12} />
              <span>Direct Connection</span>
            </div>
          </div>

          <div className="px-5 py-6 space-y-5">
            {/* Single Vault Feature Link */}
            <div className="bg-[#1c1c1c] rounded-[24px] overflow-hidden border border-white/5 shadow-xl">
               <button 
                 onClick={() => setShowVault(true)} 
                 className="w-full flex items-center justify-between p-5 text-white hover:bg-white/5 transition-colors"
               >
                 <div className="flex flex-col text-left">
                   <span className="text-[17px] font-medium tracking-tight">Vault</span>
                   <span className="text-[11px] text-white/40 mt-1">Shared quotes, files & voices</span>
                 </div>
                 <ChevronRight size={20} className="text-white/20" />
               </button>
            </div>

            {/* Subtle disclaimer in layout to keep visual aesthetics balanced */}
            <div className="flex items-center justify-center p-4">
              <div className="flex items-center gap-2 text-white/20 text-xs">
                <ShieldCheck size={14} />
                <span>Privately synchronized secure vault</span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Vault modal inside the settings screen */}
      <VaultModal 
        isOpen={showVault}
        onClose={() => setShowVault(false)}
        activeChat={activeChat}
        currentUserId={currentUserId}
      />
    </>
  );
}
