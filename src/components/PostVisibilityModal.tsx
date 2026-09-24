import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Profile, PostVisibilityMode } from '@/src/types';
import { supabase } from '@/src/lib/supabase';

interface PostVisibilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  initialMode: PostVisibilityMode;
  initialAudience: string[];
  onSave: (mode: PostVisibilityMode, audience: string[]) => void;
}

export default function PostVisibilityModal({
  isOpen,
  onClose,
  userId,
  initialMode,
  initialAudience,
  onSave,
}: PostVisibilityModalProps) {
  // iPhone-style tab switcher: 'allow' (who can see) vs 'restrict' (who cannot see)
  // Only one tab's settings can be applied
  const [activeTab, setActiveTab] = useState<'allow' | 'restrict'>(
    initialMode === 'except_list' ? 'restrict' : 'allow'
  );

  const [allowedIds, setAllowedIds] = useState<string[]>(
    initialMode === 'allowed_list' ? initialAudience : []
  );
  const [restrictedIds, setRestrictedIds] = useState<string[]>(
    initialMode === 'except_list' ? initialAudience : []
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [connections, setConnections] = useState<Profile[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingInitial, setIsLoadingInitial] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);

  // Sync state whenever modal opens or props change
  useEffect(() => {
    if (isOpen) {
      const mode = initialMode || 'all_connections';
      setActiveTab(mode === 'except_list' ? 'restrict' : 'allow');
      setAllowedIds(mode === 'allowed_list' ? initialAudience : []);
      setRestrictedIds(mode === 'except_list' ? initialAudience : []);
      setSearchQuery('');
      setOffset(0);
      setHasMore(true);
      fetchInitialConnections();
    }
  }, [isOpen, userId]);

  // Initial fetch: Limit 12 connections
  const fetchInitialConnections = async () => {
    if (!userId) return;
    setIsLoadingInitial(true);
    try {
      const INITIAL_LIMIT = 12;
      const { data, error } = await supabase
        .from('connections')
        .select('connection_id, profiles!connection_id(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(0, INITIAL_LIMIT - 1);

      if (error) {
        console.error('Error fetching initial connections:', error);
        return;
      }

      let loaded = (data || []).map((c: any) => c.profiles).filter(Boolean) as Profile[];

      // If there are initial audience IDs not yet in the first 12, fetch their profile info
      // so they display accurately in the selected list
      const missingIds = (initialAudience || []).filter(
        id => !loaded.some(p => p.id === id)
      );

      if (missingIds.length > 0) {
        const { data: missingProfiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', missingIds);

        if (missingProfiles) {
          loaded = [...missingProfiles, ...loaded];
        }
      }

      setConnections(loaded);
      setOffset(INITIAL_LIMIT);
      setHasMore((data?.length || 0) === INITIAL_LIMIT);
    } catch (err) {
      console.error('Failed to fetch initial connections:', err);
    } finally {
      setIsLoadingInitial(false);
    }
  };

  // Subsequent fetch: 10 connections per scrolldown gesture
  const fetchMoreConnections = useCallback(async () => {
    if (isLoadingMore || !hasMore || isLoadingInitial || !userId) return;

    setIsLoadingMore(true);
    try {
      const NEXT_LIMIT = 10;
      const nextOffset = offset;
      const { data, error } = await supabase
        .from('connections')
        .select('connection_id, profiles!connection_id(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(nextOffset, nextOffset + NEXT_LIMIT - 1);

      if (error) {
        console.error('Error fetching more connections:', error);
        return;
      }

      const nextBatch = (data || []).map((c: any) => c.profiles).filter(Boolean) as Profile[];

      setConnections(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const unique = nextBatch.filter(p => !existingIds.has(p.id));
        return [...prev, ...unique];
      });

      setOffset(nextOffset + NEXT_LIMIT);
      setHasMore((data?.length || 0) === NEXT_LIMIT);
    } catch (err) {
      console.error('Failed to load more connections:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, isLoadingInitial, userId, offset]);

  // Infinite scroll trigger on scrolldown
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 120) {
      fetchMoreConnections();
    }
  };

  const handleDone = () => {
    if (activeTab === 'allow') {
      if (allowedIds.length === 0) {
        onSave('all_connections', []);
      } else {
        onSave('allowed_list', allowedIds);
      }
    } else {
      // activeTab === 'restrict'
      if (restrictedIds.length === 0) {
        onSave('all_connections', []);
      } else {
        onSave('except_list', restrictedIds);
      }
    }
    onClose();
  };

  const toggleConnection = (id: string) => {
    if (activeTab === 'allow') {
      setAllowedIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      );
    } else {
      setRestrictedIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      );
    }
  };

  const isSelected = (id: string) => {
    return activeTab === 'allow'
      ? allowedIds.includes(id)
      : restrictedIds.includes(id);
  };

  const filteredConnections = connections.filter(c => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const name = (c.full_name || '').toLowerCase();
    const username = (c.username || '').toLowerCase();
    return name.includes(query) || username.includes(query);
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 26, stiffness: 220 }}
          className="fixed inset-0 bg-black z-[110] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 h-16 border-b border-white/10 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="text-white/60 active:scale-95 transition-transform p-1"
            >
              <X size={24} />
            </button>
            <h2 className="text-sm font-bold uppercase tracking-widest text-white/90">
              Select Audience
            </h2>
            <button
              type="button"
              onClick={handleDone}
              className="text-white font-bold text-sm active:scale-95 transition-transform px-2 py-1"
            >
              Done
            </button>
          </div>

          {/* iPhone-Style Tab Switcher */}
          <div className="px-4 pt-3 pb-2 shrink-0">
            <div className="p-1 bg-white/[0.08] rounded-2xl flex items-center border border-white/5 relative">
              <button
                type="button"
                onClick={() => setActiveTab('allow')}
                className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-all duration-200 text-center ${
                  activeTab === 'allow'
                    ? 'bg-white text-black shadow-md'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Allow
                {allowedIds.length > 0 && activeTab === 'allow' && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-black/10 text-[10px]">
                    {allowedIds.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('restrict')}
                className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-all duration-200 text-center ${
                  activeTab === 'restrict'
                    ? 'bg-white text-black shadow-md'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Restrict
                {restrictedIds.length > 0 && activeTab === 'restrict' && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-black/10 text-[10px]">
                    {restrictedIds.length}
                  </span>
                )}
              </button>
            </div>
            <p className="text-[11px] text-white/40 px-1 mt-2 font-medium">
              {activeTab === 'allow'
                ? 'Only selected connections will be able to view this post.'
                : 'All connections except the selected ones will be able to view this post.'}
            </p>
          </div>

          {/* Search Bar */}
          <div className="p-4 border-b border-white/10 shrink-0">
            <div className="relative">
              <input
                type="text"
                placeholder="Search connections..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-white/10 border border-white/10 text-white placeholder:text-white/40 rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:border-white/30 text-sm transition-all"
              />
              <Search
                size={18}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Connections List with Infinite Scroll (12 initial, 10 on scrolldown) */}
          <div
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar"
          >
            {/* Top All-Connections button */}
            {activeTab === 'allow' ? (
              <button
                type="button"
                onClick={() => setAllowedIds([])}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 active:bg-white/10 transition-colors"
              >
                <span className="font-bold text-white text-sm">All Connections</span>
                {allowedIds.length === 0 && (
                  <div className="w-3 h-3 rounded-full bg-white" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setRestrictedIds([])}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 active:bg-white/10 transition-colors"
              >
                <span className="font-bold text-white text-sm">All Connections</span>
                {restrictedIds.length === 0 && (
                  <div className="w-3 h-3 rounded-full bg-white" />
                )}
              </button>
            )}

            {/* List of Connections */}
            {filteredConnections.map(c => {
              const selected = isSelected(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleConnection(c.id)}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 active:bg-white/10 transition-colors text-left"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0 flex items-center justify-center">
                      {c.avatar_url ? (
                        <img
                          src={c.avatar_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-white/50 font-bold uppercase">
                          {c.username?.charAt(0) || '?'}
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-white/80 text-sm truncate">
                      {c.full_name || c.username}
                    </span>
                  </div>
                  {selected && (
                    <div className="w-3 h-3 rounded-full bg-white shrink-0 ml-3" />
                  )}
                </button>
              );
            })}

            {/* Empty state */}
            {!isLoadingInitial && filteredConnections.length === 0 && (
              <div className="text-center py-8 text-white/40 text-xs font-medium">
                {searchQuery ? 'No connections match your search.' : 'No connections found.'}
              </div>
            )}

            {/* Loading indicators */}
            {(isLoadingInitial || isLoadingMore) && (
              <div className="flex items-center justify-center py-4 space-x-2 text-white/50 text-xs">
                <Loader2 size={16} className="animate-spin" />
                <span>Loading connections...</span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
