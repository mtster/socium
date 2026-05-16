import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Camera, Settings2, LogOut, Trash2, Pencil, Search, Shield, X, Edit2, PencilLine, ChevronRight } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { ChatListItemType } from '@/src/types/chat';
import { Profile } from '@/src/types';
import { cn } from '@/src/lib/utils';
import { GroupMembersModal } from './GroupMembersModal';
import { GroupAddMembersModal } from './GroupAddMembersModal';

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
  const [showMembers, setShowMembers] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [nameEditMode, setNameEditMode] = useState(false);
  const [tempName, setTempName] = useState(activeChat.name || '');
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchRole = async () => {
      const { data } = await supabase
        .from('group_chat_participants')
        .select('*')
        .eq('chat_id', activeChat.id)
        .eq('user_id', currentUserId)
        .maybeSingle();
        
      setIsAdmin(activeChat.groupChat?.admin_id === currentUserId || activeChat.admin_id === currentUserId);
      setCanEdit(activeChat.groupChat?.admin_id === currentUserId || activeChat.admin_id === currentUserId || !!(activeChat.groupChat?.allow_member_edit));
    };
    fetchRole();
  }, [activeChat.id, currentUserId]);

  const handleUpdateName = async () => {
    if (!canEdit || tempName.trim() === activeChat.name) return setNameEditMode(false);
    const newName = tempName.trim();
    const { error } = await supabase.from('group_chats').update({ name: newName }).eq('id', activeChat.id);
    if (!error) {
      onUpdate({ ...activeChat, name: newName, groupChat: { ...activeChat.groupChat!, name: newName } });
    }
    setNameEditMode(false);
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
    setAvatarMenuOpen(false);
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
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeletePicture = async () => {
    setAvatarMenuOpen(false);
    if (!canEdit) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('group_chats').update({ avatar_url: null }).eq('id', activeChat.id);
      if (!error) {
        onUpdate({ ...activeChat, avatar_url: null });
      }
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

  const handleRemovedMembers = (ids: string[]) => {
    const newParticipants = (activeChat.participants || []).filter((p: any) => !ids.includes(p.id));
    onUpdate({ ...activeChat, participants: newParticipants });
  };
  
  const handleAddedMembers = (profiles: any[]) => {
    const newParticipants = [...(activeChat.participants || []), ...profiles];
    onUpdate({ ...activeChat, participants: newParticipants });
  };

  const participants = activeChat.participants || [];

  return (
    <>
      <motion.div 
         initial={{ x: '100%', opacity: 1 }} 
         animate={{ x: 0, opacity: 1 }} 
         exit={{ x: '100%', opacity: 1 }} 
         transition={{ type: 'tween', duration: 0.35, ease: 'easeOut' }} 
         className="fixed inset-0 z-[70] flex flex-col bg-black w-full border-white/5 overflow-hidden select-none"
      >
        <div className="p-4 pt-safe flex items-center gap-4 border-b border-white/10 bg-black/80 backdrop-blur-xl shrink-0">
           <button onClick={onClose} className="p-2 -ml-2 text-white/80 active:scale-90 transition-transform"><ArrowLeft size={24} /></button>
           <h1 className="text-[17px] font-bold text-white flex-1">{activeChat.name || 'Group Info'}</h1>
        </div>
        
        <div className="flex-1 overflow-y-auto pb-safe">
          <div className="p-6 flex flex-col items-center">
             <div className="relative mb-4">
               {activeChat.avatar_url ? (
                 <div className="w-[100px] h-[100px] rounded-full overflow-hidden bg-white/10">
                   <img src={activeChat.avatar_url} className="w-full h-full object-cover" />
                 </div>
               ) : (
                 <div className="w-[100px] h-[100px] rounded-full overflow-hidden bg-white/10 relative">
                   {participants.length > 0 ? (
                      participants.slice(0,3).map((p, i, arr) => (
                        <div key={i} className={cn("absolute border-2 border-black overflow-hidden bg-[#222]", arr.length === 1 ? "inset-0 rounded-full" : arr.length === 2 ? (i === 0 ? "top-0 left-0 w-full h-1/2 rounded-t-full" : "bottom-0 right-0 w-full h-1/2 rounded-b-full") : (i === 0 ? "top-0 left-0 w-full h-1/2 rounded-t-full" : i === 1 ? "bottom-0 left-0 w-1/2 h-1/2 rounded-bl-full" : "bottom-0 right-0 w-1/2 h-1/2 rounded-br-full"))}>
                          {p?.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/20 flex items-center justify-center font-bold text-xs text-white/70">{(p?.full_name?.charAt(0) || p?.username?.charAt(0) || '?').toUpperCase()}</div>}
                        </div>
                      ))
                   ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-white/50">{(activeChat.name?.charAt(0) || '?').toUpperCase()}</div>
                   )}
                 </div>
               )}
               {canEdit && (
                 <button onClick={() => setAvatarMenuOpen(true)} className="absolute bottom-0 right-0 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                   <Pencil size={14} className="text-black" />
                 </button>
               )}
             </div>
             
             <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
             
             <div className="flex items-center gap-2 group">
               {nameEditMode && canEdit ? (
                 <div className="flex items-center gap-2">
                   <input 
                     className="bg-white/10 text-center text-xl font-bold text-white px-3 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-white/30"
                     value={tempName}
                     onChange={(e) => setTempName(e.target.value)}
                     onBlur={handleUpdateName}
                     onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateName() }}
                     autoFocus
                   />
                 </div>
               ) : (
                 <>
                   <h2 className="text-[22px] font-bold text-white">{activeChat.name || 'Group Chat'}</h2>
                   {canEdit && (
                     <button onClick={() => { setTempName(activeChat.name || ''); setNameEditMode(true); }} className="text-white/40 hover:text-white/80 active:scale-95">
                       <PencilLine size={16} />
                     </button>
                   )}
                 </>
               )}
             </div>
             <p className="text-[15px] font-medium text-white/40 mt-1">Group • {participants.length} members</p>
          </div>

          <div className="px-4 py-2 space-y-4">
            <div className="bg-[#1c1c1c] rounded-[18px] overflow-hidden">
               <button onClick={() => setShowMembers(true)} className="w-full flex items-center justify-between p-4 px-5 text-white hover:bg-white/5 transition-colors">
                  <span className="text-[17px] font-medium">Chat Members</span>
                  <div className="flex items-center gap-2">
                     <span className="text-[17px] text-white/50">{participants.length}</span>
                     <ChevronRight size={20} className="text-white/30" />
                  </div>
               </button>
               <button onClick={() => setShowAddMembers(true)} className="w-full flex items-center justify-between p-4 px-5 rounded-b-[18px] border-t border-white/5 text-white hover:bg-white/5 transition-colors">
                  <span className="text-[17px] font-medium">Add Member</span>
                  <ChevronRight size={20} className="text-white/30" />
               </button>
            </div>

            {isAdmin && (
              <div className="bg-[#1c1c1c] rounded-[18px] overflow-hidden">
                <div className="flex items-center justify-between p-4 px-5">
                  <span className="text-[17px] font-medium text-white">Allow member edits</span>
                  <button 
                    onClick={handleToggleMembersEdit}
                    className={cn("w-[50px] h-[30px] rounded-full transition-colors relative", activeChat.groupChat?.allow_member_edit ? "bg-white" : "bg-white/20")}
                  >
                    <div className={cn("w-[26px] h-[26px] rounded-full bg-[#1c1c1c] absolute top-[2px] transition-all shadow-sm", activeChat.groupChat?.allow_member_edit ? "left-[22px]" : "left-[2px]")} />
                  </button>
                </div>
              </div>
            )}

            <div className="bg-[#1c1c1c] rounded-[18px] overflow-hidden mt-6">
               <button className="w-full flex items-center justify-center p-4 px-5 text-red-500 hover:bg-white/5 transition-colors" onClick={leaveGroup}>
                 <span className="text-[17px] font-semibold">Leave Group</span>
               </button>
            </div>
          </div>
        </div>
        {loading && <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}
      </motion.div>

      {/* Group Avatar Menu */}
      <AnimatePresence>
        {avatarMenuOpen && (
          <><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/40" onClick={() => setAvatarMenuOpen(false)} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed z-[101] bottom-safe left-4 right-4 bg-[#1c1c1c] rounded-2xl overflow-hidden shadow-2xl">
              {activeChat.avatar_url && <button className="w-full p-4 text-center text-[15px] font-medium text-white border-b border-white/5 active:bg-white/5" onClick={() => { setViewingImage(activeChat.avatar_url); setAvatarMenuOpen(false); }}>Look at picture</button>}
              <button className="w-full p-4 text-center text-[15px] font-medium text-white border-b border-white/5 active:bg-white/5" onClick={() => fileInputRef.current?.click()}>Change picture</button>
              {activeChat.avatar_url && <button className="w-full p-4 text-center text-[15px] font-medium text-red-500 border-b border-white/5 active:bg-white/5" onClick={handleDeletePicture}>Delete picture</button>}
              <button className="w-full p-4 text-center text-[15px] font-bold text-white active:bg-white/5" onClick={() => setAvatarMenuOpen(false)}>Cancel</button>
          </motion.div></>
        )}
      </AnimatePresence>

      {/* ImageViewer for Group Avatar */}
      <AnimatePresence>
        {viewingImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] bg-black flex flex-col">
            <div className="absolute top-0 left-0 right-0 p-4 pt-safe flex items-center justify-between z-10 bg-gradient-to-b from-black/50 to-transparent">
              <button onClick={() => setViewingImage(null)} className="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center text-white"><X size={20}/></button>
            </div>
            <div className="flex-1 flex items-center justify-center"><img src={viewingImage} className="w-full h-auto max-h-[100dvh] object-contain" /></div>
          </motion.div>
        )}
      </AnimatePresence>

      <GroupMembersModal 
         isOpen={showMembers} 
         onClose={() => setShowMembers(false)}
         activeChat={activeChat}
         currentUserId={currentUserId}
         isAdmin={isAdmin}
         onRemoved={handleRemovedMembers}
      />
      
      <GroupAddMembersModal
         isOpen={showAddMembers}
         onClose={() => setShowAddMembers(false)}
         activeChat={activeChat}
         currentUserId={currentUserId}
         onAdded={handleAddedMembers}
      />
    </>
  );
}
