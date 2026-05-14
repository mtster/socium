import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, Check, Users } from 'lucide-react';
import { Profile } from '@/src/types';
import { supabase } from '@/src/lib/supabase';
import { cn } from '@/src/lib/utils';
import { ChatListItemType } from '@/src/types/chat';

interface CreateGroupModalProps {
  currentUserId: string;
  connections: ChatListItemType[];
  onClose: () => void;
  onGroupCreated: (chat: ChatListItemType) => void;
}

export function CreateGroupModal({ currentUserId, connections, onClose, onGroupCreated }: CreateGroupModalProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Filter only 1-on-1 connections to select from
  const userConnections = connections
    .filter(c => !c.isGroup && c.profile?.id !== currentUserId)
    .map(c => c.profile)
    .filter(Boolean) as Profile[];

  const filtered = userConnections.filter(c => 
    (c.full_name || c.username || '').toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handleCreate = async () => {
    if (selectedIds.size === 0) return;
    setLoading(true);
    try {
      // 1. Create group chat
      const { data: groupChat, error: groupError } = await supabase.from('group_chats')
        .insert({ admin_id: currentUserId, allow_member_edit: false })
        .select().single();
      
      if (groupError) throw groupError;

      // 2. Add participants (including me)
      const participants = Array.from(selectedIds);
      participants.push(currentUserId);
      
      const partsInserts = participants.map(uid => ({
        chat_id: groupChat.id,
        user_id: uid
      }));

      const { error: partError } = await supabase.from('group_chat_participants')
        .insert(partsInserts);

      if (partError) throw partError;

      // Ensure we have profile details for the newly created chat
      const selectedProfiles = userConnections.filter(c => selectedIds.has(c.id));

      const newGroupInfo: ChatListItemType = {
        id: groupChat.id,
        isGroup: true,
        name: selectedProfiles.slice(0,3).map(p => p.full_name?.split(' ')[0] || p.username).join(', ') + (selectedProfiles.length > 3 ? '...' : ''),
        avatar_url: null,
        unreadCount: 0,
        groupChat,
        participants: [...selectedProfiles, { id: currentUserId } as Profile] // Add bare current user to count
      };

      onGroupCreated(newGroupInfo);
    } catch (e: any) {
      console.error("CreateGroup Error:", e);
      alert("Failed to create group: " + (e.message || JSON.stringify(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[40] bg-black pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4.5rem+env(safe-area-inset-bottom))] flex flex-col justify-end sm:justify-center px-0 sm:px-4">
      <motion.div 
        initial={{ y: "100%" }} 
        animate={{ y: 0 }} 
        exit={{ y: "100%" }} 
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full sm:max-w-md bg-black sm:rounded-3xl overflow-hidden flex flex-col h-full border-t border-white/10 sm:border-white/10 mx-auto"
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <h2 className="text-white font-bold text-lg flex items-center gap-2"><Users size={20} /> New Group Chat</h2>
          <button onClick={onClose} className="p-2 bg-white/10 text-white rounded-full"><X size={20} /></button>
        </div>

        <div className="p-4 shrink-0">
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
            <input 
              type="text" 
              placeholder="Search connections..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/40 rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:border-white/30 transition-all text-sm" 
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 no-scrollbar">
          {filtered.length === 0 ? (
            <div className="text-center text-white/40 mt-10 text-sm">No connections found</div>
          ) : (
            filtered.map(c => (
              <button 
                key={c.id} 
                onClick={() => toggleSelect(c.id)}
                className="w-full p-3 flex items-center gap-4 hover:bg-white/5 rounded-xl transition-colors text-left"
              >
                <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0 relative">
                  {c.avatar_url ? (
                    <img src={c.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm font-medium text-white/50">
                      {(c.username?.charAt(0) || c.full_name?.charAt(0) || '?').toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white/90 truncate text-sm">{c.full_name || c.username}</p>
                </div>
                <div className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full border border-white/30 transition-colors duration-200">
                   {selectedIds.has(c.id) && (
                     <div className="w-full h-full bg-white rounded-full flex items-center justify-center">
                        <Check size={14} className="text-black stroke-[3px]" />
                     </div>
                   )}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="p-4 border-t border-white/10 shrink-0 bg-black">
          <button 
            disabled={selectedIds.size === 0 || loading}
            onClick={handleCreate}
            className="w-full bg-white text-black font-bold rounded-xl py-3.5 flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
          >
            {loading ? <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : 'Create Group'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
