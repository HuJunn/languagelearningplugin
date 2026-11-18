# 🗣 口语跟读 Shadowing Plugin (Desktop & Android)

专为 **YouTube**（后续可扩展 Bilibili）打造的口语跟读（Shadowing）浏览器插件，基于 **WXT + TypeScript + React (Manifest V3)** 构建。支持歌词式逐词流动染色、人工×自动字幕逐词校准、0 延迟点词翻译、单句读完自动暂停、居中歌词滚动以及一键按视频原链接分割导出到 **Obsidian 生词表**。

---

## 📦 下载与安装指南（桌面版 vs 手机/平板版）

本仓库提供 **💻 桌面版** 与 **📱 Android 手机/平板适配版（含蓝牙手柄控制）** 两个独立构建版本，请根据你的设备选择对应安装包：

| 平台版本 | 适用设备与浏览器 | 直接下载安装包 | 对应源码目录 |
| :--- | :--- | :--- | :--- |
| **💻 桌面版 (Desktop `v0.1.8`)** | Windows / macOS / Linux<br>Microsoft Edge · Google Chrome | 👉 [**`yt-shadowing-desktop.zip`**](./releases/desktop/yt-shadowing-desktop.zip) | [`./口语插件`](./口语插件) |
| **📱 手机/平板版 (Android CRX `v0.2.3`)** | Android 手机 / 平板（如 Galaxy Tab S10+）<br>**Microsoft Edge Canary (安卓版)** | 👉 [**`yt-shadowing-android-v0.2.3.crx`**](./releases/android/yt-shadowing-android-v0.2.3.crx)<br>*(支持通过 [`updates.xml`](./releases/android/updates.xml) 自动更新)* | [`./Android适配`](./Android适配) |
| **📱 手机/平板版 (Android ZIP `v0.2.3`)** | Android 手机 / 平板<br>**狐猴浏览器 (Lemur Browser)** | 👉 [**`yt-shadowing-android.zip`**](./releases/android/yt-shadowing-android.zip) | [`./Android适配`](./Android适配) |

---

### 💻 桌面版安装步骤（Edge / Chrome）

1. 下载上表中的 [**`releases/desktop/yt-shadowing-desktop.zip`**](./releases/desktop/yt-shadowing-desktop.zip) 并解压到本地任意固定文件夹（如 `yt-shadowing-desktop`）。
2. 打开电脑端 Edge 浏览器，在地址栏输入 `edge://extensions/` 并回车。
3. 打开左侧（或右上角）的 **「开发人员模式 (Developer mode)」**。
4. 点击 **「加载解压缩的扩展 (Load unpacked)」**，选择刚才解压出来的文件夹即可。
5. 打开任意英文 YouTube 视频（如测试视频 [I Opened A FREE Carwash](https://www.youtube.com/watch?v=nJs7YXLYu0A)）即可开始跟读。

---

### 📱 手机 / 平板版安装步骤（Android）

#### 方式 A：Microsoft Edge Canary 安卓版（推荐，内核最新，支持自动更新）
1. 下载上表中的 [**`releases/android/yt-shadowing-android-v0.2.3.crx`**](./releases/android/yt-shadowing-android-v0.2.3.crx) 到手机/平板存储中（例如 `/sdcard/Androiddevelopment/languageplugin/`）。
2. 打开安卓端 **Microsoft Edge Canary**，进入 **设置 (Settings) → 关于 Microsoft Edge (About Microsoft Edge)**。
3. 连续点击底部的 **Edge 版本号 5 次**，激活开发者选项。
4. 返回上一级设置页面，进入 **Developer options（开发者选项）**。
5. 点击 **Extension install by .crx**，选择下载好的 `yt-shadowing-android-v0.2.3.crx` 即可完成安装（Extension ID: `lhdmcaldclifffhakehnlhechjmhjkii`）。
6. **后续自动更新与手动检查**：由于内置了指向本仓库 [`releases/android/updates.xml`](./releases/android/updates.xml) 的 `update_url`，浏览器会定期自动更新；也可随时点击面板顶部版本号徽标检查新版（有新版才跳转最新 `yt-shadowing-android-v0.x.x.crx` 下载，已是最新则停留在当前页提示）。

#### 方式 B：狐猴浏览器 (Lemur Browser)
1. 下载上表中的 [**`releases/android/yt-shadowing-android.zip`**](./releases/android/yt-shadowing-android.zip)（或 `.crx`）。
2. 打开狐猴浏览器扩展管理页（`chrome://extensions`），开启右上角「开发者模式」，点击「加载 `.zip` / `.crx`」选择该文件即可。

---

## ✨ 核心功能特性

1. **双模式布局（方案 C & 方案 D）+ 全屏自动切换**
   - **方案 C（悬浮可拖动窗）**：Android 端仅支持**长按顶部 `🗣 口语跟读` 标签**拖动面板位置（避免与页面滑动冲突），提供 `20% ~ 100%` **背景透明度滑块**。
   - **方案 D（剧场模式 · 视频正下方）**：嵌入视频下方，宽屏显示长句不折行。
   - **全屏自动切换为 C**：进入视频全屏（Fullscreen）时自动切换为悬浮模式 C；退出全屏后自动恢复原模式。
2. **居中歌词滚动 & 60fps 逐词颜色渐变**
   - **当前播放句始终位于插件列表正中央**（首尾句带动态居中留白），句尾时间严格不越过下一句起点，开头自适应预卷不吞词。
   - 读取 YouTube 自动字幕（ASR `json3`）自带的毫秒级逐词时间戳，配合说话进度实现平滑的卡拉 OK 线性颜色渐变。
3. **双语字幕分离 · 人工×自动字幕对齐校准**
   - 对内嵌中英双语的字幕（如《走遍美国》），默认只显示纯英文跟读文本；点击 `译文` 后展示视频自带的中文译文。
   - 同时拥有人工字幕与自动字幕时，自动对比修正错词并保留逐词时间戳；仅有自动字幕时可通过 `🛠 校准` 导入修订文本。
4. **0 延迟点击、长视频多点标记与相邻句连接**
   - **单击单词处**：`0` 延迟弹出离线 ECDICT 音标释义 + 双通道在线翻译 + 🔊 TTS 朗读 + 一键加入生词本。
   - **单击句子空白处 / 时间戳**：立即跳转到该句开头播放，开启「读完暂停」后读完自动暂停。
   - **长视频多点标记（`🔖 标记` / `📍` / `M` 键）**：可对同一视频标记多个位置，顶部展示快捷时间胶囊条，重新打开视频一键定位上次进度。
   - **相邻句子连接（`🔗 连接`）**：可将两个紧邻的断句合并为连续长句（仅允许相邻句子），点时间左侧 `❎` 随时取消连接。
   - **5 档倍速控制**：支持 `0.5x` / `0.75x` / `1x` / `1.25x` / `1.5x`，快捷键 `[` / `]` 实时调速；在 `H` 隐藏模式下所有快捷键依然可用。
5. **Obsidian 表格模板导出（先查重再写入）**
   - 按《界面选型》4 列表格模板（`| 时间 | 词汇与音标 | 词性与核心释义 | 原声双语语境 |` + YAML frontmatter）导出。桌面端先读取真实 `.md` 文件匹配标题，无同标题按完整模板导入，有同标题则只追加可新增词汇。

---

## ⌨️ 桌面端键盘快捷键 vs 🎮 手机/平板蓝牙手柄操作对照

手机/平板版通过标准 **Web Gamepad API (`navigator.getGamepads()`)** 原生支持各类蓝牙手柄（如单只 Switch Joy-Con、八位堂 Micro/Zero 2、Xbox、DualSense 等），连接后顶部显示 `🎮 手柄已连接` 标识，**不占用系统输入法、不影响软键盘弹出**：

| 功能操作 | 💻 桌面端键盘快捷键 | 🎮 手机/平板蓝牙手柄按键 |
| :--- | :--- | :--- |
| **重听当前句**（跳回句首播放，读完自动暂停） | `R` 或 `S` | **A 键** (`buttons[0]`) 或 **R2** (`buttons[7]`) |
| **上一句** | `A` 或 `Shift + ←` | **十字键左/上**、**L1** 或 **左摇杆左/上** |
| **下一句** | `D` 或 `Shift + →` | **十字键右/下**、**R1** 或 **左摇杆右/下** |
| **播放 / 暂停视频** | `Space`（播放器原生） | **B 键** (`buttons[1]`) 或 **Start** (`buttons[9]`) |
| **开关「读完自动暂停」** | `P` 或 `Q` | **Y 键** (`buttons[3]`) |
| **开关「整句中文译文」** | `T` | **X 键** (`buttons[2]`) |
| **打开 / 临时隐藏跟读窗口（隐藏后快捷键仍有效）** | `H` | **Select / `-` 键** (`buttons[8]`) |
| **标记当前字幕位置** | `M` | — |
| **播放倍速减速 / 加速（0.5x~1.5x）** | `[` / `]` | — |

---

## 🛠️ 本地二次开发与构建

```bash
# 1. 构建桌面版（位于 ./口语插件）
cd 口语插件
npm install
npm test          # 运行单元测试
npm run build     # 构建解压版至 .output/edge-mv3
npm run zip       # 打包桌面端 zip

# 2. 构建 Android 手机/平板版（位于 ./Android适配）
cd ../Android适配
npm install
npm test          # 运行单元测试
npm run build:mobile  # 一键构建并签名生成 .output/yt-shadowing-android-v<version>.crx、yt-shadowing.zip 与 updates.xml
```
