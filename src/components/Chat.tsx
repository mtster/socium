import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Profile } from '@/src/types';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowUp, Plus, Camera, Image as ImageIcon, Mic, MapPin, X, Download, Copy, Trash2, MoreHorizontal, Play, Pause, SendHorizonal } from 'lucide-react';

import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

const Linkify = ({ text }: { text: string }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return (
    <>
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">{part}</a>;
        }
        return part;
      })}
    </>
  );
};

const AudioPlayer = ({ src, isMine }: { src: string, isMine: boolean }) => {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.preload = 'metadata';

    const setAudioData = () => {
      // Sometimes Infinity for blob, but audio element will figure it out when played
      if (audio.duration !== Infinity) setDuration(audio.duration);
    };
    
    const setAudioTime = () => {
      setProgress((audio.currentTime / audio.duration) * 100 || 0);
    };
    
    const onEnd = () => {
      setPlaying(false);
      setProgress(100);
    };

    audio.addEventListener('loadedmetadata', setAudioData);
    audio.addEventListener('timeupdate', setAudioTime);
    audio.addEventListener('ended', onEnd);
    
    // Fallback for blobs that misreport duration
    audio.addEventListener('durationchange', () => {
      if (audio.duration !== Infinity) setDuration(audio.duration);
    });

    return () => {
      audio.removeEventListener('loadedmetadata', setAudioData);
      audio.removeEventListener('timeupdate', setAudioTime);
      audio.removeEventListener('ended', onEnd);
      audio.pause();
    };
  }, [src]);

  const toggle = async () => {
    if (!audioRef.current) return;
    
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      // iOS Silent Switch Bypass Hack
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
           const ctx = new AudioContext();
           const buffer = ctx.createBuffer(1, 1, 22050);
           const source = ctx.createBufferSource();
           source.buffer = buffer;
           source.connect(ctx.destination);
           source.start(0);
           if (ctx.state === 'suspended') await ctx.resume();
           setTimeout(() => ctx.close(), 1000);
        }
      } catch (e) {
        console.error("Silent bypass error", e);
      }

      if (progress >= 100) {
        audioRef.current.currentTime = 0;
      }
      audioRef.current.play().catch(e => console.error("Play error", e));
      setPlaying(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - bounds.left;
    const percentage = x / bounds.width;
    const newTime = percentage * audioRef.current.duration;
    if (!isNaN(newTime) && isFinite(newTime)) {
      audioRef.current.currentTime = newTime;
      setProgress(percentage * 100);
    }
  };

  return (
    <div className={cn(
      "flex items-center gap-3 px-3 py-2 rounded-[24px] min-w-[180px] backdrop-blur-md transition-all duration-300",
      isMine ? "bg-white text-black" : "bg-white/20 text-white"
    )}>
      <button 
        onClick={toggle}
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center transition-transform active:scale-90",
          isMine ? "bg-black/10" : "bg-white/10"
        )}
      >
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="flex-1 h-3 bg-current/10 rounded-full overflow-hidden cursor-pointer flex items-center relative" onClick={handleSeek}>
        <div className="w-full h-1 bg-current/20 rounded-full absolute pointer-events-none" />
        <motion.div 
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.1 }}
          className="h-1 bg-current relative z-10 pointer-events-none" 
        />
      </div>
      <span className="text-[10px] font-medium opacity-50 w-8">
        {duration > 0 ? `${Math.floor(duration)}s` : '...'}
      </span>
    </div>
  );
};
import { cn } from '@/src/lib/utils';

interface ChatProps {
  currentUserId: string;
  initialActiveChat?: Profile | null;
  onCloseChat?: () => void;
}

let chatConnectionsCache: any[] | null = null;
let lastChatListFetch = 0;
let chatMessagesCache: Record<string, any[]> = {};
let lastChatMessagesFetch: Record<string, number> = {};

export default function Chat({ currentUserId, initialActiveChat, onCloseChat }: ChatProps) {
  const [connections, setConnections] = useState<(Profile & { lastMessage?: any, unreadCount?: number })[]>(chatConnectionsCache || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChat, setActiveChat] = useState<Profile | null>(initialActiveChat || null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(!chatConnectionsCache);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [showFeatures, setShowFeatures] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{file: File | Blob | null, type: 'image' | 'audio' | 'location', dataUrl?: string, locationString?: string} | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, message: any } | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<any>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<any>(null);

  const handleDeleteMessage = async () => {
    if (!contextMenu?.message) return;
    const msgId = contextMenu.message.id;
    setContextMenu(null);
    setMessages(prev => prev.filter(m => m.id !== msgId));
    try {
      await supabase.from('messages').delete().eq('id', msgId);
    } catch (e) {
      console.error('Failed to delete message', e);
    }
  };

  useEffect(() => {
    if (initialActiveChat) {
      setActiveChat(initialActiveChat);
    }
  }, [initialActiveChat]);

  useEffect(() => {
    if (!chatConnectionsCache || Date.now() - lastChatListFetch > 60000) {
      fetchConnectionsAndRecentMessages();
    }
  }, [currentUserId]);

  useEffect(() => {
    if (activeChat) {
      (window as any).currentChatUserId = activeChat.id;
      
      const cached = chatMessagesCache[activeChat.id];
      if (cached && (Date.now() - (lastChatMessagesFetch[activeChat.id] || 0) < 60000)) {
         setMessages(cached);
         setHasMoreMessages(cached.length >= 20);
         scrollToBottom(false);
         markMessagesAsRead(activeChat.id);
      } else {
         fetchMessages(activeChat.id);
      }
      
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
              setMessages((prev) => {
                const newMsgs = [...prev, payload.new];
                chatMessagesCache[activeChat.id] = newMsgs;
                return newMsgs;
              });
              markMessagesAsRead(activeChat.id);
              scrollToBottom();
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
        (window as any).currentChatUserId = null;
      };
    } else {
      (window as any).currentChatUserId = null;
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

      connectionsWithMessages.sort((a, b) => {
        if (!a.lastMessage && !b.lastMessage) return 0;
        if (!a.lastMessage) return 1;
        if (!b.lastMessage) return -1;
        return new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime();
      });

      chatConnectionsCache = connectionsWithMessages;
      lastChatListFetch = Date.now();
      setConnections(connectionsWithMessages);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (otherUserId: string, loadOld = false) => {
    if (loadOld) setLoadingMessages(true);
    const limit = loadOld ? 10 : 20;
    const offset = loadOld ? 20 + ((page - 1) * 10) : 0;
    
    // We fetch in descending order to get the latest messages first, then reverse them
    const { data } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_id.eq.${otherUserId},receiver_id.eq.${otherUserId}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (data) {
      const orderedData = data.reverse();
      if (loadOld) {
        setMessages(prev => {
          const newMsgs = [...orderedData, ...prev];
          chatMessagesCache[otherUserId] = newMsgs;
          return newMsgs;
        });
        setPage(p => p + 1);
        setHasMoreMessages(data.length === limit);
      } else {
        setMessages(orderedData);
        chatMessagesCache[otherUserId] = orderedData;
        lastChatMessagesFetch[otherUserId] = Date.now();
        scrollToBottom(false);
        markMessagesAsRead(otherUserId);
        setPage(1);
        setHasMoreMessages(data.length === limit);
      }
    }
    if (loadOld) setLoadingMessages(false);
  };

  const markMessagesAsRead = async (senderId: string) => {
    // Optimistically update local connection unread count
    setConnections(prev => prev.map(c => c.id === senderId ? { ...c, unreadCount: 0 } : c));
    window.dispatchEvent(new CustomEvent('forceGetUnread'));

    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('sender_id', senderId)
      .eq('receiver_id', currentUserId)
      .is('read_at', null);
  };

  const scrollToBottom = (smooth = true) => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    }, 100);
  };

  const uploadToCloudinary = async (file: File | Blob, type: 'image' | 'video' | 'audio' | 'auto') => {
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
       alert('Cloudinary is not configured.');
       throw new Error('Cloudinary config missing');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    if (type === 'image') formData.append('folder', 'chat_images');
    else if (type === 'video') formData.append('folder', 'chat_audio'); 
    
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${type}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();

    let optimizedUrl = data.secure_url;
    if (type === 'image') {
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
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/mp4' });
        const dataUrl = URL.createObjectURL(audioBlob);
        setPendingMedia({ file: audioBlob, type: 'audio', dataUrl });
        stream.getTracks().forEach(track => track.stop());
        setShowFeatures(false);
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
      (position) => {
        const locUrl = `https://www.google.com/maps/search/?api=1&query=${position.coords.latitude},${position.coords.longitude}`;
        setNewMessage(prev => prev + (prev.length > 0 ? ' ' : '') + locUrl);
        setShowFeatures(false);
        setUploadingMedia(false);
      },
      (error) => {
        console.error('Error getting location', error);
        alert('Could not get actual location. Please allow location access in your device settings.');
        setUploadingMedia(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleMediaMessage = async (file: File | Blob, type: 'image' | 'audio') => {
    setUploadingMedia(true);
    setShowFeatures(false);
    try {
      const uploadType = type === 'audio' ? 'video' : 'image';
      const url = await uploadToCloudinary(file, uploadType);
      await sendSpecialMessage(url, type);
    } catch (e) {
      console.error(e);
      alert('Failed to upload media.');
    } finally {
      setUploadingMedia(false);
    }
  };

  const saveToDevice = async (url: string, filename: string, mediaType?: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      
      const fileExt = mediaType === 'audio' ? 'webm' : 'jpg';
      const file = new File([blob], `${filename}.${fileExt}`, { type: blob.type });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename
        });
      } else {
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${filename}.${fileExt}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleLongPress = (e: React.MouseEvent | React.TouchEvent, msg: any) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    if (navigator.vibrate) navigator.vibrate(10);
    
    const elementId = `msg-inner-${msg.id}`;
    const element = document.getElementById(elementId);
    let x = clientX, y = clientY;
    if (element) {
      const rect = element.getBoundingClientRect();
      const isMineMsg = msg.sender_id === currentUserId;
      if (isMineMsg) {
        x = rect.left - 192 - 8;
        if (x < 10) x = 10;
      } else {
        x = rect.right + 8;
        if (x + 192 > window.innerWidth - 10) x = window.innerWidth - 192 - 10;
      }
      y = rect.top;
      if (y + 160 > window.innerHeight - 20) y = window.innerHeight - 160 - 20;
    } else {
       x = Math.min(clientX, window.innerWidth - 180);
       y = Math.min(clientY, window.innerHeight - 200);
    }
    
    setContextMenu({
      x,
      y,
      message: msg
    });
  };

  const onTouchStart = (e: React.TouchEvent, msg: any) => {
    if (longPressTimer) clearTimeout(longPressTimer);
    const timer = setTimeout(() => handleLongPress(e, msg), 500);
    setLongPressTimer(timer);
  };

  const onTouchMove = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  const onTouchEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
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

    setMessages(prev => {
        const newMsgs = [...prev, tempMessage];
        chatMessagesCache[activeChat.id] = newMsgs;
        return newMsgs;
    });
    scrollToBottom();

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

    const tempMsgs = [...messages, tempMessage];
    setMessages(tempMsgs);
    chatMessagesCache[activeChat.id] = tempMsgs;
    setNewMessage('');
    scrollToBottom();

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
      setMessages(prev => prev.filter(m => m.id !== tempMessage.id));
    }
  };

  const filteredConnections = connections.filter(c => 
    (c.full_name || c.username)?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-black overflow-hidden relative">
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
                <div className="p-8 text-center text-white/40 text-sm">No connections found</div>
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
                     </div>
                     <div className="flex-1 text-left overflow-hidden">
                       <p className="font-bold text-white/90 truncate text-sm">{c.full_name || c.username}</p>
                       {c.lastMessage && (
                           <p className={cn("text-xs truncate mt-1", c.unreadCount ? "text-white font-semibold" : "text-white/40")}>
                               {c.lastMessage.sender_id === currentUserId ? 'You: ' : ''}{c.lastMessage.content || (c.lastMessage.media_type === 'image' ? 'Sent a photo' : c.lastMessage.media_type === 'audio' ? 'Sent a voice message' : 'Shared location')}
                           </p>
                       )}
                     </div>
                     {c.lastMessage && (
                        <div className="shrink-0 text-[10px] text-white/30 font-sans">
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
            {/* Room Header */}
            <div className="p-4 pt-safe flex items-center gap-4 border-b border-white/10 bg-black/80 backdrop-blur-xl shrink-0">
               <button onClick={() => { setActiveChat(null); onCloseChat?.(); }} className="p-2 -ml-2 text-white/80 shrink-0 active:scale-90 transition-transform">
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
            <div 
              className="flex-1 overflow-y-auto p-4 space-y-1 relative"
              onScroll={(e) => {
                const target = e.target as HTMLDivElement;
                if (target.scrollTop <= 5 && hasMoreMessages && !loadingMessages && messages.length >= 20) {
                  if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    navigator.vibrate(50);
                  }
                  fetchMessages(activeChat.id, true);
                }
              }}
            >
               {loadingMessages && (
                 <div className="flex justify-center mb-4 transition-all">
                   <div className="bg-white/10 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center justify-center gap-2">
                     <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                     Loading...
                   </div>
                 </div>
               )}
               {messages.map((msg, i) => {
                 const isMine = msg.sender_id === currentUserId;
                 const nextMsg = messages[i + 1];
                 const prevMsg = messages[i - 1];
                 const isConsecutive = nextMsg && nextMsg.sender_id === msg.sender_id;
                 const isPrevConsecutive = prevMsg && prevMsg.sender_id === msg.sender_id;
                 const showAvatar = !isMine && !isConsecutive;

                 let roundedClass = 'rounded-[18px]';
                 let marginClass = 'mb-3';
                 if (isMine) {
                   if (isConsecutive && isPrevConsecutive) { roundedClass = 'rounded-[18px] rounded-tr-[4px] rounded-br-[4px]'; marginClass = 'mb-[2px]'; }
                   else if (isConsecutive) { roundedClass = 'rounded-[18px] rounded-br-[4px]'; marginClass = 'mb-[2px]'; }
                   else if (isPrevConsecutive) { roundedClass = 'rounded-[18px] rounded-tr-[4px]'; marginClass = 'mb-3'; }
                   else { roundedClass = 'rounded-[18px] rounded-br-[4px]'; marginClass = 'mb-3'; }
                 } else {
                   if (isConsecutive && isPrevConsecutive) { roundedClass = 'rounded-[18px] rounded-tl-[4px] rounded-bl-[4px]'; marginClass = 'mb-[2px]'; }
                   else if (isConsecutive) { roundedClass = 'rounded-[18px] rounded-bl-[4px]'; marginClass = 'mb-[2px]'; }
                   else if (isPrevConsecutive) { roundedClass = 'rounded-[18px] rounded-tl-[4px]'; marginClass = 'mb-3'; }
                   else { roundedClass = 'rounded-[18px] rounded-bl-[4px]'; marginClass = 'mb-3'; }
                 }
                 
                 let isLoc = msg.media_type === 'location';
                 let lat = '', lng = '';
                 const locMatch = msg.content?.match(/https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=([-0-9.]+),([-0-9.]+)/);
                 if (locMatch) {
                   isLoc = true;
                   lat = locMatch[1];
                   lng = locMatch[2];
                 } else if (msg.media_type === 'location' && msg.content) {
                   [lat, lng] = msg.content.split(',');
                 }
                 
                 const isMediaOnly = (msg.media_type === 'image' || isLoc || msg.media_type === 'audio') && (!msg.content || locMatch);

                 return (
                    <div 
                      key={msg.id} 
                      className={cn("flex w-full gap-2 relative select-none", isMine ? "justify-end" : "justify-start", marginClass)}
                    >
                       {!isMine && (
                           <div className="w-8 shrink-0 flex items-end">
                               {showAvatar ? (
                                 <div 
                                   className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10 cursor-pointer active:scale-95 transition-transform"
                                   onClick={() => {
                                       window.dispatchEvent(new CustomEvent('openProfile', { detail: { userId: msg.sender_id } }));
                                       onCloseChat?.();
                                   }}
                                 >
                                   {activeChat.avatar_url ? (
                                     <img src={activeChat.avatar_url} alt="" className="w-full h-full object-cover" />
                                   ) : (
                                      <div className="w-full h-full flex items-center justify-center text-[10px] font-medium text-white/50">{activeChat.username?.charAt(0).toUpperCase()}</div>
                                   )}
                                 </div>
                               ) : (
                                 <div className="w-8" />
                               )}
                           </div>
                       )}
                       
                       <motion.div 
                         id={`msg-inner-${msg.id}`}
                         initial={false}
                         whileTap={{ scale: contextMenu?.message?.id === msg.id ? 1.05 : 0.98 }}
                         onContextMenu={(e: any) => { e.preventDefault(); handleLongPress(e, msg); }}
                         onTouchStart={(e: any) => onTouchStart(e, msg)}
                         onTouchMove={onTouchMove}
                         onTouchEnd={onTouchEnd}
                         className={cn(
                           "max-w-[75%] min-w-[2rem] text-[15px] leading-[1.3] whitespace-pre-wrap break-words overflow-hidden transition-all duration-300",
                           roundedClass,
                           (!isMediaOnly) && (isMine ? "bg-white text-black shadow-sm" : "bg-white/15 text-white"),
                           contextMenu?.message?.id === msg.id ? "scale-[1.05] shadow-2xl z-[160]" : "",
                           !msg.media_type && !isLoc && "px-4 py-2.5",
                           msg.media_type === 'audio' && "p-0 rounded-3xl",
                           (msg.media_type === 'image' || isLoc) && "p-0 rounded-2xl overflow-hidden"
                         )}
                       >
                         {msg.media_type === 'image' && msg.media_url && (
                           <img 
                             src={msg.media_url} 
                             alt="Photo" 
                             className="w-full h-auto max-h-[450px] object-cover cursor-pointer shadow-[0_4px_12px_rgba(0,0,0,0.1)] active:brightness-90 transition-all rounded-inherit block" 
                             onClick={() => setViewingImage(msg.media_url)}
                           />
                         )}
                         {msg.media_type === 'audio' && msg.media_url && (
                           <AudioPlayer src={msg.media_url} isMine={isMine} />
                         )}
                         {isLoc && lat && lng && (
                           <a 
                             href={`https://maps.google.com/?q=${lat},${lng}`}
                             target="_blank"
                             rel="noopener noreferrer"
                             className="w-full aspect-square bg-[#1c1c1c] overflow-hidden relative shadow-lg flex flex-col items-center justify-center border border-white/10 cursor-pointer active:scale-95 transition-transform block"
                             style={{ textDecoration: 'none' }}
                           >
                             <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mb-3 pointer-events-none">
                               <MapPin size={32} className="text-white" />
                             </div>
                             <span className="text-white font-bold text-sm pointer-events-none">Shared Location</span>
                             <span className="text-white/50 text-[10px] mt-1 pointer-events-none">Tap to open in Google Maps</span>
                           </a>
                         )}
                         {msg.content && !isMediaOnly && (
                           <div className={cn(
                             (msg.media_type === 'image') ? "px-4 pb-3 pt-2 bg-black/5 backdrop-blur-sm mt-[-1px]" : "",
                             (msg.media_type === 'audio') ? "px-4 py-2 bg-black/5 mt-1" : ""
                           )}>
                             <Linkify text={msg.content} />
                           </div>
                         )}
                       </motion.div>
                    </div>
                  );
               })}
               <div ref={messagesEndRef} className="h-4" />
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSendMessage} className="p-4 pb-safe border-t border-white/10 bg-black/95 backdrop-blur-2xl shrink-0 relative z-10">
               <div className="flex items-center gap-3 relative z-20">
                 <button 
                   type="button"
                   onClick={() => setShowFeatures(!showFeatures)}
                   className="w-10 h-10 shrink-0 bg-white/10 rounded-full flex items-center justify-center active:scale-90 transition-all hover:bg-white/20"
                 >
                   <Plus 
                     size={24} 
                     className={cn(
                       "text-white transition-transform duration-500 cubic-bezier(0.4, 0, 0.2, 1)",
                       showFeatures && "rotate-45"
                     )} 
                   />
                 </button>
                 <div className="relative flex-1 flex items-center group">
                   <textarea 
                     placeholder="Message..." 
                     value={newMessage}
                     onChange={e => setNewMessage(e.target.value)}
                     onFocus={() => setIsFocused(true)}
                     onBlur={() => setIsFocused(false)}
                     onKeyDown={e => {
                       if (e.key === 'Enter' && !e.shiftKey) {
                         e.preventDefault();
                         handleSendMessage(e);
                       }
                     }}
                     className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/40 rounded-[24px] px-4 py-2.5 pr-12 focus:outline-none focus:border-white/20 shadow-inner text-[16px] transition-all resize-none min-h-[44px] max-h-[120px] leading-tight flex items-center"
                     rows={1}
                     style={{ height: newMessage ? 'auto' : '44px' }}
                   />
                   <button 
                     type="submit"
                     disabled={!newMessage.trim()}
                     className="absolute right-1 w-9 h-9 bg-white text-black rounded-full flex items-center justify-center disabled:opacity-0 disabled:scale-75 active:scale-90 transition-all shadow-lg z-30"
                   >
                     <SendHorizonal size={18} strokeWidth={2.5} className="mr-0.5" />
                   </button>
                 </div>
               </div>

               <AnimatePresence>
                 {showFeatures && (
                   <motion.div 
                     initial={{ height: 0, opacity: 0 }}
                     animate={{ height: 'auto', opacity: 1 }}
                     exit={{ height: 0, opacity: 0 }}
                     transition={{ type: "spring", stiffness: 400, damping: 30 }}
                     className="overflow-hidden mt-4"
                   >
                     <div className="grid grid-cols-4 gap-4 px-2 pb-2">
                       <button type="button" className="flex flex-col items-center gap-2 active:scale-95 transition-transform" onClick={() => cameraInputRef.current?.click()}>
                         <div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/80">
                           <Camera size={22} />
                         </div>
                         <span className="text-[10px] font-medium text-white/50">Camera</span>
                       </button>
                       <button type="button" className="flex flex-col items-center gap-2 active:scale-95 transition-transform" onClick={() => fileInputRef.current?.click()}>
                         <div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/80">
                           <ImageIcon size={22} />
                         </div>
                         <span className="text-[10px] font-medium text-white/50">Photos</span>
                       </button>
                       <button 
                         type="button" 
                         className={cn("flex flex-col items-center gap-2 active:scale-95 transition-transform", isRecording && "opacity-100")} 
                         onClick={isRecording ? stopRecording : startRecording} 
                       >
                         <div className={cn("w-12 h-12 rounded-full border flex items-center justify-center text-white/80 transition-colors", isRecording ? "bg-red-500/20 border-red-500/50 text-red-500" : "bg-white/10 border-white/10")}>
                           {isRecording ? <div className="w-4 h-4 bg-red-500 rounded-sm" /> : <Mic size={22} />}
                         </div>
                         <span className={cn("text-[10px] font-medium transition-colors", isRecording ? "text-red-500" : "text-white/50")}>
                           {isRecording ? `0:${recordingDuration.toString().padStart(2, '0')}` : 'Audio'}
                         </span>
                       </button>
                       <button type="button" className="flex flex-col items-center gap-2 active:scale-95 transition-transform" onClick={handleLocationShare}>
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
                 <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm z-50 rounded-t-3xl">
                    <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                 </div>
               )}

               <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={(e) => {
                 const file = e.target.files?.[0];
                 if (file) {
                   const dataUrl = URL.createObjectURL(file);
                   setPendingMedia({ file, type: 'image', dataUrl });
                   setShowFeatures(false);
                 }
                 e.target.value = '';
               }} />
               <input type="file" ref={cameraInputRef} accept="image/*" capture="environment" className="hidden" onChange={(e) => {
                 const file = e.target.files?.[0];
                 if (file) {
                   const dataUrl = URL.createObjectURL(file);
                   setPendingMedia({ file, type: 'image', dataUrl });
                   setShowFeatures(false);
                 }
                 e.target.value = '';
               }} />
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingMedia && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed inset-0 z-[150] bg-black/90 flex flex-col justify-between backdrop-blur-md"
          >
            <div className="p-4 pt-safe flex items-center justify-between">
              <button 
                onClick={() => setPendingMedia(null)} 
                className="w-10 h-10 bg-white/10 text-white rounded-full flex items-center justify-center active:scale-90 transition-transform"
              >
                <X size={24} />
              </button>
              <h2 className="text-white font-bold tracking-tight">Send {pendingMedia.type.charAt(0).toUpperCase() + pendingMedia.type.slice(1)}</h2>
              <div className="w-10" />
            </div>

            <div className="flex-1 flex items-center justify-center p-4">
              {pendingMedia.type === 'image' && pendingMedia.dataUrl && (
                <img src={pendingMedia.dataUrl} alt="Preview" className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl" />
              )}
              {pendingMedia.type === 'audio' && pendingMedia.dataUrl && (
                <div className="w-full max-w-sm">
                  <AudioPlayer src={pendingMedia.dataUrl} isMine={true} />
                </div>
              )}
              {pendingMedia.type === 'location' && pendingMedia.locationString && (
                <div className="w-full max-w-xs aspect-square border border-white/20 rounded-2xl overflow-hidden relative shadow-2xl bg-[#1c1c1c] flex flex-col items-center justify-center">
                  <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mb-3">
                    <MapPin size={32} className="text-white" />
                  </div>
                  <span className="text-white font-bold text-sm">Shared Location</span>
                </div>
              )}
            </div>

            <div className="p-4 pb-safe flex justify-end">
              <button 
                onClick={() => {
                  if (pendingMedia.type === 'location') {
                    sendSpecialMessage(null, 'location', pendingMedia.locationString || '');
                  } else if (pendingMedia.file) {
                    handleMediaMessage(pendingMedia.file, pendingMedia.type as 'image' | 'audio');
                  }
                  setPendingMedia(null);
                }}
                className="bg-white text-black font-bold px-8 py-3.5 rounded-full active:scale-95 transition-transform flex items-center gap-2 shadow-2xl"
              >
                Send <SendHorizonal size={20} className="ml-1" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black backdrop-blur-2xl"
          >
            <button onClick={(e) => { e.stopPropagation(); saveToDevice(viewingImage, 'socium'); }} className="absolute z-[210] top-safe left-4 mt-4 p-3 bg-white/10 text-white rounded-full backdrop-blur-md active:scale-90 transition-transform"><Download size={24} /></button>
            <button onClick={(e) => { e.stopPropagation(); setViewingImage(null); }} className="absolute z-[210] top-safe right-4 mt-4 p-3 bg-white/10 text-white rounded-full backdrop-blur-md active:scale-90 transition-transform"><X size={24} /></button>
            
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full h-full">
              <TransformWrapper doubleClick={{ mode: "zoomIn" }} centerOnInit>
                <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <img src={viewingImage} alt="" className="max-w-full max-h-screen object-contain pointer-events-auto" />
                </TransformComponent>
              </TransformWrapper>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contextMenu && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[150] bg-transparent" onClick={() => setContextMenu(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} className="fixed z-[160] w-48 bg-[#1c1c1c] border border-white/10 rounded-2xl shadow-2xl overflow-hidden p-1.5" style={{ top: contextMenu.y, left: contextMenu.x }}>
               {contextMenu.message.content && (
                  <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-white hover:bg-white/10 rounded-xl transition-colors" onClick={() => { navigator.clipboard.writeText(contextMenu.message.content); setContextMenu(null); }}>
                    <span>Copy Text</span>
                    <Copy size={16} />
                  </button>
               )}
               {contextMenu.message.media_url && (
                  <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-white hover:bg-white/10 rounded-xl transition-colors" onClick={() => { saveToDevice(contextMenu.message.media_url, 'socium', contextMenu.message.media_type); setContextMenu(null); }}>
                    <span>Save {contextMenu.message.media_type === 'image' ? 'Photo' : 'Audio'}</span>
                    <Download size={16} />
                  </button>
               )}
               {(()=>{
                 let isLocContext = contextMenu.message.media_type === 'location';
                 let latContext = '', lngContext = '';
                 const locMatchContext = contextMenu.message.content?.match(/https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=([-0-9.]+),([-0-9.]+)/);
                 if (locMatchContext) {
                   isLocContext = true;
                   latContext = locMatchContext[1];
                   lngContext = locMatchContext[2];
                 } else if (contextMenu.message.media_type === 'location' && contextMenu.message.content) {
                   [latContext, lngContext] = contextMenu.message.content.split(',');
                 }

                 return isLocContext && (
                   <>
                     <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-white hover:bg-white/10 rounded-xl transition-colors" onClick={() => { 
                       window.location.href = `https://maps.google.com/?q=${latContext},${lngContext}`;
                       setContextMenu(null); 
                     }}>
                       <span>Open in Google Maps</span>
                       <MapPin size={16} />
                     </button>
                     <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-white hover:bg-white/10 rounded-xl transition-colors" onClick={() => { 
                       window.location.href = `https://maps.apple.com/?ll=${latContext},${lngContext}`;
                       setContextMenu(null); 
                     }}>
                       <span>Open in Maps</span>
                       <MapPin size={16} />
                     </button>
                   </>
                 );
               })()}
               {contextMenu.message.sender_id === currentUserId && (
                 <button className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-red-500 hover:bg-white/5 rounded-xl transition-colors mt-1" onClick={handleDeleteMessage}>
                   <span>Delete</span>
                   <Trash2 size={16} />
                 </button>
               )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
