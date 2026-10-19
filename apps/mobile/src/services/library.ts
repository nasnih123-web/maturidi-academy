/**
 * apps/mobile — src/services/library.ts
 *
 * Library DMS (Phase 9) client: search, item detail and offline downloads.
 * Downloads go through the signed `/items/{id}/stream` URL into the app's
 * document directory and are registered in `cache_library` so the Library
 * screen can offer them offline.
 */
import * as FileSystem from "expo-file-system";
import { api, ApiError } from "../lib/api";
import { getDb, nowIso } from "../lib/db";
import { apiBaseUrl } from "../lib/config";
import { getAccessToken } from "../lib/secureStore";
import type { LibraryItem } from "../types";

export interface LibrarySearchHit {
  item_id: string;
  title: string;
  kind: string;
  score: number;
}

export async function searchLibrary(q: string, limit = 20): Promise<LibrarySearchHit[]> {
  const res = await api.get<{ hits?: LibrarySearchHit[]; items?: LibrarySearchHit[] }>("/api/v1/library/search", {
    query: { q, limit },
  });
  return res.hits ?? res.items ?? [];
}

export async function listLibraryItems(limit = 20, cursor?: string): Promise<{ items: LibraryItem[]; nextCursor: string | null }> {
  const res = await api.get<{ items: LibraryItem[]; next_cursor?: string | null }>("/api/v1/library/items", {
    query: { limit, after: cursor },
  });
  return { items: res.items ?? [], nextCursor: res.next_cursor ?? null };
}

export async function getLibraryItem(itemId: string): Promise<LibraryItem> {
  return api.get<LibraryItem>(`/api/v1/library/items/${itemId}`);
}

/** Local path for a downloaded item (stable per item id). */
export function downloadPathFor(itemId: string, kind: string): string {
  const ext = kind === "audio" ? "mp3" : kind === "video" ? "mp4" : "pdf";
  const base = FileSystem.documentDirectory ?? "";
  return `${base}library/${itemId}.${ext}`;
}

export async function isDownloaded(itemId: string): Promise<boolean> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ local_path: string | null }>(
    `SELECT local_path FROM cache_library WHERE item_id = ?`,
    [itemId],
  );
  if (!row?.local_path) return false;
  const info = await FileSystem.getInfoAsync(row.local_path);
  return info.exists;
}

/**
 * Download an item for offline use. Throws ApiError(network_error) when
 * offline. Progress is reported via `onProgress` (0..1).
 */
export async function downloadItem(
  item: LibraryItem,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const target = downloadPathFor(item.id, item.kind);
  await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}library/`, { intermediates: true }).catch(
    () => undefined,
  );
  const token = await getAccessToken();
  const download = FileSystem.createDownloadResumable(
    `${apiBaseUrl()}/api/v1/library/items/${item.id}/stream`,
    target,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    (progress) => {
      const { totalBytesWritten, totalBytesExpectedToWrite } = progress;
      if (onProgress && totalBytesExpectedToWrite > 0) onProgress(totalBytesWritten / totalBytesExpectedToWrite);
    },
  );
  const result = await download.downloadAsync().catch((e: unknown) => {
    throw new ApiError("network_error", e instanceof Error ? e.message : "download failed", 0);
  });
  if (!result || result.status !== 200) {
    throw new ApiError("download_failed", `download_failed:${result?.status ?? "?" }`, result?.status ?? 0);
  }
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO cache_library (item_id, title, kind, local_path, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET local_path = excluded.local_path,
       version = excluded.version, updated_at = excluded.updated_at`,
    [item.id, typeof item.title === "string" ? item.title : "—", item.kind, target, item.version ?? 0, nowIso()],
  );
  return target;
}

export async function removeDownload(itemId: string): Promise<void> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ local_path: string | null }>(
    `SELECT local_path FROM cache_library WHERE item_id = ?`,
    [itemId],
  );
  if (row?.local_path) {
    await FileSystem.deleteAsync(row.local_path, { idempotent: true }).catch(() => undefined);
  }
  await database.runAsync(`DELETE FROM cache_library WHERE item_id = ?`, [itemId]);
}
