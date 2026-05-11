import React, { useEffect, useCallback } from 'react';
import { Profile } from '@/src/types';
import { useChatLogic } from '@/src/hooks/useChatLogic';
import { ChatList } from './chat/ChatList';
import { ChatRoom } from './chat/ChatRoom';
import { AnimatePresence } from 'motion/react';

interface ChatProps {
  currentUserId: string;
  initialActiveChat?: Profile | null;
  onCloseChat?: () => void;
  onChatStateChange?: (isOpen: boolean) => void;
}

export default function Chat({ currentUserId, initialActiveChat, onCloseChat, onChatStateChange }: ChatProps) {
  const chat = useChatLogic(currentUserId, initialActiveChat);

  useEffect(() => {
    onChatStateChange?.(!!chat.activeChat);
  }, [chat.activeChat, onChatStateChange]);

  const uploadToCloudinary = async (file: File | Blob, type: 'image' | 'video' | 'audio' | 'auto') => {
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) throw new Error('Cloudinary config missing');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    if (type === 'image') formData.append('folder', 'chat_images');
    else if (type === 'video') formData.append('folder', 'chat_audio'); 
    
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
      chat.mediaRecorderRef.current = mediaRecorder;
      chat.audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) chat.audioChunksRef.current.push(event.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chat.audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/mp4' });
        chat.setPendingMedia({ file: audioBlob, type: 'audio', dataUrl: URL.createObjectURL(audioBlob) });
        stream.getTracks().forEach(track => track.stop());
        chat.setShowFeatures(false);
      };
      mediaRecorder.start();
      chat.setIsRecording(true);
      chat.setRecordingDuration(0);
      chat.recordingIntervalRef.current = setInterval(() => chat.setRecordingDuration(prev => prev + 1), 1000);
    } catch (e) { alert('Could not access microphone'); }
  };

  const stopRecording = () => {
    if (chat.mediaRecorderRef.current && chat.isRecording) { 
      chat.mediaRecorderRef.current.stop(); 
      chat.setIsRecording(false); 
      clearInterval(chat.recordingIntervalRef.current); 
    }
  };

  const handleLocationShare = () => {
    if (!navigator.geolocation) return alert("Geolocation is not supported");
    chat.setUploadingMedia(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      const locUrl = `https://www.google.com/maps/search/?api=1&query=${pos.coords.latitude},${pos.coords.longitude}`;
      chat.setNewMessage(chat.newMessage + (chat.newMessage.length > 0 ? ' ' : '') + locUrl);
      chat.setShowFeatures(false);
      chat.setUploadingMedia(false);
    }, () => { alert('Could not get location'); chat.setUploadingMedia(false); }, { enableHighAccuracy: true });
  };

  const handleMediaMessage = async (file: File | Blob, type: 'image' | 'audio') => {
    chat.setUploadingMedia(true);
    chat.setShowFeatures(false);
    try {
      const url = await uploadToCloudinary(file, type === 'audio' ? 'video' : 'image');
      await chat.sendSpecialMessage(url, type);
    } catch (e: any) {
      alert('Upload failed: ' + e.message);
    } finally { chat.setUploadingMedia(false); }
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

  return (
    <div className="flex-1 flex flex-col h-full bg-black overflow-hidden relative">
      <ChatList 
        connections={chat.connections}
        searchQuery={chat.searchQuery}
        onSearchChange={chat.setSearchQuery}
        onChatSelect={chat.setActiveChat}
      />

      <AnimatePresence initial={false}>
        {chat.activeChat && (
          <ChatRoom 
            {...chat}
            activeChat={chat.activeChat}
            currentUserId={currentUserId}
            onBack={() => { chat.setActiveChat(null); onCloseChat?.(); }}
            onCloseChat={onCloseChat}
            handleDeleteMessage={chat.handleDeleteMessage}
            handleSendMessage={chat.handleSendMessage}
            handleMediaMessage={handleMediaMessage}
            handleLocationShare={handleLocationShare}
            startRecording={startRecording}
            stopRecording={stopRecording}
            saveToDevice={saveToDevice}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
