import React, { useState, useEffect, useRef } from 'react';
import { Heart, MessageCircle, Send, MoreHorizontal, Trash, Edit2, X, ChevronRight, ChevronLeft } from 'lucide-react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
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

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-black relative"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-0 pb-3">
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
      {images.length > 0 && (() => {
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

        if (images.length === 2) {
          return (
            <div className="relative w-full bg-white/5 overflow-hidden grid grid-cols-2 gap-1 mb-2 h-[350px]">
              {images.map((img, index) => (
                <div 
                  key={index} 
                  className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all"
                  onClick={() => setViewingImages({ images, startIndex: index })}
                >
                  <img src={getOptimizedUrl(img)} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          );
        }

        if (images.length === 3) {
          const isPortrait = firstImgAspect === 'portrait' || !firstImgAspect; // Default to portrait if not loaded
          return (
            <div className="relative w-full bg-white/5 overflow-hidden gap-1 mb-2 h-[450px] grid grid-cols-2 grid-rows-2">
              {isPortrait ? (
                <>
                  <div 
                    className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all row-span-2"
                    onClick={() => setViewingImages({ images, startIndex: 0 })}
                  >
                    <img src={getOptimizedUrl(images[0])} alt="" className="w-full h-full object-cover" />
                  </div>
                  {images.slice(1, 3).map((img, index) => (
                    <div 
                      key={index + 1} 
                      className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all"
                      onClick={() => setViewingImages({ images, startIndex: index + 1 })}
                    >
                      <img src={getOptimizedUrl(img)} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div 
                    className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all col-span-2"
                    onClick={() => setViewingImages({ images, startIndex: 0 })}
                  >
                    <img src={getOptimizedUrl(images[0])} alt="" className="w-full h-full object-cover" />
                  </div>
                  {images.slice(1, 3).map((img, index) => (
                    <div 
                      key={index + 1} 
                      className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all"
                      onClick={() => setViewingImages({ images, startIndex: index + 1 })}
                    >
                      <img src={getOptimizedUrl(img)} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        }

        // 4 or more photos
        return (
          <div className="relative w-full bg-white/5 overflow-hidden grid grid-cols-2 gap-1 mb-2 h-[350px]">
            {images.slice(0, 2).map((img, index) => {
              const isLastShown = index === 1;
              const moreCount = images.length - 2;
              return (
                <div 
                   key={index} 
                   className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all"
                   onClick={() => setViewingImages({ images, startIndex: index })}
                >
                  <img src={getOptimizedUrl(img)} alt="" className="w-full h-full object-cover" loading="lazy" />
                  {isLastShown && moreCount > 0 && (
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center backdrop-blur-[0.5px]">
                       <div className="w-12 h-12 rounded-full bg-[#1c1c1c]/90 border border-white/10 flex items-center justify-center shadow-2xl transition-transform active:scale-90">
                         <span className="text-white text-sm font-bold tabular-nums">+{moreCount}</span>
                       </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Interactions */}
      <div className="px-4 py-1">
        <div className="flex items-center space-x-2.5">
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

      <div className="w-full h-[0.5px] bg-white/20 my-10" />

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

function ImageDetailView({ images, initialIndex, onClose }: { images: string[], initialIndex: number, onClose: () => void }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState(0);
  const [scale, setScale] = useState(1);

  // Preload all images
  useEffect(() => {
    images.forEach(src => {
      const img = new Image();
      img.src = src.includes('cloudinary') ? src.replace('/upload/', '/upload/q_auto,f_auto/') : src;
    });
  }, [images]);

  const next = () => {
    if (currentIndex < images.length - 1) {
      setDirection(1);
      setLoading(true);
      setCurrentIndex(prev => prev + 1);
    }
  };

  const prev = () => {
    if (currentIndex > 0) {
      setDirection(-1);
      setLoading(true);
      setCurrentIndex(prev => prev - 1);
    }
  };

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? '100%' : '-100%',
      opacity: 0,
      scale: 0.95
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
      scale: 1,
      transition: {
        x: { type: "spring", stiffness: 400, damping: 40, mass: 1 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.3 }
      }
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? '100%' : '-100%',
      opacity: 0,
      scale: 0.95,
      transition: {
        x: { type: "spring", stiffness: 400, damping: 40, mass: 1 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.3 }
      }
    })
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[500] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center p-0"
    >
      <button 
        className="absolute top-6 right-6 z-[600] p-3 bg-white/10 rounded-full text-white active:scale-90 transition-all backdrop-blur-md border border-white/10 shadow-2xl"
        onClick={onClose}
      >
        <X size={24} />
      </button>

      <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            className="w-full h-full flex items-center justify-center"
          >
            <TransformWrapper
              initialScale={1}
              minScale={1}
              maxScale={4}
              centerOnInit={true}
              wheel={{ disabled: false }}
              doubleTap={{ step: 0.5 }}
              panning={{ disabled: scale === 1, velocityDisabled: false }}
              onTransformed={(ref) => setScale(ref.state.scale)}
            >
              <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
                <motion.div 
                  className="relative w-full h-full flex items-center justify-center touch-none"
                  drag={scale === 1 ? "both" : false}
                  dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                  dragElastic={0.4}
                  onDragEnd={(_, info) => {
                    if (scale > 1) return;
                    const xThreshold = 30; // Reduced threshold for better feel
                    const yThreshold = 80;
                    if (info.offset.x > xThreshold) prev();
                    else if (info.offset.x < -xThreshold) next();
                    else if (Math.abs(info.offset.y) > yThreshold) onClose();
                  }}
                >
                   {loading && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                  <img 
                    src={images[currentIndex].includes('cloudinary') ? images[currentIndex].replace('/upload/', '/upload/q_auto,f_auto/') : images[currentIndex]} 
                    alt="" 
                    className="max-w-full max-h-full object-contain pointer-events-auto"
                    onLoad={() => setLoading(false)}
                    draggable={false}
                  />
                </motion.div>
              </TransformComponent>
            </TransformWrapper>
          </motion.div>
        </AnimatePresence>

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center z-[550]">
          <span className="text-white/60 text-[11px] font-black tracking-[0.2em] uppercase mb-4 drop-shadow-md">
            {currentIndex + 1} / {images.length}
          </span>
          <div className="flex space-x-1.5 p-2 bg-white/5 backdrop-blur-xl rounded-full border border-white/10">
            {images.map((_, i) => (
              <div 
                key={i} 
                className={cn(
                  "h-1.5 rounded-full transition-all duration-500", 
                  i === currentIndex ? "w-6 bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" : "w-1.5 bg-white/20"
                )} 
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
