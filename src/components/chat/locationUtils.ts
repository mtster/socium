export const parseLocation = (content: string) => {
  if (!content) return { lat: null, lng: null };
  const locMatch = content.match(/query=([-0-9.]+),([-0-9.]+)/) || 
                   content.match(/ll=([-0-9.]+),([-0-9.]+)/) ||
                   content.match(/([-0-9.]+),([-0-9.]+)/) ||
                   content.match(/google\.com\/maps\/search\/([-0-9.]+),([-0-9.]+)/);
  if (locMatch && !content.includes('goo.gl/maps') && !content.includes('maps.app.goo.gl')) {
     return { lat: parseFloat(locMatch[1]), lng: parseFloat(locMatch[2]) };
  }
  return { lat: null, lng: null };
};

export const openInNativeMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  const isApple = originalUrl && (originalUrl.includes('apple.com') || originalUrl.includes('apple.com/maps'));
  const isGoogle = originalUrl && (originalUrl.includes('google.com') || originalUrl.includes('goo.gl/maps') || originalUrl.includes('maps.app.goo.gl'));

  let iosUrl = '';
  let webUrl = originalUrl || '';

  if (lat !== null && lng !== null) {
    const dest = `${lat},${lng}`;
    if (isApple) {
      iosUrl = `maps://?q=${dest}`;
      webUrl = originalUrl || `https://maps.apple.com/?q=${dest}`;
    } else {
      iosUrl = `comgooglemaps://?q=${dest}&directionsmode=driving`;
      webUrl = originalUrl || `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
    }
  } else if (originalUrl) {
    if (isApple) {
      iosUrl = originalUrl.replace(/^https?:\/\//, 'maps://');
    } else if (isGoogle) {
      // the shortest way to launch google maps from generic url is sometimes comgooglemapsurl://
      // but without lat/lng we can just try comgooglemaps://?q=... or let fallback happen
      iosUrl = originalUrl.replace(/^https?:\/\//, 'comgooglemapsurl://');
    }
  }

  if (iosUrl) {
    window.location.href = iosUrl;
  } else if (webUrl) {
    window.open(webUrl, '_blank');
  }
};
