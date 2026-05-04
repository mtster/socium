import React, { useState, useEffect } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Post } from '@/src/types';
import PostCard from './PostCard';
import { motion } from 'motion/react';
import { useStore } from '../store/useStore';

interface FeedProps {
  currentUserId: string;
  onUserClick: (userId: string) => void;
}

export default function Feed({ currentUserId, onUserClick }: FeedProps) {
  const { feedPosts, fetchFeedPosts } = useStore();
  const [loading, setLoading] = useState(feedPosts.length === 0);

  useEffect(() => {
    if (feedPosts.length === 0) {
      fetchFeedPosts(currentUserId).then(() => setLoading(false));
    } else {
      setLoading(false);
      // Background refresh
      fetchFeedPosts(currentUserId);
    }
    
    const handleResetTab = (e: any) => {
      if (e.detail?.tabId === 'feed') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('resetTab', handleResetTab);
    return () => window.removeEventListener('resetTab', handleResetTab);
  }, []);

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
      } else {
        const { error } = await supabase.from('likes').insert({ post_id: postId, user_id: currentUserId });
        if (error) throw error;
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
        feedPosts.map((post: Post) => (
          <div key={post.id}>
            <PostCard 
              post={post} 
              currentUserId={currentUserId}
              onUserClick={onUserClick}
              onDelete={handleDeletePost}
              onLike={handleLikePost}
              onRefetch={() => fetchFeedPosts(currentUserId)}
            />
          </div>
        ))
      ) : (
        <div className="px-10 py-32 text-center">
          <p className="text-white/40 font-medium">The feed is silent.</p>
          <p className="text-xs text-white/20 mt-1">Be the first to share a story.</p>
        </div>
      )}
    </div>
  );
}
