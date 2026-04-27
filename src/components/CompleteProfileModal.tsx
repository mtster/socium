import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/src/lib/supabase';
import { Profile } from '@/src/types';

export default function CompleteProfileModal({ profile, onComplete }: { profile: Profile | null, onComplete: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);

  const [isClosable, setIsClosable] = useState(false);

  useEffect(() => {
    if (!profile) return;
    
    // Auto-open only for new users who don't have a full name saved yet
    const hasCompleted = localStorage.getItem(`socium_name_prompt_${profile.id}`);
    if (!profile.full_name && !hasCompleted) {
      setIsVisible(true);
      setIsClosable(false);
    }

    const handleOpen = () => {
      if (profile.full_name) {
        const parts = profile.full_name.split(' ');
        setFirstName(parts[0] || '');
        setLastName(parts.slice(1).join(' ') || '');
      }
      setIsVisible(true);
      setIsClosable(true);
    };

    window.addEventListener('openCompleteProfile', handleOpen);
    return () => window.removeEventListener('openCompleteProfile', handleOpen);
  }, [profile]);

  if (!isVisible || !profile) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;
    setSaving(true);
    try {
      const newFullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      await supabase.from('profiles').update({ full_name: newFullName }).eq('id', profile.id);
      localStorage.setItem(`socium_name_prompt_${profile.id}`, 'true');
      setIsVisible(false);
      onComplete();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (isClosable && firstName.trim() && lastName.trim()) {
      setIsVisible(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-3xl flex flex-col justify-end sm:justify-center"
      >
        <motion.div
          initial={{ y: '100%', scale: 1 }}
          animate={{ y: 0, scale: 1 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="bg-black border-t border-white/10 sm:border sm:rounded-3xl rounded-t-3xl p-6 sm:p-8 pt-8 pb-safe shadow-2xl w-full sm:max-w-md mx-auto relative"
        >
          {isClosable && (
            <button 
              onClick={handleClose}
              className="absolute top-6 right-6 text-white/50 hover:text-white p-2"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          )}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1 bg-white/20 rounded-full sm:hidden" />
          
          <h2 className="text-2xl font-bold tracking-tight mb-2 text-white mt-2">Welcome to Socium</h2>
          <p className="text-sm text-white/50 leading-relaxed mb-8 font-medium">
            We recommend you input your real first and last names so that your friends can find you on Socium.
          </p>

          <form onSubmit={handleSave} className="space-y-6">
            <div className="space-y-4">
              <div className="relative">
                <input
                  type="text"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  autoFocus
                  placeholder="First Name"
                  className="w-full bg-transparent border-b border-white/20 px-1 py-3 text-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white transition-colors"
                />
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Last Name"
                  className="w-full bg-transparent border-b border-white/20 px-1 py-3 text-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white transition-colors"
                />
              </div>
            </div>

            <div className="pt-6 pb-2">
              <button
                type="submit"
                disabled={saving || !firstName.trim() || !lastName.trim()}
                className="w-full bg-white text-black font-bold py-4 rounded-full disabled:opacity-30 active:scale-95 transition-transform"
              >
                {saving ? 'Saving...' : 'Continue'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
