import { useState, useEffect } from 'react';
import { X, Search, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { checkRecipientPresenceAndNotify } from '../lib/presence';

interface ShareTarget {
  id: string; // Profile ID for 1-on-1, or Group Chat ID for group
  name: string;
  avatar_url: string | null;
  isGroup: boolean;
  username?: string;
}

export default function SharePostModal() {
  const { sharePost, setSharePost, profile } = useStore();
  const [loading, setLoading] = useState(false);
  const [targets, setTargets] = useState<ShareTarget[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sendingMap, setSendingMap] = useState<Record<string, boolean>>({});
  const [sentMap, setSentMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!sharePost || !profile?.id) return;

    const fetchTargets = async () => {
      setLoading(true);
      try {
        const currentUserId = profile.id;

        // 1. Fetch 1-on-1 connections
        const { data: rel1 } = await supabase
          .from('connections')
          .select('*, profiles!connections_receiver_id_fkey(*)')
          .eq('requester_id', currentUserId)
          .eq('status', 'accepted');

        const { data: rel2 } = await supabase
          .from('connections')
          .select('*, profiles!connections_requester_id_fkey(*)')
          .eq('receiver_id', currentUserId)
          .eq('status', 'accepted');

        // Include admin profile by default if present
        const ADMIN_ID = '0f6e2346-107e-4d8e-8e7c-9ea1e74ecae2';
        const { data: adminProf } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', ADMIN_ID)
          .maybeSingle();

        const combinedProfs = [
          ...(rel1?.map((c) => c.profiles) || []),
          ...(rel2?.map((c) => c.profiles) || []),
        ].filter(Boolean);

        if (adminProf && !combinedProfs.some((p) => p.id === ADMIN_ID) && currentUserId !== ADMIN_ID) {
          combinedProfs.push(adminProf);
        }

        const deduplicatedProfs = Array.from(
          new Map(combinedProfs.map((item) => [item.id, item])).values()
        );

        // 2. Fetch Group Chats
        const { data: groupParticipants } = await supabase
          .from('group_chat_participants')
          .select('chat_id')
          .eq('user_id', currentUserId);

        const groupChatIds = groupParticipants?.map((p) => p.chat_id) || [];
        let groupChats: any[] = [];

        if (groupChatIds.length > 0) {
          const { data } = await supabase
            .from('group_chats')
            .select('*')
            .in('id', groupChatIds);
          if (data) {
            groupChats = data;
          }
        }

        // 3. Map to targets list
        const list: ShareTarget[] = [
          ...deduplicatedProfs.map((p) => ({
            id: p.id,
            name: p.full_name || p.username || 'Unknown',
            avatar_url: p.avatar_url || null,
            isGroup: false,
            username: p.username,
          })),
          ...groupChats.map((g) => ({
            id: g.id,
            name: g.name || 'Group Chat',
            avatar_url: g.avatar_url || null,
            isGroup: true,
          })),
        ];

        setTargets(list);
      } catch (err) {
        console.error('Error loading share targets:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTargets();
    setSendingMap({});
    setSentMap({});
  }, [sharePost, profile?.id]);

  const handleClose = () => {
    setSharePost(null);
  };

  const handleSend = async (target: ShareTarget) => {
    if (sendingMap[target.id] || sentMap[target.id]) return;

    setSendingMap((prev) => ({ ...prev, [target.id]: true }));

    try {
      const currentUserId = profile!.id;
      const previewText = sharePost?.caption 
        ? sharePost.caption.substring(0, 100) 
        : 'Shared a post';

      // Insert message into the database
      const { data: insertedMsg, error } = await supabase
        .from('messages')
        .insert({
          sender_id: currentUserId,
          receiver_id: target.isGroup ? null : target.id,
          group_chat_id: target.isGroup ? target.id : null,
          content: previewText,
          media_type: 'shared_post',
          metadata: {
            shared_post_id: sharePost?.id,
          },
        })
        .select()
        .single();

      if (error) throw error;

      // Update map to show "Sent" state
      setSentMap((prev) => ({ ...prev, [target.id]: true }));

      // If it's a 1-on-1 chat, manually trigger FCM and presence check
      if (!target.isGroup) {
        checkRecipientPresenceAndNotify(currentUserId, target.id, currentUserId, insertedMsg);
      }
    } catch (err) {
      console.error('Failed to send shared post:', err);
    } finally {
      setSendingMap((prev) => ({ ...prev, [target.id]: false }));
    }
  };

  const filteredTargets = targets.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.username && t.username.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const images = sharePost?.image_url?.split(',').filter(Boolean) || [];
  const hasImage = images.length > 0;

  return (
    <AnimatePresence>
      {sharePost && profile?.id && (
        <motion.div 
          id="share-post-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeInOut" }}
          className="fixed inset-0 bg-black z-[999] flex flex-col"
        >
          <motion.div 
            id="share-post-modal"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="flex-1 bg-black flex flex-col h-full px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
              <h2 className="text-xl font-bold text-white tracking-tight">Share Post</h2>
              <button 
                onClick={handleClose}
                className="p-2 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white active:scale-95 transition-all outline-none"
              >
                <X size={20} />
              </button>
            </div>

            {/* Mini Post Card Preview */}
            <div className="bg-white/[0.03] border border-white/5 p-4 rounded-2xl flex items-center gap-4 mb-6 select-none">
              {hasImage ? (
                <img 
                  src={images[0]} 
                  className="w-16 h-16 rounded-xl object-cover shrink-0 border border-white/10" 
                  alt="" 
                />
              ) : (
                <div className="w-16 h-16 bg-white/5 border border-white/5 rounded-xl flex items-center justify-center shrink-0">
                  <Send size={24} className="text-white/30" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white tracking-tight truncate">
                  {sharePost.profiles?.full_name || sharePost.profiles?.username || 'Author'}
                </p>
                <p className="text-xs text-white/50 truncate mt-1">
                  {sharePost.caption || 'No caption text'}
                </p>
              </div>
            </div>

            {/* Search */}
            <div className="relative mb-6">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-sm font-medium bg-white/[0.04] border border-white/10 rounded-full py-3.5 pl-11 pr-4 text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all"
              />
            </div>

            {/* Chats List */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar scroll-smooth">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span className="text-xs text-white/40">Loading conversations...</span>
                </div>
              ) : filteredTargets.length === 0 ? (
                <div className="text-center py-20 text-white/30 text-xs">
                  No conversations found
                </div>
              ) : (
                filteredTargets.map((target) => {
                  const sending = sendingMap[target.id];
                  const sent = sentMap[target.id];

                  return (
                    <div 
                      key={target.id} 
                      className="flex items-center justify-between py-3 px-3.5 hover:bg-white/[0.015] border border-transparent hover:border-white/[0.02] rounded-2xl transition-all duration-200"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-12 h-12 rounded-full overflow-hidden bg-white/5 flex items-center justify-center shrink-0 border border-white/10">
                          {target.avatar_url ? (
                            <img 
                              src={target.avatar_url} 
                              className="w-full h-full object-cover" 
                              alt="" 
                            />
                          ) : (
                            <span className="text-sm text-white/40 font-bold uppercase">
                              {target.name.charAt(0)}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white tracking-tight truncate">
                            {target.name}
                          </p>
                          <p className="text-xs text-white/40 truncate mt-0.5">
                            {target.isGroup 
                              ? 'Group Chat' 
                              : target.username 
                                ? `@${target.username}` 
                                : 'Direct Message'}
                          </p>
                        </div>
                      </div>

                      {/* Send Button */}
                      <button
                        disabled={sending || sent}
                        onClick={() => handleSend(target)}
                        className={`h-9 min-w-[76px] px-4 rounded-full text-xs font-bold active:scale-95 transition-all duration-300 ease-in-out border select-none flex items-center justify-center ${
                          sent
                            ? 'bg-black text-white border-white/25 shadow-sm shadow-white/5'
                            : sending
                              ? 'bg-white/10 text-white/50 border-transparent cursor-not-allowed'
                              : 'bg-white text-black border-transparent hover:bg-white/90'
                        }`}
                      >
                        {sent ? (
                          'Sent'
                        ) : sending ? (
                          <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        ) : (
                          'Send'
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
