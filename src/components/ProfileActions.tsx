import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, MoreHorizontal, UserMinus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Profile } from '@/src/types';

interface ProfileActionsProps {
  profile: Profile;
  currentUserId: string;
  connectionStatus: string | null;
  connectionId: string | null;
  handleRequestConnection: () => void;
  handleAcceptConnection: (id: string) => void;
  handleRemoveConnection: (id: string | null, connectionProfileId?: string) => void;
}

const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';

const ProfileActions: React.FC<ProfileActionsProps> = ({
  profile,
  currentUserId,
  connectionStatus,
  connectionId,
  handleRequestConnection,
  handleAcceptConnection,
  handleRemoveConnection,
}) => {
  const [showConnectedMenu, setShowConnectedMenu] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowConnectedMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex space-x-3 mb-8 w-full max-w-xs relative">
      <AnimatePresence>
        {showDisconnectConfirm && createPortal(
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
            onClick={() => setShowDisconnectConfirm(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs bg-[#1A1A1A] border border-white/10 rounded-[28px] overflow-hidden shadow-2xl p-8 text-center"
            >
              <h3 className="text-white text-base font-bold mb-8 tracking-tight">Are you sure you want to remove this user from connections?</h3>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDisconnectConfirm(false)}
                  className="flex-1 bg-white/5 text-white/70 font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all hover:bg-white/10 text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    handleRemoveConnection(connectionId || null);
                    setShowDisconnectConfirm(false);
                  }}
                  className="flex-1 bg-red-500 text-white font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all hover:brightness-110 text-sm shadow-[0_4px_12px_rgba(239,68,68,0.25)]"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </motion.div>,
          document.body
        )}
      </AnimatePresence>

      {connectionStatus === 'none' && (
        <button 
          onClick={handleRequestConnection}
          className="flex-1 bg-white text-black font-bold py-2.5 rounded-xl active:scale-95 transition-transform"
        >
          Connect
        </button>
      )}
      {connectionStatus === 'pending_sent' && (
        <button 
          onClick={() => handleRemoveConnection(connectionId || null)}
          className="flex-1 border border-white/20 text-white font-bold py-2.5 rounded-xl active:scale-95 transition-transform"
        >
          Requested
        </button>
      )}
      {connectionStatus === 'pending_received' && (
        <button 
          onClick={() => connectionId && handleAcceptConnection(connectionId)}
          className="flex-1 bg-white text-black font-bold py-2.5 rounded-xl active:scale-95 transition-transform"
        >
          Accept pending
        </button>
      )}
      {connectionStatus === 'accepted' && (
        <div className="flex items-center gap-2 w-full">
          <button 
            onClick={() => window.dispatchEvent(new CustomEvent('openChat', { detail: { profile } }))}
            className="h-11 px-4 bg-white text-black rounded-xl flex items-center justify-center shrink-0 active:scale-95 transition-transform font-bold gap-2 flex-1"
          >
            <MessageCircle size={18} className="fill-current" />
            <span className="text-sm">Message</span>
          </button>
          
          <div className="relative" ref={menuRef}>
            <button 
              onClick={(e) => { e.stopPropagation(); setShowConnectedMenu(!showConnectedMenu); }}
              className="w-11 h-11 bg-white/10 text-white rounded-xl flex items-center justify-center shrink-0 active:scale-95 transition-transform hover:bg-white/20"
            >
              <MoreHorizontal size={20} />
            </button>
            
            <AnimatePresence>
              {showConnectedMenu && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 5 }}
                  className="absolute top-12 right-0 min-w-[200px] bg-[#1c1c1c] rounded-2xl p-2 border border-white/10 shadow-2xl z-20"
                >
                  <button 
                    onClick={() => {
                      setShowConnectedMenu(false);
                      setShowDisconnectConfirm(true);
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 flex items-center text-sm transition-colors text-red-500 font-medium"
                  >
                    <UserMinus size={18} className="mr-3" />
                    Remove connection
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileActions;
