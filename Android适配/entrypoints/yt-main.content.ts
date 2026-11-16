import { selectEnglishTracks } from '../src/core/pipeline';
import type { CaptionTrack } from '../src/core/types';
import type { Json3 } from '../src/core/captions';

interface YtPlayer extends HTMLElement {
  getPlayerResponse?: () => any;
  getVideoData?: () => { video_id?: string; title?: string };
  loadModule?: (mod: string) => void;
  setOption?: (mod: string, opt: string, val: any) => void;
  getOptions?: (mod?: string) => string[];
  toggleSubtitles?: () => void;
  toggleSubtitlesOn?: () => void;
}

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    let lastPotParams: Record<string, string> = {};
    const capturedPayloads = new Map<string, { json3?: Json3; xml?: string }>();
    let activeVideoId = '';
    let fetchingVideoId = '';

    function cacheKey(videoId: string, kind: string, lang: string) {
      return `${videoId}:${kind || 'manual'}:${lang || 'en'}`;
    }

    function recordTimedTextUrl(rawUrl: string, bodyText?: string) {
      try {
        const u = new URL(rawUrl, location.origin);
        if (!u.pathname.includes('/api/timedtext')) return;
        const v = u.searchParams.get('v') || '';
        const kind = u.searchParams.get('kind') || 'manual';
        const lang = u.searchParams.get('lang') || 'en';
        const pot = u.searchParams.get('pot');
        if (pot) {
          lastPotParams = {};
          for (const k of ['pot', 'c', 'cver', 'potc']) {
            const val = u.searchParams.get(k);
            if (val) lastPotParams[k] = val;
          }
        }
        if (v && bodyText && bodyText.trim().length > 10) {
          const trimmed = bodyText.trim();
          const key = cacheKey(v, kind, lang);
          if (trimmed.startsWith('{')) {
            try {
              const json3 = JSON.parse(trimmed) as Json3;
              if (Array.isArray(json3.events)) {
                capturedPayloads.set(key, { json3 });
                window.postMessage({ type: 'SH_CAPTURED_TIMEDTEXT', videoId: v, kind, lang }, '*');
              }
            } catch {
              // ignore
            }
          } else if (trimmed.startsWith('<')) {
            capturedPayloads.set(key, { xml: trimmed });
            window.postMessage({ type: 'SH_CAPTURED_TIMEDTEXT', videoId: v, kind, lang }, '*');
          }
        }
      } catch {
        // ignore
      }
    }

    // 1. 拦截 fetch 与 XHR，捕获播放器自带的 pot 签名参数与字幕响应
    const origFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const resp = await origFetch.call(this, input, init);
      if (urlStr && urlStr.includes('/api/timedtext')) {
        try {
          resp
            .clone()
            .text()
            .then((txt) => recordTimedTextUrl(urlStr, txt))
            .catch(() => {});
        } catch {
          // ignore
        }
      }
      return resp;
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
      (this as any).__shUrl = typeof url === 'string' ? url : url.toString();
      return (origOpen as any).call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const urlStr = (this as any).__shUrl as string | undefined;
      if (urlStr && urlStr.includes('/api/timedtext')) {
        recordTimedTextUrl(urlStr);
        this.addEventListener('load', () => {
          try {
            if (typeof this.responseText === 'string') {
              recordTimedTextUrl(urlStr, this.responseText);
            }
          } catch {
            // ignore
          }
        });
      }
      return origSend.call(this, body);
    };

    function getVideoIdFromLocation(): string {
      try {
        const u = new URL(location.href);
        if (u.pathname === '/watch') return u.searchParams.get('v') || '';
        const m = /^\/shorts\/([a-zA-Z0-9_-]+)/.exec(u.pathname);
        if (m) return m[1];
      } catch {
        // ignore
      }
      return '';
    }

    function getPlayer(): YtPlayer | null {
      return (document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player')) as YtPlayer | null;
    }

    function extractTracksAndMeta(videoId: string): { title: string; tracks: CaptionTrack[] } | null {
      const player = getPlayer();
      let pr = player?.getPlayerResponse?.();
      if (!pr || pr?.videoDetails?.videoId !== videoId) {
        const initPr = (window as any).ytInitialPlayerResponse;
        if (initPr?.videoDetails?.videoId === videoId) {
          pr = initPr;
        }
      }
      if (!pr) return null;
      const rawTracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const title = pr?.videoDetails?.title || document.title.replace(/\s*-\s*YouTube$/, '');
      if (!Array.isArray(rawTracks)) {
        return { title, tracks: [] };
      }
      const tracks: CaptionTrack[] = rawTracks.map((t: any) => ({
        baseUrl: String(t.baseUrl || ''),
        languageCode: String(t.languageCode || ''),
        kind: t.kind ? String(t.kind) : undefined,
        name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode || '',
        vssId: t.vssId ? String(t.vssId) : undefined,
      }));
      return { title, tracks };
    }

    async function fetchTrackPayload(
      videoId: string,
      track: CaptionTrack,
    ): Promise<{ json3?: Json3; xml?: string } | null> {
      const kind = track.kind === 'asr' ? 'asr' : 'manual';
      const key = cacheKey(videoId, kind, track.languageCode);
      const cached = capturedPayloads.get(key);
      if (cached?.json3) return cached;

      const buildUrl = (fmt: string) => {
        const u = new URL(track.baseUrl, location.origin);
        u.searchParams.set('fmt', fmt);
        for (const [k, v] of Object.entries(lastPotParams)) {
          if (!u.searchParams.has(k)) u.searchParams.set(k, v);
        }
        return u.toString();
      };

      try {
        const resp = await origFetch(buildUrl('json3'), { credentials: 'include' });
        if (resp.ok) {
          const text = (await resp.text()).trim();
          if (text.startsWith('{')) {
            const json3 = JSON.parse(text) as Json3;
            if (Array.isArray(json3.events) && json3.events.length > 0) {
              capturedPayloads.set(key, { json3 });
              return { json3 };
            }
          }
        }
      } catch {
        // fallback below
      }

      // 尝试不带 fmt（默认 XML/srv3）
      try {
        const u = new URL(track.baseUrl, location.origin);
        for (const [k, v] of Object.entries(lastPotParams)) {
          if (!u.searchParams.has(k)) u.searchParams.set(k, v);
        }
        const resp = await origFetch(u.toString(), { credentials: 'include' });
        if (resp.ok) {
          const text = (await resp.text()).trim();
          if (text.startsWith('<') && text.length > 20) {
            return { xml: text };
          }
        }
      } catch {
        // ignore
      }

      return cached ?? null;
    }

    /** 如果直接请求被 PoToken 拦截返回空体，唤醒播放器字幕模块让播放器自己发出带 pot 的请求 */
    async function nudgePlayerCaptions(): Promise<void> {
      const btn = document.querySelector<HTMLButtonElement>('#movie_player .ytp-subtitles-button');
      const player = getPlayer();
      try {
        player?.loadModule?.('captions');
      } catch {
        // ignore
      }
      if (btn) {
        const wasPressed = btn.getAttribute('aria-pressed') === 'true';
        if (!wasPressed) {
          btn.click();
          await new Promise((r) => setTimeout(r, 450));
          btn.click();
        } else {
          // 已经开启，稍微等待拦截器收到响应
          await new Promise((r) => setTimeout(r, 350));
        }
      }
    }

    async function loadCaptionsForCurrentVideo(force = false) {
      const videoId = getVideoIdFromLocation();
      if (!videoId) return;
      if (!force && (videoId === activeVideoId || videoId === fetchingVideoId)) return;
      fetchingVideoId = videoId;

      // 等待播放器数据就绪（最多重试 12 次）
      let meta: { title: string; tracks: CaptionTrack[] } | null = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        meta = extractTracksAndMeta(videoId);
        if (meta && meta.tracks.length > 0) break;
        await new Promise((r) => setTimeout(r, 300));
      }

      if (!meta || meta.tracks.length === 0) {
        activeVideoId = videoId;
        fetchingVideoId = '';
        window.postMessage(
          {
            type: 'SH_CAPTION_DATA',
            videoId,
            title: meta?.title || document.title,
            hasCaptions: false,
          },
          '*',
        );
        return;
      }

      const { manualTrack, asrTrack } = selectEnglishTracks(meta.tracks);
      let manualData = manualTrack ? await fetchTrackPayload(videoId, manualTrack) : null;
      let asrData = asrTrack ? await fetchTrackPayload(videoId, asrTrack) : null;

      // 如果有字幕轨但因为缺 pot 拿到空响应，触发一次播放器自身字幕请求再重试
      if (!manualData && !asrData && (manualTrack || asrTrack)) {
        await nudgePlayerCaptions();
        if (manualTrack) manualData = await fetchTrackPayload(videoId, manualTrack);
        if (asrTrack) asrData = await fetchTrackPayload(videoId, asrTrack);
      }

      activeVideoId = videoId;
      fetchingVideoId = '';
      window.postMessage(
        {
          type: 'SH_CAPTION_DATA',
          videoId,
          title: meta.title,
          hasCaptions: Boolean(manualData || asrData),
          tracks: meta.tracks,
          manualJson3: manualData?.json3 ?? null,
          manualXml: manualData?.xml ?? null,
          asrJson3: asrData?.json3 ?? null,
          asrXml: asrData?.xml ?? null,
        },
        '*',
      );
    }

    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data) return;
      if (e.data.type === 'SH_REQUEST_CAPTIONS') {
        loadCaptionsForCurrentVideo(true);
      } else if (e.data.type === 'SH_CAPTURED_TIMEDTEXT') {
        if (e.data.videoId && e.data.videoId === getVideoIdFromLocation()) {
          loadCaptionsForCurrentVideo(true);
        }
      }
    });

    window.addEventListener('yt-navigate-finish', () => {
      activeVideoId = '';
      loadCaptionsForCurrentVideo(true);
    });
    window.addEventListener('state-navigateend', () => {
      activeVideoId = '';
      loadCaptionsForCurrentVideo(true);
    });
    setInterval(() => {
      const vid = getVideoIdFromLocation();
      if (vid && vid !== activeVideoId && vid !== fetchingVideoId) {
        loadCaptionsForCurrentVideo(true);
      }
    }, 800);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => loadCaptionsForCurrentVideo(true));
    } else {
      loadCaptionsForCurrentVideo(true);
    }
  },
});
