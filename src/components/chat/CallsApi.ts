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
