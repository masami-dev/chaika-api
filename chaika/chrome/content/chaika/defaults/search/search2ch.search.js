/* See license.txt for terms of usage */

Components.utils.import("resource://chaika-modules/ChaikaCore.js");

try{
    //Firefox 25+
    Components.utils.import("resource://gre/modules/Promise.jsm");
}catch(ex){
    //Firefox 24
    Components.utils.import("resource://gre/modules/commonjs/sdk/core/promise.js");
}


var Search2ch = {

    id: '00.search.2ch.net',

    name: '5ch検索 (search.5ch.net)',

    version: '1.1.0',

    updateURL: '%%ChaikaDefaultsDir%%/search/search2ch.search.js',

    charset: 'utf-8',

    url: 'https://search.5ch.net/search?q=%%TERM%%',

    search: function(term){
        this._defer = Promise.defer();

        let TERM = encodeURIComponent(term);

        const XMLHttpRequest = Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1");
        this._req = XMLHttpRequest();
        this._req.addEventListener('error', this._onError.bind(this), false);
        this._req.addEventListener('load', this._onSuccess.bind(this), false);
        this._req.open("GET", 'https://search.5ch.net/search?q=' + TERM, true);
        this._req.overrideMimeType('text/html; charset=utf-8');
        this._req.responseType = 'document';    // enable HTML parsing
        this._req.send(null);

        return this._defer.promise;
    },

    _onError: function(){
        this._defer.reject('HTTP Status: ' + this._req.status);
    },

    _onSuccess: function(){
        if(this._req.status !== 200){
            return this._defer.reject('Unable to connect. Status:', this._req.status);
        }

        if(!this._req.responseXML){
            return this._defer.reject('The response doesn\'t seem to be XML/HTML.');
        }

        let doc = this._req.responseXML;
        let boards = [];

        let threads = doc.querySelectorAll('.list_line');

        Array.prototype.forEach.call(threads, thread => {
            let links = thread.getElementsByTagName('a');
            let threadURL = links[0].getAttribute('href').replace(/\d+-\d+$/, '');
            let linkText = links[0].textContent.match(/^\s*(.*?)(?:\s*\((\d+)\))?\s*$/);
            let threadTitle = linkText[1];
            let threadPosts = linkText[2] || '0';
            let boardTitle = links[1].textContent;

            let board = boards.find(board => board.title === boardTitle);

            if(!board){
                board = {
                    title: boardTitle,
                    threads: []
                };

                boards.push(board);
            }

            board.threads.push({
                url: threadURL,
                title: threadTitle,
                post: threadPosts,
            });
        });

        this._defer.resolve(boards);
    },

};


//Polyfill for Firefox 24
//Copied from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find
if (!Array.prototype.find) {
    Object.defineProperty(Array.prototype, 'find', {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function(predicate) {
            if (this == null) {
                throw new TypeError('Array.prototype.find called on null or undefined');
            }
            if (typeof predicate !== 'function') {
                throw new TypeError('predicate must be a function');
            }
            var list = Object(this);
            var length = list.length >>> 0;
            var thisArg = arguments[1];
            var value;

            for (var i = 0; i < length; i++) {
                if (i in list) {
                    value = list[i];
                    if (predicate.call(thisArg, value, i, list)) {
                        return value;
                    }
                }
            }
            return undefined;
        }
    });
}
