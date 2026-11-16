import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '口语跟读 Shadowing (Android & Gamepad)',
    description: 'YouTube 字幕列表 · 逐词歌词渐变 · 点词翻译 · 读完自动暂停 · 蓝牙手柄 · 生词导出到 Obsidian',
    update_url: 'https://raw.githubusercontent.com/HuJunn/languagelearningplugin/main/releases/android/updates.xml',
    permissions: ['storage'],
    host_permissions: [
      'https://www.youtube.com/*',
      'https://m.youtube.com/*',
      'https://edge.microsoft.com/*',
      'https://api-edge.cognitive.microsofttranslator.com/*',
      'https://translate.googleapis.com/*',
    ],
    action: { default_title: '显示 / 隐藏跟读面板' },
    web_accessible_resources: [
      {
        resources: ['dict.json'],
        matches: ['https://www.youtube.com/*', 'https://m.youtube.com/*', '<all_urls>'],
      },
    ],
  },
});
