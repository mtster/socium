import React, { useState, useRef, useEffect } from 'react';
import { User as UserIcon, Camera, X } from 'lucide-react';
import { Profile, Post } from '@/src/types';
import PostCard from './PostCard';
import { supabase } from '@/src/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { formatDate } from '@/src/lib/utils';
import UserSearchModal from './UserSearchModal';
import ImageCropperModal from './ImageCropperModal';
import ProfileHeader from './ProfileHeader';
import ProfileActions from './ProfileActions';
import ConnectionsList from './ConnectionsList';
import RequestsSlide from './RequestsSlide';
import { useProfileLogic } from '../hooks/useProfileLogic';
import { useStore } from '../store/useStore';
interface ProfileViewProps {
  profile: Profile;
  posts: Post[];
  isOwnProfile?: boolean;
  currentUserId: string;
  onUserClick: (userId: string) => void;
  onDeletePost: (postId: string) => void;
  onLikePost: (postId: string, isLiked: boolean) => void;
  onRefetch: () => void;
}

export default function ProfileView({ profile, posts, isOwnProfile, currentUserId, onUserClick, onDeletePost, onLikePost, onRefetch }: ProfileViewProps) {
  const { userPosts } = useStore();
  const [showPfpMenu, setShowPfpMenu] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);
  const [showRequestsSlide, setShowRequestsSlide] = useState(false);
  
  const {
    connections,
    pendingRequests,
    connectionStatus,
    connectionId,
    handleRequestConnection,
    handleAcceptConnection,
    handleRemoveConnection
  } = useProfileLogic(profile, currentUserId, isOwnProfile);

  useEffect(() => {
    const handleRequestsUI = () => setShowRequestsSlide(true);
    const handleResetTab = (e: any) => {
      if (e.detail?.tabId === 'profile') {
        setShowRequestsSlide(false);
        setShowSearchModal(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('openRequestsUI', handleRequestsUI);
    window.addEventListener('resetTab', handleResetTab);
    return () => {
      window.removeEventListener('openRequestsUI', handleRequestsUI);
      window.removeEventListener('resetTab', handleResetTab);
    };
  }, []);
  
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('viewerState', { detail: { isOpen: !!viewingImage || showRequestsSlide } }));
  }, [viewingImage, showRequestsSlide]);

  const [localAvatar, setLocalAvatar] = useState(profile.avatar_url);

  useEffect(() => {
    setLocalAvatar(profile.avatar_url);
  }, [profile.avatar_url]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      setCropperImageSrc(url);
      setShowPfpMenu(false);
    } catch (error) {
      console.error('Error previewing image:', error);
    }
    e.target.value = '';
  };

  const handleCropComplete = async (croppedFile: File) => {
    setCropperImageSrc(null);
    try {
      setIsUploading(true);
      const fileExt = 'jpg';
      const fileName = `${profile.id}-${Math.random()}.${fileExt}`;
      const filePath = `${profile.id}/${fileName}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, croppedFile);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const imageUrl = data.publicUrl;
      const { error } = await supabase.from('profiles').update({ avatar_url: imageUrl }).eq('id', profile.id);
      if (error) throw error;
      setLocalAvatar(imageUrl);
    } catch (error) {
      console.error('Error updating PFP:', error);
      alert('Failed to update profile picture.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemovePfp = async () => {
    try {
      setIsUploading(true);
      const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', profile.id);
      if (error) throw error;
      setLocalAvatar(null);
    } catch (e: any) {
      alert(`Failed to remove profile picture: ${e.message}`);
    } finally {
      setIsUploading(false);
      setShowPfpMenu(false);
    }
  };

  return (
    <div className="pb-6 relative z-10">
      <AnimatePresence>
        {viewingImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1000] bg-black/95 backdrop-blur-md flex items-center justify-center overflow-hidden"
            onClick={() => setViewingImage(null)}
          >
            <button 
              className="absolute top-10 right-6 z-[600] p-3 bg-white/10 rounded-full text-white active:scale-90 transition-all backdrop-blur-md border border-white/10 shadow-2xl"
              onClick={(e) => { e.stopPropagation(); setViewingImage(null); }}
            >
              <X size={24} />
            </button>
            <div className="w-full h-full flex items-center justify-center p-4">
              <TransformWrapper initialScale={1} minScale={1} maxScale={4} centerOnInit={true}>
                <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
                  <motion.div drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.6} onDragEnd={(_, info) => { if (Math.abs(info.offset.y) > 80) setViewingImage(null); }} className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing" onClick={(e) => e.stopPropagation()}>
                    <motion.img layoutId="profile-pfp" src={viewingImage} alt="Profile" className="max-w-[95vw] max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/5" />
                  </motion.div>
                </TransformComponent>
              </TransformWrapper>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ProfileHeader 
        profile={profile}
        isOwnProfile={!!isOwnProfile}
        localAvatar={localAvatar}
        isUploading={isUploading}
        showPfpMenu={showPfpMenu}
        setShowPfpMenu={setShowPfpMenu}
        setViewingImage={setViewingImage}
        handleFileChange={handleFileChange}
        handleRemovePfp={handleRemovePfp}
        fileInputRef={fileInputRef}
      />

      <div className="flex flex-col items-center">
        {!isOwnProfile && currentUserId && (
          <ProfileActions 
            profile={profile}
            currentUserId={currentUserId}
            connectionStatus={connectionStatus}
            connectionId={connectionId}
            handleRequestConnection={handleRequestConnection}
            handleAcceptConnection={handleAcceptConnection}
            handleRemoveConnection={handleRemoveConnection}
          />
        )}

        <ConnectionsList 
          connections={connections}
          pendingRequestsCount={pendingRequests.length}
          isOwnProfile={!!isOwnProfile}
          onUserClick={onUserClick}
          setShowRequestsSlide={setShowRequestsSlide}
          setShowSearchModal={setShowSearchModal}
        />
      </div>

      <div className="h-px w-full bg-white/[0.08] my-8" />

      <div className="w-full space-y-0 pt-0">
        {(isOwnProfile ? userPosts : posts).map((post) => (
          <div key={post.id}>
            <PostCard post={post} currentUserId={currentUserId} onUserClick={onUserClick} onDelete={onDeletePost} onLike={onLikePost} onRefetch={onRefetch} />
          </div>
        ))}
        {(isOwnProfile ? userPosts : posts).length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center text-white/20"><Camera size={32} className="mb-4 opacity-20" /><p className="text-xs uppercase tracking-widest font-medium">No moments captured</p></div>
        )}
      </div>

      <div className="mt-16 text-center px-8 pb-12">
        <p className="text-[10px] text-white/20 font-medium uppercase tracking-[0.2em] leading-relaxed">
          {isOwnProfile ? 'You' : (profile.full_name?.split(' ')[0] || profile.username)} entered Socium on<br/><span className="text-white/40">{formatDate(profile.updated_at).split(',')[0]}</span>
        </p>
      </div>

      <AnimatePresence>
        {showSearchModal && <UserSearchModal onClose={() => setShowSearchModal(false)} onUserClick={(id) => { setShowSearchModal(false); onUserClick?.(id); }} />}
      </AnimatePresence>

      <AnimatePresence>
        {showRequestsSlide && (
          <RequestsSlide 
            pendingRequests={pendingRequests}
            onClose={() => setShowRequestsSlide(false)}
            onUserClick={(id) => { setShowRequestsSlide(false); onUserClick?.(id); }}
            onAccept={handleAcceptConnection}
            onReject={handleRemoveConnection}
            setShowSearchModal={setShowSearchModal}
          />
        )}
      </AnimatePresence>
      
      {cropperImageSrc && <ImageCropperModal imageSrc={cropperImageSrc} onClose={() => setCropperImageSrc(null)} onComplete={handleCropComplete} />}
    </div>
  );
}
