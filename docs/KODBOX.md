# FoldMemo KodBox 插件 · v0.1.2

本插件适用于已安装 KodBox 的 PHP 服务器。程序资源与 `.foldmemo` 保险库分离。安装测试请勿使用重要真实密码。

## 构建与安装

1. 下载 Release ZIP，解压到 KodBox 的 `plugins/foldMemo/`，不要出现重复嵌套目录。
2. 打开 KodBox 管理界面的插件中心，启用 FoldMemo，然后强制刷新浏览器。
3. 在「我的文件」创建 `test.foldmemo`，内容只有 `null`，选择「打开方式 → FoldMemo 编辑保险库」。
4. 创建测试保险库，打开密码可选；关闭时将保存**明文 JSON**。创建笔记，待显示云端已保存，再关闭重开核验。
5. 旧 HTML 导入：备份原文件，在 KodBox 新建**空白** `.foldmemo` 再进行导入；不允许覆盖其他 ID 的云端保险库。

从 GitHub 源码构建必须在 `vue-app` 运行 `npm ci` 和 `npm run build:kodbox`，生成 `plugins/foldMemo/static/app/index.html` 与 `assets/`；然后执行 `node plugins/foldMemo/test-bridge.cjs`、`php -l plugins/foldMemo/app.php` 和 `php plugins/foldMemo/test-server.php`。

## 手机端删除验收

打开 `test.foldmemo`，使用手机依次测试：新建一条测试记录 → 点击删除 → 点击取消应保留原记录 → 再点击删除并确认应进入回收站 → 从回收站恢复应返回记录列表 → 再次删除并选择永久删除应不可恢复。分类页面也需测试删除确认。删除后等待“云端已保存”，关闭重开验证结果。所有确认弹窗由应用内 Vue Dialog 提供，不再使用浏览器原生 `confirm()`。

## 保存链路

浏览器通过经过来源检查的同源消息桥调用 KodBox 插件入口，插件服务端在写入前调用 `ActionCall('explorer.auth.fileCanWrite', path)`，拒绝无权限和错误路径。单一 PHP 主机内，服务端为每份目标文件取得本地 `flock` 排他锁；锁内重复校验权限、重新读取原文件，并比较客户端的 SHA-256 保存基线。如果发生冲突则拒绝保存。写入后再读取 SHA-256 并返回确认。浏览器只有收到成功确认才显示已保存。

网络失败、权限丢失、版本冲突时应用进入只读保护，并保留恢复草稿。KodBox 关闭编辑窗口时如有未同步修改，应显示阻止误关的提示。

## 范围与限制

- 文件锁**不跨 PHP 主机**，也无法锁住不使用本插件的其他编辑器；普通云存储后端不保证文件内容层面的原子事务。
- PHP 主机的 `DATA_PATH` 需要能够创建 `foldmemo-cas-locks`；否则服务端拒绝写入。
- 大文件可能受 PHP `post_max_size` 等限制，请根据实际保险库大小调整（例如 32M）。
- KodBox API 路由、权限和存储驱动仍需在使用者的实例上联调。
- 备份密码与打开密码独立；关闭打开密码并不代表启用了其他加密。
