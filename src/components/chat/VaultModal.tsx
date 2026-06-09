import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Trash2, Play, Pause, Volume2, Mic, Image, FileText, Sparkles, Vault } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { cn } from '@/src/lib/utils';

interface VaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeChat: any;
  currentUserId: string;
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

  // Audio playing state inside Quote view
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const LIMIT = 20;

  useEffect(() => {
    if (isOpen) {
      setVaultItems([]);
      setOffset(0);
      setHasMore(true);
      setIsEditing(false);
      fetchVaultItems(0, true);
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
        .from('vault_messages')
        .select(`
          id,
          created_at,
          message_id,
          messages!inner (
            id,
            content,
            media_url,
            media_type,
            created_at,
            sender_id,
            receiver_id,
            group_chat_id
          )
        `)
        .order('created_at', { ascending: false })
        .range(currentOffset, currentOffset + LIMIT - 1);

      if (activeChat.isGroup) {
        query = query.eq('messages.group_chat_id', activeChat.id);
      } else {
        query = query
          .is('messages.group_chat_id', null)
          .or(`and(messages.sender_id.eq.${activeChat.id},messages.receiver_id.eq.${currentUserId}),and(messages.sender_id.eq.${currentUserId},messages.receiver_id.eq.${activeChat.id})`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching vault items:', error);
        return;
      }

      if (data) {
        const uniqueSenderIds = Array.from(
          new Set(data.map((item: any) => item.messages.sender_id))
        ).filter(Boolean) as string[];

        if (uniqueSenderIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('*')
            .in('id', uniqueSenderIds);
          if (profiles) {
            const newProfilesMapMap = { ...profilesMap };
            profiles.forEach((p: any) => {
              newProfilesMapMap[p.id] = p;
            });
            setProfilesMap(newProfilesMapMap);
          }
        }

        setVaultItems(prev => initial ? data : [...prev, ...data]);
        setHasMore(data.length === LIMIT);
        setOffset(currentOffset + LIMIT);
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
        setVaultItems(prev => prev.filter(item => item.id !== itemToRemove.id));
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

  // Playback handlers
  const togglePlayAudio = (url: string) => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (!audioRef.current) {
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.addEventListener('timeupdate', () => {
          if (audio.duration) {
            setAudioProgress((audio.currentTime / audio.duration) * 100);
          }
        });
        audio.addEventListener('ended', () => {
          setIsPlaying(false);
          setAudioProgress(0);
        });
      }
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setAudioProgress(0);
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
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
              className="flex-1 overflow-y-auto pb-safe px-4 py-4 space-y-3"
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
                    <Vault size={28} className="text-white/40" />
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
                    const isMine = message.sender_id === currentUserId;

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
                          "w-full bg-[#1c1c1c] active:bg-[#262626] rounded-2xl flex items-center p-4 gap-4 border border-white/5 shadow-md relative transition-all group overflow-hidden decoration-none",
                          isEditing ? "cursor-default pl-12" : "cursor-pointer"
                        )}
                      >
                        {/* Remove actions overlay */}
                        <AnimatePresence>
                          {isEditing && (
                            <motion.button
                              initial={{ x: -40, opacity: 0 }}
                              animate={{ x: 0, opacity: 1 }}
                              exit={{ x: -40, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setItemToRemove(item);
                              }}
                              className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white"
                            >
                              <Trash2 size={15} />
                            </motion.button>
                          )}
                        </AnimatePresence>

                        {/* Profile pic of author */}
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-white/5 border border-white/10 shrink-0">
                          {profile.avatar_url ? (
                            <img src={profile.avatar_url} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-white/10 flex items-center justify-center font-bold text-xs text-white/60">
                              {(profile.full_name?.charAt(0) || profile.username?.charAt(0) || '?').toUpperCase()}
                            </div>
                          )}
                        </div>

                        {/* Content text/visuals and meta */}
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <span className="font-bold text-sm text-white/90 truncate">
                              {profile.full_name || profile.username || 'Someone'}
                            </span>
                            <span className="text-[10px] text-white/30 shrink-0">
                              {formatDate(message.created_at)}
                            </span>
                          </div>

                          {/* Render preview style based on message content type */}
                          {message.media_type === 'image' ? (
                            <div className="flex items-center gap-2 mt-0.5">
                              <Image size={13} className="text-white/40" />
                              <span className="text-xs text-white/40 font-medium italic">Image</span>
                            </div>
                          ) : message.media_type === 'audio' ? (
                            <div className="flex items-center gap-2 mt-0.5">
                              <Mic size={13} className="text-white/40" />
                              <span className="text-xs text-white/40 font-medium italic">Voice Note</span>
                            </div>
                          ) : (
                            <p className="text-[13px] text-white/60 truncate leading-relaxed">
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
            {/* Top Author Metadata */}
            <div className="flex flex-col items-center gap-2 mt-4">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-white/5 border border-white/10 shadow-2xl">
                {selectedQuote.profile.avatar_url ? (
                  <img src={selectedQuote.profile.avatar_url} className="w-full h-full object-cover referrer-no-referrer" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full bg-white/10 flex items-center justify-center font-bold text-2xl text-white/50">
                    {(selectedQuote.profile.full_name?.charAt(0) || selectedQuote.profile.username?.charAt(0) || '?').toUpperCase()}
                  </div>
                )}
              </div>
              <span className="text-white/40 text-[11px] tracking-widest uppercase font-semibold mt-2">
                {formatDate(selectedQuote.item.messages.created_at)}
              </span>
            </div>

            {/* Middle Quote Content */}
            <div className="w-full max-w-lg flex flex-col items-center justify-center px-4 self-center" onClick={(e) => e.stopPropagation()}>
              {selectedQuote.item.messages.media_type === 'image' ? (
                <div className="rounded-3xl overflow-hidden border border-white/10 max-h-[45vh] shadow-2xl">
                  <img src={selectedQuote.item.messages.media_url} className="w-full max-h-[45vh] object-contain" />
                </div>
              ) : selectedQuote.item.messages.media_type === 'audio' ? (
                /* Sleek Audio Waveform Visualizer for screenshot ready display */
                <div className="w-full flex flex-col items-center gap-8 py-6 px-10 bg-white/5 border border-white/5 rounded-3xl shadow-xl w-full max-w-sm backdrop-blur-md">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => togglePlayAudio(selectedQuote.item.messages.media_url)}
                      className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-2xl active:scale-90 transition-transform hover:bg-gray-100"
                    >
                      {isPlaying ? <Pause size={28} className="ml-0" /> : <Play size={28} className="ml-1" />}
                    </button>
                    <div className="flex flex-col">
                      <span className="text-white text-sm font-bold">Voice Transcription</span>
                      <span className="text-white/50 text-[11px] mt-0.5">Tap to play / listen</span>
                    </div>
                  </div>

                  {/* High End Pulse Wave */}
                  <div className="w-full flex items-center justify-between gap-1 h-12">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((bar) => {
                      const isActive = isPlaying && audioProgress > (bar - 1) * 5;
                      const randomHeight = [24, 40, 16, 32, 28, 48, 12, 36, 44, 20, 28, 40, 16, 32, 28, 48, 12, 36, 44, 20];
                      return (
                        <div
                          key={bar}
                          style={{ height: `${randomHeight[bar - 1]}px` }}
                          className={cn(
                            "w-[4px] rounded-full transition-all duration-300",
                            isActive ? "bg-white shadow-[0_0_12px_rgba(255,255,255,0.7)]" : "bg-white/10",
                            isPlaying && "animate-pulse"
                          )}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col">
                  <p className="text-white text-center font-serif text-2xl md:text-3xl leading-relaxed italic tracking-wide select-text">
                    "{selectedQuote.item.messages.content}"
                  </p>
                  <p className="text-white/60 text-right text-sm md:text-base font-semibold mt-6 tracking-wide self-end">
                    — {selectedQuote.profile.full_name || selectedQuote.profile.username || 'Someone'}
                  </p>
                </div>
              )}
            </div>

            {/* Bottom App Name Watermark (Subtle yet elegant placeholder) */}
            <div className="text-center">
              <span className="text-white/15 text-sm uppercase tracking-[0.4em] font-light">
                socium
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
