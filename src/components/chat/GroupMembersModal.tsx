import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Shield, Trash2, ArrowLeft } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { supabase } from '@/src/lib/supabase';

export function GroupMembersModal({ isOpen, onClose, activeChat, currentUserId, isAdmin, onRemoved }: any) {
  const [isRemovingState, setIsRemovingState] = useState(false);
  const [selectedForRemoval, setSelectedForRemoval] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const participants = activeChat.participants || [];

  const handleToggleRemove = (id: string) => {
    if (id === currentUserId) return; // Cant remove self here
    if (selectedForRemoval.includes(id)) setSelectedForRemoval(prev => prev.filter(x => x !== id));
    else setSelectedForRemoval(prev => [...prev, id]);
  };

  const handleConfirmRemove = async () => {
    if (!selectedForRemoval.length) {
      setIsRemovingState(false);
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from('group_chat_participants').delete()
        .eq('chat_id', activeChat.id)
        .in('user_id', selectedForRemoval);
      if (error) throw error;
      onRemoved(selectedForRemoval);
      setSelectedForRemoval([]);
      setIsRemovingState(false);
    } catch (e: any) {
       alert("Failed to remove: " + e.message);
    } finally {
       setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.35 }} className="fixed inset-0 z-[80] bg-black flex flex-col pt-safe">
        <div className="flex items-center gap-4 p-4 border-b border-white/10 shrink-0">
           <button onClick={() => isRemovingState ? setIsRemovingState(false) : onClose()} className="p-2 -ml-2 text-white/50 active:scale-95">
             <ArrowLeft size={24} />
           </button>
           <h2 className="text-lg font-bold text-white flex-1">{isRemovingState ? 'Remove Members' : 'Chat Members'}</h2>
           {!isRemovingState && isAdmin && participants.length > 1 && (
             <button onClick={() => setIsRemovingState(true)} className="text-[13px] font-bold text-red-500 bg-red-500/10 px-3 py-1.5 rounded-full">
               Remove
             </button>
           )}
           {isRemovingState && (
             <button onClick={handleConfirmRemove} disabled={loading} className="text-[13px] font-bold text-white bg-white/20 px-3 py-1.5 rounded-full data-[disabled=true]:opacity-50">
               {loading ? 'Removing...' : (selectedForRemoval.length > 0 ? `Remove (${selectedForRemoval.length})` : 'Cancel')}
             </button>
           )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {participants.map((p: any) => {
             const isSelf = p.id === currentUserId;
             // We can check if they are admin if we have roles, but activeChat.participants might not have roles.
             // Assume `p.role === 'admin'` if fetched, else skip. (We can fetch roles if needed, but for now just visual)
             const isUserAdmin = p.role === 'admin' || p.id === activeChat.admin_id; 
             return (
               <div key={p.id} onClick={() => isRemovingState && !isSelf && handleToggleRemove(p.id)} className={cn("flex items-center gap-3 p-3 rounded-2xl transition-colors", isRemovingState && !isSelf ? "cursor-pointer active:bg-white/5" : "")}>
                 <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10 shrink-0">
                   {p.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-white/50">{p.full_name?.charAt(0).toUpperCase()}</div>}
                 </div>
                 <div className="flex-1 min-w-0">
                    <span className="font-bold text-white flex items-center gap-2">
                       {p.full_name} {isSelf && <span className="text-[11px] font-normal text-white/40">(You)</span>}
                       {isUserAdmin && <Shield size={12} className="text-blue-400" />}
                    </span>
                    <span className="text-white/40 text-sm truncate block">@{p.username}</span>
                 </div>
                 {isRemovingState && !isSelf && (
                    <div className={cn("w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-colors", selectedForRemoval.includes(p.id) ? "border-red-500 bg-red-500/20 text-red-500" : "border-white/20")}>
                       {selectedForRemoval.includes(p.id) && <div className="w-3 h-3 rounded-full bg-red-500" />}
                    </div>
                 )}
               </div>
             )
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
