import React from 'react';
import { motion } from 'motion/react';
import { MapPin } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import AudioPlayer from './AudioPlayer';
import { parseLocation, openInNativeMaps } from './ChatUtils';

interface MessageBubbleProps {
  msg: any;
  isMine: boolean;
  nextMsg: any;
  prevMsg: any;
  activeChat: any;
  currentUserId: string;
  setViewingImage: (url: string) => void;
  onCloseChat?: () => void;
  contextMenuId?: string;
}

const MessageBubble = React.memo(({ 
  msg, 
  isMine, 
  nextMsg, 
  prevMsg, 
  activeChat, 
  currentUserId,
  setViewingImage, 
  onCloseChat, 
  contextMenuId 
}: MessageBubbleProps) => {
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
               className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10 active:scale-95 transition-transform cursor-pointer" 
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
          
          
          
         animate={contextMenuId === msg.id ? { scale: 1.05, zIndex: 100 } : { scale: 1, zIndex: 1 }}
         transition={{ type: "spring", stiffness: 400, damping: 25 }}
         className={cn(
           "max-w-[75%] min-w-[2rem] text-[15px] whitespace-pre-wrap break-words transition-colors duration-300 relative", 
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
           <div className="p-3 bg-white/5 flex items-center gap-3 active:bg-white/10 transition-colors cursor-pointer" onClick={() => { 
             const { lat, lng } = parseLocation(msg.content); 
             openInNativeMaps(lat, lng, msg.content); 
           }}>
             <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
               <MapPin size={20} className="text-white" />
             </div>
             <div className="flex flex-col">
               <span className="text-[14px] font-bold text-white">Location</span>
               <span className="text-[12px] opacity-50 text-white truncate max-w-[120px]">View on maps</span>
             </div>
           </div>
         )}
         {!isMediaOnly && msg.content && <span>{msg.content}</span>}
       </motion.div>
    </div>
  );
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
