'use client';

import React from 'react';

/**
 * A company's logo tile for the Mission pages, served by the cached logo route.
 * The route resolves the domain from the curated map or the posting's own site;
 * when it has none the tile falls back to the company's initial.
 */
export function CompanyLogo({ company, link, size = '' }: { company: string; link?: string; size?: '' | 'sm' | 'lg' }) {
  const [failed, setFailed] = React.useState(false);
  const letter = company.replace(/[^A-Za-z0-9]/g, '')[0]?.toUpperCase() ?? '?';
  if (failed) return <span className={`logo letter ${size}`} aria-hidden="true">{letter}</span>;
  const src = `/api/jobs/interviews/logo?company=${encodeURIComponent(company)}${link ? `&link=${encodeURIComponent(link)}` : ''}`;
  return (
    <span className={`logo ${size}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- served by our own cached logo route */}
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}
