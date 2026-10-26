<?php
/** FoldMemo v0.1.4 privileged, fail-closed release updater. */
class FoldMemoUpdateService {
    const REPOSITORY = 'nljie1103/foldmemo-kodbox-plugin';
    const MAX_ZIP = 33554432; // 32 MiB
    const MAX_UNPACKED = 67108864; // 64 MiB

    private static function fail($message) { throw new RuntimeException($message); }
    private static function admin() {
        if (!class_exists('KodUser') || !method_exists('KodUser', 'isRoot') || !KodUser::isRoot()) {
            self::fail('仅 KodBox 系统管理员可以检查或安装插件更新');
        }
    }
    private static function localVersion() {
        $file = __DIR__ . '/package.json';
        $config = json_decode((string) @file_get_contents($file), true);
        if (!is_array($config) || !isset($config['version']) || !preg_match('/^\d+\.\d+\.\d+$/', $config['version'])) {
            self::fail('插件本地版本无法核实，拒绝更新');
        }
        return $config['version'];
    }
    private static function curlDefaults($ch) {
        curl_setopt($ch, CURLOPT_USERAGENT, 'FoldMemo-KodBox-Updater/0.1.4');
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
        curl_setopt($ch, CURLOPT_TIMEOUT, 65);
        if (defined('CURLOPT_PROTOCOLS')) curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
        if (defined('CURLOPT_REDIR_PROTOCOLS')) curl_setopt($ch, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS);
    }
    private static function releaseInfo() {
        if (!function_exists('curl_init')) self::fail('缺少 PHP cURL 组件，无法安全连接 GitHub');
        $url = 'https://api.github.com/repos/' . self::REPOSITORY . '/releases/latest';
        $ch = curl_init($url);
        self::curlDefaults($ch);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28'));
        curl_setopt($ch, CURLOPT_MAXREDIRS, 0);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($body === false || $code !== 200 || strlen($body) > 524288) self::fail('GitHub 版本查询失败：HTTP ' . $code . ' ' . substr($error, 0, 120));
        $release = json_decode($body, true);
        if (!is_array($release) || !empty($release['draft']) || !empty($release['prerelease'])) self::fail('GitHub 未提供有效的正式 Release');
        $tag = isset($release['tag_name']) ? $release['tag_name'] : '';
        if (!is_string($tag) || !preg_match('/^v(\d+\.\d+\.\d+)$/', $tag, $m)) self::fail('GitHub Release 版本格式不符合要求');
        $version = $m[1];
        $name = 'foldmemo-kodbox-plugin-' . $tag . '.zip';
        $asset = null;
        foreach ((array) ($release['assets'] ?? array()) as $entry) {
            if (($entry['name'] ?? '') === $name) { $asset = $entry; break; }
        }
        if (!$asset) self::fail('GitHub Release 缺少约定的 ZIP 安装附件');
        $digest = isset($asset['digest']) ? $asset['digest'] : '';
        $size = isset($asset['size']) ? (int) $asset['size'] : 0;
        $download = isset($asset['browser_download_url']) ? $asset['browser_download_url'] : '';
        if (!is_string($digest) || !preg_match('/^sha256:([0-9a-f]{64})$/', $digest, $d)
            || $size < 1024 || $size > self::MAX_ZIP
            || $download !== 'https://github.com/' . self::REPOSITORY . '/releases/download/' . $tag . '/' . $name) {
            self::fail('Release 附件哈希、体积或 GitHub 来源校验失败');
        }
        $current = self::localVersion();
        $notes = isset($release['body']) && is_string($release['body']) ? $release['body'] : '';
        return array('current' => $current, 'latest' => $version, 'available' => version_compare($version, $current, '>'),
            'tag' => $tag, 'notes' => (function_exists('mb_substr') ? mb_substr($notes, 0, 8000) : substr($notes, 0, 8000)), 'publishedAt' => (string)($release['published_at'] ?? ''),
            'url' => 'https://github.com/' . self::REPOSITORY . '/releases/tag/' . $tag,
            'sha256' => $d[1], 'size' => $size, 'download' => $download);
    }
    public static function check() {
        try {
            self::admin();
            if (function_exists('set_time_limit')) @set_time_limit(85);
            if (!class_exists('Session') || !method_exists('Session', 'set')) self::fail('KodBox 会话存储不可用，拒绝更新');
            $status = self::publicStatus(self::releaseInfo());
            $token = bin2hex(random_bytes(24));
            Session::set('foldmemo_update_install_nonce', $token);
            $status['installNonce'] = $token;
            show_json($status);
        }
        catch (Throwable $e) { show_json($e->getMessage(), false); }
    }
    private static function publicStatus($s) {
        unset($s['download']); return $s;
    }
    private static function mkdirChecked($path) {
        if (!is_dir($path) && !@mkdir($path, 0700, true) && !is_dir($path)) self::fail('无法创建安全更新工作目录');
    }
    private static function download($url, $dest, $maxSize) {
        $fp = @fopen($dest, 'wb'); if (!$fp) self::fail('无法创建临时 ZIP 文件');
        $ch = curl_init($url);
        self::curlDefaults($ch);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
        $written = 0;
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($handle, $chunk) use ($fp, &$written, $maxSize) {
            $n = strlen($chunk);
            if ($written + $n > $maxSize) return 0;
            $output = fwrite($fp, $chunk);
            if ($output !== $n) return 0;
            $written += $n;
            return $n;
        });
        $ok = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch); fclose($fp);
        if (!$ok || $code !== 200) self::fail('下载失败或超过体积上限：HTTP ' . $code . ' ' . substr($error, 0, 120));
    }
    private static function extractValidated($zipfile, $target, $expectedVersion) {
        if (!class_exists('ZipArchive')) self::fail('缺少 PHP ZipArchive 扩展');
        $zip = new ZipArchive();
        if ($zip->open($zipfile) !== true) self::fail('ZIP 安装包无法打开');
        try {
            if ($zip->numFiles < 4 || $zip->numFiles > 500) self::fail('ZIP 文件数量异常');
            $unpacked = 0; $seen = array();
            for ($i=0; $i<$zip->numFiles; $i++) {
                $st = $zip->statIndex($i);
                $name = isset($st['name']) ? $st['name'] : '';
                if (!is_string($name) || strpos($name, 'foldMemo/') !== 0
                    || strpos($name, '\\') !== false || strpos($name, '//') !== false
                    || preg_match('#(^|/)\.{1,2}(/|$)#', $name)
                    || preg_match('/[^A-Za-z0-9._\/-]/', $name)) self::fail('ZIP 存在非法路径：' . $name);
                $relative = substr($name, strlen('foldMemo/'));
                $directory = substr($name, -1) === '/';
                if ($relative === '' || $directory) continue;
                if (substr($relative, -4) === '.php' && !in_array($relative, array('app.php', 'update-service.php'), true)) {
                    self::fail('安装包存在不允许的 PHP 执行文件');
                }
                if (isset($seen[$relative])) self::fail('ZIP 包含重复文件');
                $seen[$relative] = true;
                $unpacked += (int) $st['size'];
                if ($unpacked > self::MAX_UNPACKED || (int)$st['size'] > self::MAX_UNPACKED) self::fail('ZIP 解压体积超出限制');
                $opsys = 0; $attributes = 0;
                if ($zip->getExternalAttributesIndex($i, $opsys, $attributes)) {
                    if (((($attributes >> 16) & 0170000) === 0120000)) self::fail('ZIP 含符号链接，拒绝安装');
                }
                $out = $target . '/' . $relative;
                self::mkdirChecked(dirname($out));
                $input = $zip->getStream($name);
                if (!$input) self::fail('ZIP 文件无法读取：' . $relative);
                $output = @fopen($out, 'wb');
                if (!$output) { fclose($input); self::fail('无法创建更新文件'); }
                $count = stream_copy_to_stream($input, $output, self::MAX_UNPACKED + 1);
                fclose($input); fclose($output);
                if ($count !== (int) $st['size']) self::fail('ZIP 文件长度不一致');
                @chmod($out, 0644);
            }
        } finally { $zip->close(); }
        foreach (array('app.php', 'update-service.php', 'package.json', 'static/main.js', 'static/app/index.html') as $required) {
            if (!isset($seen[$required]) || !is_file($target . '/' . $required)) self::fail('安装包缺少必要文件：' . $required);
        }
        $pkg = json_decode((string)file_get_contents($target . '/package.json'), true);
        if (!is_array($pkg) || ($pkg['id'] ?? '') !== 'foldMemo' || ($pkg['version'] ?? '') !== $expectedVersion) self::fail('ZIP 插件 ID / 版本验证失败');
        foreach (array('app.php', 'update-service.php') as $name) {
            if (substr((string)file_get_contents($target . '/' . $name),0,5) !== '<?php') self::fail('PHP 入口文件无效');
        }
    }
    private static function deleteTree($path) {
        if (!is_dir($path) || is_link($path)) return;
        foreach (new DirectoryIterator($path) as $entry) {
            if ($entry->isDot()) continue;
            $item = $entry->getPathname();
            if ($entry->isDir() && !$entry->isLink()) self::deleteTree($item);
            else @unlink($item);
        }
        @rmdir($path);
    }
    public static function install($params) {
        $lock = null;
        try {
            self::admin();
            if (function_exists('set_time_limit')) @set_time_limit(185);
            $version = isset($params['version']) ? $params['version'] : '';
            if (!is_string($version) || !preg_match('/^\d+\.\d+\.\d+$/', $version)) self::fail('安装版本参数无效');
            $nonce = isset($params['nonce']) ? $params['nonce'] : '';
            $expectedNonce = class_exists('Session') ? Session::get('foldmemo_update_install_nonce') : null;
            if (!is_string($nonce) || !is_string($expectedNonce) || strlen($nonce) !== 48 || !hash_equals($expectedNonce, $nonce)) {
                self::fail('更新请求缺少管理员当前会话的确认令牌，请重新检查更新');
            }
            Session::set('foldmemo_update_install_nonce', '');
            if (!function_exists('curl_init') || !class_exists('ZipArchive')) self::fail('服务器缺少 cURL 或 ZipArchive 扩展');
            $parent = dirname(__DIR__);
            $pluginDir = __DIR__;
            if (is_link($pluginDir) || !is_dir($parent) || !is_writable($parent) || !is_writable($pluginDir)) self::fail('插件目录是软链接或不可写，需由服务器管理员手动更新');
            $workspace = $parent . '/.foldmemo-updater';
            self::mkdirChecked($workspace);
            $lock = @fopen($workspace . '/install.lock', 'c');
            if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) self::fail('其他管理员正在安装更新');
            $release = self::releaseInfo();
            if (!$release['available'] || $release['latest'] !== $version) self::fail('目标版本不再是最新可安装版本，请重新检查更新');
            $token = bin2hex(random_bytes(8));
            $stage = $workspace . '/stage-' . $token;
            $backup = $workspace . '/backup-' . $release['current'] . '-' . $token;
            $archive = $workspace . '/archive-' . $token . '.zip';
            $movedOld = false; $movedNew = false;
            self::mkdirChecked($stage);
            try {
                self::download($release['download'], $archive, self::MAX_ZIP);
                if (filesize($archive) !== $release['size'] || !hash_equals($release['sha256'], hash_file('sha256', $archive))) {
                    self::fail('GitHub 附件 SHA-256 或文件大小不匹配，拒绝安装');
                }
                self::extractValidated($archive, $stage . '/foldMemo', $version);
                if (!@rename($pluginDir, $backup)) self::fail('旧插件备份失败，没有修改现有版本');
                $movedOld = true;
                if (!@rename($stage . '/foldMemo', $pluginDir)) self::fail('新插件目录切换失败，开始回滚');
                $movedNew = true;
                $installed = json_decode((string) @file_get_contents($pluginDir . '/package.json'), true);
                if (!is_array($installed) || ($installed['version'] ?? '') !== $version) self::fail('安装后版本校验失败，开始回滚');
                if (function_exists('opcache_invalidate')) {
                    @opcache_invalidate($pluginDir . '/app.php', true);
                    @opcache_invalidate($pluginDir . '/update-service.php', true);
                }
                show_json(array('installed' => $version, 'previous' => $release['current'],
                    'backup' => $backup, 'message' => '更新已写入服务器；请确认保险库保存后刷新整个 KodBox 页面。'));
            } catch (Throwable $failure) {
                if ($movedOld) {
                    // No deletion of the previous version until rollback is ready.
                    if ($movedNew && is_dir($pluginDir)) {
                        $bad = $workspace . '/failed-' . $token;
                        if (!@rename($pluginDir, $bad)) self::fail('更新失败，且无法移走新版目录。旧版仍保留在：' . $backup . '。原因：' . $failure->getMessage());
                    }
                    if (!@rename($backup, $pluginDir)) self::fail('自动回滚失败！旧版备份位于：' . $backup . '。原因：' . $failure->getMessage());
                }
                throw $failure;
            } finally {
                @unlink($archive);
                self::deleteTree($stage);
            }
        } catch (Throwable $e) { show_json('安装未完成：' . $e->getMessage(), false); }
        finally { if ($lock) { @flock($lock, LOCK_UN); @fclose($lock); } }
    }
}
