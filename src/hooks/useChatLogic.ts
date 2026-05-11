import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Profile } from '@/src/types';
import { setChatLocation, checkRecipientPresenceAndNotify } from '@/src/lib/presence';

let chatConnectionsCache: any[] | null = null;
let lastChatListFetch = 0;
let chatMessagesCache: Record<string, any[]> = {};
let lastChatMessagesFetch: Record<string, number> = {};

export function useChatLogic(currentUserId: string, initialActiveChat?: Profile | null) {
  const [connections, setConnections] = useState<(Profile & { lastMessage?: any, unreadCount?: number })[]>(chatConnectionsCache || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChat, setActiveChat] = useState<Profile | null>(initialActiveChat || null);
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
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, message: any } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<any>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    if (smooth) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, []);

  const updateConnectionLastMessage = useCallback((newMessage: any, partnerId: string, incrementUnread: boolean) => {
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
  }, []);

  const markMessagesAsRead = useCallback(async (senderId: string) => {
    setConnections(prev => prev.map(c => c.id === senderId ? { ...c, unreadCount: 0 } : c));
    window.dispatchEvent(new CustomEvent('forceGetUnread'));
    await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', senderId).eq('receiver_id', currentUserId).is('read_at', null);
  }, [currentUserId]);

  const fetchMessages = useCallback(async (otherUserId: string, loadOld = false, currentOffset = 0) => {
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
  }, [markMessagesAsRead, scrollToBottom]);

  const fetchConnectionsAndRecentMessages = useCallback(async () => {
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
  }, [currentUserId]);

  const handleDeleteMessage = useCallback(async () => {
    if (!contextMenu?.message) return;
    const msgId = contextMenu.message.id;
    const otherUserId = activeChat?.id;
    setContextMenu(null);
    setMessages(prev => {
        const newMsgs = prev.filter(m => m.id !== msgId);
        if (otherUserId) chatMessagesCache[otherUserId] = newMsgs;
        return newMsgs;
    });
    await supabase.from('messages').delete().eq('id', msgId);
  }, [contextMenu, activeChat]);

  const handleSendMessage = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newMessage.trim() || !activeChat) return;
    const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const temp = { id: msgId, sender_id: currentUserId, receiver_id: activeChat.id, content: newMessage.trim(), created_at: new Date().toISOString() };
    
    setMessages(prev => { 
        const nm = [...prev, temp]; 
        chatMessagesCache[activeChat.id] = nm; 
        return nm; 
    });
    updateConnectionLastMessage(temp, activeChat.id, false);
    setNewMessage('');
    scrollToBottom();
    try {
      const { data, error } = await supabase.from('messages').insert({ sender_id: currentUserId, receiver_id: activeChat.id, content: temp.content }).select().single();
      if (error) throw error;
      setMessages(prev => prev.map(m => m.id === temp.id ? data : m));
      updateConnectionLastMessage(data, activeChat.id, false);
      checkRecipientPresenceAndNotify(currentUserId, activeChat.id, data);
    } catch (e) { setMessages(prev => prev.filter(m => m.id !== temp.id)); }
  }, [newMessage, activeChat, currentUserId, updateConnectionLastMessage, scrollToBottom]);

  const sendSpecialMessage = useCallback(async (mediaUrl: string | null, mediaType: 'image' | 'audio' | 'location', contentStr: string = '') => {
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
      checkRecipientPresenceAndNotify(currentUserId, activeChat.id, data);
    } catch (e) { setMessages(prev => prev.filter(m => m.id !== temp.id)); }
  }, [activeChat, currentUserId, updateConnectionLastMessage, scrollToBottom]);

  // Effects
  useEffect(() => {
    if (activeChat) {
      setChatLocation(currentUserId, activeChat.id);
      (window as any).currentChatUserId = activeChat.id;
      
      const handleVisChange = () => {
        if (document.visibilityState === 'visible') {
           setChatLocation(currentUserId, activeChat.id);
        }
      };
      document.addEventListener('visibilitychange', handleVisChange);

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
        document.removeEventListener('visibilitychange', handleVisChange);
        supabase.removeChannel(channel); 
        (window as any).currentChatUserId = null; 
        setChatLocation(currentUserId, null);
      };
    } else {
      (window as any).currentChatUserId = null; 
      setChatLocation(currentUserId, null);
    }
  }, [activeChat, currentUserId, fetchMessages, markMessagesAsRead, scrollToBottom]);

  useEffect(() => {
    const mainChannel = supabase.channel('global_messages').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${currentUserId}` }, (payload) => {
      const newMessage = payload.new;
      const isCurrentlyActive = (window as any).currentChatUserId === newMessage.sender_id;
      updateConnectionLastMessage(newMessage, newMessage.sender_id, !isCurrentlyActive);
      window.dispatchEvent(new CustomEvent('forceGetUnread'));
    }).subscribe();
    return () => { supabase.removeChannel(mainChannel); };
  }, [currentUserId, updateConnectionLastMessage]);

  useEffect(() => {
    if (!chatConnectionsCache || Date.now() - lastChatListFetch > 60000) fetchConnectionsAndRecentMessages();
  }, [currentUserId, fetchConnectionsAndRecentMessages]);

  useEffect(() => {
    if (initialActiveChat !== undefined) {
      setActiveChat(initialActiveChat); 
    }
  }, [initialActiveChat]);

  return {
    connections, setConnections,
    searchQuery, setSearchQuery,
    activeChat, setActiveChat,
    messages, setMessages,
    newMessage, setNewMessage,
    loading, loadingMessages,
    hasMoreMessages,
    pullProgress, setPullProgress,
    isPulling, setIsPulling,
    showFeatures, setShowFeatures,
    isRecording, setIsRecording,
    recordingDuration, setRecordingDuration,
    uploadingMedia, setUploadingMedia,
    pendingMedia, setPendingMedia,
    viewingImage, setViewingImage,
    contextMenu, setContextMenu,
    messagesEndRef, scrollContainerRef,
    fileInputRef, cameraInputRef,
    mediaRecorderRef, audioChunksRef,
    recordingIntervalRef,
    fetchMessages,
    handleDeleteMessage,
    handleSendMessage,
    sendSpecialMessage,
    fetchConnectionsAndRecentMessages,
    scrollToBottom
  };
}
