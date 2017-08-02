/* See license.txt for terms of usage */

Components.utils.import('resource://gre/modules/Services.jsm');
Components.utils.import("resource://chaika-modules/ChaikaCore.js");
Components.utils.import("resource://chaika-modules/ChaikaBoard.js");
Components.utils.import("resource://chaika-modules/ChaikaBBSMenu.js");
Components.utils.import("resource://chaika-modules/utils/URLUtils.js");

/**
 * chaika履歴検索プラグイン (chaika 1.8.0 以降専用)
 *
 * - chaika履歴（Firefoxの履歴とは異なる）から板名・スレッド名を検索します。
 *   あくまでも検索プラグインであるため、履歴の削除などはできません。
 * - 複数の検索ワードを入力しての検索はできません。入力全体を一つの検索ワード
 *   として扱います。大文字小文字・全角文字半角文字は同一視して検索します。
 * - ２つのワイルドカードを認識します … "?"：任意の１文字 "*"：任意の文字列
 *   これらの文字をワイルドカードとして認識して欲しくない場合は、
 *   "\?" "\*" と書くか、全角文字で "？" "＊" と書いてください。
 * - ファイルのワイルドカード検索とは異なり、常に部分一致検索で動作します。
 *   部分一致検索をするのに "*(検索ワード)*" と書く必要はありません。
 * - "*" とだけ入力すると、保存されている全ての履歴を板別に表示します。
 *   "**" とだけ入力すると、全ての履歴を表示日時順に表示します。
 *   "***" とだけ入力すると、全ての履歴を表示回数順に表示します。
 * - "*" を付加することによる表示モード指定は通常の検索ワードでも可能です。
 *   "*(検索ワード)" または "(検索ワード)*" とすることで表示日時順になり、
 *   "**(検索ワード)" または "(検索ワード)**" で表示回数順になります。
 */


var HistoryFilter = {

    id: '98.chaika.filter.history',

    name: 'chaika履歴検索',

    version: '1.1.0',

    charset: 'utf-8',

    url: null,

    search: function(query){
        query = ChaikaCore.io.unescapeHTML(query).replace(/\s/g, ' ');

        // エスケープされていないワイルドカード文字 ? * を \t \v へ
        query = query.replace(/((?:\\\\)*)(\\?[?*])/g, (m, p1, p2) =>
            p1.substr(0, p1.length/2) + ({'?':'\t','*':'\v','\\?':'?','\\*':'*'})[p2]);

        // 検索ワードの先頭/末尾に付加された * の数で表示モード指定を表す
        let match = query.match(/^(\v*)(.+?)(\v*)$/) || ['', '', '\v', ''];
        let mode = Math.min(2, Math.max(match[1].length, match[3].length));

        // SQL のワイルドカード文字 _ % をエスケープして \t \v を _ % へ
        query = match[2].normalize('NFKC').replace(/[_%$]/g, '$$$&')
                        .replace(/[\t\v]/g, (m) => ({'\t':'_','\v':'%'})[m]);
        if(query != '%') query = '%' + query + '%';


        let viewLimit = ChaikaCore.pref.getInt("board.thread_view_limit");
        let range = (viewLimit == 0) ? '' : 'l' + viewLimit;

        let results = [];
        let current = { title: '', threads: results };

        executeSQL(getStatement(mode), [query], (row) => {
            if(current.title != row.group_title){
                current = {
                    title: row.group_title, threads: []
                };
                results.push(current);
            }
            current.threads.push({
                title: row.title,
                url: URLUtils.isThread(row.url) ? row.url.replace(/[^\/]*$/, range) : row.url,
                info: '表示日時: ' + row.visit_date + '  表示回数: ' + row.visit_count
            });
        });

        if(mode != 0){
            // 日時別・回数別フォルダのソートキーを削除
            results.forEach((node) => void(node.title = node.title.replace(/^\d+\s+/, '')));
            return Promise.resolve(results);
        }

        // 板別フォルダの板IDを板名へ変換する
        return ChaikaBBSMenu.getXML().then((xml) => {
            let bbsTitle = {};
            Array.from(xml.getElementsByTagName('board')).forEach((node) => {
                let title = node.getAttribute('title');
                let url = node.getAttribute('url');
                if(URLUtils.isBBS(url)){
                    let id = ChaikaBoard.getBoardID(Services.io.newURI(url, null, null));
                    bbsTitle[id] = title;
                }
            });
            // 板別フォルダの板名は BBSMENU に登録されているものを優先的に使い、
            // もし登録されていなければ板TOPを開いたときのページタイトルを使う
            results.forEach((node) => {
                let [, id, title] = node.title.match(/^(.*?)\s+(.*)/);
                node.title = bbsTitle[id] || title || id;
            });
            return results;
        });

        function getStatement(index){
            return [
                    // -- 0 --
                "SELECT hi.url, hi.title, hi.visit_count, " +
                " rtrim(hi.id, '0123456789') || ' ' || coalesce(bd.title, h2.title, '') AS group_title, " +
                " strftime('%Y/%m/%d %H:%M:%S', hi.last_visited, 'unixepoch', 'localtime') AS visit_date " +
                "FROM history AS hi " +
                " LEFT OUTER JOIN board_data AS bd ON rtrim(hi.id, '0123456789') = bd.board_id " +
                " LEFT OUTER JOIN history    AS h2 ON rtrim(hi.id, '0123456789') = h2.id " +
                "WHERE x_normalize(hi.title) LIKE ?1 ESCAPE '$' " +
                "ORDER BY group_title, hi.id; " ,
                    // -- 1 --
                "WITH dateline AS (SELECT " +
                "   strftime('%s', 'now', 'localtime', 'start of day', 'utc'           ) AS today, " +
                "   strftime('%s', 'now', 'localtime', 'start of day', 'utc', '-1 days') AS yesterday, " +
                "   strftime('%s', 'now', 'localtime', 'start of day', 'utc', '-2 days') AS two_days, " +
                "   strftime('%s', 'now', 'localtime', 'start of day', 'utc', '-7 days') AS seven_days), " +
                " dateline_title AS (SELECT " +
                "   strftime('%Y%m%d 今日'   , today     , 'unixepoch', 'localtime') AS today_title, " +
                "   strftime('%Y%m%d 昨日'   , yesterday , 'unixepoch', 'localtime') AS yesterday_title, " +
                "   strftime('%Y%m%d 一昨日' , two_days  , 'unixepoch', 'localtime') AS two_days_title, " +
                "   strftime('%Y%m%d 7日以内', seven_days, 'unixepoch', 'localtime') AS seven_days_title " +
                "  FROM dateline) " +
                "SELECT url, title, visit_count, CASE " +
                "  WHEN last_visited >= today      THEN today_title " +
                "  WHEN last_visited >= yesterday  THEN yesterday_title " +
                "  WHEN last_visited >= two_days   THEN two_days_title " +
                "  WHEN last_visited >= seven_days THEN seven_days_title " +
                "  ELSE strftime('%Y%m00 %Y年%m月', last_visited, 'unixepoch', 'localtime') " +
                " END AS group_title, " +
                " strftime('%Y/%m/%d %H:%M:%S', last_visited, 'unixepoch', 'localtime') AS visit_date " +
                "FROM history, dateline, dateline_title WHERE x_normalize(title) LIKE ?1 ESCAPE '$' " +
                "ORDER BY group_title DESC, last_visited DESC, id; " ,
                    // -- 2 --
                "SELECT url, title, visit_count, CASE " +
                "  WHEN visit_count >= 10000 THEN '010000 10000回以上' " +
                "  WHEN visit_count >= 1000  THEN '001000 1000回以上' " +
                "  WHEN visit_count >= 100   THEN '000100 100回以上' " +
                "  WHEN visit_count >= 10    THEN '000010 10回以上' " +
                "  WHEN visit_count >= 5     THEN '000005 5回以上' " +
                "  WHEN visit_count >= 2     THEN '000002 2回以上' " +
                "  ELSE                           '000001 1回' " +
                " END AS group_title, " +
                " strftime('%Y/%m/%d %H:%M:%S', last_visited, 'unixepoch', 'localtime') AS visit_date " +
                "FROM history WHERE x_normalize(title) LIKE ?1 ESCAPE '$' " +
                "ORDER BY group_title DESC, visit_count DESC, id; " ,
                    // -- * --
            ][index];
        }

        // Sqlite.jsm モジュールや executeAsync() などの非同期APIを使うと、
        // データベースエンジンが別のスレッドで動作するようになるため、
        // Javascript で実装されているユーザ定義関数 x_normalize が動作しない
        function executeSQL(sql, params, onRow){
            let storage = ChaikaCore.storage;
            let statement = storage.createStatement(sql);

            storage.beginTransaction();
            try{
                for(let prop in params){
                    statement.params[prop] = params[prop];
                }
                while(statement.executeStep()){
                    onRow(statement.row);
                }
            }catch(ex){
                ChaikaCore.logger.error(ex);
            }finally{
                statement.reset();
                statement.finalize();
                storage.commitTransaction();
            }
        }
    },

};
