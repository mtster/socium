import React from 'react';

const LoadingScreen: React.FC = () => {
  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-8 text-center animate-pulse">
      <div className="w-16 h-16 bg-white text-black rounded-2xl flex items-center justify-center font-black text-3xl mb-6 shadow-[0_0_30px_rgba(255,255,255,0.1)]">S</div>
      <h1 className="text-xl font-bold tracking-tighter uppercase italic text-white/90">Socium</h1>
      <div className="mt-8 flex gap-1">
        <div className="w-1 h-1 bg-white/20 rounded-full animate-bounce [animation-delay:-0.3s]" />
        <div className="w-1 h-1 bg-white/20 rounded-full animate-bounce [animation-delay:-0.15s]" />
        <div className="w-1 h-1 bg-white/20 rounded-full animate-bounce" />
      </div>
    </div>
  );
};

export default LoadingScreen;
