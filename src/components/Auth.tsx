import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { Mail } from 'lucide-react';
import { motion } from 'motion/react';

// Google icon component
const GoogleIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

export default function AuthView() {
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    if (!isSupabaseConfigured) {
      alert('Error: Supabase environment variables are missing! Your Vercel deployment variables are either missing or the project must be rebuilt.');
      return;
    }

    try {
      setLoading(true);
      
      // Determine the redirect URL based on environment
      let siteUrl = '';
      // @ts-ignore
      if (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_SITE_URL) {
        // @ts-ignore
        siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
      } else if (import.meta.env.VITE_SITE_URL) {
        siteUrl = import.meta.env.VITE_SITE_URL;
      } else if (typeof window !== 'undefined') {
        siteUrl = window.location.origin;
      }

      const redirectTo = `${siteUrl.replace(/\/$/, '')}/auth/callback`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo
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
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full bg-white text-black font-bold h-14 rounded-2xl flex items-center justify-center space-x-3 active:scale-95 transition-transform"
          >
            <GoogleIcon size={22} />
            <span>Continue with Google</span>
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
