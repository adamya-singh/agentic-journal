'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { ChangeLog, type DetailState } from '@/components/compass/ChangeLog';
import { CompassHero, type CompassViewKind } from '@/components/compass/CompassHero';
import { CompassSections } from '@/components/compass/CompassSections';
import { LongTermView } from '@/components/compass/LongTermView';
import { PeriodSheet } from '@/components/compass/PeriodSheet';
import { PeriodTimeline, type SheetTarget } from '@/components/compass/PeriodTimeline';
import { CP_CSS } from '@/components/compass/styles';
import type {
  CommitDetail,
  CompassHistory,
  CompassOverview,
  HistoryScope,
  PeriodDetail,
} from '@/lib/compass/types';

const VIEW_KEY = 'compass.view';
const LIMITS = [30, 100, 200];

async function api<T>(path = ''): Promise<T> {
  const r = await fetch(`/api/compass${path}`, { cache: 'no-store' });
  const p = await r.json();
  if (!r.ok || !p.success) throw new Error(p.error || 'The compass could not be loaded.');
  return p.data;
}

function setParam(key: string, value: string | null) {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(null, '', url);
}

export default function CompassPage() {
  const [overview, setOverview] = useState<CompassOverview>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  // Resolved in a mount effect (URL, then localStorage) so the server and first client render agree.
  const [view, setView] = useState<CompassViewKind>('short');
  const [scope, setScope] = useState<HistoryScope>('short');
  const [limit, setLimit] = useState(LIMITS[0]);
  const [history, setHistory] = useState<CompassHistory>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [periods, setPeriods] = useState<Record<string, PeriodDetail | null>>({});
  const [sheetError, setSheetError] = useState<string | null>(null);
  // The sheet portals into the page tree (not document.body) so it inherits the serif font variable
  // that BugsFeaturesProvider sets on its wrapper.
  const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null);
  const historyReq = useRef(0);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await api<CompassOverview>());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The compass could not be loaded.');
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  const loadHistory = useCallback(async (s: HistoryScope, n: number) => {
    const req = ++historyReq.current;
    setHistoryLoading(true);
    try {
      const data = await api<CompassHistory>(`/history?scope=${s}&limit=${n}`);
      if (req === historyReq.current) setHistory(data);
    } catch (e) {
      if (req === historyReq.current) {
        setHistory({
          scope: s,
          limit: n,
          commits: [],
          error: e instanceof Error ? e.message : 'The history could not be loaded.',
        });
      }
    } finally {
      if (req === historyReq.current) setHistoryLoading(false);
    }
  }, []);

  const loadPeriod = useCallback(async (id: string) => {
    setSheetError(null);
    try {
      const data = await api<PeriodDetail>(`/periods/${encodeURIComponent(id)}`);
      setPeriods((p) => ({ ...p, [id]: data }));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The period could not be loaded.';
      if (/Not found/i.test(message)) setPeriods((p) => ({ ...p, [id]: null }));
      else setSheetError(message);
    }
  }, []);

  const refresh = useCallback(() => {
    loadOverview();
    loadHistory(scope, limit);
    setDetails({});
    if (sheet?.kind === 'period') loadPeriod(sheet.id);
  }, [loadOverview, loadHistory, loadPeriod, scope, limit, sheet]);

  // Mount: URL wins, then the remembered view; a ?period= deep link opens the sheet.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('compass');
    let initial: CompassViewKind = 'short';
    if (fromUrl === 'long' || fromUrl === 'short') initial = fromUrl;
    else {
      try {
        const stored = localStorage.getItem(VIEW_KEY);
        if (stored === 'long' || stored === 'short') initial = stored;
      } catch {
        /* storage unavailable */
      }
    }
    setView(initial);
    setScope(initial === 'long' ? 'long' : 'short');
    const period = params.get('period');
    if (period && /^\d{4}-\d{2}-\d{2}--\d{4}-\d{2}-\d{2}$/.test(period)) {
      setSheet({ kind: 'period', id: period });
      loadPeriod(period);
    }
    loadOverview();
  }, [loadOverview, loadPeriod]);

  useEffect(() => {
    loadHistory(scope, limit);
  }, [scope, limit, loadHistory]);

  // Reload when the tab comes back; no interval polling.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadOverview();
        loadHistory(scope, limit);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadOverview, loadHistory, scope, limit]);

  const changeView = (next: CompassViewKind) => {
    setView(next);
    setScope(next === 'long' ? 'long' : 'short');
    setLimit(LIMITS[0]);
    setExpanded(null);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* storage unavailable */
    }
    setParam('compass', next === 'short' ? null : next);
  };

  const changeScope = (next: HistoryScope) => {
    setScope(next);
    setLimit(LIMITS[0]);
    setExpanded(null);
  };

  const openSheet = (target: SheetTarget) => {
    setSheet(target);
    setParam('period', target.kind === 'period' ? target.id : null);
    if (target.kind === 'period' && periods[target.id] === undefined) loadPeriod(target.id);
  };

  const closeSheet = () => {
    setSheet(null);
    setSheetError(null);
    setParam('period', null);
  };

  const toggleCommit = (sha: string) => {
    if (expanded === sha) {
      setExpanded(null);
      return;
    }
    setExpanded(sha);
    if (details[sha] === undefined || details[sha] === 'error') {
      setDetails((d) => ({ ...d, [sha]: 'loading' }));
      api<CommitDetail>(`/history/${sha}`)
        .then((detail) => setDetails((d) => ({ ...d, [sha]: detail })))
        .catch(() => setDetails((d) => ({ ...d, [sha]: 'error' })));
    }
  };

  const canMore = !!history && history.commits.length >= limit && limit < LIMITS[LIMITS.length - 1];
  const more = () => setLimit((l) => LIMITS.find((n) => n > l) ?? l);
  const draft = sheet?.kind === 'draft' ? (overview?.drafts.find((d) => d.id === sheet.id) ?? null) : null;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <AppHeader title="Compass" subtitle="Where OpenClaw is steering" />
      <main className="bf-root bf-page cp-root">
        <style dangerouslySetInnerHTML={{ __html: CP_CSS }} />
        <div ref={setPortalEl} />
        <div className="bf-page-in">
          <CompassHero
            overview={overview}
            loading={loading}
            view={view}
            onView={changeView}
            onRefresh={refresh}
            now={now}
          />
          {error && <p className="bf-status err">{error}</p>}
          {overview &&
            (view === 'short' ? (
              <CompassSections compass={overview.shortTerm} dir={overview.dir} />
            ) : (
              <LongTermView longTerm={overview.longTerm} dir={overview.dir} now={now} />
            ))}
          {overview && (
            <div className={`cp-history${view === 'long' ? ' single' : ''}`}>
              {view === 'short' && (
                <PeriodTimeline
                  periods={overview.periods}
                  drafts={overview.drafts}
                  today={overview.today}
                  onOpen={openSheet}
                />
              )}
              <ChangeLog
                history={history}
                loading={historyLoading}
                scope={scope}
                onScope={changeScope}
                canMore={canMore}
                onMore={more}
                expanded={expanded}
                onToggle={toggleCommit}
                details={details}
                repo={overview.repo}
                now={now}
              />
            </div>
          )}
        </div>
      </main>
      <PeriodSheet
        target={sheet}
        onClose={closeSheet}
        period={sheet?.kind === 'period' ? periods[sheet.id] : null}
        draft={draft}
        error={sheetError}
        today={overview?.today ?? ''}
        container={portalEl}
      />
    </div>
  );
}
