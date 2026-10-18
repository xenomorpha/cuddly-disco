import { useEffect, useMemo, useState } from 'react';
import { assetUrl, cachedAssetUrl, useStore } from './model/store';
import { getIndex } from './model/index';
import { makeAccess } from './model/permissions';
import type { Workspace } from './model/types';

export const useDoc = () => useStore((s) => s.doc!) as Workspace;
export const useUI = () => useStore((s) => s.ui);

export function useIndex() {
  const doc = useDoc();
  return getIndex(doc);
}

export function viewerId(ui: { shareToken: string | null; userId: string }) {
  return ui.shareToken ? 'link:' + ui.shareToken : ui.userId;
}

export function useAccess() {
  const doc = useDoc();
  const viewer = useStore((s) => viewerId(s.ui));
  return useMemo(() => makeAccess(doc, viewer), [doc, viewer]);
}

export function useAssetUrl(id: string | undefined) {
  const [url, setUrl] = useState<string | null>(() => (id ? cachedAssetUrl(id) : null));
  const doc = useDoc();
  useEffect(() => {
    let alive = true;
    if (id) void assetUrl(id).then((u) => alive && setUrl(u));
    else setUrl(null);
    return () => {
      alive = false;
    };
  }, [id, doc]);
  return url;
}

export function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
export const modKey = () => (isMac() ? '⌘' : 'Ctrl');
