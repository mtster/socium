import React, { useState, useRef, useEffect } from 'react';
import { Settings, Plus, Camera, Eye, User as UserIcon } from 'lucide-react';
import { Profile, Post } from '@/src/types';
import PostCard from './PostCard';
import { supabase } from '@/src/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { formatDate } from '@/src/lib/utils';

interface ProfileViewProps {
  profile: Profile;
  posts: Post[];
  isOwnProfile?: boolean;
}

export default function ProfileView({ profile, posts, isOwnProfile }: ProfileViewProps) {
  const [showPfpMenu, setShowPfpMenu] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  // Close menu if clicked outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showPfpMenu) setShowPfpMenu(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showPfpMenu]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      // @ts-ignore
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || (typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET : '');
      // @ts-ignore
      const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || (typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME : '');

      if (!uploadPreset || !cloudName) {
        alert('Cloudinary not configured. Please check Vercel environment variables.');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', uploadPreset);
      
      const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!cloudRes.ok) throw new Error('Cloudinary upload failed');
      const cloudData = await cloudRes.json();
      const imageUrl = cloudData.secure_url;

      // Update Supabase profile
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: imageUrl })
        .eq('id', profile.id);

      if (error) throw error;
      
      // Update local state (optimistic)
      profile.avatar_url = imageUrl;
    } catch (error) {
      console.error('Error updating PFP:', error);
      alert('Failed to update profile picture.');
    } finally {
      setIsUploading(false);
    }
  };

  // Dummy connections for now to fulfill the design
  const connections = [
    { id: 1, name: 'Alice', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alice' },
    { id: 2, name: 'Bob', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Bob' },
    { id: 3, name: 'Charlie', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Charlie' },
    { id: 4, name: 'David', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=David' },
  ];

  return (
    <div className="pb-20 relative">
      {/* Full Screen Image Viewer */}
      <AnimatePresence>
        {viewingImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black flex items-center justify-center p-4"
            onClick={() => setViewingImage(null)}
          >
            <img src={viewingImage} alt="Profile" className="max-w-full max-h-full object-contain rounded-xl" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-4 py-8 flex flex-col items-center">
        {/* Full Name above picture */}
        <h1 className="text-3xl font-bold tracking-tight mb-6 text-center">{profile.full_name || profile.username}</h1>

        {/* Profile Picture Section */}
        <div className="relative mb-8 flex justify-center">
          <div className="w-32 h-32 rounded-full bg-white/5 ring-4 ring-white/10 flex items-center justify-center overflow-hidden">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.username} className="w-full h-full object-cover" />
            ) : (
              <UserIcon size={56} className="text-white/20" />
            )}
            
            {isUploading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            )}
          </div>

          {isOwnProfile && (
            <div className="absolute -bottom-2 -right-2 pl-4 pb-4">
              <button 
                onClick={(e) => { e.stopPropagation(); setShowPfpMenu(!showPfpMenu); }}
                className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center border-4 border-black active:scale-95 transition-transform shadow-xl"
              >
                <Plus size={20} strokeWidth={3} />
              </button>

              <AnimatePresence>
                {showPfpMenu && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    className="absolute top-12 left-0 min-w-[200px] bg-[#1c1c1c] rounded-2xl p-2 border border-white/10 shadow-2xl z-20"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept="image/*" 
                      onChange={handleFileChange} 
                    />
                    
                    <button 
                      onClick={() => {
                        setShowPfpMenu(false);
                        if (profile.avatar_url) setViewingImage(profile.avatar_url);
                      }}
                      className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 flex items-center text-sm transition-colors"
                    >
                      <Eye size={18} className="mr-3 text-white/70" />
                      Look at picture
                    </button>
                    
                    <button 
                      onClick={() => {
                        setShowPfpMenu(false);
                        fileInputRef.current?.click();
                      }}
                      className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 flex items-center text-sm transition-colors mt-1"
                    >
                      <Camera size={18} className="mr-3 text-white/70" />
                      Change picture
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Username */}
        <p className="text-white/50 text-sm font-medium tracking-widest uppercase items-center mb-8">@{profile.username}</p>

        {/* Connections */}
        <div className="w-full mb-12">
          <div className="flex items-center justify-between mb-4 px-2">
            <h3 className="text-sm font-bold uppercase tracking-widest text-white/70">Connections</h3>
            <span className="text-xs font-bold text-white/30">{connections.length}</span>
          </div>
          
          <div className="flex space-x-4 overflow-x-auto pb-4 px-2 -mx-4 no-scrollbar">
            {/* Added a spacer to allow scrolling padding */}
            <div className="w-2 shrink-0"></div>
            {connections.map((conn) => (
              <div key={conn.id} className="flex flex-col items-center shrink-0 w-16">
                <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 overflow-hidden mb-2">
                  <img src={conn.avatar} alt={conn.name} className="w-full h-full object-cover" />
                </div>
                <p className="text-xs text-white/70 text-center truncate w-full">{conn.name}</p>
              </div>
            ))}
            {/* Find more button */}
            <div className="flex flex-col items-center shrink-0 w-16">
              <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 border-dashed flex items-center justify-center mb-2">
                 <Plus size={20} className="text-white/40" />
              </div>
              <p className="text-xs text-white/40 text-center truncate w-full">Find</p>
            </div>
            <div className="w-2 shrink-0"></div>
          </div>
        </div>

      </div>

      <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/10 to-transparent mb-8" />

      {/* Posts */}
      <div className="w-full">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
        {posts.length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center text-white/20">
             <Camera size={32} className="mb-4 opacity-20" />
             <p className="text-xs uppercase tracking-widest font-medium">No moments captured</p>
          </div>
        )}
      </div>

      {/* Footer text */}
      <div className="mt-16 text-center px-8 pb-12">
        <p className="text-[10px] text-white/20 font-medium uppercase tracking-[0.2em] leading-relaxed">
          You entered Socium on<br/>
          <span className="text-white/40">{formatDate(profile.updated_at).split(',')[0]}</span>
        </p>
      </div>

    </div>
  );
}
