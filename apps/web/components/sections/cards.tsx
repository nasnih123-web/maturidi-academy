/**
 * cards — shared card factory for the section variants: maps plain
 * TemplateItems onto ContentCard elements with the section's type/template.
 * No hooks, no logic — pure element construction (ADR-0002).
 */
import { ContentCard } from '../ContentCard';
import type { SectionVariantProps } from './types';

export function variantCards(props: SectionVariantProps, items = props.items) {
  const dir = props.locale === 'en' ? 'ltr' : 'rtl';
  return items.map((it) => (
    <ContentCard
      key={it.id}
      type={props.contentType}
      template={props.template}
      item={it}
      dir={dir}
      labels={props.labels}
    />
  ));
}
