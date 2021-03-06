/* See license.txt for terms of usage */

const { interfaces: Ci, classes: Cc, results: Cr, utils: Cu } = Components;

Cu.import("resource://chaika-modules/ChaikaCore.js");


var Refind2ch = {

    id: '02.refind2ch.org',

    name: 'スレッド検索 (refind2ch.org)',

    version: '1.0.2',

    charset: 'utf-8',

    url: 'https://refind2ch.org/search?q=%%TERM%%',

    search: function(query){
        return new Promise((resolve, reject) => {
            const url = 'https://refind2ch.org/search?q=' +
                        encodeURIComponent(ChaikaCore.io.unescapeHTML(query));
            const XMLHttpRequest = Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1");
            let req = XMLHttpRequest();

            req.addEventListener('error', reject, false);
            req.addEventListener('load', () => {
                // 404 means "No results found."
                // http://refind2ch.org/about#to_developer
                if(req.status === 404){
                    reject('No results found.');
                    return;
                }

                if(req.status !== 200 || !req.responseText){
                    reject('Unable to connect or parse the response. (status: ' + req.status + ')');
                    return;
                }


                let parser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(Ci.nsIDOMParser);
                let doc = parser.parseFromString("<root xmlns:html='http://www.w3.org/1999/xhtml'/>", "text/xml");
                let parserUtils = Cc["@mozilla.org/parserutils;1"].getService(Ci.nsIParserUtils);
                let fragment = parserUtils.parseFragment(req.responseText, 0, false, null, doc.documentElement);

                doc.documentElement.appendChild(fragment);


                let results = doc.querySelectorAll('#search_results > .thread_url');
                let boards = [];

                Array.from(results).forEach((thread) => {
                    let thread_title = thread.querySelector('.thread_title').textContent;
                    let thread_url = thread.getAttribute('href');
                    let thread_posts = Number.parseInt(thread.querySelector('.res_num').textContent);
                    let board_title = thread.querySelector('.board_title').textContent;
                    let created = thread_url.match(/\/(\d{9,10})/)[1];
                    let rate_cnt = Number.parseFloat(thread.querySelector('.rate_cnt').textContent);

                    let options = { year: 'numeric', month: '2-digit', day: '2-digit',
                                    hour: '2-digit', minute: '2-digit', second: '2-digit' };
                    let infoText = '作成日時: ' + new Date(1000 * created).toLocaleString('ja-JP', options) +
                                   '  勢い: ' + rate_cnt;

                    let board = boards.find((board) => board.title === board_title);

                    if(!board){
                        board = {
                            title: board_title,
                            threads: []
                        };

                        boards.push(board);
                    }

                    board.threads.push({
                        url: thread_url,
                        title: thread_title,
                        post: thread_posts,
                        info: infoText,
                    });
                });

                resolve(boards);
            }, false);

            req.open("GET", url, true);
            req.setRequestHeader('User-Agent', ChaikaCore.getUserAgent());
            req.overrideMimeType('text/html; charset=utf-8');
            req.send(null);
        });
    },

};
