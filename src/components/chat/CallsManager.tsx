import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Users } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { rtdb } from '@/src/lib/firebase';
import { ref, onValue, set, get, remove, off } from 'firebase/database';
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
  room_name: string;
  room_avatar: string | null;
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
  const [showControls, setShowControls] = useState(true);
  
  // Media states
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // Sync state reference to prevent closures bugs in RTC listeners
  const activeCallRef = useRef<CallNode | null>(null);
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  // Ref tracking current local stream to guarantee exact track level shutdowns
  const localStreamRef = useRef<MediaStream | null>(null);

  // Timer Ref
  const timerRef = useRef<any>(null);

  // WebRTC Connection Refs (handling 1-on-1 calls seamlessly)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-hide controls timeout for connected video calls
  useEffect(() => {
    if (callStatus === 'connected' && activeCall?.meta.type === 'video' && showControls) {
      const timer = setTimeout(() => {
        setShowControls(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showControls, callStatus, activeCall?.meta.type]);

  // Synchronize local and remote media streams to DOM elements whenever they or connection status updates
  useEffect(() => {
    if (callStatus === 'connected') {
      if (localStream && localVideoRef.current) {
        if (localVideoRef.current.srcObject !== localStream) {
          try {
            localVideoRef.current.srcObject = localStream;
          } catch (e) {
            console.warn("Retrying local stream attachment:", e);
          }
        }
      }
      if (remoteStream) {
        if (activeCall?.meta.type === 'video') {
          if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
            try {
              remoteVideoRef.current.srcObject = remoteStream;
            } catch (e) {
              console.warn("Retrying remote video attachment:", e);
            }
          }
        } else {
          if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== remoteStream) {
            try {
              remoteAudioRef.current.srcObject = remoteStream;
            } catch (e) {
              console.warn("Retrying remote audio attachment:", e);
            }
          }
        }
      }
    }
  }, [localStream, remoteStream, callStatus, activeCall?.meta.type]);

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
            
            // Check if there are other participants and if all have declined, automatically close
            const otherParticipants = Object.keys(callData.participants).filter(uid => uid !== currentUserId);
            if (otherParticipants.length > 0) {
              const hasActiveOther = otherParticipants.some(uid => 
                callData.participants[uid].status === 'ringing' || callData.participants[uid].status === 'accepted'
              );
              if (!hasActiveOther) {
                handleLocalHangup();
                return;
              }
            }

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

      // Extract target metadata details for the receiver's UI
      const roomName = chat.isGroup ? chat.name : (chat.name || 'Socium Chat');
      const roomAvatar = chat.avatar_url || null;

      // Initialize Call Metadata with proper room details to swap avatars/icons seamlessly
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

      // Register call bubble strictly and elegantly in Supabase messages
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

      // Determine participants and evaluate presence
      const recipients: string[] = chat.isGroup
        ? (chat.participants || []).map((p: any) => p.id || p.user_id).filter((uid: string) => uid !== currentUserId)
        : [chat.id];

      const participants: Record<string, Participant> = {};
      const onlineIds: string[] = [];
      const offlineIds: string[] = [];

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

      // Write active call indicator to caller's self-user node in RTDB too
      await set(ref(rtdb, `user_calls/${currentUserId}/active`), newCallId);

      // Propagate active identifier to recipients (ringing socket triggers)
      for (const rid of recipients) {
        await set(ref(rtdb, `user_calls/${rid}/active`), newCallId);
      }

      // Initialize Local Stream for Caller (exactly ONCE)
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video'
        });
        setLocalStream(stream);
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (mediaErr) {
        console.warn('Calling media device capture failed:', mediaErr);
      }

      // 1-on-1 WebRTC connection initialization with exact single-use stream passed directly
      if (!chat.isGroup && stream) {
        setupCallerWebRTC(newCallId, chat.id, type === 'video', stream);
      }

      // Subscribe to self call state node updates
      const callRef = ref(rtdb, `calls/${newCallId}`);
      onValue(callRef, (snap) => {
        const val = snap.val() as CallNode | null;
        if (val) {
          setActiveCall(val);
          
          // Check if all other participants have declined, automatically close
          const otherParticipants = Object.keys(val.participants).filter(uid => uid !== currentUserId);
          if (otherParticipants.length > 0) {
            const hasActiveOther = otherParticipants.some(uid => 
              val.participants[uid].status === 'ringing' || val.participants[uid].status === 'accepted'
            );
            if (!hasActiveOther) {
              handleLocalHangup();
              return;
            }
          }

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

      // FCM worker triggers for both private and group chats
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
            
            // Connect strictly to user's desired Cloudflare Worker
            const callsWorkerUrl = 'https://socium-call-notifications.brare-black.workers.dev/';
            
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
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {
          console.warn("Error stopping track from ref:", e);
        }
      });
      localStreamRef.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {
          console.warn("Error stopping track from state:", e);
        }
      });
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {
          console.warn("Error stopping remote track from state:", e);
        }
      });
      setRemoteStream(null);
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
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
  const setupCallerWebRTC = async (cid: string, recipientId: string, withVideo: boolean, stream: MediaStream) => {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      peerConnectionRef.current = pc;

      // Local stream tracks added safely
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateRef = ref(rtdb, `calls/${cid}/signaling/${currentUserId}/candidates/${Date.now()}`);
          set(candidateRef, JSON.stringify(event.candidate.toJSON()));
        }
      };

      pc.ontrack = (event) => {
        let incomingStream = event.streams && event.streams[0];
        if (!incomingStream && event.track) {
          incomingStream = new MediaStream([event.track]);
        }
        if (incomingStream) {
          setRemoteStream(incomingStream);
        }
      };

      // Create Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await set(ref(rtdb, `calls/${cid}/signaling/${currentUserId}/offer`), JSON.stringify({
        type: offer.type,
        sdp: offer.sdp
      }));

      // Set up candidate queues to prevent adding ICE before setRemoteDescription state transitions
      const iceQueue: any[] = [];

      // Listen for Recipient's Answer
      const answerRef = ref(rtdb, `calls/${cid}/signaling/${recipientId}/answer`);
      onValue(answerRef, async (answerSnap) => {
        const val = answerSnap.val();
        if (val) {
          const answer = JSON.parse(val);
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            
            // Remote description established, flush the candidate queue
            while (iceQueue.length > 0) {
              const queuedCand = iceQueue.shift();
              if (queuedCand) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(queuedCand));
                } catch (iceErr) {
                  console.warn('ICE queued append skipped:', iceErr);
                }
              }
            }
          }
        }
      });

      const recipientCandRef = ref(rtdb, `calls/${cid}/signaling/${recipientId}/candidates`);
      onValue(recipientCandRef, (candsSnap) => {
        const val = candsSnap.val();
        if (val) {
          Object.keys(val).forEach(async (k) => {
            try {
              const cand = JSON.parse(val[k]);
              if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              } else {
                if (!iceQueue.some(c => c.candidate === cand.candidate)) {
                  iceQueue.push(cand);
                }
              }
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
  const setupReceiverWebRTC = async (cid: string, callerId: string, withVideo: boolean, stream: MediaStream) => {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      peerConnectionRef.current = pc;
      
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateRef = ref(rtdb, `calls/${cid}/signaling/${currentUserId}/candidates/${Date.now()}`);
          set(candidateRef, JSON.stringify(event.candidate.toJSON()));
        }
      };

      pc.ontrack = (event) => {
        let incomingStream = event.streams && event.streams[0];
        if (!incomingStream && event.track) {
          incomingStream = new MediaStream([event.track]);
        }
        if (incomingStream) {
          setRemoteStream(incomingStream);
        }
      };

      const iceQueue: any[] = [];

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

        // Flush recipient side candidate queue
        while (iceQueue.length > 0) {
          const queuedCand = iceQueue.shift();
          if (queuedCand) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(queuedCand));
            } catch (iceErr) {
              console.warn('ICE queued append skipped:', iceErr);
            }
          }
        }
      }

      // Sync ICE candidates
      const callerCandRef = ref(rtdb, `calls/${cid}/signaling/${callerId}/candidates`);
      onValue(callerCandRef, (candsSnap) => {
        const val = candsSnap.val();
        if (val) {
          Object.keys(val).forEach(async (k) => {
            try {
              const cand = JSON.parse(val[k]);
              if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              } else {
                if (!iceQueue.some(c => c.candidate === cand.candidate)) {
                  iceQueue.push(cand);
                }
              }
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

    // Acquire stream ONCE for Receiver too inside handleAcceptCall
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: activeCall.meta.type === 'video'
      });
      setLocalStream(stream);
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Initiate WebRTC peer loop for 1-on-1 calls
      if (!activeCall.meta.is_group) {
        setupReceiverWebRTC(callId, activeCall.meta.caller_id, activeCall.meta.type === 'video', stream);
      }
    } catch (e) {
      console.warn('Accept call local stream capture issue:', e);
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
    const stream = localStreamRef.current || localStream;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    const stream = localStreamRef.current || localStream;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
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

  // Swap target details elegantly so users see each other instead of themselves
  const isCaller = activeCall?.meta.caller_id === currentUserId;
  let displayName = '';
  let avatarUrl = null;

  if (activeCall) {
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
  }

  const handleScreenTap = () => {
    if (callStatus === 'connected' && activeCall?.meta.type === 'video') {
      setShowControls(prev => !prev);
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleScreenTap}
        className="fixed inset-0 z-[99999] bg-black text-white flex flex-col justify-between overflow-hidden select-none max-w-lg mx-auto md:border-x md:border-white/15 font-sans cursor-pointer"
      >
        {/* Remote audio-only playback frame element */}
        {isConnected && activeCall?.meta.type === 'audio' && remoteStream && (
          <audio
            ref={remoteAudioRef}
            autoPlay
            playsInline
            style={{ display: 'none' }}
          />
        )}

        {/* Dynamic Video Streaming overlay layers */}
        {isConnected && activeCall?.meta.type === 'video' && (
          <div className="absolute inset-0 bg-zinc-950 z-0 flex items-center justify-center pointer-events-none">
            {remoteStream || (activeCall?.meta.is_group && localStream) ? (
              <video
                ref={remoteStream ? remoteVideoRef : localVideoRef}
                autoPlay
                playsInline
                muted={!remoteStream}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-3">
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

            {/* PIP Local Camera display box to display local user's feed */}
            {remoteStream && (localStream || localStreamRef.current) && (
              <div className="absolute top-20 right-4 w-28 h-40 rounded-2xl overflow-hidden border border-white/20 shadow-2xl z-10 bg-black/50 pointer-events-auto">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${isVideoDisabled ? 'hidden' : ''}`}
                />
                {isVideoDisabled && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#141414]">
                    <VideoOff size={20} className="text-white/40" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Dynamic Header Layout Transitions */}
        <AnimatePresence>
          {(!isConnected || activeCall?.meta.type !== 'video') ? (
            /* Standard Centered Header (For Incoming/Outgoing states OR Audio Call) */
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

              {activeCall?.meta.is_group && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {Object.keys(activeCall.participants).map(uid => {
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
            /* Connected Video Call Compact Header (Top-Left WhatsApp visual style) */
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
                      {activeCall?.meta.is_group ? (
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

        {/* Media Control toggle keys in active connected AUDIO-ONLY states */}
        {isConnected && activeCall?.meta.type === 'audio' && (
          <div className="flex justify-center gap-6 z-10 pb-4 shrink-0 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={toggleMute}
              className={`p-4 rounded-full border transition-all active:scale-90 ${isMuted ? 'bg-red-600 border-red-500 text-white shadow-lg' : 'bg-white/5 border-white/10 text-white'}`}
            >
              {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>
          </div>
        )}

        {/* Transparent/translucent Sliding Controls bar overlay for Active Video Calls */}
        <AnimatePresence>
          {isConnected && activeCall?.meta.type === 'video' && showControls && (
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="absolute bottom-0 left-0 right-0 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-8 px-8 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-20 flex justify-center items-center gap-8 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Camera toggle (left) */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={toggleVideo}
                className={`w-14 h-14 rounded-full border border-white/10 flex items-center justify-center transition-all ${isVideoDisabled ? 'bg-red-600/90 border-red-500 text-white shadow-lg' : 'bg-white/10 text-white backdrop-blur-md'}`}
              >
                {isVideoDisabled ? <VideoOff size={22} /> : <Video size={22} />}
              </motion.button>

              {/* End Call (center, rotated Phone) */}
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={handleHangupCall}
                className="w-18 h-18 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl border border-white/5 cursor-pointer"
              >
                <Phone size={30} className="rotate-[135deg]" />
              </motion.button>

              {/* Microphone mute toggle (right) */}
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

        {/* Action button triggers bottom segment container for incoming/outgoing or audio connected stages */}
        {(!isConnected || activeCall?.meta.type !== 'video') && (
          <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] px-8 flex justify-center items-center gap-12 z-10 shrink-0 relative pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <AnimatePresence mode="wait">
              {isRingingIncoming ? (
                /* Incoming Call Stage (Bigger iOS-like Accept/Decline action spheres) */
                <motion.div 
                  key="incoming-actions" 
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 30 }}
                  className="flex items-center justify-between w-full max-w-[300px] px-2"
                >
                  {/* Red Decline Cancel circular button (angled phone icon with NO cross-line) */}
                  <div className="flex flex-col items-center gap-3">
                    <motion.button
                      whileTap={{ scale: 0.88 }}
                      onClick={handleDeclineCall}
                      className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl border border-white/5 cursor-pointer"
                    >
                      <Phone size={32} className="rotate-[135deg] translate-y-[-1px]" />
                    </motion.button>
                    <span className="text-xs font-semibold text-white/50 tracking-wider">Decline</span>
                  </div>

                  {/* Green Accept Connection circular button */}
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
                /* Outgoing or Connected audio Call Stage (Clean centered decline button) */
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
