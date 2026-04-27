import React from 'react';
import { Home, User, PlusSquare, Search, MessageCircle } from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  unreadCount?: number;
}

export default function BottomNav({ activeTab, setActiveTab, unreadCount = 0 }: BottomNavProps) {
  const tabs = [
    { id: 'feed', icon: Home, label: 'Feed' },
    { id: 'create', icon: PlusSquare, label: 'Post' },
    { id: 'chat', icon: MessageCircle, label: 'Chat' },
    { id: 'profile', icon: User, label: 'Profile' },
  ];

  return (
    <nav className="shrink-0 bg-black/90 border-t border-white/10 glass pb-safe relative z-40">
      <div className="h-[60px] flex items-center justify-around w-full">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full transition-all duration-300 relative",
                isActive ? "text-white" : "text-white/40"
              )}
            >
              <div className="relative">
                <Icon size={isActive ? 26 : 24} strokeWidth={isActive ? 2.5 : 2} />
                {tab.id === 'chat' && unreadCount > 0 && (
                  <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-black shadow" />
                )}
              </div>
              <span className="text-[10px] mt-1 font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
