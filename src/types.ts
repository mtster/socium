export interface Profile {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  avatar_hd_url?: string | null;
  bio: string | null;
  updated_at: string;
}

export type PostVisibilityMode = 'all_connections' | 'allowed_list' | 'except_list';

export interface Post {
  id: string;
  user_id: string;
  image_url: string | null;
  caption: string | null;
  visibility_mode?: PostVisibilityMode;
  audience?: string[] | null;
  visible_to?: string[] | null;
  is_profile_picture_update?: boolean;
  created_at: string;
  profiles: Profile;
  likes_count?: number;
  has_liked?: boolean;
  comments_count?: number;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles: Profile;
}

export interface Connection {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  profiles?: Profile;
}
