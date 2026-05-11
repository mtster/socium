import { useState, useEffect } from 'react';
import { supabase } from '@/src/lib/supabase';
import { useStore } from '../store/useStore';
import { Profile } from '@/src/types';

const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
let cachedAdminProfile: Profile | null = null;

async function getAdminProfile() {
  if (cachedAdminProfile) return cachedAdminProfile;
  const { data } = await supabase.from('profiles').select('*').eq('id', ADMIN_ID).maybeSingle();
  if (data) cachedAdminProfile = data;
  return data;
}

let profileConnectionsCache: Record<string, any[]> = {};
let profileConnectionsTime: Record<string, number> = {};

export function useProfileLogic(profile: Profile, currentUserId: string | undefined, isOwnProfile: boolean | undefined) {
  const [connections, setConnections] = useState<any[]>(profileConnectionsCache[profile.id] || []);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchConnections = async () => {
    if (!currentUserId || !profile.id) return;
    setLoading(true);

    try {
      if (isOwnProfile) {
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
        
        const filteredConnections = combined.filter(c => c.id !== profile.id);
        profileConnectionsCache[profile.id] = filteredConnections;
        profileConnectionsTime[profile.id] = Date.now();
        setConnections(filteredConnections);

        const { data: pending } = await supabase.from('connections').select('*, profiles!connections_requester_id_fkey(*)').eq('receiver_id', profile.id).eq('status', 'pending');
        setPendingRequests(pending || []);
        
        if (profile.id === currentUserId && useStore.getState().setPendingRequestsCount) {
          useStore.getState().setPendingRequestsCount(pending?.length || 0);
        }
      } else {
        const { data: rel } = await supabase.from('connections')
          .select('*')
          .or(`and(requester_id.eq.${currentUserId},receiver_id.eq.${profile.id}),and(requester_id.eq.${profile.id},receiver_id.eq.${currentUserId})`)
          .maybeSingle();
        
        if (profile.id === ADMIN_ID) {
          setConnectionStatus('accepted');
        } else if (!rel) {
          setConnectionStatus('none');
          setConnectionId(null);
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

        setConnections(combined.filter(c => c.id !== profile.id));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!profileConnectionsCache[profile.id] || Date.now() - (profileConnectionsTime[profile.id] || 0) > 60000) {
      fetchConnections();
    } else {
      // Still need to fetch connectionStatus for non-own profile even if connections are cached
      if (!isOwnProfile) {
        fetchConnections();
      }
    }
  }, [profile.id, currentUserId]);

  const handleRequestConnection = async () => {
    if (!currentUserId) return;
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
  };

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
  };

  const handleRemoveConnection = async (id: string | null, connectionProfileId?: string) => {
    if (!currentUserId) return;
    try {
      let query = supabase.from('connections').delete();
      
      if (id && id !== 'unknown') {
        query = query.eq('id', id);
      } else if (connectionProfileId) {
        query = query.or(`and(requester_id.eq.${currentUserId},receiver_id.eq.${connectionProfileId}),and(requester_id.eq.${connectionProfileId},receiver_id.eq.${currentUserId})`);
      } else {
        // Fallback for viewing someone else's profile
        query = query.or(`and(requester_id.eq.${currentUserId},receiver_id.eq.${profile.id}),and(requester_id.eq.${profile.id},receiver_id.eq.${currentUserId})`);
      }

      const { error } = await query;
      if (error) throw error;
      
      if (!isOwnProfile) {
        setConnectionStatus('none');
        setConnectionId(null);
      }
      fetchConnections();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return {
    connections,
    pendingRequests,
    connectionStatus,
    connectionId,
    loading,
    fetchConnections,
    handleRequestConnection,
    handleAcceptConnection,
    handleRemoveConnection
  };
}
