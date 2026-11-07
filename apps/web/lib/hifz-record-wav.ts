/**
 * hifz-record-wav: short WAV recording for the hifz hub flows
 * (Testing Mode answers, Voice Search).
 *
 * MediaRecorder -> decode -> OfflineAudioContext resample to 16kHz
 * mono -> WAV. The audio is transient: the blob goes straight to the
 * grading/search endpoint and is never stored. Mic denial surfaces a
 * distinct error so the caller can show the right message.
 */

import { encodeWav } from './hifz-wav';

export class HifzMicDeniedError extends Error {
  constructor() {
    super('microphone denied');
    this.name = 'HifzMicDeniedError';
  }
}

function encodeWav16kMono(samples: Float32Array): Blob {
  // Single canonical implementation: lib/hifz-wav.ts (byte-identical
  // at 16 kHz — same RIFF header, clamp and int16 conversion).
  return encodeWav(samples, 16000);
}

export interface WavRecorder {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

export async function startWavRecording(maxSeconds = 60): Promise<WavRecorder> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new HifzMicDeniedError();
    }
    throw err;
  }
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void (async () => {
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const ctx = new AudioContext();
          const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
          await ctx.close();
          const offline = new OfflineAudioContext(1, Math.ceil((decoded.duration * 16000) / 1), 16000);
          const src = offline.createBufferSource();
          src.buffer = decoded;
          src.connect(offline.destination);
          src.start();
          const rendered = await offline.startRendering();
          resolve(encodeWav16kMono(rendered.getChannelData(0)));
        } catch (e) {
          reject(e);
        }
      })();
    };
  });
  recorder.start();
  const timer = window.setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, maxSeconds * 1000);
  return {
    stop: () => {
      window.clearTimeout(timer);
      if (recorder.state !== 'inactive') recorder.stop();
      return stopped;
    },
    cancel: () => {
      window.clearTimeout(timer);
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
