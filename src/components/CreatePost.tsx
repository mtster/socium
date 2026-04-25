import React, { useState } from 'react';
import { Camera, Image as ImageIcon, X, Send } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';

interface CreatePostProps {
  onSuccess: () => void;
  onCancel: () => void;
  userId: string;
}

export default function CreatePost({ onSuccess, onCancel, userId }: CreatePostProps) {
  const [caption, setCaption] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!image && !caption.trim()) return;

    try {
      setUploading(true);

      let imageUrl = null;
      
      // 1. Upload to Cloudinary (ONLY if image exists)
      if (image) {
        // @ts-ignore
        const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || (typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET : '');
        // @ts-ignore
        const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || (typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME : '');

        if (!uploadPreset || !cloudName) {
          alert('Cloudinary Error: Missing configuration.\nPlease add NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET to your Vercel Environment Variables.');
          setUploading(false);
          return;
        }

        const formData = new FormData();
        formData.append('file', image);
        formData.append('upload_preset', uploadPreset);
        
        try {
          const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: 'POST',
            body: formData,
          });

          if (!cloudRes.ok) {
            const errData = await cloudRes.json();
            throw new Error(errData.error?.message || 'Cloudinary upload failed');
          }
          const cloudData = await cloudRes.json();
          imageUrl = cloudData.secure_url;
        } catch (cloudinaryError: any) {
          throw new Error(`Cloudinary Error: ${cloudinaryError.message}`);
        }
      }

      // 2. Save to Supabase
      try {
        const { error: supabaseError } = await supabase.from('posts').insert({
          user_id: userId,
          image_url: imageUrl,
          caption: caption,
        });

        if (supabaseError) throw new Error(supabaseError.message);
      } catch (dbError: any) {
        throw new Error(`Supabase Error: ${dbError.message}`);
      }

      onSuccess();
    } catch (error: any) {
      console.error('Error creating post:', error);
      alert(`Upload Failed:\n${error.message}\n\nCheck browser console for more details.`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <motion.div 
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-0 bg-black z-[100] flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-16 border-b border-white/10">
        <button onClick={onCancel} className="text-white/60">
          <X size={24} />
        </button>
        <h2 className="text-sm font-bold uppercase tracking-widest">New Moment</h2>
        <button 
          onClick={handleSubmit} 
          disabled={uploading || (!image && !caption.trim())}
          className="text-white font-bold disabled:opacity-30 flex items-center space-x-1"
        >
          {uploading ? (
            <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <span className="text-xs mr-1">Share</span>
              <Send size={16} />
            </>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div 
          className="relative aspect-square rounded-3xl bg-white/5 border-2 border-dashed border-white/10 overflow-hidden mb-8 flex items-center justify-center"
          onClick={() => document.getElementById('imageInput')?.click()}
        >
          {preview ? (
            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
          ) : (
            <div className="text-center group">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3 group-active:scale-90 transition-transform">
                <Camera size={32} className="text-white/40" />
              </div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-white/30">Capture or Upload</p>
            </div>
          )}
          <input 
            type="file" 
            id="imageInput" 
            className="hidden" 
            onChange={handleImageChange} 
            accept="image/*" 
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest font-bold text-white/30 px-1">Describe the vibe</label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write a caption..."
            className="w-full bg-white/5 rounded-2xl p-4 text-sm focus:outline-none focus:ring-1 ring-white/20 min-h-[120px] transition-all"
          />
        </div>
      </div>
    </motion.div>
  );
}
