/**
 * CampaignCard — presentational campaign card (Phase 15).
 * Receives a fully-built view model; renders only (ADR-001).
 */
import type { CampaignView } from '@/lib/finance';

export interface CampaignCardLabels {
  donateNow: string;
  raisedPrefix: string;
}

export function CampaignCard({
  view,
  href,
  labels,
}: {
  view: CampaignView;
  href: string;
  labels: CampaignCardLabels;
}) {
  return (
    <article className="fin-card" aria-labelledby={`fin-${view.id}`}>
      {view.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="fin-card-cover" src={view.cover} alt="" loading="lazy" />
      ) : (
        <div className="fin-card-cover fin-card-cover-empty" aria-hidden />
      )}
      <div className="fin-card-body">
        <h3 className="fin-card-title" id={`fin-${view.id}`}>
          {view.title}
        </h3>
        {view.description ? <p className="fin-card-desc">{view.description}</p> : null}
        <div className="fin-progress-row">
          <div className="fin-progress" role="progressbar"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.progressPct}
            aria-label={view.progressLabel}>
            <div className="fin-progress-fill" style={{ width: `${view.progressPct}%` }} />
          </div>
          <span className="fin-pct">{view.progressLabel}</span>
        </div>
        <p className="fin-card-amounts">
          <span className="fin-raised">{view.raisedLabel}</span>
          <span className="fin-of">{labels.raisedPrefix}</span>
          <span className="fin-goal">{view.goalLabel}</span>
        </p>
        <a className="btn-primary fin-card-cta" href={href}>
          {labels.donateNow}
        </a>
      </div>
    </article>
  );
}
