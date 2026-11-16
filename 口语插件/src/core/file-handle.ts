import type { VideoVocab } from './types';
import { mergeVocabIntoMarkdown, OBSIDIAN_OPEN_URI } from './obsidian';

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

/**
 * 直接关联并写入本地 Obsidian《languagelearning/生词表.md》文件，按视频原链接合并去重，并打开 Obsidian。
 */
export async function writeVocabToLocalObsidianFile(
  vocab: VideoVocab,
  forcePick = false,
): Promise<{ ok: boolean; fileName?: string; error?: string }> {
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
      if (!handle) return { ok: false, error: '未选择文件' };
      await saveHandle(handle);
    }

    const perm = await handle.queryPermission?.({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const reqPerm = await handle.requestPermission?.({ mode: 'readwrite' });
      if (reqPerm !== 'granted') {
        return { ok: false, error: '未授予文件写入权限' };
      }
    }

    const file: File = await handle.getFile();
    const existingText = await file.text();
    const mergedText = mergeVocabIntoMarkdown(existingText, vocab);

    const writable = await handle.createWritable();
    await writable.write(mergedText);
    await writable.close();

    // 写入完成后唤起 Obsidian 打开该笔记
    window.open(OBSIDIAN_OPEN_URI, '_blank');
    return { ok: true, fileName: file.name };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: '已取消选择文件' };
    }
    return { ok: false, error: String(err?.message ?? err) };
  }
}
