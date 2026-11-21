import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, SendHorizonal, Camera, Image as ImageIcon, Mic, MapPin, X, Download, Copy, Trash2, Phone, Video, ShieldX, ShieldPlus } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { MessageBubble } from './MessageBubble';
import { AudioPlayer } from './AudioPlayer';
import { FullscreenVideoPlayer } from './FullscreenVideoPlayer';
import { useChatRoom } from './useChatRoom';
import { usePeerPresence } from './usePeerPresence';
import { ChatListItemType } from '@/src/types/chat';
import { videoLog } from '@/src/lib/videoLogger';

import { parseLocation, openInAppleMaps, openInGoogleMaps } from './locationUtils';

interface ChatRoomProps {
  currentUserId: string;
  activeChat: ChatListItemType;
  onClose: () => void;
  onOpenProfile: (id: string) => void;
  openSettings: () => void;
}

function useVisualViewport(
  containerRef: React.RefObject<HTMLDivElement | null>,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  formRef: React.RefObject<HTMLFormElement | null>,
  baseViewportHeightRef: React.MutableRefObject<number>,
  triggerPreFocusRef: React.MutableRefObject<((afterShrinkFocus?: () => void) => void) | null>,
  onKeyboardOpenChange: (open: boolean) => void
) {
  const onKeyboardOpenChangeRef = React.useRef(onKeyboardOpenChange);
  onKeyboardOpenChangeRef.current = onKeyboardOpenChange;

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const KB_STORAGE_KEY = 'socium_qwerty_kb_h';
    const KEYBOARD_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
    const ANIM_MS = 260;

    let learnedQwertyHeight = 345;
    try {
      const saved = Number(window.localStorage.getItem(KB_STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= 220 && saved <= 380) {
        learnedQwertyHeight = saved;
      }
    } catch {}

    let rafId: number | null = null;
    let flipRafId: number | null = null;
    let animCleanupTimerId: number | null = null;
    const timeoutIds = new Set<number>();
    let lastHeight = '';
    let lastAppHeight = '';
    let lastKeyboardOpen = false;
    let isAnimatingOpen = false;
    let preFocusUntil = 0;
    baseViewportHeightRef.current = Math.max(
      window.innerHeight,
      window.visualViewport?.height ?? 0
    );
    let lastVvOffsetTop = window.visualViewport?.offsetTop ?? 0;

    const isTouchDevice =
      window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

    const setKeyboardOpenState = (open: boolean) => {
      if (open !== lastKeyboardOpen) {
        lastKeyboardOpen = open;
        onKeyboardOpenChangeRef.current(open);
      }
    };

    const clearAnimTimers = () => {
      if (flipRafId !== null) {
        cancelAnimationFrame(flipRafId);
        flipRafId = null;
      }
      if (animCleanupTimerId !== null) {
        window.clearTimeout(animCleanupTimerId);
        animCleanupTimerId = null;
      }
    };

    const clearFlipStyles = () => {
      const el = containerRef.current;
      const scroller = scrollContainerRef.current;
      const form = formRef.current;
      if (el) el.style.overflow = '';
      if (scroller) {
        scroller.style.transition = '';
        scroller.style.bottom = '';
      }
      if (form) {
        form.style.transition = '';
        form.style.transform = '';
      }
      isAnimatingOpen = false;
    };

    const resetWindowScroll = () => {
      const vvOffsetTop = window.visualViewport?.offsetTop ?? 0;
      const vvOffsetChanged = Math.abs(vvOffsetTop - lastVvOffsetTop) >= 0.5;
      lastVvOffsetTop = vvOffsetTop;
      if (
        window.scrollY !== 0 ||
        window.scrollX !== 0 ||
        vvOffsetTop > 5 ||
        (vvOffsetTop > 0.5 && vvOffsetChanged)
      ) {
        window.scrollTo(0, 0);
      }
      if (document.documentElement.scrollTop !== 0) {
        document.documentElement.scrollTop = 0;
      }
      if (document.body.scrollTop !== 0) {
        document.body.scrollTop = 0;
      }
      const el = containerRef.current;
      if (el) {
        if (el.scrollTop !== 0) el.scrollTop = 0;
        if (el.parentElement && el.parentElement.scrollTop !== 0) {
          el.parentElement.scrollTop = 0;
        }
      }
    };

    const applyAppHeight = (value: string | null) => {
      const target = value ?? '';
      if (target === lastAppHeight) return;
      lastAppHeight = target;
      if (value) {
        document.documentElement.style.setProperty('--app-height', value);
      } else {
        document.documentElement.style.removeProperty('--app-height');
      }
    };

    const syncViewport = () => {
      resetWindowScroll();

      const el = containerRef.current;
      if (!el) return;

      const vv = window.visualViewport;
      const viewportHeight = vv ? vv.height : window.innerHeight;

      if (viewportHeight > baseViewportHeightRef.current) {
        baseViewportHeightRef.current = viewportHeight;
      }
      if (window.innerHeight > baseViewportHeightRef.current) {
        baseViewportHeightRef.current = window.innerHeight;
      }

      const baseH = baseViewportHeightRef.current;
      const kbDelta = baseH - viewportHeight;
      const isKeyboardOpen = kbDelta > 80;
      const inPreFocus = !isKeyboardOpen && preFocusUntil > 0 && performance.now() < preFocusUntil;

      let nextHeight = '100%';
      let nextAppHeight: string | null = null;
      if (isKeyboardOpen) {
        preFocusUntil = 0;
        nextHeight = `${viewportHeight}px`;
        nextAppHeight = nextHeight;
        if (kbDelta >= 220 && kbDelta <= 380 && Math.round(kbDelta) !== learnedQwertyHeight) {
          learnedQwertyHeight = Math.round(kbDelta);
          try {
            window.localStorage.setItem(KB_STORAGE_KEY, String(learnedQwertyHeight));
          } catch {}
        }
      } else if (inPreFocus) {
        nextHeight = `${Math.max(240, baseH - learnedQwertyHeight)}px`;
        nextAppHeight = nextHeight;
      } else {
        preFocusUntil = 0;
      }

      setKeyboardOpenState(isKeyboardOpen || inPreFocus);

      // Keep outer --app-height unclipped while open FLIP animation glides up
      if (!isAnimatingOpen) {
        applyAppHeight(nextAppHeight);
      }

      if (nextHeight !== lastHeight) {
        const wasOpen = lastHeight !== '' && lastHeight !== '100%';
        const isClosing = wasOpen && nextHeight === '100%';
        const isKeyboardAdjusting = wasOpen && nextHeight !== '100%';

        if (isClosing) {
          clearAnimTimers();
          clearFlipStyles();
          applyAppHeight(null);
          el.style.transition = `height ${ANIM_MS}ms ${KEYBOARD_EASE}`;
          el.style.height = `${baseH}px`;
          lastHeight = '100%';
          animCleanupTimerId = window.setTimeout(() => {
            animCleanupTimerId = null;
            if (containerRef.current && lastHeight === '100%') {
              containerRef.current.style.transition = '';
              containerRef.current.style.height = '100%';
            }
          }, ANIM_MS + 20);
        } else if (isKeyboardAdjusting) {
          el.style.transition = `height 200ms ${KEYBOARD_EASE}`;
          el.style.height = nextHeight;
          lastHeight = nextHeight;
        } else {
          el.style.transition = '';
          el.style.height = nextHeight;
          lastHeight = nextHeight;
        }
      }
    };

    const clearSettledTimers = () => {
      timeoutIds.forEach((id) => window.clearTimeout(id));
      timeoutIds.clear();
    };

    const scheduleSync = (delays: number[] = [65, 180]) => {
      syncViewport();
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        syncViewport();
      });

      clearSettledTimers();
      for (const delay of delays) {
        const id = window.setTimeout(() => {
          timeoutIds.delete(id);
          syncViewport();
        }, delay);
        timeoutIds.add(id);
      }
    };

    const triggerPreFocus = (animateWithFlip = false, afterShrinkFocus?: () => void) => {
      const vv = window.visualViewport;
      const viewportHeight = vv ? vv.height : window.innerHeight;
      const el = containerRef.current;
      if (!el || !isTouchDevice || baseViewportHeightRef.current - viewportHeight > 80) {
        afterShrinkFocus?.();
        return;
      }

      const startH = el.getBoundingClientRect().height || baseViewportHeightRef.current;
      const targetH = Math.max(240, baseViewportHeightRef.current - learnedQwertyHeight);
      const delta = Math.round(startH - targetH);

      preFocusUntil = performance.now() + 350;
      setKeyboardOpenState(true);

      if (animateWithFlip && delta > 20) {
        clearAnimTimers();
        isAnimatingOpen = true;
        applyAppHeight(null);
        el.style.transition = 'none';
        el.style.overflow = 'visible';
        el.style.height = `${targetH}px`;
        lastHeight = `${targetH}px`;
        void el.offsetHeight;

        // Run focus() while textarea is laid out inside 0..targetH (prevents UIKit scroll)
        afterShrinkFocus?.();

        const scroller = scrollContainerRef.current;
        const form = formRef.current;
        if (scroller && form) {
          scroller.style.transition = 'none';
          scroller.style.bottom = `-${delta}px`;
          form.style.transition = 'none';
          form.style.transform = `translate3d(0, ${delta}px, 0)`;
          void form.offsetHeight;

          flipRafId = requestAnimationFrame(() => {
            flipRafId = null;
            scroller.style.transition = `bottom ${ANIM_MS}ms ${KEYBOARD_EASE}`;
            scroller.style.bottom = '0px';
            form.style.transition = `transform ${ANIM_MS}ms ${KEYBOARD_EASE}`;
            form.style.transform = 'translate3d(0, 0, 0)';
          });

          animCleanupTimerId = window.setTimeout(() => {
            animCleanupTimerId = null;
            clearFlipStyles();
            if (lastHeight !== '100%') {
              applyAppHeight(lastHeight);
            }
          }, ANIM_MS + 20);
        }
      } else {
        syncViewport();
        void el.offsetHeight;
        afterShrinkFocus?.();
      }
    };
    triggerPreFocusRef.current = (afterShrinkFocus?: () => void) =>
      triggerPreFocus(true, afterShrinkFocus);

    const handleResize = () => scheduleSync([65, 180]);
    const handleScroll = () => scheduleSync([65, 180]);
    const handleOrientation = () => {
      preFocusUntil = 0;
      clearAnimTimers();
      clearFlipStyles();
      baseViewportHeightRef.current = Math.max(
        window.innerHeight,
        window.visualViewport?.height ?? 0
      );
      scheduleSync([65, 180, 300]);
    };
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
        if (preFocusUntil === 0) {
          triggerPreFocus(false);
        }
        scheduleSync([60, 180, 380]);
      }
    };
    const handleFocusOut = () => {
      preFocusUntil = 0;
      scheduleSync([65, 180]);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        preFocusUntil = 0;
        clearAnimTimers();
        clearFlipStyles();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        scheduleSync([65, 180]);
      }
    };

    syncViewport();

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleScroll);
    }
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('orientationchange', handleOrientation);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      triggerPreFocusRef.current = null;
      if (rafId !== null) cancelAnimationFrame(rafId);
      clearAnimTimers();
      clearFlipStyles();
      clearSettledTimers();
      document.documentElement.style.removeProperty('--app-height');
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
        window.visualViewport.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('orientationchange', handleOrientation);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [containerRef, scrollContainerRef, formRef, baseViewportHeightRef, triggerPreFocusRef]);
}

export function ChatRoom({ currentUserId, activeChat, onClose, onOpenProfile, openSettings }: ChatRoomProps) {
  const viewportContainerRef = React.useRef<HTMLDivElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const triggerPreFocusRef = React.useRef<((afterShrinkFocus?: () => void) => void) | null>(null);
  const textareaTouchRef = React.useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const baseViewportHeightRef = React.useRef<number>(
    typeof window !== 'undefined' ? window.innerHeight : 800
  );
  const [isKeyboardOpen, setIsKeyboardOpen] = React.useState(false);

  const { isOnline: isPeerOnline, statusText: peerStatusText } = usePeerPresence(
    activeChat.id,
    activeChat.isGroup
  );

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
    uploadProgress,
    uploadStatusText,
    pendingMedia,
    setPendingMedia,
    handleMediaMessage,
    messagesEndRef,
    scrollContainerRef,
    viewingImage,
    setViewingImage,
    viewingVideo,
    setViewingVideo,
    contextMenu,
    handleLongPress,
    handleDeleteMessage,
    saveToDevice,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    activeDateMsgId,
    setActiveDateMsgId,
    vaultedMessageIds,
    handleAddToVault,
    handleRemoveFromVault
  } = useChatRoom(currentUserId, activeChat);

  useVisualViewport(
    viewportContainerRef,
    scrollContainerRef,
    formRef,
    baseViewportHeightRef,
    triggerPreFocusRef,
    setIsKeyboardOpen
  );

  const [confirmRemoveMsgId, setConfirmRemoveMsgId] = React.useState<string | null>(null);
  const [isVideoTooLong, setIsVideoTooLong] = React.useState(false);

  React.useEffect(() => {
    setIsVideoTooLong(false);
  }, [pendingMedia?.dataUrl]);

  const sendAndKeepFocus = (e: React.SyntheticEvent) => {
    if (!newMessage.trim()) return;
    handleSendMessage(e as unknown as React.FormEvent);
  };

  return (
    <>
      <motion.div 
         key="chat-room" 
         initial={{ x: '100%', opacity: 1 }} 
         animate={{ x: 0, opacity: 1 }} 
         exit={{ x: '100%', opacity: 1 }} 
         transition={{ type: 'spring', stiffness: 320, damping: 32 }} 
         className="fixed top-0 left-0 right-0 z-[60] bg-black w-full max-w-lg mx-auto h-[var(--app-height,100dvh)] overflow-hidden [overflow:clip] select-none [user-select:none] [-webkit-user-select:none] [-webkit-touch-callout:none]"
      >
        {/* Top-pinned container (top always hardcoded to 0px, only shrinks height to visualViewport.height) */}
        <div
          ref={viewportContainerRef}
          className="fixed top-0 left-0 right-0 max-w-lg mx-auto h-full flex flex-col bg-black overflow-hidden [overflow:clip]"
        >
        {/* Stationary Header */}
        <div className="px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2.5 flex items-center gap-4 border-b border-white/10 bg-black shrink-0 relative z-20 [touch-action:none]">
           <button onClick={onClose} className="p-2 -ml-2 text-white/80 active:scale-90 transition-transform"><ArrowLeft size={24} /></button>
           <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={openSettings}>
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
              <div className="flex flex-col min-w-0 flex-1 justify-center">
                <span className="font-bold text-sm text-white/90 truncate leading-tight">{activeChat.name}</span>
                {!activeChat.isGroup && peerStatusText && (
                  <span className={cn(
                    "text-[11px] truncate leading-tight mt-0.5",
                    isPeerOnline ? "text-emerald-400 font-medium" : "text-white/40"
                  )}>
                    {peerStatusText}
                  </span>
                )}
              </div>
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

        <div className="flex-1 min-h-0 relative">
          <div ref={scrollContainerRef} id="chat-messages-container" className="absolute inset-0 flex flex-col-reverse overflow-y-auto overscroll-contain pt-4 px-4 pb-1 space-y-1 space-y-reverse no-scrollbar [-webkit-overflow-scrolling:touch]" 
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
             <div ref={messagesEndRef} className="h-0.5 shrink-0" />
             <div className="flex flex-col-reverse">
                <AnimatePresence initial={false}>
                {messages.slice().reverse().map((msg, idx, arr) => (
                   <motion.div 
                     key={msg._clientId || msg.id} 
                     initial={{ opacity: 0, scale: 0.95, y: 15 }} 
                     animate={{ opacity: 1, scale: 1, y: 0 }} 
                     transition={{ type: 'spring', stiffness: 400, damping: 30 }} 
                   >
                      <MessageBubble msg={msg} isMine={msg.sender_id === currentUserId} nextMsg={arr[idx - 1]} prevMsg={arr[idx + 1]} activeChat={activeChat} currentUserId={currentUserId} setViewingImage={setViewingImage} setViewingVideo={setViewingVideo} handleLongPress={handleLongPress} contextMenuId={contextMenu?.message?.id} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onCloseChat={onClose} onOpenProfile={onOpenProfile} showDate={activeDateMsgId === msg.id} onToggleDate={() => setActiveDateMsgId(prev => prev === msg.id ? null : msg.id)} isVaulted={vaultedMessageIds?.has(msg.id)} />
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
        </div>

        <form
          ref={formRef}
          onSubmit={sendAndKeepFocus}
          className={cn(
            "px-4 pt-4 border-t border-white/10 bg-black/95 backdrop-blur-2xl shrink-0 relative z-10 [touch-action:none] transition-[padding] duration-200",
            isKeyboardOpen ? "pb-4" : "pb-safe pb-6"
          )}
        >
             <div className="flex items-center gap-3">
               <button type="button" onClick={() => setShowFeatures(!showFeatures)} className="w-10 h-10 shrink-0 bg-white/10 rounded-full flex items-center justify-center transition-all"><Plus size={24} className={cn("text-white transition-transform duration-300", showFeatures && "rotate-45")} /></button>
               <div
                 onClick={(e) => {
                   if (e.target === e.currentTarget && textareaRef.current && document.activeElement !== textareaRef.current) {
                     const textarea = textareaRef.current;
                     setShowFeatures(false);
                     if (triggerPreFocusRef.current) {
                       triggerPreFocusRef.current(() => textarea.focus({ preventScroll: true }));
                     } else {
                       textarea.focus({ preventScroll: true });
                     }
                   }
                 }}
                 className="flex-1 flex items-center bg-white/5 border border-white/10 rounded-[24px] pr-1.5"
               >
                 <textarea 
                   ref={textareaRef}
                   placeholder="Message..." 
                   value={newMessage} 
                   onChange={e => setNewMessage(e.target.value)}
                   onTouchStart={(e) => {
                     const touch = e.touches[0];
                     if (touch) {
                       textareaTouchRef.current = {
                         x: touch.clientX,
                         y: touch.clientY,
                         moved: false,
                       };
                     }
                   }}
                   onTouchMove={(e) => {
                     const start = textareaTouchRef.current;
                     const touch = e.touches[0];
                     if (start && touch && !start.moved) {
                       if (
                         Math.abs(touch.clientX - start.x) > 10 ||
                         Math.abs(touch.clientY - start.y) > 10
                       ) {
                         start.moved = true;
                       }
                     }
                   }}
                   onTouchCancel={() => {
                     textareaTouchRef.current = null;
                   }}
                   onTouchEnd={(e) => {
                     const start = textareaTouchRef.current;
                     textareaTouchRef.current = null;
                     if (!start || start.moved) return;

                     const textarea = textareaRef.current;
                     if (!textarea || document.activeElement === textarea) return;

                     const vvHeight = window.visualViewport?.height ?? window.innerHeight;
                     const kbDelta = baseViewportHeightRef.current - vvHeight;
                     if (kbDelta <= 80) {
                       e.preventDefault();
                       setShowFeatures(false);
                       if (triggerPreFocusRef.current) {
                         triggerPreFocusRef.current(() => textarea.focus({ preventScroll: true }));
                       } else {
                         textarea.focus({ preventScroll: true });
                       }
                     }
                   }}
                   onFocus={() => { 
                     setShowFeatures(false); 
                     if (window.scrollY !== 0 || window.scrollX !== 0) {
                       window.scrollTo(0, 0);
                     }
                     if (document.documentElement.scrollTop !== 0) {
                       document.documentElement.scrollTop = 0;
                     }
                     if (document.body.scrollTop !== 0) {
                       document.body.scrollTop = 0;
                     }
                     if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
                   }} 
                   onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAndKeepFocus(e); } }} 
                   className="flex-1 min-w-0 bg-transparent text-white placeholder:text-white/40 pl-4 pr-2 py-2.5 focus:outline-none text-[16px] resize-none min-h-[44px] max-h-[120px] leading-tight select-text [user-select:text] [-webkit-user-select:text]" 
                   rows={1} 
                   style={{ height: newMessage ? 'auto' : '44px' }} 
                 />
                 <button type="button"
                    tabIndex={-1}
                    aria-disabled={!newMessage.trim()}
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
                    }}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      sendAndKeepFocus(e);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      sendAndKeepFocus(e);
                    }}
                    className={cn(
                      "shrink-0 w-9 h-9 bg-white text-black rounded-full flex items-center justify-center transition-all",
                      !newMessage.trim() ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"
                    )}
                  >
                    <SendHorizonal size={18} />
                </button>
             </div>
           </div>
           <AnimatePresence>
             {showFeatures && (
                <motion.div 
                  initial={{ height: 0, opacity: 0, scale: 0.95 }} 
                  animate={{ height: 'auto', opacity: 1, scale: 1 }} 
                  exit={{ height: 0, opacity: 0, scale: 0.95 }} 
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden mt-4 px-2 pb-2 origin-top"
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
           {uploadingMedia && (
             <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center gap-1.5 z-50 rounded-t-3xl backdrop-blur-xs">
               <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
               <span className="text-[11px] text-white/90 font-medium tracking-wide">
                 {uploadStatusText || (uploadProgress !== null && uploadProgress > 0 ? `Uploading ${uploadProgress}%` : 'Sending media...')}
               </span>
             </div>
           )}
            <input type="file" ref={fileInputRef} accept="image/*,video/*" className="hidden" onChange={(e) => { 
              const file = e.target.files?.[0]; 
              if (file) { 
                const isVideo = file.type.startsWith('video/'); 
                videoLog.info(`📂 [File Picker] Selected ${isVideo ? 'video' : 'image'}`, {
                  name: file.name,
                  sizeMb: (file.size / (1024 * 1024)).toFixed(2),
                  type: file.type
                });
                setPendingMedia({ file, type: isVideo ? 'video' : 'image', dataUrl: URL.createObjectURL(file) }); 
                setShowFeatures(false); 
              } 
              e.target.value = ''; 
            }} />
            <input type="file" ref={cameraInputRef} accept="image/*,video/*" capture="environment" className="hidden" onChange={(e) => { 
              const file = e.target.files?.[0]; 
              if (file) { 
                const isVideo = file.type.startsWith('video/'); 
                videoLog.info(`📷 [Camera Picker] Captured ${isVideo ? 'video' : 'image'}`, {
                  name: file.name,
                  sizeMb: (file.size / (1024 * 1024)).toFixed(2),
                  type: file.type
                });
                setPendingMedia({ file, type: isVideo ? 'video' : 'image', dataUrl: URL.createObjectURL(file) }); 
                setShowFeatures(false); 
              } 
              e.target.value = ''; 
            }} />
          </form>
        </div>
      </motion.div>

      <AnimatePresence>
        {pendingMedia && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }} className="fixed inset-0 z-[500] bg-black/95 flex flex-col justify-between backdrop-blur-md overflow-hidden">
            <div className="p-4 pt-[env(safe-area-inset-top)] flex items-center justify-between z-10 shrink-0">
              <button onClick={() => setPendingMedia(null)} className="w-10 h-10 bg-white/20 text-white rounded-full flex items-center justify-center backdrop-blur shadow-lg active:scale-90 transition-transform"><X size={24} /></button>
              <h2 className="text-white font-bold tracking-wide uppercase text-xs bg-black/40 px-4 py-2 rounded-full backdrop-blur">Send {pendingMedia.type}</h2>
              <div className="w-10" />
            </div>
            
            <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-4 pb-24 relative">
              {pendingMedia.type === 'image' && <img src={pendingMedia.dataUrl} className="max-w-full max-h-full object-contain rounded-2xl shadow-xl" />}
              {pendingMedia.type === 'video' && (
                <div className="relative max-w-full max-h-full flex items-center justify-center">
                  <video 
                    src={pendingMedia.dataUrl} 
                    controls={!isVideoTooLong} 
                    playsInline 
                    onLoadedMetadata={(e) => {
                      const dur = e.currentTarget.duration;
                      const w = e.currentTarget.videoWidth;
                      const h = e.currentTarget.videoHeight;
                      videoLog.info('🎬 [Preview Loaded] Video metadata ready', {
                        durationSec: dur ? dur.toFixed(2) : 'unknown',
                        dimensions: `${w}x${h}`,
                        isTooLong: dur && dur > 180
                      });
                      if (dur && dur > 180) {
                        setIsVideoTooLong(true);
                      } else {
                        setIsVideoTooLong(false);
                      }
                    }}
                    className={cn(
                      "max-w-full max-h-full object-contain rounded-2xl shadow-xl transition-all duration-300",
                      isVideoTooLong && "grayscale opacity-40 pointer-events-none filter"
                    )} 
                  />
                  {isVideoTooLong && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-4">
                      <div className="bg-black/85 backdrop-blur-md border border-white/20 px-5 py-3 rounded-full text-white text-xs font-semibold shadow-2xl tracking-wide text-center">
                        Videos must be shorter than 3 minutes.
                      </div>
                    </div>
                  )}
                </div>
              )}
              {pendingMedia.type === 'audio' && <div className="w-full max-w-sm"><AudioPlayer src={pendingMedia.dataUrl!} isMine={true} /></div>}
            </div>
            
            {/* Action button in bottom-right: Replace if > 3 min, otherwise Send */}
            <div className="absolute bottom-6 right-6 z-20">
              {isVideoTooLong ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-white text-black font-extrabold px-8 py-3.5 rounded-full shadow-[0_8px_30px_rgb(255,255,255,0.25)] flex items-center active:scale-95 hover:bg-neutral-100 transition-all text-xs uppercase tracking-widest"
                >
                  Replace
                </button>
              ) : (
                <button 
                  type="button"
                  onClick={() => { 
                    if (pendingMedia.file) {
                      videoLog.info('🚀 [User Action] User confirmed and clicked Send button on preview modal');
                      handleMediaMessage(pendingMedia.file, pendingMedia.type); 
                    }
                    setPendingMedia(null); 
                  }} 
                  className="bg-white text-black font-extrabold px-8 py-3.5 rounded-full shadow-[0_8px_30px_rgb(255,255,255,0.25)] flex items-center gap-2.5 active:scale-95 hover:bg-neutral-100 transition-all text-xs uppercase tracking-widest"
                >
                  Send <SendHorizonal size={18} />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[600] bg-black">
            <button onClick={() => saveToDevice(viewingImage, 'socium')} className="absolute z-[610] top-safe left-4 mt-4 p-3 bg-white/10 text-white rounded-full"><Download size={24} /></button>
            <button onClick={() => setViewingImage(null)} className="absolute z-[610] top-safe right-4 mt-4 p-3 bg-white/10 text-white rounded-full"><X size={24} /></button>
            <div className="w-full h-full"><TransformWrapper centerOnInit><TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><img src={viewingImage} className="max-w-full max-h-screen object-contain" /></TransformComponent></TransformWrapper></div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingVideo && (
          <FullscreenVideoPlayer
            src={viewingVideo}
            onClose={() => setViewingVideo(null)}
            onSave={() => saveToDevice(viewingVideo, 'socium', 'video')}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contextMenu && (<><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[150] bg-transparent" onClick={() => handleLongPress(null as any, null)} /><motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed z-[160] w-auto min-w-[160px] bg-[#1c1c1c] border border-white/10 rounded-[18px] shadow-2xl overflow-hidden py-1" style={{ top: contextMenu.y, left: contextMenu.x }}>
            {contextMenu.message.content && <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { navigator.clipboard.writeText(contextMenu.message.content!); handleLongPress(null as any, null); }}><Copy size={16} className="text-white/50" />Copy Text</button>}
            
            {(contextMenu.message.media_type === 'image' || contextMenu.message.media_type === 'video' || contextMenu.message.media_type === 'audio') && <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { saveToDevice(contextMenu.message.media_url!, 'socium', contextMenu.message.media_type as string); handleLongPress(null as any, null); }}><Download size={16} className="text-white/50" />Save</button>}

            {contextMenu && (
              contextMenu.message.media_type === 'image' || 
              contextMenu.message.media_type === 'video' || 
              contextMenu.message.media_type === 'audio' || 
              (!contextMenu.message.media_type && contextMenu.message.content)
            ) && (
              vaultedMessageIds?.has(contextMenu.message.id) ? (
                <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { setConfirmRemoveMsgId(contextMenu.message.id); handleLongPress(null as any, null); }}><ShieldX size={16} className="text-white/50" />Remove from Vault</button>
              ) : (
                <button className="w-full flex items-center px-4 py-2.5 text-[13px] font-medium text-white hover:bg-white/10 gap-3 transition-colors" onClick={() => { handleAddToVault(contextMenu.message.id); handleLongPress(null as any, null); }}><ShieldPlus size={16} className="text-white/50" />Add to Vault</button>
              )
            )}

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

      <AnimatePresence>
        {confirmRemoveMsgId && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm bg-[#1c1c1c] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-6"
            >
              <h4 className="text-[17px] font-bold text-white text-center">
                Are you sure you want to remove this message from Vault forever?
              </h4>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => setConfirmRemoveMsgId(null)}
                  className="w-full py-3 rounded-2xl bg-white text-black font-bold text-[14px] active:scale-95 transition-all text-center"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    handleRemoveFromVault(confirmRemoveMsgId);
                    setConfirmRemoveMsgId(null);
                  }}
                  className="w-full py-3 rounded-2xl bg-red-600 text-white font-bold text-[14px] active:scale-95 transition-all text-center"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
