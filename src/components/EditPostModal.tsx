import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Image as ImageIcon, X, Send, Search } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { Post, Profile } from '@/src/types';

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
  const [visibleTo, setVisibleTo] = useState<string[]>(Array.isArray(post.visible_to) ? post.visible_to : []);
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [connections, setConnections] = useState<Profile[]>([]);

  useEffect(() => {
    fetchConnections();
  }, [post.user_id]);

  const fetchConnections = async () => {
    const { data: rel1 } = await supabase.from('connections').select('*, profiles!connections_receiver_id_fkey(*)').eq('requester_id', post.user_id).eq('status', 'accepted');
    const { data: rel2 } = await supabase.from('connections').select('*, profiles!connections_requester_id_fkey(*)').eq('receiver_id', post.user_id).eq('status', 'accepted');
    
    // @ts-ignore
    const combined = [...(rel1?.map(c => c.profiles) || []), ...(rel2?.map(c => c.profiles) || [])].filter(Boolean);
    setConnections(combined);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length > 0) {
      setNewImages(prev => [...prev, ...files]);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setNewPreviews(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });
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

        uploadedUrls = await Promise.all(newImages.map(async (img) => {
          const formData = new FormData();
          formData.append('file', img);
          formData.append('upload_preset', uploadPreset);
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
        visible_to: visibleTo.length > 0 ? visibleTo : null
      };

      const { error: updateError } = await supabase.from('posts').update(payload).eq('id', post.id);

      if (updateError) {
        if (updateError.message.includes('column "visible_to"')) {
           delete payload.visible_to;
           const { error: retryError } = await supabase.from('posts').update(payload).eq('id', post.id);
           if (retryError) throw new Error(retryError.message);
        } else {
           throw new Error(updateError.message);
        }
      }

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
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write a caption..."
            className="w-full bg-transparent p-2 text-lg text-white focus:outline-none min-h-[80px] resize-none placeholder:text-white/20"
          />
        </div>

        <div className="flex space-x-4 overflow-x-auto pb-6 snap-x no-scrollbar">
          {/* Existing Images */}
          {existingImages.map((url, i) => (
            <div key={`existing-${i}`} className="relative aspect-[4/5] h-64 rounded-3xl bg-white/5 border border-white/10 overflow-hidden shrink-0 shadow-xl snap-center transition-all">
               <img src={url.includes('cloudinary') ? url.replace('/upload/', '/upload/q_auto,f_auto,w_500/') : url} alt="" className="w-full h-full object-cover" />
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
             onClick={() => setShowVisibilityModal(true)}
             className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 flex justify-between items-center active:scale-95 transition-all text-sm font-medium"
           >
             <span className="text-white/80">{visibleTo.length === 0 ? 'All Connections' : `${visibleTo.length} Selected`}</span>
             <span className="text-[10px] uppercase tracking-widest text-white/30 px-2 py-1 bg-white/5 rounded-full">Change</span>
           </button>
        </div>
      </div>

      <AnimatePresence>
        {showVisibilityModal && (
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-0 bg-black z-[110] flex flex-col"
          >
             <div className="flex items-center justify-between px-4 h-16 border-b border-white/10">
               <button onClick={() => setShowVisibilityModal(false)} className="text-white/60">
                 <X size={24} />
               </button>
               <h2 className="text-sm font-bold uppercase tracking-widest">Select Audience</h2>
               <button onClick={() => setShowVisibilityModal(false)} className="text-white font-bold text-sm">
                 Done
               </button>
             </div>
             
             <div className="p-4 border-b border-white/10">
               <input 
                 type="text" 
                 placeholder="Search connections..." 
                 value={searchQuery}
                 onChange={e => setSearchQuery(e.target.value)}
                 className="w-full bg-white/10 border border-white/10 text-white placeholder:text-white/40 rounded-xl px-4 py-3 focus:outline-none focus:border-white/30 text-sm transition-all"
               />
             </div>
             
             <div className="flex-1 overflow-y-auto p-4 space-y-2">
                <button 
                  onClick={() => setVisibleTo([])}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 active:bg-white/10 transition-colors"
                >
                  <span className="font-bold text-white text-sm">All Connections</span>
                  {visibleTo.length === 0 && <div className="w-3 h-3 rounded-full bg-white" />}
                </button>
                {connections.filter(c => (c.full_name || c.username)?.toLowerCase().includes(searchQuery.toLowerCase())).map(c => (
                  <button 
                    key={c.id} 
                    onClick={() => {
                      if (visibleTo.includes(c.id)) {
                        setVisibleTo(visibleTo.filter(id => id !== c.id));
                      } else {
                        setVisibleTo([...visibleTo, c.id]);
                      }
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 active:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0">
                        {c.avatar_url ? (
                          <img src={c.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                           <div className="w-full h-full flex items-center justify-center text-[10px] text-white/50">{c.username?.charAt(0).toUpperCase()}</div>
                        )}
                      </div>
                      <span className="font-bold text-white/80 text-sm">{c.full_name || c.username}</span>
                    </div>
                    {visibleTo.includes(c.id) && <div className="w-3 h-3 rounded-full bg-white" />}
                  </button>
                ))}
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept="image/*" 
      />
    </motion.div>,
    document.body
  );
}
