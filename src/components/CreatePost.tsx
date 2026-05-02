import React, { useState, useEffect } from 'react';
import { Camera, Image as ImageIcon, X, Send } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { Profile } from '@/src/types';

interface CreatePostProps {
  onSuccess: () => void;
  onCancel: () => void;
  userId: string;
}

export default function CreatePost({ onSuccess, onCancel, userId }: CreatePostProps) {
  const [caption, setCaption] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  
  const [visibleTo, setVisibleTo] = useState<string[]>([]);
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [connections, setConnections] = useState<Profile[]>([]);

  useEffect(() => {
    fetchConnections();
  }, [userId]);

  const fetchConnections = async () => {
    const { data: rel1 } = await supabase.from('connections').select('*, profiles!connections_receiver_id_fkey(*)').eq('requester_id', userId).eq('status', 'accepted');
    const { data: rel2 } = await supabase.from('connections').select('*, profiles!connections_requester_id_fkey(*)').eq('receiver_id', userId).eq('status', 'accepted');
    
    // @ts-ignore
    const combined = [...(rel1?.map(c => c.profiles) || []), ...(rel2?.map(c => c.profiles) || [])].filter(Boolean);
    setConnections(combined);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length > 0) {
      setImages(prev => [...prev, ...files]);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreviews(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (images.length === 0 && !caption.trim()) return;

    try {
      setUploading(true);

      let imageUrls: string[] = [];
      
      // 1. Upload to Cloudinary (ONLY if images exist)
      if (images.length > 0) {
        // @ts-ignore
        const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || (typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET : '');
        // @ts-ignore
        const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || (typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME : '');

        if (!uploadPreset || !cloudName) {
           alert('Cloudinary Error: Missing configuration.\nPlease add NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET to your Vercel Environment Variables.');
           setUploading(false);
           return;
        }

        imageUrls = await Promise.all(images.map(async (img) => {
          const formData = new FormData();
          formData.append('file', img);
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
            return cloudData.secure_url;
          } catch (cloudinaryError: any) {
            throw new Error(`Cloudinary Error: ${cloudinaryError.message}`);
          }
        }));
      }

      // 2. Save to Supabase
      try {
        const payload: any = {
          user_id: userId,
          image_url: imageUrls.join(',') || '',
          caption: caption.trim() || null,
        };

        if (visibleTo.length > 0) {
           payload.visible_to = visibleTo;
        }

        const { error: supabaseError } = await supabase.from('posts').insert(payload);

        if (supabaseError) {
          if (supabaseError.message.includes('column "visible_to"')) {
            delete payload.visible_to;
            const { error: retryError } = await supabase.from('posts').insert(payload);
            if (retryError) throw new Error(retryError.message);
          } else {
            throw new Error(supabaseError.message);
          }
        }
      } catch (dbError: any) {
        throw new Error(`Supabase Error: ${dbError.message}\nMake sure to run the updated SCHEMA.sql`);
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
          disabled={uploading || (images.length === 0 && !caption.trim())}
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
      <div className="flex-1 overflow-y-auto px-4 py-8 flex flex-col">
        <div className="space-y-2 mb-6">
          <label className="text-[10px] uppercase tracking-widest font-bold text-white/30 px-1">Describe the vibe</label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write a caption..."
            className="w-full bg-transparent p-2 text-lg text-white focus:outline-none min-h-[80px] resize-none placeholder:text-white/20"
          />
        </div>

        <div className="flex space-x-4 overflow-x-auto pb-4 snap-x">
          {previews.map((previewStr, i) => (
            <div key={i} className="relative aspect-[4/5] h-64 rounded-3xl bg-white/5 border border-white/10 overflow-hidden shrink-0 shadow-xl snap-center shrink-0">
               <img src={previewStr} alt={`Preview ${i}`} className="w-full h-full object-cover" />
               <button 
                 className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 shadow-lg border border-white/20 flex items-center justify-center text-white backdrop-blur-md active:scale-95"
                 onClick={(e) => { e.stopPropagation(); removeImage(i); }}
               >
                 <X size={16} />
               </button>
            </div>
          ))}
          <div 
            className="relative aspect-[4/5] h-64 rounded-3xl bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center shrink-0 shadow-xl snap-center cursor-pointer active:scale-95 transition-transform"
            onClick={() => document.getElementById('imageInput')?.click()}
          >
            <div className="text-center group">
              <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-3 border border-white/10 shadow-lg">
                <Camera size={32} className="text-white/50" />
              </div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-white/40">{previews.length > 0 ? 'Add more' : 'Capture / Upload'}</p>
            </div>
          </div>
        </div>
          <input 
            type="file" 
            id="imageInput" 
            className="hidden" 
            onChange={handleImageChange} 
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
    </motion.div>
  );
}
