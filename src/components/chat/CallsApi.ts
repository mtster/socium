/**
 * Utility client functions for interacting with the Cloudflare Calls worker proxy
 */

const WORKER_URL = 'https://socium-call-notifications.brare-black.workers.dev';

export interface CfTrackSpec {
  location: 'local' | 'remote';
  mid?: string;
  sessionId?: string;
  trackName?: string;
}

export interface CfNewTracksResponse {
  success: boolean;
  result: {
    tracks: Array<{
      location: 'local' | 'remote';
      mid: string;
      trackName: string;
      sessionId?: string;
      status: string;
    }>;
    requiresRenegotiation?: boolean;
    sessionDescription?: {
      type: 'offer' | 'answer';
      sdp: string;
    };
  };
}

/**
 * Creates a brand new Cloudflare RealtimeKit room instance via the gateway worker
 */
export async function createRealtimeKitRoom(): Promise<string> {
  const response = await fetch(`${WORKER_URL}/api/calls/create-room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create RealtimeKit room: ${errText}`);
  }

  const data = await response.json();
  const meetingId = data?.result?.id || data?.id || data?.meetingId;
  if (!meetingId) {
    throw new Error(`Invalid room structure received: ${JSON.stringify(data)}`);
  }
  return meetingId;
}

/**
 * Delegates ringing execution to the durable workflow engine
 */
export async function delegateCallRinger(
  callId: string,
  recipientId: string,
  callerName: string
): Promise<void> {
  try {
    const response = await fetch(`${WORKER_URL}/api/calls/ring`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, recipientId, callerName })
    });

    if (!response.ok && response.status !== 202) {
      const errText = await response.text();
      console.warn(`Ringer delegation warn: ${errText}`);
    }
  } catch (err) {
    console.warn("delegateCallRinger failed, worker might not have Workflow endpoints deployed:", err);
  }
}

/**
 * Generates an individual, secure, short-lived participant access token for a RealtimeKit room
 */
export async function getRealtimeKitToken(
  meetingId: string,
  userId: string,
  userName: string
): Promise<string> {
  const response = await fetch(`${WORKER_URL}/api/calls/join-room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, userId, name: userName })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to acquire participant token: ${errText}`);
  }

  const data = await response.json();
  const token = data?.result?.token || data?.token;
  if (!token) {
    throw new Error(`Invalid token layout received: ${JSON.stringify(data)}`);
  }
  return token;
}

/**
 * Creates a new WebRTC session on Cloudflare Calls
 */
export async function createCfSession(sdpOffer: string): Promise<{ sessionId: string; sdpAnswer: string }> {
  const response = await fetch(`${WORKER_URL}/api/calls/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionDescription: {
        type: 'offer',
        sdp: sdpOffer
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create Cloudflare session: ${errText}`);
  }

  const data = await response.json();
  if (!data?.success || !data?.result) {
    throw new Error(`Cloudflare session error: ${JSON.stringify(data)}`);
  }

  return {
    sessionId: data.result.sessionId,
    sdpAnswer: data.result.sessionDescription.sdp
  };
}

/**
 * Registers local tracks or subscribes to remote tracks on Cloudflare Calls
 */
export async function addCfTracks(
  sessionId: string,
  tracks: CfTrackSpec[]
): Promise<CfNewTracksResponse['result']> {
  const response = await fetch(`${WORKER_URL}/api/calls/session/${sessionId}/tracks/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracks })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to add/pull tracks on Cloudflare: ${errText}`);
  }

  const data = await response.json();
  if (!data?.success || !data?.result) {
    throw new Error(`Cloudflare add/pull tracks error: ${JSON.stringify(data)}`);
  }

  return data.result;
}

/**
 * Concludes the WebRTC renegotiation offer by sending back the SDP Answer to Cloudflare
 */
export async function renegotiateCfSession(
  sessionId: string,
  sdpAnswer: string
): Promise<void> {
  const response = await fetch(`${WORKER_URL}/api/calls/session/${sessionId}/renegotiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionDescription: {
        type: 'answer',
        sdp: sdpAnswer
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to Renegotiate Cloudflare session: ${errText}`);
  }

  const data = await response.json();
  if (!data?.success) {
    throw new Error(`Cloudflare renegotiation failed: ${JSON.stringify(data)}`);
  }
}
