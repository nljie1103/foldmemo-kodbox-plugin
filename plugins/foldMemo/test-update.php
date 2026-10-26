<?php
/** Offline updater hardening tests; no internet access and no actual plugin installation. */
class UpdateTestResult extends Exception {
    public $data; public $ok;
    function __construct($data, $ok) { parent::__construct(is_string($data) ? $data : 'result'); $this->data = $data; $this->ok = $ok; }
}
function show_json($data, $ok=true) { throw new UpdateTestResult($data, $ok); }
class KodUser {
    static $root = false;
    static function isRoot() { return self::$root; }
}
class Session {
    public static $values = array();
    static function set($name, $value) {self::$values[$name] = $value;}
    static function get($name) {return isset(self::$values[$name]) ? self::$values[$name] : null;}
}
require __DIR__ . '/update-service.php';
function verify($condition, $message) { if (!$condition) throw new RuntimeException('TEST FAILED: ' . $message); }
try { FoldMemoUpdateService::check(); throw new RuntimeException('Must reject non-admin'); }
catch (UpdateTestResult $result) { verify(!$result->ok && strpos($result->getMessage(), '管理员') !== false, 'non-admin denied'); }

KodUser::$root = true;
try { FoldMemoUpdateService::install(array('version'=>'0.1.5')); throw new RuntimeException('Must require session nonce'); }
catch (UpdateTestResult $result) { verify(!$result->ok && strpos($result->getMessage(), '确认令牌') !== false, 'CSRF nonce required'); }

// ZIP extraction tests are executed in GitHub Actions with ext-zip available.
if (!class_exists('ZipArchive')) {
    echo "PASS updater: fail-closed non-admin access; ZIP extension unavailable for extraction fixtures\n";
    exit(0);
}
$reflect = new ReflectionMethod('FoldMemoUpdateService', 'extractValidated');
$reflect->setAccessible(true);
$temp = sys_get_temp_dir() . '/foldmemo-zip-fixtures-' . getmypid();
mkdir($temp, 0700, true);
function zipFixture($file, $entries) {
    $z = new ZipArchive();verify($z->open($file, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true, 'create fixture');
    foreach ($entries as $name => $data) $z->addFromString($name, $data);
    $z->close();
}
function fixtureEntries() {
    return array('foldMemo/app.php'=>'<?php echo 1;',
        'foldMemo/update-service.php'=>'<?php echo 1;',
        'foldMemo/package.json'=>json_encode(array('id'=>'foldMemo','version'=>'0.1.5')),
        'foldMemo/static/main.js'=>'/* test */',
        'foldMemo/static/app/index.html'=>'<!doctype html>');
}
try {
    zipFixture($temp.'/valid.zip',fixtureEntries());
    $reflect->invoke(null, $temp.'/valid.zip', $temp.'/good', '0.1.5');
    verify(file_exists($temp.'/good/package.json'), 'safe archive extracted');
    $bad=fixtureEntries();$bad['foldMemo/../../outside.php']='<?php bad();';
    zipFixture($temp.'/traversal.zip',$bad);
    try {$reflect->invoke(null,$temp.'/traversal.zip',$temp.'/bad','0.1.5');throw new RuntimeException('Path traversal accepted');}
    catch (RuntimeException $e) {verify(strpos($e->getMessage(),'非法路径')!==false,'path traversal rejected');}
    $risky=fixtureEntries();$risky['foldMemo/backdoor.php']='<?php echo 42;';
    zipFixture($temp.'/risky.zip',$risky);
    try {$reflect->invoke(null,$temp.'/risky.zip',$temp.'/risky','0.1.5');throw new RuntimeException('Unexpected PHP accepted');}
    catch (RuntimeException $e) {verify(strpos($e->getMessage(),'不允许的 PHP')!==false,'unexpected PHP rejected');}
    zipFixture($temp.'/mismatch.zip',fixtureEntries());
    try {$reflect->invoke(null,$temp.'/mismatch.zip',$temp.'/wrong','0.1.6');throw new RuntimeException('Version mismatch accepted');}
    catch (RuntimeException $e) {verify(strpos($e->getMessage(),'版本验证失败')!==false,'version mismatch rejected');}
    $missing=fixtureEntries();unset($missing['foldMemo/update-service.php']);
    zipFixture($temp.'/missing.zip',$missing);
    try {$reflect->invoke(null,$temp.'/missing.zip',$temp.'/missing','0.1.5');throw new RuntimeException('Incomplete archive accepted');}
    catch (RuntimeException $e) {verify(strpos($e->getMessage(),'缺少必要文件')!==false,'missing file rejected');}
    echo "PASS updater: root guard, valid ZIP, path traversal, executable PHP, mismatched version, missing file\n";
} finally {
    // Test fixture removal. No real plugin or user data is touched.
    $files=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($temp, FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($files as $file) {if ($file->isDir()) rmdir($file->getPathname());else unlink($file->getPathname());}
    rmdir($temp);
}
