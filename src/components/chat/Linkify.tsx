import React from 'react';
import { parseLocation, openInNativeMaps } from './locationUtils';

export const Linkify = ({ text }: { text: string }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return (
    <>
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          const isMapUrl = part.includes('google.com/maps') || part.includes('goo.gl/maps') || part.includes('maps.app.goo.gl') || part.includes('maps.apple.com') || part.includes('apple.com/maps');
          return (
            <a 
              key={i} 
              href={part} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="underline underline-offset-2 break-all opacity-80 hover:opacity-100 transition-opacity"
              onClick={(e) => {
                if (isMapUrl) {
                  e.preventDefault();
                  e.stopPropagation();
                  const { lat, lng } = parseLocation(part);
                  openInNativeMaps(lat, lng, part);
                }
              }}
            >
              {part}
            </a>
          );
        }
        return part;
      })}
    </>
  );
};
