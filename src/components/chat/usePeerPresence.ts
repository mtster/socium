import { useState, useEffect, useMemo } from 'react';
import { ref, onValue } from 'firebase/database';
import { rtdb } from '@/src/lib/firebase';

export function formatLastSeen(timestamp: number | null | undefined): string {
  if (!timestamp || typeof timestamp !== 'number') return 'offline';

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'offline';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // If less than 1 minute ago
  if (diffMs >= 0 && diffMs < 60000) {
    return 'last seen just now';
  }

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  const isSameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isSameDay) {
    return `last seen today at ${timeStr}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return `last seen yesterday at ${timeStr}`;
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[date.getMonth()];
  const day = date.getDate();

  if (date.getFullYear() === now.getFullYear()) {
    return `last seen ${day} ${monthName} at ${timeStr}`;
  } else {
    return `last seen ${day} ${monthName} ${date.getFullYear()} at ${timeStr}`;
  }
}

/**
 * Hook to snipe presence & last_seen timestamp strictly when a 1-on-1 chat room is opened.
 * Detaches all listeners upon unmounting to save device and network resources.
 */
export function usePeerPresence(peerId: string | undefined | null, isGroup?: boolean) {
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [lastSeenTime, setLastSeenTime] = useState<number | null>(null);
  const [, setTick] = useState<number>(0);

  // Periodic ticker so relative time strings update over time without extra network calls
  useEffect(() => {
    if (isGroup || isOnline || !lastSeenTime) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 30000);
    return () => clearInterval(interval);
  }, [isGroup, isOnline, lastSeenTime]);

  useEffect(() => {
    if (!rtdb || !peerId || isGroup) {
      setIsOnline(false);
      setLastSeenTime(null);
      return;
    }

    const presenceRef = ref(rtdb, `global_presence/${peerId}`);
    const lastSeenRef = ref(rtdb, `last_seen/${peerId}`);

    const unsubPresence = onValue(presenceRef, (snap) => {
      setIsOnline(snap.val() === true);
    });

    const unsubLastSeen = onValue(lastSeenRef, (snap) => {
      const val = snap.val();
      if (typeof val === 'number') {
        setLastSeenTime(val);
      } else {
        setLastSeenTime(null);
      }
    });

    return () => {
      unsubPresence();
      unsubLastSeen();
    };
  }, [peerId, isGroup]);

  const statusText = useMemo(() => {
    if (isGroup) return null;
    if (isOnline) return 'online';
    if (lastSeenTime) return formatLastSeen(lastSeenTime);
    return 'offline';
  }, [isGroup, isOnline, lastSeenTime]);

  return { isOnline, lastSeenTime, statusText };
}
