import { useState, useEffect } from 'react';
import { supabase } from '@/src/lib/supabase';
import { useStore } from '@/src/store/useStore';
import { logFeedActivity } from '@/src/lib/feed';

const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
let cachedAdminProfile: any = null;
async function getAdminProfile() {
  if (cachedAdminProfile) return cachedAdminProfile;
  const { data } = await supabase.from('profiles').select('*').eq('id', ADMIN_ID).maybeSingle();
  if (data) cachedAdminProfile = data;
  return data;
}

let profileConnectionsCache: Record<string, any[]> = {};
let profileConnectionsTime: Record<string, number> = {};

export function useConnections(profile: any, isOwnProfile: boolean, currentUserId?: string) {
  const [connections, setConnections] = useState<any[]>(profileConnectionsCache[profile?.id] || []);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    if (!profileConnectionsCache[profile.id] || Date.now() - (profileConnectionsTime[profile.id] || 0) > 60000) {
      fetchConnections();
    } else {
      setConnections(profileConnectionsCache[profile.id]);
    }
  }, [profile?.id, currentUserId]);

  useEffect(() => {
    const handleConnectionsChanged = () => {
      profileConnectionsCache = {};
      profileConnectionsTime = {};
      fetchConnections();
    };
    window.addEventListener('connectionsChanged', handleConnectionsChanged);
    return () => {
      window.removeEventListener('connectionsChanged', handleConnectionsChanged);
    };
  }, [profile?.id, currentUserId]);

  const fetchConnections = async () => {
    if (!currentUserId || !profile?.id) return;

    if (isOwnProfile) {
      const { data: userConns, error: userConnsErr } = await supabase
        .from('connections')
        .select('*, profiles!connection_id(*)').eq('user_id', profile.id);
      
      if (userConnsErr) {
        console.error('[useConnections] error fetching connections:', userConnsErr);
        return;
      }
      
      const combined = (userConns?.map(c => c.profiles) || []).filter(Boolean);
      
      const adminProf = await getAdminProfile();
      if (adminProf && !combined.some(c => c.id === ADMIN_ID) && profile.id !== ADMIN_ID) {
        combined.unshift(adminProf);
      }
      
      const filteredConnections = combined.filter(c => c.id !== profile.id);
      profileConnectionsCache[profile.id] = filteredConnections;
      profileConnectionsTime[profile.id] = Date.now();
      setConnections(filteredConnections);

      const { data: pending, error: pendingErr } = await supabase
        .from('connection_requests')
        .select('*, profiles!requester_id(*)')
        .eq('receiver_id', profile.id)
        .eq('status', 'pending');
      
      if (pendingErr) {
        console.error('[useConnections] error fetching pending requests:', pendingErr);
      } else {
        setPendingRequests(pending || []);
        
        if (profile.id === currentUserId) {
          const hasUnseen = pending?.some(r => r.is_seen === false) || false;
          if (useStore.getState().setPendingRequestsCount) {
            useStore.getState().setPendingRequestsCount(pending?.length || 0);
          }
          if (useStore.getState().setHasUnseenRequest) {
            useStore.getState().setHasUnseenRequest(hasUnseen);
          }
        }
      }
    } else {
      const { data: rel, error: relErr } = await supabase.from('connection_requests')
        .select('*')
        .or(`and(requester_id.eq.${currentUserId},receiver_id.eq.${profile.id}),and(requester_id.eq.${profile.id},receiver_id.eq.${currentUserId})`)
        .maybeSingle();
      
      if (relErr) {
        console.error('[useConnections] error fetching relationship:', relErr);
        return;
      }
      
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

      const { data: userConns, error: userConnsErr } = await supabase
        .from('connections')
        .select('*, profiles!connection_id(*)')
        .eq('user_id', profile.id);
      
      if (userConnsErr) {
        console.error('[useConnections] error fetching other connections:', userConnsErr);
        return;
      }
      
      const combined = (userConns?.map(c => c.profiles) || []).filter(Boolean);

      const adminProf = await getAdminProfile();
      if (adminProf && !combined.some(c => c.id === ADMIN_ID) && profile.id !== ADMIN_ID) {
        combined.unshift(adminProf);
      }

      const finalConns = combined.filter(c => c.id !== profile.id);
      profileConnectionsCache[profile.id] = finalConns;
      profileConnectionsTime[profile.id] = Date.now();
      setConnections(finalConns);
    }
  };

  const handleRequestConnection = async () => {
    try {
      const { data, error } = await supabase.from('connection_requests').insert({
        requester_id: currentUserId,
        receiver_id: profile.id,
        status: 'pending'
      }).select().single();
      
      if (error) throw error;
      
      // Log Feed Activity for Connection Request
      if (data) {
        await logFeedActivity({
          activityType: 'connection_request',
          initiatorId: currentUserId!,
          connectionRequestId: data.id,
        });
      }
      
      profileConnectionsCache = {};
      profileConnectionsTime = {};
      window.dispatchEvent(new CustomEvent('connectionsChanged'));
      
      setConnectionStatus('pending_sent');
      setConnectionId(data.id);

      // Trigger client-side connection request notification to Cloudflare!
      try {
        const { data: senderInfo } = await supabase.from('profiles').select('full_name, username').eq('id', currentUserId).maybeSingle();
        const { data: pushRecs } = await supabase.from('push_subscriptions').select('endpoint').eq('user_id', profile.id);
        
        if (pushRecs && pushRecs.length > 0) {
          const tokens = pushRecs.map(r => r.endpoint);
          const senderName = senderInfo ? (senderInfo.full_name || senderInfo.username) : 'Someone';
          const workerUrl = import.meta.env.VITE_CLOUDFLARE_REQUEST_WORKER_URL || 'https://socium-request-notifications.brare-black.workers.dev/';
          
          fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sender_id: currentUserId,
              sender_name: senderName,
              receiver_id: profile.id,
              recipient_tokens: [{ userId: profile.id, tokens }]
            })
          }).catch(e => console.error("Cloudflare requests worker post error:", e));
        }
      } catch (e) {
        console.error("Failed to send connection request notification trigger:", e);
      }
    } catch (e: any) {
      alert(e.message);
    }
  }

  const handleAcceptConnection = async (id: string, requesterUserId?: string) => {
    try {
      let rId = requesterUserId;
      if (!rId) {
        const { data: reqData } = await supabase.from('connection_requests').select('requester_id').eq('id', id).maybeSingle();
        rId = reqData?.requester_id;
      }
      if (!rId) throw new Error("Could not identify requester ID");

      const { error } = await supabase.from('connection_requests').update({ status: 'accepted' }).eq('id', id);
      if (error) throw error;

      // Bidirectional insert into connections table
      await supabase.from('connections').insert([
        { user_id: currentUserId, connection_id: rId },
        { user_id: rId, connection_id: currentUserId }
      ]);
      
      profileConnectionsCache = {};
      profileConnectionsTime = {};
      window.dispatchEvent(new CustomEvent('connectionsChanged'));

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
      profileConnectionsCache = {};
      profileConnectionsTime = {};
      window.dispatchEvent(new CustomEvent('connectionsChanged'));

      const targetId = connectionProfileId || profile.id;
      if (targetId) {
        // Delete connections (bidirectional)
        await supabase.from('connections')
          .delete()
          .or(`and(user_id.eq.${currentUserId},connection_id.eq.${targetId}),and(user_id.eq.${targetId},connection_id.eq.${currentUserId})`);
        
        // Delete connection requests
        await supabase.from('connection_requests')
          .delete()
          .or(`and(requester_id.eq.${currentUserId},receiver_id.eq.${targetId}),and(requester_id.eq.${targetId},receiver_id.eq.${currentUserId})`);
      }
      
      if (!isOwnProfile) {
        setConnectionStatus('none');
        setConnectionId(null);
      }
      fetchConnections();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return { connections, pendingRequests, connectionStatus, connectionId, fetchConnections, handleRequestConnection, handleAcceptConnection, handleRemoveConnection };
}
