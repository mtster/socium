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
  post: {
    user_id: string;
    visibility_mode?: PostVisibilityMode | string | null;
    audience?: string[] | null;
    visible_to?: string[] | null;
  },
  viewerId?: string | null,
  isConnection: boolean = true
): boolean {
  if (!viewerId) return false;

  // 1. Author can always see their own post
  if (viewerId === post.user_id) return true;

  // 2. Admin can always see everything
  if (viewerId === ADMIN_ID) return true;

  // 3. Humor department bot posts bypass all restrictions
  if (post.user_id === HUMOR_BOT_ID) return true;

  const mode = (post.visibility_mode as PostVisibilityMode) || 'all_connections';
  const audience = Array.isArray(post.audience) ? post.audience : [];

  if (mode === 'allowed_list') {
    return audience.includes(viewerId);
  }

  if (mode === 'except_list') {
    if (!isConnection) return false;
    return !audience.includes(viewerId);
  }

  // mode === 'all_connections'
  // Backward compatibility with legacy visible_to column if still present in old posts
  if (post.visible_to && Array.isArray(post.visible_to) && post.visible_to.length > 0) {
    return post.visible_to.includes(viewerId);
  }

  return isConnection;
}
