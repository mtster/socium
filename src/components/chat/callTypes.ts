export interface CallMeta {
  id: string;
  caller_id: string;
  caller_name: string;
  caller_avatar: string | null;
  chat_room_id: string;
  is_group: boolean;
  type: 'audio' | 'video';
  room_name: string;
  room_avatar: string | null;
}

export interface CfSession {
  sessionId: string;
  audioTrackName: string | null;
  videoTrackName: string | null;
}

export interface Participant {
  status: 'ringing' | 'accepted' | 'declined';
  name?: string;
  avatar_url?: string | null;
  cf_session?: CfSession;
  video_disabled?: boolean;
}

export interface CallNode {
  meta: CallMeta;
  participants: Record<string, Participant>;
  signaling?: Record<string, any>;
  caller_cf_session?: CfSession;
  caller_video_disabled?: boolean;
  status?: 'dialing' | 'accepted' | 'ended';
  meetingId?: string;
}
