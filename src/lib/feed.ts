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
}

export async function logFeedActivity({
  activityType,
  initiatorId,
  postId,
  commentId,
  connectionRequestId,
  targetUserId,
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

        if (conns && conns.length > 0) {
          await Promise.all(
            conns.map(async (c) => {
              if (c.user_id) {
                try {
                  await set(ref(rtdb, `feed/${c.user_id}`), initiatorId);
                } catch (e) {
                  console.warn(`[FeedActivity] RTDB sync error for user ${c.user_id}:`, e);
                }
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

        // Write targeted indicator to recipient's feed node (if not self and not muted)
        if (recipientId && recipientId !== initiatorId) {
          const { data: isMuted } = await supabase
            .from('connections')
            .select('user_id')
            .eq('user_id', recipientId)
            .eq('connection_id', initiatorId)
            .eq('is_activity_muted', true)
            .maybeSingle();

          if (!isMuted) {
            try {
              await set(ref(rtdb, `feed/${recipientId}`), initiatorId);
            } catch (e) {
              console.warn(`[FeedActivity] RTDB target sync error for recipient ${recipientId}:`, e);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[FeedActivity] Network failure logging action:', err);
  }
}
