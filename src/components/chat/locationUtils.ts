export const parseLocation = (content: string) => {
  if (!content) return { lat: null, lng: null };
  const locMatch = content.match(/query=([-0-9.]+),([-0-9.]+)/) || 
                   content.match(/ll=([-0-9.]+),([-0-9.]+)/) ||
                   content.match(/q=([-0-9.]+),([-0-9.]+)/) ||
                   content.match(/([-0-9.]+),([-0-9.]+)/) ||
                   content.match(/google\.com\/maps\/search\/([-0-9.]+),([-0-9.]+)/);
  if (locMatch && !content.includes('goo.gl/maps') && !content.includes('maps.app.goo.gl')) {
     return { lat: parseFloat(locMatch[1]), lng: parseFloat(locMatch[2]) };
  }
  return { lat: null, lng: null };
};

export const openInAppleMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  if (lat !== null && lng !== null) {
    const dest = `${lat},${lng}`;
    window.location.href = `maps://?q=${dest}`;
  } else if (originalUrl) {
    window.location.href = originalUrl;
  }
};

export const openInGoogleMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  if (lat !== null && lng !== null) {
    const dest = `${lat},${lng}`;
    window.location.href = `comgooglemaps://?q=${dest}`;
    // Fallback if app is not installed
    setTimeout(() => {
      window.location.href = `https://www.google.com/maps/search/?api=1&query=${dest}`;
    }, 500);
  } else if (originalUrl) {
    window.location.href = originalUrl;
  }
};

export const openInNativeMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  const isApple = originalUrl && (originalUrl.includes('apple.com') || originalUrl.includes('apple.com/maps'));
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  
  if (isApple || isIOS) {
    openInAppleMaps(lat, lng, originalUrl);
  } else {
    openInGoogleMaps(lat, lng, originalUrl);
  }
};

