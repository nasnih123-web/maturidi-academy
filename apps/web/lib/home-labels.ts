import type { getTranslations } from 'next-intl/server';
import type { HomeSectionsLabels } from '@/components/HomeSections';
import type { SearchAutocompleteLabels } from '@/components/SearchAutocomplete';

type T = Awaited<ReturnType<typeof getTranslations>>;

/**
 * Build the label sets the homepage section renderers need from next-intl.
 * Pure functions (service layer) — shared by the homepage and by CMS pages
 * that embed homepage sections (`section-*` blocks). All strings come from
 * the `home` message namespace; nothing is hardcoded.
 */
export function buildSearchLabels(t: T): SearchAutocompleteLabels {
  return {
    label: t('search.label'),
    placeholder: t('search.placeholder'),
    searchButton: t('search.searchButton'),
    loading: t('search.loading'),
    noResults: t('search.noResults'),
    // raw template — {count} is substituted client-side (functions can't cross the RSC boundary)
    resultsSummaryTemplate: t.raw('search.resultsSummary'),
    searchUnavailable: t('search.searchUnavailable'),
    clear: t('search.clear'),
    typeNames: {
      section: t('search.types.section'),
      theme: t('search.types.theme'),
      fatwa: t('search.types.fatwa'),
      lesson: t('search.types.lesson'),
      book: t('search.types.book'),
      verse: t('search.types.verse'),
      article: t('search.types.article'),
      course: t('search.types.course'),
      page: t('search.types.page'),
    },
  };
}

export function buildHomeLabels(t: T): HomeSectionsLabels {
  return {
    heroCtaPrimary: t('hero.ctaPrimary'),
    heroCtaSecondary: t('hero.ctaSecondary'),
    status: {
      aria: t('status.aria'),
      solar: t('status.solar'),
      gregorian: t('status.gregorian'),
      hijri: t('status.hijri'),
    },
    card: {
      details: t('card.details'),
      view: t('card.view'),
      play: t('card.play'),
      pause: t('card.pause'),
      verified: t('card.verified'),
      seal: t('card.seal'),
      sliderPrev: t('card.sliderPrev'),
      sliderNext: t('card.sliderNext'),
    },
    quoteAria: t('quoteAria'),
    mapLink: t('mapLink'),
    search: buildSearchLabels(t),
    emptyFallback: t('emptyFallback'),
    donateCtaLabel: t('donateCtaLabel'),
    viewAllLabel: t('viewAllLabel'),
  };
}
