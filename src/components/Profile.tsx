import React, { useState, useRef, useEffect } from 'react';
import { Settings, Plus, Camera, Eye, User as UserIcon, Trash, X } from 'lucide-react';
import { Profile, Post } from '@/src/types';
import PostCard from './PostCard';
import { supabase } from '@/src/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { formatDate } from '@/src/lib/utils';
import UserSearchModal from './UserSearchModal';
import ImageCropperModal from './ImageCropperModal';

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

export default function ProfileView({ profile, posts, isOwnProfile, currentUserId, onUserClick, onDeletePost, onLikePost, onRefetch }: ProfileViewProps) {
  const [showPfpMenu, setShowPfpMenu] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  
  // Local state for immediate avatar update
  const [localAvatar, setLocalAvatar] = useState(profile.avatar_url);

  useEffect(() => {
    setLocalAvatar(profile.avatar_url);
  }, [profile.avatar_url]);

  // Connections Query State
  const [connections, setConnections] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null); // 'none', 'pending_sent', 'pending_received', 'accepted'
  const [connectionId, setConnectionId] = useState<string | null>(null);

  useEffect(() => {
    fetchConnections();
  }, [profile.id, currentUserId]);

  const fetchConnections = async () => {
    if (!currentUserId || !profile.id) return;

    if (isOwnProfile) {
      // Fetch accepted friends
      const { data: accepted1 } = await supabase.from('connections').select('*, profiles!connections_receiver_id_fkey(*)').eq('requester_id', profile.id).eq('status', 'accepted');
      const { data: accepted2 } = await supabase.from('connections').select('*, profiles!connections_requester_id_fkey(*)').eq('receiver_id', profile.id).eq('status', 'accepted');
      
      const combined = [
        ...(accepted1?.map(c => c.profiles) || []),
        ...(accepted2?.map(c => c.profiles) || [])
      ].filter(Boolean);
      
      const adminProf = await getAdminProfile();
      if (adminProf && !combined.some(c => c.id === ADMIN_ID) && profile.id !== ADMIN_ID) {
        combined.unshift(adminProf);
      }
      
      setConnections(combined.filter(c => c.id !== profile.id && c.id !== currentUserId));

      // Fetch pending requests we received
      const { data: pending } = await supabase.from('connections').select('*, profiles!connections_requester_id_fkey(*)').eq('receiver_id', profile.id).eq('status', 'pending');
      setPendingRequests(pending || []);
    } else {
      // Viewing someone else: checking our relational status
      const { data: rel1 } = await supabase.from('connections')
        .select('*')
        .eq('requester_id', currentUserId)
        .eq('receiver_id', profile.id)
        .maybeSingle();

      const { data: rel2 } = await supabase.from('connections')
        .select('*')
        .eq('requester_id', profile.id)
        .eq('receiver_id', currentUserId)
        .maybeSingle();

      const rel = rel1 || rel2;
      
      if (profile.id === ADMIN_ID) {
        setConnectionStatus('accepted');
      } else if (!rel) {
        setConnectionStatus('none');
      } else {
        setConnectionId(rel.id);
        if (rel.status === 'accepted') {
          setConnectionStatus('accepted');
        } else if (rel.status === 'pending') {
          setConnectionStatus(rel.requester_id === currentUserId ? 'pending_sent' : 'pending_received');
        } else {
          setConnectionStatus('none');
        }
      }

      // Fetch their accepted connections count/list
      const { data: accepted1 } = await supabase.from('connections').select('*, profiles!connections_receiver_id_fkey(*)').eq('requester_id', profile.id).eq('status', 'accepted');
      const { data: accepted2 } = await supabase.from('connections').select('*, profiles!connections_requester_id_fkey(*)').eq('receiver_id', profile.id).eq('status', 'accepted');
      
      const combined = [
        ...(accepted1?.map(c => c.profiles) || []),
        ...(accepted2?.map(c => c.profiles) || [])
      ].filter(Boolean);

      const adminProf = await getAdminProfile();
      if (adminProf && !combined.some(c => c.id === ADMIN_ID) && profile.id !== ADMIN_ID) {
        combined.unshift(adminProf);
      }

      setConnections(combined.filter(c => c.id !== profile.id && c.id !== currentUserId));
    }
  };

  const handleRequestConnection = async () => {
    try {
      const { data, error } = await supabase.from('connections').insert({
        requester_id: currentUserId,
        receiver_id: profile.id,
        status: 'pending'
      }).select().single();
      
      if (error) throw error;
      setConnectionStatus('pending_sent');
      setConnectionId(data.id);
    } catch (e: any) {
      alert(e.message);
    }
  }

  const handleAcceptConnection = async (id: string) => {
    try {
      const { error } = await supabase.from('connections').update({ status: 'accepted' }).eq('id', id);
      if (error) throw error;
      if (isOwnProfile) {
        fetchConnections();
      } else {
        setConnectionStatus('accepted');
      }
    } catch (e: any) {
      alert(e.message);
    }
  }

  const handleRemoveConnection = async (id: string, connectionProfileId?: string) => {
    try {
      // Try to delete by ID
      const { error } = await supabase.from('connections').delete().eq('id', id);
      
      // Fallback robust deletion if we are on someone else's profile
      if (!isOwnProfile) {
        await supabase.from('connections')
          .delete()
          .or(`and(requester_id.eq.${currentUserId},receiver_id.eq.${profile.id}),and(requester_id.eq.${profile.id},receiver_id.eq.${currentUserId})`);
      } else if (connectionProfileId) {
         // robust deletion from pending list if id is unknown
         await supabase.from('connections')
          .delete()
          .or(`and(requester_id.eq.${currentUserId},receiver_id.eq.${connectionProfileId}),and(requester_id.eq.${connectionProfileId},receiver_id.eq.${currentUserId})`);
      }

      if (error && error.code !== 'PGRST116') throw error; // Ignore not found error if robust strategy worked
      
      if (!isOwnProfile) {
        setConnectionStatus('none');
        setConnectionId(null);
      }
      fetchConnections();
    } catch (e: any) {
      alert(e.message);
    }
  }

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
    <div className="pb-6 relative">
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
        {cropperImageSrc && (
          <ImageCropperModal 
            imageSrc={cropperImageSrc} 
            onClose={() => setCropperImageSrc(null)} 
            onComplete={handleCropComplete} 
          />
        )}
        {/* Full Name above picture */}
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
        {!isOwnProfile && (
          <div className="flex space-x-3 mb-8 w-full max-w-xs relative">
            <AnimatePresence>
              {showDisconnectConfirm && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  className="absolute top-full mt-2 left-0 right-0 bg-[#222] p-4 rounded-2xl border border-white/10 shadow-xl z-20"
                >
                  <p className="text-sm font-medium text-center mb-4 leading-relaxed">Are you sure you want to remove this user from your connections?</p>
                  <div className="flex space-x-2">
                    <button 
                      onClick={() => setShowDisconnectConfirm(false)}
                      className="flex-1 bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white font-bold py-2 rounded-xl text-sm"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => {
                        setShowDisconnectConfirm(false);
                        if (connectionId) handleRemoveConnection(connectionId);
                      }}
                      className="flex-1 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 active:scale-95 transition-all text-red-500 font-bold py-2 rounded-xl text-sm"
                    >
                      Remove
                    </button>
                  </div>
                </motion.div>
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
               <button 
                 onClick={() => setShowDisconnectConfirm(true)}
                 className="flex-1 bg-white/10 text-white font-bold py-2.5 rounded-xl active:scale-95 transition-transform"
               >
                 Connected
               </button>
             )}
             {connectionStatus === 'accepted' && (profile.id === ADMIN_ID || currentUserId === ADMIN_ID) && (
               <div className="flex-1 bg-white/5 text-white/50 text-center font-bold py-2.5 rounded-xl cursor-default border border-white/5 text-sm flex items-center justify-center">
                 {profile.id === ADMIN_ID ? 'Official Account' : 'Connected'}
               </div>
             )}
          </div>
        )}

        {/* Pending Requests for Own Profile */}
        {isOwnProfile && pendingRequests.length > 0 && (
          <div className="w-full mb-8 px-2">
            <h3 className="text-sm font-bold uppercase tracking-widest text-yellow-500 mb-4">Pending Requests</h3>
            {pendingRequests.map((req) => (
              <div key={req.id} className="flex items-center justify-between bg-white/5 rounded-xl p-3 mb-2 border border-white/10">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 border border-white/10">
                    <img src={req.profiles.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${req.profiles.username}`} alt="" className="w-full h-full object-cover" />
                  </div>
                  <p className="text-sm font-bold">{req.profiles.full_name || req.profiles.username}</p>
                </div>
                <div className="flex space-x-2">
                  <button onClick={() => handleAcceptConnection(req.id)} className="bg-white text-black text-xs font-bold px-3 py-1.5 rounded-lg active:scale-95">Accept</button>
                  <button onClick={() => handleRemoveConnection(req.id, req.profiles.id)} className="bg-white/10 text-white text-xs font-bold px-3 py-1.5 rounded-lg active:scale-95">Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Connections */}
        <div className="w-full mb-12">
          <div className="flex items-center justify-between mb-4 px-2">
            <h3 className="text-sm font-bold uppercase tracking-widest text-white/70">Connections <span className="text-white/30 ml-2">{connections.length}</span></h3>
            {isOwnProfile && (
              <button 
                onClick={() => setShowSearchModal(true)}
                className="flex items-center space-x-1 px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-full active:scale-95 transition-all"
              >
                <Plus size={14} className="text-white/70" />
                <span className="text-xs font-bold text-white/70">Find</span>
              </button>
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
                         {conn.username[0].toUpperCase()}
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

      </div>

      <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/10 to-transparent mb-8" />

      {/* Posts */}
      <div className="w-full">
        {posts.map((post) => (
          <div key={post.id} className="min-h-[250px]">
            <PostCard 
              post={post} 
              currentUserId={currentUserId as string}
              onUserClick={onUserClick}
              onDelete={onDeletePost}
              onLike={onLikePost}
              onRefetch={onRefetch}
            />
          </div>
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

    </div>
  );
}
