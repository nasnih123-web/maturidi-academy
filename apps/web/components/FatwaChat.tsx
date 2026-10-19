'use client';

/**
 * FatwaChat — interactive ask UI (Phase 6).
 *
 * Pure presentation + hook wiring. All strings arrive via `labels`;
 * all logic lives in lib/hooks/useFatwaChat.ts and lib/fatwa.ts (ADR-001).
 */
import { useState } from 'react';
import { useFatwaChat } from '@/lib/hooks/useFatwaChat';
import type { FatwaStatus } from '@/lib/fatwa';

export interface FatwaChatLabels {
  noticeTitle: string;
  noticeBody: string;
  questionLabel: string;
  questionPlaceholder: string;
  ask: string;
  cancel: string;
  streamingLabel: string;
  categoryAll: string;
  categoriesLoading: string;
  categoriesFailed: string;
  historyTitle: string;
  historyEmpty: string;
  clearHistory: string;
  newChat: string;
  showHistory: string;
  hideHistory: string;
  citationsTitle: string;
  idkTitle: string;
  idkBody: string;
  llmUnavailableTitle: string;
  llmUnavailableBody: string;
  askFailed: string;
  emptyHint: string;
  youLabel: string;
  assistantLabel: string;
  usageLabel: string;
}

function StatusNote({ status, labels }: { status: FatwaStatus; labels: FatwaChatLabels }) {
  if (status === 'idk') {
    return (
      <div className="ftw-status ftw-status-idk" role="status">
        <strong>{labels.idkTitle}</strong>
        <p>{labels.idkBody}</p>
      </div>
    );
  }
  if (status === 'llm_unavailable') {
    return (
      <div className="ftw-status ftw-status-warn" role="status">
        <strong>{labels.llmUnavailableTitle}</strong>
        <p>{labels.llmUnavailableBody}</p>
      </div>
    );
  }
  return null;
}

export function FatwaChat({ labels, locale }: { labels: FatwaChatLabels; locale: string }) {
  const chat = useFatwaChat(locale);
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || chat.streaming) return;
    chat.ask(question, category, true);
    setQuestion('');
  };

  return (
    <div className="ftw-chat">
      <div className="ftw-notice" role="note">
        <strong>{labels.noticeTitle}</strong>
        <p>{labels.noticeBody}</p>
      </div>

      <div className="ftw-toolbar">
        <button type="button" className="icon-btn" onClick={chat.newChat}>
          {labels.newChat}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
        >
          {showHistory ? labels.hideHistory : labels.showHistory}
        </button>
      </div>

      {showHistory && (
        <div className="ftw-history" role="region" aria-label={labels.historyTitle}>
          <div className="ftw-history-head">
            <h2>{labels.historyTitle}</h2>
            <button type="button" className="icon-btn" onClick={chat.clearHistory}>
              {labels.clearHistory}
            </button>
          </div>
          {chat.history.length === 0 ? (
            <p className="ftw-muted">{labels.historyEmpty}</p>
          ) : (
            <ul>
              {chat.history.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => { chat.openSession(s); setShowHistory(false); }}>
                    {s.title || s.id}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="ftw-cats" role="group" aria-label={labels.questionLabel}>
        {chat.categoriesLoading ? (
          <span className="ftw-muted">{labels.categoriesLoading}</span>
        ) : chat.categoriesFailed ? (
          <span className="ftw-muted">{labels.categoriesFailed}</span>
        ) : (
          <>
            <button
              type="button"
              className={category === null ? 'ftw-chip on' : 'ftw-chip'}
              onClick={() => setCategory(null)}
              aria-pressed={category === null}
            >
              {labels.categoryAll}
            </button>
            {chat.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={category === c.id ? 'ftw-chip on' : 'ftw-chip'}
                onClick={() => setCategory(c.id)}
                aria-pressed={category === c.id}
                title={c.description}
              >
                {c.title}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="ftw-turns" aria-live="polite">
        {chat.turns.length === 0 && !chat.streaming && (
          <p className="ftw-muted ftw-empty">{labels.emptyHint}</p>
        )}
        {chat.turns.map((turn) =>
          turn.role === 'user' ? (
            <div key={turn.id} className="ftw-turn ftw-user">
              <span className="ftw-role">{labels.youLabel}</span>
              <p>{turn.text}</p>
            </div>
          ) : (
            <div key={turn.id} className="ftw-turn ftw-assistant">
              <span className="ftw-role">{labels.assistantLabel}</span>
              {turn.status && <StatusNote status={turn.status} labels={labels} />}
              <p className="ftw-answer">{turn.text}</p>
              {turn.aiLabel && <p className="ftw-ai-label">{turn.aiLabel}</p>}
              {turn.citations.length > 0 && (
                <div className="ftw-citations">
                  <h3>{labels.citationsTitle}</h3>
                  <ul>
                    {turn.citations.map((c) => (
                      <li key={c.chunk_id || c.source_citation}>
                        <strong>{c.source_citation}</strong>
                        {c.excerpt && <p>{c.excerpt}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ),
        )}
        {chat.streaming && (
          <div className="ftw-turn ftw-assistant">
            <span className="ftw-role">{labels.assistantLabel}</span>
            <p className="ftw-answer">{chat.streamText || labels.streamingLabel}</p>
            <button type="button" className="icon-btn ftw-cancel" onClick={chat.cancel}>
              {labels.cancel}
            </button>
          </div>
        )}
      </div>

      {chat.error && (
        <div className="ftw-error" role="alert">
          {labels.askFailed}: {chat.error}
        </div>
      )}

      <form className="ftw-form" onSubmit={submit}>
        <label className="ftw-sr" htmlFor="ftw-q">{labels.questionLabel}</label>
        <textarea
          id="ftw-q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={labels.questionPlaceholder}
          rows={3}
          disabled={chat.streaming}
        />
        <div className="ftw-form-actions">
          {chat.streaming ? (
            <button type="button" className="icon-btn" onClick={chat.cancel}>
              {labels.cancel}
            </button>
          ) : (
            <button type="submit" className="ftw-ask" disabled={!question.trim()}>
              {labels.ask}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
