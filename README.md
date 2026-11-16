# 🗣 口语跟读 Shadowing Plugin (Desktop & Android)

专为 **YouTube**（后续可扩展 Bilibili）打造的口语跟读（Shadowing）浏览器插件，基于 **WXT + TypeScript + React (Manifest V3)** 构建。支持歌词式逐词流动染色、人工×自动字幕逐词校准、0 延迟点词翻译、单句读完自动暂停、居中歌词滚动以及一键按视频原链接分割导出到 **Obsidian 生词表**。

---

## 📦 下载与安装指南（桌面版 vs 手机/平板版）

本仓库提供 **💻 桌面版** 与 **📱 Android 手机/平板适配版（含蓝牙手柄控制）** 两个独立构建版本，请根据你的设备选择对应安装包：

| 平台版本 | 适用设备与浏览器 | 直接下载安装包 | 对应源码目录 |
| :--- | :--- | :--- | :--- |
| **💻 桌面版 (Desktop)** | Windows / macOS / Linux<br>Microsoft Edge · Google Chrome | 👉 [**`yt-shadowing-desktop.zip`**](./releases/desktop/yt-shadowing-desktop.zip) | [`./口语插件`](./口语插件) |
| **📱 手机/平板版 (Android CRX)** | Android 手机 / 平板（如 Galaxy Tab S10+）<br>**Microsoft Edge Canary (安卓版)** | 👉 [**`yt-shadowing-android.crx`**](./releases/android/yt-shadowing-android.crx)<br>*(支持通过 [`updates.xml`](./releases/android/updates.xml) 自动更新)* | [`./Android适配`](./Android适配) |
| **📱 手机/平板版 (Android ZIP)** | Android 手机 / 平板<br>**狐猴浏览器 (Lemur Browser)** | 👉 [**`yt-shadowing-android.zip`**](./releases/android/yt-shadowing-android.zip) | [`./Android适配`](./Android适配) |

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
1. 下载上表中的 [**`releases/android/yt-shadowing-android.crx`**](./releases/android/yt-shadowing-android.crx) 到手机/平板存储中（例如 `/sdcard/Androiddevelopment/languageplugin/`）。
2. 打开安卓端 **Microsoft Edge Canary**，进入 **设置 (Settings) → 关于 Microsoft Edge (About Microsoft Edge)**。
3. 连续点击底部的 **Edge 版本号 5 次**，激活开发者选项。
4. 返回上一级设置页面，进入 **Developer options（开发者选项）**。
5. 点击 **Extension install by .crx**，选择下载好的 `yt-shadowing-android.crx` 即可完成安装（Extension ID: `lhdmcaldclifffhakehnlhechjmhjkii`）。
6. **后续自动更新**：由于内置了指向本仓库 [`releases/android/updates.xml`](./releases/android/updates.xml) 的 `update_url`，后续版本升级时只需在 `edge://extensions` 页面点击「更新」即可自动完成无线升级。

#### 方式 B：狐猴浏览器 (Lemur Browser)
1. 下载上表中的 [**`releases/android/yt-shadowing-android.zip`**](./releases/android/yt-shadowing-android.zip)（或 `.crx`）。
2. 打开狐猴浏览器扩展管理页（`chrome://extensions`），开启右上角「开发者模式」，点击「加载 `.zip` / `.crx`」选择该文件即可。

---

## ✨ 核心功能特性

1. **双模式布局（方案 C & 方案 D）+ 全屏自动切换**
   - **方案 C（悬浮可拖动窗）**：支持鼠标或触屏/S-Pen 拖动位置、拖动右下角 `◢` 手柄自由**调整窗口大小**，并提供 `20% ~ 100%` **背景透明度滑块**。
   - **方案 D（剧场模式 · 视频正下方）**：嵌入视频下方，宽屏显示长句不折行，支持上下拖拽调节面板高度。
   - **全屏自动切换为 C**：进入视频全屏（Fullscreen）时自动切换为悬浮模式 C；退出全屏后自动恢复原模式。
2. **居中歌词滚动 & 60fps 逐词颜色渐变**
   - **当前播放句始终位于插件列表正中央**（首尾句带动态居中留白）。
   - 读取 YouTube 自动字幕（ASR `json3`）自带的毫秒级逐词时间戳，配合说话进度实现平滑的卡拉 OK 线性颜色渐变。
3. **人工字幕 × 自动字幕自动对齐校准**
   - 当视频同时拥有人工字幕与自动字幕时，通过半全局动态规划算法（`alignManualToAsr`）对比两者：**存在差异时用人工字幕修正识别错误的单词，同时保留自动字幕的逐词时间戳**（被修正词带有虚线下划线标注）。
   - 对于仅有自动字幕的视频，也可点击顶部 `🛠 校准` 粘贴 Obsidian Clipper 剪藏文本或 SRT/VTT 字幕进行实时校准。
4. **0 延迟点击交互（无单双击延迟冲突）**
   - **单击单词处**：**0 延迟**立即弹出词典卡片（内置 4.6 万词离线 ECDICT 音标与中文释义 + 自动词形还原 + Bing/Edge 与 Google 双通道在线翻译 + 🔊 TTS 朗读 + 一键加入生词本）。
   - **单击句子空白处 / 时间戳 / 译文行**：**0 延迟**立即跳转到该句开头播放，并默认在**读完这一句后自动暂停视频**（句尾留有安全间隔，绝不误跳入下一句）。
5. **整句中文译文开关**
   - 顶部提供 `译文` 开关（默认关闭），打开后自动批量翻译整句中文并显示在每句英文下方。
6. **Obsidian 生词表导出（按视频原链接分割）**
   - 按 `## [视频标题](视频原链接)` 自动分块并去重，支持通过 `obsidian://new?vault=codex-obsidian&file=languagelearning%2F%E7%94%9F%E8%AF%8D%E8%A1%A8&append=true` 一键追加到桌面端或移动端 Obsidian，或直接关联写入本地 `生词表.md`。

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
| **打开 / 临时隐藏跟读窗口** | `H` | **Select / `-` 键** (`buttons[8]`) |

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
npm run build:mobile  # 一键构建并签名生成 .output/yt-shadowing.crx、yt-shadowing.zip 与 updates.xml
```
