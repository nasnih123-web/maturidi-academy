/**
 * Label contracts for the Phase 10 social views (ADR-001).
 *
 * Components never hardcode user-visible text — every string arrives
 * from the server page (next-intl) through these props. The report
 * reason keys are fixed wire values ("spam" | "harassment" | …).
 */

export interface SocialLabels {
  title: string;
  subtitle: string;
  join: string;
  leave: string;
  joining: string;
  leaving: string;
  members: string;
  empty: string;
  loading: string;
  error: string;
  retry: string;
  loadMore: string;
  visitGroup: string;
  backToCommunity: string;
  groupPosts: string;
  emptyPosts: string;
  feedTitle: string;
  feedSubtitle: string;
  emptyFeed: string;
  loginHint: string;
  composerPlaceholder: string;
  post: string;
  posting: string;
  policyViolation: string;
  postError: string;
  like: string;
  unlike: string;
  follow: string;
  unfollow: string;
  comments: string;
  commentsTitle: string;
  emptyComments: string;
  commentPlaceholder: string;
  comment: string;
  commenting: string;
  report: string;
  reportTitle: string;
  reportReason: string;
  reportReasons: Record<string, string>;
  reportSubmit: string;
  reportCancel: string;
  reportSuccess: string;
  reportError: string;
  close: string;
}

/** Reason values sent to POST /api/v1/social/report (wire contract). */
export const REPORT_REASONS = ['spam', 'harassment', 'misinformation', 'inappropriate', 'other'] as const;

export interface FatwaQuestionLabels {
  title: string;
  subtitle: string;
  questionLabel: string;
  questionPlaceholder: string;
  ask: string;
  asking: string;
  suggestionTitle: string;
  answeredAt: string;
  clusterLabel: string;
  noSuggestion: string;
  error: string;
}

export interface FatwaSubmitLabels {
  title: string;
  subtitle: string;
  titleLabel: string;
  titlePlaceholder: string;
  bodyLabel: string;
  bodyPlaceholder: string;
  madhabLabel: string;
  madhabOptions: Record<string, string>;
  evidenceLabel: string;
  evidencePlaceholder: string;
  submit: string;
  submitting: string;
  successTitle: string;
  successBody: string;
  error: string;
  forbidden: string;
}
