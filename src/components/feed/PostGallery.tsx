import React from 'react';

interface PostGalleryProps {
  images: string[];
  firstImgAspect: 'portrait' | 'landscape' | null;
  setViewingImages: (state: { images: string[], startIndex: number } | null) => void;
  getOptimizedUrl: (url: string) => string;
}

export const PostGallery = ({ images, firstImgAspect, setViewingImages, getOptimizedUrl }: PostGalleryProps) => {
  if (images.length === 0) return null;

  if (images.length === 1) {
    const isPortrait = firstImgAspect === 'portrait';
    const isLandscape = firstImgAspect === 'landscape';
    const aspectClass = isPortrait ? 'aspect-[4/5]' : isLandscape ? 'aspect-video' : 'min-h-[300px] h-fit';

    return (
      <div className={`relative w-full bg-white/5 overflow-hidden mb-2 ${aspectClass}`}>
        <img 
          src={getOptimizedUrl(images[0])} 
          alt="Post content" 
          className="w-full h-full object-cover cursor-pointer hover:brightness-95 transition-all absolute inset-0 md:relative"
          onClick={() => setViewingImages({ images, startIndex: 0 })}
          loading="lazy"
        />
      </div>
    );
  }

  if (images.length === 2) {
    return (
      <div className="relative w-full bg-white/5 overflow-hidden grid grid-cols-2 gap-1 mb-2 h-[350px]">
        {images.map((img, index) => (
          <div 
            key={index} 
            className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all"
            onClick={() => setViewingImages({ images, startIndex: index })}
          >
            <img src={getOptimizedUrl(img)} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
        ))}
      </div>
    );
  }

  if (images.length === 3) {
    const isPortrait = firstImgAspect === 'portrait' || !firstImgAspect; // Default to portrait if not loaded
    return (
      <div className="relative w-full bg-white/5 overflow-hidden gap-1 mb-2 h-[450px] grid grid-cols-2 grid-rows-2">
        {isPortrait ? (
          <>
            <div 
              className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all row-span-2"
              onClick={() => setViewingImages({ images, startIndex: 0 })}
            >
              <img src={getOptimizedUrl(images[0])} alt="" className="w-full h-full object-cover" />
            </div>
            {images.slice(1, 3).map((img, index) => (
              <div 
                key={index + 1} 
                className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all"
                onClick={() => setViewingImages({ images, startIndex: index + 1 })}
              >
                <img src={getOptimizedUrl(img)} alt="" className="w-full h-full object-cover" />
              </div>
            ))}
          </>
        ) : (
          <>
            <div 
              className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all col-span-2"
              onClick={() => setViewingImages({ images, startIndex: 0 })}
            >
              <img src={getOptimizedUrl(images[0])} alt="" className="w-full h-full object-cover" />
            </div>
            {images.slice(1, 3).map((img, index) => (
              <div 
                key={index + 1} 
                className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all"
                onClick={() => setViewingImages({ images, startIndex: index + 1 })}
              >
                <img src={getOptimizedUrl(img)} alt="" className="w-full h-full object-cover" />
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  // 4 or more photos
  return (
    <div className="relative w-full bg-white/5 overflow-hidden grid grid-cols-2 gap-1 mb-2 h-[350px]">
      {images.slice(0, 2).map((img, index) => {
        const isLastShown = index === 1;
        const moreCount = images.length - 1;
        return (
          <div 
             key={index} 
             className="relative w-full h-full cursor-pointer hover:brightness-90 transition-all"
             onClick={() => setViewingImages({ images, startIndex: index })}
          >
            <img src={getOptimizedUrl(img)} alt="" className="w-full h-full object-cover" loading="lazy" />
            {isLastShown && moreCount > 0 && (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center backdrop-blur-md">
                 <div className="w-12 h-12 rounded-full bg-[#1c1c1c]/90 border border-white/10 flex items-center justify-center shadow-2xl transition-transform active:scale-90">
                   <span className="text-white text-sm font-bold tabular-nums">+{moreCount}</span>
                 </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
