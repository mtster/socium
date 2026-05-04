import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search as SearchIcon, X, User } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { motion } from 'motion/react';
import { Profile } from '@/src/types';

interface UserSearchModalProps {
  onClose: () => void;
  onUserClick: (userId: string) => void;
}

export default function UserSearchModal({ onClose, onUserClick }: UserSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const searchUsers = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .or(`username.ilike.%${query}%,full_name.ilike.%${query}%,email.ilike.%${query}%`)
          .limit(10);

        if (error) throw error;
        setResults(data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(searchUsers, 300);
    return () => clearTimeout(debounce);
  }, [query]);

  return createPortal(
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed inset-0 z-[500] bg-black flex flex-col"
    >
      <div className="flex items-center px-4 h-16 pt-[env(safe-area-inset-top)] border-b border-white/10 shrink-0">
        <div className="flex-1 relative flex items-center">
          <SearchIcon size={18} className="absolute left-3 text-white/40" />
          <input 
            autoFocus
            type="text" 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for connections..." 
            className="w-full bg-white/5 border border-white/10 rounded-full h-10 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-all font-medium text-white"
          />
        </div>
        <button onClick={onClose} className="ml-4 text-white/60 active:scale-95 transition-transform p-2">
          Cancel
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {loading && <div className="text-center text-white/40 text-sm">Searching...</div>}
        
        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <div className="text-center text-white/40 text-sm py-10">No users found.</div>
        )}

        <div className="space-y-4">
          {results.map((user) => (
            <div 
              key={user.id} 
              className="flex items-center space-x-4 p-3 rounded-2xl hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer"
              onClick={() => {
                onClose();
                onUserClick(user.id);
              }}
            >
              <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0 flex items-center justify-center">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User size={24} className="text-white/40" />
                )}
              </div>
              <div>
                <p className="font-bold text-sm text-white">{user.full_name || user.username}</p>
                <p className="text-xs text-white/50 tracking-wide">@{user.username}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>,
    document.body
  );
}
