import React, { useState, useEffect } from 'react';
import { supabase } from '@/src/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Heart, MessageSquare, Plus, UserPlus, Image as ImageIcon } from 'lucide-react';
import { useStore } from '@/src/store/useStore';
import { formatDate } from '@/src/lib/utils';
import PostCard from '@/src/components/PostCard';

interface FeedInboxProps {
  currentUserId: string;
  onBack: () => void;
  onUserClick: (userId: string) => void;
}

export default function FeedInbox({ currentUserId, onBack, onUserClick }: FeedInboxProps) {
  const [activities, setActivities] = useState<any[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [baseTimestamp, setBaseTimestamp] = useState<string>(new Date(0).toISOString());
  const [loading, setLoading] = useState(true);
  const [activePost, setActivePost] = useState<any | null>(null);

  const { feedUnseenCount, setFeedUnseenCount } = useStore();

  useEffect(() => {
    fetchInboxData();
  }, [currentUserId]);

  const fetchInboxData = async () => {
    try {
      setLoading(true);

      // 1. Fetch user profile config
      const { data: prof } = await supabase
        .from('profiles')
        .select('base_timestamp')
        .eq('id', currentUserId)
        .maybeSingle();
      
      const bTS = prof?.base_timestamp || new Date(0).toISOString();
      setBaseTimestamp(bTS);

      // 2. Fetch seen activities
      const { data: seenData } = await supabase
        .from('seen_activities')
        .select('activity_id')
        .eq('user_id', currentUserId);
      
      const sIds = new Set<string>((seenData || []).map((s: any) => s.activity_id));
      setSeenIds(sIds);

      // 3. Get connections to fetch post creators
      const { data: conns } = await supabase
        .from('connections')
        .select('connection_id')
        .eq('user_id', currentUserId);

      const connectionIds = [
        currentUserId,
        '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2', // Admin
        '00000000-0000-0000-0000-000000000001'  // Bot
      ];
      if (conns) {
        conns.forEach(c => {
          if (c.connection_id) connectionIds.push(c.connection_id);
        });
      }

      // 4. Query activities
      const { data: feats, error } = await supabase
        .from('feed_activity')
        .select('*, initiator:profiles!feed_activity_initiator_id_fkey(*)')
        .or(`initiator_id.in.(${connectionIds.join(',')}),target_user_id.eq.${currentUserId}`)
        .order('created_at', { ascending: false })
        .limit(15);

      if (error) throw error;

      // Filter out own activities
      const filtered = (feats || []).filter((act: any) => act.initiator_id !== currentUserId);
      setActivities(filtered);
    } catch (err) {
      console.error('Error loading inbox activities:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivityClick = async (activity: any) => {
    const isUnseen = activity.created_at > baseTimestamp && !seenIds.has(activity.id);

    if (isUnseen) {
      // 1. Mark as seen in UI state
      const newSeen = new Set(seenIds);
      newSeen.add(activity.id);
      setSeenIds(newSeen);

      // 2. Insert into database seen_activities
      await supabase.from('seen_activities').insert({
        user_id: currentUserId,
        activity_id: activity.id
      });

      // 3. Decrement unseen count in state
      const nextCount = Math.max(0, feedUnseenCount - 1);
      setFeedUnseenCount(nextCount);

      // 4. Garbage Collection Optimization:
      // Check if there are no more unseen activities in the current batch
      const remainingUnseen = activities.filter((act: any) => {
        if (act.id === activity.id) return false;
        const actUnseen = act.created_at > baseTimestamp && !newSeen.has(act.id);
        return actUnseen;
      });

      if (remainingUnseen.length === 0) {
        // Update profile high watermark 'base_timestamp'
        const nowStr = new Date().toISOString();
        await supabase
          .from('profiles')
          .update({ base_timestamp: nowStr })
          .eq('id', currentUserId);
        
        // Clear all rows from seen_activities to save database space
        await supabase
          .from('seen_activities')
          .delete()
          .eq('user_id', currentUserId);

        setBaseTimestamp(nowStr);
        setSeenIds(new Set());
      }
    }

    // 5. Action routing
    if (activity.activity_type === 'connection_request') {
      onUserClick(activity.initiator_id);
    } else if (activity.post_id) {
      // Fetch post details to display
      try {
        const { data: postItem } = await supabase
          .from('posts')
          .select('*, profiles(*)')
          .eq('id', activity.post_id)
          .maybeSingle();
        
        if (postItem) {
          setActivePost(postItem);
        } else {
          alert('This post is no longer available.');
        }
      } catch (err) {
        console.error('Failed to load post details:', err);
      }
    }
  };

  const renderIcon = (type: string) => {
    switch (type) {
      case 'post':
        return <Plus className="w-4 h-4 text-emerald-400" />;
      case 'like':
        return <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />;
      case 'comment':
        return <MessageSquare className="w-4 h-4 text-sky-400 fill-sky-400" />;
      case 'connection_request':
        return <UserPlus className="w-4 h-4 text-yellow-400" />;
      default:
        return null;
    }
  };

  const renderActivityText = (act: any) => {
    const name = act.initiator?.full_name || act.initiator?.username || 'Someone';
    switch (act.activity_type) {
      case 'post':
        return (
          <span>
            <strong className="text-white hover:underline cursor-pointer" onClick={(e) => { e.stopPropagation(); onUserClick(act.initiator_id); }}>{name}</strong> created a new post
          </span>
        );
      case 'like':
        return (
          <span>
            <strong className="text-white hover:underline cursor-pointer" onClick={(e) => { e.stopPropagation(); onUserClick(act.initiator_id); }}>{name}</strong> liked your post
          </span>
        );
      case 'comment':
        return (
          <span>
            <strong className="text-white hover:underline cursor-pointer" onClick={(e) => { e.stopPropagation(); onUserClick(act.initiator_id); }}>{name}</strong> commented on your post
          </span>
        );
      case 'connection_request':
        return (
          <span>
            <strong className="text-white hover:underline cursor-pointer" onClick={(e) => { e.stopPropagation(); onUserClick(act.initiator_id); }}>{name}</strong> sent you a connection request
          </span>
        );
      default:
        return <span>New activity from <strong className="text-white">{name}</strong></span>;
    }
  };

  return (
    <div className="absolute inset-0 bg-zinc-950 flex flex-col z-55">
      {/* Header */}
      <header className="h-14 shrink-0 bg-black/80 border-b border-white/10 flex items-center px-4 relative">
        <button 
          id="inbox-back-btn"
          onClick={onBack} 
          className="p-1 text-white/70 hover:text-white transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-lg font-bold text-white ml-4 tracking-tight">Inbox Notifications</h1>
      </header>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-safe">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-white/40">Loading activities...</span>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center px-6">
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <Heart className="w-6 h-6 text-white/30" />
            </div>
            <h3 className="text-sm font-semibold text-white/80">Inbox is empty</h3>
            <p className="text-xs text-white/40 mt-1 max-w-[240px]">
              Activities and notifications will appear here as connections interact.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {activities.map((act) => {
              const isUnseen = act.created_at > baseTimestamp && !seenIds.has(act.id);
              return (
                <div
                  id={`activity-${act.id}`}
                  key={act.id}
                  onClick={() => handleActivityClick(act)}
                  className={`py-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors duration-200 hover:bg-white/5 active:bg-white/10 ${
                    isUnseen ? 'bg-white/[0.02]' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Avatar with type badge overlay */}
                    <div className="relative shrink-0">
                      <div 
                        className="w-11 h-11 rounded-full border border-white/10 overflow-hidden bg-zinc-850 hover:opacity-80 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); onUserClick(act.initiator_id); }}
                      >
                        {act.initiator?.avatar_url ? (
                          <img 
                            src={act.initiator.avatar_url} 
                            alt="" 
                            className="w-full h-full object-cover" 
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-full h-full bg-zinc-800 flex items-center justify-center text-sm font-bold text-white/70">
                            {(act.initiator?.full_name?.charAt(0) || act.initiator?.username?.charAt(0) || '?').toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-zinc-900 border border-white/10 flex items-center justify-center shadow">
                        {renderIcon(act.activity_type)}
                      </div>
                    </div>

                    {/* Activity message */}
                    <div className="flex-1 min-w-0 text-xs text-white/70 leading-relaxed">
                      {renderActivityText(act)}
                      <div className="text-[10px] text-white/45 mt-1 font-mono">
                        {formatDate(act.created_at)}
                      </div>
                    </div>
                  </div>

                  {/* Actions / Blue dot indicators */}
                  <div className="flex items-center gap-3 shrink-0">
                    {isUnseen && (
                      <div className="w-2.5 h-2.5 bg-sky-400 rounded-full animate-pulse shadow-md shadow-sky-400/50" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Post details overlay view */}
      <AnimatePresence>
        {activePost && (
          <motion.div
            id="inbox-post-detail-overlay"
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            transition={{ type: 'spring', damping: 24, stiffness: 220 }}
            className="absolute inset-0 bg-zinc-950 flex flex-col z-60"
          >
            <header className="h-14 shrink-0 bg-black/80 border-b border-white/10 flex items-center px-4">
              <button 
                id="inbox-post-back-btn"
                onClick={() => setActivePost(null)} 
                className="p-1 text-white/70 hover:text-white transition-colors"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="text-sm font-bold text-white ml-4 tracking-tight">Post Detail</h2>
            </header>

            <div className="flex-1 overflow-y-auto p-4 pb-safe space-y-4">
              <PostCard
                post={activePost}
                currentUserId={currentUserId}
                onUserClick={(uid) => {
                  setActivePost(null);
                  onUserClick(uid);
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
