import type { VideoVocab } from './types';
import { OBSIDIAN_OPEN_URI, ObsidianSyncResult, syncVocabIntoMarkdown } from './obsidian';

const DB_NAME = 'sh_obsidian_handles';
const STORE_NAME = 'handles';
const KEY_VOCAB_FILE = 'vocab_md_handle';

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getSavedHandle(): Promise<any | null> {
  try {
    const db = await openHandleDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY_VOCAB_FILE);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveHandle(handle: any): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, KEY_VOCAB_FILE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export async function clearSavedObsidianHandle(): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(KEY_VOCAB_FILE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export function supportsLocalObsidianFileAccess(): boolean {
  return typeof (window as any)?.showOpenFilePicker === 'function';
}

export interface LocalFileWriteResult {
  ok: boolean;
  fileName?: string;
  status?: ObsidianSyncResult['status'];
  addedCount?: number;
  error?: string;
  cancelled?: boolean;
}

/**
 * 读取本地 Obsidian《生词表.md》并按标题匹配逻辑写入（无同标题按模板全量导入，有同标题仅追加新增词汇），完成后打开 Obsidian。
 */
export async function writeVocabToLocalObsidianFile(
  vocab: VideoVocab,
  forcePick = false,
): Promise<LocalFileWriteResult> {
  const win = window as any;
  if (typeof win.showOpenFilePicker !== 'function') {
    return { ok: false, error: '当前浏览器环境不支持 File System Access API' };
  }

  try {
    let handle = forcePick ? null : await getSavedHandle();
    if (!handle) {
      const picked = await win.showOpenFilePicker({
        id: 'obsidian_vocab_md',
        multiple: false,
        types: [
          {
            description: 'Obsidian Markdown 生词表 (生词表.md)',
            accept: { 'text/markdown': ['.md'] },
          },
        ],
      });
      handle = picked?.[0];
      if (!handle) return { ok: false, cancelled: true, error: '未选择文件' };
      await saveHandle(handle);
    }

    const perm = await handle.queryPermission?.({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const reqPerm = await handle.requestPermission?.({ mode: 'readwrite' });
      if (reqPerm !== 'granted') {
        return { ok: false, error: '未授予文件写入权限' };
      }
    }

    let file: File;
    try {
      file = await handle.getFile();
    } catch (readErr: any) {
      if (readErr?.name === 'NotFoundError' && !forcePick) {
        await clearSavedObsidianHandle();
        return writeVocabToLocalObsidianFile(vocab, true);
      }
      throw readErr;
    }

    const existingText = await file.text();
    const syncRes = syncVocabIntoMarkdown(existingText, vocab);

    if (syncRes.status !== 'noop') {
      const writable = await handle.createWritable();
      await writable.write(syncRes.markdown);
      await writable.close();
    }

    // 唤起 Obsidian 查看该笔记
    window.open(OBSIDIAN_OPEN_URI, '_blank');
    return {
      ok: true,
      fileName: file.name,
      status: syncRes.status,
      addedCount: syncRes.addedCount,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, cancelled: true, error: '已取消选择文件' };
    }
    return { ok: false, error: String(err?.message ?? err) };
  }
}
