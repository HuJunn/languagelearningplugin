# 口语跟读 Shadowing · Android / 平板 (Tab S10+) 适配版

本项目位于 `E:\antigravitytest\Android适配`，针对 **Android 版 Edge Canary / 狐猴浏览器** 与 **蓝牙手柄控制** 进行了完整适配。

## 一、构建产物与平板存储路径

- **电脑端源码与打包目录**：`E:\antigravitytest\Android适配`
  - **Edge Canary 签名扩展包 (`.crx`)**：`E:\antigravitytest\Android适配\.output\yt-shadowing-android-v<version>.crx`（发布目录仅保留当前最新版 `releases/android/yt-shadowing-android-v0.2.5.crx`）
  - **通用压缩扩展包 (`.zip`)**：`E:\antigravitytest\Android适配\.output\yt-shadowing-android-v<version>.zip`（发布目录 `releases/android/yt-shadowing-android-v0.2.5.zip`）
  - **解压版目录**：`E:\antigravitytest\Android适配\.output\edge-mv3`
  - **Extension ID**：`lhdmcaldclifffhakehnlhechjmhjkii`
- **平板端 (jun 的 Tab S10+) 目标目录**：
  - Windows 资源管理器路径：`此电脑\jun 的 Tab S10+\内部存储\Androiddevelopment\languageplugin`
  - Android ADB 路径：`/sdcard/Androiddevelopment/languageplugin`

---

## 二、新增 Android 与蓝牙手柄特性

1. **蓝牙手柄原生支持（Web Gamepad API `navigator.getGamepads()`）**
   - 手柄连接后，面板顶部自动显示 `🎮 手柄已连接` 徽标，无需切换输入法，不影响平板软键盘弹出：
     - **A 键 (`buttons[0]`) 或 R2 (`buttons[7]`)**：重播当前句（对应键盘 `R`）
     - **B 键 (`buttons[1]`) 或 Start (`buttons[9]`)**：播放 / 暂停视频
     - **十字键左/上 (`buttons[14/12]`)、L1 (`buttons[4]`) 或左摇杆上/左**：上一句（对应键盘 `A`）
     - **十字键右/下 (`buttons[15/13]`)、R1 (`buttons[5]`) 或左摇杆下/右**：下一句（对应键盘 `D`）
     - **X 键 (`buttons[2]`)**：切换「整句中文译文」（对应键盘 `T`）
     - **Y 键 (`buttons[3]`)**：切换「读完自动暂停」（对应键盘 `P`）
     - **Select / `-` 键 (`buttons[8]`)**：随时隐藏 / 重新打开跟读窗口（对应键盘 `H`）

2. **平板/手机触屏手势与 `m.youtube.com` 适配**
   - 同时支持 `www.youtube.com`（平板桌面模式）与 `m.youtube.com`（移动网页模式）。
   - **方案 C（悬浮窗）** 支持长按 `🗣 口语跟读` 标签拖动面板位置，及长按右下角 `◢` 调整窗口大小（均使用原生 non-passive 触摸与捕获阶段事件，彻底隔离开网页滚动）。
   - **正在播放的句子始终保持在插件列表正中央**，首尾句带动态居中留白。

---

## 三、在 Tab S10+ 的 Edge Canary 中安装 `.crx` 步骤

1. 打开平板上的 **Microsoft Edge Canary**。
2. 进入 **设置 (Settings) → 关于 Microsoft Edge (About Microsoft Edge)**，连续点击底部的 **Edge 版本号 5 次**，开启开发者选项。
3. 返回设置页，进入 **Developer options（开发者选项）**。
4. 点击 **Extension install by .crx**，选择平板 `/sdcard/Androiddevelopment/languageplugin/yt-shadowing-android-v0.2.5.crx` 即可完成安装。
