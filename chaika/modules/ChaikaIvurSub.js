/* See license.txt for terms of usage */

'use strict';

this.EXPORTED_SYMBOLS = ["ChaikaIvurSub"];

const { interfaces: Ci, classes: Cc, results: Cr, utils: Cu } = Components;

let { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
let { Logger } = Cu.import("resource://chaika-modules/utils/Logger.js", {});


/**
 * ChaikaImageViewURLReplace (ChaikaHttpController.ivur) の中で、
 * Content Process 側で必要となるメソッドのみを分離したクラス
 *
 * e10s 環境下では同じモジュールでも Content Process と Chrome Process とでは
 * 別々のインスタンスとなり、動的なデータを共有するには明示的に受け渡す必要がある。
 * ChaikaHttpController.js のほとんどの部分は Content Process には不要なので、
 * 必要なコードのみを別のモジュールにして収めた。
 *
 * @class
 */
this.ChaikaIvurSub = {

    /**
     * 処理したURLをキーに、置換後の画像URLを値に持つハッシュ
     */
    _replaceMapImage: {},


    init: function ChaikaIvurSub_init(){
        Services.cpmm.addMessageListener('chaika-ivur-image-url', this);
    },

    receiveMessage: function ChaikaIvurSub_receiveMessage(aMessage){
        this._replaceMapImage[aMessage.data.url] = aMessage.data.image;
    },


    /**
     * 置き換え後の画像URLを返す
     * @param {nsIURI} aURI
     * @return {String} URL
     */
    getRedirectURI: function ChaikaIvurSub_getRedirectURI(aURI){
        let url = aURI.spec.replace('chaika://ivur/', '')
                           .replace('?dummy_ext=.jpg', '');

        let ivurImg = this._replaceMapImage[url];

        if(!ivurImg) return url;
        if(!ivurImg.startsWith('http')) return url;

        Logger.debug('[ivur] ' + aURI.spec + ' -> ' + ivurImg);

        return ivurImg;
    }

};


ChaikaIvurSub.init();
