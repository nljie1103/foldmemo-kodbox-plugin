# FoldMemo KodBox Plugin

FoldMemo 的 KodBox 在线保险库插件，与[原单 HTML 版](https://github.com/nljie1103/foldmemo)互相独立。

**v0.1.3：统一 KodBox 和 Vue 内部确认弹窗，修复旧版桥接缓存误报，以及首次创建和窗口关闭操作。手机端仍需要实机验收。**

- Vue 3 和 Vite 拆分成可缓存的 HTML、JavaScript、CSS。
- 数据存于 KodBox 内原有的 `.foldmemo` 文件，不再把程序包写入保险库。
- 打开密码**可选**。开启：AES-GCM 加密；关闭：**文件内容明文**，必须自行确认风险。
- KodBox 用户权限由服务器在每次保存前检查；同一 PHP 主机内，本插件的写入使用 `flock` + SHA-256 CAS + 写后读回验证。
- 断网/冲突时禁止继续改动，保留本机恢复草稿；KodBox 弹窗关闭时提示未同步状态。
- 仅允许将旧 HTML 导入空白 `.foldmemo`，禁止替换不同 ID 的现有保险库。
- 首次创建、删除、明文风险、导入、锁定、关闭未同步 KodBox 窗口等，统一通过应用内 Vue 弹窗确认。
- KodBox 外层与 Vue 内层使用 `v0.1.3` 版本握手，发现旧版桥接脚本立即提示而不误报数据格式或权限。
- 保留浏览器刷新/关闭标签页时的 `beforeunload` 离页警告（浏览器限制，无法以 Vue Dialog 替代）。

## 安装

从 [Releases](https://github.com/nljie1103/foldmemo-kodbox-plugin/releases) 下载版本 ZIP，先备份原有 `.foldmemo` 文件，**完整替换** KodBox 服务器 `plugins/foldMemo/`（建议临时移走旧插件目录，不要让旧 `static/main.js` 与新版共存），确认包含 `app.php`、`package.json`、`static/main.js` 与 `static/app/index.html`、`static/app/assets/*`。在 KodBox 插件中心重新启用插件、刷新浏览器并清理缓存。请勿删除或改写已有数据文件。

测试时在自己的 KodBox 目录创建 `test.foldmemo`，内容为 `null`；右键选择「FoldMemo 编辑保险库」。保存测试笔记后重新打开确认数据存在。

从源码构建：

```powershell
cd vue-app
npm ci
npm run build:kodbox
cd ..
node plugins/foldMemo/test-bridge.cjs
node vue-app/scripts/mobile-confirm-regression.mjs
php -l plugins/foldMemo/app.php
php plugins/foldMemo/test-server.php
```

**限制：** `flock` 只协调同一 PHP 主机上经过本插件的并发保存；其他 KodBox 编辑器、多台 KodBox 服务节点、外部同步程序不一定使用同一把锁。不同存储驱动的并发安全需要进一步实测。对于重要账号信息保留离线加密备份。另见 [安装与技术说明](docs/KODBOX.md)。
