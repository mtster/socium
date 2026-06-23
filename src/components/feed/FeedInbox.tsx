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

  useEffect(() => {
    const handleOpenActivityId = (e: any) => {
      const actId = e.detail?.activityId;
      if (actId) {
        const fetchAndOpenActivity = async () => {
          const { data } = await supabase.from('feed_activity').select('*').eq('id', actId).single();
          if (data) {
            handleActivityClick(data);
          }
        };
        fetchAndOpenActivity();
      }
    };
    window.addEventListener('openActivityId', handleOpenActivityId);
    return () => window.removeEventListener('openActivityId', handleOpenActivityId);
  }, [currentUserId, seenIds, baseTimestamp, activities]);

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
      const { data: feats1, error: err1 } = await supabase
        .from('feed_activity')
        .select('*, initiator:profiles!feed_activity_initiator_id_fkey(*)')
        .in('initiator_id', connectionIds)
        .order('created_at', { ascending: false })
        .limit(30);

      if (err1 && !feats1) throw err1;
      
      let feats = feats1 || [];

      // Filter out own activities, and ensure the initiator is part of our connections
      const filtered = (feats || []).filter((act: any) => {
        if (act.initiator_id === currentUserId) return false;
        return connectionIds.includes(act.initiator_id);
      });
      setActivities(filtered);
    } catch (err) {
      console.error('Error loading inbox activities:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivityClick = async (activity: any) => {
    const isUnseen = activity.created_at > baseTimestamp && !seenIds.has(activity.id);

    if (activity.activity_type === 'connection_request') {
      onUserClick(activity.initiator_id);
    } else if (activity.post_id) {
      // Optimistically use a cached post if available to trigger instant animation
      const cached = useStore.getState().feedPosts.find(p => p.id === activity.post_id);
      if (cached) {
        setActivePost(cached);
      } else {
        // Fallback: set a temporary loading object to trigger the slide-in
        setActivePost({ id: activity.post_id, _isLoading: true });
      }

      // Fetch fresh post details to display
      (async () => {
        try {
          const { data: postItem } = await supabase
            .from('posts')
            .select(`
              *,
              profiles(*),
              likes(user_id),
              comments(id)
            `)
            .eq('id', activity.post_id)
            .maybeSingle();
          
          if (postItem) {
            setActivePost({
              ...postItem,
              has_liked: postItem.likes?.some((l: any) => l.user_id === currentUserId),
              likes_count: postItem.likes?.length || 0,
              comments_count: postItem.comments?.length || 0
            });
          } else if (!cached) {
            setActivePost(null);
            alert('This post is no longer available.');
          }
        } catch (err) {
          console.error('Failed to load post details:', err);
          if (!cached) setActivePost(null);
        }
      })();
    }
    
    // Defer the database writes and unseen set updates so the navigation happens instantly
    setTimeout(async () => {
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
        const remainingUnseen = activities.filter((act: any) => {
          if (act.id === activity.id) return false;
          const actUnseen = act.created_at > baseTimestamp && !newSeen.has(act.id);
          return actUnseen;
        });

        if (remainingUnseen.length === 0) {
          const nowStr = new Date().toISOString();
          await supabase
            .from('profiles')
            .update({ base_timestamp: nowStr })
            .eq('id', currentUserId);
          
          await supabase
            .from('seen_activities')
            .delete()
            .eq('user_id', currentUserId);

          setBaseTimestamp(nowStr);
          setSeenIds(new Set());
        }
      }
    }, 400);
  };

  const handleLikePost = async (postId: string, isLiked: boolean) => {
    if (!activePost) return;
    
    // Optimistic UI update
    setActivePost({
      ...activePost,
      has_liked: !isLiked,
      likes_count: (activePost.likes_count || 0) + (isLiked ? -1 : 1)
    });

    const { setFeedPosts, feedPosts } = useStore.getState();
    setFeedPosts(feedPosts.map(p => {
      if (p.id === postId) {
        return {
          ...p,
          has_liked: !isLiked,
          likes_count: (p.likes_count || 0) + (isLiked ? -1 : 1)
        };
      }
      return p;
    }));
    
    try {
      if (isLiked) {
        const { error } = await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', currentUserId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('likes').insert({ post_id: postId, user_id: currentUserId });
        if (error) throw error;
      }
    } catch (err) {
      console.error('Error toggling like:', err);
    }
  };

  const handleRefetch = async () => {
    if (!activePost) return;
    try {
      const { data } = await supabase
        .from('posts')
        .select(`
          *,
          profiles(*),
          likes(user_id),
          comments(id)
        `)
        .eq('id', activePost.id)
        .maybeSingle();

      if (data) {
        const updatedPost = {
          ...data,
          has_liked: data.likes?.some((l: any) => l.user_id === currentUserId),
          likes_count: data.likes?.length || 0,
          comments_count: data.comments?.length || 0
        };
        setActivePost(updatedPost);
        
        // Update global feed so when going back, it's synced
        const { setFeedPosts, feedPosts } = useStore.getState();
        setFeedPosts(feedPosts.map(p => {
          if (p.id === activePost.id) {
            return updatedPost;
          }
          return p;
        }));
      }
    } catch (err) {
      console.error('Error refetching post:', err);
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
            <strong className="text-white hover:underline">{name}</strong> created a new post
          </span>
        );
      case 'like':
        return (
          <span>
            <strong className="text-white hover:underline">{name}</strong> liked your post
          </span>
        );
      case 'comment':
        return (
          <span>
            <strong className="text-white hover:underline">{name}</strong> commented on your post
          </span>
        );
      case 'connection_request':
        return (
          <span>
            <strong className="text-white hover:underline">{name}</strong> sent you a connection request
          </span>
        );
      default:
        return <span>New activity from <strong className="text-white">{name}</strong></span>;
    }
  };

  return (
    <div className="w-full h-full bg-zinc-950 flex flex-col">
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
                      <div className="absolute -bottom-1 -right-1 flex items-center justify-center shadow">
                        {renderIcon(act.activity_type)}
                      </div>
                    </div>

                    {/* Activity message */}
                    <div className="flex-1 min-w-0 text-xs text-white/70 leading-relaxed">
                      {renderActivityText(act)}
                      <div className="text-[10px] text-white/50 mt-1">
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
              {activePost._isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                  <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Fetching post...</p>
                </div>
              ) : (
                <PostCard
                  post={activePost}
                  currentUserId={currentUserId}
                  onLike={handleLikePost}
                  onRefetch={handleRefetch}
                  onUserClick={(uid) => {
                    setActivePost(null);
                    onUserClick(uid);
                  }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
