import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Image as ImageIcon, X, Send, Search } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { motion } from 'motion/react';
import { Post, Profile, PostVisibilityMode } from '@/src/types';
import MentionEditor from './MentionEditor';
import { extractMentionedUserIds } from '@/src/lib/utils';
import { optimizePostOrChatImage } from '@/src/lib/cropImage';
import PostVisibilityModal from './PostVisibilityModal';

interface EditPostModalProps {
  post: Post;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditPostModal({ post, onClose, onSuccess }: EditPostModalProps) {
  const [caption, setCaption] = useState(post.caption || '');
  const [existingImages, setExistingImages] = useState<string[]>(post.image_url ? post.image_url.split(',').filter(Boolean) : []);
  const [newImages, setNewImages] = useState<File[]>([]);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const initialMode: PostVisibilityMode = post.visibility_mode || (Array.isArray(post.visible_to) && post.visible_to.length > 0 ? 'allowed_list' : 'all_connections');
  const initialAudience: string[] = Array.isArray(post.audience) ? post.audience : (Array.isArray(post.visible_to) ? post.visible_to : []);
  
  const [visibilityMode, setVisibilityMode] = useState<PostVisibilityMode>(initialMode);
  const [audience, setAudience] = useState<string[]>(initialAudience);
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length > 0) {
      for (const file of files) {
        try {
          const optimized = await optimizePostOrChatImage(file, `edit_post_${Date.now()}.webp`);
          setNewImages(prev => [...prev, optimized]);
          const reader = new FileReader();
          reader.onloadend = () => {
            setNewPreviews(prev => [...prev, reader.result as string]);
          };
          reader.readAsDataURL(optimized);
        } catch (err) {
          console.error('Image optimization failed, falling back to original file:', err);
          setNewImages(prev => [...prev, file]);
          const reader = new FileReader();
          reader.onloadend = () => {
            setNewPreviews(prev => [...prev, reader.result as string]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const removeExistingImage = (index: number) => {
    setExistingImages(prev => prev.filter((_, i) => i !== index));
  };

  const removeNewImage = (index: number) => {
    setNewImages(prev => prev.filter((_, i) => i !== index));
    setNewPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!caption.trim() && existingImages.length === 0 && newImages.length === 0) {
      alert("Post must contain text or an image.");
      return;
    }

    try {
      setIsUploading(true);

      // Upload new images
      let uploadedUrls: string[] = [];
      if (newImages.length > 0) {
        // @ts-ignore
        const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || (typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET : '');
        // @ts-ignore
        const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || (typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME : '');

        if (!uploadPreset || !cloudName) {
           throw new Error('Cloudinary configuration missing');
        }

        // Guarantee all new images are converted to <= 1080p WebP
        const optimizedFiles = await Promise.all(
          newImages.map((img, idx) => 
            img.type === 'image/webp' ? Promise.resolve(img) : optimizePostOrChatImage(img, `edit_post_${Date.now()}_${idx}.webp`)
          )
        );

        uploadedUrls = await Promise.all(optimizedFiles.map(async (img) => {
          const formData = new FormData();
          formData.append('file', img);
          formData.append('upload_preset', uploadPreset);
          formData.append('folder', 'feed_posts');
          const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: 'POST',
            body: formData,
          });
          if (!cloudRes.ok) throw new Error('Cloudinary upload failed');
          const cloudData = await cloudRes.json();
          return cloudData.secure_url;
        }));
      }

      const finalImages = [...existingImages, ...uploadedUrls].join(',');

      const payload: any = {
        caption: caption.trim() || null,
        image_url: finalImages || '',
        visibility_mode: visibilityMode,
        audience: audience.length > 0 ? audience : null,
      };

      const { error: updateError } = await supabase.from('posts').update(payload).eq('id', post.id);

      if (updateError) {
        if (
          updateError.message.includes('column "visibility_mode"') ||
          updateError.message.includes('column "audience"') ||
          updateError.message.includes('column "visible_to"')
        ) {
          delete payload.visibility_mode;
          delete payload.audience;
          const { error: retryError } = await supabase.from('posts').update(payload).eq('id', post.id);
          if (retryError) throw new Error(retryError.message);
        } else {
          throw new Error(updateError.message);
        }
      }

      // Sync tagged users with feed_activity
      const taggedUserIds = extractMentionedUserIds(caption);
      await supabase
        .from('feed_activity')
        .update({ tagged_user_ids: taggedUserIds.length > 0 ? taggedUserIds : null })
        .eq('post_id', post.id)
        .eq('activity_type', 'post');

      onSuccess();
    } catch (e: any) {
      alert(`Upload Failed:\n${e.message}\n\nMake sure your SCHEMA.sql is updated.`);
    } finally {
      setIsUploading(false);
    }
  };

  return createPortal(
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed inset-0 z-50 bg-black flex flex-col w-full max-w-lg mx-auto border-x border-white/5"
    >
      <div className="flex items-center justify-between px-4 h-16 border-b border-white/10 shrink-0">
        <button onClick={onClose} className="text-white/60 active:scale-95 transition-transform p-2">
          <X size={24} />
        </button>
        <h2 className="text-sm font-bold uppercase tracking-widest text-white/70">Edit Post</h2>
        <button 
          onClick={handleSave}
          disabled={isUploading || (!caption.trim() && existingImages.length === 0 && newImages.length === 0)}
          className="text-white font-bold active:scale-95 disabled:opacity-50 transition-all p-2"
        >
          {isUploading ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-8 flex flex-col">
        <div className="space-y-2 mb-6">
          <label className="text-[10px] uppercase tracking-widest font-bold text-white/30 px-1">Update the vibe</label>
          <MentionEditor
            value={caption}
            onChange={setCaption}
            placeholder="Write a caption..."
            currentUserId={post.user_id}
            className="text-lg"
          />
        </div>

        <div className="flex space-x-4 overflow-x-auto pb-6 snap-x no-scrollbar">
          {/* Existing Images */}
          {existingImages.map((url, i) => (
            <div key={`existing-${i}`} className="relative aspect-[4/5] h-64 rounded-3xl bg-white/5 border border-white/10 overflow-hidden shrink-0 shadow-xl snap-center transition-all">
               <img src={url} alt="" className="w-full h-full object-cover" />
               <button 
                 className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 shadow-lg border border-white/20 flex items-center justify-center text-white backdrop-blur-md active:scale-95"
                 onClick={() => removeExistingImage(i)}
               >
                 <X size={16} />
               </button>
            </div>
          ))}
          
          {/* New Previews */}
          {newPreviews.map((previewStr, i) => (
            <div key={`new-${i}`} className="relative aspect-[4/5] h-64 rounded-3xl bg-white/5 border border-white/10 overflow-hidden shrink-0 shadow-xl snap-center transition-all">
               <img src={previewStr} alt="" className="w-full h-full object-cover" />
               <div className="absolute top-3 left-3 bg-white text-black text-[8px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest">New</div>
               <button 
                 className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 shadow-lg border border-white/20 flex items-center justify-center text-white backdrop-blur-md active:scale-95"
                 onClick={() => removeNewImage(i)}
               >
                 <X size={16} />
               </button>
            </div>
          ))}
          
          <div 
            className="relative aspect-[4/5] h-64 rounded-3xl bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center shrink-0 shadow-xl snap-center cursor-pointer active:scale-95 transition-transform"
            onClick={() => document.getElementById('edit-image-input')?.click()}
          >
            <div className="text-center group">
              <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-3 border border-white/10 shadow-lg">
                <Camera size={32} className="text-white/50" />
              </div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-white/40">Add more photos</p>
            </div>
          </div>
        </div>
        
        <input 
          type="file" 
          id="edit-image-input" 
          className="hidden" 
          onChange={handleFileChange} 
          accept="image/*" 
          multiple
        />

        <div className="mb-4 mt-auto pt-4">
           <label className="text-[10px] uppercase tracking-widest font-bold text-white/30 px-1 block mb-2">Visible to</label>
           <button 
             type="button"
             onClick={() => setShowVisibilityModal(true)}
             className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 flex justify-between items-center active:scale-95 transition-all text-sm font-medium"
           >
             <span className="text-white/80">
               {visibilityMode === 'all_connections' || audience.length === 0
                 ? 'All Connections'
                 : visibilityMode === 'allowed_list'
                 ? `${audience.length} Allowed`
                 : `${audience.length} Excluded`}
             </span>
             <span className="text-[10px] uppercase tracking-widest text-white/30 px-2 py-1 bg-white/5 rounded-full">Change</span>
           </button>
        </div>
      </div>

      <PostVisibilityModal
        isOpen={showVisibilityModal}
        onClose={() => setShowVisibilityModal(false)}
        userId={post.user_id}
        initialMode={visibilityMode}
        initialAudience={audience}
        onSave={(mode, aud) => {
          setVisibilityMode(mode);
          setAudience(aud);
        }}
      />

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept="image/*" 
        multiple
      />
    </motion.div>,
    document.body
  );
}
