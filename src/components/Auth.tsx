import React, { useState } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Github, Mail } from 'lucide-react';
import { motion } from 'motion/react';

export default function AuthView() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');

  const handleGitHubLogin = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
    } catch (error) {
      console.error('Auth error:', error);
      alert('Authentication failed. Check your Supabase configuration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-8 relative overflow-hidden">
      {/* Abstract Background Accents */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/5 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm text-center relative z-10"
      >
        <div className="inline-block p-4 rounded-3xl bg-white/5 border border-white/10 mb-8">
           <div className="w-16 h-16 bg-white text-black rounded-2xl flex items-center justify-center font-black text-3xl">S</div>
        </div>
        
        <h1 className="text-4xl font-bold tracking-tight mb-2">Socium</h1>
        <p className="text-white/40 text-sm mb-12 uppercase tracking-widest font-medium">Join the connection</p>

        <div className="space-y-4">
          <button
            onClick={handleGitHubLogin}
            disabled={loading}
            className="w-full bg-white text-black font-bold h-14 rounded-2xl flex items-center justify-center space-x-3 active:scale-95 transition-transform"
          >
            <Github size={22} fill="black" />
            <span>Continue with GitHub</span>
          </button>

          <div className="flex items-center my-8">
            <div className="flex-1 h-[1px] bg-white/10" />
            <span className="px-4 text-[10px] text-white/20 uppercase tracking-[0.2em]">Social login requested</span>
            <div className="flex-1 h-[1px] bg-white/10" />
          </div>

          <p className="text-[10px] text-white/30 px-4 leading-relaxed">
            By continuing, you agree to our terms of service and recognize that this is a premium dark-themed social experience.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
