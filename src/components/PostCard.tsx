import React, { useState, useEffect, useRef } from 'react';
import { Heart, MessageCircle, Send, MoreHorizontal, Trash, Edit2, X, ChevronRight, ChevronLeft } from 'lucide-react';
import { Post } from '@/src/types';
import { formatDate, cn } from '@/src/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import CommentsModal from './CommentsModal';
import EditPostModal from './EditPostModal';

interface PostCardProps {
  post: Post;
  currentUserId: string;
  onLike?: (id: string, isLiked: boolean) => void;
  onDelete?: (id: string) => void;
  onUserClick?: (userId: string) => void;
  onRefetch?: () => void;
}

export default function PostCard({ post, currentUserId, onLike, onDelete, onUserClick, onRefetch }: PostCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [viewingImages, setViewingImages] = useState<{ images: string[], startIndex: number } | null>(null);
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

  const getOptimizedUrl = (url: string) => {
    if (!url) return url;
    if (url.includes('cloudinary.com/') && url.includes('/upload/')) {
      // Optmize for extreme performance
      if (url.includes('/q_auto')) return url;
      return url.replace('/upload/', '/upload/q_auto:eco,f_auto,w_600,c_limit/');
    }
    return url;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-black pb-4 relative"
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
          <p className="text-sm leading-relaxed text-white/90">
            {post.caption}
          </p>
        </div>
      )}

      {/* Image Content (Optional) */}
      {post.image_url && (() => {
        const images = [...new Set(post.image_url.split(',').filter(Boolean))];
        if (images.length === 0) return null;
        
        if (images.length === 1) {
          return (
            <div className="relative w-full bg-white/5 overflow-hidden mb-2">
              <img 
                src={getOptimizedUrl(images[0])} 
                alt="Post content" 
                className="w-full h-auto max-h-[80vh] object-cover cursor-pointer hover:brightness-95 transition-all"
                onClick={() => setViewingImages({ images, startIndex: 0 })}
                loading="lazy"
              />
            </div>
          );
        }

        return (
          <div className={cn(
            "relative w-full bg-white/5 overflow-hidden grid gap-1 mb-2",
            images.length === 2 ? "grid-cols-2 h-[350px]" : "grid-cols-2 h-[450px]"
          )}>
            {images.slice(0, 4).map((img, index) => {
              // Show 2 or 4 images in grid
              const showCount = images.length === 2 ? 2 : 4;
              const isLastShown = index === showCount - 1;
              const hasMore = images.length > showCount;
              
              if (index >= showCount) return null;

              return (
                <div 
                  key={index} 
                  className={cn(
                    "relative w-full h-full cursor-pointer hover:brightness-90 transition-all",
                    images.length === 3 && index === 0 ? "row-span-2 h-full" : ""
                  )} 
                  onClick={() => setViewingImages({ images, startIndex: index })}
                >
                  <img 
                    src={getOptimizedUrl(img)} 
                    alt={`Post content ${index}`} 
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {isLastShown && hasMore && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
                      <span className="text-white text-3xl font-bold">+{images.length - showCount}</span>
                      <span className="text-white/60 text-[10px] font-bold tracking-widest uppercase mt-1">Photos</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Interactions */}
      <div className="px-4 py-3 mt-1">
        <div className="flex items-center space-x-2.5 mb-3">
          <button 
            onClick={() => onLike?.(post.id, !!post.has_liked)}
            className={cn("flex items-center justify-center space-x-2 px-4 py-2 rounded-full border active:scale-95 transition-all text-sm font-medium", post.has_liked ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-white/5 border-white/10 hover:bg-white/10 text-white/90")}
          >
            <Heart size={18} fill={post.has_liked ? "currentColor" : "none"} />
            <span>{post.likes_count || 0}</span>
          </button>
          
          <button 
            onClick={() => setShowComments(true)}
            className="flex items-center justify-center space-x-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-sm font-medium text-white/90"
          >
            <MessageCircle size={18} />
            <span>{post.comments_count || 0}</span>
          </button>
          
          <button className="flex items-center justify-center px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-white/90 ml-auto">
            <Send size={18} />
          </button>
        </div>
      </div>

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
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs bg-[#1c1c1c] border border-white/10 rounded-[32px] overflow-hidden shadow-2xl p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash size={32} className="text-red-500" />
              </div>
              <h3 className="text-white text-xl font-bold mb-2">Delete post?</h3>
              <p className="text-white/50 text-sm mb-8 leading-relaxed">
                This action cannot be undone. Permanent deletion removes this moment from your timeline.
              </p>
              <div className="space-y-3">
                <button 
                  onClick={() => {
                    onDelete?.(post.id);
                    setShowDeleteConfirm(false);
                  }}
                  className="w-full bg-red-500 text-white font-bold py-4 rounded-2xl active:scale-95 transition-transform"
                >
                  Delete
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="w-full bg-white/5 text-white/50 font-bold py-4 rounded-2xl active:scale-95 transition-transform"
                >
                  Cancel
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

function ImageDetailView({ images, initialIndex, onClose }: { images: string[], initialIndex: number, onClose: () => void }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [loading, setLoading] = useState(true);
  const [isZooming, setIsZooming] = useState(false);

  const next = () => {
    if (currentIndex < images.length - 1) {
      setLoading(true);
      setCurrentIndex(prev => prev + 1);
    }
  };

  const prev = () => {
    if (currentIndex > 0) {
      setLoading(true);
      setCurrentIndex(prev => prev - 1);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[500] bg-black flex flex-col items-center justify-center"
    >
      <button 
        className="absolute top-6 right-6 z-[600] p-3 bg-white/10 rounded-full text-white active:scale-90 transition-all backdrop-blur-md"
        onClick={onClose}
      >
        <X size={24} />
      </button>

      <div className="relative w-full h-full flex items-center justify-center touch-none">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="w-full h-full flex items-center justify-center overflow-hidden"
          >
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            )}
            
            <motion.img 
              drag={!isZooming}
              dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
              onDragEnd={(_, info) => {
                if (info.offset.x > 100) prev();
                if (info.offset.x < -100) next();
                if (info.offset.y > 200 || info.offset.y < -200) onClose();
              }}
              src={images[currentIndex].includes('cloudinary') ? images[currentIndex].replace('/upload/', '/upload/q_auto,f_auto/') : images[currentIndex]} 
              alt="" 
              className={cn(
                "max-w-full max-h-full object-contain transition-transform duration-300",
                isZooming ? "scale-150 cursor-zoom-out" : "cursor-zoom-in"
              )}
              onLoad={() => setLoading(false)}
              onClick={() => setIsZooming(!isZooming)}
            />
          </motion.div>
        </AnimatePresence>

        {!isZooming && (
          <>
            {currentIndex > 0 && (
              <button 
                className="absolute left-6 z-[550] p-4 bg-black/40 rounded-full text-white active:scale-95 transition-all"
                onClick={(e) => { e.stopPropagation(); prev(); }}
              >
                <ChevronLeft size={28} />
              </button>
            )}
            {currentIndex < images.length - 1 && (
              <button 
                className="absolute right-6 z-[550] p-4 bg-black/40 rounded-full text-white active:scale-95 transition-all"
                onClick={(e) => { e.stopPropagation(); next(); }}
              >
                <ChevronRight size={28} />
              </button>
            )}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center">
              <span className="text-white/40 text-[10px] font-bold tracking-[0.2em] uppercase mb-2">
                {currentIndex + 1} / {images.length}
              </span>
              <div className="flex space-x-1.5">
                {images.map((_, i) => (
                  <div key={i} className={cn("h-1 rounded-full transition-all duration-300", i === currentIndex ? "w-6 bg-white" : "w-1.5 bg-white/20")} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
