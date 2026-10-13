'use client';

import React from 'react';
import { Instrument_Serif } from 'next/font/google';
import { claudeCodePrompt } from '@/lib/bugs-features/prompt';
import type { BugFeatureKind, BugFeatureStatus, BugFeatureView } from '@/lib/bugs-features/types';
import { BF_CSS } from './styles';
import { BugsFeaturesDrawer } from './BugsFeaturesDrawer';

const serif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument-serif',
});

const DRAFT_KEY = 'bugs-features:draft';

export interface DraftImage {
  key: string;
  url: string;
  /** A screenshot pasted in this session, not uploaded yet. */
  file?: File;
  /** A screenshot already saved on the server (when editing). */
  name?: string;
}

export interface Draft {
  kind: BugFeatureKind;
  description: string;
  prompt: string;
  page: string | null;
  images: DraftImage[];
  editingId: string | null;
}

export type DrawerTab = 'new' | 'saved';

const emptyDraft = (page: string | null = null): Draft => ({
  kind: 'bug',
  description: '',
  prompt: '',
  page,
  images: [],
  editingId: null,
});

const isBlank = (draft: Draft) =>
  !draft.description.trim() && !draft.prompt.trim() && draft.images.length === 0;

const currentPage = () => `${window.location.pathname}${window.location.search}`;

function releaseImages(images: DraftImage[]) {
  for (const image of images) if (image.file) URL.revokeObjectURL(image.url);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    area.remove();
    return ok;
  }
}

async function readResult<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: T;
    error?: string;
  } | null;
  if (!response.ok || !body?.success)
    throw new Error(body?.error || `Request failed (${response.status}).`);
  return body.data as T;
}

interface BugsFeaturesContextValue {
  items: BugFeatureView[];
  loaded: boolean;
  loadError: string | null;
  openCount: number;
  isOpen: boolean;
  openDrawer: (tab?: DrawerTab) => void;
  toggleDrawer: () => void;
  startEdit: (item: BugFeatureView) => void;
  copyItem: (item: BugFeatureView) => void;
  setStatus: (item: BugFeatureView, status: BugFeatureStatus) => void;
  remove: (item: BugFeatureView) => void;
  zoom: (url: string) => void;
  freshId: string | null;
}

const BugsFeaturesContext = React.createContext<BugsFeaturesContextValue | null>(null);

/** Null outside the provider, so the header still renders in isolation. */
export function useBugsFeatures(): BugsFeaturesContextValue | null {
  return React.useContext(BugsFeaturesContext);
}

export function BugsFeaturesProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<BugFeatureView[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [tab, setTab] = React.useState<DrawerTab>('new');
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  // The unsaved new draft, parked while a saved item is being edited.
  const [stash, setStash] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [freshId, setFreshId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [zoomed, setZoomed] = React.useState<string | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = React.useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      setItems(
        await readResult<BugFeatureView[]>(
          await fetch('/api/bugs-features', { cache: 'no-store' }),
        ),
      );
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Bugs/Features could not be loaded.');
    } finally {
      setLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') as Partial<Draft> | null;
      if (saved) {
        setDraft((d) => ({
          ...d,
          kind: saved.kind === 'feature' ? 'feature' : 'bug',
          description: saved.description ?? '',
          prompt: saved.prompt ?? '',
          page: saved.page ?? null,
        }));
      }
    } catch {}
  }, [refresh]);

  // Keep the text of an unsaved new draft across reloads. Screenshots stay in memory only.
  React.useEffect(() => {
    if (draft.editingId) return;
    try {
      if (!draft.description && !draft.prompt) localStorage.removeItem(DRAFT_KEY);
      else
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            kind: draft.kind,
            description: draft.description,
            prompt: draft.prompt,
            page: draft.page,
          }),
        );
    } catch {}
  }, [draft.editingId, draft.kind, draft.description, draft.prompt, draft.page]);

  const openDrawer = React.useCallback((nextTab: DrawerTab = 'new') => {
    // A fresh draft records the page you were on when you opened it.
    setDraft((d) => (!d.editingId && isBlank(d) ? { ...d, page: currentPage() } : d));
    setTab(nextTab);
    setSaveError(null);
    setIsOpen(true);
  }, []);

  const closeDrawer = React.useCallback(() => setIsOpen(false), []);

  const toggleDrawer = React.useCallback(() => {
    if (isOpen) closeDrawer();
    else openDrawer('new');
  }, [isOpen, openDrawer, closeDrawer]);

  const addFiles = React.useCallback((files: File[]) => {
    const images = files
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => ({ key: crypto.randomUUID(), url: URL.createObjectURL(file), file }));
    if (images.length) setDraft((d) => ({ ...d, images: [...d.images, ...images] }));
    return images.length;
  }, []);

  const removeImage = React.useCallback((key: string) => {
    setDraft((d) => {
      releaseImages(d.images.filter((image) => image.key === key));
      return { ...d, images: d.images.filter((image) => image.key !== key) };
    });
  }, []);

  const startEdit = React.useCallback(
    (item: BugFeatureView) => {
      if (!draft.editingId) setStash(draft);
      else releaseImages(draft.images);
      setDraft({
        kind: item.kind,
        description: item.description,
        prompt: item.prompt,
        page: item.page,
        images: item.images.map((name, i) => ({ key: name, name, url: item.imageUrls[i] })),
        editingId: item.id,
      });
      setTab('new');
      setSaveError(null);
      setIsOpen(true);
    },
    [draft],
  );

  const cancelEdit = React.useCallback(() => {
    setDraft((d) => {
      releaseImages(d.images);
      return stash ?? emptyDraft(currentPage());
    });
    setStash(null);
    setSaveError(null);
  }, [stash]);

  const upsert = React.useCallback((item: BugFeatureView) => {
    setItems((list) => {
      const rest = list.filter((x) => x.id !== item.id);
      return [item, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  const save = React.useCallback(
    async (andCopy: boolean) => {
      if (isBlank(draft)) {
        setSaveError('Add a screenshot, description, or prompt first.');
        return;
      }
      setSaving(true);
      setSaveError(null);
      const form = new FormData();
      form.set('kind', draft.kind);
      form.set('description', draft.description);
      form.set('prompt', draft.prompt);
      form.set('page', draft.page ?? '');
      form.set(
        'keepImages',
        JSON.stringify(draft.images.flatMap((image) => (image.name ? [image.name] : []))),
      );
      for (const image of draft.images) if (image.file) form.append('images', image.file);
      try {
        const item = await readResult<BugFeatureView>(
          await fetch(
            draft.editingId ? `/api/bugs-features/${draft.editingId}` : '/api/bugs-features',
            {
              method: draft.editingId ? 'PUT' : 'POST',
              body: form,
            },
          ),
        );
        upsert(item);
        setFreshId(item.id);
        setTimeout(() => setFreshId((id) => (id === item.id ? null : id)), 2000);
        releaseImages(draft.images);
        setDraft(
          draft.editingId ? (stash ?? emptyDraft(currentPage())) : emptyDraft(currentPage()),
        );
        setStash(null);
        setTab('saved');
        const copied = andCopy && (await copyText(claudeCodePrompt(item)));
        showToast(
          andCopy
            ? copied
              ? 'Saved and copied for Claude Code'
              : 'Saved, but copying was blocked'
            : 'Saved',
        );
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Saving failed.');
      } finally {
        setSaving(false);
      }
    },
    [draft, stash, upsert, showToast],
  );

  const copyItem = React.useCallback(
    async (item: BugFeatureView) => {
      showToast(
        (await copyText(claudeCodePrompt(item)))
          ? 'Copied with context and screenshot paths'
          : 'Copying was blocked. Use Preview and select the text.',
      );
    },
    [showToast],
  );

  const setStatus = React.useCallback(
    async (item: BugFeatureView, status: BugFeatureStatus) => {
      try {
        upsert(
          await readResult<BugFeatureView>(
            await fetch(`/api/bugs-features/${item.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status }),
            }),
          ),
        );
        showToast(status === 'shipped' ? 'Marked shipped' : 'Reopened');
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'That change did not save.');
      }
    },
    [upsert, showToast],
  );

  const remove = React.useCallback(
    async (item: BugFeatureView) => {
      try {
        await readResult(await fetch(`/api/bugs-features/${item.id}`, { method: 'DELETE' }));
        setItems((list) => list.filter((x) => x.id !== item.id));
        if (draft.editingId === item.id) cancelEdit();
        showToast('Deleted');
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Deleting failed.');
      }
    },
    [draft.editingId, cancelEdit, showToast],
  );

  // Ctrl+. opens the drawer from any page. Ctrl+K stays the task capture.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '.' && !event.repeat) {
        event.preventDefault();
        toggleDrawer();
      } else if (event.key === 'Escape') {
        if (zoomed) setZoomed(null);
        else if (isOpen) closeDrawer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleDrawer, closeDrawer, isOpen, zoomed]);

  // While the drawer is open, a pasted image goes into the draft wherever focus is.
  React.useEffect(() => {
    if (!isOpen) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.items ?? [])]
        .filter((entry) => entry.kind === 'file' && entry.type.startsWith('image/'))
        .map((entry) => entry.getAsFile())
        .filter((file): file is File => !!file);
      if (!files.length) return;
      event.preventDefault();
      setTab('new');
      addFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [isOpen, addFiles]);

  const openCount = items.filter((item) => item.status === 'open').length;

  const value = React.useMemo<BugsFeaturesContextValue>(
    () => ({
      items,
      loaded,
      loadError,
      openCount,
      isOpen,
      openDrawer,
      toggleDrawer,
      startEdit,
      copyItem: (item) => void copyItem(item),
      setStatus: (item, status) => void setStatus(item, status),
      remove: (item) => void remove(item),
      zoom: setZoomed,
      freshId,
    }),
    [
      items,
      loaded,
      loadError,
      openCount,
      isOpen,
      openDrawer,
      toggleDrawer,
      startEdit,
      copyItem,
      setStatus,
      remove,
      freshId,
    ],
  );

  return (
    <BugsFeaturesContext.Provider value={value}>
      <style dangerouslySetInnerHTML={{ __html: BF_CSS }} />
      <div className={serif.variable} style={{ display: 'contents' }}>
        {children}
        <BugsFeaturesDrawer
          open={isOpen}
          onClose={closeDrawer}
          tab={tab}
          onTab={setTab}
          draft={draft}
          onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          onAddFiles={addFiles}
          onRemoveImage={removeImage}
          onCancelEdit={cancelEdit}
          onSave={(andCopy) => void save(andCopy)}
          saving={saving}
          saveError={saveError}
          items={items}
          loadError={loadError}
          freshId={freshId}
          onCopy={(item) => void copyItem(item)}
          onEdit={startEdit}
          onStatus={(item, status) => void setStatus(item, status)}
          onDelete={(item) => void remove(item)}
          onZoom={setZoomed}
        />
        {zoomed && (
          <button
            type="button"
            className="bf-lightbox"
            onClick={() => setZoomed(null)}
            aria-label="Close screenshot"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoomed} alt="Screenshot, full size" />
          </button>
        )}
        {toast && (
          <div className="bf-toast" role="status">
            {toast}
          </div>
        )}
      </div>
    </BugsFeaturesContext.Provider>
  );
}
