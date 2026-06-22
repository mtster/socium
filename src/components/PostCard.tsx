import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Heart, MessageCircle, Send, MoreHorizontal, Trash, Edit2, X, ChevronRight, ChevronLeft } from 'lucide-react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Post } from '@/src/types';
import { formatDate, cn } from '@/src/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import CommentsModal from './CommentsModal';
import EditPostModal from './EditPostModal';
import { PostGallery } from './feed/PostGallery';
import { ImageDetailView } from './feed/ImageDetailView';
import { useStore } from '../store/useStore';
import { supabase } from '@/src/lib/supabase';

function stripEmail(val: string | null | undefined): string {
  if (!val) return '';
  if (val.includes('@')) {
    const parts = val.split('@');
    if (parts[1] && parts[1].includes('.')) {
      return parts[0];
    }
  }
  return val;
}

interface PostCardProps {
  post: Post;
  currentUserId: string;
  onLike?: (id: string, isLiked: boolean) => void;
  onDelete?: (id: string) => void;
  onUserClick?: (userId: string) => void;
  onRefetch?: () => void;
}

function renderClickableText(text: string): React.ReactNode {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <a 
          key={i} 
          href={part} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-white/90 underline decoration-white/40 hover:text-white hover:decoration-white transition-all duration-150 break-all select-text"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export default function PostCard({ post, currentUserId, onLike, onDelete, onUserClick, onRefetch }: PostCardProps) {
  const { setSharePost } = useStore();
  const [showMenu, setShowMenu] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [viewingImages, setViewingImages] = useState<{ images: string[], startIndex: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [showLikers, setShowLikers] = useState(false);
  const [likers, setLikers] = useState<any[]>([]);
  const [loadingLikers, setLoadingLikers] = useState(false);
  
  const prefetchTimeoutRef = useRef<any>(null);
  const longPressTimeoutRef = useRef<any>(null);
  const isLongPressRef = useRef(false);
  const isPrefetchingRef = useRef(false);

  const startPrefetch = async () => {
    if (isPrefetchingRef.current) return;
    isPrefetchingRef.current = true;
    setLoadingLikers(true);
    try {
      const { data, error } = await supabase
        .from('likes')
        .select('user_id, profiles(id, full_name, username, avatar_url)')
        .eq('post_id', post.id);

      if (data) {
        const list = data
          .map((l: any) => l.profiles)
          .filter((u: any) => u && u.id !== '00000000-0000-0000-0000-000000000001');
        setLikers(list);
      }
    } catch (err) {
      console.error('Error fetching likers:', err);
    } finally {
      setLoadingLikers(false);
    }
  };

  const startPress = () => {
    isLongPressRef.current = false;
    isPrefetchingRef.current = false;

    // Start prefetching after 200ms to eliminate load latency
    prefetchTimeoutRef.current = setTimeout(() => {
      startPrefetch();
    }, 200);

    // Show likers list popup after 600ms total hold
    longPressTimeoutRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setShowLikers(true);
      startPrefetch(); // Guard in case it was not triggered/failed
    }, 600);
  };

  const endPress = (e: React.MouseEvent | React.TouchEvent) => {
    if (prefetchTimeoutRef.current) {
      clearTimeout(prefetchTimeoutRef.current);
      prefetchTimeoutRef.current = null;
    }
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const cancelPress = () => {
    if (prefetchTimeoutRef.current) {
      clearTimeout(prefetchTimeoutRef.current);
      prefetchTimeoutRef.current = null;
    }
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const handleLikeClick = (e: React.MouseEvent) => {
    if (isLongPressRef.current) {
      isLongPressRef.current = false;
      return;
    }
    onLike?.(post.id, !!post.has_liked);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isOwner = post.user_id === currentUserId || (post.user_id === '00000000-0000-0000-0000-000000000001' && currentUserId === '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2');
  const images = [...new Set(post.image_url?.split(',').filter(Boolean) || [])];
  const [firstImgAspect, setFirstImgAspect] = useState<'portrait' | 'landscape' | null>(null);

  useEffect(() => {
    if (images.length === 3 && images[0]) {
      const img = new Image();
      img.src = images[0];
      img.onload = () => {
        setFirstImgAspect(img.height > img.width ? 'portrait' : 'landscape');
      };
    }
  }, [post.image_url]);

  const getOptimizedUrl = (url: string) => {
    if (!url) return url;
    if (url.includes('cloudinary.com/') && url.includes('/upload/')) {
      // Optmize for extreme performance
      if (url.includes('/q_auto')) return url;
      return url.replace('/upload/', '/upload/q_auto:eco,f_auto,w_600,c_limit/');
    }
    return url;
  };

  useEffect(() => {
    if (viewingImages) {
      window.dispatchEvent(new CustomEvent('viewerState', { detail: { isOpen: true } }));
      return () => {
        window.dispatchEvent(new CustomEvent('viewerState', { detail: { isOpen: false } }));
      };
    }
  }, [viewingImages]);

  return (
    <motion.div 
      id={`post-card-${post.id}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-black relative"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-0 pb-3">
        <div 
          className={cn("flex items-center space-x-3 group", onUserClick ? "cursor-pointer" : "cursor-default")}
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
                  <>
                    <button 
                      onClick={() => {
                        setShowMenu(false);
                        setShowEdit(true);
                      }}
                      className="w-full flex items-center px-4 py-3 text-sm text-white/90 hover:bg-white/5 active:bg-white/10 transition-colors font-medium border-b border-white/5"
                    >
                      <Edit2 size={16} className="mr-2 text-white/50" />
                      Edit Post
                    </button>
                    <button 
                      onClick={() => {
                        setShowMenu(false);
                        setShowDeleteConfirm(true);
                      }}
                      className="w-full flex items-center px-4 py-3 text-sm text-red-500 hover:bg-white/5 active:bg-white/10 transition-colors font-medium"
                    >
                      <Trash size={16} className="mr-2" />
                      Delete Post
                    </button>
                  </>
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
          <p className="text-sm leading-relaxed text-white/90 whitespace-pre-line">
            {renderClickableText(post.caption)}
          </p>
        </div>
      )}

      {/* Image Content (Optional) */}
      <PostGallery 
        images={images} 
        firstImgAspect={firstImgAspect} 
        setViewingImages={setViewingImages} 
        getOptimizedUrl={getOptimizedUrl} 
      />

      {/* Interactions */}
      <div className="px-4 py-1">
        <div className="flex items-center space-x-2.5">
          <div className="relative">
            <button 
              onMouseDown={startPress}
              onMouseUp={endPress}
              onMouseLeave={cancelPress}
              onTouchStart={startPress}
              onTouchEnd={endPress}
              onContextMenu={(e) => {
                if (isLongPressRef.current) {
                  e.preventDefault();
                }
              }}
              onClick={handleLikeClick}
              className={cn("flex items-center justify-center space-x-2 px-4 py-2 rounded-full border active:scale-95 transition-all text-sm font-medium select-none touch-none", post.has_liked ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-white/5 border-white/10 hover:bg-white/10 text-white/90")}
            >
              <Heart size={18} fill={post.has_liked ? "currentColor" : "none"} />
              <span>{post.likes_count || 0}</span>
            </button>

            {showLikers && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowLikers(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute left-0 bottom-full mb-2.5 z-50 w-52 bg-[#1A1A1A] border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-md text-left"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider mb-2.5">Liked by</p>
                  {loadingLikers ? (
                    <div className="flex items-center space-x-2 py-1">
                      <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      <span className="text-xs text-white/50">Fetching...</span>
                    </div>
                  ) : likers.length === 0 ? (
                    <p className="text-xs text-white/45 py-1">No likes yet</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                      {likers.map((u: any) => (
                        <div 
                          key={u.id} 
                          onClick={() => {
                            setShowLikers(false);
                            if (onUserClick) onUserClick(u.id);
                          }}
                          className="flex items-center space-x-2.5 py-1.5 px-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                        >
                          <div className="w-6 h-6 rounded-full overflow-hidden bg-white/10 shrink-0 border border-white/10">
                            {u.avatar_url ? (
                              <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-white/60 uppercase">
                                {u.username?.[0] || '?'}
                              </div>
                            )}
                          </div>
                          <div className="truncate flex-1">
                            <p className="text-[11px] font-bold text-white truncate">{stripEmail(u.full_name || u.username) || 'Anonymous'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </div>
          
          <button 
            onClick={() => setShowComments(true)}
            className="flex items-center justify-center space-x-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-sm font-medium text-white/90"
          >
            <MessageCircle size={18} />
            <span>{post.comments_count || 0}</span>
          </button>
          
          <button 
            onClick={() => setSharePost(post)}
            className="flex items-center justify-center px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-white/90 ml-auto"
          >
            <Send size={18} />
          </button>
        </div>
      </div>

      <div className="w-full h-px bg-white/[0.08] my-8" />

      <AnimatePresence>
        {showComments && (
          <CommentsModal 
            post={post} 
            currentUserId={currentUserId} 
            onClose={() => setShowComments(false)} 
            onCommentAdded={onRefetch}
            onUserClick={onUserClick}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showEdit && (
          <EditPostModal
            post={post}
            onClose={() => setShowEdit(false)}
            onSuccess={() => {
              setShowEdit(false);
              onRefetch?.();
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs bg-[#1A1A1A] border border-white/10 rounded-[28px] overflow-hidden shadow-2xl p-8 text-center"
            >
              <h3 className="text-white text-base font-bold mb-2 tracking-tight">Are you sure you want to remove this moment?</h3>
              <p className="text-white/40 text-[13px] mb-8 leading-relaxed font-medium">
                This action can't be undone.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 bg-white/5 text-white/70 font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all hover:bg-white/10 text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    onDelete?.(post.id);
                    setShowDeleteConfirm(false);
                  }}
                  className="flex-1 bg-red-500 text-white font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all hover:brightness-110 text-sm shadow-[0_4px_12px_rgba(239,68,68,0.25)]"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewingImages && (
          <ImageDetailView 
            images={viewingImages.images}
            initialIndex={viewingImages.startIndex}
            onClose={() => setViewingImages(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
