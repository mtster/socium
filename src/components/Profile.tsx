import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings, Plus, Camera, Eye, User as UserIcon, Trash, X, MessageCircle, MapPin, Pencil, Users, ArrowLeft, UserMinus, MoreHorizontal } from 'lucide-react';
import { Profile, Post } from '@/src/types';
import PostCard from './PostCard';
import { supabase } from '@/src/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { formatDate } from '@/src/lib/utils';
import UserSearchModal from './UserSearchModal';
import ImageCropperModal from './ImageCropperModal';
import { useConnections } from './profile/useConnections';
import { ProfileImageViewer } from './profile/ProfileImageViewer';

interface ProfileViewProps {
  profile: Profile;
  posts: Post[];
  isOwnProfile?: boolean;
  currentUserId?: string;
  onUserClick?: (userId: string) => void;
  onDeletePost?: (postId: string) => void;
  onLikePost?: (postId: string, isLiked: boolean) => void;
  onRefetch?: () => void;
}

const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
let cachedAdminProfile: Profile | null = null;
async function getAdminProfile() {
  if (cachedAdminProfile) return cachedAdminProfile;
  const { data } = await supabase.from('profiles').select('*').eq('id', ADMIN_ID).maybeSingle();
  if (data) cachedAdminProfile = data;
  return data;
}

let profileConnectionsCache: Record<string, any[]> = {};
let profileConnectionsTime: Record<string, number> = {};

import { useStore } from '../store/useStore';

export default function ProfileView({ profile, posts, isOwnProfile, currentUserId, onUserClick, onDeletePost, onLikePost, onRefetch }: ProfileViewProps) {
  const { userPosts, fetchUserPosts, hasUnseenRequest, markPendingRequestsAsSeen } = useStore();
  
  const isHumorBot = profile?.id === '00000000-0000-0000-0000-000000000001';
  const isAdminViewingBot = isHumorBot && currentUserId === '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
  const canEditProfile = isOwnProfile || isAdminViewingBot;

  const [showEditBotModal, setShowEditBotModal] = useState(false);
  const [botFullName, setBotFullName] = useState(profile?.full_name || '');
  const [botUsername, setBotUsername] = useState(profile?.username || '');
  const [botBio, setBotBio] = useState(profile?.bio || '');

  const handleSaveBotProfile = async () => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: botFullName, username: botUsername, bio: botBio })
        .eq('id', profile.id);
      if (error) throw error;
      profile.full_name = botFullName;
      profile.username = botUsername;
      profile.bio = botBio;
      setShowEditBotModal(false);
      onRefetch?.();
    } catch (e: any) {
      alert(`Failed to save: ${e.message}`);
    }
  };

  const [showPfpMenu, setShowPfpMenu] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [showConnectedMenu, setShowConnectedMenu] = useState(false);
  const [showRequestsSlide, setShowRequestsSlide] = useState(false);

  useEffect(() => {
    if (showRequestsSlide && isOwnProfile && currentUserId && markPendingRequestsAsSeen) {
      markPendingRequestsAsSeen(currentUserId);
    }
  }, [showRequestsSlide, isOwnProfile, currentUserId, markPendingRequestsAsSeen]);
  
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
    return () => {
      window.dispatchEvent(new CustomEvent('viewerState', { detail: { isOpen: false } }));
    };
  }, [viewingImage, showRequestsSlide]);

  // Local state for immediate avatar update
  const [localAvatar, setLocalAvatar] = useState(profile.avatar_url);

  useEffect(() => {
    setLocalAvatar(profile.avatar_url);
  }, [profile.avatar_url]);

  useEffect(() => {
    const targetPostId = sessionStorage.getItem('scroll_to_post_id');
    if (targetPostId) {
      sessionStorage.removeItem('scroll_to_post_id');
      
      let attempts = 0;
      const interval = setInterval(() => {
        const element = document.getElementById(`post-card-${targetPostId}`);
        attempts++;
        if (element) {
          clearInterval(interval);
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('animate-highlight-glow');
          setTimeout(() => {
            element.classList.remove('animate-highlight-glow');
          }, 3000);
        } else if (attempts > 30) {
          clearInterval(interval);
        }
      }, 150);
    }
  }, [posts]);

  const {
    connections,
    pendingRequests,
    connectionStatus,
    connectionId,
    handleRequestConnection,
    handleAcceptConnection,
    handleRemoveConnection
  } = useConnections(profile, !!isOwnProfile, currentUserId);

  // Close menu if clicked outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showPfpMenu) setShowPfpMenu(false);
      if (showConnectedMenu) setShowConnectedMenu(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showPfpMenu, showConnectedMenu]);

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
    // reset input
    e.target.value = '';
  };

  const handleCropComplete = async (croppedFile: File) => {
    setCropperImageSrc(null);
    try {
      setIsUploading(true);
      
      const fileExt = 'jpg';
      const fileName = `${profile.id}-${Math.random()}.${fileExt}`;
      const filePath = `${profile.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, croppedFile);

      if (uploadError) {
        if (uploadError.message.includes('bucket not found')) {
          alert('STORAGE ERROR: The "avatars" bucket is missing.\n\nPlease go to Supabase -> Storage, and create a PUBLIC bucket named "avatars" as stated in the database setup rules.');
          return;
        }
        throw uploadError;
      }

      const { data } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const imageUrl = data.publicUrl;

      // Update Supabase profile
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: imageUrl })
        .eq('id', profile.id);

      if (error) throw error;
      
      // Update local state (optimistic)
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
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', profile.id);

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
      {/* Full Screen Image Viewer */}
      <ProfileImageViewer viewingImage={viewingImage} setViewingImage={setViewingImage} />

      {/* Edit Bot Profile Modal (Admin only) */}
      <AnimatePresence>
        {showEditBotModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
            onClick={() => setShowEditBotModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-[#121212] border border-white/10 rounded-[28px] p-8 shadow-2xl relative"
            >
              <h3 className="text-xl font-bold text-white mb-6 tracking-tight">Edit Bot Profile</h3>
              
              <div className="space-y-4 mb-8">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-white/40 mb-2">Display Name</label>
                  <input 
                    type="text" 
                    value={botFullName} 
                    onChange={(e) => setBotFullName(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/30 rounded-xl px-4 py-3 focus:outline-none focus:border-white/30 text-sm transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-white/40 mb-2">Username</label>
                  <input 
                    type="text" 
                    value={botUsername} 
                    onChange={(e) => setBotUsername(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/30 rounded-xl px-4 py-3 focus:outline-none focus:border-white/30 text-sm transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-white/40 mb-2">Bio / Description</label>
                  <textarea 
                    value={botBio} 
                    onChange={(e) => setBotBio(e.target.value)}
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/30 rounded-xl px-4 py-3 focus:outline-none focus:border-white/30 text-sm transition-all resize-none"
                    placeholder="E.g. Official jokes and memes teller."
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowEditBotModal(false)}
                  className="flex-1 bg-white/5 text-white/70 font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all hover:bg-white/10 text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveBotProfile}
                  className="flex-1 bg-white text-black font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all hover:bg-white/90 text-sm shadow-[0_4px_12px_rgba(255,255,255,0.1)]"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-4 py-8 flex flex-col items-center">
        {cropperImageSrc && (
          <ImageCropperModal 
            imageSrc={cropperImageSrc} 
            onClose={() => setCropperImageSrc(null)} 
            onComplete={handleCropComplete} 
          />
        )}
        {/* Full Name above picture */}
        <h1 
          className={`text-3xl font-bold tracking-tight mb-6 text-center ${canEditProfile ? 'cursor-pointer hover:opacity-80 active:scale-95 transition-all' : ''}`}
          onClick={() => {
            if (isAdminViewingBot) {
              setBotFullName(profile.full_name || '');
              setBotUsername(profile.username || '');
              setBotBio(profile.bio || '');
              setShowEditBotModal(true);
            } else if (isOwnProfile) {
              window.dispatchEvent(new CustomEvent('openCompleteProfile'));
            }
          }}
        >
          {profile.full_name || profile.username}
        </h1>

        {/* Hidden inputs outside AnimatePresence so it doesn't get unmounted */}
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*" 
          onChange={handleFileChange} 
        />

        {/* Profile Picture Section */}
        <div className="relative mb-8 flex justify-center">
          <div className="w-32 h-32 rounded-full bg-white/5 ring-4 ring-white/10 flex items-center justify-center overflow-hidden">
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

          {canEditProfile && (
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

        {/* Username */}
        <p className="text-white/50 text-sm font-medium tracking-widest uppercase items-center mb-8">@{profile.username}</p>

        {/* Action Buttons for Other Profile */}
        {!isOwnProfile && !isHumorBot && (
          <div className="flex space-x-3 mb-8 w-full max-w-xs relative">
            <AnimatePresence>
              {showDisconnectConfirm && createPortal(
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
            onClick={() => setShowDisconnectConfirm(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs bg-[#1A1A1A] border border-white/10 rounded-[28px] overflow-hidden shadow-2xl p-8 text-center"
            >
              <h3 className="text-white text-base font-bold mb-8 tracking-tight">Are you sure you want to remove this user from connections?</h3>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDisconnectConfirm(false)}
                  className="flex-1 bg-white/5 text-white/70 font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all hover:bg-white/10 text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    if (connectionId) {
                      handleRemoveConnection(connectionId);
                    } else if (!isOwnProfile) {
                       handleRemoveConnection('unknown', profile.id);
                    }
                    setShowDisconnectConfirm(false);
                  }}
                  className="flex-1 bg-red-500 text-white font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all hover:brightness-110 text-sm shadow-[0_4px_12px_rgba(239,68,68,0.25)]"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </motion.div>,
          document.body
              )}
            </AnimatePresence>

            {connectionStatus === 'none' && (
              <button 
                onClick={handleRequestConnection}
                className="flex-1 bg-white text-black font-bold py-2.5 rounded-xl active:scale-95 transition-transform"
              >
                Connect
              </button>
            )}
            {connectionStatus === 'pending_sent' && (
              <button 
                onClick={() => connectionId && handleRemoveConnection(connectionId)}
                className="flex-1 border border-white/20 text-white font-bold py-2.5 rounded-xl active:scale-95 transition-transform"
              >
                Requested
              </button>
            )}
            {connectionStatus === 'pending_received' && (
              <button 
                onClick={() => connectionId && handleAcceptConnection(connectionId)}
                className="flex-1 bg-white text-black font-bold py-2.5 rounded-xl active:scale-95 transition-transform"
              >
                Accept pending
              </button>
            )}
             {connectionStatus === 'accepted' && profile.id !== ADMIN_ID && currentUserId !== ADMIN_ID && (
               <>
                  <button 
                    onClick={() => window.dispatchEvent(new CustomEvent('openChat', { detail: { profile } }))}
                    className="w-11 h-11 bg-white text-black rounded-xl flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                  >
                    <MessageCircle size={20} className="fill-current" />
                  </button>
                <div className="flex-1 bg-white/10 text-white font-bold py-2.5 rounded-xl flex items-center justify-center text-sm">
                  Connected
                </div>
                  <div className="relative">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setShowConnectedMenu(!showConnectedMenu); }}
                    className="w-10 h-10 bg-white/10 text-white rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform hover:bg-white/20 ml-2"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                  <AnimatePresence>
                    {showConnectedMenu && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: -10 }}
                        className="absolute right-0 top-12 w-48 bg-[#1c1c1c] rounded-xl border border-white/10 shadow-2xl z-20 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button 
                          onClick={() => {
                            setShowConnectedMenu(false);
                            setShowDisconnectConfirm(true);
                          }}
                          className="w-full px-4 py-3 flex items-center text-sm hover:bg-white/5 transition-colors text-red-500 font-medium"
                        >
                          <UserMinus size={16} className="mr-3" />
                          Remove connection
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                </>
             )}
             {connectionStatus === 'accepted' && (profile.id === ADMIN_ID || currentUserId === ADMIN_ID) && (
               <>
                  <button 
                    onClick={() => window.dispatchEvent(new CustomEvent('openChat', { detail: { profile } }))}
                    className="w-11 h-11 bg-white text-black rounded-xl flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                  >
                    <MessageCircle size={20} className="fill-current" />
                  </button>
                  <div className="flex-1 bg-white/5 text-white/50 text-center font-bold py-2.5 rounded-xl cursor-default border border-white/5 text-sm flex items-center justify-center">
                    {profile.id === ADMIN_ID ? 'Official Account' : 'Connected'}
                  </div>
                  <div className="relative">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setShowConnectedMenu(!showConnectedMenu); }}
                      className="w-11 h-11 bg-white/10 text-white rounded-xl flex items-center justify-center shrink-0 active:scale-95 transition-transform hover:bg-white/20"
                    >
                      <MoreHorizontal size={20} />
                    </button>
                    <AnimatePresence>
                      {showConnectedMenu && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95, y: 10, x: '-50%' }}
                          animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
                          exit={{ opacity: 0, scale: 0.95, y: 10, x: '-50%' }}
                          className="absolute top-14 right-[-100px] min-w-[200px] bg-[#1c1c1c] rounded-2xl p-2 border border-white/10 shadow-2xl z-20"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button 
                            onClick={() => {
                              setShowConnectedMenu(false);
                              setShowDisconnectConfirm(true);
                            }}
                            className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 flex items-center text-sm transition-colors text-red-500 font-bold"
                          >
                            <UserMinus size={18} className="mr-3" />
                            Remove connection
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
             )}
          </div>
        )}

        {/* Connections */}
        {!isHumorBot && (
          <div className="w-full mb-12 mt-4">
          <div className="flex items-center justify-between mb-4 px-2">
            <h3 className="text-sm font-bold uppercase tracking-widest text-white/70">Connections <span className="text-white/30 ml-2">{connections.length}</span></h3>
            {isOwnProfile && (
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => setShowRequestsSlide(true)}
                  className={`flex items-center space-x-1 px-3 py-1.5 border rounded-full active:scale-95 transition-all relative ${
                    pendingRequests.length > 0 
                      ? 'bg-white text-black border-white hover:bg-white/90' 
                      : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <Users size={14} className={pendingRequests.length > 0 ? 'text-black' : 'text-white/50'} />
                  <span className="text-xs font-bold">Requests {pendingRequests.length > 0 && `(${pendingRequests.length})`}</span>
                  {isOwnProfile && hasUnseenRequest && pendingRequests.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-yellow-500 rounded-full border border-black shadow animate-pulse" />
                  )}
                </button>
                <button 
                  onClick={() => setShowSearchModal(true)}
                  className="flex items-center space-x-1 px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-full active:scale-95 transition-all"
                >
                  <Plus size={14} className="text-white/70" />
                  <span className="text-xs font-bold text-white/70">Find</span>
                </button>
              </div>
            )}
          </div>
          
          {connections.length > 0 ? (
            <div className="flex space-x-4 overflow-x-auto pb-4 px-2 -mx-4 no-scrollbar">
              <div className="w-2 shrink-0"></div>
              {connections.map((conn) => (
                <div 
                  key={conn.id} 
                  className="flex flex-col items-center shrink-0 w-16 cursor-pointer active:opacity-70 transition-opacity"
                  onClick={() => onUserClick?.(conn.id)}
                >
                  <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 overflow-hidden mb-2">
                    {conn.avatar_url ? (
                       <img src={conn.avatar_url} alt={conn.username} className="w-full h-full object-cover" />
                    ) : (
                       <div className="w-full h-full flex items-center justify-center text-white/40 text-xl font-bold">
                         {(conn.username?.[0] || conn.full_name?.[0] || '?').toUpperCase()}
                       </div>
                    )}
                  </div>
                  <p className="text-xs text-white/70 text-center truncate w-full">{conn.full_name || conn.username}</p>
                </div>
              ))}
              <div className="w-2 shrink-0"></div>
            </div>
          ) : (
             <div className="bg-white/5 border border-white/5 rounded-2xl p-6 text-center">
               <p className="text-sm text-white/40">No connections yet.</p>
             </div>
          )}
        </div>
        )}

      </div>

      <div className="h-px w-full bg-white/[0.08] my-8" />

      {/* Posts */}
      <div className="w-full space-y-0 pt-0">
        {(isOwnProfile ? userPosts : posts).map((post) => (
          <div key={post.id} className="relative">
            <PostCard 
              post={post} 
              currentUserId={currentUserId as string}
              onUserClick={undefined}
              onDelete={onDeletePost}
              onLike={onLikePost}
              onRefetch={onRefetch}
            />
          </div>
        ))}
        {(isOwnProfile ? userPosts : posts).length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center text-white/20">
             <Camera size={32} className="mb-4 opacity-20" />
             <p className="text-xs uppercase tracking-widest font-medium">No moments captured</p>
          </div>
        )}
      </div>

      {/* Footer text */}
      <div className="mt-16 text-center px-8 pb-12">
        <p className="text-[10px] text-white/20 font-medium uppercase tracking-[0.2em] leading-relaxed">
          {isOwnProfile ? 'You' : (profile.full_name?.split(' ')[0] || profile.username)} entered Socium on<br/>
          <span className="text-white/40">{formatDate(profile.updated_at).split(',')[0]}</span>
        </p>
      </div>

      <AnimatePresence>
        {showSearchModal && (
          <UserSearchModal 
            onClose={() => setShowSearchModal(false)} 
            onUserClick={(id) => {
              setShowSearchModal(false);
              if (onUserClick) onUserClick(id);
            }} 
          />
        )}
      </AnimatePresence>

      {/* Requests Slide UI */}
      <AnimatePresence>
        {showRequestsSlide && (
          <motion.div
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            transition={{ type: "tween", ease: [0.25, 1, 0.5, 1], duration: 0.4 }}
            className="fixed inset-0 z-[200] bg-black flex flex-col"
          >
            <div className="flex items-center px-4 h-14 pt-[env(safe-area-inset-top)] border-b border-white/10 shrink-0 bg-black/90 backdrop-blur-xl">
              <button 
                onClick={() => setShowRequestsSlide(false)} 
                className="p-2 -ml-2 text-white/80 active:scale-90 transition-transform absolute"
              >
                <ArrowLeft size={24} />
              </button>
              <h1 className="w-full text-center text-sm font-bold tracking-widest uppercase">REQUESTS</h1>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-6">
              {pendingRequests.length === 0 ? (
                <div className="flex flex-col items-center justify-center pt-20 text-center">
                  <p className="text-white/40 text-sm mb-6">No connection requests.</p>
                  <button 
                    onClick={() => {
                      setShowRequestsSlide(false);
                      setTimeout(() => setShowSearchModal(true), 100);
                    }}
                    className="flex items-center space-x-2 px-4 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-full active:scale-95 transition-all"
                  >
                    <Plus size={16} className="text-white" />
                    <span className="text-sm font-bold text-white">Find Connections</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingRequests.map((req) => (
                    <div key={req.id} className="flex items-center justify-between bg-white/5 rounded-2xl p-4 border border-white/10">
                      <div 
                        className="flex items-center space-x-3 flex-1 min-w-0 cursor-pointer active:opacity-70 transition-opacity"
                        onClick={() => {
                          setShowRequestsSlide(false);
                          if (onUserClick) onUserClick(req.profiles.id);
                        }}
                      >
                        <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0">
                          {req.profiles.avatar_url ? (
                            <img src={req.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-lg font-bold text-white/40 uppercase">
                               {req.profiles.username?.[0] || '?'}
                            </div>
                          )}
                        </div>
                        <div className="truncate pr-2">
                          <p className="text-sm font-bold text-white truncate">{req.profiles.full_name || req.profiles.username}</p>
                          <p className="text-xs text-white/50 truncate">@{req.profiles.username}</p>
                        </div>
                      </div>
                      <div className="flex space-x-2 shrink-0">
                        <button 
                          onClick={() => handleAcceptConnection(req.id)} 
                          className="bg-white text-black text-xs font-bold px-4 py-2 rounded-xl active:scale-95 transition-transform"
                        >
                          Accept
                        </button>
                        <button 
                          onClick={() => handleRemoveConnection(req.id, req.profiles.id)} 
                          className="bg-white/10 text-white text-xs font-bold px-4 py-2 rounded-xl active:scale-95 transition-transform"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                  
                  <div className="pt-8 flex justify-center">
                    <button 
                      onClick={() => {
                        setShowRequestsSlide(false);
                        setTimeout(() => setShowSearchModal(true), 100);
                      }}
                      className="flex items-center space-x-2 px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 rounded-full active:scale-95 transition-all"
                    >
                      <Plus size={14} className="text-white/70" />
                      <span className="text-xs font-bold text-white/70">Find More</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
