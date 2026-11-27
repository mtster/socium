import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { Users, VideoOff } from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';

type Corner = 'tr' | 'tl' | 'br' | 'bl';

interface MinimizedVideoPipProps {
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  isLocalVideoDisabled: boolean;
  isRemoteVideoDisabled: boolean;
  displayName: string;
  avatarUrl: string | null;
  isGroup: boolean;
  participantCount: number;
  duration: number;
  onExpand: () => void;
}

const PIP_WIDTH = 118;
const PIP_HEIGHT = 172;
const SIDE_MARGIN = 12;

function formatDuration(secs: number): string {
  const min = Math.floor(secs / 60);
  const sec = secs % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function getSafeAreaInsets() {
  if (typeof window === 'undefined') return { top: 0, bottom: 0 };
  const style = getComputedStyle(document.documentElement);
  // Read actual visual insets via a lightweight probe or fallback
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;';
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  const top = Math.max(0, rect.top);
  const bottom = Math.max(0, window.innerHeight - rect.bottom);
  document.body.removeChild(probe);
  void style;
  return { top, bottom };
}

export function MinimizedVideoPip({
  remoteStream,
  localStream,
  isLocalVideoDisabled,
  isRemoteVideoDisabled,
  displayName,
  avatarUrl,
  isGroup,
  participantCount,
  duration,
  onExpand,
}: MinimizedVideoPipProps) {
  const [corner, setCorner] = useState<Corner>('tr');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const cornerRef = useRef<Corner>('tr');
  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    lastClientX: number;
    lastClientY: number;
    lastTime: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);

  const computeBoundsAndCorners = useCallback(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 844;
    const { top: safeTop, bottom: safeBottom } = getSafeAreaInsets();

    // Respect Socium's max-w-lg (512px) centered container on desktop/tablet
    const containerWidth = Math.min(vw, 512);
    const containerLeft = Math.max(0, (vw - containerWidth) / 2);
    const containerRight = containerLeft + containerWidth;

    const minX = containerLeft + SIDE_MARGIN;
    const maxX = Math.max(minX, containerRight - PIP_WIDTH - SIDE_MARGIN);
    // Keep top corners strictly BELOW the top header (~48-56px height + breathing room)
    const minY = safeTop + 58;
    // Keep bottom corners cleanly above BottomNav
    const maxY = Math.max(minY, vh - PIP_HEIGHT - 84 - safeBottom);

    const corners: Record<Corner, { x: number; y: number }> = {
      tl: { x: minX, y: minY },
      tr: { x: maxX, y: minY },
      bl: { x: minX, y: maxY },
      br: { x: maxX, y: maxY },
    };

    return { minX, maxX, minY, maxY, corners };
  }, []);

  useEffect(() => {
    const updatePosition = () => {
      const { corners } = computeBoundsAndCorners();
      setPos(corners[cornerRef.current]);
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('orientationchange', updatePosition);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('orientationchange', updatePosition);
    };
  }, [computeBoundsAndCorners]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pos) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    setIsDragging(true);
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: pos.x,
      startY: pos.y,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      lastTime: performance.now(),
      vx: 0,
      vy: 0,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragStateRef.current;
    if (!ds || !ds.active || ds.pointerId !== e.pointerId) return;

    const dx = e.clientX - ds.startClientX;
    const dy = e.clientY - ds.startClientY;
    if (Math.hypot(dx, dy) > 6) {
      ds.moved = true;
    }

    const now = performance.now();
    const dt = Math.max(1, now - ds.lastTime);
    ds.vx = (e.clientX - ds.lastClientX) / dt;
    ds.vy = (e.clientY - ds.lastClientY) / dt;
    ds.lastClientX = e.clientX;
    ds.lastClientY = e.clientY;
    ds.lastTime = now;

    const { minX, maxX, minY, maxY } = computeBoundsAndCorners();
    const clampedX = Math.min(maxX + 14, Math.max(minX - 14, ds.startX + dx));
    const clampedY = Math.min(maxY + 14, Math.max(minY - 14, ds.startY + dy));

    setPos({ x: clampedX, y: clampedY });
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragStateRef.current;
    if (!ds || !ds.active || ds.pointerId !== e.pointerId) return;

    dragStateRef.current = null;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (!ds.moved) {
      onExpand();
      return;
    }

    const { corners } = computeBoundsAndCorners();
    const currentX = ds.startX + (e.clientX - ds.startClientX);
    const currentY = ds.startY + (e.clientY - ds.startClientY);

    // Project flick velocity so a quick swipe snaps cleanly to the intended corner
    const projectedX = currentX + ds.vx * 140;
    const projectedY = currentY + ds.vy * 140;

    let bestCorner: Corner = corner;
    let bestDist = Infinity;

    (Object.keys(corners) as Corner[]).forEach((key) => {
      const c = corners[key];
      const dist = Math.hypot(projectedX - c.x, projectedY - c.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestCorner = key;
      }
    });

    cornerRef.current = bestCorner;
    setCorner(bestCorner);
    setPos(corners[bestCorner]);
  };

  if (!pos) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{
        opacity: 1,
        scale: isDragging ? 1.03 : 1,
        x: pos.x,
        y: pos.y,
      }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={
        isDragging
          ? { duration: 0 }
          : { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      style={{ width: PIP_WIDTH, height: PIP_HEIGHT, left: 0, top: 0 }}
      className="fixed z-[99990] rounded-[18px] overflow-hidden border border-white/20 bg-zinc-950 shadow-[0_14px_38px_rgba(0,0,0,0.78)] select-none touch-none cursor-grab active:cursor-grabbing"
    >
      {/* Primary view: Remote peer video or avatar fallback */}
      {remoteStream && !isRemoteVideoDisabled ? (
        <VideoPlayer
          stream={remoteStream}
          muted={true}
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 p-2 text-center pointer-events-none">
          <div className="w-12 h-12 rounded-full overflow-hidden border border-white/15 bg-white/5 flex items-center justify-center">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : isGroup ? (
              <Users size={20} className="text-white/60" />
            ) : (
              <span className="text-base font-bold text-white/70 uppercase">
                {displayName?.[0] || '?'}
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium text-white/70 truncate max-w-full mt-1.5">
            {displayName}
          </span>
        </div>
      )}

      {/* Group participant indicator when more than 1 peer */}
      {isGroup && participantCount > 1 && (
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm border border-white/15 text-[10px] font-semibold text-white pointer-events-none">
          {participantCount} in call
        </div>
      )}

      {/* Secondary corner inset: Local self-camera (mirrored naturally) */}
      <div className="absolute bottom-2 right-2 w-10 h-14 rounded-lg overflow-hidden border border-white/25 bg-black/80 shadow-md pointer-events-none flex items-center justify-center">
        {localStream && !isLocalVideoDisabled ? (
          <VideoPlayer
            stream={localStream}
            muted={true}
            mirror={true}
            className="w-full h-full object-cover"
          />
        ) : (
          <VideoOff size={13} className="text-white/55" />
        )}
      </div>

      {/* Bottom-left duration scrim */}
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/80 via-black/35 to-transparent pointer-events-none flex items-end p-2">
        <span className="text-[10px] font-medium text-white/90 tabular-nums">
          {formatDuration(duration)}
        </span>
      </div>
    </motion.div>
  );
}
