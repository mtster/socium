import { Post, PostVisibilityMode } from '@/src/types';

export const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
export const HUMOR_BOT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Checks whether a post is visible to a given viewer.
 *
 * Rules:
 * 1. Post author can always view their own post.
 * 2. Admin can always view all posts.
 * 3. Humor department bot posts bypass all restrictions (always viewable).
 * 4. Mode 'allowed_list': Only users whose UUID is in `audience` can view.
 * 5. Mode 'except_list': All connections of the author except those in `audience` can view.
 * 6. Mode 'all_connections': All connections of the author can view.
 * 7. Legacy fallback: if visible_to array exists, only users in visible_to can view.
 */
export function isPostVisibleToUser(
  rawPost: any,
  viewerId?: string | null,
  isConnection: boolean = true
): boolean {
  if (!rawPost || !viewerId) return false;

  // Handle case where post is returned as an array from a PostgREST join (e.g. act.post = [{...}])
  const post = Array.isArray(rawPost) ? rawPost[0] : rawPost;
  if (!post || typeof post !== 'object') return false;

  const postUserId = post.user_id;
  const normalizedViewerId = String(viewerId).toLowerCase().trim();
  const normalizedPostUserId = postUserId ? String(postUserId).toLowerCase().trim() : '';

  // 1. Author can always see their own post
  if (normalizedViewerId === normalizedPostUserId) return true;

  // 2. Admin can always see everything
  if (normalizedViewerId === ADMIN_ID.toLowerCase()) return true;

  // 3. Humor department bot posts bypass all restrictions
  if (normalizedPostUserId === HUMOR_BOT_ID.toLowerCase()) return true;

  const mode = (post.visibility_mode as PostVisibilityMode) || 'all_connections';
  const audience = Array.isArray(post.audience) 
    ? post.audience.map((id: any) => String(id).toLowerCase().trim()) 
    : [];

  if (mode === 'allowed_list') {
    return audience.includes(normalizedViewerId);
  }

  if (mode === 'except_list') {
    if (!isConnection) return false;
    return !audience.includes(normalizedViewerId);
  }

  // mode === 'all_connections'
  // Backward compatibility with legacy visible_to column if still present in old posts
  if (post.visible_to && Array.isArray(post.visible_to) && post.visible_to.length > 0) {
    const legacyVisibleTo = post.visible_to.map((id: any) => String(id).toLowerCase().trim());
    return legacyVisibleTo.includes(normalizedViewerId);
  }

  return isConnection;
}
