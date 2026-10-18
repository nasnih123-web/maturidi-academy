"use client";

/**
 * SearchAutocomplete — global search with live suggestions.
 * Accessible combobox: ArrowUp/Down/Home/End, Enter, Escape,
 * role="combobox"/"listbox"/"option", aria-activedescendant, and a polite
 * live region. Suggestions come from the same-origin `/api/search` proxy
 * (→ GET /api/v1/search). Submitting the form (no-JS or Enter on empty
 * query) goes to the search results page. All labels arrive as props.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { LocalizedText, SearchResponse } from "@/lib/types";

export interface SearchAutocompleteLabels {
  label: string;
  placeholder: string;
  searchButton: string;
  loading: string;
  noResults: string;
  searchUnavailable: string;
  /** e.g. "{count} results" — {count} is replaced client-side. */
  resultsSummaryTemplate: string;
  clear: string;
  typeNames: Record<string, string>;
}

interface Option {
  key: string;
  title: string;
  snippet: string;
  type: string;
  href: string | null;
}

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

function formatCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

function pickTitle(title: LocalizedText, locale: string): string {
  for (const lang of [locale, "en", "fa"]) {
    const v = title?.[lang];
    if (typeof v === "string" && v.trim()) return v;
  }
  const first = Object.values(title ?? {}).find((v) => typeof v === "string" && v.trim());
  return typeof first === "string" ? first : "";
}

export function SearchAutocomplete({
  endpoint,
  action,
  locale,
  labels,
}: {
  /** Same-origin suggestions endpoint. */
  endpoint: string;
  /** Form action for full submit (search results page). */
  action: string;
  locale: string;
  labels: SearchAutocompleteLabels;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const listId = useId();
  const statusId = useId();

  const runSearch = useCallback(
    async (q: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const url = `${endpoint}?q=${encodeURIComponent(q)}&limit=8`;
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`search → ${res.status}`);
        const body = (await res.json()) as SearchResponse;
        const opts: Option[] = (body.results ?? []).map((r, i) => ({
          key: `${r.type}:${r.id}:${i}`,
          title: pickTitle(r.title, locale),
          snippet: typeof r.snippet === "string" ? r.snippet : "",
          type: r.type,
          href: typeof r.url === "string" && r.url ? r.url : null,
        }));
        setOptions(opts);
        setActiveIndex(opts.length > 0 ? 0 : -1);
        setOpen(true);
        setStatus(opts.length === 0 ? labels.noResults : formatCount(labels.resultsSummaryTemplate, body.total ?? opts.length));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setOptions([]);
        setOpen(false);
        setStatus(labels.searchUnavailable);
      } finally {
        setLoading(false);
      }
    },
    [endpoint, locale, labels],
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim().length < MIN_CHARS) {
      abortRef.current?.abort();
      setOptions([]);
      setOpen(false);
      setLoading(false);
      setStatus("");
      setActiveIndex(-1);
      return;
    }
    timerRef.current = setTimeout(() => runSearch(query.trim()), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, runSearch]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (formRef.current && !formRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const choose = (opt: Option | undefined) => {
    if (!opt?.href) return;
    window.location.assign(opt.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (options.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => {
        const next = e.key === "ArrowDown" ? prev + 1 : prev - 1;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
    } else if (e.key === "Home" && open && options.length > 0) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End" && open && options.length > 0) {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0) {
        e.preventDefault();
        choose(options[activeIndex]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      } else if (query) {
        e.preventDefault();
        setQuery("");
        inputRef.current?.focus();
      }
    }
  };

  const showList = open && options.length > 0;
  const activeId = activeIndex >= 0 && options[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined;

  return (
    <form ref={formRef} className="mihrab-search" action={action} role="search">
      <span className="mihrab-light" aria-hidden />
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="search"
        name="q"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        placeholder={labels.placeholder}
        value={query}
        aria-label={labels.label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-describedby={statusId}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          if (options.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <button type="submit">{labels.searchButton}</button>
      {showList ? (
        <ul id={listId} role="listbox" aria-label={labels.label} className="mihrab-results">
          {options.map((opt, i) => (
            <li
              key={opt.key}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(opt);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="opt-type">{labels.typeNames[opt.type] ?? opt.type}</span>
              <span className="opt-title">{opt.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!showList && (loading || status) ? (
        <p id={statusId} className="mihrab-status" role="status" aria-live="polite">
          {loading ? labels.loading : status}
        </p>
      ) : null}
      <span id={statusId} className="sr-only" role="status" aria-live="polite">
        {showList ? status : ""}
      </span>
    </form>
  );
}
