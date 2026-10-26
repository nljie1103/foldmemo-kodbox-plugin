# FoldMemo × KodBox 云端插件（开发预览 0.1.0）

## 目标

KodBox 中的 FoldMemo 不再打包成单个巨大的 HTML。程序使用多文件、可缓存的 Vue/Vite JS/CSS 资源；用户的保险库是 **独立的加密 `.foldmemo` JSON 文件**（`foldmemo-file-2` 格式）。原有本地单 HTML 继续独立工作，不会被云端编辑器覆盖。

## 构建和安装

1. 切换 `feature/kodbox-plugin` 分支。
2. 在 `vue-app` 运行 `npm install` 和 `npm run build:kodbox`。
3. 必须确认 `plugins/foldMemo/static/app/index.html` 与 `static/app/assets/*.js/css` 已生成；**只克隆源代码还不能安装运行**。
4. 将整个 `plugins/foldMemo` 复制至 KodBox 服务端 `plugins/` 下，在 KodBox 管理后台启用插件，并为所需用户授权。
5. 在私人文件夹新建 `test.foldmemo` 文本文件，内容为 `null`（没有引号），通过「打开方式 → FoldMemo 编辑保险库」打开。**不要通过普通 HTML 预览**。
6. 新建保险库必须启用至少 8 位的打开密码，等待写入成功后，再新建分类/记录/笔记。重新打开文件验证。
7. 导入旧 HTML：**先保留原文件备份**，在新建的空白 `.foldmemo` 中使用「手动导入保险库」，输入旧版解锁密码及新的云端打开密码。导入不会覆盖原 HTML。

## 接口与安全

- KodBox 插件复用其 `kodApp.pathModel.fileContent` / `fileSave`。可信插件打开方式通过同源 `postMessage` 与独立 Vue UI 通信；校验窗口来源和随机会话标识，不改变 KodBox 普通 HTML 预览的安全沙盒。
- KodBox 只持有 **加密 JSON**；明文密码与解密后的数据只保留在浏览器运行时内存。禁止将未加密保险库保存到云端。
- 保存前重新读取远端内容并做 SHA-256 比较；保存后重新读取确认一致。网络、权限、冲突、读回校验失败时禁止声称已保存，并切换只读。浏览器本机另存加密恢复草稿。
- `fileSave` 覆盖写入整份 `.foldmemo`，**不是按记录增量写入**。应用资源与数据分离能降低读写量、利用缓存，但大数据量仍可能需要进一步分片。

## 重要限制

**当前未在真实 KodBox 安装环境完成联调，不是生产稳定版。** 现有的读-比较-写只能拦截常见冲突，两台设备在同一瞬间保存仍存在竞争窗口。高价值秘密和多设备高并发使用之前，需要设计服务端受权限验证的原子 CAS / 文件锁，实测各种存储驱动。不要依赖此开发预览作为唯一密码备份。

适配需在 HTTPS 下、从 KodBox 已登录文件管理器内启动。不同 KodBox 版本对插件注册、文件读写 callback 可能有差异，必须以服务器实测为准。
