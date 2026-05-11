import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import ProfileView from './Profile';
import { Profile, Post } from '../types';
import { supabase } from '../lib/supabase';

interface OtherProfileOverlayProps {
  viewingProfileId: string | null;
  onClose: () => void;
  viewingProfileData: { profile: Profile; posts: Post[] } | null;
  currentUserId: string;
  onUserClick: (userId: string) => void;
  onDeletePost: (postId: string) => void;
  onUpdatePosts: (postId: string, isLiked: boolean) => void;
  onRefetch: (userId: string) => void;
}

const OtherProfileOverlay: React.FC<OtherProfileOverlayProps> = ({
  viewingProfileId,
  onClose,
  viewingProfileData,
  currentUserId,
  onUserClick,
  onDeletePost,
  onUpdatePosts,
  onRefetch
}) => {
  return (
    <AnimatePresence>
      {viewingProfileId !== null && (
        <motion.div 
          key="other_profile" 
          initial={{ opacity: 0, x: '100%' }} 
          animate={{ opacity: 1, x: 0 }} 
          exit={{ opacity: 0, x: '100%' }}
          transition={{ type: "tween", duration: 0.3 }}
          className="fixed inset-0 z-[60] bg-black overflow-y-auto"
        >
          <div className="sticky top-0 left-0 w-full px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 flex items-center bg-black/90 backdrop-blur-md z-50 border-b border-white/10 gap-4">
            <button 
              onClick={onClose} 
              className="p-3 -ml-2 text-white/90 active:scale-95 transition-transform"
            >
              <ArrowLeft size={24} />
            </button>
            <span className="text-xl font-bold tracking-tight">
              {viewingProfileData?.profile?.full_name || viewingProfileData?.profile?.username || 'Profile'}
            </span>
          </div>
          
          {viewingProfileData ? (
            <ProfileView 
              profile={viewingProfileData.profile} 
              posts={viewingProfileData.posts} 
              isOwnProfile={false}
              currentUserId={currentUserId}
              onUserClick={onUserClick}
              onDeletePost={onDeletePost}
              onLikePost={onUpdatePosts}
              onRefetch={() => onRefetch(viewingProfileData.profile.id)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center pt-40 px-4 text-center relative w-full h-full">
               <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
               <p className="text-white/50 text-sm">Loading profile...</p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OtherProfileOverlay;
