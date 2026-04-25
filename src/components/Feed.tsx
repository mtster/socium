import React, { useState, useEffect } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Post } from '@/src/types';
import PostCard from './PostCard';
import { motion } from 'motion/react';

export default function Feed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPosts();
  }, []);

  async function fetchPosts() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('posts')
        .select(`
          *,
          profiles:user_id (*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPosts(data as any || []);
    } catch (error) {
      console.error('Error fetching posts:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Refreshing moments...</p>
      </div>
    );
  }

  return (
    <div className="pb-20">
      {posts.length > 0 ? (
        posts.map((post: Post) => (
          <div key={post.id}>
            <PostCard post={post} />
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
