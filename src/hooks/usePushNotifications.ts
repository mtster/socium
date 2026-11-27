import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';

const inFlightPushReg = new Map<string, Promise<void>>();
const attemptedPushInSession = new Set<string>();

const DEVICE_TOKEN_KEY_PREFIX = 'socium_device_fcm_token_';
const SESSION_TOKEN_KEY_PREFIX = 'socium_fcm_token_';

const getSavedDeviceToken = (userId: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(`${DEVICE_TOKEN_KEY_PREFIX}${userId}`);
  } catch {
    return null;
  }
};

const setSavedDeviceToken = (userId: string, token: string) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${DEVICE_TOKEN_KEY_PREFIX}${userId}`, token);
  } catch {}
  try {
    sessionStorage.setItem(`${SESSION_TOKEN_KEY_PREFIX}${userId}`, token);
  } catch {}
};

export function usePushNotifications(userId: string | undefined) {
  const [notifPermission, setNotifPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );
  const [hasPushSubscription, setHasPushSubscription] = useState<boolean | null>(null);
  const dbVerifiedTokenRef = useRef<{ userId: string; token: string } | null>(null);

  useEffect(() => {
    if (!userId) {
      setHasPushSubscription(null);
      dbVerifiedTokenRef.current = null;
      return;
    }

    const permission = typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default';
    setNotifPermission(permission);

    const savedToken = getSavedDeviceToken(userId);
    if (!savedToken) {
      if (permission !== 'granted') {
        setHasPushSubscription(false);
      }
      return;
    }

    let cancelled = false;
    supabase
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('endpoint', savedToken)
      .then(({ count, error }) => {
        if (cancelled) return;
        if (error) return;

        const isPresent = count !== null && count > 0;
        setHasPushSubscription(isPresent);
        if (isPresent) {
          dbVerifiedTokenRef.current = { userId, token: savedToken };
        } else if (permission === 'granted') {
          dbVerifiedTokenRef.current = null;
          // Saved token for this device was pruned/deleted from DB -> force fresh token rotation
          registerPush(userId, false, true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const registerPush = async (targetUserId: string, isUserAction = false, forceRefresh = false) => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn("Push unsupported");
      if (isUserAction) toast.error('Push notifications are not supported on this browser.');
      return;
    }

    const currentPermission = 'Notification' in window ? Notification.permission : 'default';
    setNotifPermission(currentPermission);

    if (!isUserAction && !forceRefresh && currentPermission !== 'granted') {
      return;
    }

    if (!isUserAction && !forceRefresh && attemptedPushInSession.has(targetUserId)) {
      return;
    }

    const existing = inFlightPushReg.get(targetUserId);
    if (existing) {
      if (!isUserAction && !forceRefresh) return existing;
      await existing.catch(() => {});
    }

    const task = (async () => {
      try {
        const { requestFirebaseNotificationPermission } = await import('../lib/firebase');
        const token = await requestFirebaseNotificationPermission({
          requestPermission: isUserAction,
          forceRefresh
        });

        const updatedPermission = 'Notification' in window ? Notification.permission : 'default';
        setNotifPermission(updatedPermission);

        if (!token) {
          if (updatedPermission === 'denied') {
            attemptedPushInSession.add(targetUserId);
            setHasPushSubscription(false);
            if (isUserAction) {
              toast.error('Notifications are blocked in your device/browser settings.');
            }
          } else if (isUserAction) {
            toast.error('Could not enable notifications. Please try again.');
          }
          return;
        }

        const prevDeviceToken = getSavedDeviceToken(targetUserId);
        const sessionToken = typeof window !== 'undefined'
          ? sessionStorage.getItem(`${SESSION_TOKEN_KEY_PREFIX}${targetUserId}`)
          : null;
        const isDbVerifiedForSameToken =
          dbVerifiedTokenRef.current?.userId === targetUserId &&
          dbVerifiedTokenRef.current?.token === token;

        if (!forceRefresh && prevDeviceToken === token && (sessionToken === token || isDbVerifiedForSameToken)) {
          setSavedDeviceToken(targetUserId, token);
          attemptedPushInSession.add(targetUserId);
          setHasPushSubscription(true);
          if (isUserAction) {
            toast.success('Notifications are active on this device.');
          }
          return;
        }

        // Replace ONLY this device's previous rotated token row, keeping user's other devices intact
        if (prevDeviceToken && prevDeviceToken !== token) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('user_id', targetUserId)
            .eq('endpoint', prevDeviceToken);
        }

        const { error } = await supabase.from('push_subscriptions').upsert({
          user_id: targetUserId,
          endpoint: token,
          p256dh_key: 'FCM',
          auth_key: 'FCM'
        }, { onConflict: 'user_id, endpoint' });

        if (error) {
          console.error('Error upserting DB:', error);
          if (isUserAction) toast.error('Failed to save notification token.');
        } else {
          setSavedDeviceToken(targetUserId, token);
          dbVerifiedTokenRef.current = { userId: targetUserId, token };
          attemptedPushInSession.add(targetUserId);
          setHasPushSubscription(true);
          if (isUserAction) {
            toast.success(forceRefresh ? 'Notification token refreshed!' : 'Notifications enabled!');
          }
        }
      } catch (e: any) {
        console.error('Push registration failed:', e.name, e.message);
        if (isUserAction) toast.error(`Push registration failed: ${e.message}`);
      } finally {
        inFlightPushReg.delete(targetUserId);
      }
    })();

    inFlightPushReg.set(targetUserId, task);
    return task;
  };

  return {
    notifPermission,
    hasPushSubscription,
    registerPush
  };
}
