import React from 'react';
import { Bell } from 'lucide-react';
import { cn } from '../lib/utils';
import { Profile } from '../types';

interface AppHeaderProps {
  activeTab: string;
  isImageViewerOpen: boolean;
  isChatRoomOpen: boolean;
  initialActiveChat: Profile | null;
  notifPermission: string;
  onBellClick: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({
  activeTab,
  isImageViewerOpen,
  isChatRoomOpen,
  initialActiveChat,
  notifPermission,
  onBellClick
}) => {
  const isHidden = activeTab === 'create' || isImageViewerOpen || isChatRoomOpen;

  return (
    <>
      {/* Header Placeholder to prevent layout shift */}
      <div className={cn("shrink-0 h-14 w-full transition-opacity duration-300", isHidden ? "block opacity-0" : "hidden opacity-100")} />
      
      {/* Header */}
      <div className={cn("shrink-0 h-14 w-full transition-opacity duration-300", isHidden ? "opacity-0 pointer-events-none absolute" : "relative z-40 opacity-100")}>
        <header className="h-14 flex items-center justify-between px-4 glass border-b border-white/10 bg-black/90 [touch-action:none]">
          <h1 className="text-xl font-bold tracking-tighter uppercase italic">Socium</h1>
          <div className="flex space-x-4">
            {activeTab === 'chat' && !initialActiveChat && (
              <button 
                onClick={onBellClick}
                className="text-white hover:text-white/80 transition-colors relative"
              >
                <Bell size={24} />
                {notifPermission === 'granted' && (
                  <div className="absolute flex top-0 right-[-2px] w-2.5 h-2.5 bg-green-500 rounded-full border border-black shadow" />
                )}
              </button>
            )}
          </div>
        </header>
      </div>
    </>
  );
};

export default AppHeader;
