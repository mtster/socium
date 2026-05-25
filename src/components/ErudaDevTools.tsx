import { useEffect } from 'react';
// @ts-ignore
import eruda from 'eruda';

export default function ErudaDevTools() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const erudaParam = urlParams.get('eruda');

      if (erudaParam === 'true') {
        sessionStorage.setItem('eruda_active', 'true');
      } else if (erudaParam === 'false') {
        sessionStorage.removeItem('eruda_active');
      }

      const isActive = sessionStorage.getItem('eruda_active') === 'true';

      if (!isActive) {
        return;
      }

      try {
        eruda.init({
          defaults: {
            displaySize: 50,
            theme: 'Dark'
          }
        });
      } catch (err) {
        console.error('Failed to initialize eruda:', err);
      }
    }

    return () => {
      try {
        if (eruda && typeof eruda.destroy === 'function') {
          eruda.destroy();
        }
      } catch (err) {}
    };
  }, []);

  return null;
}

