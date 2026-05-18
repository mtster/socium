import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { supabase } from '@/src/lib/supabase';

export function GroupAddMembersModal({ isOpen, onClose, activeChat, currentUserId, onAdded }: any) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchUsers = async () => {
      setLoading(true);
      
      let data = [];
      if (query.trim().length >= 1) {
        const res = await supabase.from('profiles').select('*')
          .or(`full_name.ilike.%${query}%,username.ilike.%${query}%`)
          .neq('id', currentUserId)
          .limit(20);
        data = res.data || [];
      } else {
        const res = await supabase.from('profiles').select('*').neq('id', currentUserId).limit(20);
        data = res.data || [];
      }
      
      if (active) {
        setResults(data);
        setLoading(false);
      }
    };
    fetchUsers();
    return () => { active = false; };
  }, [query, currentUserId]);

  const existingIds = (activeChat.participants || []).map((p: any) => p.id);

  const toggleSelect = (id: string) => {
    if (existingIds.includes(id)) return;
    if (selectedIds.includes(id)) setSelectedIds(prev => prev.filter(x => x !== id));
    else setSelectedIds(prev => [...prev, id]);
  };

  const handleAdd = async () => {
    if (!selectedIds.length) return;
    setSaving(true);
    try {
      const inserts = selectedIds.map(id => ({
         chat_id: activeChat.id,
         user_id: id
      }));
      const { error } = await supabase.from('group_chat_participants').insert(inserts);
      if (error) throw error;
      
      const { data: profiles } = await supabase.from('profiles').select('*').in('id', selectedIds);
      
      // Insert a system message letting everyone know
      const currentUserName = document.querySelector('header')?.textContent?.includes('Socium') ? 'Someone' : 'Someone'; 
      // Actually we have currentUserId, we can fetch our own profile name if needed, 
      // but let's just insert a message with a specific text.
      const namesStr = profiles?.map(p => p.full_name).join(', ') || 'members';
      await supabase.from('messages').insert({
         sender_id: currentUserId,
         group_chat_id: activeChat.id,
         content: 'added members',
         media_type: 'system',
         metadata: { type: 'USER_ADDED', actorId: currentUserId, addedNames: namesStr }
      });

      onAdded(profiles || []);
      onClose();
    } catch (e: any) {
      alert("Failed to add members: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.3 }} className="fixed inset-0 z-[90] bg-[#121212] flex flex-col pt-safe">
        <div className="flex items-center gap-4 p-4 border-b border-white/10 shrink-0">
           <button onClick={onClose} className="p-2 -ml-2 text-white/50 active:scale-95"><X size={24} /></button>
           <h2 className="text-lg font-bold text-white flex-1">Add Members</h2>
           <button onClick={handleAdd} disabled={saving || !selectedIds.length} className="text-[13px] font-bold text-black bg-white px-4 py-1.5 rounded-full data-[disabled=true]:opacity-50">
             {saving ? 'Adding...' : 'Add'}
           </button>
        </div>
        
        <div className="p-4 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
            <input 
              type="text" 
              placeholder="Search people..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-white/10 text-white placeholder-white/40 rounded-full py-2.5 pl-10 pr-4 outline-none focus:bg-white/15 transition-colors text-[15px]" 
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-10">
          {loading ? (
             <div className="flex justify-center mt-10"><span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>
          ) : (
            <div className="flex flex-col gap-2">
              {results.map((p: any) => {
                 const isExisting = existingIds.includes(p.id);
                 const isSelected = selectedIds.includes(p.id);
                 return (
                   <div key={p.id} onClick={() => toggleSelect(p.id)} className={cn("flex items-center gap-3 p-3 rounded-2xl transition-colors", !isExisting && "cursor-pointer active:bg-white/5", isExisting && "opacity-50")}>
                     <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10 shrink-0">
                       {p.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-white/50">{p.full_name?.charAt(0).toUpperCase()}</div>}
                     </div>
                     <div className="flex-1 min-w-0">
                        <span className="font-bold text-white flex items-center gap-2">{p.full_name}</span>
                        <span className="text-white/40 text-sm truncate block">@{p.username}</span>
                     </div>
                     <div className={cn("w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-colors", isSelected || isExisting ? "border-white bg-white text-black" : "border-white/20")}>
                        {(isSelected || isExisting) && <div className="w-3 h-3 rounded-full bg-black" />}
                     </div>
                   </div>
                 )
              })}
            </div>
          )}
        </div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
