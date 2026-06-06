import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Camera, Settings2, LogOut, Trash2, Pencil, Search, Shield, X, Edit2, PencilLine, ChevronRight } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { ChatListItemType } from '@/src/types/chat';
import { Profile } from '@/src/types';
import { cn } from '@/src/lib/utils';
import { GroupMembersModal } from './GroupMembersModal';
import { GroupAddMembersModal } from './GroupAddMembersModal';
import { ProfileImageViewer } from '../profile/ProfileImageViewer';

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
  const [isMuted, setIsMuted] = useState(false);
  
  useEffect(() => {
    const fetchRole = async () => {
      const { data } = await supabase
        .from('group_chat_participants')
        .select('*')
        .eq('chat_id', activeChat.id)
        .eq('user_id', currentUserId)
        .maybeSingle();
        
      if (data) setIsMuted(!!data.is_muted);

      setIsAdmin(activeChat.groupChat?.admin_id === currentUserId || activeChat.admin_id === currentUserId);
      setCanEdit(activeChat.groupChat?.admin_id === currentUserId || activeChat.admin_id === currentUserId || !!(activeChat.groupChat?.allow_member_edit));
    };
    fetchRole();
  }, [activeChat.id, currentUserId]);

  const handleToggleMute = async () => {
    const newVal = !isMuted;
    setIsMuted(newVal);
    await supabase.from('group_chat_participants').update({ is_muted: newVal }).eq('chat_id', activeChat.id).eq('user_id', currentUserId);
  };

  const handleUpdateName = async () => {
    if (!canEdit || tempName.trim() === activeChat.name) return setNameEditMode(false);
    const newName = tempName.trim();
    const { error } = await supabase.from('group_chats').update({ name: newName }).eq('id', activeChat.id);
    if (!error) {
      await supabase.from('messages').insert({
         sender_id: currentUserId,
         group_chat_id: activeChat.id,
         content: 'changed the group name',
         media_type: 'system',
         metadata: { type: 'GROUP_NAME_CHANGED', actorId: currentUserId, newName: newName }
      });
      onUpdate({ ...activeChat, name: newName, groupChat: { ...activeChat.groupChat!, name: newName } });
    }
    setNameEditMode(false);
  };

  const handleToggleMembersEdit = async () => {
    if (!isAdmin) return;
    const newValue = !activeChat.groupChat?.allow_member_edit;
    const { error } = await supabase.from('group_chats').update({ allow_member_edit: newValue }).eq('id', activeChat.id);
    if (!error) {
       await supabase.from('messages').insert({
          sender_id: currentUserId,
          group_chat_id: activeChat.id,
          content: 'changed editing permissions',
          media_type: 'system',
          metadata: { type: 'EDIT_PERMISSION_CHANGED', actorId: currentUserId, newValue: newValue }
       });
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
        await supabase.from('messages').insert({
           sender_id: currentUserId,
           group_chat_id: activeChat.id,
           content: 'changed the group picture',
           media_type: 'system',
           metadata: { type: 'AVATAR_CHANGED', actorId: currentUserId }
        });
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
        await supabase.from('messages').insert({
           sender_id: currentUserId,
           group_chat_id: activeChat.id,
           content: 'removed the group picture',
           media_type: 'system',
           metadata: { type: 'AVATAR_REMOVED', actorId: currentUserId }
        });
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
      await supabase.from('messages').insert({
         sender_id: currentUserId,
         group_chat_id: activeChat.id,
         content: 'left the group',
         media_type: 'system',
         metadata: { type: 'USER_LEFT', actorId: currentUserId }
      });
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
           <div className="p-8 flex flex-col items-center border-b border-white/5 bg-gradient-to-b from-[#1c1c1c]/50 to-transparent">
             <div className="relative mb-6 z-10 group">
               {activeChat.avatar_url ? (
                 <div 
                   className={cn("w-[120px] h-[120px] rounded-full overflow-hidden bg-white/5 shadow-2xl ring-1 ring-white/10", !canEdit && "cursor-pointer active:scale-95 transition-transform")}
                   onClick={() => !canEdit && setViewingImage(activeChat.avatar_url!)}
                 >
                   <img src={activeChat.avatar_url} className="w-full h-full object-cover" />
                 </div>
               ) : (
                 <div className="w-[120px] h-[120px] rounded-full overflow-hidden bg-white/5 shadow-2xl ring-1 ring-white/10 relative">
                   {participants.length > 0 ? (
                      participants.slice(0,3).map((p, i, arr) => (
                        <div key={i} className={cn("absolute border-[3px] border-[#0a0a0a] overflow-hidden bg-[#222]", arr.length === 1 ? "inset-0 rounded-full" : arr.length === 2 ? (i === 0 ? "top-0 left-0 w-full h-1/2 rounded-t-full" : "bottom-0 right-0 w-full h-1/2 rounded-b-full") : (i === 0 ? "top-0 left-0 w-full h-1/2 rounded-t-full" : i === 1 ? "bottom-0 left-0 w-1/2 h-1/2 rounded-bl-full" : "bottom-0 right-0 w-1/2 h-1/2 rounded-br-full"))}>
                          {p?.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/10 flex items-center justify-center font-bold text-xs text-white/70">{(p?.full_name?.charAt(0) || p?.username?.charAt(0) || '?').toUpperCase()}</div>}
                        </div>
                      ))
                   ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-white/50">{(activeChat.name?.charAt(0) || '?').toUpperCase()}</div>
                   )}
                 </div>
               )}
               {canEdit && (
                 <button onClick={() => setAvatarMenuOpen(!avatarMenuOpen)} className="absolute bottom-1 right-1 w-9 h-9 bg-white rounded-full flex items-center justify-center shadow-2xl hover:bg-gray-200 active:scale-95 transition-transform z-10 ring-4 ring-[#0a0a0a]">
                   <Pencil size={15} className="text-black" />
                 </button>
               )}

               <AnimatePresence>
                  {avatarMenuOpen && (
                    <>
                    <motion.div 
                      className="fixed inset-0 z-20"
                      onClick={() => setAvatarMenuOpen(false)}
                    />
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 10 }}
                      className="absolute top-32 left-1/2 -translate-x-1/2 min-w-[220px] bg-[#1c1c1c] rounded-2xl p-2 border border-white/10 shadow-2xl z-30"
                    >
                      
                      {activeChat.avatar_url && (
                        <button 
                          onClick={() => {
                            setAvatarMenuOpen(false);
                            if (activeChat.avatar_url) setViewingImage(activeChat.avatar_url);
                          }}
                          className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 flex items-center text-[15px] font-medium transition-colors text-white"
                        >
                          <Search size={18} className="mr-3 text-white/50" />
                          Look at picture
                        </button>
                      )}
                      
                      <button 
                        onClick={() => {
                          setAvatarMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                        className={cn("w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 flex items-center text-[15px] font-medium transition-colors text-white", activeChat.avatar_url ? "mt-1" : "")}
                      >
                        <Camera size={18} className="mr-3 text-white/50" />
                        Change picture
                      </button>

                      {activeChat.avatar_url && (
                        <button 
                          onClick={() => {
                            setAvatarMenuOpen(false);
                            handleDeletePicture();
                          }}
                          className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 flex items-center text-[15px] font-medium text-red-500 transition-colors mt-1"
                        >
                          <Trash2 size={18} className="mr-3 text-red-500/70" />
                          Delete picture
                        </button>
                      )}
                    </motion.div>
                    </>
                  )}
               </AnimatePresence>
             </div>
             
             <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
             
             <div className="flex items-center justify-center w-full group">
               {nameEditMode && canEdit ? (
                 <div className="flex items-center gap-2 w-full max-w-[280px]">
                   <input 
                     className="w-full bg-[#1c1c1c] text-center text-2xl font-bold text-white px-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/20 border border-white/10 shadow-inner"
                     value={tempName}
                     onChange={(e) => setTempName(e.target.value)}
                     onBlur={handleUpdateName}
                     onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateName() }}
                     autoFocus
                   />
                 </div>
               ) : (
                 <div className="flex items-center gap-3">
                   <h2 className="text-[26px] tracking-tight font-bold text-white max-w-[250px] truncate leading-none">{activeChat.name || 'Group Chat'}</h2>
                   {canEdit && (
                     <button onClick={() => { setTempName(activeChat.name || ''); setNameEditMode(true); }} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors active:scale-95 flex-shrink-0">
                       <Pencil size={14} />
                     </button>
                   )}
                 </div>
               )}
             </div>
             <p className="text-[15px] font-medium text-white/40 mt-3">Group • {participants.length} members</p>
          </div>

          <div className="px-5 py-6 space-y-5">
            <div className="bg-[#1c1c1c] rounded-[24px] overflow-hidden border border-white/5 shadow-xl">
               <button onClick={() => setShowMembers(true)} className="w-full flex items-center justify-between p-5 text-white hover:bg-white/5 transition-colors">
                  <span className="text-[17px] font-medium tracking-tight">Chat Members</span>
                  <div className="flex items-center gap-2">
                     <span className="text-[17px] text-white/40">{participants.length}</span>
                     <ChevronRight size={20} className="text-white/20" />
                  </div>
               </button>
               <div className="h-[1px] w-full bg-white/5 ml-5" />
               <button onClick={() => setShowAddMembers(true)} className="w-full flex items-center justify-between p-5 text-white hover:bg-white/5 transition-colors">
                  <span className="text-[17px] font-medium tracking-tight">Add Member</span>
                  <ChevronRight size={20} className="text-white/20" />
               </button>
            </div>

            <div className="bg-[#1c1c1c] rounded-[24px] overflow-hidden border border-white/5 shadow-xl">
              <div className="flex items-center justify-between p-5">
                <span className="text-[17px] font-medium text-white max-w-[70%] leading-snug">Mute Notifications</span>
                <button 
                  onClick={handleToggleMute}
                  className={cn("w-[52px] h-[32px] rounded-full transition-colors relative flex-shrink-0", isMuted ? "bg-white" : "bg-white/20")}
                >
                  <div className={cn("w-[28px] h-[28px] rounded-full bg-[#121212] absolute top-[2px] transition-all shadow-sm", isMuted ? "left-[22px]" : "left-[2px]")} />
                </button>
              </div>
            </div>

            {isAdmin ? (
              <div className="bg-[#1c1c1c] rounded-[24px] overflow-hidden border border-white/5 shadow-xl">
                <div className="flex items-center justify-between p-5">
                  <span className="text-[17px] font-medium text-white max-w-[70%] leading-snug">Allow everyone to edit this group chat</span>
                  <button 
                    onClick={handleToggleMembersEdit}
                    className={cn("w-[52px] h-[32px] rounded-full transition-colors relative flex-shrink-0", activeChat.groupChat?.allow_member_edit ? "bg-white" : "bg-white/20")}
                  >
                    <div className={cn("w-[28px] h-[28px] rounded-full bg-[#121212] absolute top-[2px] transition-all shadow-sm", activeChat.groupChat?.allow_member_edit ? "left-[22px]" : "left-[2px]")} />
                  </button>
                </div>
              </div>
            ) : (
              activeChat.groupChat?.allow_member_edit && (
                <div className="bg-[#1c1c1c] rounded-[24px] overflow-hidden border border-white/5 shadow-xl">
                  <div className="flex items-center p-5">
                    <span className="text-[15px] font-medium text-white/50 leading-snug text-center w-full">Every user in this chat can edit the group picture and name</span>
                  </div>
                </div>
              )
            )}

            <div className="bg-[#1c1c1c] rounded-[24px] overflow-hidden mt-6 border border-white/5 shadow-xl">
               <button className="w-full flex items-center justify-center p-5 text-red-500 hover:bg-red-500/10 transition-colors" onClick={leaveGroup}>
                 <span className="text-[17px] font-bold tracking-tight">Leave Group</span>
               </button>
            </div>
          </div>
        </div>
        {loading && <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}
      </motion.div>

      {/* ImageViewer for Group Avatar */}
      <ProfileImageViewer viewingImage={viewingImage} setViewingImage={setViewingImage} />

      <GroupMembersModal 
         isOpen={showMembers} 
         onClose={() => setShowMembers(false)}
         activeChat={activeChat}
         currentUserId={currentUserId}
         isAdmin={isAdmin}
         onRemoved={handleRemovedMembers}
         onMakeAdmin={(newAdminId: string) => {
           setIsAdmin(false);
           setCanEdit(activeChat.groupChat?.allow_member_edit || false);
           onUpdate({ ...activeChat, admin_id: newAdminId }); // Optional
         }}
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
