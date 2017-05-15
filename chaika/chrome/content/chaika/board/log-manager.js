/* See license.txt for terms of usage */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import('resource://gre/modules/Services.jsm');
Components.utils.import("resource://chaika-modules/ChaikaCore.js");
Components.utils.import("resource://chaika-modules/ChaikaBoard.js");
Components.utils.import("resource://chaika-modules/ChaikaThread.js");
Components.utils.import("resource://chaika-modules/ChaikaBBSMenu.js");
Components.utils.import("resource://chaika-modules/utils/URLUtils.js");


const Ci = Components.interfaces;
const Cc = Components.classes;
const Cr = Components.results;

var gLogManagerReloaded = false;

/**
 * 開始時の処理
 */
function startup(){
    gLogManagerReloaded = false;
    if(location.protocol === 'chaika:'){
        console.info('This page is loaded in the content process. Reload!');
        location.href = 'chrome://chaika/content/board/log-manager.xul';
        return;
    }
    gLogManagerReloaded = true;

    ThreadUpdateObserver.startup();

    ChaikaBBSMenu.getXML()
        .then((xml) => BBSData.init(xml))
        .catch((ex) => ChaikaCore.logger.error(ex))
        .then(() => BoardTree.initTree());
}


/**
 * 終了時の処理
 */
function shutdown(){
    if(!gLogManagerReloaded) return;
    ThreadUpdateObserver.shutdown();
}


/**
 * ブラウザへのイベントフロー抑制
 */
function eventBubbleCheck(aEvent){
    // オートスクロールや Find As You Type を抑制しつつキーボードショートカットを許可
    if(!(aEvent.ctrlKey || aEvent.shiftKey || aEvent.altKey || aEvent.metaKey))
        aEvent.stopPropagation();
}


function vacuum(){
    document.getElementById("vacuumButton").disabled = true;
    setTimeout(function(){ delayVacuum(); }, 0);
}


function delayVacuum(){
    var storage = ChaikaCore.storage;
    var beforeStorageSize = storage.databaseFile.clone().fileSize / 1024;

        // スレを読んだことのない板情報を削除
    storage.beginTransaction();
    try{
        storage.executeSimpleSQL("DELETE FROM board_data WHERE board_id IN " +
                " (SELECT board_id FROM board_data EXCEPT SELECT board_id FROM thread_data);");
        storage.executeSimpleSQL("DELETE FROM board_subject WHERE board_id IN " +
                "(SELECT board_id FROM board_subject EXCEPT SELECT board_id FROM thread_data);");
    }catch(ex){
        ChaikaCore.logger.error(ex);
    }finally{
        storage.commitTransaction();
    }

    try{
        storage.executeSimpleSQL("VACUUM");
    }catch(ex){
        ChaikaCore.logger.error(ex);
    }

    var afterStorageSize = storage.databaseFile.clone().fileSize / 1024;
    alert("データベースを最適化しました\n" + beforeStorageSize +"KB > "+ afterStorageSize +"KB");
    document.getElementById("vacuumButton").disabled = false;
}



var BBSData = {

    _bbsData: {},

    init: function BBSData_init(aXml){
        Array.from(aXml.getElementsByTagName("board")).forEach((node) => {
            let title = node.getAttribute("title");
            let url = node.getAttribute("url");
            if(URLUtils.isBBS(url)){
                let id = ChaikaBoard.getBoardID(Services.io.newURI(url, null, null));
                this._bbsData[id] = { title: title, url: url };
            }
        });
    },

    update: function BBSData_update(aBoardID, aRecord){
        this._bbsData[aBoardID] = aRecord;
    },

    lookup: function BBSData_lookup(aBoardID){
        return this._bbsData[aBoardID] || { title: aBoardID, url: "" };
    }

};




var BoardTree = {

    initTree: function BoardTree_initTree(){
        this.tree = document.getElementById("boardTree");

        var itemsDoc = Cc["@mozilla.org/xmlextras/domparser;1"]
                .createInstance(Ci.nsIDOMParser).parseFromString("<boardItems/>", "text/xml");

        var boardItem = itemsDoc.createElement("boardItem");
        itemsDoc.documentElement.appendChild(boardItem);
        boardItem.setAttribute("title", "(すべて)");
        boardItem.setAttribute("id",    "*");
        boardItem.setAttribute("url",   "");
        boardItem.setAttribute("type",  "0");

        var sql = [
            "SELECT",
            "    td.board_id AS board_id,",
            "    td.url AS threas_url",
            "FROM thread_data AS td",
            "GROUP BY td.board_id;"
        ].join("\n");

        var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
        var storage = ChaikaCore.storage;
        var statement = storage.createStatement(sql);

        storage.beginTransaction();
        try{
            while(statement.executeStep()){
                var boardItem = itemsDoc.createElement("boardItem");
                var boardID = statement.getString(0);
                var board = BBSData.lookup(boardID);
                if(!board.url){
                    var threadURL = ioService.newURI(statement.getString(1), null, null);
                    var boardURL = ChaikaThread.getBoardURL(threadURL);
                    board.url = boardURL.spec;
                    // 後で下の getThreadURL からも参照できるように BBSData へ還元する
                    BBSData.update(boardID, board);
                }
                boardItem.setAttribute("title", board.title);
                boardItem.setAttribute("id",    boardID);
                boardItem.setAttribute("url",   board.url);
                boardItem.setAttribute("type",  "0");
                itemsDoc.documentElement.appendChild(boardItem);
            }
        }catch(ex){
            ChaikaCore.logger.error(ex);
        }finally{
            statement.reset();
            statement.finalize();
            storage.commitTransaction();
        }

        this.tree.builder.datasource = itemsDoc.documentElement;
        this.tree.builder.rebuild();
    },


    select: function BoardTree_select(aEvent){
        var currentIndex = this.tree.currentIndex;
        if(currentIndex === -1) return;

        var titleColumn = this.tree.columns.getNamedColumn("boardTree-title");
        var title = this.tree.view.getCellText(currentIndex, titleColumn);
        var id = this.tree.view.getCellValue(currentIndex, titleColumn);

        document.getElementById('boardTitle').value = title;
        ThreadTree.initTree(id);
    },


    showContext: function BoardTree_showContext(aEvent){
        // ツリーのアイテムをクリックしたかチェックする
        // see BoardTree.showContext in ./page.js
        if(aEvent.originalTarget.triggerNode.localName != "tree" &&
           this.getClickItemIndex(aEvent) == -1) return false;

        var currentIndex = this.tree.currentIndex;
        if(currentIndex == 0) return false;

        var item = this._getItem(currentIndex);

        var boardTreeContext = document.getElementById("boardTreeContext");
        boardTreeContext.items = [item];

        return true;
    },


    getClickItemIndex: function BoardTree_getClickItemIndex(aEvent){
        var row = {}
        var obj = {}
        this.tree.treeBoxObject.getCellAt(aEvent.clientX, aEvent.clientY, row, {}, obj);
        if(!obj.value) return -1;
        return row.value;
    },


    _getItem: function BoardTree__getItem(aIndex){
        var view = this.tree.view;
        var titleColumn = this.tree.columns.getNamedColumn("boardTree-title");
        var urlColumn   = this.tree.columns.getNamedColumn("boardTree-url");

        var title   = view.getCellText(aIndex, titleColumn);
        var urlSpec = view.getCellText(aIndex, urlColumn);
        var type    = parseInt(view.getCellValue(aIndex, urlColumn));

        return new ChaikaCore.ChaikaURLItem(title, urlSpec, "board", type);
    },


    dragStart: function BoardTree_dragStart(aEvent){
        var itemIndex = this.getClickItemIndex(aEvent);
        if(itemIndex == -1) return;

        var item = this._getItem(itemIndex);

        var dt = aEvent.dataTransfer;
        dt.setData("text/x-moz-url", item.urlSpec + "\n" + item.title);
        dt.setData("text/unicode", item.urlSpec);

        dt.effectAllowed = "link";
        dt.addElement(aEvent.originalTarget);
        aEvent.stopPropagation();
    }

};




var ThreadTree = {

    initTree: function ThreadTree_initTree(aBoardID){
        this.tree = document.getElementById("threadTree");

        var itemsDoc = Cc["@mozilla.org/xmlextras/domparser;1"]
                .createInstance(Ci.nsIDOMParser).parseFromString("<threadItems/>", "text/xml");

        var sql = "";

        if(aBoardID == "*"){
            sql = [
                "SELECT DISTINCT",
                "    td.title AS title,",
                "    td.line_count AS read,",
                "    CAST(td.dat_id AS TEXT) AS dat_id,",
                "    td.board_id AS board_id,",
                "    td.url,",
                "    STRFTIME('%Y/%m/%d %H:%M', td.dat_id, 'unixepoch', 'localtime') AS created,",
                "    td.line_count * 86400 / (strftime('%s','now') - td.dat_id) AS force",
                "FROM thread_data AS td"
            ].join("\n");
        }else{
            sql = [
                "SELECT DISTINCT",
                "    td.title AS title,",
                "    td.line_count AS read,",
                "    CAST(td.dat_id AS TEXT) AS dat_id,",
                "    td.board_id AS board_id,",
                "    td.url,",
                "    STRFTIME('%Y/%m/%d %H:%M', td.dat_id, 'unixepoch', 'localtime') AS created,",
                "    td.line_count * 86400 / (strftime('%s','now') - td.dat_id) AS force",
                "FROM thread_data AS td",
                "WHERE td.board_id='" + aBoardID + "';"
            ].join("\n");
        }

        var storage = ChaikaCore.storage;
        var statement = storage.createStatement(sql);

        storage.beginTransaction();
        try{
            while(statement.executeStep()){
                var threadItem = itemsDoc.createElement("threadItem");
                var board = BBSData.lookup(statement.getString(3));
                threadItem.setAttribute("title",      ChaikaCore.io.unescapeHTML(statement.getString(0)));
                threadItem.setAttribute("read",       statement.getInt32(1));
                threadItem.setAttribute("readSort",   statement.getInt32(1) + 10000);
                threadItem.setAttribute("datID",      statement.getString(2));
                threadItem.setAttribute("boardID",    statement.getString(3));
                threadItem.setAttribute("type",       "0");
                threadItem.setAttribute("boardTitle", board.title);
                threadItem.setAttribute("url",        statement.getString(4));
                threadItem.setAttribute("created",    statement.getString(5));
                threadItem.setAttribute("force",      statement.getInt32(6));
                threadItem.setAttribute("forceSort",  statement.getInt32(6) + 10000);
                itemsDoc.documentElement.appendChild(threadItem);
            }
        }catch(ex){
            ChaikaCore.logger.error(ex);
        }finally{
            statement.reset();
            statement.finalize();
            storage.commitTransaction();
        }

        this.tree.builder.datasource = itemsDoc.documentElement;
        this.tree.builder.rebuild();

        this._lastSelectedID = aBoardID;
    },


    refreshTree: function ThreadTree_refreshTree(){
        if(this._lastSelectedID){
            this.initTree(this._lastSelectedID);
        }
    },


    selectAll: function ThreadTree_selectAll(){
        this.tree.treeBoxObject.view.selection.selectAll();
        this.tree.focus();
    },


    keyDown: function ThreadTree_keyDown(aEvent){
        switch(aEvent.key){
            case 'Enter':
                if(aEvent.repeat) break;
                this.openThread(aEvent.ctrlKey || aEvent.altKey);
                break;
        }
    },


    showContext: function ThreadTree_showContext(aEvent){
        // ツリーのアイテムをクリックしたかチェックする
        // see BoardTree.showContext in ./page.js
        if(aEvent.originalTarget.triggerNode.localName != "tree" &&
           this.getClickItemIndex(aEvent) == -1) return false;

        var currentIndex = this.tree.currentIndex;
        var selectionIndices = this.getSelectionIndices();

        var currentInSelection = selectionIndices.indexOf(currentIndex);

        // 選択アイテムの中でフォーカスが当たっているものがあれば先頭へ移動
        // フォーカスが常に選択アイテムの上にあるとは限らない
        if(currentInSelection >= 1){
            selectionIndices.splice(currentInSelection, 1);
            selectionIndices.unshift(currentIndex);
        }

        var items = selectionIndices.map(function(aElement, aIndex, aArray){
            return ThreadTree._getItem(aElement);
        });

        var threadTreeContext = document.getElementById("threadTreeContext");
        threadTreeContext.items = items;

        return true;
    },


    getClickItemIndex: function ThreadTree_getClickItemIndex(aEvent){
        var row = {}
        var obj = {}
        this.tree.treeBoxObject.getCellAt(aEvent.clientX, aEvent.clientY, row, {}, obj);
        if(!obj.value) return -1;
        return row.value;
    },


    getSelectionIndices: function ThreadTree_getSelectionIndices(){
        var resultArray = new Array();

        var rangeCount = this.tree.treeBoxObject.view.selection.getRangeCount();
        for(var i=0; i<rangeCount; i++){
            var rangeMin = {};
            var rangeMax = {};

            this.tree.treeBoxObject.view.selection.getRangeAt(i, rangeMin, rangeMax);
            for (var j=rangeMin.value; j<=rangeMax.value; j++){
                resultArray.push(j);
            }
        }
        return resultArray;
    },


    _getItem: function ThreadTree__getItem(aIndex){
        var view = this.tree.view;
        var titleColumn = this.tree.columns.getNamedColumn("threadTree-title");
        var readColumn   = this.tree.columns.getNamedColumn("threadTree-read");

        var title   = view.getCellText(aIndex, titleColumn);
        var urlSpec = view.getCellValue(aIndex, titleColumn);
        var type    = parseInt(view.getCellValue(aIndex, readColumn));

        return new ChaikaCore.ChaikaURLItem(title, urlSpec, "thread", type);
    },


    openThread: function ThreadTree_openThread(aAddTab){
        var currentIndex = this.tree.currentIndex;
        var selectionIndices = this.getSelectionIndices();

        var currentInSelection = selectionIndices.indexOf(currentIndex);

        // フォーカスが当たっているものがあれば先頭へ移動
        if(currentInSelection >= 1){
            selectionIndices.splice(currentInSelection, 1);
            selectionIndices.unshift(currentIndex);
        }

        selectionIndices.every((index) => {
            var item = this._getItem(index);
            var url = Services.io.newURI(item.urlSpec, null, null);
            ChaikaCore.browser.openThread(url, aAddTab, true, false, true);
            return aAddTab;   // false なら最初の一つだけを開く
        });
    },


    dragStart: function BoardTree_dragStart(aEvent){
        var itemIndex = this.getClickItemIndex(aEvent);
        if(itemIndex == -1) return;
        if(this.getSelectionIndices().length != 1) return;

        var item = this._getItem(itemIndex);

        var dt = aEvent.dataTransfer;
        dt.setData("text/x-moz-url", item.urlSpec + "\n" + item.title);
        dt.setData("text/unicode", item.urlSpec);

        dt.effectAllowed = "link";
        dt.addElement(aEvent.originalTarget);
        aEvent.stopPropagation();
    },


    onDblclick: function(aEvent){
        let itemIndex = this.getClickItemIndex(aEvent);
        if(itemIndex === -1) return;

        var item = this._getItem(itemIndex);

        ChaikaCore.browser.openThread(Services.io.newURI(item.urlSpec, null, null),
                                      true, true, false, true);
    }

};




var ThreadUpdateObserver = {

    startup: function ThreadUpdateObserver_startup(){
        var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
        os.addObserver(this, "itemContext:deleteLog", false);
    },


    shutdown: function ThreadUpdateObserver_shutdown(){
        var os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
        os.removeObserver(this, "itemContext:deleteLog");
    },


    deleteLogsTreeUpdate: function ThreadUpdateObserver_deleteLogsTreeUpdate(aURLs){
        ThreadTree.refreshTree();
    },


    observe: function ThreadUpdateObserver_observe(aSubject, aTopic, aData){
        if(aTopic == "itemContext:deleteLog"){
            this.deleteLogsTreeUpdate(aData.split(","));
        }
    },


    QueryInterface: XPCOMUtils.generateQI([
        Ci.nsISupportsWeakReference,
        Ci.nsIObserver,
        Ci.nsISupports
    ])

};



function getThreadURL(aThreadID){
    let [ threadID, boardID, boardPath, datID ] =
            aThreadID.match(/^(\/[^\/]+\/((?:[^\/]+\/){1,}))(\d{9,10})$/);
    let board = BBSData.lookup(boardID);
    let threadUrlBase;

    if(board.url === ""){
        //BBSMENUに登録していない場合
        if(boardID.startsWith("/jbbs/")){
            board.url = "http://jbbs.shitaraba.net/" + boardPath;
        }else if(boardID.startsWith("/machi/")){
            board.url = "http://machi.to/" + boardPath;
        }else if(boardID.startsWith("/outside/")){
            board.url = "http://" + boardPath;
        }else{
            return null;
        }
    }

    if(boardID.startsWith("/jbbs/")){
        threadUrlBase = board.url.replace(/^(.+)\/([^\/]+\/\d+\/)$/, "$1/bbs/read.cgi/$2");
    }else if(boardID.startsWith("/machi/")){
        threadUrlBase = board.url.replace(/^(.+)\/([^\/]+\/)$/, "$1/bbs/read.cgi/$2");
    }else{
        threadUrlBase = board.url.replace(/^(.+)\/([^\/]+\/)$/, "$1/test/read.cgi/$2");
    }

    return Services.io.newURI(threadUrlBase + datID + "/", null, null);
}



function getThreadDataFromDAT(aThread){
    if(!aThread.datFile.exists()){
        throw new Error(aThread.datFile.leafName + " ファイルが存在しません");
    }

    let threadTitle = aThread.title;
    let encode = (aThread.type === ChaikaBoard.BOARD_TYPE_JBBS) ? "EUC-JP" : "Shift_JIS";
    let datLines = ChaikaCore.io.readString(aThread.datFile, encode).split("\n");
    datLines.pop();

    //スレッド情報が保存されていなければ DAT からタイトルを取得
    if(threadTitle === ""){
        let col = (aThread.type === ChaikaBoard.BOARD_TYPE_JBBS ||
                   aThread.type === ChaikaBoard.BOARD_TYPE_MACHI) ? 5 : 4;
        datLines.some((line) => {
            threadTitle = line.split("<>")[col] || "";
            return (threadTitle !== "");
        });
    }

    //古いスレッドの場合、最新の(サーバー移転後の) URL だとブラウザで開けなくなる
    //場合があるので DAT の中身から当時のスレッド URL を推測すべき?

    return {
        title: (threadTitle !== "") ? threadTitle : aThread.threadID,
        lineCount: datLines.length,
        lastModified: aThread.lastModified || "",
        maruGetted: aThread.maruGetted || false
    };
}



function importDAT(aThreadID){
    return new Promise((resolve, reject) => {
        let url = getThreadURL(aThreadID);
        if(!url){
            throw new Error(aThreadID + ".dat からスレッド URL の取得に失敗しました");
        }

        let thread = new ChaikaThread(url);
        let dat = getThreadDataFromDAT(thread);

        //スレッド情報が保存されていなければ DAT をインポートする or
        //スレッド情報と DAT が一致しない場合は修復する(今のところ行数のみ修復)
        let recordedLines = thread.lineCount;
        if(dat.lineCount > 0 && dat.lineCount !== recordedLines){
            thread.title = dat.title;
            thread.lineCount = dat.lineCount;
            thread.lastModified = dat.lastModified;
            thread.maruGetted = dat.maruGetted;
            thread.setThreadData();

            resolve({
                operation: (recordedLines === 0) ? "import" : "fix",
                url: url.spec,
                datID: thread.datID,
                title: thread.title,
                lineCount: thread.lineCount
            });
        }else{
            resolve();
        }
    });
}



function repair(){
    document.getElementById("repairButton").disabled = true;
    setTimeout(delayRepair, 0);
}

function delayRepair(){
    //すべての DAT ファイルを処理する
    let logDir = ChaikaCore.getLogDir();
    let dirs = [ logDir ];
    let promises = [];
    let thread = Services.tm.currentThread;

    while(dirs.length !== 0){
        let currentDir = dirs.shift().directoryEntries.QueryInterface(Ci.nsIDirectoryEnumerator);
        let item;
        while((item = currentDir.nextFile) !== null){
            if(item.isDirectory()){
                dirs.push(item);
            }else if(item.isFile() && item.leafName.match(/^\d{9,10}\.dat$/)){
                let path = item.getRelativePath(logDir);
                let threadID = "/" + path.replace(/\.dat$/, "");
                promises.push(importDAT(threadID));
            }
            // 作業中にブラウザウィンドウが無応答になるのを防ぐ
            // 本来は OSFile.jsm でファイルアクセスを非同期化すべきなのでしょうけど
            while(thread.hasPendingEvents()){
                thread.processNextEvent(false);
            }
        }
        currentDir.close();
    }

    Promise.all(promises).then((results) => {
        let count = [
            { title: "DAT ファイルのインポート", operation: "import" },
            { title: "スレッド情報の修復", operation: "fix" },
        ].reduce((count, notify) => {
            let log = results.filter((result) => (result && result.operation === notify.operation));
            if(log.length){
                let msg = notify.title + ": " + log.length + " 個成功\n\n";
                log.forEach((result) => {
                    msg += result.datID + ": " + result.title + " (" + result.lineCount + ")\n";
                });
                alert(msg);
            }
            return log.length + count;
        }, 0);
        if(count === 0){
            alert("データベースは正常です。何も変更はありません");
        }
    }).then(() => {
        BoardTree.initTree();
        ThreadTree.refreshTree();
    }).catch((ex) => {
        alert(ex);
    }).then(() => {
        document.getElementById("repairButton").disabled = false;
    });
}
