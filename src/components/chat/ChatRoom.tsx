import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, SendHorizonal, Camera, Image as ImageIcon, Mic, MapPin, X, Download, Copy, Trash2, Phone, Video } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { MessageBubble } from './MessageBubble';
import { AudioPlayer } from './AudioPlayer';
import { useChatRoom } from './useChatRoom';
import { ChatListItemType } from '@/src/types/chat';

import { parseLocation, openInAppleMaps, openInGoogleMaps } from './locationUtils';

interface ChatRoomProps {
  currentUserId: string;
  activeChat: ChatListItemType;
  onClose: () => void;
  onOpenProfile: (id: string) => void;
  openSettings: () => void;
}

export function ChatRoom({ currentUserId, activeChat, onClose, onOpenProfile, openSettings }: ChatRoomProps) {
  const {
    messages,
    loadingMessages,
    hasMoreMessages,
    pullProgress,
    isPulling,
    setIsPulling,
    setPullProgress,
    fetchMessages,
    newMessage,
    setNewMessage,
    handleSendMessage,
    showFeatures,
    setShowFeatures,
    isRecording,
    recordingDuration,
    startRecording,
    stopRecording,
    handleLocationShare,
    cameraInputRef,
    fileInputRef,
    uploadingMedia,
    pendingMedia,
    setPendingMedia,
    handleMediaMessage,
    messagesEndRef,
    scrollContainerRef,
    viewingImage,
    setViewingImage,
    contextMenu,
    handleLongPress,
    handleDeleteMessage,
    saveToDevice,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    activeDateMsgId,
    setActiveDateMsgId
  } = useChatRoom(currentUserId, activeChat);

  return (
    <>
      <motion.div 
         key="chat-room" 
         initial={{ x: '100%', opacity: 1 }} 
         animate={{ x: 0, opacity: 1 }} 
         exit={{ x: '100%', opacity: 1 }} 
         transition={{ type: 'tween', duration: 0.35, ease: 'easeOut' }} 
         className="fixed inset-0 z-[60] flex flex-col bg-black w-full border-white/5 overflow-hidden select-none [user-select:none] [-webkit-user-select:none] [-webkit-touch-callout:none]"
      >
        <div className="p-4 pt-safe flex items-center gap-4 border-b border-white/10 bg-black/80 backdrop-blur-xl shrink-0">
           <button onClick={onClose} className="p-2 -ml-2 text-white/80 active:scale-90 transition-transform"><ArrowLeft size={24} /></button>
           <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => activeChat.isGroup ? openSettings() : onOpenProfile(activeChat.id)}>
              <div className={cn("w-8 h-8 shrink-0 flex items-center justify-center relative", (activeChat.avatar_url || !activeChat.isGroup) ? "rounded-full overflow-hidden bg-white/10 border border-white/10" : "")}>
                {activeChat.isGroup ? (
                   <div className="w-full h-full relative">
                     {activeChat.avatar_url ? (
                       <img src={activeChat.avatar_url} className="w-full h-full object-cover" />
                     ) : activeChat.participants && activeChat.participants.length > 0 ? (
                       activeChat.participants.slice(0,3).map((p, i, arr) => (
                         <div key={i} className={cn("absolute rounded-full border border-black overflow-hidden bg-white/20", arr.length === 1 ? "inset-0" : arr.length === 2 ? (i === 0 ? "top-0 left-0 w-6 h-6" : "bottom-0 right-0 w-6 h-6") : (i === 0 ? "top-0 left-1/2 -translate-x-1/2 w-5 h-5 z-20" : i === 1 ? "bottom-0 left-0 w-5 h-5 z-10" : "bottom-0 right-0 w-5 h-5 z-10"))}>
                           {p?.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/20 flex items-center justify-center font-bold text-[8px] text-white/70">{(p?.full_name?.charAt(0) || p?.username?.charAt(0) || '?').toUpperCase()}</div>}
                         </div>
                       ))
                     ) : <div className="text-xs w-full h-full flex items-center justify-center">{(activeChat.name?.charAt(0) || '?').toUpperCase()}</div>}
                   </div>
                ) : (
                  activeChat.avatar_url ? <img src={activeChat.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs font-medium text-white/50">{(activeChat.name?.charAt(0) || '?').toUpperCase()}</div>
                )}
              </div>
              <span className="font-bold text-sm text-white/90 truncate flex-1">{activeChat.name}</span>
           </div>

           {/* Call Controls */}
           <div className="flex items-center gap-1 shrink-0 pr-1">
             <button 
               onClick={(e) => {
                 e.stopPropagation();
                 window.dispatchEvent(new CustomEvent('initiateCall', { detail: { chat: activeChat, type: 'audio' } }));
               }} 
               className="p-2 text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all rounded-full"
               title="Audio Call"
             >
               <Phone size={20} />
             </button>
             <button 
               onClick={(e) => {
                 e.stopPropagation();
                 window.dispatchEvent(new CustomEvent('initiateCall', { detail: { chat: activeChat, type: 'video' } }));
               }} 
               className="p-2 text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all rounded-full"
               title="Video Call"
             >
               <Video size={20} />
             </button>
           </div>
        </div>

        <div ref={scrollContainerRef} id="chat-messages-container" className="flex-1 flex flex-col-reverse overflow-y-auto p-4 space-y-1 space-y-reverse relative no-scrollbar [-webkit-overflow-scrolling:touch]" 
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
            if (isPulling && pullProgress >= 1) fetchMessages(true, messages.length);
            setIsPulling(false); setPullProgress(0); (e.currentTarget as any)._pullStartY = null;
          }}
        >
           <div ref={messagesEndRef} className="h-1 shrink-0" />
           <div className="flex flex-col-reverse">
              <AnimatePresence initial={false}>
              {messages.slice().reverse().map((msg, idx, arr) => (
                 <motion.div key={msg.id} initial={{ opacity: 0, scale: 0.95, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
                    <MessageBubble msg={msg} isMine={msg.sender_id === currentUserId} nextMsg={arr[idx - 1]} prevMsg={arr[idx + 1]} activeChat={activeChat} currentUserId={currentUserId} setViewingImage={setViewingImage} handleLongPress={handleLongPress} contextMenuId={contextMenu?.message?.id} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onCloseChat={onClose} onOpenProfile={onOpenProfile} showDate={activeDateMsgId === msg.id} onToggleDate={() => setActiveDateMsgId(prev => prev === msg.id ? null : msg.id)} />
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
               <textarea placeholder="Message..." value={newMessage} onChange={e => setNewMessage(e.target.value)} onFocus={() => setShowFeatures(false)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); } }} className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/40 rounded-[24px] px-4 py-2.5 pr-12 focus:outline-none text-[16px] resize-none min-h-[44px] max-h-[120px] leading-tight" rows={1} style={{ height: newMessage ? 'auto' : '44px' }} />
               <button type="submit"
                  disabled={!newMessage.trim()}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onTouchStart={(e) => {
                    if (newMessage.trim()) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                  className="absolute right-1 w-9 h-9 bg-white text-black rounded-full flex items-center justify-center disabled:opacity-0 transition-all"
                >
                  <SendHorizonal size={18} />
                </button>
             </div>
           </div>
           <AnimatePresence>
             {showFeatures && (
                <motion.div 
                  initial={{ opacity: 0, y: 15, scale: 0.98 }} 
                  animate={{ opacity: 1, y: 0, scale: 1 }} 
                  exit={{ opacity: 0, y: 15, scale: 0.98 }} 
                  transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.9 }}
                  className="mt-4 px-2 pb-2 origin-top"
                >
                  <div className="grid grid-cols-4 gap-4">
                    <button type="button" className="flex flex-col items-center gap-2" onClick={() => cameraInputRef.current?.click()}><div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center"><Camera size={22} /></div><span className="text-[10px] text-white/50">Camera</span></button>
                    <button type="button" className="flex flex-col items-center gap-2" onClick={() => fileInputRef.current?.click()}><div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center"><ImageIcon size={22} /></div><span className="text-[10px] text-white/50">Photos</span></button>
                    <button type="button" className="flex flex-col items-center gap-2" onClick={isRecording ? stopRecording : startRecording}><div className={cn("w-12 h-12 rounded-full border flex items-center justify-center", isRecording ? "bg-red-500/20 border-red-500/50 text-red-500" : "bg-white/10 border-white/10")}>{isRecording ? <div className="w-4 h-4 bg-red-500 rounded-sm" /> : <Mic size={22} />}</div><span className={cn("text-[10px]", isRecording ? "text-red-500" : "text-white/50")}>{isRecording ? `0:${recordingDuration.toString().padStart(2, '0')}` : 'Audio'}</span></button>
                    <button type="button" className="flex flex-col items-center gap-2" onClick={handleLocationShare}><div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 flex items-center justify-center"><MapPin size={22} /></div><span className="text-[10px] text-white/50">Location</span></button>
                  </div>
                </motion.div>
             )}
           </AnimatePresence>
           {uploadingMedia && <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 rounded-t-3xl"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}
           <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setPendingMedia({ file, type: 'image', dataUrl: URL.createObjectURL(file) }); setShowFeatures(false); } e.target.value = ''; }} />
           <input type="file" ref={cameraInputRef} accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setPendingMedia({ file, type: 'image', dataUrl: URL.createObjectURL(file) }); setShowFeatures(false); } e.target.value = ''; }} />
        </form>
      </motion.div>

      <AnimatePresence>
        {pendingMedia && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }} className="absolute inset-0 z-[500] bg-black/95 flex flex-col justify-between backdrop-blur-md overflow-hidden">
            <div className="p-4 pt-[env(safe-area-inset-top)] flex items-center justify-between z-10 shrink-0">
              <button onClick={() => setPendingMedia(null)} className="w-10 h-10 bg-white/20 text-white rounded-full flex items-center justify-center backdrop-blur shadow-lg active:scale-90 transition-transform"><X size={24} /></button>
              <h2 className="text-white font-bold tracking-wide uppercase text-xs bg-black/40 px-4 py-2 rounded-full backdrop-blur">Send {pendingMedia.type}</h2>
              <div className="w-10" />
            </div>
            
            <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-4 pb-24 relative">
              {pendingMedia.type === 'image' && <img src={pendingMedia.dataUrl} className="max-w-full max-h-full object-contain rounded-2xl shadow-xl" />}
              {pendingMedia.type === 'audio' && <div className="w-full max-w-sm"><AudioPlayer src={pendingMedia.dataUrl!} isMine={true} /></div>}
            </div>
            
            {/* Fixed Send button to the bottom-right part to ensure it remains visible above high aspect-ratio screenshots */}
            <div className="absolute bottom-6 right-6 z-20">
              <button 
                onClick={() => { if (pendingMedia.file) handleMediaMessage(pendingMedia.file, pendingMedia.type); setPendingMedia(null); }} 
                className="bg-white text-black font-extrabold px-8 py-3.5 rounded-full shadow-[0_8px_30px_rgb(255,255,255,0.25)] flex items-center gap-2.5 active:scale-95 hover:bg-neutral-100 transition-all text-xs uppercase tracking-widest"
              >
                Send <SendHorizonal size={18} />
              </button>
            </div>
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
        {contextMenu && (<><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[150] bg-transparent" onClick={() => handleLongPress(null as any, null)} /><motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed z-[160] w-auto min-w-[160px] bg-[#1c1c1c] border border-white/10 rounded-[18px] shadow-2xl overflow-hidden py-1" style={{ top: contextMenu.y, left: contextMenu.x }}>
            {contextMenu.message.content && <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { navigator.clipboard.writeText(contextMenu.message.content!); handleLongPress(null as any, null); }}><Copy size={16} className="text-white/50" />Copy Text</button>}
            
            {(contextMenu.message.media_type === 'image' || contextMenu.message.media_type === 'audio') && <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { saveToDevice(contextMenu.message.media_url!, 'socium', contextMenu.message.media_type as string); handleLongPress(null as any, null); }}><Download size={16} className="text-white/50" />Save</button>}

            {(contextMenu.message.media_type === 'location' || !!contextMenu.message.content?.match(/(https?:\/\/(www\.)?(google\.com\/maps|maps\.apple\.com)[^\s]*)/)) && (
               <>
                 <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { 
                   const { lat, lng } = parseLocation(contextMenu.message.content);
                   openInAppleMaps(lat, lng, contextMenu.message.content);
                   handleLongPress(null as any, null); 
                 }}><MapPin size={16} className="text-white/50" />Apple Maps</button>
                 <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { 
                   const { lat, lng } = parseLocation(contextMenu.message.content);
                   openInGoogleMaps(lat, lng, contextMenu.message.content);
                   handleLongPress(null as any, null); 
                 }}><MapPin size={16} className="text-white/50" />Google Maps</button>
               </>
            )}

            {contextMenu.message.sender_id === currentUserId && <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-red-500 hover:bg-white/5 gap-3 transition-colors" onClick={handleDeleteMessage}><Trash2 size={16} />Delete</button>}
          </motion.div></>)}
      </AnimatePresence>
    </>
  );
}
