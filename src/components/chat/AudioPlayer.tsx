import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Play, Pause } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export const AudioPlayer = ({ src, isMine }: { src: string, isMine: boolean }) => {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.preload = 'metadata';
    const setAudioData = () => { if (audio.duration !== Infinity) setDuration(audio.duration); };
    const setAudioTime = () => { setProgress((audio.currentTime / audio.duration) * 100 || 0); };
    const onEnd = () => { setPlaying(false); setProgress(100); };
    audio.addEventListener('loadedmetadata', setAudioData);
    audio.addEventListener('timeupdate', setAudioTime);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('durationchange', () => { if (audio.duration !== Infinity) setDuration(audio.duration); });
    return () => {
      audio.removeEventListener('loadedmetadata', setAudioData);
      audio.removeEventListener('timeupdate', setAudioTime);
      audio.removeEventListener('ended', onEnd);
      audio.pause();
    };
  }, [src]);

  const toggle = async () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
           const ctx = new AudioContext();
           const buffer = ctx.createBuffer(1, 1, 22050);
           const source = ctx.createBufferSource();
           source.buffer = buffer;
           source.connect(ctx.destination);
           source.start(0);
           if (ctx.state === 'suspended') await ctx.resume();
           setTimeout(() => ctx.close(), 1000);
        }
      } catch (e) {}
      if (progress >= 100) audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.error("Play error", e));
      setPlaying(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const percentage = (e.clientX - bounds.left) / bounds.width;
    const newTime = percentage * audioRef.current.duration;
    if (!isNaN(newTime) && isFinite(newTime)) {
      audioRef.current.currentTime = newTime;
      setProgress(percentage * 100);
    }
  };

  return (
    <div className={cn("flex items-center gap-3 px-3 py-2 rounded-[24px] min-w-[180px] backdrop-blur-md transition-all duration-300", isMine ? "bg-white text-black" : "bg-white/20 text-white")}>
      <button onClick={toggle} className={cn("w-8 h-8 rounded-full flex items-center justify-center transition-transform active:scale-90", isMine ? "bg-black/10" : "bg-white/10")}>
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="flex-1 h-3 bg-current/10 rounded-full overflow-hidden cursor-pointer flex items-center relative" onClick={handleSeek}>
        <div className="w-full h-1 bg-current/20 rounded-full absolute pointer-events-none" />
        <motion.div animate={{ width: `${progress}%` }} transition={{ duration: 0.1 }} className="h-1 bg-current relative z-10 pointer-events-none" />
      </div>
      <span className="text-[10px] font-medium opacity-50 w-8">{duration > 0 ? `${Math.floor(duration)}s` : '...'}</span>
    </div>
  );
};
