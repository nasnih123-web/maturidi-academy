import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getLibraryItems } from '@/lib/library';
import type { LibraryGridLabels } from '@/components/LibraryGrid';
import type { LibraryKind } from '@/lib/library';
import { LibraryGrid } from '@/components/LibraryGridLazy';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'library' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Library index (Phase 9).
 *
 * Thin RSC shell: metadata + server-fetched first page of items, then the
 * code-split interactive grid (tabs / tags / ranked search). On API failure
 * the grid still mounts and surfaces its own honest error state.
 */
export default async function LibraryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'library' });

  let initialItems: Awaited<ReturnType<typeof getLibraryItems>>['items'] = [];
  let initialCursor: string | null = null;
  try {
    const res = await getLibraryItems({});
    initialItems = res.items;
    initialCursor = res.next_cursor;
  } catch {
    initialItems = [];
    initialCursor = null;
  }

  const kinds = ['all', 'video', 'video_360', 'pdf', 'audio', 'mindmap'] as const;
  const kindLabels = Object.fromEntries(
    kinds.map((k) => [k, t(`kinds.${k}`)]),
  ) as Record<LibraryKind | 'all', string>;

  const labels: LibraryGridLabels = {
    openItem: t('openItem'),
    kindLabel: '',
    searchPlaceholder: t('searchPlaceholder'),
    searchAria: t('searchAria'),
    tagFilterLabel: t('tagFilterLabel'),
    allTags: t('allTags'),
    kinds: kindLabels,
    noResults: t('noResults'),
    noResultsHint: t('noResultsHint'),
    loadFailed: t('loadFailed'),
    retry: t('retry'),
    loading: t('loading'),
    loadMore: t('loadMore'),
    untitled: t('untitled'),
  };

  return (
    <div className="page-wrap">
      <h1 className="page-title">{t('title')}</h1>
      <p className="page-subtitle">{t('subtitle')}</p>
      <LibraryGrid
        locale={locale}
        initialItems={initialItems}
        initialCursor={initialCursor}
        labels={labels}
      />
    </div>
  );
}
