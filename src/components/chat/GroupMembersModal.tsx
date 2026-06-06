import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Shield, Trash2, ArrowLeft, MoreHorizontal, UserCog } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { supabase } from '@/src/lib/supabase';

function stripEmail(val: string | null | undefined): string {
  if (!val) return '';
  if (val.includes('@')) {
    const parts = val.split('@');
    if (parts[1] && parts[1].includes('.')) {
      return parts[0];
    }
  }
  return val;
}

export function GroupMembersModal({ isOpen, onClose, activeChat, currentUserId, isAdmin, onRemoved, onMakeAdmin }: any) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const participants = activeChat.participants || [];

  const handleRemoveUser = async (userId: string) => {
    if (userId === currentUserId || !isAdmin) return;
    setMenuOpenId(null); // Instantly close
    setLoadingId(userId);
    try {
      const { error } = await supabase.from('group_chat_participants').delete()
        .eq('chat_id', activeChat.id)
        .eq('user_id', userId);
      if (error) throw error;
      
      // Clean up RTDB optionally (via an edge function or directly from client if auth allows it, but RTDB allows us)
      // We will do it in Cloudflare if possible or just ignore for now as they will not get pushes if not in participants
      // Wait, we need to remove it from RTDB for the inbox so it doesn't clutter.
      // We'll dispatch a background RTDB delete if allowed.
      import('@/src/lib/firebase').then(({ rtdb }) => {
         import('firebase/database').then(({ ref, remove }) => {
            if (rtdb) remove(ref(rtdb, `inboxes/${userId}/${activeChat.id}`)).catch(console.warn);
         });
      });

      const userProfile = participants.find((p: any) => p.id === userId);
      await supabase.from('messages').insert({
         sender_id: currentUserId,
         group_chat_id: activeChat.id,
         content: 'removed a member',
         media_type: 'system',
         metadata: { type: 'USER_REMOVED', actorId: currentUserId, removedName: userProfile?.full_name || 'a member' }
      });

      onRemoved([userId]);
    } catch (e: any) {
       alert("Failed to remove: " + e.message);
    } finally {
       setLoadingId(null);
    }
  };

  const handleMakeAdmin = async (userId: string) => {
    if (userId === currentUserId || !isAdmin) return;
    setMenuOpenId(null); // Instantly close the menu
    setLoadingId(userId);
    try {
      const { error } = await supabase.from('group_chats')
        .update({ admin_id: userId })
        .eq('id', activeChat.id);
      if (error) throw error;
      
      const userProfile = participants.find((p: any) => p.id === userId);
      await supabase.from('messages').insert({
         sender_id: currentUserId,
         group_chat_id: activeChat.id,
         content: 'assigned a new admin',
         media_type: 'system',
         metadata: { type: 'ADMIN_ASSIGNED', actorId: currentUserId, newAdminName: userProfile?.full_name || 'a member' }
      });

      // Update local state if needed
      if (activeChat.groupChat) {
         activeChat.groupChat.admin_id = userId;
      }
      activeChat.admin_id = userId;
      if (typeof onRemoved === 'function' && onMakeAdmin) {
          onMakeAdmin(userId);
      }
      
    } catch (e: any) {
       alert("Failed to make admin: " + e.message);
    } finally {
       setLoadingId(null);
    }
  };

  const sortedParticipants = [...participants].sort((a, b) => {
     if (a.id === currentUserId) return -1;
     if (b.id === currentUserId) return 1;
     const adminId = activeChat.groupChat?.admin_id || activeChat.admin_id;
     if (a.id === adminId) return -1;
     if (b.id === adminId) return 1;
     return 0;
  });

  return (
    <AnimatePresence>
      {isOpen && (
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.3 }} className="fixed inset-0 z-[80] bg-black flex flex-col pt-safe">
        <div className="flex items-center gap-4 p-4 border-b border-white/10 shrink-0">
           <button onClick={onClose} className="p-2 -ml-2 text-white/50 active:scale-95">
             <ArrowLeft size={24} />
           </button>
           <h2 className="text-lg font-bold text-white flex-1">Chat Members</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" onClick={() => setMenuOpenId(null)}>
          {sortedParticipants.map((p: any) => {
             const isSelf = p.id === currentUserId;
             const isUserAdmin = p.id === (activeChat.groupChat?.admin_id || activeChat.admin_id); 
             return (
               <div key={p.id} className="flex items-center gap-3 p-3 rounded-2xl transition-colors relative">
                 <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10 shrink-0">
                   {p.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-white/50">{p.full_name?.charAt(0).toUpperCase()}</div>}
                 </div>
                 <div className="flex-1 min-w-0">
                    <span className="font-bold text-white flex items-center gap-2">
                       {stripEmail(p.full_name || p.username)} {isSelf && <span className="text-[11px] font-normal text-white/40">(You)</span>}
                       {isUserAdmin && <Shield size={12} className="text-blue-400" />}
                    </span>
                    <span className="text-white/40 text-sm truncate block">@{stripEmail(p.username)}</span>
                 </div>
                 
                 {isAdmin && !isSelf && (
                     <div className="relative">
                       <button 
                         onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === p.id ? null : p.id) }} 
                         className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                       >
                          {loadingId === p.id ? (
                            <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                          ) : (
                            <MoreHorizontal size={20} />
                          )}
                       </button>

                       <AnimatePresence>
                         {menuOpenId === p.id && (
                           <motion.div 
                             initial={{ opacity: 0, scale: 0.9, y: -10 }}
                             animate={{ opacity: 1, scale: 1, y: 0 }}
                             exit={{ opacity: 0, scale: 0.9, y: -10 }}
                             className="absolute top-10 right-0 min-w-[200px] bg-[#1c1c1c] rounded-2xl p-2 border border-white/10 shadow-2xl z-20"
                             onClick={(e) => e.stopPropagation()}
                           >
                             <button 
                               onClick={() => handleMakeAdmin(p.id)}
                               className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 flex items-center text-sm transition-colors text-white"
                             >
                               <UserCog size={18} className="mr-3 text-white/70" />
                               Make Admin
                             </button>
                             <button 
                               onClick={() => handleRemoveUser(p.id)}
                               className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 flex items-center text-sm transition-colors text-red-500 mt-1"
                             >
                               <Trash2 size={18} className="mr-3 text-red-500" />
                               Remove
                             </button>
                           </motion.div>
                         )}
                       </AnimatePresence>
                     </div>
                 )}
               </div>
             )
          })}
        </div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
