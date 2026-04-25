import React from 'react';
import { Heart, MessageCircle, Send, MoreHorizontal } from 'lucide-react';
import { Post } from '@/src/types';
import { formatDate } from '@/src/lib/utils';
import { motion } from 'motion/react';

interface PostCardProps {
  post: Post;
  onLike?: (id: string) => void;
}

export default function PostCard({ post, onLike }: PostCardProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-black border-b border-white/5 pb-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-white/10 ring-1 ring-white/20">
            {post.profiles.avatar_url ? (
              <img src={post.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/40 font-bold">
                {post.profiles.username[0].toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight">{post.profiles.username}</p>
            <p className="text-[10px] text-white/50">{formatDate(post.created_at)}</p>
          </div>
        </div>
        <button className="text-white/40">
          <MoreHorizontal size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="relative aspect-square bg-white/5 overflow-hidden">
        <img 
          src={post.image_url} 
          alt={post.caption || ""} 
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>

      {/* Interactions */}
      <div className="px-4 py-3">
        <div className="flex items-center space-x-4 mb-2">
          <button 
            onClick={() => onLike?.(post.id)}
            className={cn("transition-colors", post.has_liked ? "text-red-500" : "text-white")}
          >
            <Heart size={24} fill={post.has_liked ? "currentColor" : "none"} />
          </button>
          <button className="text-white">
            <MessageCircle size={24} />
          </button>
          <button className="text-white">
            <Send size={24} />
          </button>
        </div>
        
        {post.likes_count !== undefined && post.likes_count > 0 && (
          <p className="text-sm font-bold mb-1">{post.likes_count.toLocaleString()} likes</p>
        )}
        
        {post.caption && (
          <p className="text-sm">
            <span className="font-bold mr-2">{post.profiles.username}</span>
            <span className="text-white/90">{post.caption}</span>
          </p>
        )}
      </div>
    </motion.div>
  );
}

// Helper for classes used in props
import { cn } from '@/src/lib/utils';
