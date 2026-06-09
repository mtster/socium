import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Trash2, Play, Pause, Mic, Image, Shield, ShieldX, ShieldCheck, ShieldPlus } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { cn } from '@/src/lib/utils';
import { ProfileImageViewer } from '../profile/ProfileImageViewer';

interface VaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeChat: any;
  currentUserId: string;
}

// Shared global cache to save unnecessary fetches
export const vaultCache: Record<string, {
  vaultItems: any[];
  profilesMap: Record<string, any>;
  offset: number;
  hasMore: boolean;
}> = {};

export function invalidateVaultCache(chatId: string) {
  delete vaultCache[chatId];
}

export function VaultModal({ isOpen, onClose, activeChat, currentUserId }: VaultModalProps) {
  const [vaultItems, setVaultItems] = useState<any[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  
  // Editing state for Vault items removal
  const [isEditing, setIsEditing] = useState(false);
  const [itemToRemove, setItemToRemove] = useState<any | null>(null);

  // Screenshot Ready Detail/Quote view
  const [selectedQuote, setSelectedQuote] = useState<any | null>(null);

  // Zoomable full screen view for tapped image insidequote modal
  const [viewingFullscreenImage, setViewingFullscreenImage] = useState<string | null>(null);

  // Audio playing state inside Quote view using Web Audio API to prevent triggering iOS native Lock screen / Dynamic Island
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioStartTimeRef = useRef<number>(0);
  const audioPauseTimeRef = useRef<number>(0);
  const audioProgressIntervalRef = useRef<any>(null);
  const audioUrlsFetchedRef = useRef<Record<string, AudioBuffer>>({});
  const waveformRef = useRef<HTMLDivElement>(null);

  const LIMIT = 20;

  useEffect(() => {
    if (isOpen) {
      const cached = vaultCache[activeChat.id];
      if (cached) {
        setVaultItems(cached.vaultItems);
        setProfilesMap(cached.profilesMap);
        setOffset(cached.offset);
        setHasMore(cached.hasMore);
        setIsEditing(false);
      } else {
        setVaultItems([]);
        const initialProfiles: Record<string, any> = {};
        setProfilesMap(initialProfiles);
        setOffset(0);
        setHasMore(true);
        setIsEditing(false);
        fetchVaultItems(0, true);
      }
    }
  }, [isOpen, activeChat.id]);

  const fetchVaultItems = async (currentOffset: number, initial = false) => {
    if (initial) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      // Build search query based on current chat
      let query = supabase
        .from('messages')
        .select(`
          id,
          content,
          media_url,
          media_type,
          created_at,
          sender_id,
          receiver_id,
          group_chat_id,
          vault_messages!inner (
            id,
            created_at,
            added_by
          )
        `)
        .order('created_at', { ascending: false })
        .range(currentOffset, currentOffset + LIMIT - 1);

      if (activeChat.isGroup) {
        query = query.eq('group_chat_id', activeChat.id);
      } else {
        query = query
          .is('group_chat_id', null)
          .or(`and(sender_id.eq.${activeChat.id},receiver_id.eq.${currentUserId}),and(sender_id.eq.${currentUserId},receiver_id.eq.${activeChat.id})`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching vault items:', error);
        return;
      }

      if (data) {
        // Transform msg + joined vault records back to format code expects
        const transformed = data.map((msg: any) => {
          const vaultEntry = Array.isArray(msg.vault_messages) ? msg.vault_messages[0] : msg.vault_messages;
          if (!vaultEntry) return null;
          return {
            id: vaultEntry.id,
            created_at: vaultEntry.created_at,
            message_id: msg.id,
            messages: {
              id: msg.id,
              content: msg.content,
              media_url: msg.media_url,
              media_type: msg.media_type,
              created_at: msg.created_at,
              sender_id: msg.sender_id,
              receiver_id: msg.receiver_id,
              group_chat_id: msg.group_chat_id
            }
          };
        }).filter(Boolean);

        const uniqueSenderIds = Array.from(
          new Set(transformed.map((item: any) => item.messages.sender_id))
        ).filter(Boolean) as string[];

        const newProfilesMap = { ...profilesMap };
        if (uniqueSenderIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('*')
            .in('id', uniqueSenderIds);
          if (profiles) {
            profiles.forEach((p: any) => {
              newProfilesMap[p.id] = p;
            });
            setProfilesMap(newProfilesMap);
          }
        }

        const nextItems = initial ? transformed : [...vaultItems, ...transformed];
        setVaultItems(nextItems);
        setHasMore(data.length === LIMIT);
        setOffset(currentOffset + LIMIT);

        // Update cache
        vaultCache[activeChat.id] = {
          vaultItems: nextItems,
          profilesMap: newProfilesMap,
          offset: currentOffset + LIMIT,
          hasMore: data.length === LIMIT
        };
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const threshold = 50;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < threshold) {
      if (hasMore && !loadingMore && !loading) {
        fetchVaultItems(offset, false);
      }
    }
  };

  const handleRemoveConfirm = async () => {
    if (!itemToRemove) return;
    try {
      const { error } = await supabase
        .from('vault_messages')
        .delete()
        .eq('id', itemToRemove.id);

      if (error) {
        console.error('Error removing vault item:', error);
        alert('Failed to remove item from vault.');
      } else {
        const nextItems = vaultItems.filter(item => item.id !== itemToRemove.id);
        setVaultItems(nextItems);
        // Also update cache!
        if (vaultCache[activeChat.id]) {
          vaultCache[activeChat.id].vaultItems = nextItems;
        }
      }
    } catch (err) {
      console.warn(err);
    } finally {
      setItemToRemove(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatDateDMY = (dateStr: string) => {
    const d = new Date(dateStr);
    const day = d.getDate();
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Playback handlers using Web Audio API to prevent triggering iOS native Lock screen / Dynamic Island
  const togglePlayAudio = async (url: string) => {
    if (isPlaying) {
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.stop();
        } catch (e) {}
        audioSourceRef.current = null;
      }
      if (audioCtxRef.current) {
        audioPauseTimeRef.current += audioCtxRef.current.currentTime - audioStartTimeRef.current;
      }
      clearInterval(audioProgressIntervalRef.current);
      setIsPlaying(false);
    } else {
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        let buffer = audioUrlsFetchedRef.current[url];
        if (!buffer) {
          setIsAudioLoading(true);
          const response = await fetch(url);
          const arrayBuffer = await response.arrayBuffer();
          buffer = await ctx.decodeAudioData(arrayBuffer);
          audioUrlsFetchedRef.current[url] = buffer;
        }

        setIsAudioLoading(false);
        audioBufferRef.current = buffer;

        if (audioPauseTimeRef.current >= buffer.duration) {
          audioPauseTimeRef.current = 0;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        
        source.onended = () => {
          const elapsed = ctx.currentTime - audioStartTimeRef.current + audioPauseTimeRef.current;
          if (elapsed >= (buffer?.duration || 0) - 0.1) {
            setIsPlaying(false);
            setAudioProgress(0);
            audioPauseTimeRef.current = 0;
            clearInterval(audioProgressIntervalRef.current);
          }
        };

        source.start(0, audioPauseTimeRef.current);
        audioSourceRef.current = source;
        audioStartTimeRef.current = ctx.currentTime;

        setIsPlaying(true);

        audioProgressIntervalRef.current = setInterval(() => {
          if (audioBufferRef.current && audioCtxRef.current) {
            const elapsed = audioCtxRef.current.currentTime - audioStartTimeRef.current + audioPauseTimeRef.current;
            const duration = audioBufferRef.current.duration;
            const progress = Math.min((elapsed / duration) * 100, 100);
            setAudioProgress(progress);
          }
        }, 100);

      } catch (err) {
        console.error("Web Audio playback error:", err);
        setIsAudioLoading(false);
      }
    }
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {}
      audioSourceRef.current = null;
    }
    clearInterval(audioProgressIntervalRef.current);
    audioPauseTimeRef.current = 0;
    setIsPlaying(false);
    setAudioProgress(0);
  };

  const handleWaveformScrub = (clientX: number) => {
    if (!waveformRef.current || !audioBufferRef.current) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const pos = (clientX - rect.left) / rect.width;
    const clampedPos = Math.max(0, Math.min(pos, 1));
    const duration = audioBufferRef.current.duration;
    const newPauseTime = clampedPos * duration;

    const wasPlaying = isPlaying;

    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {}
      audioSourceRef.current = null;
    }
    clearInterval(audioProgressIntervalRef.current);

    audioPauseTimeRef.current = newPauseTime;
    setAudioProgress(clampedPos * 100);

    if (wasPlaying && selectedQuote) {
      setIsPlaying(false);
      togglePlayAudio(selectedQuote.item.messages.media_url);
    }
  };

  const handleWaveformPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== undefined) return;
    handleWaveformScrub(e.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      handleWaveformScrub(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  useEffect(() => {
    return () => {
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.stop();
        } catch (e) {}
      }
      clearInterval(audioProgressIntervalRef.current);
    };
  }, []);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: '100%', opacity: 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 1 }}
            transition={{ type: 'tween', duration: 0.35, ease: 'easeOut' }}
            className="fixed inset-0 z-[120] flex flex-col bg-black w-full overflow-hidden select-none"
          >
            {/* Header */}
            <div className="p-4 pt-safe flex items-center justify-between border-b border-white/10 bg-black/80 backdrop-blur-xl shrink-0">
              <div className="flex items-center gap-4">
                <button onClick={onClose} className="p-2 -ml-2 text-white/80 active:scale-90 transition-transform">
                  <ArrowLeft size={24} />
                </button>
                <h1 className="text-[17px] font-bold text-white flex-1">Vault</h1>
              </div>

              {vaultItems.length > 0 && (
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-xs font-bold transition-all",
                    isEditing ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"
                  )}
                >
                  {isEditing ? 'Done' : 'Edit'}
                </button>
              )}
            </div>

            {/* List */}
            <div
              className="flex-1 overflow-y-auto pb-safe px-6 py-4 divide-y divide-white/5 space-y-0"
              onScroll={handleScroll}
            >
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span className="text-white/40 text-xs font-medium">Entering secure memories...</span>
                </div>
              ) : vaultItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 text-center px-6">
                  <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6">
                    <Shield size={28} className="text-white/40" />
                  </div>
                  <h3 className="text-lg font-bold text-white/90 mb-2">Vault is completely empty</h3>
                  <p className="text-xs text-white/40 max-w-xs leading-relaxed">
                    Long press any text, image, or audio message inside the chat room and tap <b>Add to Vault</b> to save your most memorable moments here.
                  </p>
                </div>
              ) : (
                <>
                  {vaultItems.map((item) => {
                    const message = item.messages;
                    if (!message) return null;
                    const profile = profilesMap[message.sender_id] || {};

                    return (
                      <motion.div
                        key={item.id}
                        layoutId={`vault-row-${item.id}`}
                        onClick={() => {
                          if (!isEditing) {
                            setSelectedQuote({ item, profile });
                          }
                        }}
                        className={cn(
                          "w-full flex flex-col py-4 relative border-b border-white/10 last:border-b-0 transition-all group overflow-hidden decoration-none",
                          isEditing ? "cursor-default pr-12" : "cursor-pointer"
                        )}
                      >
                        {/* Remove actions overlay - Right Side */}
                        <AnimatePresence>
                          {isEditing && (
                            <motion.button
                              initial={{ x: 40, opacity: 0 }}
                              animate={{ x: 0, opacity: 1 }}
                              exit={{ x: 40, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setItemToRemove(item);
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white z-10"
                            >
                              <Trash2 size={15} />
                            </motion.button>
                          )}
                        </AnimatePresence>

                        {/* Top Line: Profile pic + Full Name on left, Date on right */}
                        <div className="flex items-center justify-between w-full mb-2 select-none">
                          <div className="flex items-center gap-2.5">
                            <div className="w-6 h-6 rounded-full overflow-hidden bg-white/5 border border-white/10 shrink-0">
                              {profile.avatar_url ? (
                                <img src={profile.avatar_url} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-white/10 flex items-center justify-center font-bold text-[9px] text-white/60">
                                  {(profile.full_name?.charAt(0) || profile.username?.charAt(0) || '?').toUpperCase()}
                                </div>
                              )}
                            </div>
                            <span className="font-bold text-[13px] text-white/90">
                              {profile.full_name || profile.username || 'Someone'}
                            </span>
                          </div>

                          <span className="text-[11px] text-white/40 font-medium whitespace-nowrap">
                            {formatDate(message.created_at)}
                          </span>
                        </div>

                        {/* Bottom Line: Content begins fresh from below */}
                        <div className="pl-[34px] text-left">
                          {/* Render preview style based on message content type */}
                          {message.media_type === 'image' ? (
                            <div className="flex items-center gap-2 mt-0.5 select-none">
                              <Image size={13} className="text-white/40" />
                              <span className="text-xs text-white/40 font-medium italic">Image</span>
                            </div>
                          ) : message.media_type === 'audio' ? (
                            <div className="flex items-center gap-2 mt-0.5 select-none">
                              <Mic size={13} className="text-white/40" />
                              <span className="text-xs text-white/40 font-medium italic">Voice Note</span>
                            </div>
                          ) : (
                            <p className="text-[13px] text-white/60 italic font-medium leading-relaxed select-text">
                              {message.content}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}

                  {/* Incremental Scroll Load More Spinner */}
                  {loadingMore && (
                    <div className="flex items-center justify-center py-4 w-full">
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {itemToRemove && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
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
                  onClick={() => setItemToRemove(null)}
                  className="w-full py-3 rounded-2xl bg-white text-black font-bold text-[14px] active:scale-95 transition-all text-center"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRemoveConfirm}
                  className="w-full py-3 rounded-2xl bg-red-600 text-white font-bold text-[14px] active:scale-95 transition-all text-center"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full-screen screenshot-ready quote view */}
      <AnimatePresence>
        {selectedQuote && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => {
              stopAudio();
              setSelectedQuote(null);
            }}
            className="fixed inset-0 z-[300] bg-black flex flex-col justify-between items-center py-20 px-8 touch-none cursor-pointer"
          >
            {/* Centered Quote Container Content (sitting on the absolute vertical center) */}
            <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 flex flex-col items-center justify-center">
              {/* Profile section - Sits naturally above content */}
              <div className="flex flex-col items-center gap-2 mb-6 select-none shrink-0" onClick={(e) => e.stopPropagation()}>
                <div className="w-16 h-16 rounded-full overflow-hidden bg-white/5 border border-white/10 shadow-2xl">
                  {selectedQuote.profile.avatar_url ? (
                    <img src={selectedQuote.profile.avatar_url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full bg-white/10 flex items-center justify-center font-bold text-xl text-white/50">
                      {(selectedQuote.profile.full_name?.charAt(0) || selectedQuote.profile.username?.charAt(0) || '?').toUpperCase()}
                    </div>
                  )}
                </div>
                <span className="text-white/40 text-xs italic">
                  {formatDateDMY(selectedQuote.item.messages.created_at)}
                </span>
              </div>

              {/* Centered Content block */}
              <div className="w-full flex flex-col items-center relative">
                {selectedQuote.item.messages.media_type === 'image' ? (
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewingFullscreenImage(selectedQuote.item.messages.media_url);
                    }}
                    className="rounded-3xl overflow-hidden border border-white/5 max-h-[40vh] w-auto h-auto shadow-2xl cursor-pointer hover:scale-[1.02] active:scale-95 transition-transform"
                  >
                    <img 
                      src={selectedQuote.item.messages.media_url} 
                      className="max-h-[40vh] w-auto h-auto object-contain rounded-3xl" 
                      alt="Vault visual item"
                    />
                  </div>
                ) : selectedQuote.item.messages.media_type === 'audio' ? (
                  /* Audio player sitting directly on page background per request */
                  <div className="w-full max-w-sm flex items-center gap-4 py-3 px-2 justify-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePlayAudio(selectedQuote.item.messages.media_url); }}
                      className="w-10 h-10 text-white/90 hover:text-white flex items-center justify-center shrink-0 active:scale-90 transition-transform bg-transparent border-0"
                    >
                      {isAudioLoading ? (
                        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      ) : isPlaying ? (
                        <Pause size={28} className="fill-current text-white shrink-0" />
                      ) : (
                        <Play size={28} className="fill-current text-white shrink-0 ml-0.5" />
                      )}
                    </button>

                    <div 
                      ref={waveformRef}
                      onPointerDown={(e) => { e.stopPropagation(); handleWaveformPointerDown(e); }}
                      className="flex-1 flex items-center justify-between gap-[3px] h-10 cursor-pointer select-none"
                    >
                      {Array.from({ length: 24 }).map((_, idx) => {
                        const barProgress = (idx / 24) * 100;
                        const isActive = audioProgress > barProgress && audioProgress > 0;
                        const waveHeights = [10, 14, 22, 30, 26, 18, 22, 28, 38, 32, 24, 20, 18, 22, 28, 34, 26, 18, 14, 18, 24, 22, 14, 10];
                        const height = waveHeights[idx] || 18;
                        return (
                          <div 
                            key={idx}
                            style={{ height: `${height}px` }}
                            className={cn(
                              "w-[3px] rounded-full transition-all duration-150",
                              isActive ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)]" : "bg-white/10"
                            )}
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p 
                    className="text-white text-center text-[22px] md:text-[26px] leading-relaxed italic tracking-wide select-text px-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {selectedQuote.item.messages.content}
                  </p>
                )}

                {/* Author element drifting slightly to the right of content edge */}
                <div className="w-full mt-6 justify-end flex select-none pr-4" onClick={(e) => e.stopPropagation()}>
                  <p className="text-white/60 text-sm md:text-base font-semibold tracking-wide translate-x-[20px] shrink-0">
                    — {selectedQuote.profile.full_name || selectedQuote.profile.username || 'Someone'}
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom App Name Watermark */}
            <div className="text-center pb-2 shrink-0">
              <span className="text-white/15 text-sm uppercase tracking-[0.4em] font-light">
                socium
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dynamic Pop-up Full Screen view with Pinch, Zoom support */}
      <ProfileImageViewer 
        viewingImage={viewingFullscreenImage} 
        setViewingImage={setViewingFullscreenImage} 
      />
    </>
  );
}
