/**
 * DonateBanner — dignified donation banner. Title/body/CTA come from the
 * API section; no payment gateway is wired (finance phase) and no mock
 * transaction exists — the CTA is a plain link from API data.
 */
export function DonateBanner({
  sectionId,
  title,
  body,
  cta,
}: {
  sectionId: string;
  title: string;
  body?: string;
  cta: { label: string; href: string } | null;
}) {
  return (
    <section className="home-section" aria-label={title}>
      <div className="section-inner">
        <div className="donation-banner">
          <p className="donation-title" id={sectionId}>
            {title}
          </p>
          {body ? <p className="donation-body">{body}</p> : null}
          {cta ? (
            <div className="donation-cta">
              <a className="btn-primary" href={cta.href}>
                {cta.label}
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
