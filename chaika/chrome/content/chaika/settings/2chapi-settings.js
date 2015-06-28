/*
 * 2chapi-settings.js - 2ch API extension for chaika - 設定ダイアログ・コード
 *
 * このファイルのあるべき位置：chrome/content/chaika/settings/2chapi-settings.js
 *
 * Written by masami ◆U7rHG6DINI
 * 使用条件・ライセンス等については chaika 本体に準じます。
 *
 * 註：このファイルは、オリジナルの bbs2chreader/chaika の構成要素ではありません。
 *     この 2ch API extension for chaika は、オリジナルの bbs2chreader/chaika の
 *     作成者・開発者とは全く別の人物が開発しているものです。
 *     license.txtやその他のソースコード・付属文書・公式サイトなどで明記されている
 *     オリジナルの bbs2chreader/chaika の作成者・開発者・寄付者/貢献者などは、
 *     この 2ch API extension for chaika の開発には一切関与しておりません。
 *
 * Last Modified : 2015/06/29 00:14:00
 */

Components.utils.import("resource://chaika-modules/ChaikaCore.js");
Components.utils.import("resource://chaika-modules/Chaika2chApi.js");

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cr = Components.results;

const API_BRANCH = "extensions.chaika.2chapi.";

const AUTO_AUTH_OFF     = 0;        // sessionIDの自動更新をしない(起動時のみ更新)
const AUTO_AUTH_ACCESS  = 1;        // datAPIサーバへのアクセス直後に自動更新する
const AUTO_AUTH_TIMER   = 2;        // タイマーを使って一定間隔に自動更新する
const AUTH_INTERVAL_MIN = 180;      // 認証間隔の最小値(秒)
const AUTH_INTERVAL_MAX = 86400;    // 認証間隔の最大値(秒)
const WAKE_DELAY_MAX    = 999;      // スリープ解除時待ち時間の最大値(秒)


var g2chApiPane = {

    /**
     * 設定のセーブ・ロード・初期化を行うオブジェクト
     */
    prefmgr: null,

    /**
     * 初期化処理
     */
    startup: function(){
        var prefWindow = document.documentElement;

        // Windows 風の「適用」ボタンを付加する
        if(!prefWindow.instantApply){
            prefWindow.buttons = "accept,cancel,extra1";
            var applyButton = prefWindow.getButton("extra1");
            applyButton.disabled = true;

            // 適用ボタンをキャンセルボタンの直後へ移動
            var cancelButton = prefWindow.getButton("cancel");
            cancelButton.parentNode.insertBefore(applyButton, cancelButton.nextSibling);

            var prefNodes = document.getElementsByTagName("preference");
            Array.slice(prefNodes).forEach(function(node){
                node.addEventListener("change", function(){
                    applyButton.disabled = false;
                });
            });
        }

        // ダイアログが初期サイズより小さくならないようにする
        window.sizeToContent();
    //  prefWindow.minWidth  = prefWindow.clientWidth;
        prefWindow.minHeight = prefWindow.clientHeight;

        // スクリプトから設定状態を変更した場合に
        // ダイアログ内のUIコントロールの状態を同期させる関数
        var syncDialogUI = function(){
            g2chApiPane.syncToCtType();
            g2chApiPane.setDisabled2chApi();
        };
        syncDialogUI();
        this.updateStatus();

        this.prefmgr = new PreferenceManager(syncDialogUI);
        this.prefmgr.startup("toolMenu", prefWindow.id);

        var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
        os.addObserver(this, "Chaika2chApi:Auth", false);
    },

    /**
     * 終了処理
     */
    shutdown: function(){
        var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
        os.removeObserver(this, "Chaika2chApi:Auth");

        this.prefmgr.shutdown();
        this.prefmgr = null;

        // 有効なセッションIDが無ければ取得する
        Chaika2chApi.apiAuth();
    },

    /**
     * 「適用」ボタンが押されたとき
     */
    onApply: function(){
        var prefWindow = document.documentElement;
        var applyButton = prefWindow.getButton("extra1");
        if(prefWindow.instantApply || applyButton.disabled) return;

        var paneNodes = document.getElementsByTagName("prefpane");
        for(var i=paneNodes.length; --i>=0; ){
            paneNodes[i].writePreferences(i==0);
        }
        applyButton.disabled = true;
        applyButton.blur();
    },

    /**
     * ダイアログが閉じられるとき(onbeforeaccept/ondialogcancel)
     */
    onClose: function(aOnBeforeAccept){
        function getPrefValue(name){
            var pref = document.getElementById(API_BRANCH + name);
            return pref[aOnBeforeAccept ? "value" : "valueFromPreferences"];
        }
        if(!getPrefValue("enabled")) return true;

        // 必須設定項目のチェック
        var emptyPrefs = [];
        ["api_url", "auth_url", "appkey", "hmkey"].forEach(function(name){
            var value = getPrefValue(name);
            if(value == null || !value.trim()){
                var label = document.getElementsByAttribute("control", name).item(0);
                emptyPrefs.push(label.value);
            }
        });
        if(emptyPrefs.length != 0){
            this.selectTab("tabAPI");
            var msg = emptyPrefs.join(", ") + " の設定値が空白です。\n" +
                      "この状態では 2ch API は有効にはなりません。\n\n" +
                      "このままこの設定ウィンドウを閉じますか？";
            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                          .getService(Ci.nsIPromptService);
            return prompts.confirm(window, "2ch API の設定", msg);
        }

        // User-Agent の入力チェック
        var postUA = getPrefValue("post_ua");
        if(postUA == null || !postUA.trim()){
            this.selectTab("tabUA");
            var datUA = getPrefValue("useragent");
            var msg = "投稿時UA(postUA) の設定値が空白です。\n" +
                      "この状態では 2ch への書き込みができません。\n\n" +
                      "もしこの postUA に入れるべき設定値が不明なら、\n" +
                      "通常時UA(datUA) と同じものを入れてください。\n\n" +
                     ((datUA != null && datUA.trim()) ? "" :
                      "User-Agent の推奨設定値は使用する鍵(AppKey/HMKey)によって異なり、\n" +
                      "鍵と一緒に User-Agent の推奨設定値も提示されているはずですので、\n" +
                      "後々のトラブル防止のため、それに従って入力してください。\n\n") +
                      "このままこの設定ウィンドウを閉じますか？";
            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                          .getService(Ci.nsIPromptService);
            return prompts.confirm(window, "2ch API の設定", msg);
        }

        return true;
    },

    /**
     * 指定されたタブページを選択する
     */
    selectTab: function(aTabID){
        var tab = document.getElementById(aTabID);
        document.getElementById("box2chApi").selectedTab = tab;
    },

    /**
     * 「2ch API を使用する」に対する enable/disable
     */
    setDisabled2chApi: function(){
        if(!setContainerDisabledEx(API_BRANCH + "enabled", "box2chApi", true)){
            setContainerDisabledEx(API_BRANCH + "auto_auth", "boxInterval", 1, 2);
            setContainerDisabledEx(API_BRANCH + "auto_auth", "boxWakeDelay", 2);
            setContainerDisabledEx("ct_type", "ct_value", "Fixed");
        }
    },

    /**
     * ct_type ← ct_value への同期
     */
    syncToCtType: function(){
        var ct = document.getElementById("ct_value").value;
        var type = (ct.search(/^\d{1,10}/) == 0) ? "Fixed" :
                   (ct.search(/Random/i) != -1) ? "Random" : "Time";
        document.getElementById("ct_type").value = type;
    },

    /**
     * ct_type → ct_value への同期
     * ct_type が "Fixed" の時は ct_value のチェックも行う
     */
    syncFromCtType: function(){
        var ctValueCtrl = document.getElementById("ct_value");
        var type = document.getElementById("ct_type").value;

        if(type == "Time" || type == "Random"){
            ctValueCtrl.value = type;
        }else{
            var wk, ct = ctValueCtrl.value;
            ct = (wk = ct.match(/^\d{1,10}/)) ? wk[0] : "0";
            ctValueCtrl.value = ct;
        }
        document.getElementById("pane2chApi").userChangedValue(ctValueCtrl);
        setContainerDisabledEx("ct_type", "ct_value", "Fixed");
    },

    /**
     * preference要素 ← intervalコントロール への同期 (onsynctopreference)
     */
    syncFromInterval: function(aIntervalCtrl){
        var unitCtrl = document.getElementById(aIntervalCtrl.id + "_unit");
        return aIntervalCtrl.valueNumber * Number(unitCtrl.value);
    },

    /**
     * preference要素 → intervalコントロール への同期 (onsyncfrompreference)
     */
    syncToInterval: function(aIntervalCtrl){
        var intervalPref = document.getElementById(aIntervalCtrl.getAttribute("preference"));
        var unitCtrl = document.getElementById(aIntervalCtrl.id + "_unit");

        var interval = intervalPref.value;
        var unit = Number(unitCtrl.value);
        for( ; unit > 1; unit /= 60){
            // 端数が出なくなるまで小さい単位へ下げる
            if(interval % unit == 0) break;
        }
        unitCtrl.value = String(unit);
        aIntervalCtrl.max = AUTH_INTERVAL_MAX / unit;
        return interval / unit;
    },

    /**
     * unitコントロール → intervalコントロール への同期 (単位が変わったとき)
     */
    syncFromUnit: function(aUnitCtrl){
        var intervalCtrl = document.getElementById(aUnitCtrl.id.replace("_unit", ""));
        var oldUnit = AUTH_INTERVAL_MAX / intervalCtrl.max;     // 前の単位はmax値から得る
        var newUnit = Number(aUnitCtrl.value);
        if(newUnit == oldUnit) return;

        var interval = intervalCtrl.valueNumber * oldUnit / newUnit;  // maxの変更前に値を取得
        intervalCtrl.max = AUTH_INTERVAL_MAX / newUnit;     // max値を先に変更する必要あり
        intervalCtrl.valueNumber = Math.ceil(interval);     // 0にならないように値を切り上げる
        document.getElementById("pane2chApi").userChangedValue(intervalCtrl);
    },

    /**
     * intervalコントロールの値のチェック
     *  註：更新間隔としての最小値は AUTH_INTERVAL_MIN までだが、
     *      値 0 も「自動更新しない」を意味する有効値なので。
     *      こういう特殊ケースでなければ、intervalCtrl.min を max と同様に
     *      単位に応じて適切に設定すれば、このようなチェックは不要になる。
     */
    checkInterval: function(aIntervalCtrl){
        var unitCtrl = document.getElementById(aIntervalCtrl.id + "_unit");
        var unit = Number(unitCtrl.value);
        var interval = aIntervalCtrl.valueNumber * unit;
        if(interval == 0 || interval >= AUTH_INTERVAL_MIN) return;

        aIntervalCtrl.valueNumber = AUTH_INTERVAL_MIN / unit;
        document.getElementById("pane2chApi").userChangedValue(aIntervalCtrl);
    },

    /**
     * ステータス表示の更新
     */
    updateStatus: function(){
        var sessionStatus = document.getElementById("session_status");
        var authStatus    = document.getElementById("auth_status");
        sessionStatus.value = Chaika2chApi.getStatusString("currentSessionID");
        authStatus.value    = Chaika2chApi.getStatusString("previousAuth");
    },

    /**
     * セッションID取得（認証テスト）
     */
    apiAuth: function(){
        this.onApply();
        document.getElementById("btnAuth").disabled = true;
        Chaika2chApi.authTest();
    },

    /**
     * セッションID消去
     */
    apiClear: function(){
        Chaika2chApi.clearAuth(true);
    },

    // ********** ********* implements nsIObserver ********** **********

    observe: function(aSubject, aTopic, aData){
        if(aTopic != "Chaika2chApi:Auth") return;
        this.updateStatus();

        var btnAuth = document.getElementById("btnAuth");
        if((aData == "OK" || aData == "NG" || aData == "STOP") && btnAuth.disabled){
            var msg = (aData == "OK") ? "2ch API の認証は成功しました。\n\n" +
                        "設定してある AppKey/HMKey が有効かどうか確かめるには、\n" +
                        "実際に 2ch のスレッドを読み込んでみる必要があります。" :
                      (aData == "NG") ? "2ch API の認証に失敗しました。\n\n" +
                        "API認証設定やネットワーク接続状態などを確認してください。" :
                      "認証設定に未入力の項目があるため 2ch API の認証はできません。";
            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                          .getService(Ci.nsIPromptService);
            prompts.alert(window, "2ch API 認証テスト", msg);
            btnAuth.disabled = false;
        }
    }
};


/**
 * 設定のセーブ・ロード・初期化を行うオブジェクト
 */
function PreferenceManager(aCallback){
    this.prefUpdate = aCallback || function(){};
}

PreferenceManager.prototype = {

    prefUpdate: null,
    menuButton: null,
    dropTarget: null,
    preferences: null,

    // オンラインヘルプURL
    README_URL: "https://github.com/masami-dev/chaika-api/wiki/%E4%BB%98%E5%B1%9E%E6%96%87%E6%9B%B8%28README%29",
    HELP_URL:   "https://github.com/masami-dev/chaika-api/wiki/%E8%A8%AD%E5%AE%9A%E9%A0%85%E7%9B%AE%E3%81%AE%E8%A7%A3%E8%AA%AC",

    /** 設定読み書き用テーブル */
    _prefTable: {
        // ** APIのON/OFF **
        "enabled": null,    // enabled は対象から外す
        // ** API・認証 **
        "api_url":   { iskey: false, regexp: /^api[_-]?url$/i,
                       check: function(v){ return (/^https?:/i).test(v); } },
        "auth_url":  { iskey: false, regexp: /^auth[_-]?url$/i,
                       check: function(v){ return (/^https?:/i).test(v); } },
        "appkey":    { iskey: true,  regexp: /^app[_-]?key$/i },
        "hmkey":     { iskey: true,  regexp: /^hm(ac)?[_-]?key$/i },
        "ct_value":  { iskey: false, regexp: /^ct[_-]?value$/i,
                       check: function(v){ return (/^(Time|Random|\d{1,10})$/i).test(v); } },
        "use_ronin": { iskey: false, regexp: /^use[_-]?ronin$/i, type: "boolean" },
        // ** User-Agent **
        "useragent": { iskey: true, regexp: /^(\(dat\)|dat[_-]?)(ua|user[_-]?agent)$/i,
                                                                      name: "dat_ua" },
        "post_ua":   { iskey: true, regexp: /^(\(post\)|post[_-]?)(ua|user[_-]?agent)$/i },
        "auth_ua":   { iskey: true, regexp: /^(\(auth\)|auth[_-]?)(ua|user[_-]?agent)$/i },
        "2ch_ua":    { iskey: true, regexp: /^(x[_-]?)?2ch[_-]?ua$/i, name: "x2ch_ua" },
        "common_ua": { iskey: true, regexp: /^user[_-]?agent$/i },
        // ** 自動更新 **
        "auto_auth":      { iskey: false, regexp: /^auto[_-]?auth$/i, type: "number",
                            check: function(v){ return (v == AUTO_AUTH_OFF ||
                                    v == AUTO_AUTH_ACCESS || v == AUTO_AUTH_TIMER); } },
        "auth_interval":  { iskey: false, regexp: /^auth[_-]?interval$/i, type: "number",
                            check: function(v){ return (v == 0 ||
                                    v >= AUTH_INTERVAL_MIN && v <= AUTH_INTERVAL_MAX); } },
        "retry_interval": { iskey: false, regexp: /^retry[_-]?interval$/i, type: "number",
                            check: function(v){ return (v == 0 ||
                                    v >= AUTH_INTERVAL_MIN && v <= AUTH_INTERVAL_MAX); } },
        "wake_delay":     { iskey: false, regexp: /^wake[_-]?delay$/i, type: "number",
                            check: function(v){ return (v >= 0 && v <= WAKE_DELAY_MAX); } },
    },

    /**
     * 初期化処理
     */
    startup: function PreferenceManager_startup(aMenuButtonID, aDropTargetID){
        this.menuButton = document.getElementById(aMenuButtonID);
        this.dropTarget = document.getElementById(aDropTargetID);
        this.menuButton.addEventListener("command", this, false);
        this.menuButton.addEventListener("keydown", this, false);
        this.menuButton.addEventListener("mousedown", this, false);
        this.menuButton.addEventListener("popupshowing", this, false);
        this.dropTarget.addEventListener("dragenter", this, false);
        this.dropTarget.addEventListener("dragover", this, false);
        this.dropTarget.addEventListener("drop", this, false);

        // 現在の設定を this.preferences へ保存
        this.preferences = {};
        var prefNodes = document.getElementsByTagName("preference");
        Array.slice(prefNodes).forEach(function(node){
            var name = node.name.replace(API_BRANCH, "");
            if(this._prefTable[name]){
                this.preferences[name] = node.value;
            }
        }, this);
    },

    /**
     * 終了処理
     */
    shutdown: function PreferenceManager_shutdown(){
        this.menuButton.removeEventListener("command", this, false);
        this.menuButton.removeEventListener("keydown", this, false);
        this.menuButton.removeEventListener("mousedown", this, false);
        this.menuButton.removeEventListener("popupshowing", this, false);
        this.dropTarget.removeEventListener("dragenter", this, false);
        this.dropTarget.removeEventListener("dragover", this, false);
        this.dropTarget.removeEventListener("drop", this, false);
    },

    /**
     * イベントハンドラ
     */
    handleEvent: function PreferenceManager_handleEvent(aEvent){
        if(aEvent.type == "command"){
            switch(aEvent.target.value){
                case "loadFile": this.loadFromFile(null);  break;
                case "loadClip": this.loadFromClipboard(); break;
                case "saveAll":  this.saveToFile(false);   break;
                case "saveKey":  this.saveToFile(true);    break;
                case "clearKey": this.clearKeys();         break;
                case "restore":  this.resetPrefs(true);    break;
                case "reset":    this.resetPrefs(false);   break;
                case "readme":   this.openURL(this.README_URL); break;
                case "help":     this.openURL(this.HELP_URL);   break;
                case "version":  this.showVersion();       break;
            }
            return;
        }

        if(aEvent.type == "keydown" || aEvent.type == "mousedown"){
            // 本来は popupshowing の方でやるべきことだが、
            // そちらでは shiftKey の状態が得られないので
            if(aEvent.target != this.menuButton) return;
            if(aEvent.type == "keydown" && aEvent.keyCode != aEvent.DOM_VK_F4 ||
               aEvent.type == "mousedown" && aEvent.button != 0) return;
            var menuNodes = aEvent.target.getElementsByAttribute("value", "loadClip");
            Array.slice(menuNodes).forEach(function(node){
                node.hidden = !aEvent.shiftKey;
            });
            return;
        }
        if(aEvent.type == "popupshowing"){
            if(aEvent.target.parentNode != this.menuButton) return;
            var loadClip = aEvent.target.getElementsByAttribute("value", "loadClip").item(0);
            if(loadClip.hidden) return;
            var clip = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
            loadClip.disabled =
                !clip.hasDataMatchingFlavors(["text/unicode"], 1, clip.kGlobalClipboard);
        }

        // ファイル/テキストの Drag&Drop
        if(aEvent.type == "dragenter" || aEvent.type == "dragover" || aEvent.type == "drop"){
            var dt = aEvent.dataTransfer;
            if(dt.mozItemCount > 1) return;
            var type = null;
            ["application/x-moz-file", "text/plain"].some(function(value){
                return dt.types.contains(value) ? (type = value, true) : false;
            });
            if(type == null) return;
            // textbox への Drag&Drop はデフォルト動作のままとする
            if(type == "text/plain" && aEvent.target.tagName == "textbox") return;

            aEvent.stopPropagation();
            aEvent.preventDefault();
            if(aEvent.type != "drop") return;

            if(type == "application/x-moz-file"){
                var file = dt.mozGetDataAt("application/x-moz-file", 0);
                if(!(file instanceof Ci.nsIFile)) return;
                this.loadFromFile(file);
            }else{
                var text = dt.getData("text/plain");
                if(!text) return;
                this.loadFromText(text, false);
            }
            return;
        }
    },

    /**
     * 設定をクリップボードから読み込む
     */
    loadFromClipboard: function PreferenceManager_loadFromClipboard(){
        var trans = Cc["@mozilla.org/widget/transferable;1"]
                    .createInstance(Ci.nsITransferable);
        trans.init(null);
        trans.addDataFlavor("text/unicode");

        var clip = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
        clip.getData(trans, clip.kGlobalClipboard);

        var text = { value: null };
        try{
            trans.getTransferData("text/unicode", text, {});
        }catch(ex){}

        if(!(text.value instanceof Ci.nsISupportsString)){
            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                          .getService(Ci.nsIPromptService);
            prompts.alert(window, "設定をクリップボードから読み込み",
                                  "クリップボードにテキストデータがありません");
            return;
        }

        this.loadFromText(text.value.data, false);
    },

    /**
     * 設定をファイルから読み込む
     */
    loadFromFile: function PreferenceManager_loadFromFile(aFile){
        if(!aFile){
            var fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
            fp.init(window, "設定をファイルから読み込み", Ci.nsIFilePicker.modeOpen);
            fp.appendFilters(Ci.nsIFilePicker.filterText);
            fp.appendFilters(Ci.nsIFilePicker.filterAll);
            try{
                var dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
                dir.initWithPath(this.menuButton.getAttribute("loadDir"));
                fp.displayDirectory = dir;
            }catch(ex){}

            var result = fp.show();
            if(result != Ci.nsIFilePicker.returnOK) return;

            if(fp.displayDirectory && fp.displayDirectory.path){
                this.menuButton.setAttribute("loadDir", fp.displayDirectory.path);
            }

            aFile = fp.file;
        }

        var fileText;
        try{
            // 誤操作で巨大なバイナリファイルなどが読み込まれないように
            if(aFile.fileSize > 64*1024) throw "サイズが64KBを超えるファイルは読み込めません";
            fileText = ChaikaCore.io.readString(aFile, "UTF-8");
            if(fileText.indexOf("\uFFFD")){     //U+FFFD = REPLACEMENT CHARACTER
                fileText = ChaikaCore.io.readString(aFile, "Shift_JIS");
            }
        }catch(ex){
            var msg = (typeof ex == "string") ? ex : "ファイルの読み込みに失敗しました";
            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                          .getService(Ci.nsIPromptService);
            prompts.alert(window, "設定をファイルから読み込み", msg);
            return;
        }

        this.loadFromText(fileText, false);
    },

    /**
     * 設定をiniファイルフォーマットテキストから読み込む
     */
    loadFromText: function PreferenceManager_loadFromText(aIniText, aKeyOnly){
        var preferences = this._parseIni(aIniText, function(key, value){
            for(var name in this._prefTable){
                var pref = this._prefTable[name];
                if(pref && pref.regexp.test(key) && (pref.iskey || !aKeyOnly)){
                    if(!pref.type && /[^\t\u0020-\u007E\u0080-\u00FF]/.test(value) ||
                        pref.type && typeof value != pref.type) return undefined;
                    if(pref.check && !pref.check(value)) return undefined;
                    return { key: name, value: value };
                }
            }
        }, this);

        var sections = Object.keys(preferences);
        var selected = { value: 0 };
        if(sections.length >= 2){
            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                          .getService(Ci.nsIPromptService);
            var result = prompts.select(window, "設定の読み込み",
                                        "読み込むセクションを選択してください",
                                        sections.length, sections, selected);
            if(!result) return;
        }else if(sections.length == 0){
            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                          .getService(Ci.nsIPromptService);
            prompts.alert(window, "設定の読み込み", "認識できるデータがありませんでした");
            return;
        }
        preferences = preferences[sections[selected.value]];

        // common_ua (iniファイルでは user_agent) は dat_ua, post_ua, auth_ua の共通値を示す
        if("common_ua" in preferences){
            ["useragent", "post_ua", "auth_ua"].forEach(function(name){
                if(!(name in preferences)) preferences[name] = preferences.common_ua;
            });
            delete preferences.common_ua;
        }

        var prefNodes = document.getElementsByTagName("preference");
        Array.slice(prefNodes).forEach(function(node){
            var name = node.name.replace(API_BRANCH, "");
            var value = preferences[name];
            if(value !== undefined) node.value = value;
        }, this);

        this.prefUpdate();
    },

    /**
     * 文字列をiniファイルフォーマットとして解析する
     * 関数のスタイルは JSON.parse を模しているけど仕様は互換ではないです
     */
    _parseIni: function PreferenceManager__parseIni(aText, aReviver, aThisArg){
        if(typeof aReviver != "function") aReviver = function(k,v){ return v; };
        var data = {};
        var section = "(no section)";   // null ならセクションに属さないデータは認識しない

        aText.split(/[\r\n]+/).forEach(function(line){
            var match;
            line = line.trim();
            if(line.search(/^[;#]/) == 0) return;               // comment
            if((match = line.match(/^\[(.+?)\]/)) != null){     // section
                section = match[1];
                return;
            }
            if(section == null) return;
            if((match = line.match(/^(.+?)\s*[=:]\s*(.*)$/)) != null){  // key/value
                var key   = match[1];
                var value = match[2].replace(/^(["'])(.*)\1$/, "$2");
                var wk;
                // JSONと違って値の型は保存されないので、
                // 値の内容に応じてtoStringの逆変換をする
                if(value.search(/^(true|false)$/i) == 0){
                    value = (value.length == 4);    // Boolean
                }else if((wk = Number(value)).toString() == value){
                    value = wk;                     // Number
                }
                value = aReviver.call(aThisArg, key, value);
                if(typeof value == "object" && value !== null){
                    key   = value.key;
                    value = value.value;
                }
                if(key === undefined || value === undefined) return;
                if(!data[section]) data[section] = {};
                data[section][key] = value;
            }
        });

        return data;
    },

    /**
     * 設定をiniファイルフォーマットでファイルへ保存
     */
    saveToFile: function PreferenceManager_saveToFile(aKeyOnly){
        var title = aKeyOnly ? "KeyとUAのみをファイルへ保存" : "すべての設定をファイルへ保存";
        var fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
        fp.init(window, title, Ci.nsIFilePicker.modeSave);
        fp.appendFilters(Ci.nsIFilePicker.filterText);
        fp.appendFilters(Ci.nsIFilePicker.filterAll);
        fp.defaultString = aKeyOnly ? "apikeys.txt" : "apiconf.txt";
        fp.defaultExtension = "txt";
        try{
            var dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
            dir.initWithPath(this.menuButton.getAttribute("saveDir"));
            fp.displayDirectory = dir;
        }catch(ex){}

        var result = fp.show();
        if(result != Ci.nsIFilePicker.returnOK &&
           result != Ci.nsIFilePicker.returnReplace) return;

        if(fp.displayDirectory && fp.displayDirectory.path){
            this.menuButton.setAttribute("saveDir", fp.displayDirectory.path);
        }

        var fileText = ["; 2ch API extension for chaika",
                        "; " + new Date().toLocaleString(),
                        "[chaika2chApi]"];
        var index = fileText.length;
        var prefNodes = document.getElementsByTagName("preference");
        Array.slice(prefNodes).forEach(function(node){
            var name = node.name.replace(API_BRANCH, "");
            var pref = this._prefTable[name];
            if(!pref) return;   // next
            var value = String(node.value).replace(/^(?:\s.*|.*\s)$/, '"$&"');
            if(pref.name) name = pref.name; // 代替名がある場合
            if(pref.iskey){                 // Keyを前に集める
                fileText.splice(index++, 0, name + " = " + value);
            }else if(!aKeyOnly){
                fileText.push(name + " = " + value);
            }
        }, this);

        var osName = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).OS;
        const NEWLINE = (osName == "WINNT") ? "\r\n" : "\n";
        fileText = fileText.concat("").join(NEWLINE);

        try{
            ChaikaCore.io.writeString(fp.file, null, false, fileText);
        }catch(ex){
            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                          .getService(Ci.nsIPromptService);
            prompts.alert(window, title, "ファイルの書き込みに失敗しました");
        }
    },

    /**
     * AppKey, HMKey, User-Agent の消去
     */
    clearKeys: function PreferenceManager_clearKeys(){
        var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                      .getService(Ci.nsIPromptService);
        var result = prompts.confirm(window, "2ch API の設定",
                                     "AppKey, HMKey, User-Agent の各項目を消去します。\n" +
                                     "よろしいですか？");
        if(!result) return;

        var prefNodes = document.getElementsByTagName("preference");
        Array.slice(prefNodes).forEach(function(node){
            var name = node.name.replace(API_BRANCH, "");
            var pref = this._prefTable[name];
            if(pref && pref.iskey) node.value = "";
        }, this);

        this.prefUpdate();
    },

    /**
     * 設定をデフォルトに戻す／元に戻す
     */
    resetPrefs: function PreferenceManager_resetPrefs(aRestore){
        var excludeKey = { value: false };
        var msg = aRestore ? "すべての設定をダイアログが開かれたときの状態に戻します。\n" :
                             "すべての設定を既定値（デフォルト）に戻します。\n";
        var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                      .getService(Ci.nsIPromptService);
        var result = prompts.confirmCheck(window, "2ch API の設定", msg + "よろしいですか？",
                                          "AppKey, HMKey, User-Agent は戻さない", excludeKey);
        if(!result) return;

        var prefNodes = document.getElementsByTagName("preference");
        Array.slice(prefNodes).forEach(function(node){
            var name = node.name.replace(API_BRANCH, "");
            var pref = this._prefTable[name];
            if(pref && (!excludeKey.value || !pref.iskey)){
                // node.reset() を呼ぶと node.value が undefined になってしまうので
                node.value = aRestore ? this.preferences[name] : node.defaultValue;
            }
        }, this);

        this.prefUpdate();
    },

    /**
     * URL を新しいタブで開く
     * @param {String} aURL 開く URL
     */
    openURL: function PreferenceManager_openURL(aURL){
        var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
        ChaikaCore.browser.openURL(ioService.newURI(aURL, null, null), true);
    },

    /**
     * バージョン情報の表示
     */
    showVersion: function PreferenceManager_showVersion(){
        var msg = "2ch API extension for chaika - version " + Chaika2chApi.VERSION +
                  "\nDeveloped by masami";
        var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                      .getService(Ci.nsIPromptService);
        prompts.alert(window, "バージョン情報", msg);
    }
};


/**
 * settings.js にある setContainerDisabled の機能強化版
 * aEnabledValue を複数指定できるようにしたもの
 */
function setContainerDisabledEx(aPref, aContainerID, aEnabledValue){
    var prefValue = document.getElementById(aPref).value;
    var container = document.getElementById(aContainerID);
    var disabled;

    if(arguments.length > 3){
        disabled = Array.slice(arguments,2).every(function(arg){
            return (prefValue !== arg);
        });
    }else{
        disabled = (prefValue !== aEnabledValue);
    }

    container.disabled = disabled;
    var childNodes = container.getElementsByTagName("*");
    Array.slice(childNodes).forEach(function(node){
        node.disabled = disabled;
    });

    return disabled;
}
