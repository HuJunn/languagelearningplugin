export const PANEL_CSS = `
:host, .sh-root {
  --sh-bg-rgb: 18, 20, 26;
  --sh-card-rgb: 26, 29, 38;
  --sh-bg-alpha: 0.92;
  --sh-border: rgba(255, 255, 255, 0.12);
  --sh-text: #f1f5f9;
  --sh-muted: #94a3b8;
  --sh-word-dim: #cbd5e1;
  --sh-accent: #38bdf8;
  --sh-done: #38bdf8;
  --sh-active-bg: rgba(56, 189, 248, 0.13);
  --sh-hover-bg: rgba(255, 255, 255, 0.06);
  --sh-badge-bg: rgba(56, 189, 248, 0.16);
  --sh-warn: #fbbf24;
  --sh-success: #34d399;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: var(--sh-text);
  box-sizing: border-box;
}

.sh-root *, .sh-root *::before, .sh-root *::after {
  box-sizing: border-box;
}

.sh-panel {
  display: flex;
  flex-direction: column;
  background: rgba(var(--sh-bg-rgb), var(--sh-bg-alpha));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--sh-border);
  border-radius: 12px;
  color: var(--sh-text);
  overflow: hidden;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
  user-select: none;
  -webkit-user-select: none;
  overscroll-behavior: contain;
}

.sh-panel.sh-mode-c {
  position: fixed;
  z-index: 2147483640;
}

.sh-panel.sh-mode-d {
  position: relative;
  width: 100%;
  margin: 10px 0 14px 0;
  z-index: 2000;
}

/* Header */
.sh-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(var(--sh-card-rgb), calc(min(1, var(--sh-bg-alpha) + 0.05)));
  border-bottom: 1px solid var(--sh-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.sh-header.sh-draggable {
  cursor: move;
  touch-action: none;
}

.sh-title {
  font-weight: 700;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.sh-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--sh-badge-bg);
  color: var(--sh-accent);
  font-weight: 500;
  white-space: nowrap;
}

.sh-ver-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--sh-border);
  background: rgba(255, 255, 255, 0.06);
  color: var(--sh-muted);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.sh-ver-badge:hover {
  background: rgba(255, 255, 255, 0.14);
  color: var(--sh-text);
}

.sh-ver-badge.sh-has-update {
  background: rgba(52, 211, 153, 0.18);
  border-color: rgba(52, 211, 153, 0.55);
  color: var(--sh-success);
  font-weight: 600;
}

.sh-spacer {
  flex: 1;
  min-width: 4px;
}

.sh-ctrl-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--sh-border);
  background: rgba(255, 255, 255, 0.05);
  color: var(--sh-text);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.sh-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
}

.sh-btn.sh-btn-active {
  background: var(--sh-accent);
  color: #0f172a;
  border-color: var(--sh-accent);
  font-weight: 600;
}

.sh-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--sh-text);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
}

.sh-switch:hover {
  background: rgba(255, 255, 255, 0.09);
}

.sh-switch input {
  accent-color: var(--sh-accent);
  cursor: pointer;
  margin: 0;
}

/* Mode C Toolbar (Opacity & Quick Resize) */
.sh-subbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 12px;
  background: rgba(0, 0, 0, 0.22);
  border-bottom: 1px solid var(--sh-border);
  font-size: 11px;
  color: var(--sh-muted);
  flex-shrink: 0;
  flex-wrap: wrap;
  touch-action: none;
}

.sh-slider-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sh-slider-wrap input[type="range"] {
  width: 76px;
  height: 4px;
  accent-color: var(--sh-accent);
  cursor: pointer;
  touch-action: pan-x;
}

/* Sentence List */
.sh-list {
  position: relative;
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
  scroll-behavior: smooth;
  overscroll-behavior: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}

.sh-list-spacer {
  height: var(--sh-spacer-h, 140px);
  pointer-events: none;
  flex-shrink: 0;
}

.sh-list::-webkit-scrollbar {
  width: 6px;
}
.sh-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

/* Caption Loading Progress & Empty State */
.sh-state-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px 20px;
  text-align: center;
  color: var(--sh-muted);
  min-height: 180px;
}

.sh-progress-wrap {
  width: 100%;
  max-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sh-progress-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--sh-text);
}

.sh-progress-bar {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.sh-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--sh-accent), #60a5fa);
  transition: width 0.28s ease-out;
}

.sh-progress-detail {
  font-size: 11.5px;
  color: var(--sh-muted);
}

.sh-sent-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 3px;
  border-radius: 8px;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: background 0.12s;
}

.sh-sent-row:hover {
  background: var(--sh-hover-bg);
}

.sh-sent-row.sh-active {
  border-left-color: var(--sh-accent);
  background: var(--sh-active-bg);
}

.sh-time-col {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--sh-muted);
  font-variant-numeric: tabular-nums;
  padding-top: 3px;
  min-width: 48px;
  flex-shrink: 0;
}

.sh-play-icon {
  font-size: 10px;
  opacity: 0.55;
  transition: opacity 0.12s, color 0.12s;
}

.sh-sent-row:hover .sh-play-icon,
.sh-sent-row.sh-active .sh-play-icon {
  opacity: 1;
  color: var(--sh-accent);
}

.sh-sent-body {
  flex: 1;
  min-width: 0;
}

.sh-words-line {
  font-size: 14.5px;
  line-height: 1.65;
  word-wrap: break-word;
}

/* Word token */
.sh-word {
  display: inline;
  padding: 1px 2px;
  margin: 0 1px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--sh-text);
  transition: background-color 0.1s;
}

.sh-word:hover {
  background-color: rgba(56, 189, 248, 0.22);
  text-decoration: underline dotted var(--sh-accent);
  text-underline-offset: 3px;
}

/* Corrected by manual vs ASR alignment */
.sh-word.sh-corrected {
  border-bottom: 1px dashed var(--sh-warn);
}

/* Karaoke Lyric Gradient on active sentence */
.sh-sent-row.sh-active .sh-word {
  color: var(--sh-word-dim);
}

.sh-sent-row.sh-active .sh-word.sh-done {
  color: var(--sh-done);
  font-weight: 500;
}

.sh-sent-row.sh-active .sh-word.sh-cur {
  background-image: linear-gradient(90deg, var(--sh-accent) var(--p, 0%), var(--sh-word-dim) var(--p, 0%));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 600;
}

.sh-zh-line {
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--sh-muted);
}

/* Footer */
.sh-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-top: 1px solid var(--sh-border);
  background: rgba(var(--sh-card-rgb), calc(min(1, var(--sh-bg-alpha) + 0.05)));
  font-size: 11px;
  color: var(--sh-muted);
  flex-shrink: 0;
  flex-wrap: wrap;
  touch-action: none;
}

.sh-kbd {
  display: inline-block;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--sh-border);
  font-family: monospace;
  font-size: 10.5px;
  color: var(--sh-text);
}

/* Resize handles */
.sh-resize-r {
  position: absolute;
  top: 0;
  right: 0;
  width: 10px;
  height: 100%;
  cursor: ew-resize;
  touch-action: none;
}
.sh-resize-b {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 10px;
  cursor: ns-resize;
  touch-action: none;
}
.sh-resize-br {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 24px;
  height: 24px;
  cursor: nwse-resize;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 3px;
  color: var(--sh-muted);
  font-size: 11px;
  opacity: 0.65;
  touch-action: none;
}
.sh-resize-br:hover {
  opacity: 1;
  color: var(--sh-accent);
}

/* Word Popover */
.sh-popover {
  position: fixed;
  z-index: 2147483646;
  width: 290px;
  background: rgb(22, 25, 34);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.65);
  padding: 11px 13px;
  color: var(--sh-text);
  font-size: 12.5px;
}

.sh-pop-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}

.sh-pop-word {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.sh-pop-phon {
  font-size: 12px;
  color: var(--sh-accent);
  font-family: "Lucida Sans Unicode", "Segoe UI", sans-serif;
}

.sh-pop-sec {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.sh-pop-tag {
  display: inline-block;
  font-size: 10px;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--sh-muted);
  margin-right: 5px;
}

/* Drawer / Modal inside panel */
.sh-drawer {
  padding: 10px 12px;
  background: rgba(15, 18, 25, 0.96);
  border-bottom: 1px solid var(--sh-border);
  max-height: 240px;
  overflow-y: auto;
  font-size: 12px;
  overscroll-behavior: contain;
  touch-action: pan-y;
}

.sh-textarea {
  width: 100%;
  min-height: 80px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--sh-border);
  border-radius: 6px;
  color: var(--sh-text);
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
}

.sh-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483647;
  background: var(--sh-accent);
  color: #0f172a;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  font-size: 12.5px;
}
`;
