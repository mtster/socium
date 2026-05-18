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
    const a = document.createElement('a');
    a.href = `maps://?q=${dest}&ll=${dest}`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else if (originalUrl) {
    const a = document.createElement('a');
    a.href = originalUrl;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
};

export const openInGoogleMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  if (lat !== null && lng !== null) {
    const dest = `${lat},${lng}`;
    // Create an invisible anchor tag and click it to avoid altering window.location directly
    const a = document.createElement('a');
    a.href = `comgooglemaps://?q=${dest}`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Timeout fallback just in case they don't have it installed
    setTimeout(() => {
        const fallback = document.createElement('a');
        fallback.href = `https://www.google.com/maps/search/?api=1&query=${dest}`;
        fallback.target = '_blank';
        document.body.appendChild(fallback);
        fallback.click();
        document.body.removeChild(fallback);
    }, 500);
  } else if (originalUrl) {
    // Try to open via Universal Link but using a tag with _blank to prevent current page navigation
    const a = document.createElement('a');
    const isGoogleMaps = originalUrl.includes('google') || originalUrl.includes('goo.gl');
    if (isGoogleMaps) {
       const urlWithoutProtocol = originalUrl.replace(/^https?:\/\//, '');
       a.href = `comgooglemapsurl://${urlWithoutProtocol}`;
    } else {
       a.href = originalUrl;
    }
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
};

export const openInNativeMaps = (lat: number | null, lng: number | null, originalUrl?: string) => {
  // User explicitly wants Google Maps
  openInGoogleMaps(lat, lng, originalUrl);
};

