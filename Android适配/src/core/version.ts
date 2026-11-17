export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  downloadUrl: string;
  repoUrl: string;
  platform: 'android' | 'desktop';
}

export const GITHUB_REPO_URL = 'https://github.com/HuJunn/languagelearningplugin';
export const ANDROID_UPDATES_XML_URL =
  'https://raw.githubusercontent.com/HuJunn/languagelearningplugin/main/releases/android/updates.xml';
export const DESKTOP_PACKAGE_JSON_URL =
  'https://raw.githubusercontent.com/HuJunn/languagelearningplugin/main/%E5%8F%A3%E8%AF%AD%E6%8F%92%E4%BB%B6/package.json';
export const ANDROID_CRX_DOWNLOAD_URL =
  'https://github.com/HuJunn/languagelearningplugin/raw/main/releases/android/yt-shadowing-android.crx';
export const DESKTOP_ZIP_DOWNLOAD_URL =
  'https://github.com/HuJunn/languagelearningplugin/raw/main/releases/desktop/yt-shadowing-desktop.zip';

/** 比较语义化版本号：a > b 返回 1，a < b 返回 -1，相等返回 0 */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export function parseAndroidUpdatesXml(xml: string): { version: string; codebase?: string } | null {
  const verMatch = /version\s*=\s*['"]([^'"]+)['"]/i.exec(xml);
  if (!verMatch) return null;
  const codeMatch = /codebase\s*=\s*['"]([^'"]+)['"]/i.exec(xml);
  return { version: verMatch[1].trim(), codebase: codeMatch?.[1]?.trim() };
}

export async function checkGitHubUpdate(
  platform: 'android' | 'desktop',
  currentVersion: string,
): Promise<UpdateCheckResult> {
  const ts = Date.now();
  if (platform === 'android') {
    const resp = await fetch(`${ANDROID_UPDATES_XML_URL}?t=${ts}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    const parsed = parseAndroidUpdatesXml(xml);
    if (!parsed) throw new Error('Invalid updates.xml');
    return {
      currentVersion,
      latestVersion: parsed.version,
      hasUpdate: compareSemver(parsed.version, currentVersion) > 0,
      downloadUrl: ANDROID_CRX_DOWNLOAD_URL,
      repoUrl: GITHUB_REPO_URL,
      platform,
    };
  }

  const resp = await fetch(`${DESKTOP_PACKAGE_JSON_URL}?t=${ts}`, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const pkg = (await resp.json()) as { version?: string };
  const latestVersion = String(pkg?.version || '').trim();
  if (!latestVersion) throw new Error('Invalid package.json');
  return {
    currentVersion,
    latestVersion,
    hasUpdate: compareSemver(latestVersion, currentVersion) > 0,
    downloadUrl: DESKTOP_ZIP_DOWNLOAD_URL,
    repoUrl: GITHUB_REPO_URL,
    platform,
  };
}
