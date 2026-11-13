const STORAGE_KEY = 'voiceAssistantEnabled';

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let enabled = readInitial();
const listeners = new Set<() => void>();

let currentAudio: HTMLAudioElement | null = null;

function stopAudio(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      // ignore
    }
    currentAudio = null;
  }
}

export function isVoiceEnabled(): boolean {
  return enabled;
}

export function setVoiceEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
  } catch {
    // ignore storage failures
  }
  if (!next) stopAudio();
  for (const listener of listeners) listener();
}

export function subscribeVoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function unlockVoice(): void {
  try {
    const audio = new Audio(
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
    );
    void audio.play().catch(() => undefined);
  } catch {
    // ignore
  }
}

const FEMALE_VOICE_HINTS =
  /(female|zira|jenny|aria|hazel|eva|libby|sonia|sonoma|madison|ava|samantha|karen|susan|victoria|serena|tessa|iona|anna|nova)/i;

function pickFemaleVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'));
  const pool = english.length > 0 ? english : voices;
  return (
    pool.find((voice) => FEMALE_VOICE_HINTS.test(voice.name)) ??
    pool[0] ??
    null
  );
}

function playSpeechSynthesis(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickFemaleVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    // ignore
  }
}

async function playGemini(text: string): Promise<void> {
  const response = await fetch('/api/voice/announce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  currentAudio = audio;
  try {
    await audio.play();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err instanceof Error ? err : new Error('Playback blocked.');
  } finally {
    if (currentAudio === audio) currentAudio = null;
  }
}

export function announce(text: string): void {
  if (!enabled) return;
  stopAudio();
  void playGemini(text).catch(() => {
    if (enabled) playSpeechSynthesis(text);
  });
}
