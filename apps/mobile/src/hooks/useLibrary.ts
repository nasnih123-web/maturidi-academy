/**
 * apps/mobile — src/hooks/useLibrary.ts
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import {
  downloadItem as svcDownload,
  isDownloaded as svcIsDownloaded,
  listLibraryItems as svcList,
  searchLibrary as svcSearch,
  type LibrarySearchHit,
} from "../services/library";
import type { LibraryItem } from "../types";

export function useLibrary(): {
  items: LibraryItem[];
  searching: boolean;
  error: string | null;
  search: (q: string) => Promise<LibrarySearchHit[]>;
  refresh: () => void;
  downloadingId: string | null;
  downloadProgress: number;
  download: (item: LibraryItem) => Promise<boolean>;
  downloaded: (itemId: string) => Promise<boolean>;
} {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    svcList(20)
      .then((r) => alive && setItems(r.items))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.code : "unknown"));
    return () => {
      alive = false;
    };
  }, [nonce]);

  const search = useCallback(async (q: string): Promise<LibrarySearchHit[]> => {
    setSearching(true);
    setError(null);
    try {
      return await svcSearch(q, 20);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "unknown");
      return [];
    } finally {
      setSearching(false);
    }
  }, []);

  const download = useCallback(async (item: LibraryItem): Promise<boolean> => {
    setDownloadingId(item.id);
    setDownloadProgress(0);
    try {
      await svcDownload(item, (f) => setDownloadProgress(f));
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "unknown");
      return false;
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const downloaded = useCallback((itemId: string) => svcIsDownloaded(itemId), []);

  return { items, searching, error, search, refresh, downloadingId, downloadProgress, download, downloaded };
}
