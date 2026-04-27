import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Profile } from '@/src/types';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowUp, Plus, Camera, Image as ImageIcon, Mic, MapPin, X } from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface ChatProps {
  currentUserId: string;
  initialActiveChat?: Profile | null;
  onCloseChat?: () => void;
}

export default function Chat({ currentUserId, initialActiveChat, onCloseChat }: ChatProps) {
  const [connections, setConnections] = useState<(Profile & { lastMessage?: any, unreadCount?: number })[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChat, setActiveChat] = useState<Profile | null>(initialActiveChat || null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showFeatures, setShowFeatures] = useState(false);
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<any>(null);

  useEffect(() => {
    if (initialActiveChat) {
      setActiveChat(initialActiveChat);
    }
  }, [initialActiveChat]);

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
        let msgs = null;
        let count = 0;
        try {
          const { data } = await supabase
            .from('messages')
            .select('*')
            .or(`sender_id.eq.${prof.id},receiver_id.eq.${prof.id}`)
            .order('created_at', { ascending: false })
            .limit(1);
          msgs = data;
            
          const { count: c } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('sender_id', prof.id)
            .eq('receiver_id', currentUserId)
            .is('read_at', null);
            
          count = c || 0;
        } catch (e) {
          console.error("Error fetching message metadata for", prof.id, e);
        }

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
      .or(`sender_id.eq.${otherUserId},receiver_id.eq.${otherUserId}`)
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

  const uploadToCloudinary = async (file: File | Blob, type: 'image' | 'video' | 'audio' | 'auto') => {
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
       alert('Cloudinary is not configured. Please add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET to your environment variables.');
       throw new Error('Cloudinary config missing');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    if (type === 'image') {
      // Add optimization parameters for images
      formData.append('folder', 'chat_images');
    } else if (type === 'video') {
      formData.append('folder', 'chat_audio'); 
    }
    
    // Use resource_type='auto' instead of image/video
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${type}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();

    // Generate optimized URL
    let optimizedUrl = data.secure_url;
    if (type === 'image') {
       // Insert q_auto,f_auto
       const urlParts = optimizedUrl.split('/upload/');
       optimizedUrl = `${urlParts[0]}/upload/q_auto,f_auto,w_800/${urlParts[1]}`;
    }
    return optimizedUrl;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        handleMediaMessage(audioBlob, 'audio');
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (e) {
      console.error('Error starting recording:', e);
      alert('Could not access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(recordingIntervalRef.current);
    }
  };

  const handleLocationShare = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setUploadingMedia(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const loc = `${position.coords.latitude},${position.coords.longitude}`;
        await sendSpecialMessage(null, 'location', loc);
        setUploadingMedia(false);
      },
      (error) => {
        console.error('Error getting location', error);
        alert('Could not get actual location');
        setUploadingMedia(false);
      }
    );
  };

  const handleMediaMessage = async (file: File | Blob, type: 'image' | 'audio') => {
    setUploadingMedia(true);
    setShowFeatures(false);
    try {
      const uploadType = type === 'audio' ? 'video' : 'image'; // Cloudinary treats audio as video resource type
      const url = await uploadToCloudinary(file, uploadType);
      await sendSpecialMessage(url, type);
    } catch (e) {
      console.error(e);
      alert('Failed to upload media. Please try again.');
    } finally {
      setUploadingMedia(false);
    }
  };

  const sendSpecialMessage = async (mediaUrl: string | null, mediaType: 'image' | 'audio' | 'location', contentStr: string = '') => {
    if (!activeChat) return;

    const tempMessage = {
      id: crypto.randomUUID(),
      sender_id: currentUserId,
      receiver_id: activeChat.id,
      content: contentStr,
      media_url: mediaUrl,
      media_type: mediaType,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempMessage]);
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
        content: contentStr,
        media_url: mediaUrl,
        media_type: mediaType
      }).select().single();
      
      if (error) throw error;
      setMessages(prev => prev.map(m => m.id === tempMessage.id ? data : m));
    } catch (e: any) {
      console.error('Error sending media message:', e.message);
      if (e.message.includes('media_url') || e.message.includes('media_type')) {
         alert('Please update your Supabase schema! Run the SCHEMA.sql script to add media_url and media_type to the messages table.');
      }
      setMessages(prev => prev.filter(m => m.id !== tempMessage.id));
    }
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
      if (e.message.includes('media_url') || e.message.includes('media_type') || e.code === 'PGRST204') {
         alert('Please update your Supabase schema using the SCHEMA.sql script to enable media messages.');
      }
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
               <div className="relative">
                 <input 
                   type="text" 
                   placeholder="Search connections..." 
                   value={searchQuery}
                   onChange={e => setSearchQuery(e.target.value)}
                   className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/40 rounded-xl px-4 py-3 focus:outline-none focus:border-white/30 text-sm transition-all"
                 />
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
                            {new Date(c.lastMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
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
            className="flex-1 flex flex-col h-[100dvh] fixed inset-0 z-[100] w-full max-w-lg mx-auto bg-black border-x border-white/5"
          >
            {/* Header */}
            <div className="p-4 pt-safe flex items-center gap-4 border-b border-white/10 glass shrink-0">
               <button onClick={() => { setActiveChat(null); onCloseChat?.(); }} className="p-2 -ml-2 text-white/80 shrink-0 active:scale-95 transition-transform">
                 <ArrowLeft size={24} />
               </button>
               <div 
                 className="flex items-center gap-3 w-full cursor-pointer group"
                 onClick={() => {
                   window.dispatchEvent(new CustomEvent('openProfile', { detail: { userId: activeChat.id } }));
                   onCloseChat?.();
                 }}
               >
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0 group-active:scale-95 transition-transform">
                    {activeChat.avatar_url ? (
                      <img src={activeChat.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                       <div className="w-full h-full flex items-center justify-center text-xs font-medium text-white/50">{activeChat.username?.charAt(0).toUpperCase()}</div>
                    )}
                  </div>
                  <div className="flex flex-col group-active:opacity-70 transition-opacity">
                     <span className="font-bold text-sm text-white/90 leading-tight">{activeChat.full_name || activeChat.username}</span>
                  </div>
               </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
               {messages.map((msg, i) => {
                 const isMine = msg.sender_id === currentUserId;
                 const nextMsg = messages[i + 1];
                 const prevMsg = messages[i - 1];
                 const isConsecutive = nextMsg && nextMsg.sender_id === msg.sender_id;
                 const isPrevConsecutive = prevMsg && prevMsg.sender_id === msg.sender_id;
                 const showAvatar = !isMine && !isConsecutive;

                 let roundedClass = 'rounded-2xl';
                 if (isMine) {
                   if (isConsecutive && isPrevConsecutive) roundedClass = 'rounded-2xl rounded-tr-sm rounded-br-sm';
                   else if (isConsecutive) roundedClass = 'rounded-2xl rounded-br-sm';
                   else if (isPrevConsecutive) roundedClass = 'rounded-2xl rounded-tr-sm text-sm mb-2';
                   else roundedClass = 'rounded-2xl rounded-br-sm mb-2';
                 } else {
                   if (isConsecutive && isPrevConsecutive) roundedClass = 'rounded-2xl rounded-tl-sm rounded-bl-sm ml-8';
                   else if (isConsecutive) roundedClass = 'rounded-2xl rounded-bl-sm ml-8';
                   else if (isPrevConsecutive) roundedClass = 'rounded-2xl rounded-tl-sm mb-2 ml-8';
                   else roundedClass = 'rounded-2xl rounded-bl-sm mb-2 ml-0'; // With avatar
                 }

                 return (
                   <div key={msg.id} className={cn("flex w-full gap-2", isMine ? "justify-end" : "justify-start")}>
                      {!isMine && !isConsecutive && (
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
                        "max-w-[75%] min-w-[2rem] text-sm leading-relaxed whitespace-pre-wrap break-words overflow-hidden",
                        roundedClass,
                        isMine ? "bg-white text-black" : "bg-white/15 text-white",
                        (msg.media_type === 'image' || msg.media_type === 'location') && "p-1 pb-2", // less padding for images
                        !msg.media_type && "px-4 py-2.5"
                      )}>
                        {msg.media_type === 'image' && msg.media_url && (
                          <img src={msg.media_url} alt="Photo" className="w-full h-auto max-h-[300px] object-cover rounded-[14px] mb-1" />
                        )}
                        {msg.media_type === 'audio' && msg.media_url && (
                          <div className="px-4 py-3 flex items-center gap-3">
                            <audio src={msg.media_url} controls className={cn("h-8 w-[200px]", isMine && "brightness-[0] invert")} />
                          </div>
                        )}
                        {msg.media_type === 'location' && msg.content && (
                           <div className="w-full aspect-square bg-white/5 rounded-[14px] mb-1 overflow-hidden relative">
                             <img src={`https://static-maps.yandex.ru/1.x/?ll=${msg.content.split(',')[1]},${msg.content.split(',')[0]}&z=14&l=map&size=300,300&pt=${msg.content.split(',')[1]},${msg.content.split(',')[0]},pm2rdm`} alt="Location" className="w-full h-full object-cover" />
                           </div>
                        )}
                        {msg.content && msg.media_type !== 'location' && (
                          <div className={msg.media_type === 'image' || msg.media_type === 'audio' ? "px-2" : ""}>
                            {msg.content}
                          </div>
                        )}
                      </div>
                   </div>
                 );
               })}
               <div ref={messagesEndRef} className="h-2" />
            </div>

            {/* Input Area */}
            <form onSubmit={handleSendMessage} className="p-4 pb-safe border-t border-white/10 bg-black/90 glass shrink-0 relative z-10 transition-all">
               <div className="flex items-end gap-3 relative z-20">
                 <button 
                   type="button"
                   onClick={() => setShowFeatures(!showFeatures)}
                   className="w-10 h-10 shrink-0 bg-white/10 rounded-full flex flex-wrap gap-0.5 p-2 items-center justify-center active:scale-90 transition-transform"
                 >
                   {showFeatures ? (
                     <X size={20} className="text-white absolute" />
                   ) : (
                     <>
                       <span className="w-1.5 h-1.5 bg-white/60 rounded-full" />
                       <span className="w-1.5 h-1.5 bg-white/60 rounded-full" />
                       <span className="w-1.5 h-1.5 bg-white/60 rounded-full" />
                       <span className="w-1.5 h-1.5 bg-white/60 rounded-full" />
                     </>
                   )}
                 </button>
                 <div className="relative flex-1">
                   <textarea 
                     placeholder="Message..." 
                     value={newMessage}
                     onChange={e => setNewMessage(e.target.value)}
                     onKeyDown={e => {
                       if (e.key === 'Enter' && !e.shiftKey) {
                         e.preventDefault();
                         handleSendMessage(e);
                       }
                     }}
                     className="w-full bg-white/10 border border-white/10 text-white placeholder:text-white/40 rounded-[20px] px-4 py-2.5 pr-12 focus:outline-none focus:border-white/30 text-sm transition-all resize-none min-h-[40px] max-h-[120px]"
                     rows={1}
                     style={{ height: newMessage ? 'auto' : '40px' }}
                   />
                   <button 
                     type="submit"
                     disabled={!newMessage.trim()}
                     className="absolute right-1 bottom-1 w-8 h-8 bg-white text-black rounded-full flex items-center justify-center disabled:opacity-50 active:scale-95 transition-all"
                   >
                     <ArrowUp size={18} strokeWidth={2.5} className="mt-0.5" />
                   </button>
                 </div>
               </div>

               <AnimatePresence>
                 {showFeatures && (
                   <motion.div 
                     initial={{ height: 0, opacity: 0 }}
                     animate={{ height: 'auto', opacity: 1 }}
                     exit={{ height: 0, opacity: 0 }}
                     className="overflow-hidden mt-4"
                   >
                     <div className="grid grid-cols-4 gap-4 px-2 pb-2">
                       <button type="button" className="flex flex-col items-center gap-2 active:scale-95 transition-transform" onClick={() => cameraInputRef.current?.click()} disabled={uploadingMedia}>
                         <div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/80">
                           <Camera size={22} />
                         </div>
                         <span className="text-[10px] font-medium text-white/50">Camera</span>
                       </button>
                       <button type="button" className="flex flex-col items-center gap-2 active:scale-95 transition-transform" onClick={() => fileInputRef.current?.click()} disabled={uploadingMedia}>
                         <div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/80">
                           <ImageIcon size={22} />
                         </div>
                         <span className="text-[10px] font-medium text-white/50">Photos</span>
                       </button>
                       <button 
                         type="button" 
                         className={cn("flex flex-col items-center gap-2 active:scale-95 transition-transform", isRecording && "opacity-100")} 
                         onClick={isRecording ? stopRecording : startRecording} 
                         disabled={uploadingMedia}
                       >
                         <div className={cn("w-12 h-12 rounded-full border flex items-center justify-center text-white/80 transition-colors", isRecording ? "bg-red-500/20 border-red-500/50 text-red-500" : "bg-white/10 border-white/10")}>
                           {isRecording ? <div className="w-4 h-4 bg-red-500 rounded-sm" /> : <Mic size={22} />}
                         </div>
                         <span className={cn("text-[10px] font-medium transition-colors", isRecording ? "text-red-500" : "text-white/50")}>
                           {isRecording ? `0:${recordingDuration.toString().padStart(2, '0')}` : 'Audio'}
                         </span>
                       </button>
                       <button type="button" className="flex flex-col items-center gap-2 active:scale-95 transition-transform" onClick={handleLocationShare} disabled={uploadingMedia}>
                         <div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/80">
                           <MapPin size={22} />
                         </div>
                         <span className="text-[10px] font-medium text-white/50">Location</span>
                       </button>
                     </div>
                   </motion.div>
                 )}
               </AnimatePresence>

               {uploadingMedia && (
                 <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm z-50">
                    <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                 </div>
               )}

               <input 
                 type="file" 
                 ref={fileInputRef} 
                 accept="image/png, image/jpeg, image/webp" 
                 className="hidden" 
                 onChange={(e) => {
                   const file = e.target.files?.[0];
                   if (file) handleMediaMessage(file, 'image');
                   if (e.target) e.target.value = '';
                 }} 
               />
               <input 
                 type="file" 
                 ref={cameraInputRef} 
                 accept="image/*" 
                 capture="environment" 
                 className="hidden" 
                 onChange={(e) => {
                   const file = e.target.files?.[0];
                   if (file) handleMediaMessage(file, 'image');
                   if (e.target) e.target.value = '';
                 }} 
               />
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
