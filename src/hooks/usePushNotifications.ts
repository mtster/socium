import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const inFlightPushReg = new Map<string, Promise<void>>();
const attemptedPushInSession = new Set<string>();

export function usePushNotifications(userId: string | undefined) {
  const [notifPermission, setNotifPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );
  const [hasPushSubscription, setHasPushSubscription] = useState<boolean | null>(null);

  useEffect(() => {
    if (userId) {
      supabase
        .from('push_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .then(({ count, error }) => {
          setHasPushSubscription(!error && count !== null && count > 0);
        });
    }
  }, [userId]);

  const registerPush = async (targetUserId: string, isUserAction = false) => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn("Push unsupported");
      return;
    }

    if (!isUserAction && attemptedPushInSession.has(targetUserId)) {
      return;
    }

    const existing = inFlightPushReg.get(targetUserId);
    if (existing) {
      return existing;
    }

    attemptedPushInSession.add(targetUserId);

    const task = (async () => {
      try {
        const { requestFirebaseNotificationPermission } = await import('../lib/firebase');
        const token = await requestFirebaseNotificationPermission();

        if (typeof window !== 'undefined' && 'Notification' in window) {
          setNotifPermission(Notification.permission);
        }

        if (!token) {
          console.warn("Could not get Firebase FCM token.");
          if (isUserAction) alert('Could not enable notifications.');
          return;
        }

        const storageKey = `socium_fcm_token_${targetUserId}`;
        const lastToken = typeof window !== 'undefined' ? sessionStorage.getItem(storageKey) : null;
        if (!isUserAction && lastToken === token) {
          setHasPushSubscription(true);
          return;
        }

        const { error } = await supabase.from('push_subscriptions').upsert({
          user_id: targetUserId,
          endpoint: token,
          p256dh_key: 'FCM',
          auth_key: 'FCM'
        }, { onConflict: 'user_id, endpoint' });

        if (error) {
          console.error('Error upserting DB:', error);
        } else {
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(storageKey, token);
          }
          setHasPushSubscription(true);
        }
      } catch (e: any) {
        console.error('Push registration failed:', e.name, e.message);
        if (isUserAction) alert(`Push registration failed: ${e.message}`);
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
