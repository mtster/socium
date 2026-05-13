import { Profile } from '@/src/types';

export type GroupChat = {
  id: string;
  name: string | null;
  avatar_url: string | null;
  admin_id: string;
  allow_member_edit: boolean;
  created_at: string;
  updated_at: string;
};

export type ChatListItemType = {
  id: string; // profile.id OR group_chat.id
  isGroup: boolean;
  name: string;
  avatar_url: string | null;
  lastMessage?: any;
  unreadCount?: number;
  
  // For 1-on-1
  profile?: Profile;
  
  // For Groups
  groupChat?: GroupChat;
  participants?: Profile[];
};
