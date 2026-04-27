import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/src/lib/supabase';
import { Profile } from '@/src/types';

export default function CompleteProfileModal({ profile, onComplete }: { profile: Profile | null, onComplete: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const hasCompleted = localStorage.getItem(`socium_name_prompt_${profile.id}`);
    if (!hasCompleted) {
      // Pre-fill if they have a full name
      if (profile.full_name) {
        const parts = profile.full_name.split(' ');
        setFirstName(parts[0] || '');
        setLastName(parts.slice(1).join(' ') || '');
      }
      setIsVisible(true);
    }
  }, [profile]);

  if (!isVisible || !profile) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) return;
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

  const handleSkip = () => {
    localStorage.setItem(`socium_name_prompt_${profile.id}`, 'true');
    setIsVisible(false);
    onComplete();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          className="bg-[#111] border border-white/10 rounded-3xl p-6 w-full max-w-sm relative"
        >
          <h2 className="text-2xl font-bold tracking-tight mb-2 text-white">Configure Profile</h2>
          <p className="text-sm text-white/60 leading-relaxed mb-6">
            We recommend you input your real first and last name so that your friends can find you on Socium.
          </p>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-widest text-white/40 ml-1">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                autoFocus
                placeholder="e.g. John"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-widest text-white/40 ml-1">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="e.g. Doe"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>

            <div className="pt-4 flex flex-col space-y-3">
              <button
                type="submit"
                disabled={saving || !firstName.trim()}
                className="w-full bg-white text-black font-bold py-3.5 rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
              >
                {saving ? 'Saving...' : 'Save & Continue'}
              </button>
              <button
                type="button"
                onClick={handleSkip}
                disabled={saving}
                className="w-full text-white/40 font-bold py-2 text-sm active:scale-95 transition-transform hover:text-white/70"
              >
                Skip for now
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
