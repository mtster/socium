import { supabase } from './supabase';

export interface FeedActivityPayload {
  activityType: 'post' | 'like' | 'comment' | 'connection_request';
  initiatorId: string;
  postId?: string | null;
  commentId?: string | null;
  connectionRequestId?: string | null;
}

export async function logFeedActivity({
  activityType,
  initiatorId,
  postId,
  commentId,
  connectionRequestId,
}: FeedActivityPayload) {
  try {
    const { error } = await supabase.from('feed_activity').insert({
      activity_type: activityType,
      initiator_id: initiatorId,
      post_id: postId || null,
      comment_id: commentId || null,
      connection_request_id: connectionRequestId || null,
    });
    if (error) {
      console.error('[FeedActivity] SQL insertion failed:', error);
    }
  } catch (err) {
    console.error('[FeedActivity] Network failure logging action:', err);
  }
}
