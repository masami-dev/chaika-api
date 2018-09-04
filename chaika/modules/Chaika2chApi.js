/*
 * Chaika2chApi.js - 2ch API extension for chaika コアモジュール
 *
 * このファイルのあるべき位置：modules/Chaika2chApi.js
 *
 * Written by masami ◆U7rHG6DINI
 * 使用条件・ライセンス等については chaika 本体に準じます。
 * MPL 1.1/GPL 2.0/LGPL 2.1 のいずれかのライセンスが定める条件に従ってください。
 *
 * 註：このファイルは、オリジナルの bbs2chreader/chaika の構成要素ではありません。
 *     この 2ch API extension for chaika は、オリジナルの bbs2chreader/chaika の
 *     作成者・開発者とは全く別の人物が開発しているものです。
 *     license.txtやその他のソースコード・付属文書・公式サイトなどで明記されている
 *     オリジナルの bbs2chreader/chaika の作成者・開発者・寄付者/貢献者などは、
 *     この 2ch API extension for chaika の開発には一切関与しておりません。
 *
 * Last Modified : 2018/09/02 17:42:40
 */


EXPORTED_SYMBOLS = ["Chaika2chApi"];
Components.utils.import("resource://chaika-modules/ChaikaCore.js");

Components.utils.import("resource://chaika-modules/ChaikaLogin.js");
if(typeof ChaikaRoninLogin != "undefined"){
    var PREF_RONIN_ID = "login.ronin.id";   // chaika 1.7.0 以降
}else{
    Components.utils.import("resource://chaika-modules/Chaika2chViewer.js");
    var ChaikaRoninLogin = Chaika2chViewer; // for getLoginInfo()
    var PREF_RONIN_ID = "maru_id";          // chaika 1.6.3 以前
}


const Ci = Components.interfaces;
const Cc = Components.classes;
const Cr = Components.results;

const PROPERTIES_URL = "resource://chaika-modules/Chaika2chApi.properties";

const AUTO_AUTH_OFF     = 0;        // sessionIDの自動更新をしない(起動時のみ更新)
const AUTO_AUTH_ACCESS  = 1;        // datAPIサーバへのアクセス直後に自動更新する
const AUTO_AUTH_TIMER   = 2;        // タイマーを使って一定間隔に自動更新する
const AUTH_INTERVAL_MIN = 180;      // 認証間隔の最小値(秒)
const AUTH_INTERVAL_MAX = 86400;    // 認証間隔の最大値(秒)
const RETRY_COUNT_MAX   = 100;      // リトライ回数の最大値
const SESSIONID_LIFETIME = 86400;   // sessionIDの有効期間(秒)
const ASYNC_DELAY = 0.5;


/** @ignore */
function makeException(aResult){
    var stack = Components.stack.caller.caller;
    return new Components.Exception("exception", aResult, stack);
}


/**
 * 2ch API オブジェクト
 * @class
 */
var Chaika2chApi = {

    VERSION: "0.14",


    /**
     * API認証状態
     */
    authorized: false,          // sessionID 取得済みならtrue
    sessionID: "",              // sessionID
    lastAuthTime: 0,            // sessionIDの取得日時(UNIX Time)
    lastAuthTried: 0,           // 前回認証を行なった日時(UNIX Time)
    authError: "",              // 認証エラーならエラー原因を示す文字列が入る
    errorCount: 0,              // 認証エラーの回数
    dontRetry: false,           // trueなら自動更新による認証リトライをしない
    userStatus: null,           // datAPIサーバのUser-Status / -1:AppKey/HMKey無効


    /**
     * 設定情報
     */
    pref: null,


    /**
     * sessionID自動更新用タイマー
     */
    _timer: null,


    /**
     * ブラウザ起動時のプロファイル読み込み後に一度だけ実行され、初期化処理を行う。
     * @private
     */
    _startup: function Chaika2chApi__startup(){
        this._timer = new Chaika2chApiTimer(this._authStart.bind(this));
        this.pref = new Chaika2chApiPref(this._onPrefChange.bind(this));
        this.pref.load();
        this.apiAuth("startup");
    },


    /**
     * ブラウザ終了時に一度だけ実行され、終了処理を行う。
     * @private
     */
    _quit: function Chaika2chApi__quit(){
        this.pref.unload();
        this.pref = null;
        this._timer = null;
    },


    /**
     * this.pref の設定値に変化があったときに呼ばれるコールバック
     * @param {String} aName 変化があった設定項目名
     * @param {String} aContext load:初期化 unload:終了処理 change:動作中の変更通知
     * @param          aPrev その設定項目の変化前の値
     */
    _onPrefChange: function Chaika2chApi__onPrefChange(aName, aContext, aPrev){
        switch(aName){
            case "2chapi.enabled":
                this._overrideGetHttpChannel(this.pref.enabled);
                if(!this.pref.enabled) this.clearAuth(false);
                break;
            case "2chapi.auth_url":
            case "2chapi.appkey":
            case "2chapi.hmkey":
            case "2chapi.ct_value":
            case "2chapi.auth_ua":
            case "2chapi.2ch_ua":
                // 認証に関係する設定が変更された場合。
                // ct_value auth_ua 2ch_ua に関しては、
                // 認証への影響は現在確認されていないが一応
                if(aContext == "change") this.clearAuth(true);
                break;
            case "2chapi.auto_auth":
            case "2chapi.auth_interval":
            case "2chapi.retry_interval":
                if(aContext == "change") this._setAuthTimer();
                break;
            case "2chapi.wake_delay":
                this._timer.wakeDelay = this.pref.wakeDelay;
                break;
            case "login.ronin.id_pass*":
                // アカウント登録を消したときなどは、
                // 今すぐにsessionIDを取り直す必要はないと思う
                if(aContext == "change" &&
                   this.pref.ronin.id && this.pref.ronin.password){
                    this.clearAuth(true);
                }
                break;
        }
    },


    /**
     * API認証状態(セッションID)の消去
     * @param {Bool} aAll true なら設定に保存されているセッションIDも消去する
     */
    clearAuth: function Chaika2chApi_clearAuth(aAll){
        this.authorized = false;
        this.sessionID = "";
        this.lastAuthTime = 0;
        this.lastAuthTried = 0;
        this.authError = "";
        this.errorCount = 0;
        this.dontRetry = false;
        this.userStatus = null;

        if(aAll){
            ChaikaCore.pref.setChar("2chapi.session_id", "");
            ChaikaCore.pref.setInt("2chapi.last_auth_time", 0);
            ChaikaCore.logger.debug("Auth: CLEAR_ALL");
        }else{
            ChaikaCore.logger.debug("Auth: CLEAR");
        }
        var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
        os.notifyObservers(null, "Chaika2chApi:Auth", "CLEAR");

        this._timer.setTimeout(0);  // stop
    },


    /**
     * 認証テストの実行
     * 現在のセッションIDを上書きする形で認証を実行する
     */
    authTest: function Chaika2chApi_authTest(){
        if(!this.pref.enabled) return;
        this._loadAuth();
        this._authStart("test");
    },


    /**
     * 初期化処理の最後・設定ダイアログを閉じたときの認証
     * 有効なセッションIDが残っていればそれをロードするのみ・もし無ければ認証を行う
     * @param {String} aAuthContext 認証が行われる状況を表す文字列(null可)
     */
    apiAuth: function Chaika2chApi_apiAuth(aAuthContext){
        if(!this.pref.enabled) return;
        if(this._loadAuth()) return;
        this._timer.setTimeout(ASYNC_DELAY, aAuthContext || "auth");
    },


    /**
     * 設定に保存されているセッションIDがあれば読み込む
     * @return {Bool} true ならセッションIDを今すぐ取り直す必要なし
     */
    _loadAuth: function Chaika2chApi__loadAuth(){
        if(!(this.pref.appKey && this.pref.hmKey &&
             this.pref.authURL && this.pref.apiURL)) return false;

        if(this.sessionID) return true;

        var sessionID = ChaikaCore.pref.getChar("2chapi.session_id");
        var lastAuthTime = ChaikaCore.pref.getInt("2chapi.last_auth_time");
        if(!sessionID) return false;    // 取得済のsessionIDなし

        // 前回のsessionIDが存在する場合は、常にそれを読み込んでおいた上で
        // 今すぐ更新する必要があるか判断する（_apiAuthNG のコメントも参照）

        this.authorized = true;
        this.sessionID = sessionID;
        this.lastAuthTime = lastAuthTime;
        this.lastAuthTried = lastAuthTime;
        this.authError = "";
        this.errorCount = 0;
        this.dontRetry = false;
        this.userStatus = null;

        ChaikaCore.logger.debug("Auth: LOAD; authTime: " + new Date(lastAuthTime * 1000));
        var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
        os.notifyObservers(null, "Chaika2chApi:Auth", "LOAD");

        var elapsedTime = Math.round(Date.now() / 1000) - lastAuthTime;
        var interval = (this.pref.autoAuth != AUTO_AUTH_OFF &&
                        this.pref.authInterval) || AUTH_INTERVAL_MIN;

        // 自動更新OFFの場合でも、起動時認証が短時間に連続するのを避けるため、
        // 過去 AUTH_INTERVAL_MIN 秒間に取得したsessionIDがあればそれを再利用する

        // リアルタイムクロックをユーザーが戻すこともありえる
        if(elapsedTime < 0 || elapsedTime >= interval) return false;  // sessionIDの更新必要

        this._setAuthTimer();

        return true;    // sessionIDはフレッシュ
    },


    /**
     * 認証処理(セッションID取得)の開始
     * @param {String} aAuthContext 認証が行われる状況を表す文字列
     */
    _authStart: function Chaika2chApi__authStart(aAuthContext){
        if(!(this.pref.appKey && this.pref.hmKey && this.pref.authURL && this.pref.apiURL)){
            ChaikaCore.logger.debug("Auth: STOP");
            var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
            os.notifyObservers(null, "Chaika2chApi:Auth", "STOP");
            this._timer.setTimeout(0);  // stop
            return;
        }
        var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
        var authURL = ioService.newURI(this.pref.authURL, null, null).QueryInterface(Ci.nsIURL);

        var httpChannel = ChaikaCore.getHttpChannel(authURL, "auth");
        httpChannel.setRequestHeader("X-2ch-UA", this.pref.x2chUA, false);
        httpChannel.setRequestHeader("Content-Type", "application/x-www-form-urlencoded", false);
        httpChannel = httpChannel.QueryInterface(Ci.nsIUploadChannel);

        if(this.pref.ronin.id != "" || this.pref.ronin.password != ""){
            ChaikaCore.logger.debug("Auth Ronin: id:" + this.pref.ronin.id +
                                    ", password:" + this.pref.ronin.password);
        }

        var wk, CT = this.pref.ctValue || "";        // failsafe for null
        CT = (wk = CT.match(/^\d{1,10}/)) ? wk[0] :                             // 固定値
             (CT.search(/Random/i) != -1) ? Math.floor(Math.random() * 1e10) :  // ランダム値
                                            Math.round(Date.now() / 1000);      // UNIX時刻
        CT = ("000000000" + CT).slice(-10);     // 10桁に満たない場合は先頭を0で埋める
        ChaikaCore.logger.debug("Auth CT: " + CT);

        var HB = this._getHMAC(this.pref.hmKey, this.pref.appKey + CT);

        var strStream = Cc["@mozilla.org/io/string-input-stream;1"]
                        .createInstance(Ci.nsIStringInputStream);
        var postString = String("ID="  + encodeURIComponent(this.pref.ronin.id) +
                                "&PW=" + encodeURIComponent(this.pref.ronin.password) +
                                "&KY=" + encodeURIComponent(this.pref.appKey) +
                                "&CT=" + CT + "&HB=" + HB);
        strStream.setData(postString, postString.length);
        httpChannel.setUploadStream(strStream, "application/x-www-form-urlencoded", -1);
        httpChannel.requestMethod = "POST";

        var authListener2chApi = {
            onStartRequest: function authListener2chApi_onStartRequest(aRequest, aContext){
                this._binaryStream = Cc["@mozilla.org/binaryinputstream;1"]
                        .createInstance(Ci.nsIBinaryInputStream);
                this._data = [];
            },
            onDataAvailable: function authListener2chApi_onDataAvailable(aRequest, aContext,
                                                                aInputStream, aOffset, aCount){
                this._binaryStream.setInputStream(aInputStream);
                this._data.push(this._binaryStream.readBytes(aCount));
            },
            onStopRequest: function authListener2chApi_onStopRequest(aRequest, aContext, aStatus){
                var data = this._data.join("");
                ChaikaCore.logger.debug("Auth Response: " + data);
                if(data.search(/^SESSION-ID=Monazilla\/.+?:/i) == -1){
                    aRequest.QueryInterface(Ci.nsIHttpChannel);
                    Chaika2chApi._apiAuthNG(data, aRequest, aAuthContext);
                    return;
                }
                // セッションIDの本体は、戻ってきた値の「Monazilla/1.00:」以降の部分
                data = data.replace(/^SESSION-ID=Monazilla\/.+?:/i, '').replace(/[\n\r]/g, '');
                Chaika2chApi._apiAuthOK(data);
            }
        };

        httpChannel.asyncOpen(authListener2chApi, null);
        ChaikaCore.logger.debug("Auth: START");
    },


    /**
     * 認証に成功したとき
     * @param {String} aSessionID 取得できたセッションIDの本体
     */
    _apiAuthOK: function Chaika2chApi__apiAuthOK(aSessionID){
        this.authorized = true;
        this.sessionID = aSessionID;
        this.lastAuthTime = this.lastAuthTried = Math.round(Date.now() / 1000);
        this.authError = "";
        this.errorCount = 0;
        this.dontRetry = false;
        this.userStatus = null;

        ChaikaCore.pref.setChar("2chapi.session_id", this.sessionID);
        ChaikaCore.pref.setInt("2chapi.last_auth_time", this.lastAuthTime);

        ChaikaCore.logger.debug("Auth: OK; Time: " + new Date(this.lastAuthTime * 1000));

        this._setAuthTimer();

        var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
        os.notifyObservers(null, "Chaika2chApi:Auth", "OK");
    },


    /**
     * 認証に失敗したとき
     * @param {String} aData 認証サーバーから返されたレスポンスボディ
     * @param {nsIHttpChannel} aRequest
     * @param {String} aAuthContext 認証が行われた状況を表す文字列
     */
    _apiAuthNG: function Chaika2chApi__apiAuthNG(aData, aRequest, aAuthContext){
        // 失敗した場合は前回のsessionIDを消さずにそのままにしておく。
        // 前回のsessionIDにはまだ有効期間が残っている場合が多く、
        // 何らかの理由で更新ができない場合は、前回のを引き続き使う。

        this.lastAuthTried = Math.round(Date.now() / 1000);

        // 有効なsessionIDがない状態では、ユーザーがスレッド表示をリロードするたびに
        // エラー時自動認証が毎回行われるので、通常の自動更新によるリトライを止め、
        // エラー時自動認証によるリトライのみにする。
        if(aAuthContext == "error") this.dontRetry = true;

        var strBundle = Cc["@mozilla.org/intl/stringbundle;1"]
                        .getService(Ci.nsIStringBundleService).createBundle(PROPERTIES_URL);
        try{
            if(aRequest.requestSucceeded){
                // 失敗の原因が設定にある場合は何度やっても同じなのでリトライしない
                if(aData.toLowerCase() == "ng (appkey incorrect length)") this.dontRetry = true;
                // 長いレスポンスが返ってきた場合の備えて256文字に制限する
                this.authError = strBundle.formatStringFromName("server_response",
                                                                [aData.slice(0,256)], 1);
            }else{
                this.authError = strBundle.formatStringFromName("http_status",
                    [String(aRequest.responseStatus), aRequest.responseStatusText], 2);
            }
        }catch(ex){
            this.authError = strBundle.formatStringFromName("unable_to_connect",
                                                            [aRequest.URI.spec], 1);
        }

        ChaikaCore.logger.debug("Auth: NG; Time: " + new Date(this.lastAuthTried * 1000));

        this.errorCount += 1;
        ChaikaCore.logger.debug("Auth Error: " + this.authError);
        ChaikaCore.logger.debug("Auth Error Count: " + this.errorCount);

        this._setAuthTimer();

        var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
        os.notifyObservers(null, "Chaika2chApi:Auth", "NG");

        // 手動操作による認証でのエラーで、通知する必要性が高い場合のみ通知を表示する
        // 設定ダイアログを閉じた直後 or エラー時自動認証
        if(aAuthContext == "auth" || aAuthContext == "error") try{
            var msg = strBundle.formatStringFromName("authorization_failed", [this.authError], 1);
            var alertsService = Cc["@mozilla.org/alerts-service;1"].getService(Ci.nsIAlertsService);
            alertsService.showAlertNotification("", "2ch API", msg, false, "", null);
        }catch(ex){}
    },


    /**
     * 認証タイマーの設定（タイマーによる自動更新）
     * @private
     */
    _setAuthTimer: function Chaika2chApi__setAuthTimer(){
        if(this.pref.enabled &&
           this.pref.autoAuth == AUTO_AUTH_TIMER && this.lastAuthTried != 0){
            var elapsedTime = Math.round(Date.now() / 1000) - this.lastAuthTried;
            var interval = (this.errorCount == 0) ? this.pref.authInterval :
                           !this.dontRetry ? this.pref.retryInterval : 0;
            var delay = (interval == 0) ? 0 :
                        (elapsedTime < 0 || elapsedTime >= interval) ? ASYNC_DELAY :
                        interval - elapsedTime;
            this._timer.setTimeout(delay, "timer");
        }else{
            this._timer.setTimeout(0);  // stop
        }
    },


    /**
     * datAPIサーバからレスポンスが返ってきたときに呼ばれる関数
     * @param {Object} aApiStatus datAPIサーバが返してきた各種ステータス
     */
    _onApiResponse: function Chaika2chApi__onApiResponse(aApiStatus){
        if(!this.pref.enabled) return;

        if((aApiStatus.text === "api_invalid_id" || aApiStatus.text === "api_empty_id") &&
           aApiStatus.sessionID == this.sessionID){
            this._timer.setTimeout(ASYNC_DELAY, "error");       // エラー時自動認証

        }else if(this.pref.autoAuth == AUTO_AUTH_ACCESS && this.lastAuthTried != 0){
            var elapsedTime = Math.round(Date.now() / 1000) - this.lastAuthTried;
            var interval = (this.errorCount == 0) ? this.pref.authInterval :
                           !this.dontRetry ? this.pref.retryInterval : 0;

            if(interval != 0 && (elapsedTime < 0 || elapsedTime >= interval)){
                this._timer.setTimeout(ASYNC_DELAY, "access");  // APIアクセス時の自動更新
            }
        }
    },


    /**
     * HMAC SHA-256 の計算
     * @param {String} aKey 計算に使うキー
     * @param {String} aData 対象データ
     * @return {String} HMAC SHA-256 16進文字列形式
     */
    _getHMAC: function Chaika2chApi__getHMAC(aKey, aData){
        var keyService = Cc["@mozilla.org/security/keyobjectfactory;1"]
                         .getService(Ci.nsIKeyObjectFactory);
        var keyObj = keyService.keyFromString(Ci.nsIKeyObject.HMAC, aKey);

        var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                        .createInstance(Ci.nsIScriptableUnicodeConverter);
        converter.charset = "UTF-8";
        var dataArray = converter.convertToByteArray(aData);

        var cryptoHMAC = Cc["@mozilla.org/security/hmac;1"]
                         .createInstance(Ci.nsICryptoHMAC);
        cryptoHMAC.init(cryptoHMAC.SHA256, keyObj);
        cryptoHMAC.update(dataArray, dataArray.length);
        var binHMAC = cryptoHMAC.finish(false);

        var hexHMAC = new Array(binHMAC.length);
        for(var i=0; i<binHMAC.length; i++){
            hexHMAC[i] = (0x100 + binHMAC.charCodeAt(i)).toString(16).slice(-2);
        }
        return hexHMAC.join("");
    },


    /**
     * ChaikaCore.getHttpChannel() へのoverride設定および解除を行う
     * @param {Bool} aOverride trueなら設定／falseなら解除
     */
    _overrideGetHttpChannel: (function(){
        var ChaikaCore_getHttpChannel = null;   // 元の関数を保持

        return function Chaika2chApi__overrideGetHttpChannel(aOverride) {
            if(aOverride){
                if(!ChaikaCore_getHttpChannel){     // override設定
                    ChaikaCore_getHttpChannel = ChaikaCore.getHttpChannel;
                    ChaikaCore.getHttpChannel = Chaika2chApi_getHttpChannel;
                }
            }else{
                if(ChaikaCore_getHttpChannel){      // override解除
                    ChaikaCore.getHttpChannel = ChaikaCore_getHttpChannel;
                    ChaikaCore_getHttpChannel = null;
                }
            }
        };

        /**
         * ChaikaCore.getHttpChannel() をoverrideし、2ch API対応化に必要な処理を行う
         * aURLが2chのdatファイルのURLなら、APIを介したdat取得に必要な前処理を付け加える
         * aURLが2ch.netドメインのその他のURLなら、User-Agent名の偽装とcookieの制御のみを行う
         * @param {nsIURI} aURL nsIHttpChannel を作成する URL
         * @param {String} aAPI APIサーバURLの種別(auth or dat)
         * @return {nsIHttpChannel}
         */
        function Chaika2chApi_getHttpChannel(aURL, aAPI){
            if(!(aURL instanceof Ci.nsIURI)){
                throw makeException(Cr.NS_ERROR_INVALID_POINTER);
            }
            var self = Chaika2chApi;    // この関数内での this は ChaikaCore を指すため
            var httpChannel, host, path;

            // RoninがなければAPIサーバからは過去ログは取れないし、
            // Roninがあれば最初の1回のアクセスで現行ログも過去ログも取れるので、
            // 過去ログを取るためのdatKakoURLはここでは敢えて認識していない。

            if(aAPI !== undefined ||
               !((host = aURL.host.match(self.pref.hostRxp)) &&
                 (path = aURL.path.match(/^\/([^\/]+)\/dat\/(\d+)\.dat$/)) &&
                 self.pref.appKey && self.pref.hmKey && self.pref.apiURL)){
                httpChannel = ChaikaCore_getHttpChannel.call(this, aURL);   // 元の関数

                if(aAPI !== undefined){
                    if(aAPI == "auth"){
                        httpChannel.setRequestHeader("User-Agent", self.pref.authUA, false);
                        httpChannel.loadFlags |= Ci.nsIRequest.LOAD_ANONYMOUS;  // cookie を渡さない
                    }else{  // "dat"
                        httpChannel.setRequestHeader("User-Agent", self.pref.userAgent, false);
                        httpChannel.loadFlags |= Ci.nsIRequest.LOAD_ANONYMOUS;
                    }
                }else if(host){
                    if(aURL.path.indexOf("/test/bbs.cgi?guid=ON") == 0){
                        httpChannel.setRequestHeader("User-Agent", self.pref.postUA, false);
                    }else{
                        httpChannel.setRequestHeader("User-Agent", self.pref.userAgent, false);
                        httpChannel.loadFlags |= Ci.nsIRequest.LOAD_ANONYMOUS;
                    }
                }
                return httpChannel;
            }

            var datPath = host[1] +"/"+ path[1] +"/"+ path[2];  // Server/Board/Thread
            var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
            var apiURL = ioService.newURI(self.pref.apiURL, null, null);
            var datURL = ioService.newURI(datPath, null, apiURL).QueryInterface(Ci.nsIURL);

            httpChannel = Chaika2chApi_getHttpChannel.call(this, datURL, "dat");  // callee
            httpChannel.setRequestHeader("Content-Type", "application/x-www-form-urlencoded", false);
            httpChannel = httpChannel.QueryInterface(Ci.nsIUploadChannel);

            var hobo = self._getHMAC(self.pref.hmKey,
                                     datURL.path + self.sessionID + self.pref.appKey);

            // sessionID も about:config から自由に変更することが可能なので念のため
            var strStream = Cc["@mozilla.org/io/string-input-stream;1"]
                            .createInstance(Ci.nsIStringInputStream);
            var postString = String("sid=" + encodeURIComponent(self.sessionID) + "&hobo=" + hobo +
                                    "&appkey=" + encodeURIComponent(self.pref.appKey));
            strStream.setData(postString, postString.length);
            httpChannel.setUploadStream(strStream, "application/x-www-form-urlencoded", -1);
            httpChannel.requestMethod = "POST";

            return httpChannel;
        }
    })(),


    /**
     * 2ch API datサーバが返すステータスを調べて返す
     * @param {nsIHttpChannel} aHttpChannel
     * @param {String} aResponseText
     *                 undefined なら User-Status: と Thread-Status: の値のみを返す
     * @return {Object} 2ch API datサーバへの通信でないなら null
     */
    getApiStatus: function Chaika2chApi_getApiStatus(aHttpChannel, aResponseText){
        if(!(aHttpChannel instanceof Ci.nsIHttpChannel)){
            throw makeException(Cr.NS_ERROR_INVALID_POINTER);
        }
        if(aHttpChannel.requestMethod != "POST" ||
           aHttpChannel.originalURI.spec.indexOf(this.pref.apiURL) != 0) return null;

        var apiStatus = { text: null, userStatus: null, threadStatus: null, kako: false };

        try{
            // User-Status: 0 (sessionID無効) or 1 (sessionID有効) or
            //              2 (sessionID有効／https://2chv.tora3.net/futen.cgiで取得したもの)
            //              3 (sessionID有効／API認証時にRoninアカウントを付けて取得したもの)
            //              ※ User-Status: が 2,3 の時はdat落ち/過去ログも取れる
            // ヘッダそのものが無いときは null / 数値として解釈できないときは NaN
            apiStatus.userStatus = parseInt(aHttpChannel.getResponseHeader("User-Status"));
        }catch(ex){}
        try{
            // Thread-Status: 0 (dat取得不可) or 1 (現行スレ) or 2 (dat落ち) or 3 (過去ログ) or
            //                8 (dat取得不可／Ronin無しでdat落ち/過去ログを取ろうとしたとき)
            // ヘッダそのものが無いときは null / 数値として解釈できないときは NaN
            apiStatus.threadStatus = parseInt(aHttpChannel.getResponseHeader("Thread-Status"));
        }catch(ex){}

        // 2ch API 固有レスポンスヘッダの User-Status: と Thread-Status: を調べるのみ
        if(aResponseText === undefined) return apiStatus;

        // 使われたSessionIDを調べる補助関数
        var getSessionID = function(self){
            try{
                var postString = aHttpChannel.uploadStream.data;
                if(!postString) throw new Error("empty postString");
                return decodeURIComponent(postString.match(/sid=(.*?)(?:(?=&)|$)/)[1]);
            }catch(ex){
                ChaikaCore.logger.error(ex);
                return self.sessionID;  // failsafe
            }
        };

        var httpStatus;
        try{
            httpStatus = aHttpChannel.responseStatus;
        }catch(ex){
            apiStatus.text = "network_error";
            return apiStatus;
        }

        if((apiStatus.threadStatus === 2 || apiStatus.threadStatus === 3) &&
           (httpStatus == 200 || httpStatus == 206 || httpStatus == 304)){
            apiStatus.kako = true;      // 取得対象がdat落ち/過去ログ
        }

        if(apiStatus.threadStatus === 8 && apiStatus.userStatus === 1 &&
           (httpStatus == 200 || httpStatus == 501)){
            // 通常のsessionIDでdat落ちしているログを取ろうとした場合(2015/06/18～)
            // httpStatus:501 になるのはRange付きのリクエストのとき
            // httpStatus:200 の場合はレスポンスボディにダミーdatが返ってくる
            apiStatus.text = "dat_down";

        }else if(httpStatus == 404 && apiStatus.threadStatus === 0){
            // Range付きのリクエストで、本来は 416 Requested Range Not Satisfiable
            // となるべき状況のとき。あるいは、その他の理由でdatが取得できない場合。
            // 現状では416(あぼーん)とその他のケースの区別が難しいようなので、
            // 「あぼーん発生」に決め打ちせずに「エラー：404」のままにしている。
            //apiStatus.text = "abone";

        }else if(httpStatus == 401 && apiStatus.userStatus === 0){
            // sessionIDが無効なとき（有効期限が切れている場合など）
            //  → httpStatus:401, ResponseText:'ng (not authorized)', User-Status:0
            apiStatus.sessionID = getSessionID(this);
            apiStatus.text = "api_invalid_id";

        }else if(httpStatus == 200 && aResponseText){
            // ステータスは200だがdatは返されず、
            // レスポンスボディに短いエラーメッセージが返されるケース。
            // エラーメッセージは現状では全て小文字で返されるようだが、
            // 念のため全て小文字にそろえてマッチングする。
            var responseText = aResponseText.toLowerCase();

            if(responseText == "ng (not valid)"){
                // AppKeyもしくはHMKeyが無効・sessionIDに無効文字が混入している
                apiStatus.sessionID = getSessionID(this);
                apiStatus.text = (apiStatus.sessionID.search(/[^0-9A-Z]/i) != -1) ?
                                                "api_invalid_id" : "api_invalid_keys";

            }else if(responseText == "ng (incorrect uid length)"){
                // sessionIDの長さが正しくない
                apiStatus.sessionID = getSessionID(this);
                apiStatus.text = apiStatus.sessionID ? "api_invalid_id" : "api_empty_id";

            }else if(responseText == "ng (appkey incorrect length)"){
                // AppKeyの長さが正しくない
                apiStatus.text = "api_invalid_keys";

            }else if(responseText.search(/^ng( \([\w\d\s]+\))?$/) != -1){
                // 上のコードでは認識できないAPI関連エラー
                apiStatus.text = "api_unknown_error";
            }
        }

        // this.userStatus の更新（User-Statusヘッダの値 or -1:AppKey/HMKey無効）
        var userStatus = (apiStatus.text === "api_invalid_keys") ? -1 : apiStatus.userStatus;
        if(this.userStatus !== userStatus && userStatus !== null &&
           !isNaN(userStatus) && getSessionID(this) == this.sessionID){
            this.userStatus = userStatus;
            var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
            os.notifyObservers(null, "Chaika2chApi:Auth", "STATUS");
        }

        // 診断メッセージ
        var level = (apiStatus.text === "api_unknown_error") ? "warning" : "debug";
        ChaikaCore.logger[level]("API Status: " + apiStatus.text + ";" +
                (aResponseText ? " ResponseText:'" + aResponseText + "'" : "") +
                " httpStatus:" + httpStatus + " UserStatus:" + apiStatus.userStatus +
                " ThreadStatus:" + apiStatus.threadStatus + " Kako:" + apiStatus.kako +
                " URL:" + aHttpChannel.URI.spec);

        // APIアクセス時のsessionID更新など
        this._onApiResponse(apiStatus);

        return apiStatus;
    },


    /**
     * 現在の各種ステータスを表示用に文字列化して返す
     * @param {String} aWhichStatus 返すステータスの種類
     * @return {String}
     */
    getStatusString: function Chaika2chApi_getStatusString(aWhichStatus){
        var statusString = "";
        var strBundle = Cc["@mozilla.org/intl/stringbundle;1"]
                        .getService(Ci.nsIStringBundleService).createBundle(PROPERTIES_URL);

        // User-Status を文字列化する補助関数
        var getUserStatusString = function(self){
            if(self.userStatus < -1 || self.userStatus > 3){
                return "User-Status:" + self.userStatus;    // failsafe
            }
            var i = !self.sessionID ? 0 : (self.userStatus == null) ? 1 : self.userStatus + 3;
            return strBundle.GetStringFromName(arguments[i + 1]);
        };

        if(aWhichStatus == "currentSession" ||      // 現在のセッション
           aWhichStatus == "currentSessionID"){     // 現在のセッション(ID付)
            statusString = getUserStatusString(this, "not_obtained", "obtained",
                            "keys_invalid", "invalid", "valid", "valid_ronin", "valid_ronin");
            if(this.lastAuthTime != 0){
                statusString += ", " + new Date(this.lastAuthTime * 1000).toLocaleString();
            }
            if(this.sessionID && aWhichStatus == "currentSessionID"){
                statusString += ", ID=" + this.sessionID;
            }
        }else if(aWhichStatus == "previousAuth"){   // 前回の認証
            if(this.errorCount != 0){
                statusString = strBundle.formatStringFromName("failure_times",
                                                              [String(this.errorCount)], 1);
            }else{
                var authStatusID = this.sessionID ? "success" : "not_authorized";
                statusString = strBundle.GetStringFromName(authStatusID);
            }
            if(this.lastAuthTried != 0){
                statusString += ", " + new Date(this.lastAuthTried * 1000).toLocaleString();
            }
            if(this.authError){
                statusString += ", " + this.authError;
            }
        }else if(aWhichStatus == "bugReport"){      // 不具合報告テンプレート用
            statusString = "v" + this.VERSION + "; ";
            if(!this.pref.enabled){
                statusString += strBundle.GetStringFromName("api_off");
            }else if(!(this.pref.appKey && this.pref.hmKey &&
                       this.pref.authURL && this.pref.apiURL)){
                var wk = [];
                if(!(this.pref.authURL && this.pref.apiURL)) wk.push("apiURL");
                if(!(this.pref.appKey && this.pref.hmKey)) wk.push("Key");
                statusString += wk.join() + strBundle.GetStringFromName("not_configured");
            }else{
                statusString += getUserStatusString(this, "not_authorized", "authorized",
                        "keys_invalid", "sid_invalid", "valid", "valid_ronin", "valid_ronin");
                // authUAは空でもOK(元々送信しない専ブラもあるので)
                if(!(this.pref.userAgent && this.pref.postUA && this.pref.x2chUA)){
                    var wk = [];
                    if(!this.pref.userAgent) wk.push("datUA");
                    if(!this.pref.authUA) wk.push("authUA");
                    if(!this.pref.postUA) wk.push("postUA");
                    if(!this.pref.x2chUA) wk.push("X2chUA");
                    statusString += "; " + strBundle.formatStringFromName("empty_ua",
                                                                          [wk.join()], 1);
                }
            }
        }

        return statusString;
    }

};


/**
 * 設定の読み込みと監視を行うオブジェクト
 * @constructor
 * @private
 */
function Chaika2chApiPref(aCallback){
    this._callback = aCallback || function(){};
    this._init();
}

/**
 * User-Agent 設定での特殊キーワード @Mozilla を稼働中のMozillaのUAへ置き換える
 */
Chaika2chApiPref._replaceUAKeyword = function Chaika2chApiPref__replaceUAKeyword(aString){
    return aString.replace(/^@mozilla\b/i, function(){
        return Cc["@mozilla.org/network/protocol;1?name=http"]
               .getService(Ci.nsIHttpProtocolHandler).userAgent;
    });
};

Chaika2chApiPref.prototype = {

    enabled: false,
    apiURL: null,
    authURL: null,
    domains: null,
    appKey: null,
    hmKey: null,
    ctValue: null,
    useRonin: false,
    userAgent: null,
    postUA: null,
    authUA: null,
    x2chUA: null,
    autoAuth: null,
    authInterval: null,
    retryInterval: null,
    wakeDelay: null,

    hostRxp: /(?!)/,                        // 何にもマッチしない
    ronin: { id: "", password: "" },

    _callback: null,
    _branch: null,

    CHAIKA_BRANCH: "extensions.chaika.",    // from ChaikaCore._startup()

    /** 設定読み込み用テーブル */
    _prefTable: {
        // ** APIのON/OFF **
        "2chapi.enabled": { variable: "enabled", get: "getBool" },
        // ** 詳細 **
        "2chapi.api_url": { variable: "apiURL",  get: "getUniChar",
                            check: function(v){ return v.trim().replace(/[^\/]$/, "$&/"); } },
        "2chapi.auth_url": { variable: "authURL", get: "getUniChar",
                             check: function(v){ return v.trim(); } },
        "2chapi.domains":  { variable: "domains", get: "getUniChar",
                             check: function(v){ return v.trim(); } },
        // ** 認証 **
        "2chapi.appkey":   { variable: "appKey",  get: "getUniChar",
                             check: function(v){ return v.trim(); } },
        "2chapi.hmkey":    { variable: "hmKey",   get: "getUniChar",
                             check: function(v){ return v.trim(); } },
        "2chapi.ct_value": { variable: "ctValue", get: "getUniChar" },
        "2chapi.use_ronin": { variable: "useRonin", get: "getBool" },
        // ** User-Agent **
        "2chapi.useragent": { variable: "userAgent", get: "getUniChar",
                              check: Chaika2chApiPref._replaceUAKeyword },
        "2chapi.post_ua":   { variable: "postUA", get: "getUniChar",
                              check: Chaika2chApiPref._replaceUAKeyword },
        "2chapi.auth_ua":   { variable: "authUA", get: "getUniChar",
                              check: Chaika2chApiPref._replaceUAKeyword },
        "2chapi.2ch_ua":    { variable: "x2chUA", get: "getUniChar",
                              check: Chaika2chApiPref._replaceUAKeyword },
        // ** 自動更新 **
        "2chapi.auto_auth": { variable: "autoAuth", get: "getInt", check: function(v){
            return (v == AUTO_AUTH_ACCESS || v == AUTO_AUTH_TIMER) ? v : AUTO_AUTH_OFF; } },
        "2chapi.auth_interval":  { variable: "authInterval",  get: "getInt", check: function(v){
            return (v <= 0) ? 0 : Math.max(AUTH_INTERVAL_MIN, Math.min(v, AUTH_INTERVAL_MAX)); } },
        "2chapi.retry_interval": { variable: "retryInterval", get: "getInt", check: function(v){
            return (v <= 0) ? 0 : Math.max(AUTH_INTERVAL_MIN, Math.min(v, AUTH_INTERVAL_MAX)); } },
        "2chapi.wake_delay": { variable: "wakeDelay", get: "getInt" },
    },

    /**
     * 設定値を変数にセットし古い設定値を返す
     */
    _loadPref: function Chaika2chApiPref__loadPref(aName, aStatus){
        var pref = this._prefTable[aName];
        var prev = this[pref.variable];
        if(aStatus == "unload"){
            this[pref.variable] = (pref.get == "getBool") ? false : null;
        }else{
            var value = ChaikaCore.pref[pref.get](aName);
            this[pref.variable] = pref.check ? pref.check(value) : value;
        }
        return prev;
    },

    /** @private */
    _init: function Chaika2chApiPref__init(){
        var prefService = Cc["@mozilla.org/preferences-service;1"]
                          .getService(Ci.nsIPrefService);
        this._branch = prefService.getBranch(this.CHAIKA_BRANCH);
    },

    /**
     * 設定値のロードとそれに伴う初期化処理など
     */
    load: function Chaika2chApiPref_load(){
        this._branch.addObserver("2chapi.", this, false);

        for(var name in this._prefTable){
            var prev = this._loadPref(name, "load");
            this._callback(name, "load", prev);
            this._onPrefChange(name, "load", prev);
        }
    },

    /**
     * 設定値のアンロードとそれに伴う終了処理など
     */
    unload: function Chaika2chApiPref_unload(){
        this._branch.removeObserver("2chapi.", this);

        for(var name in this._prefTable){
            var prev = this._loadPref(name, "unload");
            this._callback(name, "unload", prev);
            this._onPrefChange(name, "unload", prev);
        }
    },

    /**
     * implements nsIObserver
     */
    observe: function Chaika2chApiPref_observe(aSubject, aTopic, aData){
        // 上のテーブルにない 2chapi.session_id などの
        // 変化でも通知が来るためチェックが必要
        if(aTopic == "nsPref:changed" && this._prefTable[aData]){
            var prev = this._loadPref(aData, "change");
            var value = this[this._prefTable[aData].variable];
            ChaikaCore.logger.debug("Pref Change: " + aData + " = " + value + " <- " + prev);
            this._callback(aData, "change", prev);
            this._onPrefChange(aData, "change", prev);
            return;
        }
        if(aTopic == "nsPref:changed" && aData == PREF_RONIN_ID){
            var prev = this._setRonin(ChaikaRoninLogin.getLoginInfo());
            if(prev != null) this._callback("login.ronin.id_pass*", "change", prev);
            return;
        }
        if(aTopic == "passwordmgr-storage-changed"){
            var account, oldLogin = null, newLogin = null;
            var roninLogin = Cc["@mozilla.org/login-manager/loginInfo;1"]
                             .createInstance(Ci.nsILoginInfo);
            roninLogin.init("chrome://chaika", null, "2ch Viewer Registration",
                            ChaikaCore.pref.getChar(PREF_RONIN_ID), "", "", "");
            if(aData == "modifyLogin"){
                aSubject.QueryInterface(Ci.nsIArray);
                oldLogin = aSubject.queryElementAt(0, Ci.nsILoginInfo);
                newLogin = aSubject.queryElementAt(1, Ci.nsILoginInfo);
            }else if(aData == "addLogin"){
                newLogin = aSubject.QueryInterface(Ci.nsILoginInfo);
            }else if(aData == "removeLogin"){
                oldLogin = aSubject.QueryInterface(Ci.nsILoginInfo);
            }else if(aData == "removeAllLogins"){
                oldLogin = roninLogin;
            }else{
                return;
            }
            if(newLogin && newLogin.matches(roninLogin, true)){
                account = { id: newLogin.username, password: newLogin.password };
            }else if(oldLogin && oldLogin.matches(roninLogin, true)){
                account = { id: "", password: "" };
            }else{
                return;
            }
            var prev = this._setRonin(account);
            if(prev != null) this._callback("login.ronin.id_pass*", "change", prev);
            return;
        }
    },

    /**
     * 設定値に変化があったときに呼ばれるコールバック
     */
    _onPrefChange: function Chaika2chApiPref__onPrefChange(aName, aContext, aPrev){
        if(aName == "2chapi.use_ronin" && this.useRonin != aPrev){
            var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
            if(!aPrev){     // OFF -> ON
                os.addObserver(this, "passwordmgr-storage-changed", false);
                this._branch.addObserver(PREF_RONIN_ID, this, false);
                var prev = this._setRonin(ChaikaRoninLogin.getLoginInfo());
                if(prev != null) this._callback("login.ronin.id_pass*", aContext, prev);
            }else{          // ON -> OFF
                os.removeObserver(this, "passwordmgr-storage-changed");
                this._branch.removeObserver(PREF_RONIN_ID, this);
                var prev = this._setRonin({ id: "", password: "" });
                if(prev != null) this._callback("login.ronin.id_pass*", aContext, prev);
            }
        }else if(aName == "2chapi.domains"){    // domains -> hostRxp
            // 頭に # が付くエントリは除外ホストと解釈される
            // 例）domains: 2ch.net bbspink.com #carpenter #qb5
            //  → hostRxp: ^(?!carpenter|qb5)([\w\-]+)\.(?:2ch\.net|bbspink\.com)$
            var domains = [], excludes = [];
            (this.domains || "").split(/\s+/).forEach(function(str){
                var arr = str.replace(/[.*+?|^$(){}[\]\\]/g, "\\$&").match(/^(\\.|#)?(.*)/);
                if(arr[2] != "") (arr[1] === "#" ? excludes : domains).push(arr[2]);
            });
            if(domains.length > 0){
                this.hostRxp = new RegExp("^" +
                        (excludes.length > 0 ? "(?!" + excludes.join("|") + ")" : "") +
                                 "([\\w\\-]+)\\.(?:" +  domains.join("|") + ")$", "i");
            }else{
                delete this.hostRxp;    // prototype のデフォルト値へ戻す
            }
            ChaikaCore.logger.debug("hostRxp: " + this.hostRxp.source + " <- " + this.domains);
        }
    },

    /**
     * Roninアカウント情報のセット
     * @param {Object} aAccount Roninアカウント情報(id & password)
     * @return {Object} 古いアカウント情報／新旧同じなら null
     */
    _setRonin: function Chaika2chApiPref__setRonin(aAccount){
        if(aAccount == null || typeof aAccount != "object") return null;
        if(!aAccount.password || !aAccount.id) aAccount.password = aAccount.id = "";

        if(aAccount.password == this.ronin.password &&
           aAccount.id == this.ronin.id) return null;

        var prev = this.ronin;
        this.ronin = aAccount;

        ChaikaCore.logger.debug("Ronin: " + "id:'" + this.ronin.id +
                                "', password:'" + this.ronin.password + "'");
        return prev;
    }
};


/**
 * ワンショットタイマー(sleep対応)
 * 注：linuxではPCをsleepさせると正常に動作しない可能性あり
 *     https://bugzilla.mozilla.org/show_bug.cgi?id=758848
 * @constructor
 * @private
 */
function Chaika2chApiTimer(aCallback){
    this.callback = aCallback;
}

Chaika2chApiTimer.prototype = {

    callback: null,
    timer: null,
    context: null,
    delay: 0,
    expire: 0,
    _wakeDelay: 10000,  // ミリ秒単位

    set wakeDelay(aDelay){
        if(aDelay != null && aDelay >= 0){
            this._wakeDelay = aDelay * 1000;
        }
    },

    /**
     * implements nsIObserver
     */
    observe: function Chaika2chApiTimer_observe(aSubject, aTopic, aData){
        switch(aTopic){
            case "timer-callback":
                ChaikaCore.logger.debug("Timer: EXPIRED");
                this.delay = this.expire = 0;
                this.callback(this.context);
                return;
            case "sleep_notification":
                ChaikaCore.logger.debug("Timer: SLEEP");
                this.timer.cancel();
                return;
            case "wake_notification":
                ChaikaCore.logger.debug("Timer: WAKE");
                if(!this.expire) return;
                var remain = this.expire - Date.now();
                if(remain <= this._wakeDelay || remain > this.delay){
                    remain = this._wakeDelay;
                }
                this.setTimeout(remain / 1000);
                return;
        }
    },

    /**
     * タイマー設定
     * @param {Number} aDelay タイムアウトまでの時間(秒)
     *                        0 ならタイマーを止めて後始末も行う
     * @param        aContext コールバック関数に渡される値
     */
    setTimeout: function Chaika2chApiTimer_setTimeout(aDelay, aContext){
        if(aDelay <= 0){    // stop
            this.delay = this.expire = 0;
            if(!this.timer) return;

            this.timer.cancel();
            this.timer = null;
            var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
            os.removeObserver(this, "sleep_notification");
            os.removeObserver(this, "wake_notification");
            ChaikaCore.logger.debug("Timer: stop");
            return;
        }

        if(!this.timer){
            this.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
            var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
            os.addObserver(this, "sleep_notification", false);
            os.addObserver(this, "wake_notification", false);
        }

        this.context = aContext;
        this.delay = aDelay * 1000;
        this.expire = Date.now() + this.delay;
        ChaikaCore.logger.debug("Timer: delay " + aDelay + "s, expire " + new Date(this.expire));

        this.timer.init(this, this.delay, Ci.nsITimer.TYPE_ONE_SHOT);
    }
};
