'use client';

/**
 * DonatePayment — the unified payment section of the campaign donate
 * page (replaces the separate gateway form + "other methods" section).
 *
 * WooCommerce-checkout style: two selectable branch cards — rial
 * (online gateway / card-to-card) and dollar (crypto / PayPal) — then
 * radio-style method rows. Every method form starts COLLAPSED (owner
 * request): tapping a row expands that method's form, tapping the
 * open row collapses it again. Only methods the server publishes
 * (enabled AND configured in the CRM — GET /donation-methods) are
 * ever rendered: a disabled method is absent, an empty branch
 * disappears, and if nothing is available the section hides entirely.
 *
 * State machines stay in useDonate / useManualDonate (ADR-001); this
 * container owns only branch/method selection and composition.
 */
import { useEffect, useMemo, useState } from 'react';
import { useDonate } from '@/lib/hooks/useDonate';
import { useManualDonate } from '@/lib/hooks/useManualDonate';
import { formatToman, type FinanceCampaign } from '@/lib/finance';
import { DonateForm, type DonateFormLabels } from './DonateForm';
import { ManualDonateForm, pickLocalized, type ManualDonateLabels } from './ManualDonateForm';

export interface DonatePaymentLabels {
  payTitle: string;
  branchRial: string;
  branchUsd: string;
  onlineTitle: string;
}

type MethodId = 'online' | 'card' | 'crypto' | 'paypal';
type Branch = 'rial' | 'usd';

const BRANCH_OF: Record<MethodId, Branch> = {
  online: 'rial',
  card: 'rial',
  crypto: 'usd',
  paypal: 'usd',
};

export function DonatePayment({
  campaign,
  campaignTitle,
  locale,
  currencySuffix,
  flowLabels,
  manualLabels,
  payLabels,
}: {
  campaign: FinanceCampaign;
  campaignTitle: string;
  locale: string;
  currencySuffix: string;
  flowLabels: DonateFormLabels;
  manualLabels: ManualDonateLabels;
  payLabels: DonatePaymentLabels;
}) {
  const donate = useDonate({ campaign, campaignTitle, locale });
  const manual = useManualDonate({ campaignId: campaign.id });

  const presets = useMemo(
    () =>
      donate.presets.map((value) => ({
        value,
        label: `${formatToman(value, locale)} ${currencySuffix}`,
      })),
    [donate.presets, locale, currencySuffix],
  );

  // Availability — driven entirely by the server-published method list.
  // Until the list has loaded (or if it is unreachable) the online
  // gateway is assumed available, matching the page's previous
  // behaviour; once loaded, the list is authoritative.
  const onlineAvailable = !manual.methodsLoaded ? true : manual.online !== null;
  const hasMethod = (id: MethodId) => manual.methods.some((m) => m.method === id);
  const rialIds: MethodId[] = [
    ...(onlineAvailable ? (['online'] as MethodId[]) : []),
    ...(hasMethod('card') ? (['card'] as MethodId[]) : []),
  ];
  const usdIds: MethodId[] = [
    ...(hasMethod('crypto') ? (['crypto'] as MethodId[]) : []),
    ...(hasMethod('paypal') ? (['paypal'] as MethodId[]) : []),
  ];

  const [branch, setBranch] = useState<Branch>('rial');
  // Which method's form is open per branch — null = all collapsed
  // (the default; forms open only on tap).
  const [openRial, setOpenRial] = useState<MethodId | null>(null);
  const [openUsd, setOpenUsd] = useState<MethodId | null>(null);

  const effBranch: Branch | null =
    branch === 'rial'
      ? rialIds.length
        ? 'rial'
        : usdIds.length
          ? 'usd'
          : null
      : usdIds.length
        ? 'usd'
        : rialIds.length
          ? 'rial'
          : null;
  const effOpenRial = openRial && rialIds.includes(openRial) ? openRial : null;
  const effOpenUsd = openUsd && usdIds.includes(openUsd) ? openUsd : null;
  const active: MethodId | null =
    effBranch === 'rial' ? effOpenRial : effBranch === 'usd' ? effOpenUsd : null;

  // Keep the manual hook's selected method in sync with the open one
  // (its submit posts the method it holds).
  const setManualSelected = manual.setSelected;
  useEffect(() => {
    if (active && active !== 'online') setManualSelected(active);
  }, [active, setManualSelected]);

  if (manual.phase === 'done') {
    return (
      <section className="fin-pay" aria-label={manualLabels.successTitle}>
        <h2 className="fin-pay-title">{manualLabels.successTitle}</h2>
        <p className="fin-hint">{manualLabels.successBody}</p>
      </section>
    );
  }

  if (effBranch === null) return null;

  const titleOf = (id: MethodId): string => {
    if (id === 'online') {
      return (manual.online && pickLocalized(manual.online.title, locale)) || payLabels.onlineTitle;
    }
    const m = manual.methods.find((x) => x.method === id);
    return m ? pickLocalized(m.title, locale) : '';
  };

  const chooseMethod = (id: MethodId) => {
    // Accordion toggle: tapping the open row collapses it.
    if (BRANCH_OF[id] === 'rial') setOpenRial((cur) => (cur === id ? null : id));
    else setOpenUsd((cur) => (cur === id ? null : id));
  };

  const renderForm = (id: MethodId) => {
    if (id === 'online') {
      return (
        <DonateForm
          form={donate.form}
          phase={donate.phase}
          error={donate.error}
          amountValid={donate.amountValid}
          presets={presets}
          labels={flowLabels}
          onAmount={donate.setAmount}
          onPreset={donate.selectPreset}
          onDonorName={donate.setDonorName}
          onSubmit={donate.submit}
        />
      );
    }
    const m = manual.methods.find((x) => x.method === id);
    if (!m) return null;
    return (
      <ManualDonateForm
        method={m}
        phase={manual.phase}
        error={manual.error}
        amount={manual.amount}
        donorName={manual.donorName}
        proofText={manual.proofText}
        walletIndex={manual.walletIndex}
        amountValid={manual.amountValid}
        proofValid={manual.proofValid}
        locale={locale}
        labels={manualLabels}
        onAmount={manual.setAmount}
        onDonorName={manual.setDonorName}
        onProofText={manual.setProofText}
        onWalletIndex={manual.setWalletIndex}
        onFile={manual.setFile}
        onSubmit={manual.submit}
      />
    );
  };

  const branchIds = effBranch === 'rial' ? rialIds : usdIds;
  const showBranches = rialIds.length > 0 && usdIds.length > 0;

  return (
    <section className="fin-pay" aria-label={payLabels.payTitle}>
      <h2 className="fin-pay-title">{payLabels.payTitle}</h2>

      {showBranches ? (
        <div className="fin-branches" role="group" aria-label={payLabels.payTitle}>
          <button
            type="button"
            className={`fin-branch${effBranch === 'rial' ? ' fin-branch-active' : ''}`}
            aria-pressed={effBranch === 'rial'}
            onClick={() => setBranch('rial')}
          >
            <span className="fin-branch-name">{payLabels.branchRial}</span>
            <span className="fin-branch-sub">{currencySuffix}</span>
          </button>
          <button
            type="button"
            className={`fin-branch${effBranch === 'usd' ? ' fin-branch-active' : ''}`}
            aria-pressed={effBranch === 'usd'}
            onClick={() => setBranch('usd')}
          >
            <span className="fin-branch-name">{payLabels.branchUsd}</span>
            <span className="fin-branch-sub">{manualLabels.usdSuffix}</span>
          </button>
        </div>
      ) : null}

      <div className="fin-methods" role="radiogroup" aria-label={payLabels.payTitle}>
        {branchIds.map((id) => (
          <div key={id} className={`fin-method${id === active ? ' fin-method-active' : ''}`}>
            <button
              type="button"
              role="radio"
              aria-checked={id === active}
              aria-expanded={id === active}
              className="fin-method-head"
              onClick={() => chooseMethod(id)}
            >
              <span className="fin-radio" aria-hidden="true" />
              <span className="fin-method-name">{titleOf(id)}</span>
            </button>
            {id === active ? <div className="fin-method-body">{renderForm(id)}</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
