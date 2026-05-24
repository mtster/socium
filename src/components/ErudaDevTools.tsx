import { useEffect } from 'react';
// @ts-ignore
import eruda from 'eruda';

export default function ErudaDevTools() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
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

