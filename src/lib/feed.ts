import { supabase } from './supabase';
import { rtdb } from './firebase';
import { ref, set } from 'firebase/database';

export interface FeedActivityPayload {
  activityType: 'post' | 'like' | 'comment' | 'connection_request';
  initiatorId: string;
  postId?: string | null;
  commentId?: string | null;
  connectionRequestId?: string | null;
  targetUserId?: string | null;
  taggedUserIds?: string[] | null;
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
    const { data: insertedActivity, error } = await supabase
      .from('feed_activity')
      .insert({
        activity_type: activityType,
        initiator_id: initiatorId,
        post_id: postId || null,
        comment_id: commentId || null,
        connection_request_id: connectionRequestId || null,
        tagged_user_ids: taggedUserIds || null,
      })
      .select()
      .maybeSingle();

    if (error) {
      console.error('[FeedActivity] SQL insertion failed:', error);
    }

    // 2. Client-side Realtime Database 'feed' synchronization
    if (rtdb) {
      if (activityType === 'post') {
        // Query initiator's active, non-muted connections to trigger feed ring and vibe overrides
        const { data: conns } = await supabase
          .from('connections')
          .select('user_id')
          .eq('connection_id', initiatorId)
          .eq('is_activity_muted', false);

        const connectionIds = (conns || []).map(c => c.user_id).filter(Boolean) as string[];
        
        // Combine connections and tagged users for RTDB sync
        const allTargets = Array.from(new Set([...connectionIds, ...(taggedUserIds || [])])).filter(uid => uid && uid !== initiatorId);

        if (allTargets.length > 0) {
          await Promise.all(
            allTargets.map(async (uid) => {
              try {
                await set(ref(rtdb, `feed/${uid}`), initiatorId);
              } catch (e) {
                console.warn(`[FeedActivity] RTDB sync error for user ${uid}:`, e);
              }
            })
          );
        }
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
                await set(ref(rtdb, `feed/${uid}`), initiatorId);
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
