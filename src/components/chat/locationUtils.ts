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
    window.location.assign(`maps://?q=${dest}`);
  } else if (originalUrl) {
    window.open(originalUrl, '_blank');
  }
};

export const openInGoogleMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  if (lat !== null && lng !== null) {
    const dest = `${lat},${lng}`;
    window.location.assign(`comgooglemaps://?q=${dest}`);
  } else if (originalUrl) {
    window.location.assign(`comgooglemaps://?q=${originalUrl}`);
  }
};

export const openInNativeMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  openInGoogleMaps(lat, lng, originalUrl);
};

