# 红房间声音实验室 · Red Room Voice Lab

《双峰》氛围的反向发音练习工具：正常录音 → 听倒放 → 重新模仿录音 → 倒放还原。

## GitHub Pages

网站文件已经放在 `main` 分支根目录。首次公开访问需要仓库所有者在 [Settings → Pages](https://github.com/coolcoldplay/red-room-voice-lab/settings/pages) 开启发布：

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/ (root)**
- 点击 **Save**。

发布成功后的预期地址：**https://coolcoldplay.github.io/red-room-voice-lab/**。以 Settings → Pages 显示的 Visit site 地址及部署状态为准。

之后提交到 `main` 的网站更新会沿用该发布配置。此项目不需要 npm、构建命令、API Key 或服务器后端。

## 使用

录入正常台词后，在完整波形上框选并建立片段。点击一个片段，在弹窗中听倒放、模仿录音、重录、换回上一版或裁切；各段分别倒放还原后，按原台词顺序合成。短句使用“全段作为 1 段”。

“台词提词板”提供可拖动的小浮窗，支持短句切换、字号调整和自写台词。内置 Fire walk with me 为合成语音，网页部署版压缩为 MP3，不是剧中采样或演员仿声。

支持 WAV 导出，以及含全部片段、录音及上一版的 JSON 工程保存。兼容旧版 v1–v3 工程。关闭前请保存工程，网页不自动备份录音。

## 隐私与麦克风

应用不上传音频，不包含第三方脚本或统计代码。加载网页时会请求本站静态资源；录音和音频处理留在访客自己的浏览器里。GitHub Pages 托管层的访问日志不由本应用控制。

首次录音需要浏览器授权。同一页面复用已授权的连接，未录音时将音轨静音；点击“释放”关闭连接。刷新、重新打开页面或设备断开后，浏览器可能重新询问权限。建议使用 HTTPS 地址并佩戴耳机。

## 文件结构

- `index.html`、`style.css`：网页和红房间视觉样式。
- `core.js`：分段、时间轴、独立录音和拼接。
- `audio.js`：波形、倒放、音效及播放。
- `recorder.js`：麦克风复用及 WAV 导出。
- `project.js`：工程保存、旧工程迁移和提词板。
- `ui.js`：界面事件。
- `demo.js`：内嵌合成示例。
- `.nojekyll`：直接发布静态资源。

离线运行需下载全部网站文件，在目录中运行 `python -m http.server 8765 --bind 127.0.0.1`，再打开 `http://localhost:8765/`。

## 说明

非官方同人实验，与《双峰》及其权利人无关联或合作。引用仅为短句试音，出处保留在网页内；中文为意译。声音效果取决于使用者的模仿，不克隆演员音色。
