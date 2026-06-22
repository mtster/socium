import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function usePushNotifications(userId: string | undefined) {
  const [notifPermission, setNotifPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );
  const [hasPushSubscription, setHasPushSubscription] = useState<boolean | null>(null);

  useEffect(() => {
    if (userId) {
      supabase
        .from('push_subscriptions')
        .select('id', { count: 'exact' })
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
    
    try {
      const permission = typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default';
      console.log(`registerPush called (userAction: ${isUserAction}), current permission:`, permission);
      
      const { requestFirebaseNotificationPermission } = await import('../lib/firebase');
      const token = await requestFirebaseNotificationPermission();
      
      setNotifPermission(Notification.permission);
      
      if (!token) {
        console.warn("Could not get Firebase FCM token.");
        if (isUserAction) alert('Could not enable notifications.');
        return;
      }

      console.log("Firebase FCM token obtained:", token.substring(0, 20) + "...");

      console.log("Upserting subscription to database for user:", targetUserId);
      const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: targetUserId,
        endpoint: token, // We store the FCM token in the 'endpoint' column for simplicity
        p256dh_key: 'FCM',
        auth_key: 'FCM'
      }, { onConflict: 'user_id, endpoint' });
      
      if (error) {
        console.error('Error upserting DB:', error);
      } else {
        console.log('Successfully saved FCM token to database');
        setHasPushSubscription(true);
      }
      
    } catch (e: any) {
      console.error('Push registration failed:', e.name, e.message);
      if (isUserAction) alert(`Push registration failed: ${e.message}`);
    }
  };

  return {
    notifPermission,
    hasPushSubscription,
    registerPush
  };
}
