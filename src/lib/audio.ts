let audioUnlocked = false;
export let messageSound: HTMLAudioElement | null = null;

if (typeof window !== 'undefined') {
  messageSound = new Audio('/message-sound.mp3');
  messageSound.volume = 0.8;
  messageSound.load();
}

export const unlockAudio = () => {
  if (audioUnlocked || !messageSound) return;
  // Play and pause silently to register the device playback unlock
  messageSound.play().then(() => {
    if (messageSound) {
      messageSound.pause();
      messageSound.currentTime = 0;
    }
    audioUnlocked = true;
  }).catch(() => {});
  
  if (audioUnlocked) {
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('click', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
}

export function playVibeSound() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
    osc1.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.15); // E6

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(audioCtx.currentTime + 0.35);
    osc2.stop(audioCtx.currentTime + 0.35);
  } catch (err) {
    console.warn('Audio Context chime play failed:', err);
  }
}

export function playMessageSound() {
  try {
    if (!messageSound) return;
    messageSound.currentTime = 0;
    messageSound.volume = 0.8;
    messageSound.play().catch(pErr => console.log('Audio play blocked:', pErr));
  } catch (aErr) {
    console.error('Audio load error:', aErr);
  }
}
