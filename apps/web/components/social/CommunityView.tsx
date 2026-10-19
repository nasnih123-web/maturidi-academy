'use client';

/**
 * CommunityView — group directory page (client shell, ADR-001).
 * Data + join/leave state machine lives in useSocialGroups.
 */

import { useSocialGroups } from '@/lib/hooks/useSocial';
import { GroupCard } from './GroupCard';
import type { SocialLabels } from './labels';

interface CommunityViewProps {
  locale: string;
  labels: SocialLabels;
}

export function CommunityView({ locale, labels }: CommunityViewProps) {
  const groups = useSocialGroups();

  return (
    <div className="page-wrap">
      <h1 className="page-title">{labels.title}</h1>
      <p className="page-sub">{labels.subtitle}</p>

      {groups.loading && (
        <p className="soc-status" role="status">
          {labels.loading}
        </p>
      )}
      {groups.error && !groups.loading && (
        <div className="soc-status" role="alert">
          <p>{labels.error}</p>
          <button type="button" className="soc-btn soc-btn-ghost" onClick={groups.retry}>
            {labels.retry}
          </button>
        </div>
      )}
      {!groups.loading && !groups.error && groups.items.length === 0 && (
        <p className="soc-empty" role="status">
          {labels.empty}
        </p>
      )}
      <div className="soc-group-list">
        {groups.items.map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            href={`/${locale}/community/${encodeURIComponent(g.id)}`}
            joinLabel={labels.join}
            leaveLabel={labels.leave}
            joiningLabel={labels.joining}
            leavingLabel={labels.leaving}
            membersLabel={labels.members}
            visitLabel={labels.visitGroup}
            busy={groups.busyId === g.id}
            onToggleJoin={() => void groups.toggleJoin(g)}
          />
        ))}
      </div>
      {groups.cursor !== null && (
        <div className="soc-more">
          <button
            type="button"
            className="soc-btn soc-btn-ghost"
            onClick={() => void groups.loadMore()}
            disabled={groups.loadingMore}
          >
            {labels.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
