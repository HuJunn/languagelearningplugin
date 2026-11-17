import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompactDict } from '../core/dict';
import { cleanWord, lookupOfflineDict } from '../core/dict';
import {
  buildObsidianAppendUri,
  formatTimestamp,
  formatVideoVocabSection,
  formatVocabItemBullet,
  OBSIDIAN_OPEN_URI,
} from '../core/obsidian';
import { writeVocabToLocalObsidianFile } from '../core/file-handle';
import { findSentenceAt, findSentenceBefore } from '../core/segment';
import { translateSentencesBatch, translateWordOnline } from '../core/translate';
import type { UpdateCheckResult } from '../core/version';
import type { DictEntry, Sentence, Transcript, VideoVocab, VocabItem, Word } from '../core/types';

export interface ShadowingPanelProps {
  transcript: Transcript | null;
  videoTitle: string;
  videoUrl: string;
  loading: boolean;
  progress: { percent: number; detail: string };
  failReason?: string;
  onRetryCaptions: () => void;
  mode: 'C' | 'D';
  onModeChange: (mode: 'C' | 'D') => void;
  isFullscreen: boolean;
  dict: CompactDict;
  hasCustomManual: boolean;
  onApplyCustomManualText: (rawText: string) => void;
  onClearCustomManualText: () => void;
  getVideoElement: () => HTMLVideoElement | null;
  onClose?: () => void;
}

interface PopoverState {
  rawWord: string;
  cleaned: string;
  sentence: Sentence;
  rect: { left: number; top: number; bottom: number };
  offline: DictEntry | null;
  onlineLoading: boolean;
  onlineWord?: string;
  onlineSentence?: string;
  onlineProvider?: string;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // ignore
  }
}

export const ShadowingPanel: React.FC<ShadowingPanelProps> = ({
  transcript,
  videoTitle,
  videoUrl,
  loading,
  progress,
  failReason,
  onRetryCaptions,
  mode,
  onModeChange,
  isFullscreen,
  dict,
  hasCustomManual,
  onApplyCustomManualText,
  onClearCustomManualText,
  getVideoElement,
  onClose,
}) => {
  // 全屏时自动切换为 C（悬浮模式），退出全屏后自动恢复用户选择的 mode
  const effectiveMode: 'C' | 'D' = isFullscreen ? 'C' : mode;

  const [autoPause, setAutoPause] = useState<boolean>(() => loadJson('sh_auto_pause', true));
  const [showZh, setShowZh] = useState<boolean>(() => loadJson('sh_show_zh', false));
  const [opacity, setOpacity] = useState<number>(() => loadJson('sh_opacity', 0.92));
  const [pos, setPos] = useState<{ x: number; y: number }>(() =>
    loadJson('sh_pos_c', { x: Math.max(20, window.innerWidth - 430), y: 72 }),
  );
  const [sizeC, setSizeC] = useState<{ w: number; h: number }>(() =>
    loadJson('sh_size_c', { w: 390, h: 480 }),
  );
  const [heightD, setHeightD] = useState<number>(() => loadJson('sh_height_d', 320));

  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [zhMap, setZhMap] = useState<Record<number, string>>({});
  const [zhLoading, setZhLoading] = useState<boolean>(false);

  const [drawer, setDrawer] = useState<'none' | 'vocab' | 'calibrate' | 'help'>('none');
  const [calibInput, setCalibInput] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const currentVersion = useMemo(() => {
    try {
      return chrome?.runtime?.getManifest?.()?.version || '0.1.2';
    } catch {
      return '0.1.2';
    }
  }, []);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(() => {
    const cached = loadJson<{ checkedAt: number; result: UpdateCheckResult } | null>('sh_update_check', null);
    if (cached && cached.result?.currentVersion === currentVersion) {
      return cached.result;
    }
    return null;
  });
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);

  const videoId = transcript?.videoId || 'default';
  const [vocabItems, setVocabItems] = useState<VocabItem[]>(() => loadJson(`sh_vocab_${videoId}`, []));

  useEffect(() => {
    setVocabItems(loadJson(`sh_vocab_${videoId}`, []));
    setZhMap(loadJson(`sh_zh_${videoId}`, {}));
    setActiveIdx(-1);
    setPopover(null);
  }, [videoId]);

  useEffect(() => saveJson('sh_auto_pause', autoPause), [autoPause]);
  useEffect(() => saveJson('sh_show_zh', showZh), [showZh]);
  useEffect(() => saveJson('sh_opacity', opacity), [opacity]);
  useEffect(() => saveJson('sh_pos_c', pos), [pos]);
  useEffect(() => saveJson('sh_size_c', sizeC), [sizeC]);
  useEffect(() => saveJson('sh_height_d', heightD), [heightD]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const stopTargetRef = useRef<{ idx: number; time: number } | null>(null);
  const autoPausedIdxRef = useRef<number | null>(null);
  const lastCompletedIdxRef = useRef<number | null>(null);
  const pinnedIdxRef = useRef<number | null>(null);
  const activeIdxRef = useRef<number>(-1);
  const autoPauseRef = useRef<boolean>(autoPause);
  autoPauseRef.current = autoPause;

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2800);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const handleCheckUpdate = useCallback(
    async (silent = false) => {
      if (checkingUpdate) return;
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        if (!silent) showToast(`当前版本 v${currentVersion}`);
        return;
      }
      if (!silent) setCheckingUpdate(true);
      try {
        const res = (await chrome.runtime.sendMessage({ type: 'SH_CHECK_UPDATE' })) as
          | ({ ok: true } & UpdateCheckResult)
          | { ok: false; error?: string };
        if (res?.ok) {
          const info: UpdateCheckResult = {
            currentVersion: res.currentVersion,
            latestVersion: res.latestVersion,
            hasUpdate: res.hasUpdate,
            downloadUrl: res.downloadUrl,
            repoUrl: res.repoUrl,
            platform: res.platform,
          };
          setUpdateInfo(info);
          saveJson('sh_update_check', { checkedAt: Date.now(), result: info });
          if (!silent) {
            showToast(
              info.hasUpdate
                ? `发现 GitHub 新版本 v${info.latestVersion}（当前 v${info.currentVersion}）`
                : `当前已是最新版本 v${info.currentVersion}`,
            );
          }
        } else if (!silent) {
          showToast('检查更新失败，请确认可访问 GitHub');
        }
      } catch {
        if (!silent) showToast('检查更新失败，请确认可访问 GitHub');
      } finally {
        if (!silent) setCheckingUpdate(false);
      }
    },
    [checkingUpdate, currentVersion, showToast],
  );

  // 打开面板时静默检查 GitHub 新版本（每 6 小时最多自动请求一次）
  useEffect(() => {
    const cached = loadJson<{ checkedAt: number; result: UpdateCheckResult } | null>('sh_update_check', null);
    const expired = !cached || Date.now() - cached.checkedAt > 6 * 3600 * 1000 || cached.result?.currentVersion !== currentVersion;
    if (expired) {
      handleCheckUpdate(true);
    }
  }, [currentVersion]);

  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      const path = e.composedPath?.() ?? [];
      for (const node of path) {
        if (node instanceof HTMLElement && (node.classList.contains('sh-popover') || node.classList.contains('sh-word'))) {
          return;
        }
      }
      setPopover(null);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [popover]);

  // 将指定句子滚动到插件列表 UI 的正中间
  const centerSentenceInList = useCallback((idx: number, smooth = true) => {
    const container = listRef.current;
    if (!container || idx < 0) return;
    const rowEl = container.querySelector<HTMLElement>(`[data-sent-idx="${idx}"]`);
    if (!rowEl) return;
    const spacerH = Math.max(40, Math.floor(container.clientHeight / 2 - rowEl.offsetHeight / 2));
    container.style.setProperty('--sh-spacer-h', `${spacerH}px`);
    const targetTop = rowEl.offsetTop - container.clientHeight / 2 + rowEl.offsetHeight / 2;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  // 监听列表尺寸、模式、译文开关变化，动态更新首尾留白并保持当前播放句居中
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const updateSpacerAndCenter = () => {
      const spacerH = Math.max(40, Math.floor(container.clientHeight / 2 - 24));
      container.style.setProperty('--sh-spacer-h', `${spacerH}px`);
      if (activeIdxRef.current >= 0) {
        centerSentenceInList(activeIdxRef.current, false);
      }
    };
    updateSpacerAndCenter();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSpacerAndCenter) : null;
    ro?.observe(container);
    return () => ro?.disconnect();
  }, [effectiveMode, showZh, zhMap, drawer, centerSentenceInList]);

  // 播放指定句子（点击句子空白处或按快捷键时触发，零延迟）
  const playSentence = useCallback(
    (sent: Sentence, index: number) => {
      const video = getVideoElement();
      if (!video) return;
      setPopover(null);
      autoPausedIdxRef.current = null;
      lastCompletedIdxRef.current = null;
      pinnedIdxRef.current = index;
      stopTargetRef.current = autoPauseRef.current ? { idx: index, time: sent.end } : null;
      // 首句开头精准裁切：从第一个单词起点提前 80ms 预卷，消除解码延迟与连读吞字，确保完整听到第一个词
      const firstWordStart = sent.words[0]?.start ?? sent.start;
      video.currentTime = Math.max(0, firstWordStart - 0.08);
      video.play().catch(() => {});
      setActiveIdx(index);
      activeIdxRef.current = index;
      centerSentenceInList(index, true);
    },
    [getVideoElement, centerSentenceInList],
  );

  // 60fps 歌词级逐词渐变同步 & 读完本句自动暂停
  useEffect(() => {
    const sentences = transcript?.sentences ?? [];
    if (!sentences.length) return;

    let rafId = 0;
    const tick = () => {
      const video = getVideoElement();
      if (video) {
        const t = video.currentTime;

        // 1. 如果刚在某句末尾自动暂停，用户随后按了播放器播放键/空格继续播放，解除暂停锁定并准备进入下一句
        if (!video.paused && autoPausedIdxRef.current != null) {
          autoPausedIdxRef.current = null;
        }

        // 2. 检查是否到达本句末尾需要自动暂停（使用句尾自然收尾余量，并严格锁定在本句）
        const stopTarget = stopTargetRef.current;
        if (autoPauseRef.current && stopTarget != null && !video.paused && t >= stopTarget.time) {
          const pausedIdx = stopTarget.idx;
          stopTargetRef.current = null;
          pinnedIdxRef.current = pausedIdx;
          autoPausedIdxRef.current = pausedIdx;
          lastCompletedIdxRef.current = pausedIdx;
          video.pause();
        }

        // 3. 若暂停期间用户手动拖动了视频进度条到远处，解除旧锁定句
        if (video.paused && pinnedIdxRef.current != null) {
          const pSent = sentences[pinnedIdxRef.current];
          const nextStart = sentences[pinnedIdxRef.current + 1]?.start ?? pSent.end + 0.5;
          if (pSent && (t < pSent.start - 0.35 || t > Math.max(pSent.end, nextStart) + 0.45)) {
            pinnedIdxRef.current = null;
            autoPausedIdxRef.current = null;
            lastCompletedIdxRef.current = null;
          }
        }

        // 4. 确定当前激活句子下标：
        //    - 暂停且存在锁定句时无条件锁定在本句；
        //    - 处于跳句开头的 80ms 预卷区间或句尾连读余量区间时，保持锁定在目标句
        let idx: number;
        if (video.paused && pinnedIdxRef.current != null) {
          idx = pinnedIdxRef.current;
        } else if (
          !video.paused &&
          pinnedIdxRef.current != null &&
          t >= sentences[pinnedIdxRef.current].start - 0.15 &&
          t < sentences[pinnedIdxRef.current].start
        ) {
          // 处于跳句开头的 80ms 预卷区间时，保持锁定在目标句
          idx = pinnedIdxRef.current;
        } else if (
          !video.paused &&
          autoPauseRef.current &&
          stopTargetRef.current != null &&
          t >= sentences[stopTargetRef.current.idx].start &&
          t <= stopTargetRef.current.time
        ) {
          // 开启读完暂停时，在本句收尾余量区间内保持锁定在本句直到暂停触发
          idx = stopTargetRef.current.idx;
          pinnedIdxRef.current = idx;
        } else {
          idx = findSentenceAt(sentences, t);
          if (!video.paused && idx >= 0 && idx !== lastCompletedIdxRef.current) {
            lastCompletedIdxRef.current = null;
            pinnedIdxRef.current = idx;
            if (autoPauseRef.current && stopTargetRef.current?.idx !== idx) {
              stopTargetRef.current = { idx, time: sentences[idx].end };
            }
          } else if (!video.paused && idx < 0 && pinnedIdxRef.current != null) {
            idx = pinnedIdxRef.current;
          }
        }

        if (idx !== activeIdxRef.current) {
          // 清理旧句子的逐词样式
          const prevEl = listRef.current?.querySelector<HTMLElement>(`[data-sent-idx="${activeIdxRef.current}"]`);
          if (prevEl) {
            prevEl.querySelectorAll<HTMLElement>('.sh-word').forEach((wEl) => {
              wEl.classList.remove('sh-done', 'sh-cur');
              wEl.style.removeProperty('--p');
            });
          }
          activeIdxRef.current = idx;
          setActiveIdx(idx);

          if (idx >= 0) {
            centerSentenceInList(idx, true);
          }
        }

        // 5. 更新当前活动句子的每个词的卡拉OK颜色渐变进度 (--p)
        if (idx >= 0 && listRef.current) {
          const sent = sentences[idx];
          const rowEl = listRef.current.querySelector<HTMLElement>(`[data-sent-idx="${idx}"]`);
          const isFinishedHold = video.paused && autoPausedIdxRef.current === idx;
          if (rowEl && sent) {
            const wordEls = rowEl.querySelectorAll<HTMLElement>('.sh-word');
            for (let j = 0; j < sent.words.length; j++) {
              const w = sent.words[j];
              const el = wordEls[j];
              if (!el) continue;
              if (isFinishedHold || t >= w.end - 0.002) {
                el.classList.add('sh-done');
                el.classList.remove('sh-cur');
              } else if (t >= w.start) {
                const dur = Math.max(0.04, w.end - w.start);
                const pct = Math.min(100, Math.max(0, ((t - w.start) / dur) * 100));
                el.classList.add('sh-cur');
                el.classList.remove('sh-done');
                el.style.setProperty('--p', `${pct.toFixed(1)}%`);
              } else {
                el.classList.remove('sh-done', 'sh-cur');
              }
            }
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [transcript, getVideoElement]);

  // 整句译文开关打开时，批量翻译当前视频的所有句子
  useEffect(() => {
    if (!showZh || !transcript?.sentences.length) return;
    const sentences = transcript.sentences;
    const missing = sentences.filter((s) => !zhMap[s.id]);
    if (missing.length === 0 || zhLoading) return;

    let cancelled = false;
    setZhLoading(true);

    const texts = missing.map((s) => s.text);
    const runTranslate = async () => {
      try {
        let translated: string[] = [];
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          const resp = await chrome.runtime.sendMessage({
            type: 'SH_TRANSLATE_BATCH',
            sentences: texts,
          });
          if (resp?.ok && Array.isArray(resp.translations)) {
            translated = resp.translations;
          }
        }
        if (!translated.length) {
          translated = await translateSentencesBatch(texts);
        }
        if (cancelled) return;
        const next: Record<number, string> = { ...zhMap };
        missing.forEach((s, idx) => {
          if (translated[idx]) next[s.id] = translated[idx];
        });
        setZhMap(next);
        saveJson(`sh_zh_${videoId}`, next);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setZhLoading(false);
      }
    };
    runTranslate();
    return () => {
      cancelled = true;
    };
  }, [showZh, transcript, videoId]);

  // 点击单词立即查词（0ms 无延迟，阻止冒泡避免触发切换句子）
  const handleWordClick = useCallback(
    async (e: React.MouseEvent<HTMLSpanElement>, word: Word, sentence: Sentence) => {
      e.stopPropagation();
      const target = e.currentTarget;
      const r = target.getBoundingClientRect();
      const cleaned = cleanWord(word.text);
      const offline = lookupOfflineDict(word.text, dict);

      const left = Math.min(Math.max(10, r.left), window.innerWidth - 305);
      const top = r.bottom + 210 > window.innerHeight ? Math.max(10, r.top - 205) : r.bottom + 6;

      setPopover({
        rawWord: word.text,
        cleaned: cleaned || word.text,
        sentence,
        rect: { left, top, bottom: r.bottom },
        offline,
        onlineLoading: true,
      });

      const queryWord = offline?.lemma || cleaned || word.text;
      try {
        let res: { wordTranslation?: string; sentenceTranslation?: string; provider?: string } | null = null;
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          const msgRes = await chrome.runtime.sendMessage({
            type: 'SH_TRANSLATE_WORD',
            word: queryWord,
            sentence: sentence.text,
          });
          if (msgRes?.ok) res = msgRes;
        }
        if (!res) {
          res = await translateWordOnline(queryWord, sentence.text);
        }
        setPopover((prev) =>
          prev && prev.cleaned === (cleaned || word.text)
            ? {
                ...prev,
                onlineLoading: false,
                onlineWord: res?.wordTranslation,
                onlineSentence: res?.sentenceTranslation,
                onlineProvider: res?.provider,
              }
            : prev,
        );
      } catch {
        setPopover((prev) => (prev ? { ...prev, onlineLoading: false } : null));
      }
    },
    [dict],
  );

  // 快捷键支持 (问题6)
  useEffect(() => {
    const sentences = transcript?.sentences ?? [];
    if (!sentences.length) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const path = e.composedPath?.() ?? [];
      for (const node of path) {
        if (
          node instanceof HTMLElement &&
          (node.tagName === 'INPUT' ||
            node.tagName === 'TEXTAREA' ||
            node.isContentEditable ||
            node.id === 'search-input' ||
            node.id === 'contenteditable-root' ||
            node.classList.contains('sh-textarea'))
        ) {
          return;
        }
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const video = getVideoElement();
      const curT = video?.currentTime ?? 0;
      const curIdx =
        pinnedIdxRef.current != null
          ? pinnedIdxRef.current
          : activeIdxRef.current >= 0
            ? activeIdxRef.current
            : Math.max(0, findSentenceBefore(sentences, curT));

      const key = e.key.toLowerCase();
      if (key === 'r' || key === 's') {
        e.preventDefault();
        const target = sentences[Math.max(0, curIdx)];
        if (target) playSentence(target, Math.max(0, curIdx));
      } else if (key === 'a' || e.key === 'ArrowLeft') {
        // 仅在按下 A 或 Shift+ArrowLeft 时切换上一句，避免干扰部分用户但同时支持直观快捷键
        if (key === 'a' || e.shiftKey) {
          e.preventDefault();
          const prevIdx = Math.max(0, curIdx - 1);
          if (sentences[prevIdx]) playSentence(sentences[prevIdx], prevIdx);
        }
      } else if (key === 'd' || e.key === 'ArrowRight') {
        if (key === 'd' || e.shiftKey) {
          e.preventDefault();
          const nextIdx = Math.min(sentences.length - 1, curIdx + 1);
          if (sentences[nextIdx]) playSentence(sentences[nextIdx], nextIdx);
        }
      } else if (key === 'p' || key === 'q') {
        e.preventDefault();
        setAutoPause((v) => {
          showToast(`读完自动暂停：${!v ? '已开启' : '已关闭'}`);
          return !v;
        });
      } else if (key === 't') {
        e.preventDefault();
        setShowZh((v) => !v);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [transcript, getVideoElement, playSentence, showToast]);

  // Mode C 拖拽移动
  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (effectiveMode !== 'C') return;
    const target = e.target as HTMLElement;
    if (target.closest('button, label, input')) return;
    e.preventDefault();
    const startX = e.clientX - pos.x;
    const startY = e.clientY - pos.y;

    const onMove = (ev: MouseEvent) => {
      const nx = Math.max(8, Math.min(window.innerWidth - sizeC.w - 8, ev.clientX - startX));
      const ny = Math.max(8, Math.min(window.innerHeight - 80, ev.clientY - startY));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Mode C & D 拖拽调整窗口大小
  const startResize = (dir: 'r' | 'b' | 'br') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const initW = sizeC.w;
    const initH = effectiveMode === 'C' ? sizeC.h : heightD;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (effectiveMode === 'D') {
        setHeightD(Math.max(200, Math.min(720, initH + dy)));
        return;
      }
      setSizeC({
        w: dir === 'r' || dir === 'br' ? Math.max(290, Math.min(920, initW + dx)) : initW,
        h: dir === 'b' || dir === 'br' ? Math.max(240, Math.min(window.innerHeight - 40, initH + dy)) : initH,
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 生词本操作
  const isWordInVocab = useCallback(
    (w: string) => vocabItems.some((i) => i.word.toLowerCase() === w.toLowerCase()),
    [vocabItems],
  );

  const toggleVocabWord = (pop: PopoverState) => {
    const wordKey = (pop.offline?.lemma || pop.cleaned).toLowerCase();
    const exists = isWordInVocab(wordKey);
    let next: VocabItem[];
    if (exists) {
      next = vocabItems.filter((i) => i.word.toLowerCase() !== wordKey);
      showToast(`已从生词本移除：${wordKey}`);
    } else {
      const meaning = pop.offline?.translation || pop.onlineWord || '（待补充释义）';
      const phonetic = pop.offline?.phonetic || '';
      const item: VocabItem = {
        word: wordKey,
        phonetic,
        meaning,
        sentence: pop.sentence.text,
        time: pop.sentence.start,
        addedAt: Date.now(),
      };
      next = [...vocabItems, item];
      showToast(`已加入生词本：${wordKey}`);
    }
    setVocabItems(next);
    saveJson(`sh_vocab_${videoId}`, next);
  };

  const currentVideoVocab: VideoVocab = useMemo(
    () => ({
      videoId,
      url: videoUrl || `https://www.youtube.com/watch?v=${videoId}`,
      title: videoTitle || videoId,
      items: vocabItems,
    }),
    [videoId, videoUrl, videoTitle, vocabItems],
  );

  // 方式1：通过 Obsidian 官方 URI 直接追加到 languagelearning/生词表
  const handleObsidianUriExport = () => {
    if (!vocabItems.length) {
      showToast('请先点击字幕中的单词并加入生词本');
      return;
    }
    const exportedKey = `sh_exported_${videoId}`;
    const alreadyExported = new Set<string>(loadJson<string[]>(exportedKey, []));
    const newItems = vocabItems.filter((i) => !alreadyExported.has(i.word.toLowerCase()));

    let contentToAppend: string;
    if (alreadyExported.size === 0) {
      contentToAppend = '\n---\n\n' + formatVideoVocabSection(currentVideoVocab);
    } else if (newItems.length > 0) {
      const cleanUrl = currentVideoVocab.url;
      contentToAppend = newItems.map((item) => formatVocabItemBullet(item, cleanUrl)).join('\n') + '\n';
    } else {
      // 全部已导出过，直接打开 Obsidian 生词表
      window.open(OBSIDIAN_OPEN_URI, '_blank');
      showToast('所有生词均已导出，已为您打开 Obsidian 生词表');
      return;
    }

    const allExported = Array.from(new Set([...alreadyExported, ...vocabItems.map((i) => i.word.toLowerCase())]));
    saveJson(exportedKey, allExported);

    const uri = buildObsidianAppendUri(contentToAppend);
    window.open(uri, '_blank');
    showToast(`已通过 Obsidian URI 追加 ${newItems.length || vocabItems.length} 个生词到「languagelearning/生词表」`);
  };

  // 方式2：直接写入本地《生词表.md》并按视频链接原位合并去重
  const handleLocalFileMergeExport = async (forcePick = false) => {
    if (!vocabItems.length) {
      showToast('请先点击字幕中的单词并加入生词本');
      return;
    }
    const res = await writeVocabToLocalObsidianFile(currentVideoVocab, forcePick);
    if (res.ok) {
      showToast(`已按视频链接合并写入 ${res.fileName} 并打开 Obsidian！`);
    } else if (res.error) {
      showToast(res.error);
    }
  };

  // 方式3：复制 Markdown 分割区块并打开 Obsidian 生词表
  const handleCopyAndOpenObsidian = async () => {
    if (!vocabItems.length) {
      showToast('请先点击字幕中的单词并加入生词本');
      return;
    }
    const md = formatVideoVocabSection(currentVideoVocab);
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      // ignore
    }
    window.open(OBSIDIAN_OPEN_URI, '_blank');
    showToast('已复制该视频生词 Markdown 并打开 Obsidian 生词表');
  };

  const sourceBadge = useMemo(() => {
    if (loading) return `获取字幕 ${Math.round(progress.percent)}%`;
    if (!transcript || transcript.sentences.length === 0) return '未检测到字幕';
    if (transcript.source === 'manual+asr') {
      const st = transcript.alignStats;
      return st ? `人工+自动逐词对齐 (修正 ${st.substituted} 词)` : '人工+自动逐词对齐 ✓';
    }
    if (transcript.source === 'asr') return '自动字幕 · 逐词时间 ✓';
    return '人工字幕 · 智能插值';
  }, [transcript, loading, progress.percent]);

  const panelStyle: React.CSSProperties =
    effectiveMode === 'C'
      ? {
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          width: `${sizeC.w}px`,
          height: `${sizeC.h}px`,
          ['--sh-bg-alpha' as any]: opacity,
        }
      : {
          height: `${heightD}px`,
          ['--sh-bg-alpha' as any]: 0.96,
        };

  return (
    <div className="sh-root">
      <div className={`sh-panel ${effectiveMode === 'C' ? 'sh-mode-c' : 'sh-mode-d'}`} style={panelStyle}>
        {/* Header */}
        <div
          className={`sh-header ${effectiveMode === 'C' ? 'sh-draggable' : ''}`}
          onMouseDown={handleHeaderMouseDown}
        >
          <div className="sh-title">
            <span>🗣 口语跟读</span>
            <button
              type="button"
              className={`sh-ver-badge ${updateInfo?.hasUpdate ? 'sh-has-update' : ''}`}
              onClick={() => {
                if (updateInfo?.hasUpdate) {
                  setDrawer('help');
                } else {
                  handleCheckUpdate(false);
                }
              }}
              title={
                updateInfo?.hasUpdate
                  ? `发现 GitHub 新版本 v${updateInfo.latestVersion}！点击查看并下载`
                  : `当前版本 v${currentVersion} · 点击检查 GitHub 新版本`
              }
            >
              {checkingUpdate
                ? '检查中...'
                : updateInfo?.hasUpdate
                  ? `v${currentVersion} → 🆕 v${updateInfo.latestVersion}`
                  : `v${currentVersion}`}
            </button>
            <span className="sh-badge" title="字幕与逐词时间来源">
              {sourceBadge}
            </span>
            {isFullscreen && <span className="sh-badge">全屏自动悬浮 C</span>}
          </div>

          <div className="sh-spacer" />

          <div className="sh-ctrl-group">
            {/* 模式切换：方案 C（悬浮窗） / 方案 D（剧场模式下方） */}
            <button
              className={`sh-btn ${effectiveMode === 'C' ? 'sh-btn-active' : ''}`}
              onClick={() => onModeChange('C')}
              title="方案 C：悬浮可拖动面板（支持调节大小和透明度）"
            >
              悬浮 C
            </button>
            <button
              className={`sh-btn ${effectiveMode === 'D' ? 'sh-btn-active' : ''}`}
              onClick={() => onModeChange('D')}
              disabled={isFullscreen}
              title={isFullscreen ? '全屏状态下固定使用悬浮窗 C' : '方案 D：剧场模式，嵌入视频正下方'}
            >
              剧场 D
            </button>

            <label className="sh-switch" title="开启后显示整句中文翻译（快捷键 T）">
              <span>译文</span>
              <input type="checkbox" checked={showZh} onChange={(e) => setShowZh(e.target.checked)} />
            </label>

            <label className="sh-switch" title="点击句子播放后，读完这一句自动暂停视频（快捷键 P）">
              <span>读完暂停</span>
              <input type="checkbox" checked={autoPause} onChange={(e) => setAutoPause(e.target.checked)} />
            </label>

            <button
              className={`sh-btn ${drawer === 'calibrate' ? 'sh-btn-active' : ''}`}
              onClick={() => setDrawer(drawer === 'calibrate' ? 'none' : 'calibrate')}
              title="用人工字幕/剪藏文本对比校准自动字幕，替换差异词并保留逐词时间"
            >
              🛠 校准{hasCustomManual ? '✓' : ''}
            </button>

            <button
              className={`sh-btn ${drawer === 'help' ? 'sh-btn-active' : ''}`}
              onClick={() => setDrawer(drawer === 'help' ? 'none' : 'help')}
              title="查看快捷键说明"
            >
              ⌨
            </button>

            {onClose && (
              <button className="sh-btn" onClick={onClose} title="隐藏面板（可点击浏览器扩展图标重新打开）">
                ✕
              </button>
            )}
          </div>
        </div>

        {/* 方案 C 专属：透明度滑块 + 快速尺寸预设 */}
        {effectiveMode === 'C' && (
          <div className="sh-subbar">
            <div className="sh-slider-wrap" title="调整悬浮面板背景透明度">
              <span>透明度 {Math.round(opacity * 100)}%</span>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.02}
                value={opacity}
                onChange={(e) => setOpacity( parseFloat(e.target.value) )}
              />
            </div>
            <div className="sh-spacer" />
            <span>窗口大小：</span>
            <button className="sh-btn" onClick={() => setSizeC({ w: 340, h: 380 })}>
              紧凑
            </button>
            <button className="sh-btn" onClick={() => setSizeC({ w: 410, h: 500 })}>
              标准
            </button>
            <button className="sh-btn" onClick={() => setSizeC({ w: 540, h: 600 })}>
              宽屏
            </button>
          </div>
        )}

        {/* 抽屉 1：人工字幕对比校准（问题4） */}
        {drawer === 'calibrate' && (
          <div className="sh-drawer">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <b>🛠 人工字幕 × 自动字幕 逐词对齐校准</b>
              <button className="sh-btn" onClick={() => setDrawer('none')}>
                收起
              </button>
            </div>
            <p style={{ margin: '0 0 6px 0', color: 'var(--sh-muted)' }}>
              当视频同时拥有人工字幕和自动字幕时，插件会自动对比两者：用人工字幕修正识别错误的词（底部虚线标记），同时保留自动字幕的逐词时间戳。如果当前视频只有自动字幕，你也可以在下方粘贴修订后的字幕（支持 Obsidian Clipper 剪藏格式、SRT/VTT 或带时间戳文本）：
            </p>
            <textarea
              className="sh-textarea"
              placeholder={'示例：\n**0:26** · Let me call my boss and we\'ll make that happen.'}
              value={calibInput}
              onChange={(e) => setCalibInput(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button
                className="sh-btn sh-btn-active"
                onClick={() => {
                  if (!calibInput.trim()) return;
                  onApplyCustomManualText(calibInput);
                  showToast('已应用人工字幕校准并保留逐词时间！');
                }}
              >
                立即对比并替换差异词
              </button>
              {hasCustomManual && (
                <button
                  className="sh-btn"
                  onClick={() => {
                    onClearCustomManualText();
                    showToast('已恢复原始字幕');
                  }}
                >
                  恢复原始字幕
                </button>
              )}
            </div>
          </div>
        )}

        {/* 抽屉 2：快捷键帮助（问题6） */}
        {drawer === 'help' && (
          <div className="sh-drawer">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <b>⌨ 交互与快捷键说明</b>
              <button className="sh-btn" onClick={() => setDrawer('none')}>
                收起
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
              <div>
                • <b>单击单词</b>：立即弹出音标与英中释义（0延迟）
              </div>
              <div>
                • <b>单击句子空白处/时间戳</b>：跳转播放该句并读完暂停
              </div>
              <div>
                • <span className="sh-kbd">R</span> 或 <span className="sh-kbd">S</span>：重听当前句
              </div>
              <div>
                • <span className="sh-kbd">A</span> / <span className="sh-kbd">D</span>：上一句 / 下一句
              </div>
              <div>
                • <span className="sh-kbd">P</span> 或 <span className="sh-kbd">Q</span>：开关「读完自动暂停」
              </div>
              <div>
                • <span className="sh-kbd">T</span>：开关「整句中文译文」
              </div>
              <div>
                • <span className="sh-kbd">H</span>：打开 / 临时隐藏跟读窗口
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 10,
                paddingTop: 8,
                borderTop: '1px solid var(--sh-border)',
                flexWrap: 'wrap',
              }}
            >
              <span>
                当前版本：<b>v{currentVersion}</b>
                {updateInfo && (
                  <span style={{ color: updateInfo.hasUpdate ? 'var(--sh-success)' : 'var(--sh-muted)', marginLeft: 8 }}>
                    {updateInfo.hasUpdate
                      ? `发现 GitHub 新版本 v${updateInfo.latestVersion}`
                      : `（已是 GitHub 最新版 v${updateInfo.latestVersion}）`}
                  </span>
                )}
              </span>
              <div className="sh-spacer" />
              <button className="sh-btn" onClick={() => handleCheckUpdate(false)} disabled={checkingUpdate}>
                {checkingUpdate ? '正在检查...' : '🔄 检查 GitHub 新版本'}
              </button>
              {updateInfo?.hasUpdate && (
                <button
                  className="sh-btn sh-btn-active"
                  onClick={() => window.open(updateInfo.downloadUrl, '_blank')}
                >
                  ⬇ 下载 v{updateInfo.latestVersion}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 抽屉 3：生词本与导出到 Obsidian（A10） */}
        {drawer === 'vocab' && (
          <div className="sh-drawer">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <b>
                📓 本视频生词 ({vocabItems.length}) · 导出至 codex-obsidian/languagelearning/生词表
              </b>
              <button className="sh-btn" onClick={() => setDrawer('none')}>
                收起
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              <button className="sh-btn sh-btn-active" onClick={handleObsidianUriExport}>
                ⚡ URI 一键追加到 Obsidian 生词表
              </button>
              <button
                className="sh-btn"
                onClick={() => handleLocalFileMergeExport(false)}
                title="选择 E:\CODEX\codex-obsidian\languagelearning\生词表.md 后，按视频原链接自动合并去重"
              >
                📂 写入本地《生词表.md》(按视频链接合并)
              </button>
              <button className="sh-btn" onClick={handleCopyAndOpenObsidian}>
                📋 复制 Markdown 并打开 Obsidian
              </button>
            </div>
            {vocabItems.length === 0 ? (
              <div style={{ color: 'var(--sh-muted)' }}>还没有收藏生词。单击字幕中的任意单词即可加入生词本。</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {vocabItems.map((item) => (
                  <div
                    key={item.word}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 6px',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.04)',
                    }}
                  >
                    <b style={{ color: '#fff' }}>{item.word}</b>
                    {item.phonetic && <span style={{ color: 'var(--sh-accent)' }}>{item.phonetic}</span>}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.meaning}
                    </span>
                    <span style={{ color: 'var(--sh-muted)', fontSize: 11 }}>{formatTimestamp(item.time)}</span>
                    <button
                      className="sh-btn"
                      onClick={() => {
                        const next = vocabItems.filter((x) => x.word !== item.word);
                        setVocabItems(next);
                        saveJson(`sh_vocab_${videoId}`, next);
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 句子列表主体 */}
        <div className="sh-list" ref={listRef} onScroll={() => setPopover(null)}>
          {loading ? (
            <div className="sh-state-box">
              <div className="sh-progress-wrap">
                <div className="sh-progress-head">
                  <span>正在获取视频字幕</span>
                  <span style={{ color: 'var(--sh-accent)', fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(progress.percent)}%
                  </span>
                </div>
                <div className="sh-progress-bar">
                  <div
                    className="sh-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(5, progress.percent))}%` }}
                  />
                </div>
                <div className="sh-progress-detail">{progress.detail}</div>
              </div>
            </div>
          ) : !transcript || transcript.sentences.length === 0 ? (
            <div className="sh-state-box">
              <div style={{ color: 'var(--sh-text)', fontWeight: 600 }}>当前视频没有检测到可用字幕。</div>
              {failReason && <div style={{ fontSize: 12, maxWidth: 340, lineHeight: 1.5 }}>{failReason}</div>}
              <button className="sh-btn sh-btn-active" onClick={onRetryCaptions}>
                🔄 重新尝试获取字幕
              </button>
            </div>
          ) : (
            <>
              <div className="sh-list-spacer" />
              {transcript.sentences.map((sent, idx) => {
                const isActive = idx === activeIdx;
                const zh = zhMap[sent.id];
                return (
                  <div
                    key={sent.id}
                    data-sent-idx={idx}
                    className={`sh-sent-row ${isActive ? 'sh-active' : ''}`}
                    onClick={() => playSentence(sent, idx)}
                    title="点击空白处或时间戳跳转到此句开头播放"
                  >
                    <div className="sh-time-col">
                      <span className="sh-play-icon">{isActive ? '▶' : '•'}</span>
                      <span>{formatTimestamp(sent.start)}</span>
                    </div>
                    <div className="sh-sent-body">
                      <div className="sh-words-line">
                        {sent.words.map((w, wIdx) => (
                          <React.Fragment key={wIdx}>
                            <span
                              className={`sh-word ${w.asrText ? 'sh-corrected' : ''}`}
                              onClick={(e) => handleWordClick(e, w, sent)}
                              title={
                                w.asrText
                                  ? `已用人工字幕替换（自动字幕原词: "${w.asrText}"）· 单击查词`
                                  : '单击翻译该词'
                              }
                            >
                              {w.text}
                            </span>
                            {wIdx < sent.words.length - 1 ? ' ' : ''}
                          </React.Fragment>
                        ))}
                      </div>
                      {showZh && (
                        <div className="sh-zh-line">
                          {zh || (zhLoading ? '正在翻译句子...' : '')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="sh-list-spacer" />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sh-footer">
          <span>
            单击<b>单词</b>=查词 · 单击<b>空白处</b>=切句跟读 · <span className="sh-kbd">R</span>重播{' '}
            <span className="sh-kbd">A</span>/<span className="sh-kbd">D</span>上下句{' '}
            <span className="sh-kbd">H</span>隐藏/打开
          </span>
          <div className="sh-spacer" />
          <button
            className={`sh-btn ${drawer === 'vocab' ? 'sh-btn-active' : ''}`}
            onClick={() => setDrawer(drawer === 'vocab' ? 'none' : 'vocab')}
          >
            📓 生词本 ({vocabItems.length})
          </button>
          <button
            className="sh-btn sh-btn-active"
            onClick={handleObsidianUriExport}
            title="按视频原链接分割，导出到 obsidian://open?vault=codex-obsidian&file=languagelearning%2F%E7%94%9F%E8%AF%8D%E8%A1%A8"
          >
            ↗ 导出 Obsidian
          </button>
        </div>

        {/* 窗口尺寸拖拽手柄 */}
        {effectiveMode === 'C' && (
          <>
            <div className="sh-resize-r" onMouseDown={startResize('r')} />
            <div className="sh-resize-b" onMouseDown={startResize('b')} />
            <div className="sh-resize-br" onMouseDown={startResize('br')} title="拖动调整窗口大小">
              ◢
            </div>
          </>
        )}
        {effectiveMode === 'D' && (
          <div className="sh-resize-b" onMouseDown={startResize('b')} title="上下拖动调整面板高度" />
        )}
      </div>

      {/* 单词翻译悬浮气泡 */}
      {popover && (
        <div
          className="sh-popover"
          style={{ left: `${popover.rect.left}px`, top: `${popover.rect.top}px` }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="sh-pop-head">
            <span className="sh-pop-word">{popover.cleaned}</span>
            {popover.offline?.phonetic && <span className="sh-pop-phon">{popover.offline.phonetic}</span>}
            {popover.offline?.lemma && popover.offline.lemma !== popover.cleaned && (
              <span style={{ fontSize: 11, color: 'var(--sh-muted)' }}>({popover.offline.lemma})</span>
            )}
            <div className="sh-spacer" />
            <button
              className="sh-btn"
              onClick={() => {
                try {
                  const u = new SpeechSynthesisUtterance(popover.cleaned);
                  u.lang = 'en-US';
                  speechSynthesis.cancel();
                  speechSynthesis.speak(u);
                } catch {
                  // ignore
                }
              }}
              title="朗读单词发音"
            >
              🔊
            </button>
            <button className="sh-btn" onClick={() => setPopover(null)}>
              ✕
            </button>
          </div>

          {popover.offline ? (
            <div style={{ lineHeight: 1.55 }}>
              <span className="sh-pop-tag">ECDICT</span>
              <span>{popover.offline.translation}</span>
            </div>
          ) : (
            <div style={{ color: 'var(--sh-muted)', fontSize: 12 }}>本地词典未收录该词形，已查询在线翻译：</div>
          )}

          <div className="sh-pop-sec">
            <span className="sh-pop-tag">
              {popover.onlineProvider === 'edge' ? 'Bing/Edge' : '在线翻译'}
            </span>
            {popover.onlineLoading ? (
              <span style={{ color: 'var(--sh-muted)' }}>查询中...</span>
            ) : (
              <span>{popover.onlineWord || '—'}</span>
            )}
            {popover.onlineSentence && (
              <div style={{ marginTop: 4, color: 'var(--sh-muted)', fontSize: 11.5 }}>
                句意：{popover.onlineSentence}
              </div>
            )}
          </div>

          <div className="sh-pop-sec" style={{ display: 'flex', gap: 6 }}>
            <button
              className={`sh-btn ${isWordInVocab(popover.offline?.lemma || popover.cleaned) ? '' : 'sh-btn-active'}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => toggleVocabWord(popover)}
            >
              {isWordInVocab(popover.offline?.lemma || popover.cleaned) ? '✓ 已在生词本 (点击移除)' : '＋ 加入生词本'}
            </button>
          </div>
        </div>
      )}

      {toastMsg && <div className="sh-toast">{toastMsg}</div>}
    </div>
  );
};
