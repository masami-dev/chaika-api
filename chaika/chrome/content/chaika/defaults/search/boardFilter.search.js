/* See license.txt for terms of usage */

Components.utils.import("resource://chaika-modules/ChaikaCore.js");
Components.utils.import("resource://chaika-modules/ChaikaBBSMenu.js");


/**
 * Polyfill for Firefox 39-
 */
if(!String.prototype.includes){
    String.prototype.includes = function(){'use strict';
        return String.prototype.indexOf.apply(this, arguments) !== -1;
    };
}


var BoardFilter = {

    id: '99.chaika.filter.board',

    name: '板名フィルタ',

    version: '2.0.2',

    charset: 'utf-8',

    url: null,

    search: function(query){
        query = ChaikaCore.io.unescapeHTML(query).toLowerCase().normalize('NFKC');

        return ChaikaBBSMenu.getXML().then((xml) => {
            let results = Array.from(xml.querySelectorAll('board[title]')).filter((node) => {
                let title = node.getAttribute('title').toLowerCase().normalize('NFKC');
                return title.includes(query);
            });

            return results.map((node) => {
                return {
                    title: node.getAttribute('title'),
                    url: node.getAttribute('url')
                };
            });
        });
    },

};
