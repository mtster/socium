import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Profile } from '@/src/types';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Send } from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface ChatProps {
  currentUserId: string;
}

export default function Chat({ currentUserId }: ChatProps) {
  const [connections, setConnections] = useState<(Profile & { lastMessage?: any, unreadCount?: number })[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChat, setActiveChat] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConnectionsAndRecentMessages();
  }, [currentUserId]);

  useEffect(() => {
    if (activeChat) {
      fetchMessages(activeChat.id);
      
      const channel = supabase
        .channel(`chat_${activeChat.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `sender_id=eq.${activeChat.id}`,
          },
          (payload) => {
            if (payload.new.receiver_id === currentUserId) {
              setMessages((prev) => [...prev, payload.new]);
              markMessagesAsRead(activeChat.id);
              scrollToBottom();
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [activeChat]);

  // Subscribe to all incoming messages for the list updates
  useEffect(() => {
    const mainChannel = supabase
      .channel('public_messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${currentUserId}`,
        },
        (payload) => {
           fetchConnectionsAndRecentMessages(); // Refresh list to get latest unread/last messages
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(mainChannel);
    };
  }, [currentUserId]);

  const fetchConnectionsAndRecentMessages = async () => {
    try {
      // 1. Get connections
      const { data: rel1 } = await supabase.from('connections').select('*, profiles!connections_receiver_id_fkey(*)').eq('requester_id', currentUserId).eq('status', 'accepted');
      const { data: rel2 } = await supabase.from('connections').select('*, profiles!connections_requester_id_fkey(*)').eq('receiver_id', currentUserId).eq('status', 'accepted');
      
      const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
      const { data: adminProf } = await supabase.from('profiles').select('*').eq('id', ADMIN_ID).maybeSingle();

      const combinedProfs = [
        ...(rel1?.map(c => c.profiles) || []),
        ...(rel2?.map(c => c.profiles) || [])
      ].filter(Boolean) as Profile[];

      if (adminProf && !combinedProfs.some(c => c.id === ADMIN_ID) && currentUserId !== ADMIN_ID) {
         combinedProfs.push(adminProf);
      }

      const deduplicated = Array.from(new Map(combinedProfs.map(item => [item.id, item])).values());

      // 2. Get last messages and unread counts for each connection
      const connectionsWithMessages = await Promise.all(deduplicated.map(async (prof) => {
        const { data: msgs } = await supabase
          .from('messages')
          .select('*')
          .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${prof.id}),and(sender_id.eq.${prof.id},receiver_id.eq.${currentUserId})`)
          .order('created_at', { ascending: false })
          .limit(1);
          
        const { count, error } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('sender_id', prof.id)
          .eq('receiver_id', currentUserId)
          .is('read_at', null);

        return {
          ...prof,
          lastMessage: msgs?.[0] || null,
          unreadCount: count || 0
        };
      }));

      // Sort by last message created_at desc
      connectionsWithMessages.sort((a, b) => {
        if (!a.lastMessage && !b.lastMessage) return 0;
        if (!a.lastMessage) return 1;
        if (!b.lastMessage) return -1;
        return new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime();
      });

      setConnections(connectionsWithMessages);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (otherUserId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUserId})`)
      .order('created_at', { ascending: true });
    
    if (data) {
      setMessages(data);
      scrollToBottom();
      markMessagesAsRead(otherUserId);
    }
  };

  const markMessagesAsRead = async (senderId: string) => {
    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('sender_id', senderId)
      .eq('receiver_id', currentUserId)
      .is('read_at', null);
      
    // Update local state for unread count
    setConnections(prev => prev.map(c => c.id === senderId ? { ...c, unreadCount: 0 } : c));
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeChat) return;

    const tempMessage = {
      id: crypto.randomUUID(),
      sender_id: currentUserId,
      receiver_id: activeChat.id,
      content: newMessage.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages([...messages, tempMessage]);
    setNewMessage('');
    scrollToBottom();

    // Also optimistically update the list
    setConnections(prev => {
        const idx = prev.findIndex(c => c.id === activeChat.id);
        if (idx !== -1) {
            const newList = [...prev];
            newList[idx].lastMessage = tempMessage;
            return newList.sort((a, b) => new Date(b.lastMessage?.created_at || 0).getTime() - new Date(a.lastMessage?.created_at || 0).getTime());
        }
        return prev;
    });

    try {
      const { data, error } = await supabase.from('messages').insert({
        sender_id: currentUserId,
        receiver_id: activeChat.id,
        content: tempMessage.content
      }).select().single();
      
      if (error) throw error;
      
      setMessages(prev => prev.map(m => m.id === tempMessage.id ? data : m));
    } catch (e: any) {
      console.error('Error sending message:', e.message);
      // Rollback optimistic update
      setMessages(prev => prev.filter(m => m.id !== tempMessage.id));
    }
  };

  const filteredConnections = connections.filter(c => 
    (c.full_name || c.username)?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-black">
      <AnimatePresence initial={false}>
        {!activeChat ? (
          <motion.div
            key="chat-list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 flex flex-col h-full"
          >
            <div className="p-4 pt-safe border-b border-white/10 shrink-0">
               <h1 className="text-2xl font-bold tracking-tight mb-4 text-white">Messages</h1>
               <div className="relative">
                 <input 
                   type="text" 
                   placeholder="Search connections..." 
                   value={searchQuery}
                   onChange={e => setSearchQuery(e.target.value)}
                   className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/40 rounded-xl px-4 py-3 focus:outline-none focus:border-white/30 text-sm transition-all"
                 />
                 {searchQuery && (
                   <button 
                     onClick={() => setSearchQuery('')}
                     className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white mt-0.5"
                   >
                     <Send size={16} className="rotate-45" />
                   </button>
                 )}
               </div>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {!loading && filteredConnections.length === 0 ? (
                <div className="p-8 text-center text-white/40">
                  <p>No connections found</p>
                </div>
              ) : (
                filteredConnections.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setActiveChat(c)}
                    className="w-full flex items-center p-4 border-b border-white/5 active:bg-white/5 transition-colors gap-4"
                  >
                     <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0 relative">
                        {c.avatar_url ? (
                          <img src={c.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                           <div className="w-full h-full flex items-center justify-center text-sm font-medium text-white/50">{c.username?.charAt(0).toUpperCase()}</div>
                        )}
                        {c.unreadCount ? (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-white text-black text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-black">
                                {c.unreadCount}
                            </div>
                        ) : null}
                     </div>
                     <div className="flex-1 text-left overflow-hidden">
                       <p className="font-bold text-white/90 truncate">{c.full_name || c.username}</p>
                       {c.lastMessage && (
                           <p className={cn("text-sm truncate mt-0.5", c.unreadCount ? "text-white font-medium" : "text-white/40")}>
                               {c.lastMessage.sender_id === currentUserId ? 'You: ' : ''}{c.lastMessage.content}
                           </p>
                       )}
                     </div>
                     {c.lastMessage && (
                        <div className="shrink-0 text-[10px] text-white/30">
                            {new Date(c.lastMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                     )}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="chat-room"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex-1 flex flex-col h-full absolute inset-0 z-[60] bg-black"
          >
            {/* Header */}
            <div className="p-4 pt-safe flex items-center gap-4 border-b border-white/10 glass shrink-0">
               <button onClick={() => setActiveChat(null)} className="p-2 -ml-2 text-white/80 shrink-0 active:scale-95 transition-transform">
                 <ArrowLeft size={24} />
               </button>
               <div className="flex items-center gap-3 w-full">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0">
                    {activeChat.avatar_url ? (
                      <img src={activeChat.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                       <div className="w-full h-full flex items-center justify-center text-xs font-medium text-white/50">{activeChat.username?.charAt(0).toUpperCase()}</div>
                    )}
                  </div>
                  <div className="flex flex-col">
                     <span className="font-bold text-sm text-white/90 leading-tight">{activeChat.full_name || activeChat.username}</span>
                  </div>
               </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
               {messages.map((msg, i) => {
                 const isMine = msg.sender_id === currentUserId;
                 const showAvatar = !isMine && (i === messages.length - 1 || messages[i + 1].sender_id === currentUserId);
                 return (
                   <div key={msg.id} className={cn("flex w-full gap-2", isMine ? "justify-end" : "justify-start")}>
                      {!isMine && (
                          <div className="w-6 h-6 shrink-0 mt-auto">
                              {showAvatar && (
                                <div className="w-full h-full rounded-full overflow-hidden bg-white/10 border border-white/10">
                                  {activeChat.avatar_url ? (
                                    <img src={activeChat.avatar_url} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                     <div className="w-full h-full flex items-center justify-center text-[10px] font-medium text-white/50">{activeChat.username?.charAt(0).toUpperCase()}</div>
                                  )}
                                </div>
                              )}
                          </div>
                      )}
                      
                      <div className={cn(
                        "max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                        isMine ? "bg-white text-black rounded-br-sm" : "bg-white/10 text-white rounded-bl-sm"
                      )}>
                        {msg.content}
                      </div>
                   </div>
                 );
               })}
               <div ref={messagesEndRef} className="h-2" />
            </div>

            {/* Input Area */}
            <form onSubmit={handleSendMessage} className="p-4 pb-safe border-t border-white/10 bg-black/90 glass shrink-0">
               <div className="relative flex items-center gap-2">
                 <input 
                   type="text" 
                   placeholder="Message..." 
                   value={newMessage}
                   onChange={e => setNewMessage(e.target.value)}
                   className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/40 rounded-full px-5 py-3.5 pr-14 focus:outline-none focus:border-white/30 text-sm transition-all"
                 />
                 <button 
                   type="submit"
                   disabled={!newMessage.trim()}
                   className="absolute right-1.5 w-10 h-10 bg-white text-black rounded-full flex items-center justify-center disabled:opacity-50 active:scale-95 transition-all"
                 >
                   <Send size={18} className="translate-x-0.5" />
                 </button>
               </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
