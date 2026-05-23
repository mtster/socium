import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '@/src/store/useStore';
import { Profile } from '@/src/types';
import { ChatListItemType } from '@/src/types/chat';
import { useChatList } from './chat/useChatList';
import { ChatRoom } from './chat/ChatRoom';
import { CreateGroupModal } from './chat/CreateGroupModal';
import { GroupChatSettings } from './chat/GroupChatSettings';
import { cn } from '@/src/lib/utils';
import { Search } from 'lucide-react';

interface ChatProps {
  currentUserId: string;
  initialActiveChat?: ChatListItemType | null;
  onCloseChat?: () => void;
  onChatStateChange?: (isOpen: boolean) => void;
}

export default function Chat({ currentUserId, initialActiveChat, onCloseChat, onChatStateChange }: ChatProps) {
  const { chats, loading, updateChatList, inboxStates, markChatAsSeenOptimistically } = useChatList(currentUserId);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChat, setActiveChat] = useState<ChatListItemType | null>(initialActiveChat || null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);

  useEffect(() => { onChatStateChange?.(!!activeChat); }, [activeChat, onChatStateChange]);

  useEffect(() => {
    const handleOpenCreateGroup = () => setIsCreatingGroup(true);
    window.addEventListener('openCreateGroup', handleOpenCreateGroup);
    return () => window.removeEventListener('openCreateGroup', handleOpenCreateGroup);
  }, []);

  useEffect(() => {
    const handleResetTab = (e: any) => {
      if (e.detail?.tabId === 'chat' && !activeChat) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('resetTab', handleResetTab);
    return () => window.removeEventListener('resetTab', handleResetTab);
  }, [activeChat]);

  useEffect(() => { 
    if (initialActiveChat !== undefined) {
      setActiveChat(initialActiveChat); 
    }
  }, [initialActiveChat]);

  useEffect(() => {
    if (activeChat) {
      const updatedChat = chats.find(c => c.id === activeChat.id);
      if (updatedChat && (updatedChat.name !== activeChat.name || updatedChat.avatar_url !== activeChat.avatar_url || updatedChat.groupChat !== activeChat.groupChat)) {
        setActiveChat(updatedChat);
      }
    }
  }, [chats, activeChat]);

  const filteredConnections = chats.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex flex-col h-full bg-black overflow-hidden relative">
      <div className="absolute inset-0 flex flex-col h-full select-none [user-select:none] [-webkit-user-select:none] [-webkit-touch-callout:none]">
        <div className="p-4 pt-safe border-b border-white/10 shrink-0">
           <div className="relative">
             <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
             <input type="text" placeholder="Search chats..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/40 rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:border-white/30 text-sm transition-all" />
           </div>
        </div>
        <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
          {!loading && filteredConnections.length === 0 ? <div className="p-8 text-center text-white/40 text-sm">No chats found</div> : filteredConnections.map(c => {
              const isUnread = inboxStates?.[c.id] === false || (inboxStates?.[c.id] === undefined && c.unreadCount !== undefined && c.unreadCount > 0);
              return (
              <motion.button 
                key={c.id} 
                layout 
                transition={{ type: "spring", stiffness: 380, damping: 36, mass: 1 }}
                onClick={() => {
                  markChatAsSeenOptimistically(c.id);
                  setActiveChat(c);
                }} 
                className="w-full flex items-center p-4 border-b border-white/5 active:bg-white/5 transition-colors gap-4 text-left cursor-pointer"
              >
                 <div className={cn("w-12 h-12 shrink-0 relative flex items-center justify-center", (c.avatar_url || !c.isGroup) ? "rounded-full overflow-hidden bg-white/10 border border-white/10" : "")}>
                    {c.isGroup ? (
                       <div className="w-full h-full relative">
                         {c.avatar_url ? (
                           <img src={c.avatar_url} className="w-full h-full object-cover" />
                         ) : c.participants && c.participants.length > 0 ? (
                           c.participants.slice(0,3).map((p, i, arr) => (
                             <div key={i} className={cn("absolute rounded-full border border-black overflow-hidden bg-white/20", arr.length === 1 ? "inset-0" : arr.length === 2 ? (i === 0 ? "top-0 left-0 w-8 h-8" : "bottom-0 right-0 w-8 h-8") : (i === 0 ? "top-0 left-1/2 -translate-x-1/2 w-7 h-7 z-20" : i === 1 ? "bottom-0 left-0 w-7 h-7 z-10" : "bottom-0 right-0 w-7 h-7 z-10"))}>
                               {p?.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/20 flex items-center justify-center font-bold text-[10px] text-white/70">{(p?.full_name?.charAt(0) || p?.username?.charAt(0) || '?').toUpperCase()}</div>}
                             </div>
                           ))
                         ) : <div className="text-sm font-medium text-white/50 w-full h-full flex items-center justify-center bg-white/10 rounded-full border border-white/10">{(c.name?.charAt(0) || '?').toUpperCase()}</div>}
                       </div>
                    ) : (
                      c.avatar_url ? <img src={c.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-sm font-medium text-white/50">{(c.name.charAt(0) || '?').toUpperCase()}</div>
                    )}
                 </div>
                 <div className="flex-1 text-left overflow-hidden">
                   <p className={cn("truncate text-sm", isUnread ? "font-extrabold text-white" : "font-bold text-white/90")}>{c.name}</p>
                   {c.lastMessage && <p className={cn("text-xs truncate mt-1", isUnread ? "text-white font-semibold" : "text-white/40")}>{c.lastMessage.sender_id === currentUserId ? 'You: ' : ''}{c.lastMessage.content || (c.lastMessage.media_type === 'image' ? 'Sent a photo' : c.lastMessage.media_type === 'audio' ? 'Sent a voice message' : 'Shared location')}</p>}
                 </div>
                 <div className="flex flex-col items-end gap-1">
                   {c.lastMessage && <div className="shrink-0 text-[10px] text-white/30">{new Date(c.lastMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div>}
                   {isUnread ? <div className="w-2.5 h-2.5 bg-white rounded-full" /> : null}
                 </div>
              </motion.button>
              );
          })}
        </div>
      </div>

      <AnimatePresence>
        {activeChat && (
          <ChatRoom 
            currentUserId={currentUserId} 
            activeChat={activeChat} 
            onClose={() => { 
                markChatAsSeenOptimistically(activeChat.id);
                setActiveChat(null); 
                onCloseChat?.(); 
            }} 
            onOpenProfile={(id) => window.dispatchEvent(new CustomEvent('openProfile', { detail: { userId: id, forcePopup: true } }))}
            openSettings={() => setIsGroupSettingsOpen(true)}
          />
        )}
      </AnimatePresence>

      {isCreatingGroup && (
        <CreateGroupModal 
          currentUserId={currentUserId}
          connections={chats}
          onClose={() => setIsCreatingGroup(false)}
          onGroupCreated={(chat) => {
             updateChatList(prev => [chat, ...prev]);
             setIsCreatingGroup(false);
             setActiveChat(chat);
          }}
        />
      )}

      <AnimatePresence>
      {isGroupSettingsOpen && activeChat?.isGroup && (
        <GroupChatSettings
          currentUserId={currentUserId}
          activeChat={activeChat}
          onClose={() => setIsGroupSettingsOpen(false)}
          onUpdate={(updatedChat) => {
            setActiveChat(updatedChat);
            updateChatList(prev => prev.map(c => c.id === updatedChat.id ? updatedChat : c));
          }}
          onLeave={() => {
            setIsGroupSettingsOpen(false);
            setActiveChat(null);
            updateChatList(prev => prev.filter(c => c.id !== activeChat.id));
          }}
        />
      )}
      </AnimatePresence>
    </div>
  );
}
