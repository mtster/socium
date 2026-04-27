import React, { useState, useEffect } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Post } from '@/src/types';
import PostCard from './PostCard';
import { motion } from 'motion/react';

interface FeedProps {
  currentUserId: string;
  onUserClick: (userId: string) => void;
}

export default function Feed({ currentUserId, onUserClick }: FeedProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPosts();
  }, []);

  async function fetchPosts() {
    try {
      setLoading(true);
      
      // Get connections
      const { data: connectionsData } = await supabase
        .from('connections')
        .select(`requester_id, receiver_id`)
        .eq('status', 'accepted')
        .or(`requester_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`);
        
      const connectionIds = [currentUserId, '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2'];
      if (connectionsData) {
        connectionsData.forEach(c => {
          if (c.requester_id !== currentUserId) connectionIds.push(c.requester_id);
          if (c.receiver_id !== currentUserId) connectionIds.push(c.receiver_id);
        });
      }

      const { data, error } = await supabase
        .from('posts')
        .select(`
          *,
          profiles:user_id (*),
          likes(user_id),
          comments(id)
        `)
        .in('user_id', connectionIds)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      
      const processed = (data || []).map((p: any) => ({
        ...p,
        likes_count: p.likes?.length || 0,
        has_liked: p.likes?.some((l: any) => l.user_id === currentUserId),
        comments_count: p.comments?.length || 0
      }));
      setPosts(processed as any);
    } catch (error) {
      console.error('Error fetching posts:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleLikePost = async (postId: string, isLiked: boolean) => {
    // Optimistic UI update
    setPosts(prev => prev.map(p => {
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
      fetchPosts();
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    
    try {
      const { error } = await supabase.from('posts').delete().eq('id', postId);
      if (error) throw error;
      setPosts(posts.filter(p => p.id !== postId));
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
    <div className="pb-6">
      {posts.length > 0 ? (
        posts.map((post: Post, i) => (
          <div key={post.id}>
            <PostCard 
              post={post} 
              currentUserId={currentUserId}
              onUserClick={onUserClick}
              onDelete={handleDeletePost}
              onLike={handleLikePost}
              onRefetch={fetchPosts}
            />
            {i < posts.length - 1 && (
              <div className="mx-0 mb-4 border-t border-white/10" />
            )}
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
