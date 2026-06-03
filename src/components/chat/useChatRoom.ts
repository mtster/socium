import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/src/lib/supabase';
import { setChatLocation, checkRecipientPresenceAndNotify, checkGroupPresenceAndNotify } from '@/src/lib/presence';
import { ChatListItemType } from '@/src/types/chat';

export function useChatRoom(currentUserId: string, activeChat: ChatListItemType) {
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const isSendingRef = useRef(false);
  const [pullProgress, setPullProgress] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  const [activeDateMsgId, setActiveDateMsgId] = useState<string | null>(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{file: File | Blob | null, type: 'image' | 'audio' | 'location', dataUrl?: string, locationString?: string} | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
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

  const scrollToBottom = (smooth = true) => {
    if (smooth) setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    else messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  };

  const markMessagesAsRead = async () => {
    window.dispatchEvent(new CustomEvent('forceGetUnread'));
    if (activeChat.isGroup) {
      await supabase.from('group_chat_participants').update({ last_read_at: new Date().toISOString() }).eq('chat_id', activeChat.id).eq('user_id', currentUserId);
    } else {
      await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', activeChat.id).eq('receiver_id', currentUserId).is('read_at', null);
    }
  };

  const fetchMessages = async (loadOld = false, currentOffset = 0) => {
    setLoadingMessages(true);
    const limit = loadOld ? 15 : 20;
    const offset = loadOld ? currentOffset : 0;
    
    let req = supabase.from('messages').select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (activeChat.isGroup) {
      req = req.eq('group_chat_id', activeChat.id);
    } else {
      req = req.is('group_chat_id', null).or(`and(sender_id.eq.${activeChat.id},receiver_id.eq.${currentUserId}),and(sender_id.eq.${currentUserId},receiver_id.eq.${activeChat.id})`);
    }

    const { data, error } = await req;
    if (error) console.error('fetchMessages error:', error);
    
    if (data) {
      const orderedData = data.reverse();
      if (loadOld) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const filteredNew = orderedData.filter(m => !existingIds.has(m.id));
          return [...filteredNew, ...prev];
        });
        setHasMoreMessages(data.length === limit);
      } else {
        setMessages(orderedData);
        scrollToBottom(false);
        markMessagesAsRead();
        setHasMoreMessages(data.length === limit);
      }
    }
    setLoadingMessages(false);
  };

  useEffect(() => {
    setChatLocation(currentUserId, activeChat.id);
    (window as any).currentChatUserId = activeChat.id;
    
    const handleVisChange = () => { if (document.visibilityState === 'visible') setChatLocation(currentUserId, activeChat.id); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisChange);

    fetchMessages();

    // Setup realtime listener
    const filter = activeChat.isGroup 
      ? `group_chat_id=eq.${activeChat.id}` 
      : `sender_id=eq.${activeChat.id}`;

    const channel = supabase.channel(`chat_${activeChat.id}_active`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new;
        if (msg.sender_id === currentUserId && msg.id !== 'temp' && msg.media_type !== 'system') return; // our own msg handles optimistic update from this device
        
        let shouldAdd = false;
        if (activeChat.isGroup) {
          shouldAdd = msg.group_chat_id === activeChat.id;
        } else {
          shouldAdd = (msg.sender_id === activeChat.id && msg.receiver_id === currentUserId) ||
                      (msg.sender_id === currentUserId && msg.receiver_id === activeChat.id);
        }

        if (shouldAdd) {
          setMessages((prev) => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          markMessagesAsRead();
          scrollToBottom();
        }
      }).subscribe();

    return () => { 
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisChange);
      supabase.removeChannel(channel); 
      (window as any).currentChatUserId = null; 
      setChatLocation(currentUserId, null);
    };
  }, [activeChat.id, currentUserId]);

  const sendSpecialMessage = async (mediaUrl: string | null, mediaType: 'image' | 'audio' | 'location', contentStr: string = '') => {
    const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const temp = { id: msgId, sender_id: currentUserId, receiver_id: activeChat.isGroup ? null : activeChat.id, group_chat_id: activeChat.isGroup ? activeChat.id : null, content: contentStr, media_url: mediaUrl, media_type: mediaType, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, temp]);
    scrollToBottom();
    try {
      const { data, error } = await supabase.from('messages').insert({ sender_id: currentUserId, receiver_id: activeChat.isGroup ? null : activeChat.id, group_chat_id: activeChat.isGroup ? activeChat.id : null, content: contentStr, media_url: mediaUrl, media_type: mediaType }).select().single();
      if (error) throw error;
      setMessages(prev => prev.map(m => m.id === temp.id ? data : m));
      if (!activeChat.isGroup) {
        checkRecipientPresenceAndNotify(currentUserId, activeChat.id, currentUserId, data);
      } else {
        const participantIds = activeChat.participants?.map((p: any) => p.id || p.user_id) || [];
        if (participantIds.length > 0) {
          checkGroupPresenceAndNotify(currentUserId, activeChat.id, participantIds, data);
        }
      }
    } catch (e: any) { 
      console.error("sendSpecialMessage error", e);
      setMessages(prev => prev.filter(m => m.id !== temp.id)); 
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSendingRef.current) return;
    isSendingRef.current = true;
    const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const temp = { id: msgId, sender_id: currentUserId, receiver_id: activeChat.isGroup ? null : activeChat.id, group_chat_id: activeChat.isGroup ? activeChat.id : null, content: newMessage.trim(), created_at: new Date().toISOString() };
    setMessages(prev => [...prev, temp]);
    const storedContent = newMessage.trim();
    setNewMessage('');
    scrollToBottom();
    setTimeout(() => {
      const textarea = document.querySelector('textarea[placeholder="Message..."]') as HTMLElement;
      if (textarea) textarea.focus();
    }, 10);
    try {
      const { data, error } = await supabase.from('messages').insert({ sender_id: currentUserId, receiver_id: activeChat.isGroup ? null : activeChat.id, group_chat_id: activeChat.isGroup ? activeChat.id : null, content: storedContent }).select().single();
      if (error) {
        console.error("handleSendMessage error:", error);
        throw error;
      }
      setMessages(prev => prev.map(m => m.id === temp.id ? data : m));
      // Trigger notification for 1-on-1 chats
      if (!activeChat.isGroup) {
        checkRecipientPresenceAndNotify(currentUserId, activeChat.id, currentUserId, data);
      } else {
        const participantIds = activeChat.participants?.map((p: any) => p.id || p.user_id) || [];
        if (participantIds.length > 0) {
          checkGroupPresenceAndNotify(currentUserId, activeChat.id, participantIds, data);
        }
      }
    } catch (e: any) { 
      console.error("handleSendMessage exception:", e);
      alert("Failed to send message: " + e.message);
      setMessages(prev => prev.filter(m => m.id !== temp.id)); 
      setNewMessage(storedContent);
    } finally {
      isSendingRef.current = false;
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

  const handleMediaMessage = async (file: File | Blob, type: 'image' | 'audio' | 'location') => {
    setUploadingMedia(true);
    setShowFeatures(false);
    try {
      const url = await uploadToCloudinary(file, type === 'audio' ? 'video' : 'image');
      await sendSpecialMessage(url, type);
    } catch (e) {
      alert('Upload failed: ' + (e as Error).message);
    } finally { setUploadingMedia(false); }
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

  const handleDeleteMessage = async () => {
    if (!contextMenu?.message) return;
    const msgId = contextMenu.message.id;
    setContextMenu(null);
    setMessages(prev => prev.filter(m => m.id !== msgId));
    await supabase.from('messages').delete().eq('id', msgId);
  };

  const saveToDevice = async (url: string, filename: string, mediaType?: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const fileExt = mediaType === 'audio' ? 'webm' : 'jpg';
      const file = new File([blob], `${filename}.${fileExt}`, { type: blob.type });
      
      const blobUrl = window.URL.createObjectURL(blob);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
        } catch (shareErr: any) {
          if (shareErr.name === 'AbortError' || shareErr.message?.toLowerCase().includes('cancel')) {
            window.URL.revokeObjectURL(blobUrl);
            return;
          }
          // Same-origin safe fallback to prevent page redirects
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = `${filename}.${fileExt}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } else {
        // Same-origin safe fallback
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${filename}.${fileExt}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error("Save to device error:", e);
    }
  };

  const handleLongPress = (e: any, msg: any) => {
    if (!msg) return setContextMenu(null);
    
    // Toggle active date on longpress
    setActiveDateMsgId(prev => prev === msg.id ? null : msg.id);

    const isCall = msg.media_type === "call_audio" || msg.media_type === "call_video";
    if (isCall) {
      if (navigator.vibrate) navigator.vibrate(5);
      return;
    }

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    e.preventDefault();
    if (navigator.vibrate) navigator.vibrate(10);
    const el = document.getElementById(`msg-inner-${msg.id}`);
    if (el) {
      const rect = el.getBoundingClientRect();
      const isMineMsg = msg.sender_id === currentUserId;
      let suggestedX = isMineMsg ? rect.left - 200 : rect.right + 10;
      let suggestedY = rect.top;
      const clampedX = Math.max(10, Math.min(suggestedX, window.innerWidth - 170));
      const clampedY = Math.max(10, Math.min(suggestedY, window.innerHeight - 250));
      setContextMenu({ x: clampedX, y: clampedY, message: msg });
    }
  };

  const onTouchStart = (e: any, msg: any) => {
    if (longPressTimer) clearTimeout(longPressTimer);
    setLongPressTimer(setTimeout(() => handleLongPress(e, msg), 500));
  };
  const onTouchMove = () => { if (longPressTimer) { clearTimeout(longPressTimer); setLongPressTimer(null); } };
  const onTouchEnd = () => { if (longPressTimer) { clearTimeout(longPressTimer); setLongPressTimer(null); } };

  return {
    messages, loadingMessages, hasMoreMessages, pullProgress, isPulling, setIsPulling, setPullProgress, fetchMessages,
    newMessage, setNewMessage, handleSendMessage, showFeatures, setShowFeatures,
    isRecording, recordingDuration, startRecording, stopRecording, handleLocationShare,
    cameraInputRef, fileInputRef, uploadingMedia, pendingMedia, setPendingMedia, handleMediaMessage,
    messagesEndRef, scrollContainerRef, viewingImage, setViewingImage, contextMenu,
    handleLongPress, handleDeleteMessage, saveToDevice, onTouchStart, onTouchMove, onTouchEnd,
    activeDateMsgId, setActiveDateMsgId
  };
}
