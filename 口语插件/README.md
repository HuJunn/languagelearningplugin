# 口语跟读 Shadowing · Edge 浏览器插件

专为 YouTube（后续可扩展 Bilibili）打造的口语跟读浏览器插件（基于 WXT + TypeScript + React + Manifest V3）。

## 一、核心功能对照

1. **双模式布局（方案 C & 方案 D）+ 全屏自动切换**
   - **方案 C（悬浮可拖动面板）**：
     - 拖动顶部标题栏可任意移动位置；
     - 支持**调整窗口大小**（拖动右边缘、下边缘、右下角 `◢` 手柄，或点击「紧凑 / 标准 / 宽屏」预设）；
     - 支持**调整背景透明度**（`20% ~ 100%` 滑块实时调节，毛玻璃效果不挡字幕阅读）。
   - **方案 D（剧场模式 · 视频下方）**：
     - 切换至 `剧场 D` 时自动开启 YouTube 剧场模式，并将面板嵌入在视频播放器正下方（底部边缘支持上下拖拽调节高度）。
   - **全屏自动切换为 C**：
     - 进入视频全屏（`Fullscreen`）时，插件自动挂载到全屏层并切换为**方案 C（悬浮窗）**；退出全屏后自动恢复此前选择的模式。

2. **零延迟交互（无单双击冲突）**
   - **单击单词**：**0 延迟**立即弹出词典卡片（内置 4.6 万词离线 ECDICT 音标与中文释义 + 自动词形还原 + Bing/Edge 与 Google 在线双通道翻译 + 🔊 TTS 发音 + 一键加入生词本）。
   - **单击句子空白处 / 时间戳 / 译文行**：**0 延迟**立即跳转到该句开头播放，并默认在**读完这一句后自动暂停视频**（可通过顶部「读完暂停」开关切换）。

3. **歌词式逐词颜色渐变 + 人工/自动字幕对齐校准**
   - **60fps 歌词流动高亮**：根据 YouTube 自动字幕（ASR `json3`）自带的毫秒级逐词时间戳，配合说话进度实时渲染单字/单词线性渐变（`linear-gradient`）。
   - **人工字幕 × 自动字幕自动对比替换**：
     - 当视频同时存在人工字幕与自动字幕时，使用半全局动态规划算法（`alignManualToAsr`）对比两者：若单词存在差异，**用人工字幕替换自动字幕识别错误的单词，同时保留自动字幕的逐词时间戳**（被修正的词带有底部虚线标记，悬停可查看原 ASR 词）。
     - 若视频仅有自动字幕（如测试视频 `I Opened A FREE Carwash`），也可点击顶部 `🛠 校准` 粘贴 Obsidian Clipper 剪藏文本或 SRT 字幕进行实时校准。

4. **整句译文开关（默认关闭）**
   - 顶部提供 `译文` 开关（默认关闭，或按快捷键 `T`），开启后自动批量翻译整句中文并显示在每句英文下方。

5. **快捷键支持**
   - `R` 或 `S`：重播当前句（跳回句首播放，读完自动暂停）
   - `A` / `D`（或 `Shift + ←` / `Shift + →`）：切换上一句 / 下一句
   - `P` 或 `Q`：切换「读完自动暂停」
   - `T`：切换「整句中文译文」
   - `H`：打开 / 临时隐藏跟读窗口

6. **导出到 Obsidian 生词表（按视频原链接分割）**
   - 目标路径：`obsidian://open?vault=codex-obsidian&file=languagelearning%2F%E7%94%9F%E8%AF%8D%E8%A1%A8`（对应本地 `E:\CODEX\codex-obsidian\languagelearning\生词表.md`）。
   - 支持三种导出方式（均按 `## [视频标题](视频原链接)` 分割区块）：
     1. **⚡ URI 一键追加到 Obsidian**：直接调用 `obsidian://new?vault=codex-obsidian&file=languagelearning%2F%E7%94%9F%E8%AF%8D%E8%A1%A8&append=true&content=...` 唤起 Obsidian 并追加生词；
     2. **📂 写入本地《生词表.md》**：首次选择 `E:\CODEX\codex-obsidian\languagelearning\生词表.md` 后，自动按视频原链接原位合并去重并打开 Obsidian；
     3. **📋 复制 Markdown 并打开 Obsidian**。

---

## 二、在 Microsoft Edge 中加载插件

1. 构建产物位于：
   `E:\antigravitytest\.output\edge-mv3`
2. 打开 Edge 浏览器，访问：
   `edge://extensions/`
3. 开启左侧的 **「开发人员模式 (Developer mode)」**。
4. 点击右上角 **「加载解压缩的扩展 (Load unpacked)」**，选择文件夹：
   `E:\antigravitytest\.output\edge-mv3`
5. 打开测试视频 [I Opened A FREE Carwash](https://www.youtube.com/watch?v=nJs7YXLYu0A) 即可开始跟读测试。

## 三、开发与测试命令

```bash
# 运行单元测试（包含真实视频 json3 解析、人工/ASR 对齐、离线词典与 Obsidian 导出测试）
npm test

# 重新构建离线 ECDICT 词典 (public/dict.json)
npm run build:dict

# 构建 Edge 扩展 (.output/edge-mv3)
npm run build
```
