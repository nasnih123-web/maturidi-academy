import React from "react";
import { Badge, Button } from "@maturidi/ui-web";
import { EMPTY_L10N, LocalizedText } from "../lib/contentApi";
import { useI18n } from "../lib/i18n";
import LocalizedInput from "../components/LocalizedInput";
import { ArticleEditor } from "../components/ArticleEditor";
import {
  Article,
  ArticleBody,
  ArticleCategory,
  ArticleCategoryBody,
  errText,
  useArticleCategories,
  useArticles,
  useCreateArticle,
  useCreateArticleCategory,
  useDeleteArticleCategory,
  useSetArticleStatus,
  useUpdateArticle,
  useUpdateArticleCategory,
} from "../lib/articles";

/**
 * Articles management center — WordPress-style catalog (CRM track).
 *
 * Five tabs from day one (mirrors the fatwa tabs, plus archived):
 *   register · categories · review · published · archived.
 * Contract §9 shared workflow: draft → in_review → approved →
 * published → archived; archived restores only to draft.
 */

type ArticleTab = "register" | "categories" | "review" | "published" | "archived";

const TABS: ArticleTab[] = ["register", "categories", "review", "published", "archived"];

const TAB_KEY: Record<ArticleTab, string> = {
  register: "articles.tabRegister",
  categories: "articles.tabCategories",
  review: "articles.tabReview",
  published: "articles.tabPublished",
  archived: "articles.tabArchived",
};

function catName(
  cat: { title: LocalizedText } | null | undefined,
  locale: string,
): string {
  if (!cat) return "";
  const l10n = cat.title as LocalizedText & Record<string, string>;
  return l10n[locale] || cat.title.fa || cat.title.en || "—";
}

function articleName(article: Article, locale: string): string {
  const l10n = article.title as LocalizedText & Record<string, string>;
  return l10n[locale] || article.title.fa || article.title.en || article.slug;
}

/** مرتب‌سازی فهرست‌ها بر اساس دسته، بعد تاریخ (تازه‌ترین اول). */
function sortByCategoryDate(items: Article[], locale: string): Article[] {
  return [...items].sort((a, b) => {
    const ca = catName(a.category, locale);
    const cb = catName(b.category, locale);
    if (ca !== cb) return ca.localeCompare(cb);
    const da = a.published_at || a.created_at;
    const db = b.published_at || b.created_at;
    return db.localeCompare(da);
  });
}

/** نامک خودکار از عنوان: کوچک‌کردن + فاصله→خط‌تیره + حذف «/». */
function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/\//g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

export default function Articles(): React.ReactElement {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<ArticleTab>("register");

  return (
    <div className="page">
      <h1>{t("nav.articles")}</h1>
      <div className="locale-tabs" role="tablist" aria-label={t("nav.articles")}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            className={`locale-tab${tab === tb ? " on" : ""}`}
            onClick={() => setTab(tb)}
          >
            {t(TAB_KEY[tb])}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "register" && <RegisterTab />}
        {tab === "categories" && <CategoriesTab />}
        {tab === "review" && <ReviewTab />}
        {tab === "published" && <PublishedTab />}
        {tab === "archived" && <ArchivedTab />}
      </div>
    </div>
  );
}

function editorLabels(t: (k: string) => string) {
  return {
    bold: t("articles.editorBold"),
    italic: t("articles.editorItalic"),
    underline: t("articles.editorUnderline"),
    strike: t("articles.editorStrike"),
    paragraph: t("articles.editorParagraph"),
    heading2: t("articles.editorHeading2"),
    heading3: t("articles.editorHeading3"),
    heading4: t("articles.editorHeading4"),
    format: t("articles.editorFormat"),
    alignLeft: t("articles.editorAlignLeft"),
    alignCenter: t("articles.editorAlignCenter"),
    alignRight: t("articles.editorAlignRight"),
    alignJustify: t("articles.editorAlignJustify"),
    bulletList: t("articles.editorBulletList"),
    orderedList: t("articles.editorOrderedList"),
    quote: t("articles.editorQuote"),
    codeBlock: t("articles.editorCodeBlock"),
    horizontalRule: t("articles.editorHorizontalRule"),
    undo: t("articles.editorUndo"),
    redo: t("articles.editorRedo"),
    linkUrl: t("articles.editorLinkUrl"),
    applyLink: t("articles.editorApplyLink"),
    removeLink: t("articles.editorRemoveLink"),
    imageUrl: t("articles.editorImageUrl"),
    insertImage: t("articles.editorInsertImage"),
    videoUrl: t("articles.editorVideoUrl"),
    insertVideo: t("articles.editorInsertVideo"),
    badImageUrl: t("articles.editorBadImageUrl"),
    badVideoUrl: t("articles.editorBadVideoUrl"),
    dropLocalBlocked: t("articles.editorDropLocalBlocked"),
  };
}

function RegisterTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const categories = useArticleCategories();
  const drafts = useArticles({ status: "draft" });
  const setStatus = useSetArticleStatus();
  const createArticle = useCreateArticle();

  const [step, setStep] = React.useState(1);
  const [title, setTitle] = React.useState<LocalizedText>({ ...EMPTY_L10N });
  const [body, setBody] = React.useState<Record<string, unknown>>({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
  const [categoryId, setCategoryId] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [imageUrl, setImageUrl] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [seoTitle, setSeoTitle] = React.useState("");
  const [seoDescription, setSeoDescription] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const [savedCount, setSavedCount] = React.useState(0);
  const [submitErr, setSubmitErr] = React.useState<unknown>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const sortedDrafts = drafts.data ? sortByCategoryDate(drafts.data, locale) : [];
  const editing = drafts.data?.find((x) => x.id === editingId) ?? null;
  const dir = locale === "en" ? "ltr" : "rtl";

  function onTitleChange(v: LocalizedText): void {
    setTitle(v);
    if (!slugTouched) {
      setSlug(slugify(v.fa || v.en || v.ar || ""));
    }
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setSubmitErr(null);
    setSaved(false);
    try {
      const finalSlug = slug.trim();
      if (!finalSlug) throw new Error("slug empty");
      await createArticle.mutateAsync({
        title,
        body,
        slug: finalSlug,
        seo_title: seoTitle.trim() || null,
        seo_description: seoDescription.trim() || null,
        category_id: categoryId || null,
        author_name: author.trim() || null,
        featured_image_url: imageUrl.trim() || null,
      });
      setSaved(true);
      setSavedCount((n) => n + 1);
      setStep(1);
      setTitle({ ...EMPTY_L10N });
      setBody({ type: "doc", content: [{ type: "paragraph" }] });
      setCategoryId("");
      setAuthor("");
      setImageUrl("");
      setSlug("");
      setSlugTouched(false);
      setSeoTitle("");
      setSeoDescription("");
    } catch (err) {
      setSubmitErr(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="panel" aria-label={t("articles.registerTitle")}>
        <div className="panel-head">
          <h2>{t("articles.registerTitle")}</h2>
          <span className="panel-hint">
            {step === 1
              ? t("articles.stepContent")
              : step === 2
                ? t("articles.stepCategory")
                : step === 3
                  ? t("articles.stepAuthor")
                  : step === 4
                    ? t("articles.stepFeaturedImage")
                    : t("articles.stepSeo")}{" "}
            · {step} / 5
          </span>
        </div>
        {saved && <Badge tone="success">{t("articles.articleRegistered")}</Badge>}
        {step === 1 && (
          <div>
            <LocalizedInput id="art-title" label={t("articles.fieldTitle")} value={title} onChange={onTitleChange} />
            <div className="field">
              <label>{t("articles.fieldBody")}</label>
              <ArticleEditor
                key={`register-${savedCount}`}
                initialContent={body}
                onChange={setBody}
                dir={dir}
                labels={editorLabels(t)}
              />
            </div>
          </div>
        )}
        {step === 2 && (
          <div>
            <div className="field">
              <label htmlFor="art-cat">{t("articles.selectCategory")}</label>
              <select
                id="art-cat"
                className="input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{t("articles.selectCategory")}</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {catName(c, locale) || c.slug}
                  </option>
                ))}
              </select>
            </div>
            {categories.data && categories.data.length === 0 && (
              <p className="hint">{t("articles.noCategoriesHint")}</p>
            )}
          </div>
        )}
        {step === 3 && (
          <div>
            <div className="field">
              <label htmlFor="art-author">{t("articles.stepAuthor")}</label>
              <input
                id="art-author"
                className="input"
                value={author}
                placeholder={t("articles.authorPlaceholder")}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
          </div>
        )}
        {step === 4 && (
          <div>
            <div className="field">
              <label htmlFor="art-img">{t("articles.imageUrlLabel")}</label>
              <input
                id="art-img"
                className="input"
                dir="ltr"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
              <p className="hint">{t("articles.imageUrlHint")}</p>
            </div>
            {imageUrl.startsWith("http") ? (
              <div className="field">
                <span>{t("articles.imagePreview")}</span>
                <img src={imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: "12rem", display: "block", marginTop: "0.5rem" }} />
              </div>
            ) : null}
          </div>
        )}
        {step === 5 && (
          <div>
            <div className="field">
              <label htmlFor="art-slug">{t("articles.slugLabel")}</label>
              <input
                id="art-slug"
                className="input"
                dir="ltr"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
              />
              <p className="hint">{t("articles.slugHint")}</p>
            </div>
            <div className="field">
              <label htmlFor="art-seo-title">{t("articles.seoTitleLabel")}</label>
              <input
                id="art-seo-title"
                className="input"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="art-seo-desc">{t("articles.seoDescriptionLabel")}</label>
              <textarea
                id="art-seo-desc"
                className="input"
                rows={3}
                dir="auto"
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
              />
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.75rem" }}>
          {step > 1 && (
            <Button size="sm" variant="secondary" onClick={() => setStep(step - 1)}>
              {t("articles.stepPrev")}
            </Button>
          )}
          {step < 5 && (
            <Button size="sm" onClick={() => setStep(step + 1)}>
              {t("articles.stepNext")}
            </Button>
          )}
          {step === 5 && (
            <Button size="sm" disabled={submitting || !slug.trim()} onClick={submit}>
              {submitting ? t("common.loading") : t("articles.submitArticle")}
            </Button>
          )}
          {submitErr !== null && (
            <span className="form-error" style={{ marginBottom: 0 }}>
              {errText(submitErr)}
            </span>
          )}
        </div>
      </section>

      <section className="panel" aria-label={t("articles.registeredTitle")}>
        <div className="panel-head">
          <h2>{t("articles.registeredTitle")}</h2>
          <span className="panel-hint">{t("articles.sortByCategoryDate")}</span>
        </div>
        {drafts.isLoading && <div className="empty">{t("common.loading")}</div>}
        {drafts.isError && (
          <div className="empty">
            <p>{t("common.error")}</p>
            <Button size="sm" variant="secondary" onClick={() => drafts.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {drafts.data && sortedDrafts.length === 0 && (
          <div className="empty">{t("articles.emptyArticles")}</div>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {sortedDrafts.map((a) => (
            <li
              key={a.id}
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                flexWrap: "wrap",
                padding: "0.4rem 0",
                borderTop: "1px solid var(--x-line)",
              }}
            >
              <span style={{ flex: "1 1 12rem" }}>{articleName(a, locale)}</span>
              <span className="hint" style={{ margin: 0 }}>
                {catName(a.category, locale)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditingId(editingId === a.id ? null : a.id)}
              >
                {t("articles.editArticle")}
              </Button>
              <Button
                size="sm"
                disabled={setStatus.isPending}
                onClick={() =>
                  setStatus.mutate({ id: a.id, status: "in_review" })
                }
              >
                {t("articles.sendToReview")}
              </Button>
            </li>
          ))}
        </ul>
        {editing && (
          <div style={{ marginTop: "1rem", borderTop: "1px solid var(--x-line)", paddingTop: "1rem" }}>
            <ArticleEditForm initial={editing} onDone={() => setEditingId(null)} />
          </div>
        )}
      </section>
    </div>
  );
}

function CategoriesTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const categories = useArticleCategories();
  const create = useCreateArticleCategory();
  const update = useUpdateArticleCategory();
  const remove = useDeleteArticleCategory();
  const [editing, setEditing] = React.useState<ArticleCategory | null | "new">(null);
  const [slug, setSlug] = React.useState("");
  const [title, setTitle] = React.useState<LocalizedText>({ ...EMPTY_L10N });
  const pending = create.isPending || update.isPending || remove.isPending;
  const err = create.isError
    ? create.error
    : update.isError
      ? update.error
      : remove.isError
        ? remove.error
        : null;

  function startEdit(c: ArticleCategory | "new"): void {
    setEditing(c);
    if (c === "new") {
      setSlug("");
      setTitle({ ...EMPTY_L10N });
    } else {
      setSlug(c.slug);
      setTitle({ ...c.title });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="panel" aria-label={t("articles.categoriesTitle")}>
        <div className="panel-head">
          <h2>{t("articles.categoriesTitle")}</h2>
          <Button size="sm" variant="secondary" onClick={() => startEdit("new")}>
            {t("articles.newCategory")}
          </Button>
        </div>
        {categories.isLoading && <div className="empty">{t("common.loading")}</div>}
        {categories.isError && (
          <div className="empty">
            <p>{t("common.error")}</p>
            <Button size="sm" variant="secondary" onClick={() => categories.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {categories.data && categories.data.length === 0 && (
          <div className="empty">{t("articles.emptyCategories")}</div>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {categories.data?.map((c) => (
            <li
              key={c.id}
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                flexWrap: "wrap",
                padding: "0.4rem 0",
                borderTop: "1px solid var(--x-line)",
              }}
            >
              <span style={{ flex: "1 1 12rem" }}>{catName(c, locale) || c.slug}</span>
              <span className="hint" style={{ margin: 0 }} dir="ltr">
                {c.slug}
              </span>
              <Button size="sm" variant="secondary" onClick={() => startEdit(c)}>
                {t("articles.editCategory")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => remove.mutate(c.id)}
              >
                {t("articles.deleteCategory")}
              </Button>
            </li>
          ))}
        </ul>
        {err && (
          <p className="form-error" style={{ marginTop: "0.75rem" }}>
            {errText(err)}
          </p>
        )}
      </section>
      {editing && (
        <section className="panel">
          <div className="field">
            <label htmlFor="art-cat-slug">{t("articles.fieldSlug")}</label>
            <input
              id="art-cat-slug"
              className="input"
              dir="ltr"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <LocalizedInput
            id="art-cat-title"
            label={t("articles.fieldCategoryTitle")}
            value={title}
            onChange={setTitle}
          />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <Button
              size="sm"
              disabled={pending || !slug.trim()}
              onClick={() => {
                const body: ArticleCategoryBody = { slug: slug.trim(), title };
                if (editing === "new") {
                  create.mutate(body, { onSuccess: () => setEditing(null) });
                } else {
                  update.mutate({ id: editing.id, body }, { onSuccess: () => setEditing(null) });
                }
              }}
            >
              {pending ? t("common.loading") : t("articles.saveCategory")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
              {t("articles.cancel")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function ReviewTab(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const queue = useArticles({ status: "in_review" });
  const setStatus = useSetArticleStatus();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [actionErr, setActionErr] = React.useState<unknown>(null);
  const [approvingId, setApprovingId] = React.useState<string | null>(null);
  const editing = queue.data?.find((x) => x.id === editingId) ?? null;

  async function approve(id: string): Promise<void> {
    // تأیید از بررسی یعنی دو PATCH پیاپی: approved سپس published.
    setActionErr(null);
    setApprovingId(id);
    try {
      await setStatus.mutateAsync({ id, status: "approved" });
      await setStatus.mutateAsync({ id, status: "published" });
    } catch (err) {
      setActionErr(err);
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="panel" aria-label={t("articles.reviewTitle")}>
        <div className="panel-head">
          <h2>{t("articles.reviewTitle")}</h2>
        </div>
        {queue.isLoading && <div className="empty">{t("common.loading")}</div>}
        {queue.isError && (
          <div className="empty">
            <p>{t("common.error")}</p>
            <Button size="sm" variant="secondary" onClick={() => queue.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {queue.data && queue.data.length === 0 && (
          <div className="empty">{t("articles.emptyReview")}</div>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {queue.data?.map((a) => (
            <li
              key={a.id}
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                flexWrap: "wrap",
                padding: "0.4rem 0",
                borderTop: "1px solid var(--x-line)",
              }}
            >
              <span style={{ flex: "1 1 12rem" }}>{articleName(a, locale)}</span>
              <span className="hint" style={{ margin: 0 }}>
                {catName(a.category, locale)}
              </span>
              <span className="hint" style={{ margin: 0 }}>
                {a.author_name ?? ""}
              </span>
              <span className="hint" style={{ margin: 0 }}>
                {a.created_at ? formatDate(a.created_at) : ""}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditingId(editingId === a.id ? null : a.id)}
              >
                {t("articles.editArticle")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: a.id, status: "rejected" })}
              >
                {t("articles.rejectArticle")}
              </Button>
              <Button
                size="sm"
                disabled={approvingId === a.id}
                onClick={() => approve(a.id)}
              >
                {approvingId === a.id ? t("common.loading") : t("articles.approveArticle")}
              </Button>
            </li>
          ))}
        </ul>
        {actionErr !== null && (
          <p className="form-error" style={{ marginTop: "0.75rem" }}>
            {errText(actionErr)}
          </p>
        )}
      </section>
      {editing && (
        <section className="panel">
          <ArticleEditForm initial={editing} onDone={() => setEditingId(null)} />
        </section>
      )}
    </div>
  );
}

function PublishedTab(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const published = useArticles({ status: "published" });
  const setStatus = useSetArticleStatus();
  const sorted = published.data ? sortByCategoryDate(published.data, locale) : [];

  return (
    <section className="panel" aria-label={t("articles.publishedTitle")}>
      <div className="panel-head">
        <h2>{t("articles.publishedTitle")}</h2>
        <span className="panel-hint">{t("articles.sortByCategoryDate")}</span>
      </div>
      {published.isLoading && <div className="empty">{t("common.loading")}</div>}
      {published.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => published.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {published.data && sorted.length === 0 && (
        <div className="empty">{t("articles.emptyPublished")}</div>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {sorted.map((a) => (
          <li
            key={a.id}
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              flexWrap: "wrap",
              padding: "0.4rem 0",
              borderTop: "1px solid var(--x-line)",
            }}
          >
            <span style={{ flex: "1 1 12rem" }}>{articleName(a, locale)}</span>
            <span className="hint" style={{ margin: 0 }}>
              {catName(a.category, locale)}
            </span>
            <span className="hint" style={{ margin: 0 }}>
              {a.published_at ? formatDate(a.published_at) : ""}
            </span>
            <span className="hint" style={{ margin: 0 }}>
              {a.view_count} {t("articles.viewsLabel")}
            </span>
            <span className="hint" style={{ margin: 0 }}>
              {a.share_count} {t("articles.sharesLabel")}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: a.id, status: "archived" })}
            >
              {t("articles.archiveArticle")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArchivedTab(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const archived = useArticles({ status: "archived" });
  const setStatus = useSetArticleStatus();
  const sorted = archived.data ? sortByCategoryDate(archived.data, locale) : [];

  return (
    <section className="panel" aria-label={t("articles.archivedTitle")}>
      <div className="panel-head">
        <h2>{t("articles.archivedTitle")}</h2>
        <span className="panel-hint">{t("articles.sortByCategoryDate")}</span>
      </div>
      {archived.isLoading && <div className="empty">{t("common.loading")}</div>}
      {archived.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => archived.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {archived.data && sorted.length === 0 && (
        <div className="empty">{t("articles.emptyArchived")}</div>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {sorted.map((a) => (
          <li
            key={a.id}
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              flexWrap: "wrap",
              padding: "0.4rem 0",
              borderTop: "1px solid var(--x-line)",
            }}
          >
            <span style={{ flex: "1 1 12rem" }}>{articleName(a, locale)}</span>
            <span className="hint" style={{ margin: 0 }}>
              {catName(a.category, locale)}
            </span>
            <span className="hint" style={{ margin: 0 }}>
              {a.published_at ? formatDate(a.published_at) : ""}
            </span>
            <span className="hint" style={{ margin: 0 }}>
              {a.view_count} {t("articles.viewsLabel")}
            </span>
            <span className="hint" style={{ margin: 0 }}>
              {a.share_count} {t("articles.sharesLabel")}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: a.id, status: "draft" })}
            >
              {t("articles.restoreArticle")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** فرم ویرایش فشردهٔ مقاله — همان فیلدهایی که PUT می‌پذیرد. */
function ArticleEditForm({
  initial,
  onDone,
}: {
  initial: Article;
  onDone: () => void;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const categories = useArticleCategories();
  const [title, setTitle] = React.useState<LocalizedText>({ ...initial.title });
  const [body, setBody] = React.useState<Record<string, unknown>>({ ...initial.body });
  const [categoryId, setCategoryId] = React.useState<string>(initial.category_id ?? "");
  const [author, setAuthor] = React.useState<string>(initial.author_name ?? "");
  const [imageUrl, setImageUrl] = React.useState<string>(initial.featured_image_url ?? "");
  const [slug, setSlug] = React.useState<string>(initial.slug);
  const [seoTitle, setSeoTitle] = React.useState<string>(initial.seo_title ?? "");
  const [seoDescription, setSeoDescription] = React.useState<string>(initial.seo_description ?? "");
  const update = useUpdateArticle();
  const pending = update.isPending;
  const err = update.isError ? update.error : null;
  const dir = locale === "en" ? "ltr" : "rtl";

  return (
    <div>
      <LocalizedInput id="edit-art-title" label={t("articles.fieldTitle")} value={title} onChange={setTitle} />
      <div className="field">
        <label>{t("articles.fieldBody")}</label>
        <ArticleEditor
          key={`edit-${initial.id}`}
          initialContent={body}
          onChange={setBody}
          dir={dir}
          labels={editorLabels(t)}
        />
      </div>
      <div className="field">
        <label htmlFor="edit-art-cat">{t("articles.selectCategory")}</label>
        <select
          id="edit-art-cat"
          className="input"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">{t("articles.selectCategory")}</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {catName(c, "fa") || c.slug}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="edit-art-author">{t("articles.stepAuthor")}</label>
        <input
          id="edit-art-author"
          className="input"
          value={author}
          placeholder={t("articles.authorPlaceholder")}
          onChange={(e) => setAuthor(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="edit-art-img">{t("articles.imageUrlLabel")}</label>
        <input
          id="edit-art-img"
          className="input"
          dir="ltr"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <p className="hint">{t("articles.imageUrlHint")}</p>
        {imageUrl.startsWith("http") ? (
          <img src={imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: "12rem", marginTop: "0.5rem" }} />
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="edit-art-slug">{t("articles.slugLabel")}</label>
        <input
          id="edit-art-slug"
          className="input"
          dir="ltr"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="edit-art-seo-title">{t("articles.seoTitleLabel")}</label>
        <input
          id="edit-art-seo-title"
          className="input"
          value={seoTitle}
          onChange={(e) => setSeoTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="edit-art-seo-desc">{t("articles.seoDescriptionLabel")}</label>
        <textarea
          id="edit-art-seo-desc"
          className="input"
          rows={3}
          dir="auto"
          value={seoDescription}
          onChange={(e) => setSeoDescription(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <Button
          size="sm"
          disabled={pending || !slug.trim()}
          onClick={() => {
            const payload: ArticleBody = {
              title,
              body,
              slug: slug.trim(),
              seo_title: seoTitle.trim() || null,
              seo_description: seoDescription.trim() || null,
              category_id: categoryId || null,
              author_name: author.trim() || null,
              featured_image_url: imageUrl.trim() || null,
            };
            update.mutate({ id: initial.id, body: payload }, { onSuccess: onDone });
          }}
        >
          {pending ? t("common.loading") : t("articles.saveArticle")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t("articles.cancel")}
        </Button>
        {err && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {errText(err)}
          </span>
        )}
      </div>
    </div>
  );
}
