import React from 'react';
import { Profile } from '@/src/types';
import { cn } from '@/src/lib/utils';

interface ChatListProps {
  connections: (Profile & { lastMessage?: any, unreadCount?: number })[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onChatSelect: (profile: Profile) => void;
}

export const ChatList = ({ connections, searchQuery, onSearchChange, onChatSelect }: ChatListProps) => {
  const filteredConnections = connections.filter(c => (c.full_name || c.username)?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex-1 flex flex-col h-full bg-black overflow-hidden relative">
      <div className="p-4 pt-safe shrink-0">
        <h1 className="text-2xl font-black mb-4">Messages</h1>
        <div className="relative group">
          <input 
            type="text" 
            placeholder="Search connections..." 
            value={searchQuery} 
            onChange={(e) => onSearchChange(e.target.value)} 
            className="w-full bg-white/10 border border-white/5 rounded-2xl px-5 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/20 transition-all placeholder:text-white/20" 
          />
          {searchQuery && <button onClick={() => onSearchChange('')} className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-white/40"><div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center">×</div></button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-20 no-scrollbar">
        {filteredConnections.length > 0 ? (
          <div className="space-y-1">
            {filteredConnections.map((profile) => (
              <div 
                key={profile.id} 
                onClick={() => onChatSelect(profile)} 
                className="flex items-center gap-4 p-4 rounded-2xl active:bg-white/5 active:scale-[0.98] transition-all cursor-pointer border border-transparent active:border-white/5"
              >
                <div className="relative shrink-0">
                  <div className="w-14 h-14 rounded-full overflow-hidden bg-white/10 border border-white/10">
                    {profile.avatar_url ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-lg font-bold text-white/30">{(profile.username?.charAt(0) || '?').toUpperCase()}</div>}
                  </div>
                  {profile.unreadCount && profile.unreadCount > 0 ? (
                    <div className="absolute -top-1 -right-1 min-w-6 h-6 bg-white text-black text-[11px] font-black rounded-full flex items-center justify-center border-2 border-black px-1.5 shadow-xl">{profile.unreadCount}</div>
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white/90 truncate">{profile.full_name || profile.username}</span>
                    <span className="text-[10px] text-white/30 uppercase tracking-wider font-bold shrink-0">
                      {profile.lastMessage ? new Date(profile.lastMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("text-sm truncate", (profile.unreadCount || 0) > 0 ? "text-white font-semibold" : "text-white/40")}>
                      {profile.lastMessage ? (profile.lastMessage.sender_id !== profile.id ? 'You: ' : '') + (profile.lastMessage.media_type ? `Sent an ${profile.lastMessage.media_type}` : profile.lastMessage.content) : 'Start a conversation'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-32 space-y-4 px-12 text-center">
            <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center text-white/10 mb-2 italic font-serif text-4xl">?</div>
            <p className="text-white/40 font-medium text-sm leading-relaxed">No active conversations found. Connect with more people to start chatting.</p>
          </div>
        )}
      </div>
    </div>
  );
};
