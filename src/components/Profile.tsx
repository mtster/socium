import React from 'react';
import { Settings, Grid, Bookmark, List } from 'lucide-react';
import { Profile, Post } from '@/src/types';
import { cn } from '@/src/lib/utils';

interface ProfileViewProps {
  profile: Profile;
  posts: Post[];
  isOwnProfile?: boolean;
}

export default function ProfileView({ profile, posts, isOwnProfile }: ProfileViewProps) {
  return (
    <div className="pb-20">
      {/* Header */}
      <div className="px-4 py-6">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold tracking-tight">{profile.username}</h1>
          <div className="flex items-center space-x-4">
            {isOwnProfile && <Settings size={24} />}
          </div>
        </div>

        <div className="flex items-center space-x-8 mb-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-white/10 ring-2 ring-white/20 p-1">
              <img 
                src={profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.username}`} 
                alt="" 
                className="w-full h-full rounded-full object-cover" 
              />
            </div>
            {isOwnProfile && (
              <button className="absolute bottom-0 right-0 bg-white text-black rounded-full p-1 border-2 border-black">
                <span className="sr-only">Change photo</span>
              </button>
            )}
          </div>

          <div className="flex-1 flex justify-around">
            <div className="text-center">
              <p className="font-bold">{posts.length}</p>
              <p className="text-[10px] text-white/50 uppercase tracking-wider">Posts</p>
            </div>
            <div className="text-center">
              <p className="font-bold">0</p>
              <p className="text-[10px] text-white/50 uppercase tracking-wider">Followers</p>
            </div>
            <div className="text-center">
              <p className="font-bold">0</p>
              <p className="text-[10px] text-white/50 uppercase tracking-wider">Following</p>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <p className="text-sm font-bold mb-1">{profile.full_name || profile.username}</p>
          <p className="text-sm text-white/80 leading-relaxed max-w-xs">{profile.bio || "No bio yet."}</p>
        </div>

        {isOwnProfile && (
          <button className="w-full bg-white text-black font-semibold rounded-lg py-2 text-sm transition-transform active:scale-95">
            Edit Profile
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-t border-white/10">
        <button className="flex-1 py-3 flex justify-center text-white border-t border-white">
          <Grid size={22} />
        </button>
        <button className="flex-1 py-3 flex justify-center text-white/30">
          <List size={22} />
        </button>
        <button className="flex-1 py-3 flex justify-center text-white/30">
          <Bookmark size={22} />
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 gap-[1px]">
        {posts.map((post) => (
          <div key={post.id} className="aspect-square bg-white/5">
            <img src={post.image_url} alt="" className="w-full h-full object-cover" />
          </div>
        ))}
        {posts.length === 0 && (
          <div className="col-span-3 py-20 flex flex-col items-center justify-center text-white/20">
             <Grid size={32} className="mb-3 opacity-10" />
             <p className="text-xs uppercase tracking-widest font-medium">No posts shared yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
