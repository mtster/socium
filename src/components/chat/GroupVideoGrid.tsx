import React from 'react';
import { Users } from 'lucide-react';
import { CallNode } from './callTypes';
import { VideoPlayer } from './VideoPlayer';

interface GroupVideoGridProps {
  remoteStreams: Record<string, MediaStream>;
  localStream: MediaStream | null;
  currentUserId: string;
  isVideoDisabled: boolean;
  activeCall: CallNode | null;
  currentProfile: any;
}

export function GroupVideoGrid({
  remoteStreams,
  localStream,
  currentUserId,
  isVideoDisabled,
  activeCall,
  currentProfile,
}: GroupVideoGridProps) {
  
  const getParticipantProfile = (uid: string) => {
    if (uid === currentUserId) {
      return {
        name: 'You',
        avatar: currentProfile?.avatar_url || ''
      };
    }
    
    // Check if the participant is the caller
    if (activeCall?.meta?.caller_id === uid) {
      return {
        name: activeCall.meta.caller_name || 'Caller',
        avatar: activeCall.meta.caller_avatar || ''
      };
    }

    // Check in participants list
    const participant = activeCall?.participants?.[uid];
    return {
      name: participant?.name || 'User',
      avatar: participant?.avatar_url || ''
    };
  };

  const renderGroupVideoBox = (uid: string, stream: MediaStream | null, isSelf: boolean, index: number, totalDisplays: number) => {
    const profile = getParticipantProfile(uid);
    const colSpanClass = (totalDisplays === 3 && index === 2) ? "col-span-2" : "";

    // Dynamically retrieve video disabled flags to safely alternate between feeds and avatars
    const isPeerVideoDisabled = isSelf
      ? isVideoDisabled
      : (activeCall?.meta?.caller_id === uid)
        ? activeCall?.caller_video_disabled === true
        : activeCall?.participants?.[uid]?.video_disabled === true;

    return (
      <div 
        key={uid} 
        className={`relative bg-zinc-900 border border-white/5 rounded-3xl overflow-hidden shadow-xl w-full h-[180px] xs:h-[220px] sm:h-[260px] flex items-center justify-center ${colSpanClass}`}
      >
        {stream && !isPeerVideoDisabled ? (
          <VideoPlayer
            stream={stream}
            muted={isSelf}
            className="w-full h-full object-cover rounded-3xl"
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-full overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center">
              {profile.avatar ? (
                <img src={profile.avatar} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <Users className="w-6 h-6 text-white/50" />
              )}
            </div>
            <p className="text-white/40 text-[9px] font-mono tracking-widest uppercase">
              {isPeerVideoDisabled ? "Camera Off" : "Connecting..."}
            </p>
          </div>
        )}

        {/* Small profile pic and name on top-left of each user's display box */}
        <div className="absolute top-3 left-3 bg-black/65 backdrop-blur-md border border-white/10 rounded-full py-1 pl-1 pr-2.5 flex items-center gap-1.5 max-w-[80%] pointer-events-none z-10">
          <div className="w-4 h-4 rounded-full overflow-hidden bg-white/10 shrink-0">
            {profile.avatar ? (
              <img src={profile.avatar} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                <span className="text-[7px] font-bold text-white/70 uppercase">
                  {profile.name[0]}
                </span>
              </div>
            )}
          </div>
          <span className="text-[10px] font-medium text-white/95 truncate">
            {profile.name}
          </span>
        </div>
      </div>
    );
  };

  const showLocal = !isVideoDisabled;
  // Dynamic extraction of connected mesh participants
  const visibleRemoteUids = Object.keys(remoteStreams).filter(uid => remoteStreams[uid]).slice(0, 3);
  const totalDisplays = (showLocal ? 1 : 0) + visibleRemoteUids.length;

  const gridClass = 
    totalDisplays === 1 ? "grid-cols-1 grid-rows-1" :
    totalDisplays === 2 ? "grid-cols-1 grid-rows-2" :
    totalDisplays === 3 ? "grid-cols-2 grid-rows-2" :
    "grid-cols-2 grid-rows-2";

  return (
    <div className={`grid ${gridClass} w-full gap-3 p-3 max-w-md mx-auto pointer-events-auto overflow-y-auto max-h-full`}>
      {/* Render local stream if video is toggled on */}
      {showLocal && renderGroupVideoBox(currentUserId, localStream, true, 0, totalDisplays)}

      {/* Render up to 3 remote streams */}
      {visibleRemoteUids.map((uid, idx) => 
        renderGroupVideoBox(uid, remoteStreams[uid], false, (showLocal ? 1 : 0) + idx, totalDisplays)
      )}
    </div>
  );
}
