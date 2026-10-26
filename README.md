# FoldMemo KodBox Plugin

FoldMemo 专用的 KodBox 在线加密保险库插件。本仓库与单 HTML 版本的 [FoldMemo](https://github.com/nljie1103/foldmemo) 完全独立。

**版本：v0.1.0 开发预览。未完成真实 KodBox 实例联调，不建议存放唯一一份重要密码数据。**

- 前端：Vue 3，Vite 多文件编译，独立可缓存的 JS/CSS。
- 保险库：独立的 `.foldmemo` 加密 JSON 文件，不将应用代码重复写入数据文件。
- 存储：KodBox 现有文件管理接口，读写确认及 SHA-256 内容校验。
- 兼容：继续支持手动导入 FoldMemo v2 的单 HTML 保险库。
- 安全：必须开启打开密码；原本的 KodBox HTML 预览沙盒保持不变。

## 安装

推荐通过 GitHub Release 下载 `foldmemo-kodbox-plugin-v0.1.0.zip`，解压得到 `foldMemo/` 插件目录，并安装到 KodBox `plugins/`，然后在后台启用。

从源码构建：

```powershell
cd vue-app
npm ci
npm run build:kodbox
cd ..
node plugins/foldMemo/test-bridge.cjs
```

**注意：** 当前自动保存仅采用客户端读-比较-写并校验返回结果，尚未实现服务端原子文件锁。两个设备几乎同时保存仍可能竞争。上线前需进一步验收多用户权限、并发和文件回滚。

更多说明请见 [KodBox 开发文档](docs/KODBOX.md)。
