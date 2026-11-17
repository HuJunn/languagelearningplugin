import { selectEnglishTracks, selectChineseTrack } from '../src/core/pipeline';
import type { CaptionTrack } from '../src/core/types';
import type { Json3 } from '../src/core/captions';

interface YtPlayer extends HTMLElement {
  getPlayerResponse?: () => any;
  getVideoData?: () => { video_id?: string; title?: string };
  loadModule?: (mod: string) => void;
  setOption?: (mod: string, opt: string, val: any) => void;
  getOption?: (mod: string, opt: string) => any;
  getOptions?: (mod?: string) => string[];
  toggleSubtitles?: () => void;
  toggleSubtitlesOn?: () => void;
}

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const potByVideo = new Map<string, { url: string; params: Record<string, string> }>();
    const playerResponseByVideo = new Map<string, any>();
    const capturedPayloads = new Map<string, { json3?: Json3; xml?: string }>();
    let activeVideoId = '';
    let fetchingVideoId = '';
    let activeRunId = 0;

    function cacheKey(videoId: string, kind: string, lang: string) {
      return `${videoId}:${kind || 'manual'}:${lang || 'en'}`;
    }

    function emitProgress(videoId: string, percent: number, detail: string) {
      window.postMessage({ type: 'SH_CAPTION_PROGRESS', videoId, percent, detail }, '*');
    }

    function recordPlayerResponse(pr: any) {
      try {
        const vid = pr?.videoDetails?.videoId;
        if (typeof vid === 'string' && vid) {
          playerResponseByVideo.set(vid, pr);
        }
      } catch {
        // ignore
      }
    }

    function recordTimedTextUrl(rawUrl: string, bodyText?: string) {
      try {
        const u = new URL(rawUrl, location.origin);
        if (!u.pathname.includes('/api/timedtext')) return;
        const v = u.searchParams.get('v') || '';
        const kind = u.searchParams.get('kind') || 'manual';
        const lang = u.searchParams.get('lang') || 'en';
        const hasTlang = u.searchParams.has('tlang');
        const pot = u.searchParams.get('pot');
        if (v) {
          const params: Record<string, string> = {};
          for (const k of ['pot', 'c', 'cver', 'potc', 'xoaf', 'xowf', 'xospf']) {
            const val = u.searchParams.get(k);
            if (val) params[k] = val;
          }
          if (pot || !potByVideo.has(v)) {
            const cleanUrl = new URL(u.toString());
            cleanUrl.searchParams.delete('tlang');
            potByVideo.set(v, { url: cleanUrl.toString(), params });
          }
        }
        if (!hasTlang && v && bodyText && bodyText.trim().length > 10) {
          const trimmed = bodyText.trim();
          const key = cacheKey(v, kind, lang);
          if (trimmed.startsWith('{')) {
            try {
              const json3 = JSON.parse(trimmed) as Json3;
              if (Array.isArray(json3.events) && json3.events.length > 0) {
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

    // 1. 拦截 fetch 与 XHR：同时捕获 /youtubei/v1/player 的字幕轨与 /api/timedtext 的 pot 签名及响应
    const origFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const resp = await origFetch.call(this, input, init);
      if (urlStr) {
        if (urlStr.includes('/api/timedtext')) {
          resp
            .clone()
            .text()
            .then((txt) => recordTimedTextUrl(urlStr, txt))
            .catch(() => {});
        } else if (urlStr.includes('/youtubei/v1/player')) {
          resp
            .clone()
            .json()
            .then((data) => recordPlayerResponse(data))
            .catch(() => {});
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
      if (urlStr) {
        if (urlStr.includes('/api/timedtext')) {
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
        } else if (urlStr.includes('/youtubei/v1/player')) {
          this.addEventListener('load', () => {
            try {
              if (typeof this.responseText === 'string') {
                recordPlayerResponse(JSON.parse(this.responseText));
              }
            } catch {
              // ignore
            }
          });
        }
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

    function parseTracksFromPlayerResponse(pr: any): { title: string; tracks: CaptionTrack[] } {
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

    function extractTracksAndMeta(videoId: string): { title: string; tracks: CaptionTrack[] } | null {
      const cachedPr = playerResponseByVideo.get(videoId);
      if (cachedPr?.videoDetails?.videoId === videoId) {
        return parseTracksFromPlayerResponse(cachedPr);
      }

      const player = getPlayer();
      const playerPr = player?.getPlayerResponse?.();
      if (playerPr?.videoDetails?.videoId === videoId) {
        recordPlayerResponse(playerPr);
        return parseTracksFromPlayerResponse(playerPr);
      }

      const flexyPr = (document.querySelector('ytd-watch-flexy') as any)?.playerData?.playerResponse;
      if (flexyPr?.videoDetails?.videoId === videoId) {
        recordPlayerResponse(flexyPr);
        return parseTracksFromPlayerResponse(flexyPr);
      }

      const initPr = (window as any).ytInitialPlayerResponse;
      if (initPr?.videoDetails?.videoId === videoId) {
        recordPlayerResponse(initPr);
        return parseTracksFromPlayerResponse(initPr);
      }

      return null;
    }

    /** 兜底：若页面播放器对象还没挂上新视频的 playerResponse，直接拉取同源 watch HTML 解析 ytInitialPlayerResponse */
    async function fetchWatchHtmlMeta(videoId: string): Promise<{ title: string; tracks: CaptionTrack[] } | null> {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const resp = await origFetch(`https://${location.host}/watch?v=${encodeURIComponent(videoId)}`, {
          credentials: 'include',
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) return null;
        const html = await resp.text();
        // 兼容 m.youtube.com：移动端 HTML 前面先出现 ytInitialPlayerResponse = null; 后面才是真正的 {...}
        const re = /ytInitialPlayerResponse\s*=\s*\{/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html))) {
          const start = m.index + m[0].length - 1;
          let depth = 0;
          let inStr = false;
          let esc = false;
          let end = -1;
          for (let i = start; i < html.length; i++) {
            const ch = html[i];
            if (inStr) {
              if (esc) esc = false;
              else if (ch === '\\') esc = true;
              else if (ch === '"') inStr = false;
            } else {
              if (ch === '"') inStr = true;
              else if (ch === '{') depth++;
              else if (ch === '}') {
                depth--;
                if (depth === 0) {
                  end = i + 1;
                  break;
                }
              }
            }
          }
          if (end < 0) continue;
          try {
            const pr = JSON.parse(html.slice(start, end));
            if (pr?.videoDetails?.videoId === videoId) {
              recordPlayerResponse(pr);
              return parseTracksFromPlayerResponse(pr);
            }
          } catch {
            // try next match
          }
        }
      } catch {
        // ignore
      }
      return null;
    }

    function findCapturedForTrack(videoId: string, track: CaptionTrack): { json3?: Json3; xml?: string } | null {
      const kind = track.kind === 'asr' ? 'asr' : 'manual';
      const exact = capturedPayloads.get(cacheKey(videoId, kind, track.languageCode));
      if (exact) return exact;
      for (const [k, v] of capturedPayloads.entries()) {
        if (k.startsWith(`${videoId}:${kind}:`) && v.json3) return v;
      }
      for (const [k, v] of capturedPayloads.entries()) {
        if (k.startsWith(`${videoId}:${kind}:`)) return v;
      }
      return null;
    }

    async function fetchWithTimeout(url: string, timeoutMs = 4500): Promise<Response> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await origFetch(url, { credentials: 'include', signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    async function fetchTrackPayload(
      videoId: string,
      track: CaptionTrack,
    ): Promise<{ json3?: Json3; xml?: string } | null> {
      const kind = track.kind === 'asr' ? 'asr' : 'manual';
      const key = cacheKey(videoId, kind, track.languageCode);
      const cached = findCapturedForTrack(videoId, track);
      if (cached?.json3) return cached;

      const potInfo = potByVideo.get(videoId);
      const buildUrl = (fmt: string) => {
        if (potInfo?.url) {
          try {
            const pu = new URL(potInfo.url, location.origin);
            const pKind = pu.searchParams.get('kind') || 'manual';
            const pLang = pu.searchParams.get('lang') || '';
            if (pu.searchParams.get('v') === videoId && pKind === kind && pLang === track.languageCode) {
              pu.searchParams.delete('tlang');
              pu.searchParams.set('fmt', fmt);
              return pu.toString();
            }
          } catch {
            // ignore
          }
        }
        const u = new URL(track.baseUrl, location.origin);
        u.searchParams.set('fmt', fmt);
        if (potInfo) {
          for (const [k, v] of Object.entries(potInfo.params)) {
            if (!u.searchParams.has(k)) u.searchParams.set(k, v);
          }
        }
        return u.toString();
      };

      try {
        const resp = await fetchWithTimeout(buildUrl('json3'));
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
        if (potInfo) {
          for (const [k, v] of Object.entries(potInfo.params)) {
            if (!u.searchParams.has(k)) u.searchParams.set(k, v);
          }
        }
        const resp = await fetchWithTimeout(u.toString());
        if (resp.ok) {
          const text = (await resp.text()).trim();
          if (text.startsWith('<') && text.length > 20) {
            return { xml: text };
          }
        }
      } catch {
        // ignore
      }

      return findCapturedForTrack(videoId, track);
    }

    function findCaptionButton(): HTMLButtonElement | null {
      return document.querySelector<HTMLButtonElement>(
        '#movie_player .ytp-subtitles-button, ' +
          'ytm-closed-captioning-button button, ' +
          '.ytmClosedCaptioningButtonButton, ' +
          'yt-closed-captions-toggle-button button',
      );
    }

    /** 唤醒播放器字幕模块触发带 PoToken 的请求，最多等待 4 秒直到捕获到 pot 或字幕载荷 */
    async function nudgePlayerCaptions(videoId: string, preferredLang?: string): Promise<void> {
      const player = getPlayer();
      let btn = findCaptionButton();

      // 移动端 m.youtube.com 的控制栏未唤醒时，CC 按钮可能还没挂载，先轻触播放器容器
      if (!btn && location.hostname === 'm.youtube.com') {
        const overlay = document.querySelector<HTMLElement>(
          '#player-control-overlay, .player-controls-content, #movie_player video',
        );
        overlay?.click();
        await new Promise((r) => setTimeout(r, 180));
        btn = findCaptionButton();
      }

      const wasPressed = btn?.getAttribute('aria-pressed') === 'true';

      try {
        player?.loadModule?.('captions');
        if (preferredLang) {
          player?.setOption?.('captions', 'track', { languageCode: preferredLang });
        }
      } catch {
        // ignore
      }

      if (btn && !wasPressed) {
        btn.click();
      } else {
        try {
          player?.toggleSubtitlesOn?.();
          if (!btn && !wasPressed) player?.toggleSubtitles?.();
        } catch {
          // ignore
        }
      }

      const deadline = Date.now() + 4200;
      while (Date.now() < deadline) {
        if (getVideoIdFromLocation() !== videoId) break;
        const hasCapturedPayload = Array.from(capturedPayloads.keys()).some((k) => k.startsWith(`${videoId}:`));
        if (hasCapturedPayload || potByVideo.has(videoId)) {
          await new Promise((r) => setTimeout(r, 150));
          break;
        }
        await new Promise((r) => setTimeout(r, 140));
      }

      // 恢复用户原本的 CC 关闭状态
      btn = findCaptionButton();
      if (btn && !wasPressed && btn.getAttribute('aria-pressed') === 'true') {
        btn.click();
      }
    }

    async function loadCaptionsForCurrentVideo(force = false) {
      const videoId = getVideoIdFromLocation();
      if (!videoId) return;
      if (!force && (videoId === activeVideoId || videoId === fetchingVideoId)) return;

      const runId = ++activeRunId;
      fetchingVideoId = videoId;
      emitProgress(videoId, 15, '正在读取视频信息与字幕轨列表...');

      let meta: { title: string; tracks: CaptionTrack[] } | null = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        if (runId !== activeRunId) return;
        meta = extractTracksAndMeta(videoId);
        if (meta && (meta.tracks.length > 0 || attempt >= 5)) break;
        if (attempt === 5 && !meta) {
          emitProgress(videoId, 28, '播放器初始化较慢，正在备用通道读取视频字幕列表...');
          meta = await fetchWatchHtmlMeta(videoId);
          if (meta) break;
        }
        await new Promise((r) => setTimeout(r, 280));
      }
      if (runId !== activeRunId) return;

      if (!meta || meta.tracks.length === 0) {
        emitProgress(videoId, 100, '完成检测');
        activeVideoId = videoId;
        fetchingVideoId = '';
        window.postMessage(
          {
            type: 'SH_CAPTION_DATA',
            videoId,
            title: meta?.title || document.title.replace(/\s*-\s*YouTube$/, ''),
            hasCaptions: false,
            failReason: meta
              ? '该视频在 YouTube 上未提供任何可用字幕轨（无人工字幕也无自动生成字幕）。'
              : '未能从 YouTube 页面读取到播放器数据，请点击「重新尝试获取字幕」。',
          },
          '*',
        );
        return;
      }

      const { manualTrack, asrTrack } = selectEnglishTracks(meta.tracks);
      const trackLabel = [manualTrack?.name, asrTrack?.name].filter(Boolean).join(' / ') || '字幕轨';
      emitProgress(videoId, 48, `检测到「${trackLabel}」，正在拉取逐词字幕数据...`);

      let manualData = manualTrack ? await fetchTrackPayload(videoId, manualTrack) : null;
      if (runId !== activeRunId) return;
      let asrData = asrTrack ? await fetchTrackPayload(videoId, asrTrack) : null;
      if (runId !== activeRunId) return;

      if (!manualData && !asrData && (manualTrack || asrTrack)) {
        emitProgress(videoId, 74, '需要播放器 PoToken 安全校验，正在唤醒字幕模块获取...');
        await nudgePlayerCaptions(videoId, (manualTrack || asrTrack)?.languageCode);
        if (runId !== activeRunId) return;

        emitProgress(videoId, 88, '校验完成，正在重新读取字幕内容...');
        if (manualTrack) manualData = await fetchTrackPayload(videoId, manualTrack);
        if (runId !== activeRunId) return;
        if (asrTrack) asrData = await fetchTrackPayload(videoId, asrTrack);
        if (runId !== activeRunId) return;
      }

      const zhTrack = selectChineseTrack(meta.tracks);
      const zhData = (manualData || asrData) && zhTrack ? await fetchTrackPayload(videoId, zhTrack) : null;
      if (runId !== activeRunId) return;

      const hasCaptions = Boolean(manualData || asrData);
      emitProgress(videoId, 96, hasCaptions ? '正在解析逐词时间轴与智能分句...' : '拉取结束');

      activeVideoId = videoId;
      fetchingVideoId = '';
      window.postMessage(
        {
          type: 'SH_CAPTION_DATA',
          videoId,
          title: meta.title,
          hasCaptions,
          failReason: hasCaptions
            ? undefined
            : `已检测到字幕轨（${trackLabel}），但 YouTube 接口返回空数据或 PoToken 校验超时（可先在播放器开启一下 CC 字幕后再点重试）。`,
          tracks: meta.tracks,
          manualJson3: manualData?.json3 ?? null,
          manualXml: manualData?.xml ?? null,
          asrJson3: asrData?.json3 ?? null,
          asrXml: asrData?.xml ?? null,
          zhJson3: zhData?.json3 ?? null,
          zhXml: zhData?.xml ?? null,
        },
        '*',
      );
    }

    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data) return;
      if (e.data.type === 'SH_REQUEST_CAPTIONS') {
        loadCaptionsForCurrentVideo(true);
      } else if (e.data.type === 'SH_CAPTURED_TIMEDTEXT') {
        if (
          e.data.videoId &&
          e.data.videoId === getVideoIdFromLocation() &&
          fetchingVideoId !== e.data.videoId &&
          activeVideoId !== e.data.videoId
        ) {
          loadCaptionsForCurrentVideo(true);
        }
      }
    });

    const onNavigate = () => {
      activeVideoId = '';
      fetchingVideoId = '';
      loadCaptionsForCurrentVideo(true);
    };
    window.addEventListener('yt-navigate-finish', onNavigate);
    window.addEventListener('state-navigateend', onNavigate);
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
