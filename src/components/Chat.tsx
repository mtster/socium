import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/src/lib/supabase';
import { Profile } from '@/src/types';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowUp, Plus, Camera, Image as ImageIcon, Mic, MapPin, X, Download, Copy, Trash2, MoreHorizontal, Play, Pause, SendHorizonal } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { rtdb } from '@/src/lib/firebase';
import { ref, get, set, increment } from 'firebase/database';
import { setChatLocation, checkRecipientPresenceAndNotify } from '@/src/lib/presence';
import { useStore } from '@/src/store/useStore';

const parseLocation = (content: string) => {
  if (!content) return { lat: null, lng: null };
  const locMatch = content.match(/query=([-0-9.]+),([-0-9.]+)/) || 
                   content.match(/ll=([-0-9.]+),([-0-9.]+)/) ||
                   content.match(/([-0-9.]+),([-0-9.]+)/) ||
                   content.match(/google\.com\/maps\/search\/([-0-9.]+),([-0-9.]+)/);
  if (locMatch && !content.includes('goo.gl/maps') && !content.includes('maps.app.goo.gl')) {
     return { lat: parseFloat(locMatch[1]), lng: parseFloat(locMatch[2]) };
  }
  return { lat: null, lng: null };
};

const openInNativeMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  const isApple = originalUrl && (originalUrl.includes('apple.com') || originalUrl.includes('apple.com/maps'));
  const isGoogle = originalUrl && (originalUrl.includes('google.com') || originalUrl.includes('goo.gl/maps') || originalUrl.includes('maps.app.goo.gl'));

  let iosUrl = '';
  let webUrl = originalUrl || '';

  if (lat !== null && lng !== null) {
    const dest = `${lat},${lng}`;
    if (isApple) {
      iosUrl = `maps://?q=${dest}`;
      webUrl = originalUrl || `https://maps.apple.com/?q=${dest}`;
    } else {
      iosUrl = `comgooglemaps://?q=${dest}&directionsmode=driving`;
      webUrl = originalUrl || `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
    }
  } else if (originalUrl) {
    if (isApple) {
      iosUrl = originalUrl.replace(/^https?:\/\//, 'maps://');
    } else if (isGoogle) {
      // the shortest way to launch google maps from generic url is sometimes comgooglemapsurl://
      // but without lat/lng we can just try comgooglemaps://?q=... or let fallback happen
      iosUrl = originalUrl.replace(/^https?:\/\//, 'comgooglemapsurl://');
    }
  }

  if (iosUrl) {
    const start = Date.now();
    window.location.href = iosUrl;
    setTimeout(() => {
      if (!document.hidden && (Date.now() - start < 2000)) {
        if (webUrl) window.open(webUrl, '_blank');
      }
    }, 1500);
  } else if (webUrl) {
    window.open(webUrl, '_blank');
  }
};

const Linkify = ({ text }: { text: string }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return (
    <>
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          const isMapUrl = part.includes('google.com/maps') || part.includes('goo.gl/maps') || part.includes('maps.app.goo.gl') || part.includes('maps.apple.com') || part.includes('apple.com/maps');
          return (
            <a 
              key={i} 
              href={part} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="underline underline-offset-2 break-all opacity-80 hover:opacity-100 transition-opacity"
              onClick={(e) => {
                if (isMapUrl) {
                  e.preventDefault();
                  e.stopPropagation();
                  const { lat, lng } = parseLocation(part);
                  openInNativeMaps(lat, lng, part);
                }
              }}
            >
              {part}
            </a>
          );
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
    const setAudioData = () => { if (audio.duration !== Infinity) setDuration(audio.duration); };
    const setAudioTime = () => { setProgress((audio.currentTime / audio.duration) * 100 || 0); };
    const onEnd = () => { setPlaying(false); setProgress(100); };
    audio.addEventListener('loadedmetadata', setAudioData);
    audio.addEventListener('timeupdate', setAudioTime);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('durationchange', () => { if (audio.duration !== Infinity) setDuration(audio.duration); });
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
      } catch (e) {}
      if (progress >= 100) audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.error("Play error", e));
      setPlaying(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const percentage = (e.clientX - bounds.left) / bounds.width;
    const newTime = percentage * audioRef.current.duration;
    if (!isNaN(newTime) && isFinite(newTime)) {
      audioRef.current.currentTime = newTime;
      setProgress(percentage * 100);
    }
  };

  return (
    <div className={cn("flex items-center gap-3 px-3 py-2 rounded-[24px] min-w-[180px] backdrop-blur-md transition-all duration-300", isMine ? "bg-white text-black" : "bg-white/20 text-white")}>
      <button onClick={toggle} className={cn("w-8 h-8 rounded-full flex items-center justify-center transition-transform active:scale-90", isMine ? "bg-black/10" : "bg-white/10")}>
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="flex-1 h-3 bg-current/10 rounded-full overflow-hidden cursor-pointer flex items-center relative" onClick={handleSeek}>
        <div className="w-full h-1 bg-current/20 rounded-full absolute pointer-events-none" />
        <motion.div animate={{ width: `${progress}%` }} transition={{ duration: 0.1 }} className="h-1 bg-current relative z-10 pointer-events-none" />
      </div>
      <span className="text-[10px] font-medium opacity-50 w-8">{duration > 0 ? `${Math.floor(duration)}s` : '...'}</span>
    </div>
  );
};

interface ChatProps {
  currentUserId: string;
  initialActiveChat?: Profile | null;
  onCloseChat?: () => void;
  onChatStateChange?: (isOpen: boolean) => void;
}

let chatConnectionsCache: any[] | null = null;
let lastChatListFetch = 0;
let chatMessagesCache: Record<string, any[]> = {};
let lastChatMessagesFetch: Record<string, number> = {};

export default function Chat({ currentUserId, initialActiveChat, onCloseChat, onChatStateChange }: ChatProps) {
  const [connections, setConnections] = useState<(Profile & { lastMessage?: any, unreadCount?: number })[]>(chatConnectionsCache || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChat, setActiveChat] = useState<Profile | null>(initialActiveChat || null);

  useEffect(() => { onChatStateChange?.(!!activeChat); }, [activeChat, onChatStateChange]);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(!chatConnectionsCache);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [pullProgress, setPullProgress] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{file: File | Blob | null, type: 'image' | 'audio' | 'location', dataUrl?: string, locationString?: string} | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [isMultiTouch, setIsMultiTouch] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, message: any } | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<any>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<any>(null);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('viewerState', { detail: { isOpen: !!viewingImage } }));
    return () => { window.dispatchEvent(new CustomEvent('viewerState', { detail: { isOpen: false } })); };
  }, [viewingImage]);

  const handleDeleteMessage = async () => {
    if (!contextMenu?.message) return;
    const msgId = contextMenu.message.id;
    setContextMenu(null);
    setMessages(prev => prev.filter(m => m.id !== msgId));
    await supabase.from('messages').delete().eq('id', msgId);
  };

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
    if (!chatConnectionsCache || Date.now() - lastChatListFetch > 60000) fetchConnectionsAndRecentMessages();
    const handleVis = () => { if (document.visibilityState === 'visible') fetchConnectionsAndRecentMessages(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVis);
    return () => { if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVis); };
  }, [currentUserId]);

// Inside Chat component, replacing the activeChat useEffect
  useEffect(() => {
    if (activeChat) {
      setChatLocation(currentUserId, activeChat.id);
      (window as any).currentChatUserId = activeChat.id;
      
      const handleVisChange = () => {
        if (document.visibilityState === 'visible') {
           setChatLocation(currentUserId, activeChat.id);
        }
      };
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisChange);
      }

      const cached = chatMessagesCache[activeChat.id];
      if (cached) {
         setMessages(cached);
         setHasMoreMessages(cached.length >= 20);
         scrollToBottom(false);
         markMessagesAsRead(activeChat.id);
      }
      fetchMessages(activeChat.id);
      const channel = supabase.channel(`chat_${activeChat.id}_active`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${activeChat.id}` }, (payload) => {
        if (payload.new.receiver_id === currentUserId) {
          setMessages((prev) => {
            if (prev.some(m => m.id === payload.new.id)) return prev;
            const newMsgs = [...prev, payload.new];
            chatMessagesCache[activeChat.id] = newMsgs;
            return newMsgs;
          });
          markMessagesAsRead(activeChat.id);
          scrollToBottom();
        }
      }).subscribe();
      return () => { 
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', handleVisChange);
        }
        supabase.removeChannel(channel); 
        (window as any).currentChatUserId = null; 
        setChatLocation(currentUserId, null);
      };
    } else { 
      (window as any).currentChatUserId = null; 
      setChatLocation(currentUserId, null);
    }
  }, [activeChat, currentUserId]);

  const updateConnectionLastMessage = (newMessage: any, partnerId: string, incrementUnread: boolean) => {
    setConnections(prev => {
      const idx = prev.findIndex(c => c.id === partnerId);
      if (idx === -1) return prev;
      const updatedConnections = [...prev];
      const unreadCount = incrementUnread ? (updatedConnections[idx].unreadCount || 0) + 1 : (updatedConnections[idx].unreadCount || 0);
      updatedConnections[idx] = { ...updatedConnections[idx], lastMessage: newMessage, unreadCount };
      updatedConnections.unshift(updatedConnections.splice(idx, 1)[0]);
      chatConnectionsCache = updatedConnections;
      return updatedConnections;
    });
  };

  useEffect(() => {
    const mainChannel = supabase.channel('global_messages').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${currentUserId}` }, (payload) => {
      const newMessage = payload.new;
      const isCurrentlyActive = (window as any).currentChatUserId === newMessage.sender_id;
      updateConnectionLastMessage(newMessage, newMessage.sender_id, !isCurrentlyActive);
      window.dispatchEvent(new CustomEvent('forceGetUnread'));
    }).subscribe();
    return () => { supabase.removeChannel(mainChannel); };
  }, [currentUserId]);

  const fetchConnectionsAndRecentMessages = async () => {
    try {
      const { data: rel1 } = await supabase.from('connections').select('*, profiles!connections_receiver_id_fkey(*)').eq('requester_id', currentUserId).eq('status', 'accepted');
      const { data: rel2 } = await supabase.from('connections').select('*, profiles!connections_requester_id_fkey(*)').eq('receiver_id', currentUserId).eq('status', 'accepted');
      const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
      const { data: adminProf } = await supabase.from('profiles').select('*').eq('id', ADMIN_ID).maybeSingle();
      const combinedProfs = [...(rel1?.map(c => c.profiles) || []), ...(rel2?.map(c => c.profiles) || [])].filter(Boolean) as Profile[];
      if (adminProf && !combinedProfs.some(c => c.id === ADMIN_ID) && currentUserId !== ADMIN_ID) combinedProfs.push(adminProf);
      const deduplicated = Array.from(new Map(combinedProfs.map(item => [item.id, item])).values());
      const connectionsWithMessages = await Promise.all(deduplicated.map(async (prof) => {
        const { data: msgs } = await supabase.from('messages').select('*').or(`sender_id.eq.${prof.id},receiver_id.eq.${prof.id}`).order('created_at', { ascending: false }).limit(1);
        const { count } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('sender_id', prof.id).eq('receiver_id', currentUserId).is('read_at', null);
        return { ...prof, lastMessage: msgs?.[0] || null, unreadCount: count || 0 };
      }));
      connectionsWithMessages.sort((a, b) => new Date(b.lastMessage?.created_at || 0).getTime() - new Date(a.lastMessage?.created_at || 0).getTime());
      chatConnectionsCache = connectionsWithMessages;
      lastChatListFetch = Date.now();
      setConnections(connectionsWithMessages);
    } finally { setLoading(false); }
  };

  const fetchMessages = async (otherUserId: string, loadOld = false, currentOffset = 0) => {
    setLoadingMessages(true);
    const limit = loadOld ? 15 : 20;
    const offset = loadOld ? currentOffset : 0;
    const { data } = await supabase.from('messages').select('*').or(`sender_id.eq.${otherUserId},receiver_id.eq.${otherUserId}`).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (data) {
      const orderedData = data.reverse();
      if (loadOld) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const filteredNew = orderedData.filter(m => !existingIds.has(m.id));
          if (filteredNew.length === 0) return prev;
          const newMsgs = [...filteredNew, ...prev];
          chatMessagesCache[otherUserId] = newMsgs;
          return newMsgs;
        });
        setHasMoreMessages(data.length === limit);
      } else {
        setMessages(orderedData);
        chatMessagesCache[otherUserId] = orderedData;
        lastChatMessagesFetch[otherUserId] = Date.now();
        scrollToBottom(false);
        markMessagesAsRead(otherUserId);
        setHasMoreMessages(data.length === limit);
      }
    }
    setLoadingMessages(false);
  };

  const markMessagesAsRead = async (senderId: string) => {
    setConnections(prev => prev.map(c => c.id === senderId ? { ...c, unreadCount: 0 } : c));
    window.dispatchEvent(new CustomEvent('forceGetUnread'));
    await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', senderId).eq('receiver_id', currentUserId).is('read_at', null);
  };

  const scrollToBottom = (smooth = true) => {
    if (smooth) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  };

  const uploadToCloudinary = async (file: File | Blob, type: 'image' | 'video' | 'audio' | 'auto') => {
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) throw new Error('Cloudinary config missing');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    if (type === 'image') formData.append('folder', 'chat_images');
    else if (type === 'video') formData.append('folder', 'chat_audio'); 
    
    // For iOS audio (m4a/mp4), force video upload
    if (type === 'audio' || file.type.includes('mp4') || file.type.includes('m4a')) {
      type = 'video';
    }

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${type}/upload`, { method: 'POST', body: formData });
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
      mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/mp4' });
        setPendingMedia({ file: audioBlob, type: 'audio', dataUrl: URL.createObjectURL(audioBlob) });
        stream.getTracks().forEach(track => track.stop());
        setShowFeatures(false);
      };
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingIntervalRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
    } catch (e) { alert('Could not access microphone'); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) { mediaRecorderRef.current.stop(); setIsRecording(false); clearInterval(recordingIntervalRef.current); }
  };

  const handleLocationShare = () => {
    if (!navigator.geolocation) return alert("Geolocation is not supported");
    setUploadingMedia(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      const locUrl = `https://www.google.com/maps/search/?api=1&query=${pos.coords.latitude},${pos.coords.longitude}`;
      setNewMessage(prev => prev + (prev.length > 0 ? ' ' : '') + locUrl);
      setShowFeatures(false);
      setUploadingMedia(false);
    }, () => { alert('Could not get location'); setUploadingMedia(false); }, { enableHighAccuracy: true });
  };

  const handleMediaMessage = async (file: File | Blob, type: 'image' | 'audio') => {
    setUploadingMedia(true);
    setShowFeatures(false);
    console.log(`Starting upload for ${type} file:`, file);
    try {
      const url = await uploadToCloudinary(file, type === 'audio' ? 'video' : 'image');
      console.log('Upload success, URL:', url);
      await sendSpecialMessage(url, type);
    } catch (e) {
      console.error('Media upload failed:', e);
      alert('Upload failed: ' + (e as Error).message);
    } finally { setUploadingMedia(false); }
  };

  const saveToDevice = async (url: string, filename: string, mediaType?: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const fileExt = mediaType === 'audio' ? 'webm' : 'jpg';
      const file = new File([blob], `${filename}.${fileExt}`, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: filename });
      else {
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${filename}.${fileExt}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      }
    } catch (e) {
      const link = document.createElement('a'); link.href = url; link.download = filename;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
    }
  };

  const handleLongPress = (e: any, msg: any) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    // Prevent default context menu on iOS
    e.preventDefault();
    
    if (navigator.vibrate) navigator.vibrate(10);
    const el = document.getElementById(`msg-inner-${msg.id}`);
    let x = clientX, y = clientY;
    if (el) {
      const rect = el.getBoundingClientRect();
      const isMineMsg = msg.sender_id === currentUserId;
      
      // Calculate suggested position
      let suggestedX = isMineMsg ? rect.left - 200 : rect.right + 10;
      let suggestedY = rect.top;
      
      // Responsive constraints (clamping)
      const menuWidth = 160;
      const menuHeight = 240;
      
      const clampedX = Math.max(10, Math.min(suggestedX, window.innerWidth - menuWidth - 10));
      const clampedY = Math.max(10, Math.min(suggestedY, window.innerHeight - menuHeight - 10));
      
      setContextMenu({ x: clampedX, y: clampedY, message: msg });
    }
  };

  const onTouchStart = (e: any, msg: any) => {
    if (longPressTimer) clearTimeout(longPressTimer);
    setLongPressTimer(setTimeout(() => handleLongPress(e, msg), 500));
  };
  const onTouchMove = () => { if (longPressTimer) { clearTimeout(longPressTimer); setLongPressTimer(null); } };
  const onTouchEnd = () => { if (longPressTimer) { clearTimeout(longPressTimer); setLongPressTimer(null); } };

  const sendSpecialMessage = async (mediaUrl: string | null, mediaType: 'image' | 'audio' | 'location', contentStr: string = '') => {
    if (!activeChat) return;
    const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const temp = { id: msgId, sender_id: currentUserId, receiver_id: activeChat.id, content: contentStr, media_url: mediaUrl, media_type: mediaType, created_at: new Date().toISOString() };
    setMessages(prev => { const nm = [...prev, temp]; chatMessagesCache[activeChat.id] = nm; return nm; });
    updateConnectionLastMessage(temp, activeChat.id, false);
    scrollToBottom();
    try {
      const { data, error } = await supabase.from('messages').insert({ sender_id: currentUserId, receiver_id: activeChat.id, content: contentStr, media_url: mediaUrl, media_type: mediaType }).select().single();
      if (error) throw error;
      setMessages(prev => prev.map(m => m.id === temp.id ? data : m));
      updateConnectionLastMessage(data, activeChat.id, false);
      // Trigger notification if needed
      checkRecipientPresenceAndNotify(currentUserId, activeChat.id, data);
    } catch (e) { setMessages(prev => prev.filter(m => m.id !== temp.id)); }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeChat) return;
    const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const temp = { id: msgId, sender_id: currentUserId, receiver_id: activeChat.id, content: newMessage.trim(), created_at: new Date().toISOString() };
    setMessages(prev => { const nm = [...prev, temp]; chatMessagesCache[activeChat.id] = nm; return nm; });
    updateConnectionLastMessage(temp, activeChat.id, false);
    setNewMessage('');
    scrollToBottom();
    try {
      const { data, error } = await supabase.from('messages').insert({ sender_id: currentUserId, receiver_id: activeChat.id, content: temp.content }).select().single();
      if (error) throw error;
      setMessages(prev => prev.map(m => m.id === temp.id ? data : m));
      updateConnectionLastMessage(data, activeChat.id, false);
      // Trigger notification if needed
      checkRecipientPresenceAndNotify(currentUserId, activeChat.id, data);
    } catch (e) { setMessages(prev => prev.filter(m => m.id !== temp.id)); }
  };

  const filteredConnections = connections.filter(c => (c.full_name || c.username)?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex flex-col h-full bg-black overflow-hidden relative">
      <div 
         className="absolute inset-0 flex flex-col h-full select-none [user-select:none] [-webkit-user-select:none] [-webkit-touch-callout:none]"
      >
        <div className="p-4 pt-safe border-b border-white/10 shrink-0">
           <input type="text" placeholder="Search connections..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/40 rounded-xl px-4 py-3 focus:outline-none focus:border-white/30 text-sm transition-all" />
        </div>
        <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
          {!loading && filteredConnections.length === 0 ? <div className="p-8 text-center text-white/40 text-sm">No connections found</div> : filteredConnections.map(c => (
              <button key={c.id} onClick={() => {
                 setActiveChat(c);
                 if (c.unreadCount && c.unreadCount > 0) {
                   const { totalUnread, setTotalUnread } = useStore.getState();
                   setTotalUnread(Math.max(0, totalUnread - 1));
                   setConnections(prev => prev.map(conn => conn.id === c.id ? { ...conn, unreadCount: 0 } : conn));
                   chatConnectionsCache = chatConnectionsCache?.map(conn => conn.id === c.id ? { ...conn, unreadCount: 0 } : conn);
                 }
              }} className="w-full flex items-center p-4 border-b border-white/5 active:bg-white/5 transition-colors gap-4">
                 <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0 relative">
                    {c.avatar_url ? <img src={c.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-sm font-medium text-white/50">{(c.username?.charAt(0) || c.full_name?.charAt(0) || '?').toUpperCase()}</div>}
                 </div>
                 <div className="flex-1 text-left overflow-hidden">
                   <p className="font-bold text-white/90 truncate text-sm">{c.full_name || c.username}</p>
                   {c.lastMessage && <p className={cn("text-xs truncate mt-1", c.unreadCount ? "text-white font-semibold" : "text-white/40")}>{c.lastMessage.sender_id === currentUserId ? 'You: ' : ''}{c.lastMessage.content || (c.lastMessage.media_type === 'image' ? 'Sent a photo' : c.lastMessage.media_type === 'audio' ? 'Sent a voice message' : 'Shared location')}</p>}
                 </div>
                 <div className="flex flex-col items-end gap-1">
                   {c.lastMessage && <div className="shrink-0 text-[10px] text-white/30">{new Date(c.lastMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div>}
                   {c.unreadCount ? <div className="w-2.5 h-2.5 bg-white rounded-full" /> : null}
                 </div>
              </button>
          ))}
        </div>
      </div>

      <AnimatePresence initial={false} custom={initialActiveChat ? 'initial' : 'normal'}>
        {activeChat && (
          <motion.div 
             key="chat-room" 
             initial={{ x: '100%', opacity: 1 }} 
             animate={{ x: 0, opacity: 1 }} 
             exit={{ x: '100%', opacity: 1 }} 
             transition={{ type: 'tween', duration: 0.35, ease: 'easeOut' }} 
             className="fixed inset-0 z-[60] flex flex-col bg-black w-full border-white/5 overflow-hidden select-none [user-select:none] [-webkit-user-select:none] [-webkit-touch-callout:none]"
          >
            <div className="p-4 pt-safe flex items-center gap-4 border-b border-white/10 bg-black/80 backdrop-blur-xl shrink-0">
               <button onClick={() => { setActiveChat(null); onCloseChat?.(); }} className="p-2 -ml-2 text-white/80 active:scale-90 transition-transform"><ArrowLeft size={24} /></button>
               <div className="flex items-center gap-3 w-full cursor-pointer" onClick={() => { window.dispatchEvent(new CustomEvent('openProfile', { detail: { userId: activeChat.id } })); onCloseChat?.(); }}>
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0">
                    {activeChat.avatar_url ? <img src={activeChat.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs font-medium text-white/50">{(activeChat.username?.charAt(0) || activeChat.full_name?.charAt(0) || '?').toUpperCase()}</div>}
                  </div>
                  <span className="font-bold text-sm text-white/90 truncate">{activeChat.full_name || activeChat.username}</span>
               </div>
            </div>
            <div ref={scrollContainerRef} id="chat-messages-container" className="flex-1 flex flex-col-reverse overflow-y-auto p-4 space-y-1 space-y-reverse relative no-scrollbar [-webkit-overflow-scrolling:touch] select-none [user-select:none] [-webkit-user-select:none] [-webkit-touch-callout:none]" 
              onTouchStart={(e) => { if (e.currentTarget.scrollTop <= 5) setIsPulling(true); }}
              onTouchMove={(e) => {
                if (!isPulling || !hasMoreMessages || loadingMessages) return;
                const touch = e.touches[0];
                const startY = (e.currentTarget as any)._pullStartY || touch.clientY;
                if (!(e.currentTarget as any)._pullStartY) (e.currentTarget as any)._pullStartY = touch.clientY;
                const diff = touch.clientY - startY;
                if (diff > 0) setPullProgress(Math.min(diff / 180, 1));
              }}
              onTouchEnd={(e) => {
                if (isPulling && pullProgress >= 1) fetchMessages(activeChat.id, true, messages.length);
                setIsPulling(false); setPullProgress(0); (e.currentTarget as any)._pullStartY = null;
              }}
            >
               <div ref={messagesEndRef} className="h-1 shrink-0" />
               <div className="flex flex-col-reverse">
                  <AnimatePresence initial={false}>
                  {messages.slice().reverse().map((msg, idx, arr) => (
                     <motion.div key={msg.id} layout initial={{ opacity: 0, scale: 0.95, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
                        <MessageBubble msg={msg} isMine={msg.sender_id === currentUserId} nextMsg={arr[idx - 1]} prevMsg={arr[idx + 1]} activeChat={activeChat} currentUserId={currentUserId} setViewingImage={setViewingImage} handleLongPress={handleLongPress} contextMenu={contextMenu} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onCloseChat={onCloseChat} />
                     </motion.div>
                   ))}
                  </AnimatePresence>
                </div>
               
               {loadingMessages && <div className="flex justify-center z-50 pointer-events-none pb-4 pt-8"><div className="bg-black/60 border border-white/10 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2"><span className="w-3 h-3 border-2 border-white/30 border-t-white animate-spin rounded-full" />Loading...</div></div>}
               <AnimatePresence>
                {pullProgress > 0 && <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: pullProgress }} exit={{ scale: 0.8, opacity: 0 }} className="flex justify-center z-50 pointer-events-none pb-4 pt-4">
                  <div className={cn("text-[10px] uppercase tracking-widest font-bold px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10", pullProgress >= 1 ? "text-white shadow-[0_0_15px_rgba(255,255,255,0.2)]" : "text-white/50")}>
                    {pullProgress >= 1 ? "Release to load" : "Pull for history"}
                  </div>
                </motion.div>}
               </AnimatePresence>
            </div>
            <form onSubmit={handleSendMessage} className="p-4 pb-safe border-t border-white/10 bg-black/95 backdrop-blur-2xl shrink-0">
               <div className="flex items-center gap-3">
                 <button type="button" onClick={() => setShowFeatures(!showFeatures)} className="w-10 h-10 shrink-0 bg-white/10 rounded-full flex items-center justify-center transition-all"><Plus size={24} className={cn("text-white transition-transform duration-300", showFeatures && "rotate-45")} /></button>
                 <div className="relative flex-1 flex items-center">
                   <textarea placeholder="Message..." value={newMessage} onChange={e => setNewMessage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); } }} className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/40 rounded-[24px] px-4 py-2.5 pr-12 focus:outline-none text-[16px] resize-none min-h-[44px] max-h-[120px] leading-tight" rows={1} style={{ height: newMessage ? 'auto' : '44px' }} />
                   <button type="submit" disabled={!newMessage.trim()} className="absolute right-1 w-9 h-9 bg-white text-black rounded-full flex items-center justify-center disabled:opacity-0 transition-all"><SendHorizonal size={18} /></button>
                 </div>
               </div>
               <AnimatePresence>
                 {showFeatures && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-4"><div className="grid grid-cols-4 gap-4 px-2 pb-2">
                    <button type="button" className="flex flex-col items-center gap-2" onClick={() => cameraInputRef.current?.click()}><div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center"><Camera size={22} /></div><span className="text-[10px] text-white/50">Camera</span></button>
                    <button type="button" className="flex flex-col items-center gap-2" onClick={() => fileInputRef.current?.click()}><div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center"><ImageIcon size={22} /></div><span className="text-[10px] text-white/50">Photos</span></button>
                    <button type="button" className="flex flex-col items-center gap-2" onClick={isRecording ? stopRecording : startRecording}><div className={cn("w-12 h-12 rounded-full border flex items-center justify-center", isRecording ? "bg-red-500/20 border-red-500/50 text-red-500" : "bg-white/10 border-white/10")}>{isRecording ? <div className="w-4 h-4 bg-red-500 rounded-sm" /> : <Mic size={22} />}</div><span className={cn("text-[10px]", isRecording ? "text-red-500" : "text-white/50")}>{isRecording ? `0:${recordingDuration.toString().padStart(2, '0')}` : 'Audio'}</span></button>
                    <button type="button" className="flex flex-col items-center gap-2" onClick={handleLocationShare}><div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center"><MapPin size={22} /></div><span className="text-[10px] text-white/50">Location</span></button>
                 </div></motion.div>}
               </AnimatePresence>
               {uploadingMedia && <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 rounded-t-3xl"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}
               <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setPendingMedia({ file, type: 'image', dataUrl: URL.createObjectURL(file) }); setShowFeatures(false); } e.target.value = ''; }} />
               <input type="file" ref={cameraInputRef} accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setPendingMedia({ file, type: 'image', dataUrl: URL.createObjectURL(file) }); setShowFeatures(false); } e.target.value = ''; }} />
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingMedia && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }} className="absolute inset-0 z-[500] bg-black/90 flex flex-col justify-between backdrop-blur-md">
            <div className="p-4 pt-[env(safe-area-inset-top)] flex items-center justify-between"><button onClick={() => setPendingMedia(null)} className="w-10 h-10 bg-white/10 text-white rounded-full flex items-center justify-center"><X size={24} /></button><h2 className="text-white font-bold">Send {pendingMedia.type}</h2><div className="w-10" /></div>
            <div className="flex-1 flex items-center justify-center p-4">
              {pendingMedia.type === 'image' && <img src={pendingMedia.dataUrl} className="max-w-full max-h-full object-contain rounded-2xl" />}
              {pendingMedia.type === 'audio' && <div className="w-full max-w-sm"><AudioPlayer src={pendingMedia.dataUrl!} isMine={true} /></div>}
            </div>
            <div className="p-4 pb-safe flex justify-end"><button onClick={() => { if (pendingMedia.file) handleMediaMessage(pendingMedia.file, pendingMedia.type as any); setPendingMedia(null); }} className="bg-white text-black font-bold px-8 py-3.5 rounded-full shadow-2xl flex items-center gap-2">Send <SendHorizonal size={20} /></button></div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[600] bg-black">
            <button onClick={() => saveToDevice(viewingImage, 'socium')} className="absolute z-[610] top-safe left-4 mt-4 p-3 bg-white/10 text-white rounded-full"><Download size={24} /></button>
            <button onClick={() => setViewingImage(null)} className="absolute z-[610] top-safe right-4 mt-4 p-3 bg-white/10 text-white rounded-full"><X size={24} /></button>
            <div className="w-full h-full"><TransformWrapper centerOnInit><TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><img src={viewingImage} className="max-w-full max-h-screen object-contain" /></TransformComponent></TransformWrapper></div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contextMenu && (<><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[150] bg-transparent" onClick={() => setContextMenu(null)} /><motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed z-[160] w-auto min-w-[160px] bg-[#1c1c1c] border border-white/10 rounded-[18px] shadow-2xl overflow-hidden py-1" style={{ top: contextMenu.y, left: contextMenu.x }}>
            {contextMenu.message.content && <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { navigator.clipboard.writeText(contextMenu.message.content); setContextMenu(null); }}><Copy size={16} className="text-white/50" />Copy Text</button>}
            
            {contextMenu.message.media_url && <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { saveToDevice(contextMenu.message.media_url, 'socium', contextMenu.message.media_type); setContextMenu(null); }}><Download size={16} className="text-white/50" />Save {contextMenu.message.media_type}</button>}
            
            {(contextMenu.message.media_type === 'location' || (contextMenu.message.content && contextMenu.message.content.includes('google.com/maps'))) && (
              <>
                <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { 
                  const { lat, lng } = parseLocation(contextMenu.message.content || '');
                  if (lat && lng) {
                    window.location.href = `maps://?q=${lat},${lng}`;
                  }
                  setContextMenu(null);
                }}>
                  <MapPin size={16} className="text-white/50" /> Apple Maps
                </button>
                <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { 
                  const { lat, lng } = parseLocation(contextMenu.message.content || '');
                  if (lat && lng) {
                    window.location.href = `comgooglemaps://?q=${lat},${lng}`;
                    setTimeout(() => { if (!document.hidden) window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank'); }, 1500);
                  }
                  setContextMenu(null);
                }}>
                  <MapPin size={16} className="text-white/50" /> Google Maps
                </button>
              </>
            )}

            {contextMenu.message.sender_id === currentUserId && <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-red-500 hover:bg-white/5 gap-3 transition-colors" onClick={handleDeleteMessage}><Trash2 size={16} />Delete</button>}
          </motion.div></>)}
      </AnimatePresence>
    </div>
  );
}

const MessageBubble = React.memo(({ msg, isMine, nextMsg, prevMsg, activeChat, setViewingImage, onTouchStart, onTouchMove, onTouchEnd, onCloseChat, contextMenuId }: any) => {
  const isConsecutive = nextMsg?.sender_id === msg.sender_id;
  const isPrevConsecutive = prevMsg?.sender_id === msg.sender_id;
  const showAvatar = !isMine && !isConsecutive;
  let rounded = 'rounded-[20px]';
  if (isMine) {
    rounded = isConsecutive 
      ? (isPrevConsecutive ? 'rounded-[20px] rounded-tr-[4px] rounded-br-[4px]' : 'rounded-[20px] rounded-br-[4px]') 
      : (isPrevConsecutive ? 'rounded-[20px] rounded-tr-[4px]' : 'rounded-[20px]');
  } else {
    rounded = isConsecutive 
      ? (isPrevConsecutive ? 'rounded-[20px] rounded-tl-[4px] rounded-bl-[4px]' : 'rounded-[20px] rounded-bl-[4px]') 
      : (isPrevConsecutive ? 'rounded-[20px] rounded-tl-[4px]' : 'rounded-[20px]');
  }
  const locMatch = msg.content?.match(/(https?:\/\/(www\.)?(google\.com\/maps|maps\.apple\.com)[^\s]*)/);
  const isLoc = msg.media_type === 'location' || !!locMatch;
  const isMediaOnly = (msg.media_type === 'image' || isLoc || msg.media_type === 'audio') && (!msg.content || (locMatch && msg.content === locMatch[0]));
  
  return (
    <div className={cn("flex w-full gap-2 relative", isMine ? "justify-end" : "justify-start", isConsecutive ? "mb-[2px]" : "mb-3")}>
       {!isMine && (
         <div className="w-8 shrink-0 flex items-end mb-0.5">
           {showAvatar ? (
             <div 
               className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10 active:scale-95 transition-transform" 
               onClick={() => { window.dispatchEvent(new CustomEvent('openProfile', { detail: { userId: msg.sender_id } })); onCloseChat?.(); }}
             >
               {activeChat.avatar_url ? <img src={activeChat.avatar_url} className="w-full h-full object-cover" /> : <div className="w-full h-full items-center justify-center flex text-[10px] text-white/50">{(activeChat.username?.charAt(0) || '?').toUpperCase()}</div>}
             </div>
           ) : <div className="w-8" />}
         </div>
       )}
       <motion.div 
         id={`msg-inner-${msg.id}`} 
         onContextMenu={(e) => e.preventDefault()}
         onTouchStart={(e: any) => onTouchStart(e, msg)} 
         onTouchMove={onTouchMove} 
         onTouchEnd={onTouchEnd} 
         animate={contextMenuId === msg.id ? { scale: 1.05, zIndex: 100 } : { scale: 1, zIndex: 1 }}
         transition={{ type: "spring", stiffness: 400, damping: 25 }}
         className={cn(
           "max-w-[75%] min-w-[2rem] text-[15px] whitespace-pre-wrap break-words transition-colors duration-300 relative select-none [user-select:none] [-webkit-user-select:none]", 
           rounded, 
           !isMediaOnly && (isMine ? "bg-white text-black shadow-sm" : "bg-[#262626] text-white shadow-sm"), 
           !msg.media_type && !isLoc && "px-3.5 py-2", 
           (msg.media_type === 'image' || isLoc) && "p-0 rounded-[22px] overflow-hidden"
         )}
       >
         {msg.media_type === 'image' && msg.media_url && (
           <div className="relative group">
             <img 
               src={msg.media_url} 
               className="w-full h-auto max-h-[400px] object-cover block cursor-pointer" 
               onClick={() => setViewingImage(msg.media_url)} 
               loading="lazy"
             />
           </div>
         )}
         {msg.media_type === 'audio' && msg.media_url && <AudioPlayer src={msg.media_url} isMine={isMine} />}
         {isLoc && (
           <div className="p-3 bg-white/5 flex items-center gap-3 active:bg-white/10 transition-colors" onClick={() => { 
             const { lat, lng } = parseLocation(msg.content); 
             openInNativeMaps(lat, lng, msg.content); 
           }}>
             <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
               <MapPin size={20} className="text-white" />
             </div>
             <div className="flex-1 min-w-0">
               <span className="text-[13px] font-bold block">Current Location</span>
               <span className="text-[11px] opacity-40 block truncate">Tap to open maps</span>
             </div>
           </div>
         )}
         {msg.content && !isMediaOnly && <div className={cn("px-1", isMine ? "text-black" : "text-white")}><Linkify text={msg.content} /></div>}
       </motion.div>
    </div>
  );
});
