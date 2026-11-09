/**
 * apps/mobile — src/services/listenAudio.ts
 *
 * The listen-mode audio backend (completion mission §5): one shared
 * expo-audio player for the whole app.
 *
 * - SINGLETON: exactly one `AudioPlayer` exists at a time. Loading a
 *   new source replaces (`replace()`) the current one — starting a
 *   listen never leaves a second stream playing next to it. There is
 *   no other audio producer in the app (verified by grep: the Hifz
 *   recorder captures microphone input, Adhan has no playback), so
 *   this singleton is the whole "no unwanted simultaneous audio"
 *   guarantee. The player lives in this module, not in a screen, so
 *   navigating to another page never stops playback; the mini player
 *   controls it from anywhere.
 * - SOURCES: per-surah audio from QuranicAudio (via the timing
 *   endpoint) or per-ayah audio from the surah bundle — streamed,
 *   never bundled. `expo-audio` (`createAudioPlayer`, SDK 58) is the
 *   supported playback API; `expo-av` is deprecated and not used.
 * - OFFLINE: `downloadSurahAudio()` saves the surah file to the app
 *   cache (`Paths.cache/listen/<reciter>-<surah>.mp3`) with
 *   expo-file-system; `localAudioUri()` returns it when present so an
 *   offline play uses the file. Timing JSON is cached separately in
 *   the kv table (see listenSync). A download is explicit (user taps
 *   "download") — no silent bulk download, and the OS may reclaim
 *   cache files; a missing file just means "stream again".
 * - ERRORS are honest kinds (`audio` | `offline`); a failed load
 *   never spins forever and never falls back to a different reciter.
 * - iOS background audio: `UIBackgroundModes: ["audio"]` in app.json
 *   (takes effect after the next prebuild). Android keeps the
 *   ExoPlayer session while the app is alive; lock-screen controls
 *   are wired via `setActiveForLockScreen` on play.
 *
 * Native module note: adding `expo-audio` needs a fresh prebuild /
 * dev build (`npx expo prebuild` / `eas build`) — an OTA/JS-only
 * update cannot add it.
 */
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";

export type ListenAudioErrorKind = "audio" | "offline";

export interface ListenAudioStatus {
  /** Seconds into the current source. */
  currentTime: number;
  /** Total seconds of the current source (0 = unknown yet). */
  duration: number;
  playing: boolean;
  isBuffering: boolean;
  isLoaded: boolean;
  didJustFinish: boolean;
}

function toStatus(s: AudioStatus): ListenAudioStatus {
  return {
    currentTime: s.currentTime,
    duration: s.duration,
    playing: s.playing,
    isBuffering: s.isBuffering,
    isLoaded: s.isLoaded,
    didJustFinish: s.didJustFinish,
  };
}

const LISTEN_DIR = "listen";

function listenDir(): Directory {
  const dir = new Directory(Paths.cache, LISTEN_DIR);
  if (!dir.exists) dir.create();
  return dir;
}

/** Cache file name for one reciter + surah (audio only, no text). */
export function listenAudioFileName(reciter: string, surah: number): string {
  const safe = reciter.replace(/[^a-z0-9_-]/gi, "_");
  return `${safe}-${surah}.mp3`;
}

function audioFile(reciter: string, surah: number): File {
  return new File(listenDir(), listenAudioFileName(reciter, surah));
}

/** Local cached file for this reciter + surah, or null (not downloaded). */
export function localAudioUri(reciter: string, surah: number): string | null {
  try {
    const f = audioFile(reciter, surah);
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}

/** True when the surah audio is already downloaded for offline play. */
export function isAudioDownloaded(reciter: string, surah: number): boolean {
  return localAudioUri(reciter, surah) !== null;
}

/**
 * Download the surah audio for offline play. Returns the local uri.
 * Throws on network failure (caller maps it to `offline` / `audio`);
 * a partially written file is deleted so a later play never reads a
 * truncated file as if it were complete.
 */
export async function downloadSurahAudio(reciter: string, surah: number, remoteUrl: string): Promise<string> {
  const dest = audioFile(reciter, surah);
  try {
    const file = await File.downloadFileAsync(remoteUrl, dest, { idempotent: true });
    return file.uri;
  } catch (e) {
    try {
      if (dest.exists) dest.delete();
    } catch {
      /* best-effort cleanup */
    }
    throw e;
  }
}

/** Delete a downloaded surah file (frees cache; streaming still works). */
export function deleteDownloadedAudio(reciter: string, surah: number): void {
  try {
    const f = audioFile(reciter, surah);
    if (f.exists) f.delete();
  } catch {
    /* already gone */
  }
}

// ── Singleton player ────────────────────────────────────────────────────

let player: AudioPlayer | null = null;
let currentSource: string | null = null;
let statusListeners = new Set<(s: ListenAudioStatus) => void>();
let statusSubscription: { remove: () => void } | null = null;

function emitStatus(s: AudioStatus): void {
  const mapped = toStatus(s);
  for (const fn of statusListeners) fn(mapped);
}

function ensurePlayer(source: string): AudioPlayer {
  if (player === null) {
    player = createAudioPlayer(source, { updateInterval: 250 });
    currentSource = source;
    statusSubscription = player.addListener("playbackStatusUpdate", emitStatus);
    return player;
  }
  if (currentSource !== source) {
    // One stream at a time: replacing the source stops the old one.
    player.replace(source);
    currentSource = source;
  }
  return player;
}

/** Subscribe to playback status (the hook uses this; returns unsubscribe). */
export function onListenStatus(fn: (s: ListenAudioStatus) => void): () => void {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

/** Load (or switch to) a source without starting playback. */
export function loadListenSource(source: string): AudioPlayer {
  return ensurePlayer(source);
}

/** Play the given source (replaces any current stream). */
export function playListenSource(source: string): AudioPlayer {
  const p = ensurePlayer(source);
  p.play();
  return p;
}

/** The current player, if one exists. */
export function getListenPlayer(): AudioPlayer | null {
  return player;
}

/** Current status snapshot (null = no player yet). */
export function getListenStatus(): ListenAudioStatus | null {
  if (!player) return null;
  return {
    currentTime: player.currentTime,
    duration: player.duration,
    playing: player.playing,
    isBuffering: player.isBuffering,
    isLoaded: player.isLoaded,
    didJustFinish: false,
  };
}

export function pauseListen(): void {
  player?.pause();
}

export function resumeListen(): void {
  player?.play();
}

/** Stop playback and drop the source (keeps the player for reuse). */
export function stopListen(): void {
  if (!player) return;
  try {
    player.pause();
  } catch {
    /* already stopped */
  }
  try {
    player.replace(null);
  } catch {
    /* no source to drop */
  }
  currentSource = null;
}

export async function seekListen(seconds: number): Promise<void> {
  if (!player) return;
  await player.seekTo(Math.max(0, seconds));
}

export function setListenRate(rate: number): void {
  if (!player) return;
  try {
    player.setPlaybackRate(rate);
  } catch {
    /* rate outside the platform range — the hook only sends valid rates */
  }
}

/** Put this player on the lock screen (title = surah, artist = reciter). */
export function setListenLockScreen(active: boolean, surahName: string, reciterLabel: string): void {
  if (!player) return;
  try {
    if (active) {
      player.setActiveForLockScreen(true, { title: surahName, artist: reciterLabel });
    } else {
      player.clearLockScreenControls();
    }
  } catch {
    /* lock-screen controls are best-effort (notably on older Android) */
  }
}

/** Release the singleton entirely (app shutdown / logout). */
export function releaseListenPlayer(): void {
  try {
    statusSubscription?.remove();
  } catch {
    /* already removed */
  }
  statusSubscription = null;
  if (player) {
    try {
      player.pause();
    } catch {
      /* ignore */
    }
    try {
      player.remove();
    } catch {
      /* ignore */
    }
  }
  player = null;
  currentSource = null;
}
