let audioContext = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;
  const sound = message.type === "playCompletionSound"
    ? playCompletionChime
    : message.type === "playRateLimitAlert"
      ? playRateLimitAlert
      : null;
  if (!sound) return false;

  sound()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function playCompletionChime() {
  await playNotes([
    { frequency: 523.25, offset: 0, duration: 0.2, volume: 0.18 },
    { frequency: 659.25, offset: 0.13, duration: 0.2, volume: 0.18 },
    { frequency: 783.99, offset: 0.26, duration: 0.2, volume: 0.18 },
    { frequency: 1046.5, offset: 0.39, duration: 0.2, volume: 0.18 },
  ], 750, "sine");
}

async function playRateLimitAlert() {
  await playNotes([
    { frequency: 880, offset: 0, duration: 0.22, volume: 0.25 },
    { frequency: 587.33, offset: 0.27, duration: 0.26, volume: 0.25 },
    { frequency: 880, offset: 0.62, duration: 0.22, volume: 0.25 },
    { frequency: 587.33, offset: 0.89, duration: 0.35, volume: 0.25 },
  ], 1400, "square");
}

async function playNotes(notes, waitMs, waveType) {
  audioContext ||= new AudioContext();
  await audioContext.resume();

  const startAt = audioContext.currentTime + 0.03;
  notes.forEach(({ frequency, offset, duration, volume }) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const noteStart = startAt + offset;
    const noteEnd = noteStart + duration;

    oscillator.type = waveType;
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(volume, noteStart + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd);
  });

  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
