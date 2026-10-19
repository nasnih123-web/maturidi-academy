/**
 * Server-side label builder for the Phase 10 social routes.
 *
 * Maps the next-intl `social` namespace into the SocialLabels contract
 * that the presentational components consume (ADR-001: no hardcoded
 * user-visible text in components).
 */

import { REPORT_REASONS, type SocialLabels } from '@/components/social/labels';

type T = (key: string) => string;

export function buildSocialLabels(t: T): SocialLabels {
  const reportReasons: Record<string, string> = {};
  for (const reason of REPORT_REASONS) {
    reportReasons[reason] = t(`reportReasons.${reason}`);
  }
  return {
    title: t('title'),
    subtitle: t('subtitle'),
    join: t('join'),
    leave: t('leave'),
    joining: t('joining'),
    leaving: t('leaving'),
    members: t('members'),
    empty: t('empty'),
    loading: t('loading'),
    error: t('error'),
    retry: t('retry'),
    loadMore: t('loadMore'),
    visitGroup: t('visitGroup'),
    backToCommunity: t('backToCommunity'),
    groupPosts: t('groupPosts'),
    emptyPosts: t('emptyPosts'),
    feedTitle: t('feedTitle'),
    feedSubtitle: t('feedSubtitle'),
    emptyFeed: t('emptyFeed'),
    loginHint: t('loginHint'),
    composerPlaceholder: t('composerPlaceholder'),
    post: t('post'),
    posting: t('posting'),
    policyViolation: t('policyViolation'),
    postError: t('postError'),
    like: t('like'),
    unlike: t('unlike'),
    follow: t('follow'),
    unfollow: t('unfollow'),
    comments: t('comments'),
    commentsTitle: t('commentsTitle'),
    emptyComments: t('emptyComments'),
    commentPlaceholder: t('commentPlaceholder'),
    comment: t('comment'),
    commenting: t('commenting'),
    report: t('report'),
    reportTitle: t('reportTitle'),
    reportReason: t('reportReason'),
    reportReasons,
    reportSubmit: t('reportSubmit'),
    reportCancel: t('reportCancel'),
    reportSuccess: t('reportSuccess'),
    reportError: t('reportError'),
    close: t('close'),
  };
}
