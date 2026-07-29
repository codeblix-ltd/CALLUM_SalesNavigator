let audioContext = null;
let lastAlertAt = 0;

async function playExtractionErrorSound() {
  const now = Date.now();
  if (now - lastAlertAt < 1500) return;
  lastAlertAt = now;

  const AudioContextClass = self.AudioContext || self.webkitAudioContext;
  if (!AudioContextClass) return;

  audioContext = audioContext || new AudioContextClass();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const startAt = audioContext.currentTime + 0.02;
  const notes = [
    { frequency: 880, offset: 0, duration: 0.18 },
    { frequency: 660, offset: 0.25, duration: 0.18 },
    { frequency: 880, offset: 0.5, duration: 0.3 }
  ];

  notes.forEach(note => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const noteStart = startAt + note.offset;
    const noteEnd = noteStart + note.duration;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.28, noteStart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.02);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message?.target !== 'totleads-offscreen' ||
    message?.action !== 'PLAY_EXTRACTION_ERROR_SOUND'
  ) {
    return false;
  }

  playExtractionErrorSound()
    .then(() => sendResponse({ success: true }))
    .catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});
