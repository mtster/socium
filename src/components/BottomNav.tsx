import React from 'react';
import { Home, User, PlusSquare, Search, MessageCircle } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Profile } from '@/src/types';
import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '../store/useStore';

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  unreadCount?: number;
  floatingAvatar?: Profile | null;
  setFloatingAvatar?: (profile: Profile | null) => void;
  showFirstTimeChatDot?: boolean;
}

const BottomNav = ({ activeTab, setActiveTab, unreadCount = 0, floatingAvatar, setFloatingAvatar, showFirstTimeChatDot = false }: BottomNavProps) => {
  const { pendingRequestsCount } = useStore();

  const tabs = [
    { id: 'feed', icon: Home, label: 'Feed' },
    { id: 'create', icon: PlusSquare, label: 'Post' },
    { id: 'chat', icon: MessageCircle, label: 'Chat' },
    { id: 'profile', icon: User, label: 'Profile' },
  ];

  return (
    <nav className="shrink-0 bg-black/90 border-t border-white/10 glass pb-safe relative z-40 [touch-action:none]">
      <div className="h-[60px] flex items-center justify-around w-full relative">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => {
                if (isActive) {
                  window.dispatchEvent(new CustomEvent('resetTab', { detail: { tabId: tab.id } }));
                }
                if (tab.id === 'chat' && setFloatingAvatar) {
                  setFloatingAvatar(null);
                }
                setActiveTab(tab.id);
              }}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full transition-all duration-300 relative",
                isActive ? "text-white" : "text-white/40"
              )}
            >
              <div className="relative flex flex-col items-center">
                <Icon size={isActive ? 26 : 24} strokeWidth={isActive ? 2.5 : 2} />
                {tab.id === 'chat' && ((unreadCount > 0 && !floatingAvatar) || showFirstTimeChatDot) && (
                  <div className="absolute top-0 right-[-4px] w-2.5 h-2.5 bg-red-500 rounded-full border border-black shadow" />
                )}
                {tab.id === 'profile' && pendingRequestsCount > 0 && (
                  <div className="absolute top-0 right-[-4px] w-2.5 h-2.5 bg-red-500 rounded-full border border-black shadow" />
                )}
                
                <AnimatePresence>
                  {tab.id === 'chat' && floatingAvatar && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.5 }}
                      animate={{ opacity: 1, y: -45, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5, y: -20 }}
                      className="absolute z-50 rounded-full border-2 border-black overflow-hidden bg-black/50 shadow-2xl w-10 h-10 flex items-center justify-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (setFloatingAvatar) setFloatingAvatar(null);
                        window.dispatchEvent(new CustomEvent('openChat', { detail: { profile: floatingAvatar } }));
                      }}
                    >
                      {floatingAvatar.avatar_url ? (
                        <img src={floatingAvatar.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (floatingAvatar as any).isGroup && (floatingAvatar as any).participants?.length > 0 ? (
                        <div className="w-full h-full relative relative bg-white/10">
                           {(floatingAvatar as any).participants.slice(0,3).map((p: any, i: number, arr: any[]) => (
                             <div key={i} className={cn("absolute rounded-full border border-black overflow-hidden bg-white/20", arr.length === 1 ? "inset-0" : arr.length === 2 ? (i === 0 ? "top-0 left-0 w-6 h-6" : "bottom-0 right-0 w-6 h-6") : (i === 0 ? "top-0 left-1/2 -translate-x-1/2 w-5 h-5 z-20" : i === 1 ? "bottom-0 left-0 w-5 h-5 z-10" : "bottom-0 right-0 w-5 h-5 z-10"))}>
                               {p?.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/20 flex items-center justify-center font-bold text-[8px] text-white/70">{(p?.full_name?.charAt(0) || p?.username?.charAt(0) || '?').toUpperCase()}</div>}
                             </div>
                           ))}
                        </div>
                      ) : (
                        <span className="text-white text-sm font-bold">{floatingAvatar.username?.charAt(0).toUpperCase()}</span>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <span className="text-[10px] mt-1 font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
