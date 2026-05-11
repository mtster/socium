import React, { useRef } from 'react';
import { User as UserIcon, Pencil, Camera, Eye, Trash } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Profile } from '@/src/types';

interface ProfileHeaderProps {
  profile: Profile;
  isOwnProfile: boolean;
  localAvatar: string | null;
  isUploading: boolean;
  showPfpMenu: boolean;
  setShowPfpMenu: (show: boolean) => void;
  setViewingImage: (url: string) => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRemovePfp: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  profile,
  isOwnProfile,
  localAvatar,
  isUploading,
  showPfpMenu,
  setShowPfpMenu,
  setViewingImage,
  handleFileChange,
  handleRemovePfp,
  fileInputRef
}) => {
  return (
    <div className="px-4 py-8 flex flex-col items-center">
      <h1 
        className={`text-3xl font-bold tracking-tight mb-6 text-center ${isOwnProfile ? 'cursor-pointer hover:opacity-80 active:scale-95 transition-all' : ''}`}
        onClick={() => {
          if (isOwnProfile) {
            window.dispatchEvent(new CustomEvent('openCompleteProfile'));
          }
        }}
      >
        {profile.full_name || profile.username}
      </h1>

      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*" 
        onChange={handleFileChange} 
      />

      <div className="relative mb-4 flex justify-center">
        <div 
          className="w-32 h-32 rounded-full bg-white/5 ring-4 ring-white/10 flex items-center justify-center overflow-hidden cursor-pointer active:scale-95 transition-transform"
          onClick={() => localAvatar && setViewingImage(localAvatar)}
        >
          {localAvatar ? (
            <img src={localAvatar} alt={profile.username} className="w-full h-full object-cover" />
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
              <Pencil size={18} strokeWidth={2.5} />
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
                  <button 
                    onClick={() => {
                      setShowPfpMenu(false);
                      if (localAvatar) setViewingImage(localAvatar);
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

                  {localAvatar && (
                    <button 
                      onClick={handleRemovePfp}
                      className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 flex items-center text-sm transition-colors mt-1 text-red-500 font-medium"
                    >
                      <Trash size={18} className="mr-3" />
                      Remove picture
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <p className="text-white/50 text-sm font-medium tracking-widest uppercase mb-4">@{profile.username}</p>
    </div>
  );
};

export default ProfileHeader;
