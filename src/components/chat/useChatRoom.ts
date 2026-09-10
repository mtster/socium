import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/src/lib/supabase';
import { setChatLocation, checkRecipientPresenceAndNotify, checkGroupPresenceAndNotify } from '@/src/lib/presence';
import { ChatListItemType } from '@/src/types/chat';
import { invalidateVaultCache, vaultCache } from './VaultModal';
import { optimizePostOrChatImage } from '@/src/lib/cropImage';
import { 
  extractVideoThumbnail, 
  analyzeVideoForCloudinary, 
  applyCloudinaryVideoTransformation 
} from '@/src/lib/videoCompression';
import { videoLog } from '@/src/lib/videoLogger';

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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatusText, setUploadStatusText] = useState<string | null>(null);
  const [pendingMedia, setPendingMedia] = useState<{file: File | Blob | null, type: 'image' | 'video' | 'audio' | 'location', dataUrl?: string, locationString?: string} | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [viewingVideo, setViewingVideo] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, message: any } | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<any>(null);
  const [vaultedMessageIds, setVaultedMessageIds] = useState<Set<string>>(new Set());

  const fetchVaultedMessageIds = async () => {
    try {
      let query = supabase
        .from('messages')
        .select(`
          id,
          vault_messages!inner (
            id
          )
        `);
      if (activeChat.isGroup) {
        query = query.eq('group_chat_id', activeChat.id);
      } else {
        query = query
          .is('group_chat_id', null)
          .or(`and(sender_id.eq.${activeChat.id},receiver_id.eq.${currentUserId}),and(sender_id.eq.${currentUserId},receiver_id.eq.${activeChat.id})`);
      }

      const { data, error } = await query;
      if (error) {
        console.error('fetchVaultedMessageIds error:', error);
      } else if (data) {
        setVaultedMessageIds(new Set(data.map((m: any) => m.id)));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddToVault = async (messageId: string) => {
    try {
      const { data, error } = await supabase.from('vault_messages').insert({
        message_id: messageId,
        added_by: currentUserId
      }).select().single();
      
      if (error) {
        console.error('handleAddToVault error:', error);
      } else if (data) {
        // Optimistically add to cached list in memory
        const messageObj = messages.find(m => m.id === messageId);
        if (messageObj && vaultCache[activeChat.id]) {
          const cached = vaultCache[activeChat.id];
          if (!cached.vaultItems.some(item => item.message_id === messageId)) {
            const newItem = {
              id: data.id,
              created_at: data.created_at,
              message_id: messageId,
              messages: messageObj
            };
            cached.vaultItems = [newItem, ...cached.vaultItems];
          }
        }
        setVaultedMessageIds(prev => {
          const next = new Set(prev);
          next.add(messageId);
          return next;
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemoveFromVault = async (messageId: string) => {
    try {
      const { error } = await supabase.from('vault_messages').delete().eq('message_id', messageId);
      if (error) {
        console.error('handleRemoveFromVault error:', error);
      } else {
        // Optimistically remove from cached list in memory
        if (vaultCache[activeChat.id]) {
          vaultCache[activeChat.id].vaultItems = vaultCache[activeChat.id].vaultItems.filter(
            item => item.message_id !== messageId
          );
        }
        setVaultedMessageIds(prev => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    } catch (e) {
      console.error(e);
    }
  };
  
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
    
    const handleVisChange = () => { 
      if (document.visibilityState === 'visible') {
        setChatLocation(currentUserId, activeChat.id);
        fetchMessages();
      }
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisChange);

    const handleRefreshActiveChat = (e: any) => {
      if (e.detail?.chatId === activeChat.id) {
        fetchMessages();
      }
    };
    window.addEventListener('refreshActiveChat', handleRefreshActiveChat);

    fetchMessages();
    fetchVaultedMessageIds();

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

    const vaultChannel = supabase.channel(`chat_vault_${activeChat.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vault_messages' }, () => {
        fetchVaultedMessageIds();
      }).subscribe();

    return () => { 
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisChange);
      window.removeEventListener('refreshActiveChat', handleRefreshActiveChat);
      supabase.removeChannel(channel); 
      supabase.removeChannel(vaultChannel);
      (window as any).currentChatUserId = null; 
      setChatLocation(currentUserId, null);
    };
  }, [activeChat.id, currentUserId]);

  const sendSpecialMessage = async (
    mediaUrl: string | null, 
    mediaType: 'image' | 'video' | 'audio' | 'location', 
    contentStr: string = '',
    metadata: any = null
  ) => {
    const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const temp = { id: msgId, sender_id: currentUserId, receiver_id: activeChat.isGroup ? null : activeChat.id, group_chat_id: activeChat.isGroup ? activeChat.id : null, content: contentStr, media_url: mediaUrl, media_type: mediaType, metadata: metadata, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, temp]);
    scrollToBottom();
    try {
      const { data, error } = await supabase.from('messages').insert({ 
        sender_id: currentUserId, 
        receiver_id: activeChat.isGroup ? null : activeChat.id, 
        group_chat_id: activeChat.isGroup ? activeChat.id : null, 
        content: contentStr, 
        media_url: mediaUrl, 
        media_type: mediaType,
        metadata: metadata
      }).select().single();
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
    (document.activeElement as HTMLElement)?.blur();
    isSendingRef.current = true;
    const msgId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const temp = { id: msgId, sender_id: currentUserId, receiver_id: activeChat.isGroup ? null : activeChat.id, group_chat_id: activeChat.isGroup ? activeChat.id : null, content: newMessage.trim(), created_at: new Date().toISOString() };
    setMessages(prev => [...prev, temp]);
    const storedContent = newMessage.trim();
    setNewMessage('');
    scrollToBottom();
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

  const uploadToCloudinary = async (
    file: File | Blob, 
    type: 'image' | 'video' | 'audio' | 'auto',
    options?: { 
      skipClientOptimization?: boolean; 
      rawUrl?: boolean; 
      preset?: string;
      onProgress?: (percent: number, statusText?: string) => void;
    }
  ): Promise<string> => {
    const uploadStart = performance.now();
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const defaultPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    const videoPreset = import.meta.env.VITE_CLOUDINARY_VIDEO_UPLOAD_PRESET || defaultPreset;
    const uploadPreset = options?.preset || (type === 'video' ? videoPreset : defaultPreset);

    if (!cloudName || !uploadPreset) {
      videoLog.error('Cloudinary config missing: VITE_CLOUDINARY_CLOUD_NAME or VITE_CLOUDINARY_UPLOAD_PRESET is not defined');
      throw new Error('Cloudinary config missing');
    }

    let fileToUpload = file;
    if (!options?.skipClientOptimization) {
      if (type === 'image') {
        fileToUpload = await optimizePostOrChatImage(file, 'chat_image.webp');
      }
    }

    const formData = new FormData();
    const fileName = fileToUpload instanceof File && fileToUpload.name 
      ? fileToUpload.name 
      : (type === 'image' ? 'upload.webp' : (type === 'video' ? 'video.mp4' : 'upload.bin'));
    formData.append('file', fileToUpload, fileName);
    formData.append('upload_preset', uploadPreset);
    if (type === 'image') formData.append('folder', 'chat_images');
    else if (type === 'video') formData.append('folder', 'chat_videos');
    else if (type === 'audio') formData.append('folder', 'chat_audio');
    
    // For iOS audio (m4a/mp4) or video, Cloudinary uses /video/upload endpoint
    let resourceType = type;
    if (type === 'audio' || fileToUpload.type.includes('mp4') || fileToUpload.type.includes('m4a') || fileToUpload.type.includes('webm')) {
      resourceType = 'video';
    }

    const payloadKb = (fileToUpload.size / 1024).toFixed(1);
    const payloadMb = (fileToUpload.size / (1024 * 1024)).toFixed(2);
    videoLog.info(`☁️ [Cloudinary Upload] Uploading ${type} (${payloadKb} KB / ${payloadMb} MB) with preset "${uploadPreset}" to folder: chat_${type === 'image' ? 'images' : 'videos'}...`, {
      resourceType,
      fileName,
      mimeType: fileToUpload.type,
      uploadPreset
    });

    // Dynamic timeout calculation:
    // Large videos on mobile connections (e.g. 14MB+ on cellular uplinks) need sufficient time.
    // Minimum 5 minutes (300,000 ms) for videos, up to 10 minutes (600,000 ms).
    // Images/Audio: 90 seconds.
    const timeoutDurationMs = type === 'video'
      ? Math.min(600000, Math.max(300000, Math.ceil(fileToUpload.size / (25 * 1024)) * 1000))
      : 90000;

    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, true);
      xhr.timeout = timeoutDurationMs;

      let lastLoggedPercent = 0;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const rawPercent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          if (rawPercent >= 100) {
            // Bytes transferred over network, server is now ingesting/saving
            if (options?.onProgress) {
              options.onProgress(82, 'Processing on server...');
            }
          } else {
            // Map byte transfer smoothly to 10% - 80%
            const mapped = Math.round(10 + rawPercent * 0.70);
            if (options?.onProgress) {
              options.onProgress(mapped, `Uploading ${type === 'video' ? 'video' : type} ${rawPercent}%`);
            }
          }
          if (rawPercent - lastLoggedPercent >= 20 || rawPercent === 100) {
            lastLoggedPercent = rawPercent;
            const loadedMb = (event.loaded / (1024 * 1024)).toFixed(1);
            const totalMb = (event.total / (1024 * 1024)).toFixed(1);
            videoLog.info(`☁️ [Cloudinary Upload] Progress: ${rawPercent}% (${loadedMb}/${totalMb} MB)`);
          }
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            const uploadElapsed = ((performance.now() - uploadStart) / 1000).toFixed(2);
            videoLog.success(`☁️ [Cloudinary Upload] Finished in ${uploadElapsed}s!`, {
              url: data.secure_url,
              bytes: data.bytes,
              format: data.format
            });
            resolve(data.secure_url);
          } catch (jsonErr) {
            videoLog.error('☁️ [Cloudinary Upload] Invalid JSON response:', xhr.responseText);
            reject(new Error('Invalid response from upload server'));
          }
        } else {
          let errMsg = `Upload failed with status ${xhr.status}`;
          try {
            const errJson = JSON.parse(xhr.responseText);
            if (errJson?.error?.message) {
              errMsg = errJson.error.message;
            }
          } catch {}
          videoLog.error(`☁️ [Cloudinary Upload] Upload failed with status ${xhr.status}:`, errMsg);
          reject(new Error(`Upload failed: ${errMsg}`));
        }
      };

      xhr.onerror = () => {
        videoLog.error('☁️ [Cloudinary Upload] Network error during upload');
        reject(new Error('Network error during media upload. Please check your internet connection and try again.'));
      };

      xhr.ontimeout = () => {
        const timeoutSec = Math.round(timeoutDurationMs / 1000);
        videoLog.error(`☁️ [Cloudinary Upload] Timed out after ${timeoutSec}s`);
        reject(new Error(`Video upload timed out after ${timeoutSec}s. Your connection may be slow for a ${payloadMb} MB file. Please check your network and try again.`));
      };

      xhr.onabort = () => {
        videoLog.warn('☁️ [Cloudinary Upload] Upload was aborted');
        reject(new Error('Upload was aborted'));
      };

      xhr.send(formData);
    });
  };

  const handleMediaMessage = async (file: File | Blob, type: 'image' | 'video' | 'audio' | 'location') => {
    const pipelineStart = performance.now();
    videoLog.info(`🚀 [PIPELINE START] User initiated ${type} message send`, {
      name: file instanceof File ? file.name : 'blob',
      sizeMb: (file.size / (1024 * 1024)).toFixed(2),
      mime: file.type
    });

    setUploadingMedia(true);
    setUploadProgress(5);
    setUploadStatusText(`Preparing ${type}...`);
    setShowFeatures(false);
    try {
      if (type === 'video') {
        // 1. Analyze video specifications for Cloudinary optimization (~30ms)
        setUploadStatusText('Analyzing video specs...');
        videoLog.info('🎞️ [PIPELINE STEP 1/3] Analyzing video specifications for Cloudinary...');
        const analysis = await analyzeVideoForCloudinary(file);
        videoLog.info('📊 [Cloudinary Video Strategy]', {
          category: analysis.category,
          resolution: `${analysis.width}x${analysis.height}`,
          duration: `${analysis.durationSec.toFixed(1)}s`,
          sourceBitrate: `${Math.round(analysis.sourceBitrateBps / 1000)} kbps`,
          needsTransformation: analysis.needsTransformation,
          transformation: analysis.transformationString,
          reason: analysis.reason
        });

        // 2. Upload video file to Cloudinary with accurate stage-based progress tracking
        setUploadProgress(10);
        setUploadStatusText('Uploading video 0%');
        videoLog.info('☁️ [PIPELINE STEP 2/3] Uploading video to Cloudinary...');
        const rawVideoUrl = await uploadToCloudinary(file, 'video', { 
          skipClientOptimization: true,
          onProgress: (percent, status) => {
            setUploadProgress(percent);
            if (status) setUploadStatusText(status);
          }
        });

        // Apply Cloudinary 480p 30fps optimal delivery transformation to URL (if needed)
        const finalVideoUrl = analysis.transformationString
          ? applyCloudinaryVideoTransformation(rawVideoUrl, analysis.transformationString)
          : rawVideoUrl;

        videoLog.success('🎬 [Cloudinary Video Ready]', {
          rawVideoUrl,
          finalVideoUrl,
          mode: analysis.transformationString ? 'Transformed (480p 30fps optimized)' : 'Original Preserved (already optimal)'
        });

        // 3. Video upload and transformation succeeded!
        // ONLY NOW create and upload the thumbnail (strictly guarantees no orphan thumbnails if video fails)
        setUploadProgress(85);
        setUploadStatusText('Generating preview...');
        let thumbnailUrl: string | null = null;
        try {
          videoLog.info('📸 [PIPELINE STEP 3/3] Creating and uploading thumbnail...');
          const thumbBlob = await extractVideoThumbnail(file);
          const thumbFile = new File([thumbBlob], 'thumbnail.webp', { type: 'image/webp' });
          setUploadProgress(90);
          setUploadStatusText('Saving preview...');
          thumbnailUrl = await uploadToCloudinary(thumbFile, 'image', { skipClientOptimization: true, rawUrl: true });
          videoLog.success('📸 [Thumbnail Uploaded]', { thumbnailUrl });
        } catch (thumbErr) {
          videoLog.warn('📸 [Thumbnail Pipeline] Thumbnail creation or upload skipped:', thumbErr);
        }

        // 4. Send message record with finalVideoUrl and thumbnail_url metadata
        setUploadProgress(96);
        setUploadStatusText('Sending message...');
        const metadata = thumbnailUrl ? { thumbnail_url: thumbnailUrl } : null;
        await sendSpecialMessage(finalVideoUrl, 'video', '', metadata);

        setUploadProgress(100);
        setUploadStatusText('Sent!');
        const totalElapsed = ((performance.now() - pipelineStart) / 1000).toFixed(2);
        videoLog.success(`🎉 [PIPELINE COMPLETE] Video sent successfully in ${totalElapsed}s!`);
      } else {
        const uploadType = type === 'audio' ? 'video' : 'image';
        setUploadProgress(10);
        setUploadStatusText(`Uploading ${type}...`);
        const url = await uploadToCloudinary(file, uploadType, {
          onProgress: (percent, status) => {
            setUploadProgress(percent);
            if (status) setUploadStatusText(status);
          }
        });
        setUploadProgress(95);
        setUploadStatusText('Sending message...');
        await sendSpecialMessage(url, type);
        setUploadProgress(100);
        setUploadStatusText('Sent!');
      }
    } catch (e: any) {
      videoLog.error('❌ [PIPELINE FAILED] Error during media sending:', e);
      const msg = (e as Error)?.message || 'Unknown error occurred during media sending';
      alert(msg.startsWith('Upload failed:') ? msg : `Upload failed: ${msg}`);
    } finally { 
      setUploadingMedia(false); 
      setUploadProgress(null);
      setUploadStatusText(null);
    }
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
      let fetchUrl = url;
      // Strip any transformation segments in Cloudinary URLs to always fetch the raw original asset
      if (fetchUrl.includes('cloudinary.com') && fetchUrl.includes('/upload/')) {
        fetchUrl = fetchUrl.replace(/\/upload\/(?:[a-zA-Z0-9_,:-]+\/)+/, '/upload/');
      }

      const res = await fetch(fetchUrl);
      const blob = await res.blob();
      
      let fileExt = 'webp';
      if (mediaType === 'video' || blob.type.startsWith('video/')) {
        fileExt = blob.type.includes('webm') ? 'webm' : 'mp4';
      } else if (mediaType === 'audio' || blob.type.startsWith('audio/')) {
        fileExt = blob.type.includes('mp4') || blob.type.includes('m4a') ? 'm4a' : 'webm';
      } else if (blob.type === 'image/png') {
        fileExt = 'png';
      } else if (blob.type === 'image/jpeg' || blob.type === 'image/jpg') {
        fileExt = 'jpg';
      } else {
        fileExt = 'webp';
      }

      const mimeType = fileExt === 'webp' ? 'image/webp' : fileExt === 'mp4' ? 'video/mp4' : blob.type || 'application/octet-stream';
      const file = new File([blob], `${filename}.${fileExt}`, { type: mimeType });
      
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
    cameraInputRef, fileInputRef, uploadingMedia, uploadProgress, uploadStatusText, pendingMedia, setPendingMedia, handleMediaMessage,
    messagesEndRef, scrollContainerRef, viewingImage, setViewingImage, viewingVideo, setViewingVideo, contextMenu,
    handleLongPress, handleDeleteMessage, saveToDevice, onTouchStart, onTouchMove, onTouchEnd,
    activeDateMsgId, setActiveDateMsgId,
    vaultedMessageIds, handleAddToVault, handleRemoveFromVault, fetchVaultedMessageIds
  };
}
