import { supabase } from '@/src/lib/supabase';

export interface LiveKitTokenResponse {
  token: string;
  wsUrl: string;
}

/**
 * Fetches a short-lived, authenticated LiveKit room token + WebSocket URL
 * from the Supabase Edge Function `livekit-call`.
 */
export async function getLiveKitCallToken(
  roomName: string,
  participantName: string
): Promise<LiveKitTokenResponse> {
  const { data, error } = await supabase.functions.invoke('livekit-call', {
    body: {
      action: 'token',
      roomName,
      participantName
    }
  });

  if (error) {
    throw new Error(`Failed to fetch LiveKit call token: ${error.message}`);
  }

  const token = data?.token;
  const wsUrl = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) || data?.wsUrl;

  if (!token || !wsUrl) {
    throw new Error('Invalid LiveKit credentials returned from server. Check LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET secrets.');
  }

  return { token, wsUrl };
}

export interface StartRingLoopParams {
  callId: string;
  recipientIds: string[];
  callerName: string;
  callType: 'audio' | 'video';
  isGroup: boolean;
}

/**
 * Triggers a single Supabase Edge Function invocation (`livekit-call`)
 * that handles the continuous ~3.5s push ringing loop server-side and exits
 * automatically when the call is answered, declined, or ended in RTDB.
 */
export async function startCallRinger({
  callId,
  recipientIds,
  callerName,
  callType,
  isGroup
}: StartRingLoopParams): Promise<void> {
  if (!recipientIds.length) return;

  try {
    const { error } = await supabase.functions.invoke('livekit-call', {
      body: {
        action: 'ring',
        callId,
        recipientIds,
        callerName,
        callType,
        isGroup
      }
    });

    if (error) {
      console.warn('livekit-call ring invocation warning:', error.message);
    }
  } catch (err) {
    console.warn('Failed to trigger livekit-call ring loop:', err);
  }
}
