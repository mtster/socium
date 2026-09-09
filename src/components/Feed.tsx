import React, { useState, useEffect } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Post } from '@/src/types';
import PostCard from './PostCard';
import { motion } from 'motion/react';
import { useStore } from '../store/useStore';
import { logFeedActivity } from '@/src/lib/feed';

interface FeedProps {
  currentUserId: string;
  onUserClick: (userId: string) => void;
  activeTab: string;
}

export default function Feed({ currentUserId, onUserClick, activeTab }: FeedProps) {
  const { 
    feedPosts, 
    fetchFeedPosts, 
    fetchMoreFeedPosts, 
    hasMoreFeedPosts, 
    isFetchingMoreFeedPosts 
  } = useStore();
  const [loading, setLoading] = useState(feedPosts.length === 0);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  const activeTabRef = React.useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (feedPosts.length === 0) {
      fetchFeedPosts(currentUserId).then(() => {
        setLoading(false);
        (window as any).lastFeedFetchTime = Date.now();
      });
    } else {
      setLoading(false);
      // Background refresh only if older than 2 minutes to avoid CPU spikes and preserve scroll
      const lastFetch = (window as any).lastFeedFetchTime || 0;
      if (Date.now() - lastFetch > 120000) {
        fetchFeedPosts(currentUserId, true).then(() => {
          (window as any).lastFeedFetchTime = Date.now();
        });
      }
    }
    
    // Restore scroll position with requestAnimationFrame to ensure layout is ready
    const mainEl = document.querySelector('main');
    if (mainEl) {
      const savedPos = useStore.getState().feedScrollPos;
      if (savedPos > 0) {
        requestAnimationFrame(() => {
          if (mainEl) mainEl.scrollTop = savedPos;
        });
      }
    }

    const handleScroll = (e: Event) => {
      const target = e.currentTarget as HTMLElement;
      const isFeedActive = activeTabRef.current === 'feed' || (window as any).currentActiveTab === 'feed' || !(window as any).currentActiveTab;
      if (target && isFeedActive) {
        useStore.getState().setFeedScrollPos(target.scrollTop);

        // Infinite scroll pagination trigger
        if (target.scrollHeight - target.scrollTop - target.clientHeight < 800) {
          const state = useStore.getState();
          if (state.hasMoreFeedPosts && !state.isFetchingMoreFeedPosts) {
            state.fetchMoreFeedPosts(currentUserId);
          }
        }
      }
    };

    if (mainEl) {
      mainEl.addEventListener('scroll', handleScroll, { passive: true });
    }

    const handleResetTab = (e: any) => {
      if (e.detail?.tabId === 'feed') {
        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
        useStore.getState().setFeedScrollPos(0);
      }
    };
    window.addEventListener('resetTab', handleResetTab);
    return () => {
      if (mainEl) {
        mainEl.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resetTab', handleResetTab);
    };
  }, []);

  // IntersectionObserver for bottom sentinel to instantaneously trigger next page
  useEffect(() => {
    if (!sentinelRef.current || !hasMoreFeedPosts || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          const state = useStore.getState();
          if (state.hasMoreFeedPosts && !state.isFetchingMoreFeedPosts) {
            state.fetchMoreFeedPosts(currentUserId);
          }
        }
      },
      { root: null, rootMargin: '800px', threshold: 0 }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMoreFeedPosts, currentUserId, loading, feedPosts.length]);

  const handleLikePost = async (postId: string, isLiked: boolean) => {
    const { setFeedPosts } = useStore.getState();
    // Optimistic UI update
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
        
        // Also remove from feed_activity table
        await supabase.from('feed_activity').delete().eq('post_id', postId).eq('initiator_id', currentUserId).eq('activity_type', 'like');
      } else {
        const { error } = await supabase.from('likes').insert({ post_id: postId, user_id: currentUserId });
        if (error) throw error;
        
        await logFeedActivity({
          activityType: 'like',
          initiatorId: currentUserId,
          postId: postId
        });
      }
    } catch (error) {
      // Revert on error
      fetchFeedPosts(currentUserId);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    
    try {
      const { error } = await supabase.from('posts').delete().eq('id', postId);
      if (error) throw error;
      const { setFeedPosts } = useStore.getState();
      setFeedPosts(feedPosts.filter(p => p.id !== postId));
    } catch (error: any) {
      alert(`Failed to delete: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Refreshing moments...</p>
      </div>
    );
  }

  return (
    <div className="pb-6 pt-4">
      {feedPosts.length > 0 ? (
        <>
          {feedPosts.map((post: Post) => (
            <div key={post.id}>
              <PostCard 
                post={post} 
                currentUserId={currentUserId}
                onUserClick={onUserClick}
                onDelete={handleDeletePost}
                onLike={handleLikePost}
                onRefetch={() => fetchFeedPosts(currentUserId, true)}
              />
            </div>
          ))}

          {/* Bottom Sentinel for instantaneous infinite scrolling */}
          <div ref={sentinelRef} className="h-6 w-full flex items-center justify-center">
            {isFetchingMoreFeedPosts && (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin my-4" />
            )}
          </div>
        </>
      ) : (
        <div className="px-10 py-32 text-center">
          <p className="text-white/40 font-medium">The feed is silent.</p>
          <p className="text-xs text-white/20 mt-1">Be the first to share a story.</p>
        </div>
      )}
    </div>
  );
}
