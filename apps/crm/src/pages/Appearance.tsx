import React from "react";
import { Badge, Button } from "@maturidi/ui-web";
import { ApiError } from "../lib/api";
import { LOCALES, useI18n, type Locale } from "../lib/i18n";
import {
  DEFAULT_PARTICLES,
  EMPTY_HERO,
  SECTION_VARIANTS,
  parseHeroLocale,
  parseHomeSections,
  parseParticlesConfig,
  useAppearanceSettingsQuery,
  useWriteAppearanceKey,
  type HeroCta,
  type HeroLocale,
  type HomeSectionSlot,
  type ParticlesConfig,
} from "../lib/appearance";
import { ParticleField } from "../components/ParticleField";

/**
 * Appearance (ظاهر و تجربه) — super_admin only.
 *
 * Three presentation-config areas backed by platform_settings (Track A keys):
 *   1. Particles & effects → `particles` {enabled, count, speed, parallax, lines}
 *   2. Below-hero sections  → `home.sections` [{id, variant, enabled}]
 *   3. Hero text           → `hero.fa|ar|en` {title, subtitle, primary_cta, secondary_cta}
 *
 * This page only renders and binds forms; parsing/defaults/transport live in
 * lib/appearance.ts (ADR-001).
 */

function errText(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message || `HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* small visual sketch per section variant (presentational)            */
/* ------------------------------------------------------------------ */

function VariantPreview({ variant }: { variant: string }): React.ReactElement {
  const bar = (style: React.CSSProperties, key: number | string) => (
    <span key={key} className="vp-el" style={style} />
  );
  let els: React.ReactNode = null;
  switch (variant) {
    case "slider-classic":
      els = [0, 1, 2].map((i) => bar({ width: "30%", height: "100%" }, i));
      break;
    case "grid-cards":
      els = [0, 1, 2, 3].map((i) => bar({ width: "46%", height: "44%" }, i));
      break;
    case "featured-rail":
      els = (
        <>
          {bar({ width: "52%", height: "100%" }, "a")}
          <span className="vp-col" key="b">
            {bar({ width: "100%", height: "46%" }, "b1")}
            {bar({ width: "100%", height: "46%" }, "b2")}
          </span>
        </>
      );
      break;
    case "shelf-row":
      els = [0, 1, 2, 3, 4].map((i) =>
        bar({ width: "14%", height: `${72 + ((i * 13) % 26)}%` }, i),
      );
      break;
    case "mosaic-wall":
      els = (
        <>
          {bar({ width: "38%", height: "100%" }, "a")}
          <span className="vp-col" key="b">
            {bar({ width: "100%", height: "46%" }, "b1")}
            <span className="vp-row" key="b2">
              {bar({ width: "48%", height: "100%" }, "c1")}
              {bar({ width: "48%", height: "100%" }, "c2")}
            </span>
          </span>
        </>
      );
      break;
    case "editorial-split":
      els = (
        <>
          {bar({ width: "44%", height: "100%" }, "a")}
          <span className="vp-col" key="b">
            {[96, 70, 88].map((w, i) => bar({ width: `${w}%`, height: "14%" }, i))}
          </span>
        </>
      );
      break;
    case "featured-list":
      els = (
        <>
          {bar({ width: "40%", height: "100%" }, "a")}
          <span className="vp-col" key="b">
            {[92, 78, 85].map((w, i) => bar({ width: `${w}%`, height: "22%" }, i))}
          </span>
        </>
      );
      break;
    case "magazine-columns":
      els = [0, 1, 2].map((i) => (
        <span className="vp-col" key={i}>
          {[90, 65, 80].map((w, k) => bar({ width: `${w}%`, height: "16%" }, `${i}-${k}`))}
        </span>
      ));
      break;
    case "stack-timeline":
      els = (
        <span className="vp-col" key="d">
          {[70, 52, 64].map((w, i) =>
            bar({ width: `${w}%`, height: "22%", borderRadius: "999px" }, i),
          )}
        </span>
      );
      break;
    case "compact-list":
      els = (
        <span className="vp-col" key="t">
          {[96, 88, 94, 80].map((w, i) => bar({ width: `${w}%`, height: "16%" }, i))}
        </span>
      );
      break;
    default:
      els = bar({ width: "90%", height: "40%" }, "x");
  }
  return (
    <span className="variant-preview" aria-hidden="true">
      {els}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* 1. particles                                                         */
/* ------------------------------------------------------------------ */

function SliderRow({
  id,
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
}): React.ReactElement {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <span className="range-val" dir="ltr">{display}</span>
      </label>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function ParticlesPanel(): React.ReactElement {
  const { t } = useI18n();
  const settings = useAppearanceSettingsQuery();
  const writer = useWriteAppearanceKey();
  const [draft, setDraft] = React.useState<ParticlesConfig>({ ...DEFAULT_PARTICLES });
  const [savedTick, setSavedTick] = React.useState(0);

  React.useEffect(() => {
    if (settings.data) setDraft(parseParticlesConfig(settings.data["particles"]));
  }, [settings.data]);

  const patch = (p: Partial<ParticlesConfig>): void =>
    setDraft((d) => ({ ...d, ...p }));

  const handleSave = (): void => {
    writer.mutate(
      { key: "particles", value: JSON.stringify(draft) },
      { onSuccess: () => setSavedTick((n) => n + 1) },
    );
  };

  return (
    <section className="panel" aria-label={t("appearance.particlesTitle")}>
      <div className="panel-head">
        <h2>{t("appearance.particlesTitle")}</h2>
        <span className="panel-hint">{t("appearance.particlesHint")}</span>
      </div>

      {settings.isLoading && <div className="empty">{t("common.loading")}</div>}
      {settings.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => settings.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {settings.data && (
        <div className="two-col">
          <div>
            <div className="field">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => patch({ enabled: e.target.checked })}
                />
                {t("appearance.particlesEnable")}
              </label>
            </div>
            <SliderRow
              id="pt-count"
              label={t("appearance.particlesCount")}
              min={0}
              max={300}
              step={10}
              value={draft.count}
              display={String(Math.round(draft.count))}
              onChange={(v) => patch({ count: v })}
            />
            <SliderRow
              id="pt-speed"
              label={t("appearance.particlesSpeed")}
              min={0.2}
              max={2.5}
              step={0.1}
              value={draft.speed}
              display={`${draft.speed.toFixed(1)}×`}
              onChange={(v) => patch({ speed: v })}
            />
            <SliderRow
              id="pt-parallax"
              label={t("appearance.particlesParallax")}
              min={0}
              max={0.15}
              step={0.005}
              value={draft.parallax}
              display={draft.parallax.toFixed(3)}
              onChange={(v) => patch({ parallax: v })}
            />
            <div className="field">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.lines}
                  onChange={(e) => patch({ lines: e.target.checked })}
                />
                {t("appearance.particlesLines")}
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
              <button
                type="button"
                className="btn-gold"
                onClick={handleSave}
                disabled={writer.isPending}
              >
                {writer.isPending ? t("appearance.saving") : t("appearance.save")}
              </button>
              {savedTick > 0 && !writer.isError && (
                <Badge tone="success">{t("appearance.particlesSaved")}</Badge>
              )}
              {writer.isError && (
                <span className="form-error" style={{ marginBottom: 0 }}>
                  {errText(writer.error)}
                </span>
              )}
            </div>
          </div>

          <div>
            <p className="hint" style={{ marginTop: 0 }}>{t("appearance.particlesPreview")}</p>
            <div className="particles-preview" key={savedTick}>
              <ParticleField config={{ ...draft, enabled: true }} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2. home sections                                                     */
/* ------------------------------------------------------------------ */

function SectionsPanel(): React.ReactElement {
  const { t, locale } = useI18n();
  const settings = useAppearanceSettingsQuery();
  const writer = useWriteAppearanceKey();
  const [slots, setSlots] = React.useState<HomeSectionSlot[]>([]);
  const [newId, setNewId] = React.useState("");
  const [savedTick, setSavedTick] = React.useState(0);

  React.useEffect(() => {
    if (settings.data) setSlots(parseHomeSections(settings.data["home.sections"]));
  }, [settings.data]);

  const move = (i: number, dir: -1 | 1): void => {
    setSlots((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const patchSlot = (i: number, p: Partial<HomeSectionSlot>): void =>
    setSlots((prev) => prev.map((s, k) => (k === i ? { ...s, ...p } : s)));

  const addSlot = (): void => {
    const id = newId.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!id || slots.some((s) => s.id === id)) return;
    setSlots((prev) => [...prev, { id, variant: "slider-classic", enabled: true }]);
    setNewId("");
  };

  const handleSave = (): void => {
    writer.mutate(
      { key: "home.sections", value: JSON.stringify(slots) },
      { onSuccess: () => setSavedTick((n) => n + 1) },
    );
  };

  return (
    <section className="panel" aria-label={t("appearance.sectionsTitle")}>
      <div className="panel-head">
        <h2>{t("appearance.sectionsTitle")}</h2>
        <span className="panel-hint">{t("appearance.sectionsHint")}</span>
      </div>

      {settings.isLoading && <div className="empty">{t("common.loading")}</div>}
      {settings.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => settings.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {settings.data && (
        <>
          <ol className="slot-list">
            {slots.map((slot, i) => (
              <li key={slot.id} className={`slot-row${slot.enabled ? "" : " off"}`}>
                <span className="slot-pos" dir="ltr">{i + 1}</span>
                <div className="slot-main">
                  <code className="slot-id" dir="ltr">{slot.id}</code>
                  <div className="slot-controls">
                    <label className="slot-field">
                      <span>{t("appearance.variantLabel")}</span>
                      <select
                        className="input"
                        value={slot.variant}
                        onChange={(e) => patchSlot(i, { variant: e.target.value })}
                        aria-label={`${t("appearance.variantLabel")} — ${slot.id}`}
                        title={
                          SECTION_VARIANTS.find((v) => v.id === slot.variant)?.description
                        }
                      >
                        {SECTION_VARIANTS.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label[locale] ?? v.id}
                          </option>
                        ))}
                        {!SECTION_VARIANTS.some((v) => v.id === slot.variant) && (
                          <option value={slot.variant}>{slot.variant}</option>
                        )}
                      </select>
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={slot.enabled}
                        onChange={(e) => patchSlot(i, { enabled: e.target.checked })}
                      />
                      {t("appearance.slotEnabled")}
                    </label>
                  </div>
                </div>
                <VariantPreview variant={slot.variant} />
                <div className="slot-actions">
                  <button
                    type="button"
                    className="icon-mini"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={t("appearance.moveUp")}
                    title={t("appearance.moveUp")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-mini"
                    onClick={() => move(i, 1)}
                    disabled={i === slots.length - 1}
                    aria-label={t("appearance.moveDown")}
                    title={t("appearance.moveDown")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-mini danger"
                    onClick={() => setSlots((prev) => prev.filter((_, k) => k !== i))}
                    aria-label={t("appearance.removeSlot")}
                    title={t("appearance.removeSlot")}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <div className="add-slot">
            <input
              className="input"
              dir="ltr"
              placeholder={t("appearance.slotId")}
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addSlot();
              }}
            />
            <Button size="sm" variant="secondary" onClick={addSlot}>
              {t("appearance.addSlot")}
            </Button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" }}>
            <button
              type="button"
              className="btn-gold"
              onClick={handleSave}
              disabled={writer.isPending}
            >
              {writer.isPending ? t("appearance.saving") : t("appearance.save")}
            </button>
            {savedTick > 0 && !writer.isError && <Badge tone="success">{t("appearance.saved")}</Badge>}
            {writer.isError && (
              <span className="form-error" style={{ marginBottom: 0 }}>
                {errText(writer.error)}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. hero                                                              */
/* ------------------------------------------------------------------ */

function CtaFields({
  prefix,
  title,
  cta,
  onChange,
}: {
  prefix: string;
  title: string;
  cta: HeroCta;
  onChange: (c: HeroCta) => void;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <fieldset className="cta-fieldset">
      <legend>{title}</legend>
      <div className="field">
        <label htmlFor={`${prefix}-label`}>{t("appearance.ctaLabel")}</label>
        <input
          id={`${prefix}-label`}
          className="input"
          value={cta.label}
          onChange={(e) => onChange({ ...cta, label: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-href`}>{t("appearance.ctaHref")}</label>
        <input
          id={`${prefix}-href`}
          className="input"
          dir="ltr"
          value={cta.href}
          onChange={(e) => onChange({ ...cta, href: e.target.value })}
        />
      </div>
    </fieldset>
  );
}

function HeroPanel(): React.ReactElement {
  const { t } = useI18n();
  const settings = useAppearanceSettingsQuery();
  const writer = useWriteAppearanceKey();
  const [tab, setTab] = React.useState<Locale>("fa");
  const [heroes, setHeroes] = React.useState<Record<Locale, HeroLocale>>({
    fa: { ...EMPTY_HERO },
    ar: { ...EMPTY_HERO },
    en: { ...EMPTY_HERO },
  });
  const [savedTick, setSavedTick] = React.useState(0);

  React.useEffect(() => {
    if (settings.data) {
      setHeroes({
        fa: parseHeroLocale(settings.data["hero.fa"]),
        ar: parseHeroLocale(settings.data["hero.ar"]),
        en: parseHeroLocale(settings.data["hero.en"]),
      });
    }
  }, [settings.data]);

  const patch = (p: Partial<HeroLocale>): void =>
    setHeroes((prev) => ({ ...prev, [tab]: { ...prev[tab], ...p } }));

  const hero = heroes[tab];

  const handleSave = (): void => {
    writer.mutate(
      { key: `hero.${tab}`, value: JSON.stringify(hero) },
      { onSuccess: () => setSavedTick((n) => n + 1) },
    );
  };

  return (
    <section className="panel" aria-label={t("appearance.heroTitle")}>
      <div className="panel-head">
        <h2>{t("appearance.heroTitle")}</h2>
        <span className="panel-hint">{t("appearance.heroHint")}</span>
      </div>

      <div className="locale-tabs" role="tablist" aria-label={t("studio.locale")}>
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={tab === l}
            className={`locale-tab${tab === l ? " on" : ""}`}
            onClick={() => setTab(l)}
          >
            {t(`studio.locale_${l}`)}
          </button>
        ))}
      </div>

      {settings.isLoading && <div className="empty">{t("common.loading")}</div>}
      {settings.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => settings.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {settings.data && (
        <div key={tab}>
          <div className="field">
            <label htmlFor="hero-title">{t("studio.title")}</label>
            <input
              id="hero-title"
              className="input"
              dir={tab === "en" ? "ltr" : "rtl"}
              value={hero.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="hero-sub">{t("appearance.heroSubtitleLabel")}</label>
            <textarea
              id="hero-sub"
              className="input"
              rows={2}
              dir={tab === "en" ? "ltr" : "rtl"}
              value={hero.subtitle}
              onChange={(e) => patch({ subtitle: e.target.value })}
            />
          </div>
          <div className="two-col">
            <CtaFields
              prefix="hero-cta1"
              title={t("appearance.primaryCta")}
              cta={hero.primary_cta}
              onChange={(c) => patch({ primary_cta: c })}
            />
            <CtaFields
              prefix="hero-cta2"
              title={t("appearance.secondaryCta")}
              cta={hero.secondary_cta}
              onChange={(c) => patch({ secondary_cta: c })}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" }}>
            <button
              type="button"
              className="btn-gold"
              onClick={handleSave}
              disabled={writer.isPending}
            >
              {writer.isPending ? t("appearance.saving") : t("appearance.save")}
            </button>
            {savedTick > 0 && !writer.isError && <Badge tone="success">{t("appearance.saved")}</Badge>}
            {writer.isError && (
              <span className="form-error" style={{ marginBottom: 0 }}>
                {errText(writer.error)}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

export default function Appearance(): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="page" style={{ maxWidth: "1100px" }}>
      <h1 style={{ marginTop: 0 }}>{t("appearance.title")}</h1>
      <ParticlesPanel />
      <SectionsPanel />
      <HeroPanel />
    </div>
  );
}
