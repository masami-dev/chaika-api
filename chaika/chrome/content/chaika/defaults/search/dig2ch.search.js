/* See license.txt for terms of usage */

Components.utils.import("resource://chaika-modules/ChaikaCore.js");


var Dig2ch = {

    id: '00.dig.2ch.net',

    name: '2ch検索 (dig.2ch.net)',

    version: '2.0.1',

    charset: 'utf-8',

    url: 'http://dig.2ch.net/?keywords=%%TERM%%',

    search: function(query){
        return new Promise((resolve, reject) => {
            const url = 'http://dig.2ch.net/?json=1&keywords=' +
                        encodeURIComponent(ChaikaCore.io.unescapeHTML(query));
            const XMLHttpRequest = Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1");
            let req = XMLHttpRequest();

            req.addEventListener('error', reject, false);
            req.addEventListener('load', () => {
                if(req.status !== 200 || !req.responseText){
                    reject('Unable to connect. (status: ' + this._req.status + ')');
                    return;
                }


                let json = JSON.parse(req.responseText);

                if(!json.result){
                    reject('Server error.');
                    return;
                }

                if(!json.result.length){
                    reject('No results found.');
                }


                let boards = [];

                json.result.forEach((thread) => {
                    let options = { year: 'numeric', month: '2-digit', day: '2-digit',
                                    hour: '2-digit', minute: '2-digit', second: '2-digit' };
                    let lastUpdate = new Date(1000 * thread.lastupdate).toLocaleString('ja-JP', options);
                    let infoText = '最終更新: ' + lastUpdate + '  勢い: ' + thread.ikioi;

                    let board = boards.find((board) => board.id === thread.bbs);

                    if(!board){
                        board = {
                            id: thread.bbs,
                            title: thread.ita,
                            threads: []
                        };

                        boards.push(board);
                    }

                    board.threads.push({
                        url: thread.url,
                        title: thread.subject,
                        post: thread.resno,
                        info: infoText,
                    });
                });

                resolve(boards);
            }, false);

            req.open("GET", url, true);
            req.overrideMimeType('text/plain; charset=utf-8');
            req.send(null);
        });
    },

};
