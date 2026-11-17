import { translateSentencesBatch, translateWordOnline } from '../src/core/translate';
import { checkGitHubUpdate } from '../src/core/version';

export default defineBackground(() => {
  // 点击浏览器工具栏扩展图标时，切换当前标签页的跟读面板显示/隐藏
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: 'SH_TOGGLE_PANEL' }).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;

    if (msg.type === 'SH_TRANSLATE_WORD') {
      translateWordOnline(String(msg.word ?? ''), msg.sentence ? String(msg.sentence) : undefined)
        .then((res) => sendResponse({ ok: true, ...res }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
      return true;
    }

    if (msg.type === 'SH_TRANSLATE_BATCH') {
      const list = Array.isArray(msg.sentences) ? msg.sentences.map(String) : [];
      translateSentencesBatch(list)
        .then((translations) => sendResponse({ ok: true, translations }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
      return true;
    }

    if (msg.type === 'SH_CHECK_UPDATE') {
      const manifest = chrome.runtime.getManifest();
      const platform = manifest.update_url ? 'android' : 'desktop';
      checkGitHubUpdate(platform, manifest.version)
        .then((res) => sendResponse({ ok: true, ...res }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
      return true;
    }

    return false;
  });
});
