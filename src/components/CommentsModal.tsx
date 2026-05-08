import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, User } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { motion } from 'motion/react';
import { formatDate, cn } from '@/src/lib/utils';
import { Profile, Post } from '@/src/types';

interface CommentsModalProps {
  post: Post;
  currentUserId: string;
  onClose: () => void;
  onCommentAdded?: () => void;
  onUserClick?: (userId: string) => void;
}

export default function CommentsModal({ post, currentUserId, onClose, onCommentAdded, onUserClick }: CommentsModalProps) {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input on mount to bring up keyboard automatically
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    fetchComments();
  }, [post.id]);

  const fetchComments = async () => {
    try {
      const { data, error } = await supabase
        .from('comments')
        .select('*, profiles(*)')
        .eq('post_id', post.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    try {
      setPosting(true);
      const { data, error } = await supabase
        .from('comments')
        .insert({
          post_id: post.id,
          user_id: currentUserId,
          content: text.trim()
        })
        .select('*, profiles(*)')
        .single();

      if (error) throw error;
      
      setComments([...comments, data]);
      setText('');
      if (onCommentAdded) onCommentAdded();
      
      // Auto close according to UX instruction
      setTimeout(onClose, 800);
    } catch (err: any) {
      alert(`Failed to add comment: ${err.message}`);
    } finally {
      setPosting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      const { error } = await supabase.from('comments').delete().eq('id', commentId);
      if (error) throw error;
      setComments(comments.filter(c => c.id !== commentId));
    } catch (err: any) {
      alert(`Failed to delete comment: ${err.message}`);
    }
  };

  return createPortal(
    <motion.div 
      initial={{ opacity: 0, y: '100%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '100%' }}
      transition={{ type: 'tween', duration: 0.3 }}
      className="fixed inset-0 z-[500] bg-black flex flex-col"
    >
      <div className="flex items-center justify-between px-4 h-16 pt-[env(safe-area-inset-top)] border-b border-white/10 shrink-0">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white/50">Viewing Post</h2>
        <button onClick={onClose} className="text-white/60 p-2 active:bg-white/10 rounded-full transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Post Context */}
        <div className="border-b border-white/5 pb-4 mb-4">
          <div className="p-4 flex items-start space-x-3">
             <div 
               className="w-10 h-10 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0 cursor-pointer"
               onClick={() => {
                 onUserClick?.(post.user_id);
                 onClose();
               }}
             >
                {post.profiles?.avatar_url ? (
                  <img src={post.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User size={20} className="text-white/40 m-2" />
                )}
             </div>
             <div className="flex-1">
                <p 
                  className="font-bold text-sm text-white/90 cursor-pointer inline-block"
                  onClick={() => {
                    onUserClick?.(post.user_id);
                    onClose();
                  }}
                >
                  {post.profiles?.full_name || post.profiles?.username}
                </p>
                {post.caption && <p className="text-sm text-white/80 mt-1 leading-relaxed">{post.caption}</p>}
                {post.image_url && (() => {
                  const images = post.image_url.split(',').filter(Boolean);
                  if (images.length === 0) return null;
                  return (
                    <div className={cn(
                      "mt-3 rounded-2xl overflow-hidden bg-white/5 border border-white/10 w-full max-w-xs",
                      images.length > 1 ? "grid grid-cols-2 gap-0.5" : ""
                    )}>
                       {images.slice(0, 4).map((img, i) => (
                         <img key={i} src={img} alt="" className={cn("w-full h-auto object-cover", images.length > 1 ? "aspect-square" : "max-h-48")} />
                       ))}
                    </div>
                  );
                })()}
             </div>
          </div>

          <form onSubmit={handlePostComment} className="flex items-center ml-14 mr-4 mt-2 mb-2 relative">
            <input
              ref={inputRef}
              autoFocus
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Type a comment..."
              className="flex-1 bg-transparent border-0 h-10 pl-0 pr-12 text-sm focus:outline-none transition-all font-medium placeholder:text-white/30"
            />
            <button 
              type="submit" 
              disabled={posting || !text.trim()}
              className="absolute right-0 flex items-center justify-center text-white font-bold disabled:opacity-30 active:scale-95 transition-transform text-sm"
            >
              Post
            </button>
          </form>
        </div>

        {/* Comments Section */}
        <div className="px-4 pb-4 space-y-6">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          comments.map(comment => (
            <div key={comment.id} className="flex space-x-3 ml-6 mb-4 relative">
              <div 
                className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0 z-10 cursor-pointer"
                onClick={() => {
                  onUserClick?.(comment.user_id);
                  onClose();
                }}
              >
                {comment.profiles?.avatar_url ? (
                  <img src={comment.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User size={16} className="text-white/40 m-2" />
                )}
              </div>
              <div className="flex-1">
                <div className="bg-transparent border-0 rounded-none p-0">
                  <p 
                    className="text-[12px] font-bold mb-1 text-white/60 cursor-pointer inline-block"
                    onClick={() => {
                      onUserClick?.(comment.user_id);
                      onClose();
                    }}
                  >
                    {comment.profiles?.full_name || comment.profiles?.username}
                  </p>
                  <p className="text-sm text-white/90 leading-relaxed">{comment.content}</p>
                </div>
                <div className="flex items-center mt-2 space-x-4">
                  <span className="text-[10px] text-white/40">{formatDate(comment.created_at)}</span>
                  {comment.user_id === currentUserId && (
                    <button 
                      onClick={() => handleDeleteComment(comment.id)}
                      className="text-[10px] text-red-500/80 font-bold"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        </div>
      </div>
    </motion.div>,
    document.body
  );
}
