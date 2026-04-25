import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import BottomNav from './components/BottomNav';
import Feed from './components/Feed';
import ProfileView from './components/Profile';
import AuthView from './components/Auth';
import CreatePost from './components/CreatePost';
import { Profile, Post } from './types';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('feed');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    // If returning from OAuth provider, clean up the URL to prevent showing the callback path
    if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
      window.history.replaceState({}, document.title, '/');
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Profile not found or error fetching:', error.message);
        if (error.code === '42P01') {
           // PostgreSQL relation does not exist
           alert('DATABASE ERROR: The "profiles" table does not exist in your Supabase database!\n\nPlease go to Supabase -> SQL Editor and paste the contents of SCHEMA.sql to create the tables.');
        } else {
           await createInitialProfile(userId);
        }
      } else {
        setProfile(data);
        fetchUserPosts(userId);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  }

  async function createInitialProfile(userId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    const username = user?.email?.split('@')[0] || `user_${userId.slice(0, 5)}`;
    
    const { data: newProfile, error } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        username,
        full_name: user?.user_metadata?.full_name || username,
        avatar_url: user?.user_metadata?.avatar_url || null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (!error) {
      setProfile(newProfile);
    }
  }

  async function fetchUserPosts(userId: string) {
    const { data } = await supabase
      .from('posts')
      .select('*, profiles(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (data) setUserPosts(data as any);
  }

  if (!session) {
    return <AuthView />;
  }

  return (
    <div className="min-h-screen bg-black text-white font-sans max-w-lg mx-auto border-x border-white/5 relative">
      {/* Header */}
      <header className="sticky top-0 z-40 h-14 flex items-center justify-between px-4 glass border-b border-white/10">
        <h1 className="text-xl font-bold tracking-tighter uppercase italic">Socium</h1>
        <div className="flex space-x-4 opacity-60">
          {/* Action icons could go here */}
        </div>
      </header>

      {/* Main View Area */}
      <main className="min-h-screen pb-24 overflow-x-hidden">
        <AnimatePresence mode="wait">
           {activeTab === 'feed' && (
             <motion.div 
               key="feed" 
               initial={{ opacity: 0, x: -20 }} 
               animate={{ opacity: 1, x: 0 }} 
               exit={{ opacity: 0, x: 20 }}
               className="page-transition"
             >
               <Feed />
             </motion.div>
           )}
           
           {activeTab === 'profile' && (
             <motion.div 
               key="profile" 
               initial={{ opacity: 0, scale: 0.95 }} 
               animate={{ opacity: 1, scale: 1 }} 
               exit={{ opacity: 0, scale: 1.05 }}
               className="page-transition min-h-screen"
             >
               {profile ? (
                 <ProfileView 
                   profile={profile} 
                   posts={userPosts} 
                   isOwnProfile={true} 
                 />
               ) : (
                 <div className="flex flex-col items-center justify-center pt-40 px-4 text-center">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
                    <p className="text-white/50 text-sm">Building profile...</p>
                 </div>
               )}
             </motion.div>
           )}

           {activeTab === 'create' && (
             <CreatePost 
                userId={session.user.id}
                onSuccess={() => {
                  setActiveTab('feed');
                  fetchUserPosts(session.user.id);
                }}
                onCancel={() => setActiveTab('feed')}
             />
           )}
        </AnimatePresence>
      </main>

      {/* Navigation */}
      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}
