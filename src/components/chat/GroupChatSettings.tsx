import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Camera, Settings2, LogOut, Users, Trash2, Bell, BellOff } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { ChatListItemType } from '@/src/types/chat';
import { Profile } from '@/src/types';

interface GroupChatSettingsProps {
  currentUserId: string;
  activeChat: ChatListItemType;
  onClose: () => void;
  onUpdate: (chat: ChatListItemType) => void;
  onLeave: () => void;
}

export function GroupChatSettings({ currentUserId, activeChat, onClose, onUpdate, onLeave }: GroupChatSettingsProps) {
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [isMuted, setIsMuted] = useState(false); 
  // TODO: Add muted logic later, keeping UI for now

  useEffect(() => {
    // Check if the current user is an admin or can edit
    const fetchRole = async () => {
      const { data } = await supabase
        .from('group_chat_participants')
        .select('role')
        .eq('chat_id', activeChat.id)
        .eq('user_id', currentUserId)
        .single();
        
      if (data) {
        setIsAdmin(data.role === 'admin');
        setCanEdit(data.role === 'admin' || !!(activeChat.groupChat?.allow_member_edit));
      }
    };
    fetchRole();
  }, [activeChat.id, currentUserId]);

  const handleUpdateName = async (newName: string) => {
    if (!canEdit) return;
    const { error } = await supabase.from('group_chats').update({ name: newName }).eq('id', activeChat.id);
    if (!error) {
      onUpdate({ ...activeChat, name: newName, groupChat: { ...activeChat.groupChat!, name: newName } });
    }
  };

  const handleToggleMembersEdit = async () => {
    if (!isAdmin) return;
    const newValue = !activeChat.groupChat?.allow_member_edit;
    const { error } = await supabase.from('group_chats').update({ allow_member_edit: newValue }).eq('id', activeChat.id);
    if (!error) {
       onUpdate({ ...activeChat, groupChat: { ...activeChat.groupChat!, allow_member_edit: newValue } } as any);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', uploadPreset);
      formData.append('folder', 'group_avatars');

      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      
      const { error } = await supabase.from('group_chats').update({ avatar_url: data.secure_url }).eq('id', activeChat.id);
      if (!error) {
        onUpdate({ ...activeChat, avatar_url: data.secure_url });
      }
    } catch (err) {
      console.error(err);
      alert("Failed to update picture");
    } finally {
      setLoading(false);
    }
  };

  const leaveGroup = async () => {
    if (!confirm("Are you sure you want to leave this group?")) return;
    try {
      await supabase.from('group_chat_participants').delete().eq('chat_id', activeChat.id).eq('user_id', currentUserId);
      onLeave();
    } catch (e) {
      alert("Failed to leave group.");
    }
  };

  return (
    <motion.div 
       initial={{ x: '100%', opacity: 1 }} 
       animate={{ x: 0, opacity: 1 }} 
       exit={{ x: '100%', opacity: 1 }} 
       transition={{ type: 'tween', duration: 0.35, ease: 'easeOut' }} 
       className="fixed inset-0 z-[70] flex flex-col bg-black w-full border-white/5 overflow-hidden select-none"
    >
      <div className="p-4 pt-safe flex items-center gap-4 border-b border-white/10 bg-black/80 backdrop-blur-xl shrink-0">
         <button onClick={onClose} className="p-2 -ml-2 text-white/80 active:scale-90 transition-transform"><ArrowLeft size={24} /></button>
         <h1 className="text-lg font-bold text-white flex-1">Group Info</h1>
      </div>
      
      <div className="flex-1 overflow-y-auto pb-safe">
        <div className="p-6 flex flex-col items-center border-b border-white/10">
           <button onClick={() => canEdit && fileInputRef.current?.click()} className="relative w-24 h-24 rounded-full overflow-hidden bg-white/10 flex items-center justify-center mb-4 group">
             {activeChat.avatar_url ? (
               <img src={activeChat.avatar_url} className="w-full h-full object-cover" />
             ) : (
                <span className="text-2xl font-bold text-white/50">{(activeChat.name?.charAt(0) || '?').toUpperCase()}</span>
             )}
             {canEdit && (
               <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                 <Camera size={24} className="text-white" />
               </div>
             )}
           </button>
           <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
           
           {canEdit ? (
             <div className="flex items-center gap-2">
               <input 
                 className="bg-transparent text-center text-xl font-bold text-white placeholder-white/40 focus:outline-none"
                 defaultValue={activeChat.name}
                 onBlur={(e) => { if (e.target.value.trim() !== activeChat.name) handleUpdateName(e.target.value.trim()); }}
               />
             </div>
           ) : (
             <h2 className="text-xl font-bold text-white">{activeChat.name}</h2>
           )}
           <p className="text-sm text-white/40 mt-1">{activeChat.participants?.length || 0} members</p>
        </div>

        <div className="p-4 space-y-6">
          {/* Members List */}
          <div>
            <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider mb-3 px-2">Members</h3>
            <div className="bg-white/5 rounded-2xl overflow-hidden">
              {activeChat.participants?.map((p, i) => (
                <div key={p.id} className="flex items-center justify-between p-4 border-b border-white/5 last:border-0" onClick={() => window.dispatchEvent(new CustomEvent('openProfile', { detail: { userId: p.id } }))}>
                  <div className="flex items-center gap-3">
                    <img src={p.avatar_url || ''} className="w-10 h-10 rounded-full bg-white/10 object-cover" />
                    <div>
                       <p className="text-white text-sm font-medium">{p.full_name || p.username} {p.id === currentUserId && '(You)'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Admin Settings */}
          {isAdmin && (
            <div>
              <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider mb-3 px-2">Admin Settings</h3>
              <div className="bg-white/5 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Settings2 size={20} className="text-white/70" />
                    <span className="text-white text-sm font-medium">Members can edit info</span>
                  </div>
                  <button 
                    onClick={handleToggleMembersEdit}
                    className={`w-12 h-6 rounded-full transition-colors relative ${activeChat.groupChat?.allow_member_edit ? 'bg-white' : 'bg-white/20'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-black absolute top-1 transition-all ${activeChat.groupChat?.allow_member_edit ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div>
             <div className="bg-white/5 rounded-2xl overflow-hidden">
                <button className="w-full flex items-center p-4 gap-3 text-red-500 hover:bg-white/5 transition-colors" onClick={leaveGroup}>
                  <LogOut size={20} />
                  <span className="text-sm font-medium">Leave Group</span>
                </button>
             </div>
          </div>
        </div>
      </div>
      {loading && <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}
    </motion.div>
  );
}
