<?php
/** Register FoldMemo as a trusted KodBox file-opening application. */
class foldMemoPlugin extends PluginBase {
    public function __construct() { parent::__construct(); }
    public function regist() {
        $this->hookRegist(array('user.commonJs.insert' => 'foldMemoPlugin.echoJs'));
    }
}
