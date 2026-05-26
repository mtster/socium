import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Users } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { rtdb } from '@/src/lib/firebase';
import { ref, onValue, set, get, remove, off, onDisconnect } from 'firebase/database';
import { useStore } from '@/src/store/useStore';
import { CallMeta, Participant, CallNode, CfSession } from './callTypes';
import { synth } from './SoundSynthesizer';
import { VideoPlayer } from './VideoPlayer';
import { GroupVideoGrid } from './GroupVideoGrid';
import { createRealtimeKitRoom, getRealtimeKitToken, delegateCallRinger } from './CallsApi';
import RealtimeKitClient from '@cloudflare/realtimekit';

function parseAppIdFromToken(token: string): string {
  try {
    const parts = token.split('.');
    if (parts.length > 1) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.app || payload.sub || "";
    }
  } catch (e) {
    console.warn("Failed to parse App ID from JWT token:", e);
  }
  return "";
}

function getUserIdFromParticipant(participant: any): string {
  const name = participant.name || '';
  if (name.includes('||')) {
    return name.split('||')[0];
  }
  return name || participant.id;
}

export function CallsManager() {
  const currentUserId = useStore(state => state.profile?.id);
  const currentProfile = useStore(state => state.profile);

  // States
  const [activeCall, setActiveCall] = useState<CallNode | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState<'idle' | 'ringing_outgoing' | 'ringing_incoming' | 'connected' | 'ended'>('idle');
  const [showControls, setShowControls] = useState(true);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // For multi-peer rendering
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  // Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);
  const listenersRef = useRef<{ path: string; handler: any }[]>([]);
  const rtkRoomRef = useRef<any>(null);
  const initiatedAtRef = useRef<string | null>(null);

  // Connection-State synchronizers to avoid closure state captures in listeners
  const activeCallRef = useRef<CallNode | null>(null);
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  const callStatusRef = useRef(callStatus);
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  const callIdRef = useRef<string | null>(null);
  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  // Handle call duration timer
  useEffect(() => {
    if (callStatus === 'connected') {
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setCallDuration(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callStatus]);

  // Register database listeners safely with direct tracking vectors to prevent leaks or duplicates
  const registerDbListener = (pRef: any, callback: any) => {
    const pPath = pRef.toString().replace(/https?:\/\/[^\/]+/, '');
    onValue(pRef, callback);
    listenersRef.current.push({ path: pPath, handler: callback });
  };

  const clearAllDbListeners = () => {
    listenersRef.current.forEach(item => {
      try {
        off(ref(rtdb, item.path), 'value', item.handler);
      } catch (e) {}
    });
    listenersRef.current = [];
  };

  const archiveCallToSupabase = async (
    callUuid: string,
    hostUid: string,
    peerUid: string,
    initiatedAt: string,
    terminatedAt: string,
    durationSec: number
  ) => {
    try {
      const { error } = await supabase
        .from('call_records_history')
        .insert({
          call_uuid: callUuid,
          host_uid: hostUid,
          peer_uid: peerUid,
          initiated_at: initiatedAt,
          terminated_at: terminatedAt,
          duration: durationSec
        });

      if (error) {
        console.warn("Supabase archive insert warning (ignore if table is missing or unmigrated):", error.message);
      } else {
        console.log("Call record archived successfully in Supabase!");
      }
    } catch (err) {
      console.warn("Could not insert call record in Supabase:", err);
    }
  };

  // Release media tracks and connections
  const cleanMediaAndRTC = () => {
    // 1. Release local streams
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      localStreamRef.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      setLocalStream(null);
    }

    // 2. Stop remote streams
    Object.keys(remoteStreams).forEach(uid => {
      const stream = remoteStreams[uid];
      if (stream) {
        stream.getTracks().forEach(track => {
          try { track.stop(); } catch (e) {}
        });
      }
    });
    setRemoteStreams({});

    // 3. Close RealtimeKit Room
    if (rtkRoomRef.current) {
      try {
        rtkRoomRef.current.leave();
      } catch (e) {}
      rtkRoomRef.current = null;
    }

    setIsMuted(false);
    setIsVideoDisabled(false);
    synth.stopRinging();
  };

  // Main teardown caller
  const handleLocalHangup = async (isSilent = false) => {
    const cid = callIdRef.current || callId;
    const callObj = activeCallRef.current || activeCall;
    if (cid && callObj && callStatusRef.current === 'connected') {
      const initiatedAt = initiatedAtRef.current || new Date().toISOString();
      const terminatedAt = new Date().toISOString();
      const host = callObj.meta.caller_id;
      const peer = Object.keys(callObj.participants || {})[0] || '';

      await archiveCallToSupabase(cid, host, peer, initiatedAt, terminatedAt, callDuration);
    }

    cleanMediaAndRTC();
    setCallStatus('idle');
    setActiveCall(null);
    setCallId(null);
    if (!isSilent) synth.playHangup();
  };

  // Core Orchestration hooks
  useEffect(() => {
    if (!currentUserId || !rtdb) return;

    const userCallActiveRef = ref(rtdb, `user_calls/${currentUserId}/active`);
    registerDbListener(userCallActiveRef, async (snapshot) => {
      const incomingCallId = snapshot.val();
      if (incomingCallId) {
        setCallId(incomingCallId);

        const callNodeRef = ref(rtdb, `calls/${incomingCallId}`);
        registerDbListener(callNodeRef, (callSnap) => {
          const callData = callSnap.val() as CallNode | null;
          if (callData && callData.meta) {
            setActiveCall(callData);

            if (callData.status === 'ended') {
              handleLocalHangup();
              return;
            }

            // Register on-disconnect state fallbacks
            onDisconnect(ref(rtdb, `calls/${incomingCallId}/participants/${currentUserId}/status`)).set('declined');
            onDisconnect(ref(rtdb, `user_calls/${currentUserId}/active`)).set(null);

            const selfPart = callData.participants?.[currentUserId];
            if (selfPart) {
              if (selfPart.status === 'ringing') {
                setCallStatus('ringing_incoming');
                synth.startRinging();
              } else if (selfPart.status === 'accepted') {
                setCallStatus('connected');
                synth.stopRinging();
              } else if (selfPart.status === 'declined') {
                handleLocalHangup();
              }
            }
          } else {
            handleLocalHangup(true);
          }
        });
      } else {
        handleLocalHangup(true);
      }
    });

    const handleInitiateCallEvent = async (e: any) => {
      const { chat, type } = e.detail;
      if (!chat) return;

      setIsMuted(false);
      setIsVideoDisabled(false);
      const newCallId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      setCallId(newCallId);
      setCallStatus('ringing_outgoing');
      synth.startRinging();

      const callerName = currentProfile?.full_name || currentProfile?.username || 'Socium User';
      const callerAvatar = currentProfile?.avatar_url || null;

      const roomName = chat.isGroup ? chat.name : (chat.name || 'Socium Chat');
      const roomAvatar = chat.avatar_url || null;

      const meta: CallMeta = {
        id: newCallId,
        caller_id: currentUserId,
        caller_name: callerName,
        caller_avatar: callerAvatar,
        chat_room_id: chat.id,
        is_group: chat.isGroup,
        type: type as 'audio' | 'video',
        room_name: roomName,
        room_avatar: roomAvatar
      };

      try {
        await supabase.from('messages').insert({
          sender_id: currentUserId,
          receiver_id: chat.isGroup ? null : chat.id,
          group_chat_id: chat.isGroup ? chat.id : null,
          content: type === 'audio' ? '📞 Audio Call' : '🎥 Video Call',
          media_type: type === 'audio' ? 'call_audio' : 'call_video'
        });
      } catch (insertErr) {
        console.error("Failed to insert native call message bubble to Supabase:", insertErr);
      }

      const recipients: string[] = chat.isGroup
        ? (chat.participants || []).map((p: any) => p.id || p.user_id).filter((uid: string) => uid !== currentUserId)
        : [chat.id];

      const participants: Record<string, Participant> = {};
      for (const rid of recipients) {
        let pName = 'User';
        let pAvatar = null;
        if (chat.isGroup && chat.participants) {
          const matched = chat.participants.find((p: any) => (p.id || p.user_id) === rid);
          if (matched) {
            pName = matched.full_name || matched.username || 'User';
            pAvatar = matched.avatar_url || null;
          }
        } else {
          pName = chat.name || 'User';
          pAvatar = chat.avatar_url || null;
        }

        participants[rid] = {
          status: 'ringing',
          name: pName,
          avatar_url: pAvatar
        };
      }

      try {
        const mid = await createRealtimeKitRoom();
        const token = await getRealtimeKitToken(mid, currentUserId!, `${currentUserId}||${callerName}`);

        const freshCallNode: any = {
          status: "dialing",
          meetingId: mid,
          meta,
          participants,
          timestamp: Date.now()
        };

        const callRefNode = ref(rtdb, `calls/${newCallId}`);
        await set(callRefNode, freshCallNode);
        onDisconnect(callRefNode).remove();

        const selfActiveCallRef = ref(rtdb, `user_calls/${currentUserId}/active`);
        await set(selfActiveCallRef, newCallId);
        onDisconnect(selfActiveCallRef).set(null);

        for (const rid of recipients) {
          await set(ref(rtdb, `user_calls/${rid}/active`), newCallId);
          onDisconnect(ref(rtdb, `user_calls/${rid}/active`)).set(null);
        }

        await joinRealtimeKitCall(newCallId, mid, token);

        for (const rid of recipients) {
          await delegateCallRinger(newCallId, rid, callerName);
        }

      } catch (sessErr) {
        console.error("Establishing initial caller session failed:", sessErr);
        handleLocalHangup();
        return;
      }

      const callRef = ref(rtdb, `calls/${newCallId}`);
      registerDbListener(callRef, (snap) => {
        const val = snap.val() as CallNode | null;
        if (val && val.meta) {
          setActiveCall(val);

          if (val.meta.caller_id === currentUserId) {
            const recipientsList = Object.keys(val.participants || {});
            if (recipientsList.length > 0) {
              const hasActiveRecipient = recipientsList.some(uid =>
                val.participants[uid]?.status === 'ringing' || val.participants[uid]?.status === 'accepted'
              );
              if (!hasActiveRecipient) {
                handleLocalHangup();
                return;
              }
            }
          }

          const acceptedUser = Object.keys(val.participants || {}).find(uid => val.participants[uid]?.status === 'accepted');
          if (acceptedUser) {
            setCallStatus('connected');
            synth.stopRinging();
          }

          if (!chat.isGroup && val.participants?.[chat.id]?.status === 'declined') {
            handleLocalHangup();
          }
        } else {
          handleLocalHangup(true);
        }
      });

      // FCM Web Push fallbacks for ringing signaling triggers
      if (recipients.length > 0) {
        try {
          const { data: pushRecs } = await supabase
            .from('push_subscriptions')
            .select('user_id, endpoint')
            .in('user_id', recipients);

          if (pushRecs && pushRecs.length > 0) {
            const tokenGroups: Record<string, string[]> = {};
            pushRecs.forEach(r => {
              if (!tokenGroups[r.user_id]) tokenGroups[r.user_id] = [];
              tokenGroups[r.user_id].push(r.endpoint);
            });

            const recipientTokens = Object.keys(tokenGroups).map(uid => ({
              userId: uid,
              tokens: tokenGroups[uid]
            }));

            const callsWorkerUrl = 'https://socium-call-notifications.brare-black.workers.dev/';

            let triggerCount = 0;
            const runPushTrigger = () => {
              if (callStatusRef.current !== 'ringing_outgoing' || triggerCount >= 3) return;
              triggerCount++;

              fetch(callsWorkerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  call_id: newCallId,
                  caller_id: currentUserId,
                  caller_name: callerName,
                  caller_avatar: callerAvatar,
                  chat_room_id: chat.id,
                  type: type,
                  is_group: chat.isGroup,
                  recipient_tokens: recipientTokens
                })
              }).catch(e => console.error("Cloudflare calls worker notifications post error:", e));

              if (triggerCount < 3) {
                setTimeout(runPushTrigger, 3500);
              }
            };

            runPushTrigger();
          }
        } catch (supabaseErr) {
          console.error("Supabase notification query failed:", supabaseErr);
        }
      }
    };

    window.addEventListener('initiateCall', handleInitiateCallEvent);

    return () => {
      clearAllDbListeners();
      window.removeEventListener('initiateCall', handleInitiateCallEvent);
    };
  }, [currentUserId, currentProfile]);

  // Join RealtimeKit Room helper
  const joinRealtimeKitCall = async (cid: string, meetingId: string, token: string) => {
    if (rtkRoomRef.current) {
      try { await rtkRoomRef.current.leave(); } catch (e) {}
      rtkRoomRef.current = null;
    }

    try {
      const client = await RealtimeKitClient.init({
        authToken: token
      });
      rtkRoomRef.current = client;

      await client.join();

      // Configure video and audio publishing cleanly
      await client.self.enableAudio();
      const withVideo = activeCallRef.current?.meta?.type === 'video' || activeCall?.meta?.type === 'video';
      if (withVideo) {
        await client.self.enableVideo();
      }

      // Track current local media stream to show locally
      const localS = new MediaStream();
      if (client.self.audioTrack) localS.addTrack(client.self.audioTrack);
      if (client.self.videoTrack) localS.addTrack(client.self.videoTrack);

      setLocalStream(localS);
      localStreamRef.current = localS;
      initiatedAtRef.current = new Date().toISOString();

      const rebuildRemoteStreams = () => {
        const streamMap: Record<string, MediaStream> = {};

        client.participants.joined.forEach((p: any) => {
          const pUserId = getUserIdFromParticipant(p);
          if (pUserId === currentUserId) return; // Ignore self

          const remoteStream = new MediaStream();
          let hasTracks = false;

          if (p.audioEnabled && p.audioTrack) {
            remoteStream.addTrack(p.audioTrack);
            hasTracks = true;
          }
          if (p.videoEnabled && p.videoTrack) {
            remoteStream.addTrack(p.videoTrack);
            hasTracks = true;
          }

          if (hasTracks) {
            streamMap[pUserId] = remoteStream;
          }
        });

        setRemoteStreams(streamMap);
      };

      // Subscribe to joining updates
      client.participants.joined.on('participantJoined', (p: any) => {
        rebuildRemoteStreams();
        p.on('videoUpdate', () => rebuildRemoteStreams());
        p.on('audioUpdate', () => rebuildRemoteStreams());
      });

      client.participants.joined.on('participantLeft', () => {
        rebuildRemoteStreams();
      });

      // Bind to initial participants
      client.participants.joined.forEach((p: any) => {
        p.on('videoUpdate', () => rebuildRemoteStreams());
        p.on('audioUpdate', () => rebuildRemoteStreams());
      });

      rebuildRemoteStreams();

    } catch (realtimeKitErr) {
      console.error("RealtimeKit engine join failed:", realtimeKitErr);
      throw realtimeKitErr;
    }
  };

  const handleAcceptCall = async () => {
    if (!callId || !activeCall) return;
    synth.playAnswer();
    setIsMuted(false);
    setIsVideoDisabled(false);

    try {
      const mid = activeCall.meetingId;
      if (!mid) throw new Error("No meetingId associated with this call.");

      const myName = currentProfile?.full_name || currentProfile?.username || 'Socium User';
      const myToken = await getRealtimeKitToken(mid, currentUserId!, `${currentUserId}||${myName}`);

      await set(ref(rtdb, `calls/${callId}/participants/${currentUserId}/status`), 'accepted');
      await set(ref(rtdb, `calls/${callId}/status`), 'accepted');

      await joinRealtimeKitCall(callId, mid, myToken);
      setCallStatus('connected');
    } catch (acceptErr) {
      console.error("Failed to establish receiver side RealtimeKit session:", acceptErr);
      handleLocalHangup();
    }
  };

  const handleDeclineCall = async () => {
    if (!callId || !activeCall) return;

    await set(ref(rtdb, `calls/${callId}/participants/${currentUserId}/status`), 'declined');
    await set(ref(rtdb, `user_calls/${currentUserId}/active`), null);

    if (!activeCall.meta.is_group) {
      await remove(ref(rtdb, `calls/${callId}`));
      await set(ref(rtdb, `user_calls/${activeCall.meta.caller_id}/active`), null);
    }

    handleLocalHangup();
  };

  const handleHangupCall = async () => {
    const cid = callIdRef.current || callId;
    const callObj = activeCallRef.current || activeCall;
    if (!cid || !callObj) {
      handleLocalHangup();
      return;
    }

    try {
      await set(ref(rtdb, `user_calls/${currentUserId}/active`), null);

      if (callObj.meta.caller_id === currentUserId) {
        await set(ref(rtdb, `calls/${cid}/status`), 'ended');
        setTimeout(async () => {
          try {
            await remove(ref(rtdb, `calls/${cid}`));
            const pKeys = Object.keys(callObj.participants || {});
            for (const pk of pKeys) {
              await set(ref(rtdb, `user_calls/${pk}/active`), null);
            }
          } catch (e) {}
        }, 800);
      } else {
        await set(ref(rtdb, `calls/${cid}/participants/${currentUserId}/status`), 'declined');
      }
    } catch (e) {
      console.warn("Hangup DB updates error:", e);
    }

    handleLocalHangup();
  };

  const toggleMute = async () => {
    if (rtkRoomRef.current) {
      try {
        if (isMuted) {
          await rtkRoomRef.current.self.enableAudio();
          setIsMuted(false);
        } else {
          await rtkRoomRef.current.self.disableAudio();
          setIsMuted(true);
        }
      } catch (e) {
        console.warn("Mute toggle failed:", e);
      }
    }
  };

  const toggleVideo = async () => {
    if (rtkRoomRef.current) {
      try {
        if (isVideoDisabled) {
          await rtkRoomRef.current.self.enableVideo();
          setIsVideoDisabled(false);
        } else {
          await rtkRoomRef.current.self.disableVideo();
          setIsVideoDisabled(true);
        }

        const cid = callIdRef.current || callId;
        if (cid) {
          const isCaller = activeCallRef.current?.meta?.caller_id === currentUserId;
          if (isCaller) {
            set(ref(rtdb, `calls/${cid}/caller_video_disabled`), !isVideoDisabled);
          } else {
            set(ref(rtdb, `calls/${cid}/participants/${currentUserId}/video_disabled`), !isVideoDisabled);
          }
        }
      } catch (e) {
        console.warn("Video toggle failed:", e);
      }
    }
  };

  const formatTime = (secs: number) => {
    const min = Math.floor(secs / 60);
    const sec = secs % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  if (callStatus === 'idle' || !activeCall) return null;

  const isRingingIncoming = callStatus === 'ringing_incoming';
  const isRingingOutgoing = callStatus === 'ringing_outgoing';
  const isConnected = callStatus === 'connected';

  const isCaller = activeCall.meta.caller_id === currentUserId;
  let displayName = '';
  let avatarUrl = null;

  if (activeCall.meta.is_group) {
    displayName = activeCall.meta.room_name || 'Group Call';
    avatarUrl = activeCall.meta.room_avatar;
  } else {
    if (isCaller) {
      displayName = activeCall.meta.room_name;
      avatarUrl = activeCall.meta.room_avatar;
    } else {
      displayName = activeCall.meta.caller_name;
      avatarUrl = activeCall.meta.caller_avatar;
    }
  }

  const handleScreenTap = () => {
    if (callStatus === 'connected' && activeCall?.meta?.type === 'video') {
      setShowControls(prev => !prev);
    }
  };

  const isGroupCall = activeCall.meta.is_group;

  const otherPartyId = isCaller
    ? Object.keys(activeCall.participants || {})[0]
    : activeCall.meta.caller_id;
  const remoteStream1on1 = remoteStreams[otherPartyId] || null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleScreenTap}
        className="fixed inset-0 z-[99999] bg-black text-white flex flex-col justify-between overflow-hidden select-none max-w-lg mx-auto md:border-x md:border-white/15 font-sans cursor-pointer"
      >
        {/* Play 1-on-1 background audio stream */}
        {isConnected && activeCall?.meta?.type === 'audio' && !isGroupCall && remoteStream1on1 && (
          <audio
            ref={el => {
              if (el && remoteStream1on1) el.srcObject = remoteStream1on1;
            }}
            autoPlay
            playsInline
            style={{ display: 'none' }}
          />
        )}

        {/* Play group/mesh audio streams in background */}
        {isConnected && isGroupCall && Object.keys(remoteStreams).map(uid => {
          const stream = remoteStreams[uid];
          return (
            <audio
              key={`audio-group-${uid}`}
              ref={el => {
                if (el && stream) el.srcObject = stream;
              }}
              autoPlay
              playsInline
              style={{ display: 'none' }}
            />
          );
        })}

        {/* Connect Active Video overlay panels */}
        {isConnected && activeCall?.meta?.type === 'video' && (
          <div className="absolute inset-0 bg-zinc-950 z-0 flex flex-col items-center justify-center pointer-events-none">
            {isGroupCall ? (
              <GroupVideoGrid
                remoteStreams={remoteStreams}
                localStream={localStream}
                currentUserId={currentUserId!}
                isVideoDisabled={isVideoDisabled}
                activeCall={activeCall}
                currentProfile={currentProfile}
              />
            ) : (
              // Enhanced 1-on-1 full screen absolute video matching user requests
              <div className="absolute inset-0 w-full h-full object-cover">
                {remoteStream1on1 || (localStream && !isVideoDisabled) ? (
                  <VideoPlayer
                    stream={remoteStream1on1 || localStream}
                    muted={!remoteStream1on1}
                    className="absolute inset-0 w-full h-full object-cover rounded-none"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 absolute inset-0 justify-center">
                    <div className="w-24 h-24 rounded-full overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center shadow-lg">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <Users className="w-10 h-10 text-white/50" />
                      )}
                    </div>
                    <p className="text-white/40 text-xs font-mono tracking-widest uppercase animate-pulse">CONNECTING MEDIA...</p>
                  </div>
                )}

                {/* Picture in picture local user feeds layout overlay */}
                {remoteStream1on1 && localStream && !isVideoDisabled && (
                  <div className="absolute top-20 right-4 w-28 h-40 rounded-2xl overflow-hidden border border-white/20 shadow-2xl z-10 bg-black/50 pointer-events-auto">
                    <VideoPlayer
                      stream={localStream}
                      muted={true}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Header Elements */}
        <AnimatePresence>
          {(!isConnected || activeCall?.meta?.type !== 'video') ? (
            <motion.div
              key="centered-header"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="pt-[calc(2.5rem+env(safe-area-inset-top))] px-6 flex flex-col items-center text-center z-10 shrink-0 pointer-events-none"
            >
              <div className="w-28 h-28 rounded-full overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center relative shadow-[0_0_40px_rgba(0,0,0,0.8)]">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-900 border border-white/5">
                    {isGroupCall ? (
                      <Users className="w-12 h-12 text-white/60" />
                    ) : (
                      <span className="text-3xl font-bold text-white/50 uppercase">
                        {displayName?.[0] || '?'}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <h1 className="text-3xl font-bold tracking-tight mt-6 text-white drop-shadow-md">
                {displayName}
              </h1>

              <p className="text-xs font-mono tracking-widest text-[#00E676] uppercase mt-3 py-1 px-3 bg-white/5 border border-white/10 rounded-full">
                {activeCall?.meta?.type === 'video' ? '🎥 Video Call' : '📞 Audio Call'}
              </p>

              <p className="text-[#a0a0a0] text-sm mt-3.5 tracking-wider font-medium">
                {isRingingIncoming && "INCOMING CALL..."}
                {isRingingOutgoing && "RINGING..."}
                {isConnected && `ACTIVE — ${formatTime(callDuration)}`}
              </p>

              {isGroupCall && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {Object.keys(activeCall.participants || {}).map(uid => {
                    const p = activeCall.participants[uid];
                    return (
                      <div key={uid} className="flex items-center gap-1.5 px-3 py-1 bg-white/[0.04] border border-white/5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        <span className="text-[10px] font-medium text-white/60 truncate max-w-[80px]">
                          {(uid === currentUserId) ? 'Me' : p.name || `User (${uid.slice(0, 4)})`} — <span className="text-[9px] uppercase tracking-wider font-mono text-white/40">{p.status}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          ) : (
            showControls && (
              <motion.div
                key="compact-video-header"
                initial={{ opacity: 0, y: -40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -40 }}
                transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                className="absolute top-0 left-0 right-0 pt-[calc(1.5rem+env(safe-area-inset-top))] px-6 pb-6 bg-gradient-to-b from-black/80 via-black/40 to-transparent z-20 flex items-center gap-3.5 text-left pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-12 h-12 rounded-full overflow-hidden border border-white/10 bg-white/5 shrink-0 shadow-lg">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-zinc-900 border border-white/5">
                      {isGroupCall ? (
                        <Users className="w-5 h-5 text-white/60" />
                      ) : (
                        <span className="text-lg font-bold text-white/50 uppercase">{displayName?.[0] || '?'}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <h1 className="text-lg font-bold tracking-tight text-white drop-shadow-md truncate">
                    {displayName}
                  </h1>
                  <p className="text-white/60 text-xs font-medium mt-0.5 tracking-wider">
                    {formatTime(callDuration)}
                  </p>
                </div>
              </motion.div>
            )
          )}
        </AnimatePresence>

        {/* Audio controls */}
        {isConnected && activeCall?.meta?.type === 'audio' && (
          <div className="flex justify-center gap-6 z-10 pb-4 shrink-0 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={toggleMute}
              className={`p-4 rounded-full border transition-all active:scale-90 ${isMuted ? 'bg-red-600 border-red-500 text-white shadow-lg' : 'bg-white/5 border-white/10 text-white'}`}
            >
              {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>
          </div>
        )}

        {/* sliding video overlay controls */}
        <AnimatePresence>
          {isConnected && activeCall?.meta?.type === 'video' && showControls && (
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="absolute bottom-0 left-0 right-0 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-8 px-8 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-20 flex justify-center items-center gap-8 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={toggleVideo}
                className={`w-14 h-14 rounded-full border border-white/10 flex items-center justify-center transition-all ${isVideoDisabled ? 'bg-red-600/90 border-red-500 text-white shadow-lg' : 'bg-white/10 text-white backdrop-blur-md'}`}
              >
                {isVideoDisabled ? <VideoOff size={22} /> : <Video size={22} />}
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={handleHangupCall}
                className="w-18 h-18 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl border border-white/5 cursor-pointer"
              >
                <Phone size={30} className="rotate-[135deg]" />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={toggleMute}
                className={`w-14 h-14 rounded-full border border-white/10 flex items-center justify-center transition-all ${isMuted ? 'bg-red-600/90 border-red-500 text-white shadow-lg' : 'bg-white/10 text-white backdrop-blur-md'}`}
              >
                {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Centered actions */}
        {(!isConnected || activeCall?.meta?.type !== 'video') && (
          <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] px-8 flex justify-center items-center gap-12 z-10 shrink-0 relative pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <AnimatePresence mode="wait">
              {isRingingIncoming ? (
                <motion.div
                  key="incoming-actions"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 30 }}
                  className="flex items-center justify-between w-full max-w-[300px] px-2"
                >
                  <div className="flex flex-col items-center gap-3">
                    <motion.button
                      whileTap={{ scale: 0.88 }}
                      onClick={handleDeclineCall}
                      className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl border border-white/5 cursor-pointer"
                    >
                      <Phone size={32} className="rotate-[135deg] translate-y-[1px]" />
                    </motion.button>
                    <span className="text-xs font-semibold text-white/50 tracking-wider">Decline</span>
                  </div>

                  <div className="flex flex-col items-center gap-3">
                    <motion.button
                      whileTap={{ scale: 0.88 }}
                      onClick={handleAcceptCall}
                      className="w-20 h-20 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center text-white shadow-xl border border-white/5 cursor-pointer"
                    >
                      <Phone size={32} className="translate-y-[1px]" />
                    </motion.button>
                    <span className="text-xs font-semibold text-white/50 tracking-wider">Accept</span>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="connected-actions"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex flex-col items-center gap-2.5"
                >
                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    onClick={handleHangupCall}
                    className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl border border-white/5 cursor-pointer"
                  >
                    <Phone size={32} className="rotate-[135deg]" />
                  </motion.button>
                  <span className="text-xs font-semibold text-white/50 tracking-wider">End</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
