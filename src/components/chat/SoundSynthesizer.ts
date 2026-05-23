// Web Audio API Ringtone and Sound Effects synthesizer
class SoundSynthesizer {
  private audioCtx: AudioContext | null = null;
  private ringtoneInterval: any = null;

  private initCtx() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  startRinging() {
    this.stopRinging();
    this.initCtx();
    
    const playTone = () => {
      try {
        if (!this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        // Classic iOS cell ring dual tone chime
        osc.frequency.setValueAtTime(400, this.audioCtx.currentTime);
        osc.frequency.setValueAtTime(450, this.audioCtx.currentTime + 0.15);
        
        gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.12, this.audioCtx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 1.2);
        
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 1.3);
      } catch (e) {
        console.warn("Ringtone synth audio context error:", e);
      }
    };

    playTone();
    this.ringtoneInterval = setInterval(playTone, 2000);
  }

  stopRinging() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
  }

  playHangup() {
    this.stopRinging();
    this.initCtx();
    try {
      if (!this.audioCtx) return;
      const osc1 = this.audioCtx.createOscillator();
      const osc2 = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      
      osc1.frequency.setValueAtTime(320, this.audioCtx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(100, this.audioCtx.currentTime + 0.35);
      
      osc2.frequency.setValueAtTime(220, this.audioCtx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(70, this.audioCtx.currentTime + 0.35);
      
      gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.4);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc1.start();
      osc2.start();
      osc1.stop(this.audioCtx.currentTime + 0.4);
      osc2.stop(this.audioCtx.currentTime + 0.4);
    } catch (e) {
      console.warn("Hangup audio synth error:", e);
    }
  }

  playAnswer() {
    this.stopRinging();
    this.initCtx();
    try {
      if (!this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      
      osc.frequency.setValueAtTime(280, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(560, this.audioCtx.currentTime + 0.3);
      
      gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.35);
      
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.35);
    } catch (e) {
      console.warn("Answer audio synth error:", e);
    }
  }
}

export const synth = new SoundSynthesizer();
