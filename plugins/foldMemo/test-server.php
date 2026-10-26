<?php
/** Integration-style tests for the KodBox plugin endpoint (no KodBox required). */
class TestResponse extends Exception {
    public $ok; public $data;
    function __construct($data, $ok) { parent::__construct(is_string($data) ? $data : 'success'); $this->data=$data; $this->ok=$ok; }
}
function show_json($data, $ok=true) { throw new TestResponse($data,$ok); }
class PluginBase { public $in=array(); public function __construct() {} public function hookRegist($x) {} public function echoFile($x) {} }
class IO {
    public static $data='null';
    public static function info($path) {return array('name'=>basename($path));}
    public static function getContent($path) {return self::$data;}
    public static function setContent($path,$body) {self::$data=$body;return true;}
}
$allow=true;
function ActionCall($name,$path) {global $allow;return $name==='explorer.auth.fileCanWrite' && $allow;}
define('DATA_PATH',sys_get_temp_dir().'/foldmemo-test-'.getmypid().'/');
require __DIR__.'/app.php';
function check($ok,$message) {if(!$ok)throw new Exception('TEST FAILED '.$message);}
function callPlugin($plugin,$action,$params) {
    $plugin->in=$params;
    try {$plugin->$action();throw new Exception('No JSON response');}
    catch(TestResponse $r) {return $r;}
}
$plug=new foldMemoPlugin();
$path='{user:1}/test.foldmemo';
$allowed=callPlugin($plug,'access',array('path'=>$path));
check($allowed->ok===true && $allowed->data['writable']===true,'access granted');
$plain=json_encode(array('format'=>'foldmemo-file-2','vaultId'=>'abc','encrypted'=>false,'plain'=>array('id'=>'abc')));
$hash=hash('sha256','null');
$a=callPlugin($plug,'atomicSave',array('path'=>$path,'expected'=>$hash,'content'=>$plain));
check($a->ok===true && $a->data['baseline']===hash('sha256',$plain),'plaintext opt-out write');
check(IO::$data===$plain,'write contents');
$stale=callPlugin($plug,'atomicSave',array('path'=>$path,'expected'=>$hash,'content'=>$plain));
check($stale->ok===false && strpos($stale->getMessage(),'VERSION_CONFLICT')!==false,'reject stale version');
$foreign=json_encode(array('format'=>'foldmemo-file-2','vaultId'=>'different','encrypted'=>false,'plain'=>array('id'=>'different')));
$b=callPlugin($plug,'atomicSave',array('path'=>$path,'expected'=>hash('sha256',IO::$data),'content'=>$foreign));
check($b->ok===false,'reject foreign vault');
$allow=false;
$c=callPlugin($plug,'atomicSave',array('path'=>$path,'expected'=>hash('sha256',IO::$data),'content'=>$plain));
check($c->ok===false,'reject revoked permissions');
$invalid=callPlugin($plug,'atomicSave',array('path'=>'/etc/passwd','expected'=>hash('sha256',IO::$data),'content'=>$plain));
check($invalid->ok===false,'reject invalid path');
echo "PASS v0.1.1: server permission, CAS, plaintext, vault identity, path verification\n";
