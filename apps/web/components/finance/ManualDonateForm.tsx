/**
 * ManualDonateForm — presentational manual-donation form.
 * State/logic live in useManualDonate; this renders and emits events only
 * (ADR-001, same split as DonateForm). Payment details arrive from the
 * server (CRM-configured) — never hard-coded here.
 */
'use client';

import { useState } from 'react';
import type { ManualMethod } from '@/lib/hooks/useManualDonate';
import type { LocalizedText } from '@/lib/finance-client';

export interface ManualDonateLabels {
  title: string;
  intro: string;
  amountLabel: string;
  tomanSuffix: string;
  usdSuffix: string;
  donorNameLabel: string;
  donorNameOptional: string;
  donorNamePlaceholder: string;
  proofTextLabel: string;
  proofTextPlaceholder: string;
  receiptLabel: string;
  submit: string;
  submitting: string;
  successTitle: string;
  successBody: string;
  copy: string;
  copied: string;
  cardNumberLabel: string;
  cardHolderLabel: string;
  walletLabel: string;
  paypalAccountLabel: string;
  errorGeneric: string;
}

function pickLocalized(text: LocalizedText | null, locale: string): string {
  if (!text) return '';
  if (locale === 'ar') return text.ar || text.fa || text.en;
  if (locale === 'en') return text.en || text.fa;
  return text.fa || text.en;
}

function CopyValue({ value, labels }: { value: string; labels: ManualDonateLabels }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="fin-copyrow">
      <code className="fin-copyvalue" dir="ltr">
        {value}
      </code>
      <button
        type="button"
        className="fin-copybtn"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? labels.copied : labels.copy}
      </button>
    </span>
  );
}

export interface ManualDonateFormProps {
  methods: ManualMethod[];
  method: ManualMethod | null;
  phase: string;
  error: string | null;
  amount: string;
  donorName: string;
  proofText: string;
  walletIndex: number;
  amountValid: boolean;
  proofValid: boolean;
  locale: string;
  labels: ManualDonateLabels;
  onSelect: (method: string) => void;
  onAmount: (raw: string) => void;
  onDonorName: (name: string) => void;
  onProofText: (text: string) => void;
  onWalletIndex: (index: number) => void;
  onFile: (file: File | null) => void;
  onSubmit: () => void;
}

export function ManualDonateForm(props: ManualDonateFormProps) {
  const { methods, method, phase, labels, locale } = props;
  if (methods.length === 0 || !method) return null;
  const busy = phase === 'submitting';

  if (phase === 'done') {
    return (
      <section className="fin-manual" aria-label={labels.title}>
        <h2 className="fin-manual-title">{labels.successTitle}</h2>
        <p className="fin-hint">{labels.successBody}</p>
      </section>
    );
  }

  const currencySuffix =
    method.method === 'card'
      ? labels.tomanSuffix
      : method.method === 'paypal'
        ? labels.usdSuffix
        : (method.wallets[props.walletIndex]?.currency ?? '');

  return (
    <section className="fin-manual" aria-label={labels.title}>
      <h2 className="fin-manual-title">{labels.title}</h2>
      <p className="fin-hint">{labels.intro}</p>

      <div className="fin-presets" role="group" aria-label={labels.title}>
        {methods.map((m) => (
          <button
            key={m.method}
            type="button"
            className={`fin-preset${m.method === method.method ? ' fin-preset-active' : ''}`}
            aria-pressed={m.method === method.method}
            onClick={() => props.onSelect(m.method)}
          >
            {pickLocalized(m.title, locale)}
          </button>
        ))}
      </div>

      <div className="fin-manual-details">
        {method.method === 'card' && method.cardNumber ? (
          <>
            <p className="fin-label">{labels.cardNumberLabel}</p>
            <CopyValue value={method.cardNumber} labels={labels} />
            {method.cardHolder ? (
              <p className="fin-hint">
                {labels.cardHolderLabel}: {method.cardHolder}
              </p>
            ) : null}
          </>
        ) : null}

        {method.method === 'crypto' ? (
          <>
            <label className="fin-label" htmlFor="fin-wallet">
              {labels.walletLabel}
            </label>
            <select
              id="fin-wallet"
              className="fin-input"
              value={props.walletIndex}
              onChange={(e) => props.onWalletIndex(Number(e.target.value))}
              disabled={busy}
            >
              {method.wallets.map((w, i) => (
                <option key={`${w.currency}-${w.network}-${i}`} value={i}>
                  {w.currency}
                  {w.network ? ` · ${w.network}` : ''}
                </option>
              ))}
            </select>
            {method.wallets[props.walletIndex] ? (
              <CopyValue value={method.wallets[props.walletIndex].address} labels={labels} />
            ) : null}
          </>
        ) : null}

        {method.method === 'paypal' && method.paypalAccount ? (
          <>
            <p className="fin-label">{labels.paypalAccountLabel}</p>
            <CopyValue value={method.paypalAccount} labels={labels} />
          </>
        ) : null}

        {method.instructions && pickLocalized(method.instructions, locale) ? (
          <p className="fin-hint">{pickLocalized(method.instructions, locale)}</p>
        ) : null}
      </div>

      <form
        className="fin-form"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
      >
        <fieldset className="fin-fieldset" disabled={busy}>
          <label className="fin-label" htmlFor="fin-manual-amount">
            {labels.amountLabel}
          </label>
          <div className="fin-amount-wrap">
            <input
              id="fin-manual-amount"
              className="fin-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              value={props.amount}
              onChange={(e) => props.onAmount(e.target.value)}
            />
            <span className="fin-currency">{currencySuffix}</span>
          </div>

          <div className="fin-field">
            <label className="fin-label" htmlFor="fin-manual-donor">
              {labels.donorNameLabel}{' '}
              <span className="fin-optional">({labels.donorNameOptional})</span>
            </label>
            <input
              id="fin-manual-donor"
              className="fin-input"
              type="text"
              autoComplete="name"
              maxLength={120}
              placeholder={labels.donorNamePlaceholder}
              value={props.donorName}
              onChange={(e) => props.onDonorName(e.target.value)}
            />
          </div>

          <div className="fin-field">
            <label className="fin-label" htmlFor="fin-proof-text">
              {labels.proofTextLabel}
            </label>
            <input
              id="fin-proof-text"
              className="fin-input"
              type="text"
              autoComplete="off"
              dir="ltr"
              placeholder={labels.proofTextPlaceholder}
              value={props.proofText}
              onChange={(e) => props.onProofText(e.target.value)}
            />
          </div>

          <div className="fin-field">
            <label className="fin-label" htmlFor="fin-proof-file">
              {labels.receiptLabel}
            </label>
            <input
              id="fin-proof-file"
              className="fin-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => props.onFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </fieldset>

        {phase === 'error' ? (
          <p className="fin-error" role="alert">
            {labels.errorGeneric}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn-primary fin-submit"
          disabled={busy || !props.amountValid || !props.proofValid}
        >
          {busy ? labels.submitting : labels.submit}
        </button>
      </form>
    </section>
  );
}
