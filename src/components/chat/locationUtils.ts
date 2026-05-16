export const parseLocation = (content: string) => {
  if (!content) return { lat: null, lng: null };
  // Decode URL first in case it's encoded
  const decoded = decodeURIComponent(content);
  
  // Try to find lat,lng in various formats
  let lat = null, lng = null;
  
  const patterns = [
    /!3d([-0-9.]+)!4d([-0-9.]+)/, // Google Maps embed / !3d !4d
    /@([-0-9.]+),([-0-9.]+)/,      // Google maps @lat,lng
    /query=([-0-9.]+),([-0-9.]+)/, // Google maps query=lat,lng
    /ll=([-0-9.]+),([-0-9.]+)/,    // Apple maps ll=lat,lng
    /q=([-0-9.]+),([-0-9.]+)/      // Generic q=lat,lng
  ];

  for (const regex of patterns) {
    const match = decoded.match(regex);
    if (match) {
      lat = parseFloat(match[1]);
      lng = parseFloat(match[2]);
      break;
    }
  }

  return { lat, lng };
};

export const openInAppleMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  if (lat !== null && lng !== null) {
    const dest = `${lat},${lng}`;
    window.location.href = `maps://?q=${dest}&ll=${dest}`;
  } else if (originalUrl) {
    window.location.href = originalUrl;
  }
};

export const openInGoogleMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  if (lat !== null && lng !== null) {
    const dest = `${lat},${lng}`;
    window.location.href = `comgooglemaps://?q=${dest}&center=${dest}`;
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

