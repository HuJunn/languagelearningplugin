import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseCustomTranscriptCues, Json3 } from '../src/core/captions';
import type { CompactDict } from '../src/core/dict';
import { buildTranscript } from '../src/core/pipeline';
import type { Cue, Transcript } from '../src/core/types';
import { ShadowingPanel } from '../src/ui/ShadowingPanel';
import { PANEL_CSS } from '../src/ui/styles';

interface RawCaptionMessage {
  videoId: string;
  title: string;
  hasCaptions: boolean;
  manualJson3?: Json3 | null;
  manualXml?: string | null;
  asrJson3?: Json3 | null;
  asrXml?: string | null;
}

function ensureYouTubeTheaterMode() {
  const flexy = document.querySelector('ytd-watch-flexy');
  if (flexy && !flexy.hasAttribute('theater')) {
    const sizeBtn = document.querySelector<HTMLButtonElement>('#movie_player .ytp-size-button');
    if (sizeBtn) sizeBtn.click();
  }
}

function repositionHostElement(hostEl: HTMLElement, effectiveMode: 'C' | 'D', isFullscreen: boolean) {
  if (isFullscreen && document.fullscreenElement) {
    if (hostEl.parentElement !== document.fullscreenElement) {
      document.fullscreenElement.appendChild(hostEl);
    }
    return;
  }

  if (effectiveMode === 'D') {
    ensureYouTubeTheaterMode();
    // 兼容桌面端 YouTube 与移动端 m.youtube.com 视频下方容器
    const mobilePlayer =
      document.querySelector('#player-container-id') ||
      document.querySelector('ytm-player') ||
      document.querySelector('ytm-CompanionSlot');
    if (mobilePlayer && mobilePlayer.parentElement) {
      mobilePlayer.parentElement.insertBefore(hostEl, mobilePlayer.nextSibling);
      return;
    }
    const below =
      document.querySelector('#below') ||
      document.querySelector('#primary-inner') ||
      document.querySelector('#columns');
    if (below && below.parentElement) {
      if (below.id === 'columns') {
        below.parentElement.insertBefore(hostEl, below);
      } else {
        below.insertBefore(hostEl, below.firstChild);
      }
      return;
    }
  }

  if (hostEl.parentElement !== document.body) {
    document.body.appendChild(hostEl);
  }
}

const App: React.FC<{ hostEl: HTMLElement }> = ({ hostEl }) => {
  const [visible, setVisible] = useState<boolean>(true);
  const [mode, setMode] = useState<'C' | 'D'>(() => {
    try {
      const saved = localStorage.getItem('sh_layout_mode');
      if (saved === 'C' || saved === 'D') return saved;
      return window.innerWidth <= 680 || location.hostname === 'm.youtube.com' ? 'D' : 'C';
    } catch {
      return 'C';
    }
  });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => Boolean(document.fullscreenElement));
  const [dict, setDict] = useState<CompactDict>({});
  const [rawMsg, setRawMsg] = useState<RawCaptionMessage | null>(null);
  const [customCues, setCustomCues] = useState<Cue[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // 加载离线 ECDICT 词库
  useEffect(() => {
    const url = chrome.runtime.getURL('/dict.json');
    fetch(url)
      .then((r) => r.json())
      .then((d: CompactDict) => setDict(d))
      .catch(() => {});
  }, []);

  // 监听全屏切换：进入全屏自动切为 C，退出全屏恢复之前的 mode
  useEffect(() => {
    const onFsChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // 根据当前模式 (C / D) 与全屏状态移动宿主容器位置
  const effectiveMode: 'C' | 'D' = isFullscreen ? 'C' : mode;
  useEffect(() => {
    repositionHostElement(hostEl, effectiveMode, isFullscreen);
    if (effectiveMode === 'D' && !isFullscreen) {
      const t = setTimeout(() => repositionHostElement(hostEl, 'D', false), 500);
      return () => clearTimeout(t);
    }
  }, [hostEl, effectiveMode, isFullscreen, rawMsg?.videoId]);

  // 接收主世界脚本发来的字幕数据 & 扩展图标开关消息
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || !e.data) return;
      if (e.data.type === 'SH_CAPTION_DATA') {
        const msg = e.data as RawCaptionMessage;
        setRawMsg(msg);
        setLoading(false);
        try {
          const savedCalib = localStorage.getItem(`sh_custom_manual_${msg.videoId}`);
          setCustomCues(savedCalib ? parseCustomTranscriptCues(savedCalib) : null);
        } catch {
          setCustomCues(null);
        }
      }
    };
    window.addEventListener('message', onMessage);

    const onExtMsg = (msg: any) => {
      if (msg?.type === 'SH_TOGGLE_PANEL') {
        setVisible((v) => !v);
      }
    };
    chrome.runtime?.onMessage?.addListener(onExtMsg);

    // 快捷键 H：打开 / 临时关闭跟读窗口
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
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
      if (e.key.toLowerCase() === 'h') {
        const isWatch = location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
        if (!isWatch) return;
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // 蓝牙手柄 Select / '-' 键 (button 8) 随时切换隐藏/显示窗口
    let gpTimer = 0;
    let prevSelectPressed = false;
    gpTimer = window.setInterval(() => {
      try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let sel = false;
        for (const p of pads) {
          if (p && p.connected && p.buttons[8]?.pressed) {
            sel = true;
            break;
          }
        }
        if (sel && !prevSelectPressed) {
          setVisible((v) => !v);
        }
        prevSelectPressed = sel;
      } catch {
        // ignore
      }
    }, 60);

    window.postMessage({ type: 'SH_REQUEST_CAPTIONS' }, '*');

    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKeyDown);
      clearInterval(gpTimer);
      chrome.runtime?.onMessage?.removeListener(onExtMsg);
    };
  }, []);

  const handleModeChange = useCallback((nextMode: 'C' | 'D') => {
    setMode(nextMode);
    try {
      localStorage.setItem('sh_layout_mode', nextMode);
    } catch {
      // ignore
    }
  }, []);

  const transcript: Transcript | null = React.useMemo(() => {
    if (!rawMsg || (!rawMsg.hasCaptions && !customCues?.length)) return null;
    return buildTranscript({
      videoId: rawMsg.videoId,
      asrJson3: rawMsg.asrJson3,
      manualJson3: rawMsg.manualJson3,
      manualXml: rawMsg.manualXml,
      asrXml: rawMsg.asrXml,
      customManualCues: customCues,
    });
  }, [rawMsg, customCues]);

  const handleApplyCustomManualText = useCallback(
    (rawText: string) => {
      const parsed = parseCustomTranscriptCues(rawText);
      if (parsed.length > 0) {
        setCustomCues(parsed);
        if (rawMsg?.videoId) {
          try {
            localStorage.setItem(`sh_custom_manual_${rawMsg.videoId}`, rawText);
          } catch {
            // ignore
          }
        }
      }
    },
    [rawMsg?.videoId],
  );

  const handleClearCustomManualText = useCallback(() => {
    setCustomCues(null);
    if (rawMsg?.videoId) {
      try {
        localStorage.removeItem(`sh_custom_manual_${rawMsg.videoId}`);
      } catch {
        // ignore
      }
    }
  }, [rawMsg?.videoId]);

  const getVideoElement = useCallback(() => {
    return document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
  }, []);

  if (!visible) return null;

  // 只在视频观看页 (/watch 或 /shorts/) 显示面板
  const isWatchPage = location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
  if (!isWatchPage) return null;

  return (
    <ShadowingPanel
      transcript={transcript}
      videoTitle={rawMsg?.title || document.title.replace(/\s*-\s*YouTube$/, '')}
      videoUrl={location.href}
      loading={loading}
      mode={mode}
      onModeChange={handleModeChange}
      isFullscreen={isFullscreen}
      dict={dict}
      hasCustomManual={Boolean(customCues && customCues.length > 0)}
      onApplyCustomManualText={handleApplyCustomManualText}
      onClearCustomManualText={handleClearCustomManualText}
      getVideoElement={getVideoElement}
      onClose={() => setVisible(false)}
    />
  );
};

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    if (document.getElementById('sh-shadowing-host')) return;

    const hostEl = document.createElement('div');
    hostEl.id = 'sh-shadowing-host';
    document.body.appendChild(hostEl);

    const shadow = hostEl.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = PANEL_CSS;
    shadow.appendChild(styleEl);

    const mountEl = document.createElement('div');
    shadow.appendChild(mountEl);

    const root = createRoot(mountEl);
    root.render(<App hostEl={hostEl} />);
  },
});
