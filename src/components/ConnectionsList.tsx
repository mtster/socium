import React from 'react';
import { Plus, Users } from 'lucide-react';
import { Profile } from '@/src/types';

interface ConnectionsListProps {
  connections: Profile[];
  pendingRequestsCount: number;
  isOwnProfile: boolean;
  onUserClick?: (userId: string) => void;
  setShowRequestsSlide: (show: boolean) => void;
  setShowSearchModal: (show: boolean) => void;
}

const ConnectionsList: React.FC<ConnectionsListProps> = ({
  connections,
  pendingRequestsCount,
  isOwnProfile,
  onUserClick,
  setShowRequestsSlide,
  setShowSearchModal
}) => {
  return (
    <div className="w-full mb-12 mt-4">
      <div className="flex items-center justify-between mb-4 px-2">
        <h3 className="text-sm font-bold uppercase tracking-widest text-white/70">
          Connections <span className="text-white/30 ml-2">{connections.length}</span>
        </h3>
        {isOwnProfile && (
          <div className="flex items-center space-x-2">
            <button 
              onClick={() => setShowRequestsSlide(true)}
              className={`flex items-center space-x-1 px-3 py-1.5 border rounded-full active:scale-95 transition-all ${
                pendingRequestsCount > 0 
                  ? 'bg-white text-black border-white hover:bg-white/90' 
                  : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
              }`}
            >
              <Users size={14} className={pendingRequestsCount > 0 ? 'text-black' : 'text-white/50'} />
              <span className="text-xs font-bold">Requests {pendingRequestsCount > 0 && `(${pendingRequestsCount})`}</span>
            </button>
            <button 
              onClick={() => setShowSearchModal(true)}
              className="flex items-center space-x-1 px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-full active:scale-95 transition-all"
            >
              <Plus size={14} className="text-white/70" />
              <span className="text-xs font-bold text-white/70">Find</span>
            </button>
          </div>
        )}
      </div>
      
      {connections.length > 0 ? (
        <div className="flex space-x-4 overflow-x-auto pb-4 px-2 -mx-4 no-scrollbar">
          <div className="w-2 shrink-0"></div>
          {connections.map((conn) => (
            <div 
              key={conn.id} 
              className="flex flex-col items-center shrink-0 w-16 cursor-pointer active:opacity-70 transition-opacity"
              onClick={() => onUserClick?.(conn.id)}
            >
              <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 overflow-hidden mb-2">
                {conn.avatar_url ? (
                   <img src={conn.avatar_url} alt={conn.username} className="w-full h-full object-cover" />
                ) : (
                   <div className="w-full h-full flex items-center justify-center text-white/40 text-xl font-bold">
                     {(conn.username?.[0] || conn.full_name?.[0] || '?').toUpperCase()}
                   </div>
                )}
              </div>
              <p className="text-xs text-white/70 text-center truncate w-full">{conn.full_name || conn.username}</p>
            </div>
          ))}
          <div className="w-2 shrink-0"></div>
        </div>
      ) : (
         <div className="bg-white/5 border border-white/5 rounded-2xl p-6 text-center">
           <p className="text-sm text-white/40">No connections yet.</p>
         </div>
      )}
    </div>
  );
};

export default ConnectionsList;
