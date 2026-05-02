import React, { useState, useRef, useEffect } from 'react';
import { X, Image as ImageIcon, Search } from 'lucide-react';
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(post.image_url || null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [visibleTo, setVisibleTo] = useState<string[]>(post.visible_to || []);
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
        // @ts-ignore
        const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || (typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET : '');
        // @ts-ignore
        const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || (typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME : '');

        if (!uploadPreset || !cloudName) {
           alert('Cloudinary Error: Missing configuration.\nPlease add NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET to your Vercel Environment Variables.');
           setIsUploading(false);
           return;
        }

        const formData = new FormData();
        formData.append('file', imageFile);
        formData.append('upload_preset', uploadPreset);
        
        const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!cloudRes.ok) {
          const errData = await cloudRes.json();
          throw new Error(errData.error?.message || 'Cloudinary upload failed');
        }
        const cloudData = await cloudRes.json();
        finalImageUrl = cloudData.secure_url;
      } else if (!imageUrl && post.image_url) {
        // User removed the image
        finalImageUrl = null;
      }

      const { error: updateError } = await supabase.from('posts').update({
        caption: caption.trim() || null,
        image_url: finalImageUrl || '',
        visible_to: visibleTo.length > 0 ? visibleTo : null
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

        <div className="mb-4">
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
               <h2 className="text-sm font-bold tracking-widest uppercase">Visible To</h2>
               <button onClick={() => setShowVisibilityModal(false)} className="text-white text-sm font-bold">Done</button>
             </div>
             <div className="p-4">
                <div className="relative mb-6">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
                  <input 
                    type="text" 
                    placeholder="Search connections..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors"
                  />
                </div>
                
                <div className="mb-4 flex items-center justify-between px-2">
                  <span className="text-sm font-medium text-white/90">All Connections</span>
                  <div 
                    className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors ${visibleTo.length === 0 ? 'bg-white' : 'bg-white/20'}`}
                    onClick={() => setVisibleTo([])}
                  >
                    <div className={`w-4 h-4 rounded-full bg-black transition-transform ${visibleTo.length === 0 ? 'translate-x-6' : 'translate-x-0'}`} />
                  </div>
                </div>

                <div className="space-y-1 h-[60vh] overflow-y-auto">
                   {connections.filter(c => c.username.toLowerCase().includes(searchQuery.toLowerCase()) || (c.full_name && c.full_name.toLowerCase().includes(searchQuery.toLowerCase()))).map(connection => {
                     const isSelected = visibleTo.length > 0 && visibleTo.includes(connection.id);
                     return (
                       <div 
                         key={connection.id}
                         onClick={() => {
                           if (visibleTo.includes(connection.id)) {
                             setVisibleTo(prev => prev.filter(id => id !== connection.id));
                           } else {
                             setVisibleTo(prev => [...prev, connection.id]);
                           }
                         }}
                         className="flex items-center space-x-3 p-3 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
                       >
                         <div className="w-10 h-10 rounded-full bg-white/10 overflow-hidden shrink-0">
                           {connection.avatar_url ? (
                             <img src={connection.avatar_url} alt="" className="w-full h-full object-cover" />
                           ) : (
                             <div className="w-full h-full flex items-center justify-center text-white/40 font-bold">
                               {connection.username[0].toUpperCase()}
                             </div>
                           )}
                         </div>
                         <div className="flex-1 min-w-0">
                           <p className="font-bold text-white text-sm truncate">{connection.full_name || connection.username}</p>
                           <p className="text-xs text-white/50 truncate">@{connection.username}</p>
                         </div>
                         <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${isSelected ? 'bg-white border-white' : 'border-white/20'}`}>
                            {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-black" />}
                         </div>
                       </div>
                     );
                   })}
                </div>
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
    </motion.div>
  );
}
