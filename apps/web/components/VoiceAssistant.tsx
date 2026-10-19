'use client';

/**
 * VoiceAssistant — Phase 12 bilingual (fa/ar) push-to-talk UI.
 *
 * Pure presentation (ADR-001): every behavior comes from
 * `useVoiceAssistant` (lib/hooks/useVoiceAssistant.ts); this file only
 * renders props and forwards DOM events. Subcomponents are exported so a
 * temporary screenshot harness can render each visual state with canned
 * props — no demo logic lives in the production path.
 */
import { useVoiceAssistant, type VoiceErrorCode, type VoicePhase, type VoiceTurn } from '@/lib/hooks/useVoiceAssistant';

export interface VoiceAssistantLabels {
  holdHint: string;
  tapHint: string;
  micAria: string;
  micUnsupportedHint: string;
  phaseIdle: string;
  phaseRecording: string;
  phaseTranscribing: string;
  phaseAnswering: string;
  phasePlaying: string;
  cancelRecording: string;
  cancelRequest: string;
  you: string;
  assistant: string;
  voiceMessageCaption: string;
  recitationLabel: string;
  ttsLabel: string;
  noAudioNote: string;
  playAria: string;
  pauseAria: string;
  citationsTitle: string;
  clearConversation: string;
  emptyHint: string;
  dismissAria: string;
  /** Honest degradation notes for backend `notice` codes (ADR-0009 §4). */
  noticeTtsUnavailable: string;
  noticeSttUnavailable: string;
  errors: Record<Exclude<VoiceErrorCode, null>, string>;
}

/**
 * Backend degradation notice → localized honest caption. Unknown codes are
 * never rendered (no invented text).
 */
export function VoiceNoticeCaption({
  notice,
  labels,
}: {
  notice: string | null;
  labels: VoiceAssistantLabels;
}) {
  const text =
    notice === 'tts_unavailable'
      ? labels.noticeTtsUnavailable
      : notice === 'stt_unavailable'
        ? labels.noticeSttUnavailable
        : null;
  if (!text) return null;
  return <p className="vox-noaudio">{text}</p>;
}

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PHASE_CLASS: Record<VoicePhase, string> = {
  idle: 'vox-phase-idle',
  recording: 'vox-phase-recording',
  transcribing: 'vox-phase-transcribing',
  answering: 'vox-phase-answering',
  playing: 'vox-phase-playing',
};

/* ------------------------------------------------------------------ */
/* Status line: phase pill + recording timer + animated waveform       */
/* ------------------------------------------------------------------ */

export function VoiceStatusLine({
  phase,
  elapsedSec,
  labels,
}: {
  phase: VoicePhase;
  elapsedSec: number;
  labels: VoiceAssistantLabels;
}) {
  const phaseText =
    phase === 'recording'
      ? labels.phaseRecording
      : phase === 'transcribing'
        ? labels.phaseTranscribing
        : phase === 'answering'
          ? labels.phaseAnswering
          : phase === 'playing'
            ? labels.phasePlaying
            : labels.phaseIdle;
  return (
    <div className="vox-status" role="status" aria-live="polite">
      <span className={`vox-phase ${PHASE_CLASS[phase]}`}>{phaseText}</span>
      {phase === 'recording' && (
        <>
          <span className="vox-timer" aria-hidden="true">
            {formatElapsed(elapsedSec)}
          </span>
          {/* Decorative level animation — real mic level is not visualized. */}
          <span className="vox-wave" aria-hidden="true">
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className="vox-bar" style={{ animationDelay: `${(i % 8) * 0.09}s` }} />
            ))}
          </span>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mic button: press-and-hold + click-to-toggle (disambiguated in hook) */
/* ------------------------------------------------------------------ */

export function VoiceMicButton({
  phase,
  micSupported,
  labels,
  onMicPress,
  onMicRelease,
  onMicClick,
}: {
  phase: VoicePhase;
  micSupported: boolean;
  labels: VoiceAssistantLabels;
  onMicPress: () => void;
  onMicRelease: () => void;
  onMicClick: () => void;
}) {
  const busy = phase === 'transcribing' || phase === 'answering';
  const recording = phase === 'recording';
  return (
    <div className="vox-mic-zone">
      <button
        type="button"
        className={`vox-mic${recording ? ' vox-mic-recording' : ''}`}
        aria-label={labels.micAria}
        aria-pressed={recording}
        disabled={!micSupported || busy}
        onPointerDown={onMicPress}
        onPointerUp={onMicRelease}
        onPointerLeave={onMicRelease}
        onPointerCancel={onMicRelease}
        onClick={onMicClick}
      >
        <svg viewBox="0 0 24 24" className="vox-mic-icon" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path
            d="M5 11a7 7 0 0 0 14 0h-2a5 5 0 0 1-10 0H5zm7 9v3"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <p className="vox-hint">{micSupported ? labels.holdHint : labels.micUnsupportedHint}</p>
      {micSupported && !recording && <p className="vox-hint vox-hint-dim">{labels.tapHint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-turn audio player                                               */
/* ------------------------------------------------------------------ */

export function VoicePlayerRow({
  turn,
  labels,
  playing,
  progress,
  onToggle,
}: {
  turn: VoiceTurn;
  labels: VoiceAssistantLabels;
  playing: boolean;
  progress: number;
  onToggle: () => void;
}) {
  if (!turn.audioUrl) {
    return <p className="vox-noaudio">{labels.noAudioNote}</p>;
  }
  const isRecitation = turn.audioKind === 'recitation';
  return (
    <div className="vox-player">
      <button
        type="button"
        className="vox-play"
        aria-label={playing ? labels.pauseAria : labels.playAria}
        onClick={onToggle}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="vox-play-icon" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
            <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="vox-play-icon" aria-hidden="true">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div className="vox-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className="vox-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      {/* Recitation is a REAL recitation recording — never labeled as synthesis. */}
      <span className={isRecitation ? 'vox-kind vox-kind-recitation' : 'vox-kind vox-kind-tts'}>
        {isRecitation ? labels.recitationLabel : labels.ttsLabel}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Transcript: conversation bubbles                                    */
/* ------------------------------------------------------------------ */

export function VoiceTranscript({
  turns,
  labels,
  playingTurnId,
  isPlaying,
  playbackProgress,
  onToggleAudio,
}: {
  turns: VoiceTurn[];
  labels: VoiceAssistantLabels;
  playingTurnId: string | null;
  isPlaying: boolean;
  playbackProgress: number;
  onToggleAudio: (turn: VoiceTurn) => void;
}) {
  if (turns.length === 0) {
    return <p className="vox-empty">{labels.emptyHint}</p>;
  }
  return (
    <div className="vox-turns" aria-live="polite">
      {turns.map((turn) =>
        turn.role === 'user' ? (
          <div key={turn.id} className="vox-turn vox-user">
            <span className="vox-role">{labels.you}</span>
            <p className="vox-bubble">
              {turn.pending || !turn.text ? (
                <span className="vox-pending-caption">🎙 {labels.voiceMessageCaption}…</span>
              ) : (
                turn.text
              )}
            </p>
          </div>
        ) : (
          <div key={turn.id} className="vox-turn vox-assistant">
            <span className="vox-role">{labels.assistant}</span>
            <div className="vox-bubble">
              <p className="vox-answer">{turn.text}</p>
              <VoicePlayerRow
                turn={turn}
                labels={labels}
                playing={playingTurnId === turn.id && isPlaying}
                progress={playingTurnId === turn.id ? playbackProgress : 0}
                onToggle={() => onToggleAudio(turn)}
              />
              <VoiceNoticeCaption notice={turn.notice} labels={labels} />
              {turn.citations.length > 0 && (
                <div className="vox-citations">
                  <p className="vox-citations-title">{labels.citationsTitle}</p>
                  <ul>
                    {turn.citations.map((c, i) => (
                      <li key={c.chunkId ?? i}>
                        <span className="vox-cite-source">{c.sourceCitation}</span>
                        {c.excerpt && <span className="vox-cite-excerpt"> — {c.excerpt}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Container: wires the hook to the presentational pieces              */
/* ------------------------------------------------------------------ */

export function VoiceAssistant({ locale, labels }: { locale: 'fa' | 'ar'; labels: VoiceAssistantLabels }) {
  const v = useVoiceAssistant(locale);

  return (
    <div className="vox-wrap">
      <VoiceStatusLine phase={v.phase} elapsedSec={v.elapsedSec} labels={labels} />

      <VoiceMicButton
        phase={v.phase}
        micSupported={v.micSupported}
        labels={labels}
        onMicPress={v.onMicPress}
        onMicRelease={v.onMicRelease}
        onMicClick={v.onMicClick}
      />

      <div className="vox-actions">
        {v.phase === 'recording' && (
          <button type="button" className="vox-btn vox-btn-danger" onClick={v.cancelRecording}>
            {labels.cancelRecording}
          </button>
        )}
        {(v.phase === 'transcribing' || v.phase === 'answering') && (
          <button type="button" className="vox-btn" onClick={v.cancelRequest}>
            {labels.cancelRequest}
          </button>
        )}
        {v.phase === 'idle' && v.turns.length > 0 && (
          <button type="button" className="vox-btn vox-btn-ghost" onClick={v.clearConversation}>
            {labels.clearConversation}
          </button>
        )}
      </div>

      {v.error && (
        <div className="vox-error" role="alert">
          <span>{labels.errors[v.error]}</span>
          <button type="button" className="vox-btn vox-btn-ghost" onClick={v.dismissError} aria-label={labels.dismissAria}>
            ✕
          </button>
        </div>
      )}

      <VoiceTranscript
        turns={v.turns}
        labels={labels}
        playingTurnId={v.playingTurnId}
        isPlaying={v.isPlaying}
        playbackProgress={v.playbackProgress}
        onToggleAudio={v.toggleTurnAudio}
      />
    </div>
  );
}
