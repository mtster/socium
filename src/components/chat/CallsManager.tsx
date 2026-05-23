import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Volume2, VolumeX, Users } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { rtdb } from '@/src/lib/firebase';
import { ref, onValue, set, get, remove, update, off } from 'firebase/database';
import { useStore } from '@/src/store/useStore';

// Web Audio API Ringtone and Sound Effects synthesizer
class SoundSynthesizer {
  private audioCtx: AudioContext | null = null;
  private ringtoneInterval: any = null;

  private initCtx() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  startRinging() {
    this.stopRinging();
    this.initCtx();
    
    const playTone = () => {
      try {
        if (!this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        // Classic iOS cell ring dual tone chime
        osc.frequency.setValueAtTime(400, this.audioCtx.currentTime);
        osc.frequency.setValueAtTime(450, this.audioCtx.currentTime + 0.15);
        
        gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.12, this.audioCtx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 1.2);
        
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 1.3);
      } catch (e) {
        console.warn("Ringtone synth audio context error:", e);
      }
    };

    playTone();
    this.ringtoneInterval = setInterval(playTone, 2000);
  }

  stopRinging() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
  }

  playHangup() {
    this.stopRinging();
    this.initCtx();
    try {
      if (!this.audioCtx) return;
      const osc1 = this.audioCtx.createOscillator();
      const osc2 = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      
      osc1.frequency.setValueAtTime(320, this.audioCtx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(100, this.audioCtx.currentTime + 0.35);
      
      osc2.frequency.setValueAtTime(220, this.audioCtx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(70, this.audioCtx.currentTime + 0.35);
      
      gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.4);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc1.start();
      osc2.start();
      osc1.stop(this.audioCtx.currentTime + 0.4);
      osc2.stop(this.audioCtx.currentTime + 0.4);
    } catch (e) {
      console.warn("Hangup audio synth error:", e);
    }
  }

  playAnswer() {
    this.stopRinging();
    this.initCtx();
    try {
      if (!this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      
      osc.frequency.setValueAtTime(280, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(560, this.audioCtx.currentTime + 0.3);
      
      gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.35);
      
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.35);
    } catch (e) {
      console.warn("Answer audio synth error:", e);
    }
  }
}

const synth = new SoundSynthesizer();

interface CallMeta {
  id: string;
  caller_id: string;
  caller_name: string;
  caller_avatar: string | null;
  chat_room_id: string;
  is_group: boolean;
  type: 'audio' | 'video';
}

interface Participant {
  status: 'ringing' | 'accepted' | 'declined';
  name?: string;
  avatar_url?: string | null;
}

interface CallNode {
  meta: CallMeta;
  participants: Record<string, Participant>;
  signaling?: Record<string, any>;
}

export function CallsManager() {
  const currentUserId = useStore(state => state.profile?.id);
  const currentProfile = useStore(state => state.profile);

  // Core active call states
  const [activeCall, setActiveCall] = useState<CallNode | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState<'idle' | 'ringing_outgoing' | 'ringing_incoming' | 'connected' | 'ended'>('idle');
  
  // Media states
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // Timer Ref
  const timerRef = useRef<any>(null);

  // WebRTC Connection Refs (handling 1-on-1 calls seamlessly)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  // Listens to global window triggers for call initiation
  useEffect(() => {
    if (!currentUserId || !rtdb) return;

    // Listen to incoming calls
    const userCallActiveRef = ref(rtdb, `user_calls/${currentUserId}/active`);
    const unsubscribeUserCall = onValue(userCallActiveRef, async (snapshot) => {
      const incomingCallId = snapshot.val();
      if (incomingCallId) {
        setCallId(incomingCallId);
        // Subscribe to the full call state node
        const callRef = ref(rtdb, `calls/${incomingCallId}`);
        onValue(callRef, (callSnap) => {
          const callData = callSnap.val() as CallNode | null;
          if (callData) {
            setActiveCall(callData);
            
            // Determine our current status In the participant pool
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
            // Call node deleted (caller hung up / aborted)
            handleLocalHangup(true);
          }
        });
      } else {
        // Active call cleared
        handleLocalHangup(true);
      }
    });

    const handleInitiateCallEvent = async (e: any) => {
      const { chat, type } = e.detail;
      if (!chat) return;

      const newCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      setCallId(newCallId);
      setCallStatus('ringing_outgoing');
      synth.startRinging();

      const callerName = currentProfile?.full_name || currentProfile?.username || 'Socium User';
      const callerAvatar = currentProfile?.avatar_url || null;

      // Initialize Call Metadata
      const meta: CallMeta = {
        id: newCallId,
        caller_id: currentUserId,
        caller_name: callerName,
        caller_avatar: callerAvatar,
        chat_room_id: chat.id,
        is_group: chat.isGroup,
        type: type as 'audio' | 'video'
      };

      // Determine participants and evaluate presence
      const recipients: string[] = chat.isGroup
        ? (chat.participants || []).map((p: any) => p.id).filter((uid: string) => uid !== currentUserId)
        : [chat.id];

      const participants: Record<string, Participant> = {};
      const onlineIds: string[] = [];
      const offlineIds: string[] = [];

      // SNIPED: Check presence individually per user ID with direct snap refs
      for (const rid of recipients) {
        participants[rid] = { status: 'ringing' };
        try {
          const presenceSnap = await get(ref(rtdb, `global_presence/${rid}`));
          const isOnline = presenceSnap.val() === true;
          if (isOnline) {
            onlineIds.push(rid);
          } else {
            offlineIds.push(rid);
          }
        } catch (presenceErr) {
          console.warn('Presence read failed for', rid, presenceErr);
          offlineIds.push(rid); // Fallback to offline/push trigger
        }
      }

      const freshCallNode: CallNode = { meta, participants };

      // Write initial Call node
      await set(ref(rtdb, `calls/${newCallId}`), freshCallNode);

      // Write active call indicator to caller's self-user node in RTDB too so we have structured persistence
      await set(ref(rtdb, `user_calls/${currentUserId}/active`), newCallId);

      // Propagate active identifier to recipients (ringing socket triggers)
      for (const rid of recipients) {
        await set(ref(rtdb, `user_calls/${rid}/active`), newCallId);
      }

      // Initialize Local Stream for Caller
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video'
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (mediaErr) {
        console.warn('Calling media device capture failed:', mediaErr);
      }

      // 1-on-1 WebRTC connection initializations
      if (!chat.isGroup) {
        setupCallerWebRTC(newCallId, chat.id, type === 'video');
      }

      // Subscribe to self call state node updates
      const callRef = ref(rtdb, `calls/${newCallId}`);
      onValue(callRef, (snap) => {
        const val = snap.val() as CallNode | null;
        if (val) {
          setActiveCall(val);
          // If any participant has accepted, play sound and clear ring
          const acceptedUser = Object.keys(val.participants).find(uid => val.participants[uid].status === 'accepted');
          if (acceptedUser) {
            setCallStatus('connected');
            synth.stopRinging();
          }
          // If 1-on-1 and recipient declined: hangup
          if (!chat.isGroup && val.participants[chat.id]?.status === 'declined') {
            handleLocalHangup();
          }
        } else {
          handleLocalHangup(true);
        }
      });

      // BATCHED Cloudflare notification strike (multicast FCM tokens payload)
      if (offlineIds.length > 0) {
        try {
          const { data: pushRecs } = await supabase
            .from('push_subscriptions')
            .select('user_id, endpoint')
            .in('user_id', offlineIds);
            
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
            
            const callsWorkerUrl = import.meta.env.VITE_CLOUDFLARE_CALLS_WORKER_URL || import.meta.env.VITE_CLOUDFLARE_REQUEST_WORKER_URL || 'https://socium-calls-notifications.brare-black.workers.dev/';
            
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
            }).catch(e => console.error("Cloudflare calls worker post error:", e));
          }
        } catch (supabaseErr) {
          console.error("Supabase notification pre-fetch failed:", supabaseErr);
        }
      }
    };

    window.addEventListener('initiateCall', handleInitiateCallEvent);

    return () => {
      unsubscribeUserCall();
      if (callId) {
        off(ref(rtdb, `calls/${callId}`));
      }
      window.removeEventListener('initiateCall', handleInitiateCallEvent);
    };
  }, [currentUserId, currentProfile]);

  // Handle active timer for active calls
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
      }
    };
  }, [callStatus]);

  // Clean local streams and connections helper
  const cleanMediaAndRTC = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    synth.stopRinging();
  };

  // Full Call Hang Up/Decline local UI controller
  const handleLocalHangup = (isSilent = false) => {
    cleanMediaAndRTC();
    setCallStatus('idle');
    setActiveCall(null);
    setCallId(null);
    if (!isSilent) synth.playHangup();
  };

  // Caller Initiated WebRTC Peer setup
  const setupCallerWebRTC = async (cid: string, recipientId: string, withVideo: boolean) => {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      peerConnectionRef.current = pc;

      // Local stream tracks added
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateRef = ref(rtdb, `calls/${cid}/signaling/${currentUserId}/candidates/${Date.now()}`);
          set(candidateRef, JSON.stringify(event.candidate.toJSON()));
        }
      };

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        }
      };

      // Create Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await set(ref(rtdb, `calls/${cid}/signaling/${currentUserId}/offer`), JSON.stringify({
        type: offer.type,
        sdp: offer.sdp
      }));

      // Listen for Recipient's Answer and candidates
      const answerRef = ref(rtdb, `calls/${cid}/signaling/${recipientId}/answer`);
      onValue(answerRef, async (answerSnap) => {
        const val = answerSnap.val();
        if (val) {
          const answer = JSON.parse(val);
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      const recipientCandRef = ref(rtdb, `calls/${cid}/signaling/${recipientId}/candidates`);
      onValue(recipientCandRef, (candsSnap) => {
        const val = candsSnap.val();
        if (val) {
          Object.keys(val).forEach(async (k) => {
            try {
              const cand = JSON.parse(val[k]);
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (candErr) {
              console.warn('ICE Candidate append skipped:', candErr);
            }
          });
        }
      });

    } catch (err) {
      console.error('Caller WebRTC setup error:', err);
    }
  };

  // Receiver Initiated WebRTC Peer setup
  const setupReceiverWebRTC = async (cid: string, callerId: string, withVideo: boolean) => {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      peerConnectionRef.current = pc;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateRef = ref(rtdb, `calls/${cid}/signaling/${currentUserId}/candidates/${Date.now()}`);
          set(candidateRef, JSON.stringify(event.candidate.toJSON()));
        }
      };

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        }
      };

      // Read Caller Offer
      const callerOfferRef = ref(rtdb, `calls/${cid}/signaling/${callerId}/offer`);
      const offerSnap = await get(callerOfferRef);
      if (offerSnap.exists()) {
        const offer = JSON.parse(offerSnap.val());
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await set(ref(rtdb, `calls/${cid}/signaling/${currentUserId}/answer`), JSON.stringify({
          type: answer.type,
          sdp: answer.sdp
        }));
      }

      // Sync ICE candidates
      const callerCandRef = ref(rtdb, `calls/${cid}/signaling/${callerId}/candidates`);
      onValue(callerCandRef, (candsSnap) => {
        const val = candsSnap.val();
        if (val) {
          Object.keys(val).forEach(async (k) => {
            try {
              const cand = JSON.parse(val[k]);
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (iceErr) {
              console.warn('ICE Append rejected:', iceErr);
            }
          });
        }
      });

    } catch (err) {
      console.error('Receiver WebRTC setup error:', err);
    }
  };

  // Accept Call Command Execution
  const handleAcceptCall = async () => {
    if (!callId || !activeCall) return;
    synth.playAnswer();

    // Toggle status to accepted
    await set(ref(rtdb, `calls/${callId}/participants/${currentUserId}/status`), 'accepted');

    // Initiate WebRTC peer loop for 1-on-1 calls
    if (!activeCall.meta.is_group) {
      setupReceiverWebRTC(callId, activeCall.meta.caller_id, activeCall.meta.type === 'video');
    } else {
      // In groups: capture stream immediately for local feedback
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: activeCall.meta.type === 'video'
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (e) {
        console.warn('Group audio stream capture issue:', e);
      }
    }
    setCallStatus('connected');
  };

  // Decline Call Command Execution
  const handleDeclineCall = async () => {
    if (!callId || !activeCall) return;

    // Write decline directly to isolated participant path
    await set(ref(rtdb, `calls/${callId}/participants/${currentUserId}/status`), 'declined');

    // Clear user active call slot
    await set(ref(rtdb, `user_calls/${currentUserId}/active`), null);

    // If 1-on-1: kill whole call
    if (!activeCall.meta.is_group) {
      await remove(ref(rtdb, `calls/${callId}`));
      const callerId = activeCall.meta.caller_id;
      await set(ref(rtdb, `user_calls/${callerId}/active`), null);
    }

    handleLocalHangup();
  };

  // Hanging Up Call Command Execution
  const handleHangupCall = async () => {
    if (!callId || !activeCall) return;

    // Terminate self active indicators
    await set(ref(rtdb, `user_calls/${currentUserId}/active`), null);

    if (activeCall.meta.caller_id === currentUserId) {
      // If Caller hangs up, or call ends - wipe the whole active block node
      await remove(ref(rtdb, `calls/${callId}`));
      
      // Clean up for all participants
      const activeNodeKeys = Object.keys(activeCall.participants);
      for (const pk of activeNodeKeys) {
        await set(ref(rtdb, `user_calls/${pk}/active`), null);
      }
    } else {
      // Recipient hanging up / quitting
      await set(ref(rtdb, `calls/${callId}/participants/${currentUserId}/status`), 'declined');
    }

    handleLocalHangup();
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoDisabled(!videoTrack.enabled);
      }
    }
  };

  // Formatter for Active Talk-time
  const formatTime = (secs: number) => {
    const min = Math.floor(secs / 60);
    const sec = secs % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  if (callStatus === 'idle') return null;

  const isRingingIncoming = callStatus === 'ringing_incoming';
  const isRingingOutgoing = callStatus === 'ringing_outgoing';
  const isConnected = callStatus === 'connected';

  // Render info values depending on relative calling side (caller vs receiver)
  const isCaller = activeCall?.meta.caller_id === currentUserId;
  const avatarUrl = isCaller 
    ? (activeCall?.meta.is_group ? null : activeCall?.meta.caller_avatar) // Render single target logic below
    : activeCall?.meta.caller_avatar;
  const displayName = isCaller
    ? (activeCall?.meta.is_group ? "Group Call" : activeCall?.meta.caller_name)
    : activeCall?.meta.caller_name;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[99999] bg-black text-white flex flex-col justify-between overflow-hidden select-none select-none max-w-lg mx-auto md:border-x md:border-white/15"
      >
        {/* Dynamic Video Streaming overlay layers */}
        {isConnected && activeCall?.meta.type === 'video' && (
          <div className="absolute inset-0 bg-zinc-950 z-0 flex items-center justify-center">
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-24 h-24 rounded-full overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Users className="w-10 h-10 text-white/50" />
                  )}
                </div>
                <p className="text-white/40 text-sm font-mono tracking-widest uppercase animate-pulse">CONNECTING MEDIA...</p>
              </div>
            )}

            {/* PIP Local Camera display box */}
            {localStream && (
              <div className="absolute top-16 right-4 w-28 h-40 rounded-2xl overflow-hidden border border-white/20 shadow-2xl z-10 bg-black/50">
                {!isVideoDisabled ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-white/5">
                    <VideoOff size={20} className="text-white/40" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Header container */}
        <div className="pt-[calc(2.5rem+env(safe-area-inset-top))] px-6 flex flex-col items-center text-center z-10 shrink-0">
          <div className="w-28 h-28 rounded-full overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center relative shadow-[0_0_40px_rgba(0,0,0,0.8)]">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-zinc-900 border border-white/5">
                {activeCall?.meta.is_group ? (
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
            {activeCall?.meta.type === 'video' ? '🎥 Video Call' : '📞 Audio Call'}
          </p>

          <p className="text-[#a0a0a0] text-sm mt-3.5 tracking-wider font-medium">
            {isRingingIncoming && "INCOMING CALL..."}
            {isRingingOutgoing && "RINGING..."}
            {isConnected && `ACTIVE — ${formatTime(callDuration)}`}
          </p>

          {/* Connected Participants presence ticker helper for group chats */}
          {activeCall?.meta.is_group && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {Object.keys(activeCall.participants).map(uid => {
                const p = activeCall.participants[uid];
                return (
                  <div key={uid} className="flex items-center gap-1.5 px-3 py-1 bg-white/[0.04] border border-white/5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    <span className="text-[10px] font-medium text-white/60 truncate max-w-[80px]">{(uid === currentUserId) ? 'Me' : p.name || `User (${uid.slice(0, 4)})`} — <span className="text-[9px] uppercase tracking-wider font-mono text-white/40">{p.status}</span></span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Media Control toggle keys in active connected states */}
        {isConnected && (
          <div className="flex justify-center gap-6 z-10 pb-4 shrink-0">
            <button
              onClick={toggleMute}
              className={`p-4 rounded-full border transition-all active:scale-90 ${isMuted ? 'bg-red-600 border-red-500 text-white' : 'bg-white/5 border-white/10 text-white'}`}
            >
              {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>
            {activeCall?.meta.type === 'video' && (
              <button
                onClick={toggleVideo}
                className={`p-4 rounded-full border transition-all active:scale-90 ${isVideoDisabled ? 'bg-red-600 border-red-500 text-white' : 'bg-white/5 border-white/10 text-white'}`}
              >
                {isVideoDisabled ? <VideoOff size={22} /> : <Video size={22} />}
              </button>
            )}
          </div>
        )}

        {/* Action button triggers bottom segment container */}
        <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] px-8 flex justify-center items-center gap-12 z-10 shrink-0 relative">
          <AnimatePresence mode="wait">
            {isRingingIncoming ? (
              // Incoming Call Ring Stage UI (both Cancel left and Accept right)
              <motion.div 
                key="incoming-actions" 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 30 }}
                className="flex items-center justify-between w-full max-w-[280px]"
              >
                {/* Red Decline Cancel circle Button */}
                <div className="flex flex-col items-center gap-2.5">
                  <motion.button
                    whileTap={{ scale: 0.85 }}
                    onClick={handleDeclineCall}
                    className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white shadow-lg transition-colors cursor-pointer"
                  >
                    <PhoneOff size={28} />
                  </motion.button>
                  <span className="text-xs font-medium text-white/50 tracking-wider">Decline</span>
                </div>

                {/* Green Accept Connection circle Button */}
                <div className="flex flex-col items-center gap-2.5">
                  <motion.button
                    whileTap={{ scale: 0.85 }}
                    onClick={handleAcceptCall}
                    className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center text-white shadow-lg transition-colors cursor-pointer"
                  >
                    <Phone size={28} />
                  </motion.button>
                  <span className="text-xs font-medium text-white/50 tracking-wider">Accept</span>
                </div>
              </motion.div>
            ) : (
              // Connected Call Active Stage / Outgoing Call Stage (only Decline/Hangup centered)
              <motion.div 
                key="connected-actions"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex flex-col items-center gap-2.5"
              >
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={handleHangupCall}
                  className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white shadow-lg transition-colors cursor-pointer"
                >
                  <PhoneOff size={28} />
                </motion.button>
                <span className="text-xs font-medium text-white/50 tracking-wider">End Call</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
