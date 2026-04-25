import React, { useState, useEffect, useRef } from 'react';
import { Heart, MessageCircle, Send, MoreHorizontal, Trash } from 'lucide-react';
import { Post } from '@/src/types';
import { formatDate, cn } from '@/src/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import CommentsModal from './CommentsModal';

interface PostCardProps {
  post: Post;
  currentUserId: string;
  onLike?: (id: string, isLiked: boolean) => void;
  onDelete?: (id: string) => void;
  onUserClick?: (userId: string) => void;
}

export default function PostCard({ post, currentUserId, onLike, onDelete, onUserClick }: PostCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isOwner = post.user_id === currentUserId;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-black border-b border-white/5 pb-4 relative"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div 
          className="flex items-center space-x-3 cursor-pointer group"
          onClick={() => onUserClick?.(post.user_id)}
        >
          <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 ring-1 ring-white/20 group-active:scale-95 transition-transform">
            {post.profiles.avatar_url ? (
              <img src={post.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/40 font-bold">
                {post.profiles.username[0].toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-white group-active:opacity-70 transition-opacity">
              {post.profiles.full_name || post.profiles.username}
            </p>
            <p className="text-[10px] text-white/50">{formatDate(post.created_at)}</p>
          </div>
        </div>
        
        <div className="relative" ref={menuRef}>
          <button 
            className="text-white/40 p-2 active:bg-white/5 rounded-full transition-colors"
            onClick={() => setShowMenu(!showMenu)}
          >
            <MoreHorizontal size={20} />
          </button>
          
          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                className="absolute right-0 top-10 w-40 bg-[#1c1c1c] rounded-xl border border-white/10 shadow-2xl z-20 overflow-hidden"
              >
                {isOwner ? (
                  <button 
                    onClick={() => {
                      setShowMenu(false);
                      onDelete?.(post.id);
                    }}
                    className="w-full flex items-center px-4 py-3 text-sm text-red-500 hover:bg-white/5 active:bg-white/10 transition-colors font-medium"
                  >
                    <Trash size={16} className="mr-2" />
                    Delete Post
                  </button>
                ) : (
                  <button 
                    onClick={() => setShowMenu(false)}
                    className="w-full flex items-center px-4 py-3 text-sm text-white/70 hover:bg-white/5 active:bg-white/10 transition-colors"
                  >
                    Report post
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Caption (Above Image) */}
      {post.caption && (
        <div className="px-4 pb-3">
          <p className="text-sm leading-relaxed text-white/90">
            {post.caption}
          </p>
        </div>
      )}

      {/* Image Content (Optional) */}
      {post.image_url && (
        <div className="relative w-full bg-white/5 overflow-hidden">
          <img 
            src={post.image_url} 
            alt="Post content" 
            className="w-full h-auto max-h-[80vh] object-contain"
            loading="lazy"
          />
        </div>
      )}

      {/* Interactions */}
      <div className="px-4 py-3 mt-1">
        <div className="flex items-center space-x-4 mb-2">
          <button 
            onClick={() => onLike?.(post.id, !!post.has_liked)}
            className={cn("transition-colors active:scale-90", post.has_liked ? "text-red-500" : "text-white")}
          >
            <Heart size={24} fill={post.has_liked ? "currentColor" : "none"} />
          </button>
          <button 
            onClick={() => setShowComments(true)}
            className="text-white active:scale-90 transition-transform flex items-center space-x-1"
          >
            <MessageCircle size={24} />
            {post.comments_count !== undefined && post.comments_count > 0 && (
              <span className="text-xs font-bold text-white/50">{post.comments_count}</span>
            )}
          </button>
          <button className="text-white active:scale-90 transition-transform">
            <Send size={24} />
          </button>
        </div>
        
        {post.likes_count !== undefined && post.likes_count > 0 && (
          <p className="text-sm font-bold mt-2">{post.likes_count.toLocaleString()} likes</p>
        )}
      </div>

      <AnimatePresence>
        {showComments && (
          <CommentsModal 
            postId={post.id} 
            currentUserId={currentUserId} 
            onClose={() => setShowComments(false)} 
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
