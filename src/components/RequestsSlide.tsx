import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Plus } from 'lucide-react';

interface RequestsSlideProps {
  pendingRequests: any[];
  onClose: () => void;
  onUserClick: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string, profileId: string) => void;
  setShowSearchModal: (show: boolean) => void;
}

const RequestsSlide: React.FC<RequestsSlideProps> = ({
  pendingRequests,
  onClose,
  onUserClick,
  onAccept,
  onReject,
  setShowSearchModal
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: '100%' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '100%' }}
      transition={{ type: "tween", ease: [0.25, 1, 0.5, 1], duration: 0.4 }}
      className="fixed inset-0 z-[200] bg-black flex flex-col"
    >
      <div className="flex items-center px-4 h-14 pt-[env(safe-area-inset-top)] border-b border-white/10 shrink-0 bg-black/90 backdrop-blur-xl">
        <button 
          onClick={onClose} 
          className="p-2 -ml-2 text-white/80 active:scale-90 transition-transform absolute"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="w-full text-center text-sm font-bold tracking-widest uppercase">REQUESTS</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {pendingRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-20 text-center">
            <p className="text-white/40 text-sm mb-6">No connection requests.</p>
            <button 
              onClick={() => {
                onClose();
                setTimeout(() => setShowSearchModal(true), 100);
              }}
              className="flex items-center space-x-2 px-4 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-full active:scale-95 transition-all"
            >
              <Plus size={16} className="text-white" />
              <span className="text-sm font-bold text-white">Find Connections</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingRequests.map((req) => (
              <div key={req.id} className="flex items-center justify-between bg-white/5 rounded-2xl p-4 border border-white/10">
                <div 
                  className="flex items-center space-x-3 flex-1 min-w-0 cursor-pointer active:opacity-70 transition-opacity"
                  onClick={() => {
                    onClose();
                    onUserClick(req.profiles.id);
                  }}
                >
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0">
                    {req.profiles.avatar_url ? (
                      <img src={req.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-lg font-bold text-white/40 uppercase">
                         {req.profiles.username?.[0] || '?'}
                      </div>
                    )}
                  </div>
                  <div className="truncate pr-2">
                    <p className="text-sm font-bold text-white truncate">{req.profiles.full_name || req.profiles.username}</p>
                    <p className="text-xs text-white/50 truncate">@{req.profiles.username}</p>
                  </div>
                </div>
                <div className="flex space-x-2 shrink-0">
                  <button 
                    onClick={() => onAccept(req.id)} 
                    className="bg-white text-black text-xs font-bold px-4 py-2 rounded-xl active:scale-95 transition-transform"
                  >
                    Accept
                  </button>
                  <button 
                    onClick={() => onReject(req.id, req.profiles.id)} 
                    className="bg-white/10 text-white text-xs font-bold px-4 py-2 rounded-xl active:scale-95 transition-transform"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default RequestsSlide;
