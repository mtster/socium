import { supabase } from './supabase';
import { rtdb } from './firebase';
import { ref, set, get, runTransaction } from 'firebase/database';

export interface FeedActivityPayload {
  activityType: 'post' | 'like' | 'comment' | 'connection_request' | 'profile_picture';
  initiatorId: string;
  postId?: string | null;
  commentId?: string | null;
  connectionRequestId?: string | null;
  targetUserId?: string | null;
  taggedUserIds?: string[] | null;
}

export async function syncFeedRtdbOnly(initiatorId: string, taggedUserIds?: string[] | null) {
  if (!rtdb) return;
  try {
    const { data: conns } = await supabase
      .from('connections')
      .select('user_id, is_activity_muted')
      .eq('connection_id', initiatorId);

    const connectionIds = (conns || [])
      .filter(c => c.is_activity_muted !== true)
      .map(c => c.user_id)
      .filter(Boolean) as string[];

    const allTargets = Array.from(new Set([...connectionIds, ...(taggedUserIds || [])])).filter(uid => uid && uid !== initiatorId);

    if (allTargets.length > 0) {
      await Promise.all(
        allTargets.map(async (uid) => {
          try {
            const feedNodeRef = ref(rtdb, `feed/${uid}`);
            const currentFeedValSnap = await get(feedNodeRef);
            const currentFeedVal = currentFeedValSnap.val();

            await set(feedNodeRef, initiatorId);

            if (!currentFeedVal || currentFeedVal === "") {
              const presenceSnap = await get(ref(rtdb, `global_presence/${uid}`));
              const isOnline = presenceSnap.val() === true;
              
              if (!isOnline) {
                const uCountRef = ref(rtdb, `unseen_chat_count/${uid}`);
                await runTransaction(uCountRef, (val) => (val || 0) + 1);
              }
            }
          } catch (e) {
            console.warn(`[FeedActivity] RTDB sync error for user ${uid}:`, e);
          }
        })
      );
    }
  } catch (err) {
    console.warn('[FeedActivity] Error querying connections for RTDB sync:', err);
  }
}

export async function logFeedActivity({
  activityType,
  initiatorId,
  postId,
  commentId,
  connectionRequestId,
  targetUserId,
  taggedUserIds,
}: FeedActivityPayload) {
  try {
    // 1. Insert into Supabase feed_activity table
    // For profile_picture without postId, skip SQL insert because DB trigger creates the post and feed_activity row with postId
    if (activityType !== 'profile_picture' || postId) {
      const { error } = await supabase
        .from('feed_activity')
        .insert({
          activity_type: activityType,
          initiator_id: initiatorId,
          post_id: postId || null,
          comment_id: commentId || null,
          connection_request_id: connectionRequestId || null,
          tagged_user_ids: taggedUserIds || null,
        });

      if (error) {
        console.error('[FeedActivity] SQL insertion failed:', error);
      }
    }

    // 2. Client-side Realtime Database 'feed' synchronization
    if (rtdb) {
      if (activityType === 'post' || activityType === 'profile_picture') {
        await syncFeedRtdbOnly(initiatorId, taggedUserIds);
      } else {
        // Resolve recipient user ID for targeted reactions
        let recipientId = targetUserId;

        if (!recipientId && postId) {
          const { data: post } = await supabase
            .from('posts')
            .select('user_id')
            .eq('id', postId)
            .maybeSingle();
          if (post) recipientId = post.user_id;
        }

        if (!recipientId && connectionRequestId) {
          const { data: req } = await supabase
            .from('connection_requests')
            .select('receiver_id')
            .eq('id', connectionRequestId)
            .maybeSingle();
          if (req) recipientId = req.receiver_id;
        }

        // Build list of all targets for RTDB sync in comment / like
        const allTargets = Array.from(new Set([
          ...(recipientId ? [recipientId] : []),
          ...(taggedUserIds || [])
        ])).filter(uid => uid && uid !== initiatorId);

        if (allTargets.length > 0) {
          await Promise.all(
            allTargets.map(async (uid) => {
              // Check if user is muted (only apply mute check for regular recipient if they aren't tagged)
              const isTagged = taggedUserIds?.includes(uid);
              if (!isTagged && uid === recipientId) {
                const { data: isMuted } = await supabase
                  .from('connections')
                  .select('user_id')
                  .eq('user_id', recipientId)
                  .eq('connection_id', initiatorId)
                  .eq('is_activity_muted', true)
                  .maybeSingle();

                if (isMuted) return; // Skip if muted and not tagged
              }

              try {
                const feedNodeRef = ref(rtdb, `feed/${uid}`);
                const currentFeedValSnap = await get(feedNodeRef);
                const currentFeedVal = currentFeedValSnap.val();

                await set(feedNodeRef, initiatorId);

                if (!currentFeedVal || currentFeedVal === "") {
                  // Check if recipient is online
                  const presenceSnap = await get(ref(rtdb, `global_presence/${uid}`));
                  const isOnline = presenceSnap.val() === true;
                  
                  if (!isOnline) {
                    const uCountRef = ref(rtdb, `unseen_chat_count/${uid}`);
                    await runTransaction(uCountRef, (val) => (val || 0) + 1);
                  }
                }
              } catch (e) {
                console.warn(`[FeedActivity] RTDB target sync error for recipient ${uid}:`, e);
              }
            })
          );
        }
      }
    }
  } catch (err) {
    console.error('[FeedActivity] Network failure logging action:', err);
  }
}
