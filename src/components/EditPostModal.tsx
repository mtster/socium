import React, { useState, useRef } from 'react';
import { X, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { Post } from '@/src/types';

interface EditPostModalProps {
  post: Post;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditPostModal({ post, onClose, onSuccess }: EditPostModalProps) {
  const [caption, setCaption] = useState(post.caption || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(post.image_url || null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      const url = URL.createObjectURL(file);
      setImageUrl(url);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImageUrl(null);
  };

  const handleSave = async () => {
    if (!caption.trim() && !imageUrl) {
      alert("Post must contain text or an image.");
      return;
    }

    try {
      setIsUploading(true);
      let finalImageUrl = post.image_url;

      // Handle new image upload
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop() || 'jpg';
        const fileName = `${post.user_id}-${Math.random()}.${fileExt}`;
        const filePath = `${post.user_id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars') // Resusing avatars storage bucket as public bucket
          .upload(filePath, imageFile);

        if (uploadError) throw new Error(uploadError.message);

        const { data: publicUrlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);

        finalImageUrl = publicUrlData.publicUrl;
      } else if (!imageUrl && post.image_url) {
        // User removed the image
        finalImageUrl = null;
      }

      const { error: updateError } = await supabase.from('posts').update({
        caption: caption.trim() || null,
        image_url: finalImageUrl || '',
      }).eq('id', post.id);

      if (updateError) throw new Error(updateError.message);

      onSuccess();
    } catch (e: any) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
    >
      <div className="flex items-center justify-between px-4 h-16 border-b border-white/10 shrink-0">
        <button onClick={onClose} className="text-white/60 active:scale-95 transition-transform p-2">
          <X size={24} />
        </button>
        <h2 className="text-sm font-bold uppercase tracking-widest text-white/70">Edit Post</h2>
        <button 
          onClick={handleSave}
          disabled={isUploading || (!caption.trim() && !imageUrl)}
          className="text-white font-bold active:scale-95 disabled:opacity-50 transition-all p-2"
        >
          {isUploading ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <textarea
          className="w-full bg-transparent text-sm leading-relaxed outline-none resize-none placeholder:text-white/20 text-white/90 mb-6 min-h-[150px]"
          placeholder="What's going on?"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />

        {imageUrl ? (
          <div className="relative rounded-2xl overflow-hidden border border-white/10 mb-6 bg-white/5 inline-block max-w-full">
            <img src={imageUrl} alt="Upload preview" className="w-full max-h-[400px] object-contain" />
            <button
              onClick={handleRemoveImage}
              className="absolute top-2 right-2 w-8 h-8 bg-black/50 backdrop-blur border border-white/10 rounded-full flex items-center justify-center text-white active:scale-90 transition-transform"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="w-full flex justify-center mb-6">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full aspect-square max-h-[80vh] flex flex-col items-center justify-center space-y-3 bg-white/[0.02] hover:bg-white/[0.05] border border-dashed border-white/10 rounded-2xl active:scale-95 transition-all text-sm font-bold text-white/40"
            >
              <ImageIcon size={32} />
              <span className="uppercase tracking-widest text-[10px]">Add Image</span>
            </button>
          </div>
        )}
      </div>

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept="image/*" 
      />
    </motion.div>
  );
}
