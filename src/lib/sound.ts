let ctx: AudioContext | null = null;

/** Short tone via WebAudio; silently does nothing if audio is blocked. */
export function beep(freq = 880, seconds = 0.12, volume = 0.06): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.start(t);
    osc.stop(t + seconds);
  } catch {
    /* audio unavailable */
  }
}
