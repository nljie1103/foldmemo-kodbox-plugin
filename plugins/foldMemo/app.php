<?php
/**
 * FoldMemo KodBox plugin v0.1.1.
 * The trusted KodBox session enforces permissions. Flock serializes this
 * plugin's writers on a single KodBox PHP host. Other editors/storage nodes
 * do not share this lock and must not be treated as atomic participants.
 */
class foldMemoPlugin extends PluginBase {
    public function __construct() { parent::__construct(); }
    public function regist() {
        $this->hookRegist(array('user.commonJs.insert' => 'foldMemoPlugin.echoJs'));
    }
    public function echoJs() { $this->echoFile('static/main.js'); }

    private function checkedPath() {
        $path = isset($this->in['path']) ? $this->in['path'] : '';
        if (!is_string($path) || strlen($path) > 4096 || !preg_match('/[.]foldmemo$/i', $path)
            || preg_match('/^https?:/i', $path) || strpos($path, '{shareItemLink:') === 0
            || strpos($path, chr(0)) !== false) {
            show_json('仅支持 KodBox 登录用户的 .foldmemo 文件路径', false);
            exit;
        }
        if (!ActionCall('explorer.auth.fileCanWrite', $path)) {
            show_json('当前账号对该保险库没有写入权限', false);
            exit;
        }
        if (!IO::info($path)) {
            show_json('目标保险库不存在，不允许创建新文件或改写其他路径', false);
            exit;
        }
        return $path;
    }

    /** Frontend may edit only when the *server* confirms file access. */
    public function access() {
        $path = $this->checkedPath();
        show_json(array('writable' => true, 'filename' => basename($path)));
    }

    /** Atomic compare-and-save among FoldMemo plugin writers on one PHP host. */
    public function atomicSave() {
        $path = $this->checkedPath();
        $expected = isset($this->in['expected']) ? $this->in['expected'] : '';
        $body = isset($this->in['content']) ? $this->in['content'] : null;
        if (!is_string($expected) || !preg_match('/^[0-9a-f]{64}$/', $expected)
            || !is_string($body) || strlen($body) > 26 * 1024 * 1024) {
            show_json('保存参数无效或文件过大', false);
            exit;
        }
        $pack = json_decode($body, true);
        if (!is_array($pack) || !isset($pack['format']) || $pack['format'] !== 'foldmemo-file-2'
            || !isset($pack['vaultId']) || !is_string($pack['vaultId']) || !$pack['vaultId']
            || !isset($pack['encrypted']) || !is_bool($pack['encrypted'])
            || ($pack['encrypted'] && (!isset($pack['content']) || !isset($pack['keyWrap'])))
            || (!$pack['encrypted'] && !isset($pack['plain']))) {
            show_json('保险库结构无效，拒绝覆盖', false);
            exit;
        }
        // Lock location must be shared by PHP workers on THIS host and not web-exposed.
        $base = defined('DATA_PATH') ? DATA_PATH : sys_get_temp_dir();
        $lockDir = rtrim($base, '/\\') . '/foldmemo-cas-locks';
        if (!is_dir($lockDir) && !@mkdir($lockDir, 0700, true) && !is_dir($lockDir)) {
            show_json('服务器无法创建安全锁目录，已停止保存', false);
            exit;
        }
        $lockFile = $lockDir . '/' . hash('sha256', $path) . '.lock';
        $fp = @fopen($lockFile, 'c');
        if (!$fp || !@flock($fp, LOCK_EX)) {
            if ($fp) fclose($fp);
            show_json('服务器文件锁不可用，已停止保存', false);
            exit;
        }
        try {
            // Check again inside the critical section.
            $path = $this->checkedPath();
            $current = IO::getContent($path);
            if (!is_string($current)) {
                show_json('保险库读取失败，已停止写入', false);
                exit;
            }
            if (hash('sha256', $current) !== $expected) {
                show_json('VERSION_CONFLICT：文件已被其他设备修改，禁止覆盖', false);
                exit;
            }
            $previous = json_decode(trim($current), true);
            if ($current !== '' && trim($current) !== 'null' && !is_array($previous)) {
                show_json('现有保险库格式损坏，已停止写入', false);
                exit;
            }
            if (is_array($previous) && isset($previous['vaultId'])
                && $previous['vaultId'] !== $pack['vaultId']) {
                show_json('保险库 ID 不一致，拒绝覆盖另一个保险库', false);
                exit;
            }
            if (!IO::setContent($path, $body)) {
                show_json('KodBox 文件写入失败', false);
                exit;
            }
            $confirmed = IO::getContent($path);
            $next = hash('sha256', $body);
            if (!is_string($confirmed) || hash('sha256', $confirmed) !== $next) {
                show_json('服务器写入后读回校验失败，请先备份并人工检查', false);
                exit;
            }
            show_json(array('baseline' => $next, 'saved' => true));
        } finally {
            @flock($fp, LOCK_UN);
            @fclose($fp);
        }
    }
}
