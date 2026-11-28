import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Phone, Video, VideoOff, Mic, MicOff, Users, Volume2, ArrowLeft } from 'lucide-react';
import {
  Room,
  RoomEvent,
  Track,
  AudioPresets,
  VideoPresets,
  RemoteAudioTrack,
  RemoteTrack,
  supportsAudioOutputSelection,
} from 'livekit-client';
import { supabase } from '@/src/lib/supabase';
import { rtdb } from '@/src/lib/firebase';
import { ref, onValue, set, get, remove, onDisconnect } from 'firebase/database';
import { useStore } from '@/src/store/useStore';
import { CallMeta, Participant, CallNode } from './callTypes';
import { synth } from './SoundSynthesizer';
import { VideoPlayer } from './VideoPlayer';
import { GroupVideoGrid } from './GroupVideoGrid';
import { MinimizedVideoPip } from './MinimizedVideoPip';
import { getLiveKitCallToken, startCallRinger } from './CallsApi';

interface AttachedAudioProps {
  track: RemoteAudioTrack;
  sinkId: string;
  volume: number;
}

const RemoteAudioElement: React.FC<AttachedAudioProps> = ({ track, sinkId, volume }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track) return;
    track.attach(el);
    el.volume = volume;
    el.play().catch(() => {});
    return () => {
      try {
        track.detach(el);
      } catch (_) {}
    };
  }, [track]);

  useEffect(() => {
    const el = audioRef.current as any;
    if (!el) return;
    el.volume = volume;
    if (sinkId && supportsAudioOutputSelection() && typeof el.setSinkId === 'function') {
      el.setSinkId(sinkId).catch(() => {});
    }
  }, [sinkId, volume]);

  return <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />;
};

export function CallsManager() {
  const currentUserId = useStore(state => state.profile?.id);
  const currentProfile = useStore(state => state.profile);
  const setMinimizedAudioCall = useStore(state => state.setMinimizedAudioCall);

  // States
  const [activeCall, setActiveCall] = useState<CallNode | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState<'idle' | 'ringing_outgoing' | 'ringing_incoming' | 'connected' | 'ended'>('idle');
  const [showControls, setShowControls] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);

  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Record<string, MediaStream>>({});
  const [remoteAudioTracks, setRemoteAudioTracks] = useState<Array<{ key: string; track: RemoteAudioTrack }>>([]);
  const [canPlaybackAudio, setCanPlaybackAudio] = useState(true);

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [audioSinkId, setAudioSinkId] = useState('');
  const [callDuration, setCallDuration] = useState(0);

  // Refs for clean async closures & teardown
  const roomRef = useRef<Room | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCallUnsubRef = useRef<(() => void) | null>(null);
  const initiatedAtRef = useRef<string | null>(null);
  const isCleaningUpRef = useRef(false);
  const isJoiningRoomRef = useRef(false);
  const autoAnswerCallIdRef = useRef<string | null>(null);
  const pendingIntentRef = useRef<{ type: 'open' | 'decline'; callId: string; autoAnswer?: boolean } | null>(null);
  const lastAppliedModeRef = useRef<'audio' | 'video' | null>(null);

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

  const callDurationRef = useRef(callDuration);
  useEffect(() => {
    callDurationRef.current = callDuration;
  }, [callDuration]);

  // Configure hardware/browser audio routing (phone-to-ear default for audio calls, speaker for video calls)
  const applyAudioOutputRoute = useCallback(async (speakerEnabled: boolean, roomInstance?: Room | null) => {
    setIsSpeakerOn(speakerEnabled);

    // Hint iOS Safari WebKit AudioSession:
    // - 'auto' lets WebRTC getUserMedia stay in natural voice handset/earpiece mode (respecting ear proximity)
    // - 'play-and-record' biases iOS AVAudioSession toward speaker/communication output
    try {
      const navAny = navigator as any;
      if (navAny?.audioSession) {
        navAny.audioSession.type = speakerEnabled ? 'play-and-record' : 'auto';
      }
    } catch (_) {}

    // Select hardware audio output device using LiveKit standard device API where setSinkId is supported
    if (supportsAudioOutputSelection()) {
      try {
        const outputs = await Room.getLocalDevices('audiooutput');
        if (outputs.length > 0) {
          let chosen: MediaDeviceInfo | undefined;
          if (speakerEnabled) {
            chosen = outputs.find(d => /speaker|loud|built-in/i.test(d.label))
              || outputs.find(d => d.deviceId !== 'default' && d.deviceId !== 'communications');
          } else {
            chosen = outputs.find(d => /earpiece|receiver|handset|communications/i.test(d.label))
              || outputs.find(d => d.deviceId === 'default');
          }
          const nextSinkId = chosen?.deviceId || '';
          setAudioSinkId(nextSinkId);

          const targetRoom = roomInstance || roomRef.current;
          if (targetRoom && nextSinkId) {
            await targetRoom.switchActiveDevice('audiooutput', nextSinkId).catch(() => {});
          }
        }
      } catch (_) {}
    }
  }, []);

  // Call duration timer
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
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [callStatus]);

  // Release ringing AudioContext immediately on connect so iOS WebRTC uses earpiece cleanly by default
  useEffect(() => {
    if (callStatus === 'connected' && activeCall) {
      const initialMode = activeCall.mode || activeCall.meta.type;
      synth.releaseAudioContext();
      const t = setTimeout(() => {
        applyAudioOutputRoute(initialMode === 'video');
      }, 150);
      return () => clearTimeout(t);
    }
  }, [callStatus, activeCall, applyAudioOutputRoute]);

  // Sync minimized audio call top banner across the whole app
  const activeMode: 'audio' | 'video' = activeCall ? (activeCall.mode || activeCall.meta.type) : 'audio';
  useEffect(() => {
    if (callStatus === 'connected' && isMinimized && activeCall && activeMode === 'audio') {
      const isCaller = activeCall.meta.caller_id === currentUserId;
      const bannerName = activeCall.meta.is_group
        ? (activeCall.meta.room_name || 'Group Call')
        : (isCaller ? activeCall.meta.room_name : activeCall.meta.caller_name);
      const bannerAvatar = activeCall.meta.is_group
        ? activeCall.meta.room_avatar
        : (isCaller ? activeCall.meta.room_avatar : activeCall.meta.caller_avatar);

      setMinimizedAudioCall({
        displayName: bannerName || 'Audio Call',
        avatarUrl: bannerAvatar || null,
        isGroup: activeCall.meta.is_group,
        duration: callDuration,
      });
    } else {
      setMinimizedAudioCall(null);
    }
  }, [callStatus, isMinimized, activeCall, activeMode, callDuration, currentUserId, setMinimizedAudioCall]);

  // Clear banner on unmount
  useEffect(() => {
    return () => setMinimizedAudioCall(null);
  }, [setMinimizedAudioCall]);

  // Listen for banner tap to expand minimized call
  useEffect(() => {
    const handleExpand = () => {
      setIsMinimized(false);
      setShowControls(true);
    };
    window.addEventListener('expandActiveCall', handleExpand);
    return () => window.removeEventListener('expandActiveCall', handleExpand);
  }, []);

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
        console.warn('Supabase archive insert warning:', error.message);
      }
    } catch (err) {
      console.warn('Could not insert call record in Supabase:', err);
    }
  };

  const syncMediaFromRoom = useCallback((room: Room | null) => {
    if (!room) {
      setLocalVideoStream(null);
      setRemoteVideoStreams({});
      setRemoteAudioTracks([]);
      return;
    }

    // 1. Local video stream (camera only — never play local mic audio back)
    let nextLocalVideo: MediaStream | null = null;
    room.localParticipant.videoTrackPublications.forEach((pub) => {
      if (pub.track?.mediaStreamTrack && !pub.isMuted) {
        nextLocalVideo = new MediaStream([pub.track.mediaStreamTrack]);
      }
    });
    setLocalVideoStream(nextLocalVideo);

    // 2. Remote video & audio tracks keyed cleanly by remoteParticipant.identity (which is userId)
    const nextRemoteVideos: Record<string, MediaStream> = {};
    const nextRemoteAudios: Array<{ key: string; track: RemoteAudioTrack }> = [];

    room.remoteParticipants.forEach((participant) => {
      const uid = participant.identity;

      participant.videoTrackPublications.forEach((pub) => {
        if (pub.isSubscribed && pub.track?.mediaStreamTrack && !pub.isMuted) {
          nextRemoteVideos[uid] = new MediaStream([pub.track.mediaStreamTrack]);
        }
      });

      participant.audioTrackPublications.forEach((pub) => {
        if (pub.isSubscribed && pub.track && pub.track.kind === Track.Kind.Audio) {
          nextRemoteAudios.push({
            key: `${uid}_${pub.trackSid}`,
            track: pub.track as RemoteAudioTrack,
          });
        }
      });
    });

    setRemoteVideoStreams(nextRemoteVideos);
    setRemoteAudioTracks(nextRemoteAudios);
    setCanPlaybackAudio(room.canPlaybackAudio);
  }, []);

  const cleanMediaAndRTC = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }

    if (roomRef.current) {
      try {
        roomRef.current.removeAllListeners();
        roomRef.current.disconnect(true);
      } catch (_) {}
      roomRef.current = null;
    }

    // Reset Safari iOS audio session cleanly when leaving call
    try {
      const navAny = navigator as any;
      if (navAny?.audioSession) {
        navAny.audioSession.type = 'playback';
        setTimeout(() => {
          try {
            navAny.audioSession.type = 'auto';
          } catch (_) {}
        }, 60);
      }
    } catch (_) {}

    setLocalVideoStream(null);
    setRemoteVideoStreams({});
    setRemoteAudioTracks([]);
    setCanPlaybackAudio(true);
    setIsMuted(false);
    setIsVideoDisabled(false);
    setIsSpeakerOn(false);
    setAudioSinkId('');
    setIsMinimized(false);
    setMinimizedAudioCall(null);
    lastAppliedModeRef.current = null;
    isJoiningRoomRef.current = false;
    synth.stopRinging();
  }, [setMinimizedAudioCall]);

  const handleLocalHangup = useCallback(async (isSilent = false) => {
    if (isCleaningUpRef.current) return;
    if (callStatusRef.current === 'idle' && !activeCallRef.current && !roomRef.current) {
      synth.stopRinging();
      return;
    }

    isCleaningUpRef.current = true;
    try {
      const cid = callIdRef.current;
      const callObj = activeCallRef.current;
      const wasConnected = callStatusRef.current === 'connected';
      const durationToArchive = callDurationRef.current;

      if (activeCallUnsubRef.current) {
        activeCallUnsubRef.current();
        activeCallUnsubRef.current = null;
      }

      if (cid && callObj && wasConnected) {
        const initiatedAt = initiatedAtRef.current || new Date().toISOString();
        const terminatedAt = new Date().toISOString();
        const host = callObj.meta.caller_id;
        const peer = Object.keys(callObj.participants || {})[0] || '';
        await archiveCallToSupabase(cid, host, peer, initiatedAt, terminatedAt, durationToArchive);
      }

      cleanMediaAndRTC();
      setCallStatus('idle');
      setActiveCall(null);
      setCallId(null);
      initiatedAtRef.current = null;
      if (!isSilent) synth.playHangup();
    } finally {
      isCleaningUpRef.current = false;
    }
  }, [cleanMediaAndRTC]);

  const applyLocalMediaForMode = useCallback(async (targetMode: 'audio' | 'video') => {
    const room = roomRef.current;
    const cid = callIdRef.current;
    lastAppliedModeRef.current = targetMode;

    if (!room) return;
    try {
      const enableCam = targetMode === 'video';
      await room.localParticipant.setCameraEnabled(enableCam);
      setIsVideoDisabled(!enableCam);
      syncMediaFromRoom(room);

      if (cid && currentUserId) {
        const isCaller = activeCallRef.current?.meta?.caller_id === currentUserId;
        if (isCaller) {
          set(ref(rtdb, `calls/${cid}/caller_video_disabled`), !enableCam).catch(() => {});
        } else {
          set(ref(rtdb, `calls/${cid}/participants/${currentUserId}/video_disabled`), !enableCam).catch(() => {});
        }
      }
      applyAudioOutputRoute(enableCam, room);
    } catch (e) {
      console.warn('Error applying call mode media:', e);
    }
  }, [applyAudioOutputRoute, currentUserId, syncMediaFromRoom]);

  const switchCallMode = async (targetMode: 'audio' | 'video') => {
    const cid = callIdRef.current || callId;
    if (!cid || !rtdb) return;

    setActiveCall(prev => (prev ? { ...prev, mode: targetMode } : prev));
    try {
      await set(ref(rtdb, `calls/${cid}/mode`), targetMode);
    } catch (e) {
      console.warn('Failed updating call mode in RTDB:', e);
    }
    await applyLocalMediaForMode(targetMode);
  };

  const joinLiveKitCall = useCallback(async (roomName: string, callType: 'audio' | 'video', isGroup = false) => {
    if (isJoiningRoomRef.current) return;
    if (roomRef.current && roomRef.current.name === roomName) return;

    isJoiningRoomRef.current = true;
    try {
      if (roomRef.current) {
        try {
          roomRef.current.removeAllListeners();
          await roomRef.current.disconnect(true);
        } catch (_) {}
        roomRef.current = null;
      }

      try {
        const navAny = navigator as any;
        if (navAny?.audioSession) {
          navAny.audioSession.type = callType === 'video' ? 'play-and-record' : 'auto';
        }
      } catch (_) {}

      const myName = currentProfile?.full_name || currentProfile?.username || 'Socium User';
      const { token, wsUrl } = await getLiveKitCallToken(roomName, myName);

      const room = new Room({
        // Disable adaptiveStream on 1:1/small calls to prevent ResizeObserver downshift & keyframe warmup delays
        adaptiveStream: false,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          latency: 0.01,
        },
        videoCaptureDefaults: {
          resolution: VideoPresets.h540.resolution,
          facingMode: 'user',
        },
        publishDefaults: {
          audioPreset: AudioPresets.speech,
          dtx: false,
          red: true,
          simulcast: isGroup,
          videoEncoding: {
            maxBitrate: 900_000,
            maxFramerate: 30,
            priority: 'high',
          },
          degradationPreference: 'maintain-framerate',
        },
      });

      roomRef.current = room;

      const handleUpdate = () => syncMediaFromRoom(room);
      const handleTrackSubscribed = (track: RemoteTrack) => {
        // Minimize browser WebRTC NetEQ jitter-buffer delay (20ms audio, 30ms video)
        try {
          if (typeof track.setPlayoutDelay === 'function') {
            track.setPlayoutDelay(track.kind === Track.Kind.Audio ? 0.02 : 0.03);
          }
        } catch (_) {}
        syncMediaFromRoom(room);
      };

      room
        .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
        .on(RoomEvent.TrackUnsubscribed, handleUpdate)
        .on(RoomEvent.TrackMuted, handleUpdate)
        .on(RoomEvent.TrackUnmuted, handleUpdate)
        .on(RoomEvent.LocalTrackPublished, handleUpdate)
        .on(RoomEvent.LocalTrackUnpublished, handleUpdate)
        .on(RoomEvent.ParticipantConnected, handleUpdate)
        .on(RoomEvent.ParticipantDisconnected, handleUpdate)
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          setCanPlaybackAudio(room.canPlaybackAudio);
        })
        .on(RoomEvent.Disconnected, () => {
          if (callStatusRef.current === 'connected') {
            handleLocalHangup(true);
          }
        });

      await room.connect(wsUrl, token);

      room.startAudio().catch(() => {
        setCanPlaybackAudio(room.canPlaybackAudio);
      });

      await room.localParticipant.setMicrophoneEnabled(true);
      if (callType === 'video') {
        await room.localParticipant.setCameraEnabled(true);
        setIsVideoDisabled(false);
        await applyAudioOutputRoute(true, room);
      } else {
        setIsVideoDisabled(true);
        await applyAudioOutputRoute(false, room);
      }

      lastAppliedModeRef.current = callType;
      initiatedAtRef.current = new Date().toISOString();
      syncMediaFromRoom(room);
    } catch (err) {
      console.error('LiveKit room join failed:', err);
      throw err;
    } finally {
      isJoiningRoomRef.current = false;
    }
  }, [applyAudioOutputRoute, currentProfile, handleLocalHangup, syncMediaFromRoom]);

  const acceptIncomingCall = useCallback(async (targetCallId: string, targetCall: CallNode) => {
    if (!currentUserId || !rtdb) return;

    synth.releaseAudioContext();
    setIsMuted(false);
    const liveMode = targetCall.mode || targetCall.meta.type;
    setIsVideoDisabled(liveMode !== 'video');
    setIsMinimized(false);

    try {
      const roomName = targetCall.meetingId || targetCallId;
      await Promise.all([
        set(ref(rtdb, `calls/${targetCallId}/participants/${currentUserId}/status`), 'accepted'),
        set(ref(rtdb, `calls/${targetCallId}/status`), 'accepted'),
        joinLiveKitCall(roomName, liveMode, Boolean(targetCall.meta?.is_group)),
      ]);
      setCallStatus('connected');
    } catch (err) {
      console.error('Failed to accept LiveKit call:', err);
      handleLocalHangup();
    }
  }, [currentUserId, handleLocalHangup, joinLiveKitCall]);

  const declineCallById = useCallback(async (targetCallId: string, targetCall: CallNode | null) => {
    if (!currentUserId || !rtdb) return;

    try {
      await set(ref(rtdb, `calls/${targetCallId}/participants/${currentUserId}/status`), 'declined');
      await set(ref(rtdb, `user_calls/${currentUserId}/active`), null);

      let meta = targetCall?.meta;
      if (!meta) {
        const snap = await get(ref(rtdb, `calls/${targetCallId}/meta`));
        meta = snap.val();
      }

      if (meta && !meta.is_group) {
        await set(ref(rtdb, `calls/${targetCallId}/status`), 'ended');
        await set(ref(rtdb, `user_calls/${meta.caller_id}/active`), null);
        setTimeout(() => {
          remove(ref(rtdb, `calls/${targetCallId}`)).catch(() => {});
        }, 600);
      }
    } catch (err) {
      console.warn('Error updating declined call state:', err);
    }

    handleLocalHangup();
  }, [currentUserId, handleLocalHangup]);

  // Core RTDB Orchestration + Window Call Event Listeners
  useEffect(() => {
    if (!currentUserId || !rtdb) return;

    const subscribeToCallNode = (targetCallId: string) => {
      if (activeCallUnsubRef.current) {
        activeCallUnsubRef.current();
        activeCallUnsubRef.current = null;
      }

      const callNodeRef = ref(rtdb, `calls/${targetCallId}`);
      const unsub = onValue(callNodeRef, (callSnap) => {
        const callData = callSnap.val() as CallNode | null;
        if (!callData || !callData.meta) {
          handleLocalHangup(true);
          return;
        }

        setActiveCall(callData);

        if (callData.status === 'ended') {
          handleLocalHangup(callStatusRef.current === 'idle');
          return;
        }

        // Sync live mode switches (audio <-> video) initiated by either side
        const nextMode = callData.mode || callData.meta.type;
        if (
          callStatusRef.current === 'connected' &&
          roomRef.current &&
          lastAppliedModeRef.current &&
          lastAppliedModeRef.current !== nextMode
        ) {
          applyLocalMediaForMode(nextMode);
        }

        const isCaller = callData.meta.caller_id === currentUserId;

        if (isCaller) {
          const recipientUids = Object.keys(callData.participants || {});
          const hasAnyPendingOrActive = recipientUids.some((uid) => {
            const st = callData.participants[uid]?.status;
            return st === 'ringing' || st === 'accepted';
          });

          if (recipientUids.length > 0 && !hasAnyPendingOrActive) {
            set(ref(rtdb, `calls/${targetCallId}/status`), 'ended').catch(() => {});
            set(ref(rtdb, `user_calls/${currentUserId}/active`), null).catch(() => {});
            setTimeout(() => remove(ref(rtdb, `calls/${targetCallId}`)).catch(() => {}), 600);
            handleLocalHangup();
            return;
          }

          if (!callData.meta.is_group) {
            const peerUid = recipientUids[0];
            if (peerUid && callData.participants[peerUid]?.status === 'declined') {
              set(ref(rtdb, `calls/${targetCallId}/status`), 'ended').catch(() => {});
              set(ref(rtdb, `user_calls/${currentUserId}/active`), null).catch(() => {});
              setTimeout(() => remove(ref(rtdb, `calls/${targetCallId}`)).catch(() => {}), 600);
              handleLocalHangup();
              return;
            }
          }

          const acceptedUser = recipientUids.find((uid) => callData.participants[uid]?.status === 'accepted');
          if (acceptedUser && callStatusRef.current !== 'connected') {
            if (ringTimeoutRef.current) {
              clearTimeout(ringTimeoutRef.current);
              ringTimeoutRef.current = null;
            }
            setCallStatus('connected');
            synth.releaseAudioContext();
          }
        } else {
          // Receiver branch
          onDisconnect(ref(rtdb, `calls/${targetCallId}/participants/${currentUserId}/status`)).set('declined');
          onDisconnect(ref(rtdb, `user_calls/${currentUserId}/active`)).set(null);

          const selfPart = callData.participants?.[currentUserId];
          if (!selfPart) return;

          if (selfPart.status === 'ringing') {
            if (autoAnswerCallIdRef.current === targetCallId) {
              autoAnswerCallIdRef.current = null;
              acceptIncomingCall(targetCallId, callData);
            } else if (callStatusRef.current !== 'ringing_incoming' && callStatusRef.current !== 'connected') {
              setCallStatus('ringing_incoming');
              synth.startRinging();
            }
          } else if (selfPart.status === 'accepted') {
            synth.stopRinging();
            if (callStatusRef.current !== 'connected') {
              setCallStatus('connected');
            }
            if (!roomRef.current && !isJoiningRoomRef.current) {
              joinLiveKitCall(callData.meetingId || targetCallId, nextMode, Boolean(callData.meta?.is_group)).catch(() => handleLocalHangup());
            }
          } else if (selfPart.status === 'declined') {
            handleLocalHangup();
          }
        }
      });

      activeCallUnsubRef.current = unsub;
    };

    const userCallActiveRef = ref(rtdb, `user_calls/${currentUserId}/active`);
    const unsubUserCall = onValue(userCallActiveRef, (snapshot) => {
      const incomingCallId = snapshot.val() as string | null;
      if (incomingCallId) {
        if (callIdRef.current !== incomingCallId || !activeCallUnsubRef.current) {
          setCallId(incomingCallId);
          callIdRef.current = incomingCallId;
          subscribeToCallNode(incomingCallId);
        }
      } else {
        handleLocalHangup(true);
      }
    });

    const handleInitiateCallEvent = async (e: any) => {
      const { chat, type } = e.detail || {};
      if (!chat) return;
      if (callStatusRef.current !== 'idle') return;

      setIsMuted(false);
      setIsMinimized(false);
      setShowControls(true);
      setIsVideoDisabled(type !== 'video');
      setIsSpeakerOn(type === 'video');

      const newCallId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      setCallId(newCallId);
      callIdRef.current = newCallId;
      setCallStatus('ringing_outgoing');
      callStatusRef.current = 'ringing_outgoing';
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
        is_group: Boolean(chat.isGroup),
        type: type as 'audio' | 'video',
        room_name: roomName,
        room_avatar: roomAvatar
      };

      const recipients: string[] = chat.isGroup
        ? (chat.participants || []).map((p: any) => p.id || p.user_id).filter((uid: string) => uid && uid !== currentUserId)
        : [chat.id];

      const participants: Record<string, Participant> = {};
      for (const rid of recipients) {
        let pName = 'User';
        let pAvatar: string | null = null;
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

      const freshCallNode: CallNode = {
        status: 'dialing',
        mode: type as 'audio' | 'video',
        meetingId: newCallId,
        meta,
        participants,
        timestamp: Date.now()
      };

      setActiveCall(freshCallNode);
      activeCallRef.current = freshCallNode;

      try {
        const callRefNode = ref(rtdb, `calls/${newCallId}`);
        const selfActiveCallRef = ref(rtdb, `user_calls/${currentUserId}/active`);

        const rtdbWritePromise = (async () => {
          await Promise.all([
            set(callRefNode, freshCallNode),
            set(selfActiveCallRef, newCallId),
            ...recipients.map((rid) => set(ref(rtdb, `user_calls/${rid}/active`), newCallId)),
          ]);
          onDisconnect(callRefNode).remove();
          onDisconnect(selfActiveCallRef).set(null);
          for (const rid of recipients) {
            onDisconnect(ref(rtdb, `user_calls/${rid}/active`)).set(null);
          }
          subscribeToCallNode(newCallId);
        })();

        await Promise.all([
          rtdbWritePromise,
          joinLiveKitCall(newCallId, type as 'audio' | 'video', Boolean(chat.isGroup)),
        ]);

        // Insert initial call bubble in chat ONCE (preserves initial call type regardless of later switches)
        supabase.from('messages').insert({
          sender_id: currentUserId,
          receiver_id: chat.isGroup ? null : chat.id,
          group_chat_id: chat.isGroup ? chat.id : null,
          content: type === 'audio' ? '📞 Audio Call' : '🎥 Video Call',
          media_type: type === 'audio' ? 'call_audio' : 'call_video'
        }).then(({ error }) => {
          if (error) console.warn('Failed to insert call bubble:', error.message);
        });

        startCallRinger({
          callId: newCallId,
          recipientIds: recipients,
          callerName,
          callType: type as 'audio' | 'video',
          isGroup: Boolean(chat.isGroup),
        });

        // Auto-end unanswered outgoing calls after 38 seconds
        ringTimeoutRef.current = setTimeout(async () => {
          if (callIdRef.current === newCallId && callStatusRef.current === 'ringing_outgoing') {
            try {
              await set(ref(rtdb, `calls/${newCallId}/status`), 'ended');
              await set(ref(rtdb, `user_calls/${currentUserId}/active`), null);
              for (const rid of recipients) {
                await set(ref(rtdb, `user_calls/${rid}/active`), null);
              }
              setTimeout(() => remove(ref(rtdb, `calls/${newCallId}`)).catch(() => {}), 500);
            } catch (_) {}
            handleLocalHangup();
          }
        }, 38000);
      } catch (err) {
        console.error('Failed to establish outgoing LiveKit call:', err);
        try {
          await set(ref(rtdb, `user_calls/${currentUserId}/active`), null);
          for (const rid of recipients) {
            await set(ref(rtdb, `user_calls/${rid}/active`), null);
          }
          await remove(ref(rtdb, `calls/${newCallId}`));
        } catch (_) {}
        handleLocalHangup();
      }
    };

    const handleOpenIncomingCallEvent = async (e: any) => {
      const { callId: targetCallId, autoAnswer } = e.detail || {};
      if (!targetCallId) return;

      if (autoAnswer) {
        autoAnswerCallIdRef.current = targetCallId;
      }

      try {
        const snap = await get(ref(rtdb, `calls/${targetCallId}`));
        const callData = snap.val() as CallNode | null;
        if (!callData || callData.status === 'ended') {
          autoAnswerCallIdRef.current = null;
          return;
        }

        const selfStatus = callData.participants?.[currentUserId]?.status;
        if (selfStatus === 'declined') {
          autoAnswerCallIdRef.current = null;
          return;
        }

        setCallId(targetCallId);
        callIdRef.current = targetCallId;
        setActiveCall(callData);
        activeCallRef.current = callData;
        subscribeToCallNode(targetCallId);

        if (autoAnswer && selfStatus === 'ringing') {
          autoAnswerCallIdRef.current = null;
          await acceptIncomingCall(targetCallId, callData);
        }
      } catch (err) {
        console.warn('Error hydrating incoming call from push:', err);
      }
    };

    const handleDeclineIncomingCallEvent = async (e: any) => {
      const targetCallId = e.detail?.callId || callIdRef.current;
      if (!targetCallId) return;
      await declineCallById(targetCallId, activeCallRef.current);
    };

    window.addEventListener('initiateCall', handleInitiateCallEvent);
    window.addEventListener('openIncomingCall', handleOpenIncomingCallEvent);
    window.addEventListener('declineIncomingCall', handleDeclineIncomingCallEvent);

    if (pendingIntentRef.current) {
      const intent = pendingIntentRef.current;
      pendingIntentRef.current = null;
      if (intent.type === 'open') {
        handleOpenIncomingCallEvent({ detail: { callId: intent.callId, autoAnswer: intent.autoAnswer } });
      } else {
        handleDeclineIncomingCallEvent({ detail: { callId: intent.callId } });
      }
    }

    return () => {
      unsubUserCall();
      if (activeCallUnsubRef.current) {
        activeCallUnsubRef.current();
        activeCallUnsubRef.current = null;
      }
      window.removeEventListener('initiateCall', handleInitiateCallEvent);
      window.removeEventListener('openIncomingCall', handleOpenIncomingCallEvent);
      window.removeEventListener('declineIncomingCall', handleDeclineIncomingCallEvent);
    };
  }, [currentUserId, currentProfile, acceptIncomingCall, applyLocalMediaForMode, declineCallById, handleLocalHangup, joinLiveKitCall]);

  // Capture cold-start push deep-link events even before currentProfile finishes loading
  useEffect(() => {
    if (currentUserId) return;
    const captureOpen = (e: any) => {
      if (e.detail?.callId) {
        pendingIntentRef.current = {
          type: 'open',
          callId: e.detail.callId,
          autoAnswer: Boolean(e.detail.autoAnswer),
        };
      }
    };
    const captureDecline = (e: any) => {
      if (e.detail?.callId) {
        pendingIntentRef.current = { type: 'decline', callId: e.detail.callId };
      }
    };
    window.addEventListener('openIncomingCall', captureOpen);
    window.addEventListener('declineIncomingCall', captureDecline);
    return () => {
      window.removeEventListener('openIncomingCall', captureOpen);
      window.removeEventListener('declineIncomingCall', captureDecline);
    };
  }, [currentUserId]);

  const handleAcceptCall = async () => {
    if (!callId || !activeCall) return;
    await acceptIncomingCall(callId, activeCall);
  };

  const handleDeclineCall = async () => {
    if (!callId) return;
    await declineCallById(callId, activeCall);
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
          } catch (_) {}
        }, 600);
      } else {
        await set(ref(rtdb, `calls/${cid}/participants/${currentUserId}/status`), 'declined');
        if (!callObj.meta.is_group) {
          await set(ref(rtdb, `calls/${cid}/status`), 'ended');
          await set(ref(rtdb, `user_calls/${callObj.meta.caller_id}/active`), null);
          setTimeout(() => remove(ref(rtdb, `calls/${cid}`)).catch(() => {}), 600);
        }
      }
    } catch (e) {
      console.warn('Hangup DB update error:', e);
    }

    handleLocalHangup();
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      const nextMuted = !isMuted;
      await room.localParticipant.setMicrophoneEnabled(!nextMuted);
      setIsMuted(nextMuted);
    } catch (e) {
      console.warn('Mute toggle failed:', e);
    }
  };

  const toggleVideo = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      const nextDisabled = !isVideoDisabled;
      await room.localParticipant.setCameraEnabled(!nextDisabled);
      setIsVideoDisabled(nextDisabled);
      syncMediaFromRoom(room);

      const cid = callIdRef.current || callId;
      if (cid) {
        const isCaller = activeCallRef.current?.meta?.caller_id === currentUserId;
        if (isCaller) {
          set(ref(rtdb, `calls/${cid}/caller_video_disabled`), nextDisabled).catch(() => {});
        } else {
          set(ref(rtdb, `calls/${cid}/participants/${currentUserId}/video_disabled`), nextDisabled).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Video toggle failed:', e);
    }
  };

  const toggleSpeaker = async () => {
    const nextSpeaker = !isSpeakerOn;
    await applyAudioOutputRoute(nextSpeaker);
  };

  const handleEnableAudioPlayback = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      setCanPlaybackAudio(room.canPlaybackAudio);
    } catch (_) {}
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
  let avatarUrl: string | null = null;

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
    if (roomRef.current && !roomRef.current.canPlaybackAudio) {
      roomRef.current.startAudio().then(() => {
        if (roomRef.current) setCanPlaybackAudio(roomRef.current.canPlaybackAudio);
      }).catch(() => {});
    }
    if (callStatus === 'connected' && activeMode === 'video') {
      setShowControls(prev => !prev);
    }
  };

  const isGroupCall = activeCall.meta.is_group;
  const otherPartyId = isCaller
    ? Object.keys(activeCall.participants || {})[0]
    : activeCall.meta.caller_id;

  // For group PiP fallback, pick first active remote video stream if any
  const primaryRemoteVideo = isGroupCall
    ? (Object.values(remoteVideoStreams)[0] || null)
    : (remoteVideoStreams[otherPartyId] || null);
  const isPeerVideoDisabled1on1 = isCaller
    ? activeCall.participants?.[otherPartyId]?.video_disabled === true
    : activeCall.caller_video_disabled === true;
  const remoteParticipantCount = (Object.values(activeCall.participants || {}) as Participant[]).filter(p => p.status === 'accepted').length + (isCaller ? 0 : 1);

  return createPortal(
    <>
      {/* Dedicated Remote Audio Renderer (always mounted while connected, even when minimized) */}
      {isConnected && remoteAudioTracks.map(item => (
        <RemoteAudioElement
          key={item.key}
          track={item.track}
          sinkId={audioSinkId}
          volume={1.0}
        />
      ))}

      {/* Minimized Video Messenger-style Draggable Dual-Camera PiP */}
      <AnimatePresence>
        {isConnected && isMinimized && activeMode === 'video' && (
          <MinimizedVideoPip
            remoteStream={primaryRemoteVideo}
            localStream={localVideoStream}
            isLocalVideoDisabled={isVideoDisabled}
            isRemoteVideoDisabled={!isGroupCall && isPeerVideoDisabled1on1}
            displayName={displayName}
            avatarUrl={avatarUrl}
            isGroup={isGroupCall}
            participantCount={remoteParticipantCount}
            duration={callDuration}
            onExpand={() => {
              setIsMinimized(false);
              setShowControls(true);
            }}
          />
        )}
      </AnimatePresence>

      {/* Fullscreen Call Overlay (hidden cleanly while minimized so user can browse app) */}
      {!isMinimized && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleScreenTap}
            className="fixed inset-0 z-[99999] bg-black text-white flex flex-col justify-between overflow-hidden select-none max-w-lg mx-auto md:border-x md:border-white/15 font-sans cursor-pointer"
          >
            {/* iOS Safari Cold-Start Audio Unlock Pill (only visible if browser blocked autoplay) */}
            {isConnected && !canPlaybackAudio && (
              <div className="fixed top-[calc(5.5rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
                <button
                  onClick={handleEnableAudioPlayback}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 text-black font-semibold text-xs shadow-xl animate-pulse"
                >
                  <Volume2 size={15} />
                  Tap to turn on call audio
                </button>
              </div>
            )}

            {/* Active Video overlay panels */}
            {isConnected && activeMode === 'video' && (
              <div className="absolute inset-0 bg-zinc-950 z-0 flex flex-col items-center justify-center pointer-events-none">
                {isGroupCall ? (
                  <GroupVideoGrid
                    remoteStreams={remoteVideoStreams}
                    localStream={localVideoStream}
                    currentUserId={currentUserId!}
                    isVideoDisabled={isVideoDisabled}
                    activeCall={activeCall}
                    currentProfile={currentProfile}
                  />
                ) : (
                  <div className="absolute inset-0 w-full h-full object-cover">
                    {primaryRemoteVideo && !isPeerVideoDisabled1on1 ? (
                      <VideoPlayer
                        stream={primaryRemoteVideo}
                        muted={true}
                        className="absolute inset-0 w-full h-full object-cover rounded-none"
                      />
                    ) : (localVideoStream && !isVideoDisabled && !isPeerVideoDisabled1on1) ? (
                      <VideoPlayer
                        stream={localVideoStream}
                        muted={true}
                        mirror={true}
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
                        <p className="text-white/40 text-xs font-medium tracking-widest uppercase">
                          {isPeerVideoDisabled1on1 ? 'Camera off' : 'Connecting video...'}
                        </p>
                      </div>
                    )}

                    {/* Picture-in-picture local feed (mirrored naturally like a mirror) */}
                    {primaryRemoteVideo && !isPeerVideoDisabled1on1 && localVideoStream && !isVideoDisabled && (
                      <div className="absolute top-24 right-4 w-28 h-40 rounded-2xl overflow-hidden border border-white/20 shadow-2xl z-10 bg-black/50 pointer-events-auto">
                        <VideoPlayer
                          stream={localVideoStream}
                          muted={true}
                          mirror={true}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Header / Top Controls */}
            <AnimatePresence>
              {(!isConnected || activeMode !== 'video') ? (
                <motion.div
                  key="centered-header"
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="pt-[calc(1rem+env(safe-area-inset-top))] px-4 flex flex-col items-center text-center z-10 shrink-0 w-full"
                >
                  {/* Top Bar with Go Back button for browsing while in Audio Call */}
                  <div className="w-full h-11 flex items-center justify-between mb-3">
                    {isConnected ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsMinimized(true);
                        }}
                        className="p-2 -ml-1 text-white/85 hover:text-white active:scale-90 transition-transform"
                        aria-label="Minimize call"
                      >
                        <ArrowLeft size={24} />
                      </button>
                    ) : (
                      <div className="w-10" />
                    )}
                    <div className="w-10" />
                  </div>

                  <div className="w-28 h-28 rounded-full overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center relative shadow-[0_0_40px_rgba(0,0,0,0.8)] pointer-events-none">
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

                  <h1 className="text-3xl font-bold tracking-tight mt-6 text-white drop-shadow-md pointer-events-none">
                    {displayName}
                  </h1>

                  {/* Show subtitle only for ringing/video state; omit "Audio Call" text during audio calls */}
                  {activeMode === 'video' && (
                    <div className="flex items-center gap-1.5 mt-2.5 text-xs font-medium text-white/55 tracking-wide pointer-events-none">
                      <Video size={13} className="text-emerald-400" />
                      <span>Video Call</span>
                    </div>
                  )}

                  {/* Clean duration (without "ACTIVE — ") */}
                  <p className="text-white/75 text-sm mt-2.5 tracking-wider font-medium tabular-nums pointer-events-none">
                    {isRingingIncoming && 'Incoming call'}
                    {isRingingOutgoing && 'Ringing...'}
                    {isConnected && formatTime(callDuration)}
                  </p>

                  {isGroupCall && (
                    <div className="mt-4 flex flex-wrap justify-center gap-2 pointer-events-none">
                      {Object.keys(activeCall.participants || {}).map(uid => {
                        const p = activeCall.participants[uid];
                        return (
                          <div key={uid} className="flex items-center gap-1.5 px-3 py-1 bg-white/[0.04] border border-white/5 rounded-full">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'accepted' ? 'bg-green-500' : p.status === 'declined' ? 'bg-red-500' : 'bg-amber-400'}`} />
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
                    className="absolute top-0 left-0 right-0 pt-[calc(1rem+env(safe-area-inset-top))] px-4 pb-6 bg-gradient-to-b from-black/85 via-black/45 to-transparent z-20 flex items-center gap-3 text-left pointer-events-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Go back button immediately to the left of profile picture */}
                    <button
                      onClick={() => setIsMinimized(true)}
                      className="p-2 -ml-1 text-white/90 hover:text-white active:scale-90 transition-transform shrink-0"
                      aria-label="Minimize video call"
                    >
                      <ArrowLeft size={24} />
                    </button>

                    <div className="w-11 h-11 rounded-full overflow-hidden border border-white/15 bg-white/5 shrink-0 shadow-lg">
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
                      <h1 className="text-base font-bold tracking-tight text-white drop-shadow-md truncate">
                        {displayName}
                      </h1>
                      <p className="text-white/65 text-xs font-medium mt-0.5 tracking-wider tabular-nums">
                        {formatTime(callDuration)}
                      </p>
                    </div>

                    {/* Switch Video Call -> Audio Call */}
                    <button
                      onClick={() => switchCallMode('audio')}
                      className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 flex items-center justify-center text-white backdrop-blur-md active:scale-90 transition-all shrink-0"
                      aria-label="Switch to audio call"
                      title="Switch to Audio Call"
                    >
                      <Phone size={18} />
                    </button>
                  </motion.div>
                )
              )}
            </AnimatePresence>

            {/* Audio call in-call controls: Switch to Video, Mute Mic, Toggle Speaker */}
            {isConnected && activeMode === 'audio' && (
              <div className="flex justify-center items-center gap-6 z-10 pb-2 shrink-0 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => switchCallMode('video')}
                  className="w-14 h-14 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white flex items-center justify-center transition-all active:scale-90"
                  aria-label="Switch to video call"
                  title="Switch to Video Call"
                >
                  <Video size={22} />
                </button>

                <button
                  onClick={toggleMute}
                  className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all active:scale-90 ${
                    isMuted
                      ? 'bg-red-600 border-red-500 text-white shadow-lg'
                      : 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                  }`}
                  aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
                </button>

                <button
                  onClick={toggleSpeaker}
                  className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all active:scale-90 ${
                    isSpeakerOn
                      ? 'bg-white text-black border-white shadow-lg'
                      : 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                  }`}
                  aria-label={isSpeakerOn ? 'Turn off speaker' : 'Turn on speaker'}
                  title={isSpeakerOn ? 'Speaker On' : 'Earpiece'}
                >
                  <Volume2 size={22} />
                </button>
              </div>
            )}

            {/* Sliding video overlay controls */}
            <AnimatePresence>
              {isConnected && activeMode === 'video' && showControls && (
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
                    className={`w-14 h-14 rounded-full border border-white/10 flex items-center justify-center transition-all ${
                      isVideoDisabled ? 'bg-red-600/90 border-red-500 text-white shadow-lg' : 'bg-white/10 text-white backdrop-blur-md'
                    }`}
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
                    className={`w-14 h-14 rounded-full border border-white/10 flex items-center justify-center transition-all ${
                      isMuted ? 'bg-red-600/90 border-red-500 text-white shadow-lg' : 'bg-white/10 text-white backdrop-blur-md'
                    }`}
                  >
                    {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Centered actions */}
            {(!isConnected || activeMode !== 'video') && (
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
        </AnimatePresence>
      )}
    </>,
    document.body
  );
}
