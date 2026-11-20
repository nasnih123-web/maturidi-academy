'use client';

/**
 * DateOfBirthField — calendar-aware date-of-birth picker.
 *
 * The calendar is chosen automatically from the user's country and
 * language: Iran/Afghanistan or a Persian UI get the Jalali (Solar
 * Hijri) calendar, everyone else gets Gregorian. The user can switch
 * manually at any time. The value exchanged with the parent (and the
 * API) is always a Gregorian ISO date (YYYY-MM-DD); only the display
 * and entry calendar changes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fromJalali, jalaliMonthLength, toISODate, toJalali } from '@/lib/jalali';

export interface DobLabels {
  title: string;
  jalali: string;
  gregorian: string;
  autoJalali: string;
  autoGregorian: string;
  day: string;
  month: string;
  year: string;
  equivalentGregorian: string;
  equivalentJalali: string;
}

type Cal = 'jalali' | 'gregorian';

const JALALI_MONTHS: Record<string, string[]> = {
  fa: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
  ar: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
  en: ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'],
};

const GREG_MONTHS: Record<string, string[]> = {
  fa: ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

function autoCalendar(locale: string, countryCode: string): Cal {
  if (countryCode === 'IR' || countryCode === 'AF') return 'jalali';
  if (locale === 'fa') return 'jalali';
  return 'gregorian';
}

function parseISO(iso: string): { gy: number; gm: number; gd: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? { gy: Number(m[1]), gm: Number(m[2]), gd: Number(m[3]) } : null;
}

function monthLength(cal: Cal, y: number, m: number): number {
  if (cal === 'jalali') return jalaliMonthLength(y, m);
  return new Date(y, m, 0).getDate();
}

interface Parts {
  y: number | null;
  m: number | null;
  d: number | null;
}

interface DateOfBirthFieldProps {
  value: string;
  onChange: (iso: string) => void;
  locale: string;
  countryCode: string;
  labels: DobLabels;
}

export default function DateOfBirthField({ value, onChange, locale, countryCode, labels }: DateOfBirthFieldProps) {
  const auto = autoCalendar(locale, countryCode);
  const [override, setOverride] = useState<Cal | null>(null);
  const cal: Cal = override ?? auto;
  const [parts, setParts] = useState<Parts>({ y: null, m: null, d: null });
  const syncKey = useRef('');

  const nf = useMemo(
    () =>
      new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar-EG' : 'en-US', {
        useGrouping: false,
      }),
    [locale],
  );
  const num = (n: number) => nf.format(n);

  // Keep the three selects in sync with the ISO value (initial load,
  // external changes) and re-derive them when the calendar flips.
  useEffect(() => {
    const key = `${value}|${cal}`;
    if (syncKey.current === key) return;
    syncKey.current = key;
    const p = parseISO(value);
    if (!p) {
      setParts({ y: null, m: null, d: null });
      return;
    }
    if (cal === 'jalali') {
      const j = toJalali(new Date(p.gy, p.gm - 1, p.gd));
      setParts({ y: j.y, m: j.m, d: j.d });
    } else {
      setParts({ y: p.gy, m: p.gm, d: p.gd });
    }
  }, [value, cal]);

  function emit(next: Parts) {
    setParts(next);
    if (next.y && next.m && next.d) {
      const iso =
        cal === 'jalali'
          ? toISODate(fromJalali(next.y, next.m, next.d))
          : `${next.y}-${String(next.m).padStart(2, '0')}-${String(next.d).padStart(2, '0')}`;
      syncKey.current = `${iso}|${cal}`;
      onChange(iso);
    }
  }

  function pick(field: keyof Parts, v: number | null) {
    const next: Parts = { ...parts, [field]: v };
    if (next.y && next.m && next.d) {
      const max = monthLength(cal, next.y, next.m);
      if (next.d > max) next.d = max;
    }
    emit(next);
  }

  function switchCal(next: Cal) {
    setOverride(next === auto ? null : next);
  }

  const now = new Date();
  const currentYear = cal === 'jalali' ? toJalali(now).y : now.getFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= currentYear - 120; y--) years.push(y);
  const maxDay = parts.y && parts.m ? monthLength(cal, parts.y, parts.m) : 31;
  const days: number[] = [];
  for (let d = 1; d <= maxDay; d++) days.push(d);
  const monthNames = (cal === 'jalali' ? JALALI_MONTHS : GREG_MONTHS)[locale] ?? (cal === 'jalali' ? JALALI_MONTHS.en : GREG_MONTHS.en);

  const parsed = parseISO(value);
  let equivalent: string | null = null;
  if (parsed) {
    if (cal === 'jalali') {
      const names = GREG_MONTHS[locale] ?? GREG_MONTHS.en;
      equivalent = labels.equivalentGregorian.replace(
        '{date}',
        `${num(parsed.gd)} ${names[parsed.gm - 1]} ${num(parsed.gy)}`,
      );
    } else {
      const j = toJalali(new Date(parsed.gy, parsed.gm - 1, parsed.gd));
      const names = JALALI_MONTHS[locale] ?? JALALI_MONTHS.en;
      equivalent = labels.equivalentJalali.replace('{date}', `${num(j.d)} ${names[j.m - 1]} ${num(j.y)}`);
    }
  }

  return (
    <div className="pf3-dob">
      <div className="pf3-dob-head">
        <span className="pf3-dob-title">{labels.title}</span>
        {override === null && (
          <span className="pf3-auto-badge">{cal === 'jalali' ? labels.autoJalali : labels.autoGregorian}</span>
        )}
        <span className="pf3-dob-spacer" />
        <span className="pf3-seg" role="group" aria-label={labels.title}>
          <button type="button" className={cal === 'jalali' ? 'on' : ''} onClick={() => switchCal('jalali')}>
            {labels.jalali}
          </button>
          <button type="button" className={cal === 'gregorian' ? 'on' : ''} onClick={() => switchCal('gregorian')}>
            {labels.gregorian}
          </button>
        </span>
      </div>
      <div className="pf3-dob-row">
        <label className="pf3-dob-col">
          <span>{labels.day}</span>
          <select
            value={parts.d ?? ''}
            onChange={(e) => pick('d', e.target.value ? Number(e.target.value) : null)}
            aria-label={labels.day}
          >
            <option value="">—</option>
            {days.map((d) => (
              <option key={d} value={d}>
                {num(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="pf3-dob-col">
          <span>{labels.month}</span>
          <select
            value={parts.m ?? ''}
            onChange={(e) => pick('m', e.target.value ? Number(e.target.value) : null)}
            aria-label={labels.month}
          >
            <option value="">—</option>
            {monthNames.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="pf3-dob-col">
          <span>{labels.year}</span>
          <select
            value={parts.y ?? ''}
            onChange={(e) => pick('y', e.target.value ? Number(e.target.value) : null)}
            aria-label={labels.year}
          >
            <option value="">—</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {num(y)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {equivalent && <p className="pf3-dob-hint">{equivalent}</p>}
    </div>
  );
}
