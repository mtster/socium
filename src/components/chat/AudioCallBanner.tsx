import React from 'react';
import { Users } from 'lucide-react';
import { useStore } from '@/src/store/useStore';

interface AudioCallBannerProps {
  withSafeArea?: boolean;
}

function formatCallDuration(secs: number): string {
  const min = Math.floor(secs / 60);
  const sec = secs % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function AudioCallBanner({ withSafeArea = false }: AudioCallBannerProps) {
  const banner = useStore((state) => state.minimizedAudioCall);

  if (!banner) return null;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('expandActiveCall'));
      }}
      role="button"
      tabIndex={0}
      aria-label={`Return to call with ${banner.displayName}`}
      className={`shrink-0 w-full bg-emerald-950/95 backdrop-blur-md z-50 cursor-pointer select-none active:bg-emerald-900/95 transition-colors ${
        withSafeArea ? 'pt-[env(safe-area-inset-top)]' : ''
      }`}
    >
      <div className="h-10 px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-6 h-6 rounded-full overflow-hidden bg-white/10 border border-white/15 shrink-0 flex items-center justify-center">
            {banner.avatarUrl ? (
              <img
                src={banner.avatarUrl}
                alt={banner.displayName}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : banner.isGroup ? (
              <Users size={12} className="text-white/75" />
            ) : (
              <span className="text-[10px] font-bold text-white/80 uppercase">
                {banner.displayName?.[0] || '?'}
              </span>
            )}
          </div>
          <span className="text-xs font-semibold text-white truncate">
            {banner.displayName}
          </span>
        </div>

        <span className="text-xs font-medium text-emerald-300 tabular-nums shrink-0 tracking-wide">
          {formatCallDuration(banner.duration)}
        </span>
      </div>
    </div>
  );
}
