/**
 * HifzVoiceSearch — record a short recitation and find the surah:ayah.
 *
 * Independent of session grading: the recording is transcribed and
 * ranked against the Quran text; candidates are labelled probable /
 * possible and NEVER certain. The user picks a candidate to navigate
 * to. Nothing here is a grade.
 */
import { useState } from 'react';
import { authFetch } from '@/lib/auth-client';
import { HifzMicDeniedError, startWavRecording } from '@/lib/hifz-record-wav';

const HIFZ_API = '/api/v1/quran/hifz';

export interface VoiceSearchCandidate {
  surah: number;
  ayah: number;
  match_text: string | null;
  score: number;
  confidence: string;
}

export interface HifzVoiceSearchLabels {
  title: string;
  hint: string;
  record: string;
  stopRecord: string;
  recording: string;
  searching: string;
  micDenied: string;
  error: string;
  noCandidates: string;
  probable: string;
  possible: string;
  note: string;
  goTo: string;
}

export function HifzVoiceSearch({
  onNavigate,
  labels,
}: {
  onNavigate: (surah: number, ayah: number) => void;
  labels: HifzVoiceSearchLabels;
}) {
  const [recording, setRecording] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<VoiceSearchCandidate[] | null>(null);
  const [note, setNote] = useState('');
  const [recorder, setRecorder] = useState<{ stop: () => Promise<Blob>; cancel: () => void } | null>(null);

  const start = async () => {
    setError(null);
    setCandidates(null);
    try {
      const rec = await startWavRecording(30);
      setRecorder(rec);
      setRecording(true);
    } catch (e) {
      setError(e instanceof HifzMicDeniedError ? labels.micDenied : labels.error);
    }
  };

  const stopAndSearch = async () => {
    if (!recorder) return;
    setRecording(false);
    setSearching(true);
    try {
      const wav = await recorder.stop();
      setRecorder(null);
      const form = new FormData();
      form.append('audio', wav, 'rec.wav');
      const res = await authFetch(`${HIFZ_API}/voice-search`, { method: 'POST', body: form });
      const body = (await res.json()) as {
        candidates: VoiceSearchCandidate[];
        note: string;
      };
      setCandidates(body.candidates ?? []);
      setNote(body.note ?? '');
    } catch {
      setError(labels.error);
    } finally {
      setSearching(false);
    }
  };

  return (
    <section className="hifz-voice-search" aria-label={labels.title}>
      <h3>{labels.title}</h3>
      <p className="hifz-hint">{labels.hint}</p>
      {!recording && !searching && (
        <button type="button" onClick={start}>
          {labels.record}
        </button>
      )}
      {recording && (
        <>
          <p className="hifz-hint">{labels.recording}</p>
          <button type="button" onClick={stopAndSearch}>
            {labels.stopRecord}
          </button>
        </>
      )}
      {searching && <p className="hifz-hint">{labels.searching}</p>}
      {error && (
        <p className="hifz-error" role="alert">
          {error}
        </p>
      )}
      {candidates !== null && (
        <div>
          {note && <p className="hifz-hint">{note}</p>}
          {candidates.length === 0 && <p>{labels.noCandidates}</p>}
          <ul>
            {candidates.map((c) => (
              <li key={`${c.surah}:${c.ayah}`}>
                <button type="button" onClick={() => onNavigate(c.surah, c.ayah)}>
                  {labels.goTo} {c.surah}:{c.ayah}
                </button>{' '}
                <span>
                  {c.confidence === 'probable' ? labels.probable : labels.possible}
                </span>
                {c.match_text && (
                  <span dir="rtl" lang="ar">
                    {' '}
                    — {c.match_text}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
