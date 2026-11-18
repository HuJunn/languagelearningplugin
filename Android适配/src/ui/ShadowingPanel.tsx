import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompactDict } from '../core/dict';
import { cleanWord, lookupOfflineDict } from '../core/dict';
import {
  buildObsidianAppendUri,
  formatTimestamp,
  formatVideoVocabSection,
  formatVocabTableRow,
  OBSIDIAN_OPEN_URI,
} from '../core/obsidian';
import {
  supportsLocalObsidianFileAccess,
  writeVocabToLocalObsidianFile,
} from '../core/file-handle';
import {
  DisplaySentence,
  findSentenceAt,
  findSentenceBefore,
  mergeAdjacentSentences,
} from '../core/segment';
import { translateSentencesBatch, translateWordOnline } from '../core/translate';
import type { UpdateCheckResult } from '../core/version';
import type { DictEntry, Sentence, Transcript, VideoBookmark, VideoVocab, VocabItem, Word } from '../core/types';

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
  visible?: boolean;
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

const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5] as const;

interface LongPressGestureOpts {
  el: HTMLElement;
  holdMs?: number;
  onActivate: (cx: number, cy: number) => void;
  onMove: (cx: number, cy: number) => void;
  onEnd: () => void;
}

/**
 * 原生 non-passive + window 捕获阶段长按拖拽手势适配器：
 * 绕过外层容器 stopPropagation()，并防止 Android 浏览器触发页面滚动或长按文本菜单。
 */
function attachLongPressGesture({ el, holdMs = 260, onActivate, onMove, onEnd }: LongPressGestureOpts): () => void {
  let pressTimer: number | null = null;
  let active = false;
  let pointerMode: 'touch' | 'mouse' | null = null;
  let lastTouchAt = 0;
  let startX = 0;
  let startY = 0;
  let curX = 0;
  let curY = 0;

  const clearTimer = () => {
    if (pressTimer !== null) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  const reset = () => {
    clearTimer();
    if (active) {
      active = false;
      onEnd();
    }
    pointerMode = null;
  };

  const onTouchStart = (e: TouchEvent) => {
    lastTouchAt = Date.now();
    if (e.touches.length !== 1) {
      reset();
      return;
    }
    const t = e.touches[0];
    clearTimer();
    pointerMode = 'touch';
    startX = t.clientX;
    startY = t.clientY;
    curX = t.clientX;
    curY = t.clientY;
    e.stopPropagation();
    pressTimer = window.setTimeout(() => {
      pressTimer = null;
      if (pointerMode === 'touch') {
        active = true;
        onActivate(curX, curY);
        try {
          navigator.vibrate?.(16);
        } catch {
          // ignore
        }
      }
    }, holdMs);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (pointerMode !== 'touch' || !e.touches[0]) return;
    lastTouchAt = Date.now();
    const t = e.touches[0];
    curX = t.clientX;
    curY = t.clientY;
    if (!active) {
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > 18) {
        clearTimer();
      }
      return;
    }
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    onMove(t.clientX, t.clientY);
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (pointerMode !== 'touch') return;
    lastTouchAt = Date.now();
    if (active && e.cancelable) e.preventDefault();
    reset();
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 || Date.now() - lastTouchAt < 700) return;
    clearTimer();
    pointerMode = 'mouse';
    startX = e.clientX;
    startY = e.clientY;
    curX = e.clientX;
    curY = e.clientY;
    e.preventDefault();
    pressTimer = window.setTimeout(() => {
      pressTimer = null;
      if (pointerMode === 'mouse') {
        active = true;
        onActivate(curX, curY);
      }
    }, holdMs);
  };

  const onMouseMove = (e: MouseEvent) => {
    if (pointerMode !== 'mouse') return;
    curX = e.clientX;
    curY = e.clientY;
    if (!active) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 18) {
        clearTimer();
      }
      return;
    }
    onMove(e.clientX, e.clientY);
  };

  const onMouseUp = () => {
    if (pointerMode !== 'mouse') return;
    reset();
  };

  const onContextMenu = (e: Event) => {
    e.preventDefault();
  };

  el.addEventListener('touchstart', onTouchStart, { passive: false });
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('touchend', onTouchEnd, { passive: false });
  el.addEventListener('touchcancel', onTouchEnd, { passive: false });
  el.addEventListener('contextmenu', onContextMenu);
  el.addEventListener('mousedown', onMouseDown);
  window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  window.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
  window.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: false });
  window.addEventListener('mousemove', onMouseMove, { capture: true });
  window.addEventListener('mouseup', onMouseUp, { capture: true });

  return () => {
    clearTimer();
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchEnd);
    el.removeEventListener('contextmenu', onContextMenu);
    el.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('touchmove', onTouchMove, true);
    window.removeEventListener('touchend', onTouchEnd, true);
    window.removeEventListener('touchcancel', onTouchEnd, true);
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
  };
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
  visible = true,
  onClose,
}) => {
  // 全屏时自动切换为 C（悬浮模式），退出全屏后自动恢复用户选择的 mode
  const effectiveMode: 'C' | 'D' = isFullscreen ? 'C' : mode;

  const [autoPause, setAutoPause] = useState<boolean>(() => loadJson('sh_auto_pause', true));
  const [showZh, setShowZh] = useState<boolean>(() => loadJson('sh_show_zh', false));
  const [opacity, setOpacity] = useState<number>(() => loadJson('sh_opacity', 0.92));
  const [pos, setPos] = useState<{ x: number; y: number }>(() =>
    loadJson('sh_pos_c', { x: Math.max(12, window.innerWidth - 360), y: 72 }),
  );
  const [sizeC, setSizeC] = useState<{ w: number; h: number }>(() => {
    const defaultSize =
      window.innerWidth <= 680
        ? {
            w: Math.max(260, Math.min(340, window.innerWidth - 32)),
            h: Math.max(280, Math.min(400, Math.round(window.innerHeight * 0.48))),
          }
        : { w: 390, h: 480 };
    return loadJson('sh_size_c', defaultSize);
  });
  const [heightD, setHeightD] = useState<number>(() => loadJson('sh_height_d', 320));
  const [isDraggingTitle, setIsDraggingTitle] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [dragFloatOverride, setDragFloatOverride] = useState<boolean>(false);

  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [zhMap, setZhMap] = useState<Record<number, string>>({});
  const [zhLoading, setZhLoading] = useState<boolean>(false);

  const [drawer, setDrawer] = useState<'none' | 'vocab' | 'calibrate' | 'help' | 'bookmarks'>('none');
  const [calibInput, setCalibInput] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [gamepadConnected, setGamepadConnected] = useState<boolean>(false);

  const currentVersion = useMemo(() => {
    try {
      return chrome?.runtime?.getManifest?.()?.version || '0.1.7';
    } catch {
      return '0.1.7';
    }
  }, []);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);

  const videoId = transcript?.videoId || 'default';
  const [vocabItems, setVocabItems] = useState<VocabItem[]>(() => loadJson(`sh_vocab_${videoId}`, []));
  const [bookmarks, setBookmarks] = useState<VideoBookmark[]>(() => loadJson(`sh_bookmarks_${videoId}`, []));
  const [mergeNextIds, setMergeNextIds] = useState<number[]>(() => loadJson(`sh_merges_${videoId}`, []));
  const [connectMode, setConnectMode] = useState<boolean>(false);
  const [connectFirstIdx, setConnectFirstIdx] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(() => {
    const saved = loadJson<number>('sh_playback_rate', 1);
    return (SPEED_STEPS as readonly number[]).includes(saved) ? saved : 1;
  });

  const displaySentences: DisplaySentence[] = useMemo(
    () => mergeAdjacentSentences(transcript?.sentences ?? [], mergeNextIds),
    [transcript, mergeNextIds],
  );

  useEffect(() => {
    setVocabItems(loadJson(`sh_vocab_${videoId}`, []));
    setBookmarks(loadJson(`sh_bookmarks_${videoId}`, []));
    setMergeNextIds(loadJson(`sh_merges_${videoId}`, []));
    setConnectMode(false);
    setConnectFirstIdx(null);
    setZhMap(loadJson(`sh_zh_${videoId}`, {}));
    setActiveIdx(-1);
    setPopover(null);
  }, [videoId]);

  useEffect(() => saveJson('sh_playback_rate', playbackRate), [playbackRate]);

  useEffect(() => saveJson('sh_auto_pause', autoPause), [autoPause]);
  useEffect(() => saveJson('sh_show_zh', showZh), [showZh]);
  useEffect(() => saveJson('sh_opacity', opacity), [opacity]);
  useEffect(() => saveJson('sh_pos_c', pos), [pos]);
  useEffect(() => saveJson('sh_size_c', sizeC), [sizeC]);
  useEffect(() => saveJson('sh_height_d', heightD), [heightD]);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragHandleRef = useRef<HTMLSpanElement | null>(null);
  const resizeRRef = useRef<HTMLDivElement | null>(null);
  const resizeBRef = useRef<HTMLDivElement | null>(null);
  const resizeBrRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const sizeCRef = useRef(sizeC);
  sizeCRef.current = sizeC;
  const heightDRef = useRef(heightD);
  heightDRef.current = heightD;
  const effectiveModeRef = useRef(effectiveMode);
  effectiveModeRef.current = effectiveMode;
  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;
  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;
  const stopTargetRef = useRef<{ idx: number; time: number } | null>(null);
  const autoPausedIdxRef = useRef<number | null>(null);
  const lastCompletedIdxRef = useRef<number | null>(null);
  const pinnedIdxRef = useRef<number | null>(null);
  const activeIdxRef = useRef<number>(-1);
  const autoPauseRef = useRef<boolean>(autoPause);
  autoPauseRef.current = autoPause;
  const playbackRateRef = useRef<number>(playbackRate);
  playbackRateRef.current = playbackRate;
  const lastUriNoopAtRef = useRef<number>(0);

  // 将倍速实时同步到 YouTube 播放器 <video>
  useEffect(() => {
    const v = getVideoElement();
    if (v && Math.abs(v.playbackRate - playbackRate) > 0.01) {
      v.playbackRate = playbackRate;
    }
  }, [playbackRate, videoId, transcript, getVideoElement]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2800);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const handleCheckUpdate = useCallback(async () => {
    if (checkingUpdate) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      showToast(`当前版本 v${currentVersion}`);
      return;
    }
    setCheckingUpdate(true);
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
        if (info.hasUpdate) {
          showToast(`发现新版本 v${info.latestVersion}，正在跳转下载链接...`);
          window.open(info.downloadUrl, '_blank');
        } else {
          showToast(`当前已经是最新版本 v${info.currentVersion}`);
        }
      } else {
        showToast('检查更新失败，请确认可访问 GitHub');
      }
    } catch {
      showToast('检查更新失败，请确认可访问 GitHub');
    } finally {
      setCheckingUpdate(false);
    }
  }, [checkingUpdate, currentVersion, showToast]);

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
      // 首句开头自适应预卷：有停顿时提前 220ms，紧邻上一句时提前 140ms~220ms，抵消 ASR 延迟与播放器 seek 起音淡入，防止开头吞字
      const firstWordStart = sent.words[0]?.start ?? sent.start;
      const prevSent = index > 0 ? displaySentences[index - 1] : undefined;
      const prevWordEnd = prevSent?.words[prevSent.words.length - 1]?.end ?? 0;
      const gapFromPrev = prevSent ? firstWordStart - prevWordEnd : 1;
      const preRoll = gapFromPrev >= 0.22 ? 0.22 : Math.max(0.14, Math.min(0.22, gapFromPrev + 0.08));
      if (Math.abs(video.playbackRate - playbackRateRef.current) > 0.01) {
        video.playbackRate = playbackRateRef.current;
      }
      video.currentTime = Math.max(0, firstWordStart - preRoll);
      video.play().catch(() => {});
      setActiveIdx(index);
      activeIdxRef.current = index;
      centerSentenceInList(index, true);
    },
    [getVideoElement, centerSentenceInList, displaySentences],
  );

  // 60fps 歌词级逐词渐变同步 & 读完本句自动暂停
  useEffect(() => {
    const sentences = displaySentences;
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
          t >= sentences[pinnedIdxRef.current].start - 0.35 &&
          t < sentences[pinnedIdxRef.current].start
        ) {
          // 处于跳句开头的预卷区间时，保持锁定在目标句
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
  }, [displaySentences, getVideoElement]);

  // 整句译文开关打开时，批量翻译当前视频的所有句子（已有自带中文字幕的句子直接复用，无需在线翻译）
  useEffect(() => {
    if (!showZh || !transcript?.sentences.length) return;
    const sentences = transcript.sentences;
    const missing = sentences.filter((s) => !s.builtInZh && !zhMap[s.id]);
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
                onlineSentence: sentence.builtInZh || res?.sentenceTranslation,
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

  // 标记当前字幕位置（支持同一视频多条记录点）
  const handleAddBookmark = useCallback(() => {
    const video = getVideoElement();
    const curT = video?.currentTime ?? 0;
    const sentences = displaySentences;
    const idx =
      pinnedIdxRef.current != null
        ? pinnedIdxRef.current
        : activeIdxRef.current >= 0
          ? activeIdxRef.current
          : sentences.length
            ? findSentenceBefore(sentences, curT)
            : -1;
    const sent = idx >= 0 ? sentences[idx] : undefined;
    const markTime = sent ? sent.start : curT;
    const entry: VideoBookmark = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: markTime,
      ...(idx >= 0 ? { sentIdx: idx } : {}),
      text: sent?.text || `时间点 ${formatTimestamp(markTime)}`,
      ...(sent && (sent.builtInZh || zhMap[sent.id]) ? { zh: sent.builtInZh || zhMap[sent.id] } : {}),
      createdAt: Date.now(),
    };
    setBookmarks((prev) => {
      const next = [...prev, entry].sort((a, b) => a.time - b.time);
      saveJson(`sh_bookmarks_${videoId}`, next);
      showToast(`已标记字幕位置 ${formatTimestamp(markTime)}（共 ${next.length} 个记录点）`);
      return next;
    });
  }, [getVideoElement, displaySentences, zhMap, videoId, showToast]);

  const handleJumpBookmark = useCallback(
    (bm: VideoBookmark) => {
      const sentences = displaySentences;
      let targetIdx = -1;
      if (bm.sentIdx != null && sentences[bm.sentIdx] && Math.abs(sentences[bm.sentIdx].start - bm.time) < 2) {
        targetIdx = bm.sentIdx;
      } else if (sentences.length > 0) {
        const byStart = sentences.findIndex((s) => Math.abs(s.start - bm.time) < 1.2);
        targetIdx = byStart >= 0 ? byStart : Math.max(0, findSentenceBefore(sentences, bm.time));
      }
      if (targetIdx >= 0 && sentences[targetIdx]) {
        playSentence(sentences[targetIdx], targetIdx);
      } else {
        const video = getVideoElement();
        if (video) {
          video.currentTime = Math.max(0, bm.time);
          video.play().catch(() => {});
        }
      }
      showToast(`已跳转到标记点 ${formatTimestamp(bm.time)}`);
    },
    [displaySentences, playSentence, getVideoElement, showToast],
  );

  const handleRemoveBookmark = useCallback(
    (id: string) => {
      setBookmarks((prev) => {
        const next = prev.filter((b) => b.id !== id);
        saveJson(`sh_bookmarks_${videoId}`, next);
        return next;
      });
    },
    [videoId],
  );

  const handleClearBookmarks = useCallback(() => {
    setBookmarks([]);
    saveJson(`sh_bookmarks_${videoId}`, []);
    showToast('已清空本视频全部标记点');
  }, [videoId, showToast]);

  const latestBookmarkId = useMemo(() => {
    let best: VideoBookmark | null = null;
    for (const bm of bookmarks) {
      if (!best || bm.createdAt > best.createdAt) best = bm;
    }
    return best?.id ?? '';
  }, [bookmarks]);

  const stepPlaybackRate = useCallback(
    (delta: -1 | 1) => {
      setPlaybackRate((cur) => {
        const curIdx = SPEED_STEPS.findIndex((s) => Math.abs(s - cur) < 0.01);
        const safeIdx = curIdx >= 0 ? curIdx : 2;
        const nextIdx = Math.max(0, Math.min(SPEED_STEPS.length - 1, safeIdx + delta));
        const next = SPEED_STEPS[nextIdx];
        if (nextIdx === safeIdx) {
          showToast(delta < 0 ? `已达最低倍速 ${next}x` : `已达最高倍速 ${next}x`);
        } else {
          showToast(`播放倍速：${next}x`);
        }
        return next;
      });
    },
    [showToast],
  );

  const handleToggleConnectMode = useCallback(() => {
    setConnectMode((prev) => {
      const next = !prev;
      setConnectFirstIdx(null);
      if (next) {
        showToast('连接模式已开启：请依次点击两个相邻句子');
      } else {
        showToast('已退出连接模式');
      }
      return next;
    });
  }, [showToast]);

  const handleSelectForConnect = useCallback(
    (idx: number) => {
      if (connectFirstIdx === null) {
        setConnectFirstIdx(idx);
        const target = displaySentences[idx];
        showToast(`已选中第 1 句 (${target ? formatTimestamp(target.start) : ''})，请点击紧邻的上一句或下一句`);
        return;
      }
      if (connectFirstIdx === idx) {
        setConnectFirstIdx(null);
        showToast('已取消选中，请重新点击第 1 个句子');
        return;
      }
      if (Math.abs(idx - connectFirstIdx) !== 1) {
        showToast('⚠️ 只能连接相邻的两个句子！请重新选择紧邻的句子');
        return;
      }
      const loIdx = Math.min(connectFirstIdx, idx);
      const loSent = displaySentences[loIdx];
      const hiSent = displaySentences[loIdx + 1];
      if (!loSent || !hiSent) return;
      const linkId = loSent.baseIds[loSent.baseIds.length - 1];
      setMergeNextIds((prev) => {
        const next = prev.includes(linkId) ? prev : [...prev, linkId];
        saveJson(`sh_merges_${videoId}`, next);
        return next;
      });
      stopTargetRef.current = null;
      pinnedIdxRef.current = null;
      setConnectMode(false);
      setConnectFirstIdx(null);
      showToast(`已连接两个相邻句子（时间起点 ${formatTimestamp(loSent.start)}）`);
    },
    [connectFirstIdx, displaySentences, videoId, showToast],
  );

  const handleUnmergeSentence = useCallback(
    (sent: DisplaySentence) => {
      const linksToRemove = new Set(sent.baseIds.slice(0, -1));
      setMergeNextIds((prev) => {
        const next = prev.filter((id) => !linksToRemove.has(id));
        saveJson(`sh_merges_${videoId}`, next);
        return next;
      });
      stopTargetRef.current = null;
      pinnedIdxRef.current = null;
      showToast('已取消句子连接');
    },
    [videoId, showToast],
  );

  const bookmarkedSentIndices = useMemo(() => {
    const set = new Set<number>();
    const sentences = displaySentences;
    if (!sentences.length || !bookmarks.length) return set;
    for (const bm of bookmarks) {
      if (bm.sentIdx != null && sentences[bm.sentIdx] && Math.abs(sentences[bm.sentIdx].start - bm.time) < 2) {
        set.add(bm.sentIdx);
      } else {
        const idx = sentences.findIndex((s) => Math.abs(s.start - bm.time) < 1.2);
        if (idx >= 0) set.add(idx);
      }
    }
    return set;
  }, [displaySentences, bookmarks]);

  // 快捷键支持（在 H 隐藏模式下也全程保持生效）
  useEffect(() => {
    const sentences = displaySentences;

    const onKeyDown = (e: KeyboardEvent) => {
      const path = e.composedPath?.() ?? [];
      for (const node of path) {
        if (
          node instanceof HTMLElement &&
          (node.tagName === 'INPUT' ||
            node.tagName === 'TEXTAREA' ||
            node.tagName === 'SELECT' ||
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
            : sentences.length
              ? Math.max(0, findSentenceBefore(sentences, curT))
              : 0;

      const key = e.key.toLowerCase();
      if ((key === 'r' || key === 's') && sentences.length) {
        e.preventDefault();
        e.stopPropagation();
        const target = sentences[Math.max(0, curIdx)];
        if (target) playSentence(target, Math.max(0, curIdx));
      } else if ((key === 'a' || (e.key === 'ArrowLeft' && e.shiftKey)) && sentences.length) {
        e.preventDefault();
        e.stopPropagation();
        const prevIdx = Math.max(0, curIdx - 1);
        if (sentences[prevIdx]) playSentence(sentences[prevIdx], prevIdx);
      } else if ((key === 'd' || (e.key === 'ArrowRight' && e.shiftKey)) && sentences.length) {
        e.preventDefault();
        e.stopPropagation();
        const nextIdx = Math.min(sentences.length - 1, curIdx + 1);
        if (sentences[nextIdx]) playSentence(sentences[nextIdx], nextIdx);
      } else if (key === 'p' || key === 'q') {
        e.preventDefault();
        e.stopPropagation();
        setAutoPause((v) => {
          showToast(`读完自动暂停：${!v ? '已开启' : '已关闭'}`);
          return !v;
        });
      } else if (key === 't') {
        e.preventDefault();
        e.stopPropagation();
        setShowZh((v) => {
          showToast(`整句译文：${!v ? '已开启' : '已关闭'}`);
          return !v;
        });
      } else if (key === 'm') {
        e.preventDefault();
        e.stopPropagation();
        handleAddBookmark();
      } else if (e.key === '[' || (!e.shiftKey && e.code === 'BracketLeft')) {
        e.preventDefault();
        e.stopPropagation();
        stepPlaybackRate(-1);
      } else if (e.key === ']' || (!e.shiftKey && e.code === 'BracketRight')) {
        e.preventDefault();
        e.stopPropagation();
        stepPlaybackRate(1);
      } else if (e.key === 'Escape' && connectMode) {
        e.preventDefault();
        e.stopPropagation();
        setConnectMode(false);
        setConnectFirstIdx(null);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [displaySentences, getVideoElement, playSentence, showToast, handleAddBookmark, stepPlaybackRate, connectMode]);

  // 蓝牙手柄 (Web Gamepad API) 轮询支持：兼容 Xbox / Switch Joy-Con / 八位堂等蓝牙手柄
  useEffect(() => {
    const sentences = displaySentences;
    let prevMask = 0;
    let lastActionAt = 0;

    const pollGamepad = () => {
      try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let activePad: Gamepad | null = null;
        for (const p of pads) {
          if (p && p.connected) {
            activePad = p;
            break;
          }
        }
        setGamepadConnected(Boolean(activePad));
        if (!activePad || !sentences.length) return;

        const b = activePad.buttons;
        const ax0 = activePad.axes?.[0] ?? 0;
        const ax1 = activePad.axes?.[1] ?? 0;

        const repeatPressed = Boolean(b[0]?.pressed || b[7]?.pressed); // A / R2 -> 重读当前句
        const togglePlayPressed = Boolean(b[1]?.pressed || b[9]?.pressed); // B / Start -> 播放/暂停
        const prevPressed = Boolean(
          b[14]?.pressed || b[12]?.pressed || b[4]?.pressed || ax0 < -0.65 || ax1 < -0.65,
        ); // 左/上/L1/摇杆左或上 -> 上一句
        const nextPressed = Boolean(
          b[15]?.pressed || b[13]?.pressed || b[5]?.pressed || ax0 > 0.65 || ax1 > 0.65,
        ); // 右/下/R1/摇杆右或下 -> 下一句
        const zhPressed = Boolean(b[2]?.pressed); // X -> 译文开关
        const apPressed = Boolean(b[3]?.pressed); // Y -> 读完暂停开关

        const mask =
          (repeatPressed ? 1 : 0) |
          (togglePlayPressed ? 2 : 0) |
          (prevPressed ? 4 : 0) |
          (nextPressed ? 8 : 0) |
          (zhPressed ? 16 : 0) |
          (apPressed ? 32 : 0);

        const rising = mask & ~prevMask;
        prevMask = mask;
        const now = Date.now();
        if (!rising || now - lastActionAt < 160) return;
        lastActionAt = now;

        const video = getVideoElement();
        const curT = video?.currentTime ?? 0;
        const curIdx =
          pinnedIdxRef.current != null
            ? pinnedIdxRef.current
            : activeIdxRef.current >= 0
              ? activeIdxRef.current
              : Math.max(0, findSentenceBefore(sentences, curT));

        if (rising & 1) {
          const target = sentences[Math.max(0, curIdx)];
          if (target) playSentence(target, Math.max(0, curIdx));
        } else if (rising & 2) {
          if (video) {
            if (video.paused) video.play().catch(() => {});
            else video.pause();
          }
        } else if (rising & 4) {
          const prevIdx = Math.max(0, curIdx - 1);
          if (sentences[prevIdx]) playSentence(sentences[prevIdx], prevIdx);
        } else if (rising & 8) {
          const nextIdx = Math.min(sentences.length - 1, curIdx + 1);
          if (sentences[nextIdx]) playSentence(sentences[nextIdx], nextIdx);
        } else if (rising & 16) {
          setShowZh((v) => {
            showToast(`整句译文：${!v ? '已开启' : '已关闭'}`);
            return !v;
          });
        } else if (rising & 32) {
          setAutoPause((v) => {
            showToast(`读完自动暂停：${!v ? '已开启' : '已关闭'}`);
            return !v;
          });
        }
      } catch {
        // ignore
      }
    };

    const timer = window.setInterval(pollGamepad, 45);
    return () => clearInterval(timer);
  }, [displaySentences, getVideoElement, playSentence, showToast]);

  // 仅允许长按「🗣 口语跟读」UI 拖动面板（复用原生 non-passive + capture 长按手势）
  useEffect(() => {
    const handleEl = dragHandleRef.current;
    if (!handleEl) return;

    let deferredSwitchToC = false;
    let offsetX = 0;
    let offsetY = 0;

    return attachLongPressGesture({
      el: handleEl,
      onActivate: (cx, cy) => {
        const rect = panelRef.current?.getBoundingClientRect();
        const actualW = rect?.width || Math.min(sizeCRef.current.w, Math.max(240, window.innerWidth - 12));
        const basePos = rect
          ? {
              x: Math.max(6, Math.min(Math.max(6, window.innerWidth - actualW - 6), rect.left)),
              y: Math.max(6, Math.min(Math.max(6, window.innerHeight - 64), rect.top)),
            }
          : posRef.current;
        if (effectiveModeRef.current === 'D' && !isFullscreenRef.current) {
          deferredSwitchToC = true;
          setDragFloatOverride(true);
        }
        setPos(basePos);
        offsetX = cx - basePos.x;
        offsetY = cy - basePos.y;
        setIsDraggingTitle(true);
      },
      onMove: (cx, cy) => {
        const actualW = panelRef.current?.offsetWidth || Math.min(sizeCRef.current.w, window.innerWidth - 12);
        const maxX = Math.max(6, window.innerWidth - actualW - 6);
        const maxY = Math.max(6, window.innerHeight - 64);
        setPos({
          x: Math.max(6, Math.min(maxX, cx - offsetX)),
          y: Math.max(6, Math.min(maxY, cy - offsetY)),
        });
      },
      onEnd: () => {
        setIsDraggingTitle(false);
        if (deferredSwitchToC) {
          deferredSwitchToC = false;
          setDragFloatOverride(false);
          onModeChangeRef.current('C');
        }
      },
    });
  }, []);

  // Mode C & D 长按调整窗口大小（与「🗣 口语跟读」保持完全一致的长按拖拽适配）
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const bindResize = (el: HTMLElement | null, dir: 'r' | 'b' | 'br') => {
      if (!el) return;
      let startX = 0;
      let startY = 0;
      let initW = 390;
      let initH = 480;

      cleanups.push(
        attachLongPressGesture({
          el,
          onActivate: (cx, cy) => {
            startX = cx;
            startY = cy;
            const rect = panelRef.current?.getBoundingClientRect();
            initW = rect?.width || sizeCRef.current.w;
            initH = rect?.height || (effectiveModeRef.current === 'D' ? heightDRef.current : sizeCRef.current.h);
            setIsResizing(true);
          },
          onMove: (cx, cy) => {
            const dx = cx - startX;
            const dy = cy - startY;
            if (effectiveModeRef.current === 'D' && !isFullscreenRef.current) {
              setHeightD(Math.max(180, Math.min(760, Math.round(initH + dy))));
              return;
            }
            const curX = posRef.current.x;
            const maxAllowedW = Math.max(240, window.innerWidth - Math.max(6, curX) - 6);
            setSizeC({
              w:
                dir === 'r' || dir === 'br'
                  ? Math.round(Math.max(240, Math.min(maxAllowedW, initW + dx)))
                  : Math.round(initW),
              h:
                dir === 'b' || dir === 'br'
                  ? Math.round(Math.max(200, Math.min(window.innerHeight - 24, initH + dy)))
                  : Math.round(initH),
            });
          },
          onEnd: () => {
            setIsResizing(false);
          },
        }),
      );
    };

    bindResize(resizeRRef.current, 'r');
    bindResize(resizeBRef.current, 'b');
    bindResize(resizeBrRef.current, 'br');

    return () => {
      for (const fn of cleanups) fn();
    };
  }, [effectiveMode, dragFloatOverride]);

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
      const sentenceZh = pop.sentence.builtInZh || zhMap[pop.sentence.id] || pop.onlineSentence || undefined;
      const item: VocabItem = {
        word: wordKey,
        rawWord: pop.cleaned,
        phonetic,
        meaning,
        sentence: pop.sentence.text,
        ...(sentenceZh ? { sentenceZh } : {}),
        time: pop.sentence.start,
        addedAt: Date.now(),
      };
      next = [...vocabItems, item];
      showToast(`已加入生词本：${wordKey}`);
    }
    setVocabItems(next);
    saveJson(`sh_vocab_${videoId}`, next);
  };

  const enrichedVocabItems = useMemo(() => {
    const sentences = transcript?.sentences ?? [];
    return vocabItems.map((item) => {
      if (item.sentenceZh) return item;
      const matchedSent =
        sentences.find((s) => Math.abs(s.start - item.time) < 1.2 || s.text === item.sentence) ?? null;
      const fallbackZh = matchedSent ? matchedSent.builtInZh || zhMap[matchedSent.id] : undefined;
      return fallbackZh ? { ...item, sentenceZh: fallbackZh } : item;
    });
  }, [vocabItems, transcript, zhMap]);

  const currentVideoVocab: VideoVocab = useMemo(
    () => ({
      videoId,
      url: videoUrl || `https://www.youtube.com/watch?v=${videoId}`,
      title: videoTitle || videoId,
      items: enrichedVocabItems,
    }),
    [videoId, videoUrl, videoTitle, enrichedVocabItems],
  );

  // 方式1：通过 Obsidian URI 追加到 languagelearning/生词表（移动端兜底或手动使用 URI）
  const handleObsidianUriExport = (forceFull = false) => {
    if (!enrichedVocabItems.length) {
      showToast('请先点击字幕中的单词并加入生词本');
      return;
    }
    const exportedKey = `sh_exported_${videoId}`;
    const alreadyExported = new Set<string>(forceFull ? [] : loadJson<string[]>(exportedKey, []));
    const newItems = enrichedVocabItems.filter((i) => !alreadyExported.has(i.word.toLowerCase()));

    let uri: string;
    if (forceFull || alreadyExported.size === 0) {
      const hasPriorOtherVideo = loadJson<boolean>('sh_obsidian_any_exported', false);
      const sectionMd = formatVideoVocabSection(currentVideoVocab, !hasPriorOtherVideo);
      uri = buildObsidianAppendUri(
        hasPriorOtherVideo ? `---\n\n${sectionMd}` : sectionMd,
        hasPriorOtherVideo,
      );
      saveJson('sh_obsidian_any_exported', true);
    } else if (newItems.length > 0) {
      const cleanUrl = currentVideoVocab.url;
      const rowsMd = newItems.map((item) => formatVocabTableRow(item, cleanUrl)).join('\n') + '\n';
      uri = buildObsidianAppendUri(rowsMd, false);
    } else {
      const now = Date.now();
      if (now - lastUriNoopAtRef.current < 6000) {
        lastUriNoopAtRef.current = 0;
        handleObsidianUriExport(true);
        return;
      }
      lastUriNoopAtRef.current = now;
      window.open(OBSIDIAN_OPEN_URI, '_blank');
      showToast('本地记录显示生词均已导出；若已在 Obsidian 清空/删除内容，请在 6 秒内再点一次重新写入');
      return;
    }

    const allExported = Array.from(new Set([...alreadyExported, ...enrichedVocabItems.map((i) => i.word.toLowerCase())]));
    saveJson(exportedKey, allExported);

    window.open(uri, '_blank');
    showToast(`已按《界面选型》表格模板追加 ${newItems.length || enrichedVocabItems.length} 个生词到 Obsidian`);
  };

  // 方式2：读取真实本地《生词表.md》，先匹配标题再判断可追加的新词汇（无同标题按模板全量导入），并打开 Obsidian
  const handleLocalFileMergeExport = async (forcePick = false) => {
    if (!enrichedVocabItems.length) {
      showToast('请先点击字幕中的单词并加入生词本');
      return;
    }
    const res = await writeVocabToLocalObsidianFile(currentVideoVocab, forcePick);
    if (res.ok) {
      if (res.status === 'noop') {
        showToast(`「${currentVideoVocab.title}」下暂无可追加的新词汇（已打开 Obsidian）`);
      } else if (res.status === 'appended_words') {
        showToast(`已在同标题下追加 ${res.addedCount} 个新词汇并打开 Obsidian！`);
      } else {
        showToast(`未检测到同标题，已按模板导入标题与 ${res.addedCount} 个词汇并打开 Obsidian！`);
      }
    } else if (res.error) {
      showToast(res.error);
    }
  };

  // 主导出按钮：桌面端支持本地文件读写时先读取真实 .md 文件做标题/词条校验，不支持时退回 URI（连点可强制重导）
  const handleExportObsidian = async () => {
    if (!enrichedVocabItems.length) {
      showToast('请先点击字幕中的单词并加入生词本');
      return;
    }
    if (supportsLocalObsidianFileAccess()) {
      await handleLocalFileMergeExport(false);
      return;
    }
    handleObsidianUriExport(false);
  };

  // 方式3：复制《界面选型》表格模板 Markdown 并打开 Obsidian 生词表
  const handleCopyAndOpenObsidian = async () => {
    if (!enrichedVocabItems.length) {
      showToast('请先点击字幕中的单词并加入生词本');
      return;
    }
    const md = formatVideoVocabSection(currentVideoVocab, true);
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      // ignore
    }
    window.open(OBSIDIAN_OPEN_URI, '_blank');
    showToast('已复制《界面选型》表格模板 Markdown 并打开 Obsidian 生词表');
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

  const clampedWidthC = Math.min(sizeC.w, Math.max(240, window.innerWidth - 12));
  const clampedHeightC = Math.min(sizeC.h, Math.max(220, window.innerHeight - 16));
  const clampedPosX = Math.max(6, Math.min(Math.max(6, window.innerWidth - clampedWidthC - 6), pos.x));
  const clampedPosY = Math.max(6, Math.min(Math.max(6, window.innerHeight - 64), pos.y));

  const renderAsFloatingC = effectiveMode === 'C' || dragFloatOverride;
  const panelStyle: React.CSSProperties =
    renderAsFloatingC
      ? {
          left: `${clampedPosX}px`,
          top: `${clampedPosY}px`,
          width: `${clampedWidthC}px`,
          height: `${clampedHeightC}px`,
          ['--sh-bg-alpha' as any]: opacity,
        }
      : {
          height: `${heightD}px`,
          ['--sh-bg-alpha' as any]: 0.96,
        };

  return (
    <div className="sh-root">
      <div
        ref={panelRef}
        className={`sh-panel ${renderAsFloatingC ? 'sh-mode-c' : 'sh-mode-d'}`}
        style={{ ...panelStyle, ...(visible ? {} : { display: 'none' }) }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sh-header">
          <div className="sh-title">
            <span
              ref={dragHandleRef}
              className={`sh-drag-title ${isDraggingTitle ? 'sh-dragging' : ''}`}
              title="长按「口语跟读」后可拖动悬浮面板位置"
            >
              🗣 口语跟读
            </span>
            <button
              type="button"
              className={`sh-ver-badge ${updateInfo?.hasUpdate ? 'sh-has-update' : ''}`}
              onClick={() => handleCheckUpdate()}
              title={
                updateInfo?.hasUpdate
                  ? `发现 GitHub 新版本 v${updateInfo.latestVersion}！点击跳转下载`
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
            {gamepadConnected && <span className="sh-badge">🎮 手柄已连接</span>}
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
              className="sh-btn"
              onClick={handleAddBookmark}
              title="标记当前字幕位置，方便长视频下次打开快速定位（可添加多个，快捷键 M）"
            >
              🔖 标记
            </button>

            <button
              className={`sh-btn ${drawer === 'bookmarks' ? 'sh-btn-active' : ''}`}
              onClick={() => setDrawer(drawer === 'bookmarks' ? 'none' : 'bookmarks')}
              title="查看并管理本视频的所有位置标记点"
            >
              📍 {bookmarks.length}
            </button>

            <button
              className={`sh-btn ${connectMode ? 'sh-btn-active' : ''}`}
              onClick={handleToggleConnectMode}
              title="连接两个相邻的句子，连接后以首句作为时间点，点击时间左侧 ❎ 可取消"
            >
              🔗 {connectMode ? '连接中...' : '连接'}
            </button>

            <select
              className="sh-speed-select"
              value={playbackRate}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setPlaybackRate(v);
                showToast(`播放倍速：${v}x`);
              }}
              title="调节视频倍速（快捷键 [ 减速 / ] 加速）"
            >
              {SPEED_STEPS.map((sp) => (
                <option key={sp} value={sp}>
                  {sp}x
                </option>
              ))}
            </select>

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

        {/* 句子连接引导提示条 */}
        {connectMode && (
          <div className="sh-connect-bar">
            <span>
              {connectFirstIdx === null
                ? '🔗 请点击第 1 个要连接的句子'
                : `🔗 已选中 #${connectFirstIdx + 1} (${formatTimestamp(displaySentences[connectFirstIdx]?.start ?? 0)})，请点击紧邻的上一句或下一句`}
            </span>
            <button className="sh-btn" onClick={handleToggleConnectMode}>
              取消
            </button>
          </div>
        )}

        {/* 长视频标记点快捷跳转栏 */}
        {bookmarks.length > 0 && (
          <div className="sh-bookmark-bar">
            <span style={{ flexShrink: 0, fontWeight: 600 }}>📍 标记点:</span>
            {bookmarks.map((bm) => (
              <span
                key={bm.id}
                className="sh-bm-chip"
                onClick={() => handleJumpBookmark(bm)}
                title={`${bm.id === latestBookmarkId ? '[最新标记] ' : ''}${formatTimestamp(bm.time)} · ${bm.text}`}
              >
                <span>
                  {bm.id === latestBookmarkId ? '★ ' : ''}
                  {formatTimestamp(bm.time)}
                </span>
                <span
                  className="sh-bm-del"
                  title="删除此标记点"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveBookmark(bm.id);
                  }}
                >
                  ×
                </span>
              </span>
            ))}
          </div>
        )}

        {/* 抽屉 0：长视频标记点列表 */}
        {drawer === 'bookmarks' && (
          <div className="sh-drawer">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <b>📍 视频位置标记点 ({bookmarks.length}) · 自动按视频保存</b>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="sh-btn sh-btn-active" onClick={handleAddBookmark}>
                  ＋ 标记当前位置
                </button>
                {bookmarks.length > 0 && (
                  <button className="sh-btn" onClick={handleClearBookmarks}>
                    清空
                  </button>
                )}
                <button className="sh-btn" onClick={() => setDrawer('none')}>
                  收起
                </button>
              </div>
            </div>
            {bookmarks.length === 0 ? (
              <div style={{ color: 'var(--sh-muted)' }}>
                暂无标记点。观看长视频时随时点击工具栏「🔖 标记」（或按 M 键）即可记录多个观看位置。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {bookmarks.map((bm) => (
                  <div
                    key={bm.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 8px',
                      borderRadius: 6,
                      background: 'rgba(251, 191, 36, 0.08)',
                      border: '1px solid rgba(251, 191, 36, 0.25)',
                    }}
                  >
                    <button
                      className="sh-btn sh-btn-active"
                      onClick={() => handleJumpBookmark(bm)}
                      title="跳转到此位置播放"
                    >
                      ▶ {formatTimestamp(bm.time)}
                    </button>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#fff' }}>
                        {bm.id === latestBookmarkId && (
                          <span style={{ color: 'var(--sh-warn)', marginRight: 5, fontSize: 11 }}>[最新]</span>
                        )}
                        {bm.text}
                      </div>
                      {bm.zh && (
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--sh-muted)', fontSize: 11 }}>
                          {bm.zh}
                        </div>
                      )}
                    </div>
                    <button className="sh-btn" onClick={() => handleRemoveBookmark(bm.id)}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
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
                • <span className="sh-kbd">[</span> / <span className="sh-kbd">]</span>：播放倍速减速 / 加速（0.5x~1.5x）
              </div>
              <div>
                • <span className="sh-kbd">M</span>：标记当前字幕位置（支持多个标记点）
              </div>
              <div>
                • <b>🔗 连接</b>：依次点选相邻两句合并，点时间左侧 ❎ 取消连接
              </div>
              <div>
                • <span className="sh-kbd">H</span>：打开 / 临时隐藏窗口（隐藏后 A/D/R 等快捷键仍有效）
              </div>
              <div>
                • <b>🎮 蓝牙手柄</b>：A/R2 重听 · 左/上/L1 上句 · 右/下/R1 下句 · B 播放/暂停 · X 译文 · Y 读完暂停 · Select 隐藏
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
              <button className="sh-btn" onClick={() => handleCheckUpdate()} disabled={checkingUpdate}>
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
              <button
                className="sh-btn sh-btn-active"
                onClick={() => handleLocalFileMergeExport(false)}
                title="读取 E:\CODEX\codex-obsidian\languagelearning\生词表.md，匹配标题并仅追加新增词汇"
              >
                📂 写入本地《生词表.md》(按标题校验追加)
              </button>
              <button
                className="sh-btn"
                onClick={() => handleLocalFileMergeExport(true)}
                title="重新选择目标 .md 文件"
              >
                🔄 更换 .md 文件
              </button>
              <button className="sh-btn" onClick={() => handleObsidianUriExport(false)}>
                ⚡ URI 追加 (若已删内容可连点重导)
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
              {displaySentences.map((sent, idx) => {
                const isActive = idx === activeIdx;
                const isBookmarked = bookmarkedSentIndices.has(idx);
                const isConnectPick = connectMode && connectFirstIdx === idx;
                const mergedZhParts: string[] = [];
                if (showZh) {
                  for (const bid of sent.baseIds) {
                    const baseSent = transcript?.sentences.find((b) => b.id === bid);
                    const piece = baseSent?.builtInZh || zhMap[bid];
                    if (piece && !mergedZhParts.includes(piece)) mergedZhParts.push(piece);
                  }
                }
                const zhDisplay = mergedZhParts.join(' ');
                return (
                  <div
                    key={`${sent.id}_${sent.baseIds.length}`}
                    data-sent-idx={idx}
                    className={`sh-sent-row ${isActive ? 'sh-active' : ''} ${isBookmarked ? 'sh-bookmarked' : ''} ${isConnectPick ? 'sh-connect-pick' : ''}`}
                    onClick={() => (connectMode ? handleSelectForConnect(idx) : playSentence(sent, idx))}
                    title={
                      connectMode
                        ? '点击选择此句子进行相邻连接'
                        : '点击空白处或时间戳跳转到此句开头播放'
                    }
                  >
                    <div className="sh-time-col">
                      {sent.isMerged && (
                        <button
                          type="button"
                          className="sh-unmerge-btn"
                          title="取消连接（恢复为原来的句子）"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnmergeSentence(sent);
                          }}
                        >
                          ❎
                        </button>
                      )}
                      <span className="sh-play-icon">{isActive ? '▶' : isBookmarked ? '🔖' : '•'}</span>
                      <span>{formatTimestamp(sent.start)}</span>
                    </div>
                    <div className="sh-sent-body">
                      <div className="sh-words-line">
                        {sent.words.map((w, wIdx) => (
                          <React.Fragment key={wIdx}>
                            <span
                              className={`sh-word ${w.asrText ? 'sh-corrected' : ''}`}
                              onClick={(e) => {
                                if (connectMode) return;
                                handleWordClick(e, w, sent);
                              }}
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
                          {zhDisplay || (zhLoading ? '正在翻译句子...' : '')}
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
            onClick={handleExportObsidian}
            title="先在 md 中匹配标题（有则追加新词，无则按模板全量导入），并打开 Obsidian"
          >
            ↗ 导出 Obsidian
          </button>
        </div>

        {/* 窗口尺寸拖拽手柄（长按后支持鼠标与触屏拖拽调整大小） */}
        {renderAsFloatingC && (
          <>
            <div ref={resizeRRef} className="sh-resize-r" />
            <div ref={resizeBRef} className="sh-resize-b" />
            <div
              ref={resizeBrRef}
              className={`sh-resize-br ${isResizing ? 'sh-resizing' : ''}`}
              title="长按右下角「◢」后拖动调整窗口大小"
            >
              ◢
            </div>
          </>
        )}
        {!renderAsFloatingC && (
          <div
            ref={resizeBRef}
            className="sh-resize-b"
            title="长按底部边缘上下拖动调整面板高度"
          />
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
