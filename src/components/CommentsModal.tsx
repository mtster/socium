import React, { useState, useEffect } from 'react';
import { X, Send, User } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { motion } from 'motion/react';
import { formatDate } from '@/src/lib/utils';
import { Profile } from '@/src/types';

interface CommentsModalProps {
  postId: string;
  currentUserId: string;
  onClose: () => void;
  onCommentAdded?: () => void;
}

export default function CommentsModal({ postId, currentUserId, onClose, onCommentAdded }: CommentsModalProps) {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetchComments();
  }, [postId]);

  const fetchComments = async () => {
    try {
      const { data, error } = await supabase
        .from('comments')
        .select('*, profiles(*)')
        .eq('post_id', postId)
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
          post_id: postId,
          user_id: currentUserId,
          content: text.trim()
        })
        .select('*, profiles(*)')
        .single();

      if (error) throw error;
      
      setComments([...comments, data]);
      setText('');
      if (onCommentAdded) onCommentAdded();
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

  return (
    <motion.div 
      initial={{ opacity: 0, y: '100%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
    >
      <div className="flex items-center justify-between px-4 h-16 border-b border-white/10 shrink-0">
        <h2 className="text-sm font-bold uppercase tracking-widest">Comments</h2>
        <button onClick={onClose} className="text-white/60 p-2 active:bg-white/10 rounded-full transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center text-white/40 text-sm py-10 uppercase tracking-widest font-medium text-[10px]">
             No comments yet. Start the conversation.
          </div>
        ) : (
          comments.map(comment => (
            <div key={comment.id} className="flex space-x-3">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0">
                {comment.profiles?.avatar_url ? (
                  <img src={comment.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User size={16} className="text-white/40 m-2" />
                )}
              </div>
              <div className="flex-1">
                <div className="bg-white/5 rounded-2xl rounded-tl-none p-3 border border-white/5">
                  <p className="text-xs font-bold mb-1 text-white/80">{comment.profiles?.full_name || comment.profiles?.username}</p>
                  <p className="text-sm text-white/90 leading-relaxed">{comment.content}</p>
                </div>
                <div className="flex items-center mt-1 px-1 space-x-4">
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

      <div className="p-4 bg-black border-t border-white/10 pb-safe">
        <form onSubmit={handlePostComment} className="flex items-center space-x-3 relative">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a comment..."
            className="flex-1 bg-white/5 border border-white/10 rounded-full h-12 pl-5 pr-12 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-all font-medium"
          />
          <button 
            type="submit" 
            disabled={posting || !text.trim()}
            className="absolute right-2 w-8 h-8 flex items-center justify-center bg-white text-black rounded-full disabled:opacity-30 active:scale-90 transition-transform"
          >
            <Send size={14} className="ml-[-1px] mt-[1px]" />
          </button>
        </form>
      </div>
    </motion.div>
  );
}
