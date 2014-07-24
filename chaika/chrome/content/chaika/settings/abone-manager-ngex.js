
Components.utils.import('resource://chaika-modules/ChaikaCore.js');
Components.utils.import("resource://chaika-modules/ChaikaAboneManager.js");


var gNGExView;


function startup(){
    gNGExView = new NGExView(document.getElementById('ngex'));

    if('arguments' in window &&
       window.arguments.length > 0 &&
       typeof window.arguments[0] === 'object'){
            gNGExView.populateData(window.arguments[0]);
    }
}


function shutdown(){
    gNGExView.uninit();
}


function onDialogAccept(){
    if(gNGExView._enableAutoNaming){
        gNGExView.setLabel();
    }

    ChaikaAboneManager.ex.add(gNGExView.getNgData());
}


/**
 * NGEx のあぼーんデータを表す.
 * Object.create(NGExData); によって新規作成すること.
 */
var NGExData = {
    /**
     * タイトル
     * @type {String}
     * @required
     */
    title: '',

    /**
     * あぼーんの対象
     * @type {String}
     * @note 'post' (レス), 'thread' (スレッド) の2通りのみが可
     * @required
     */
    target: 'post',

    /**
     * マッチの方法
     * @type {String}
     * @note 'any' (いづれか), 'all' (全て) の2通りのみが可
     * @required
     */
    match: 'all',

    /**
     * 連鎖あぼーんをするかどうか
     * @type {Boolean|undefined}
     * @note true: する, false: しない, undefined: デフォルトの設定に従う
     */
    chain: undefined,

    /**
     * 透明あぼーんをするかどうか
     * @type {Boolean|undefined}
     * @note true: する, false: しない, undefined: デフォルトの設定に従う
     */
    hide: undefined,

    /**
     * 有効期限
     * @type {Number|undefined}
     * @note UNIX時間を設定する. undefined の場合は期限なしを表す.
     */
    expire: undefined,

    /**
     * 自動NGIDをするかどうか
     * @type {Boolean}
     * @note true: する, false: しない
     */
    autoNGID: false,

    /**
     * あぼーんせずにハイライトするかどうか
     * @type {Boolean}
     * @note true: する, false: しない
     */
    highlight: false,


    /**
     * マッチする条件
     * @type {Object} rule
     *       {String} rule.target 条件の対象 'name', 'msg' など.
     *                            詳細は abone-manager-ngex.xul の menulist.rule-target を参照.
     *       {Boolean} rule.regexp 正規表現かどうか
     *       {Boolean} rule.ignoreCase 大文字小文字を無視するかどうか
     *       {String} rule.query NGワード
     *       {String} rule.condition マッチの方法
     *                               'contains': 含む, 'notContain': 含まない
     *                               'equals': である(一致する), 'notEqual': でない(一致しない)
     *                               'startsWith': で始まる, 'endsWith': で終わる
     */
    rules: [],
};



function NGExView(root){
    this._init(root);
}

NGExView.prototype = {

    _init: function(root){
        this._root = root;
        this._labelbox = root.querySelector('.label');

        this._root.addEventListener('command', this, true);
        this._root.addEventListener('change', this, true);

        this.setAutoNaming(true);
        this.insertRule();
    },


    uninit: function(){
        this._root.removeEventListener('command', this, true);
        this._root.removeEventListener('change', this, true);
    },


    handleEvent: function(aEvent){
        switch(aEvent.type){
            case 'command':
                switch(aEvent.target.className){
                    case 'auto-naming':
                        this.toggleAutoNaming();
                        break;

                    case 'rule-button-add':
                        this.insertRule();
                        break;

                    case 'rule-button-remove':
                        this.removeRule(aEvent);
                        break;
                }
                break;

            case 'change':
                break;

            default:
                return;
        }

        if(this._enableAutoNaming){
            this.setLabel();
        }
    },


    adjustWindowSize: function(){
        let rules = this._root.querySelector('.rules');


        //ディスプレイ高さの7.5割以上の高さになったら、
        //そこでウィンドウサイズを大きくするのはやめて、
        //かわりにルール表示部にスクロールバーを表示する
        if(window.outerHeight > window.screen.availHeight * 0.75){
            window.resizeTo(window.outerWidth, window.screen.availHeight * 0.75);

            if(!rules.classList.contains('fixed-height')){
                rules.classList.add('fixed-height');
                rules.style.height = Math.floor(rules.clientHeight) + 'px';
            }
        }


        //ルール表示部の下部にまだ余裕がある場合には、
        //ルール表示部の固定高さ表示を解除する
        let lastRule = rules.querySelector('.rule:last-child');
        let rulesBottomMargin = rules.getBoundingClientRect().bottom -
                                lastRule.getBoundingClientRect().bottom;

        if(rulesBottomMargin > 0){
            rules.classList.remove('fixed-height');
            rules.style.height = 'auto';
        }


        //条件を削除するなどして content のサイズが小さくなった場合に
        //ウィンドウ下部の空白部分が広がってしまう問題に対処する
        let windowBottomMargin = document.documentElement.getBoundingClientRect().bottom -
                           this._root.getBoundingClientRect().bottom;

        if(windowBottomMargin > 0){
            window.resizeBy(0, -windowBottomMargin);
        }


        //条件を追加したときにウィンドウサイズが広がらず、
        //下部が見切れてしまう問題に対処する
        //ウィンドウの再描画がうまく行われないことが原因？
        window.resizeBy(0, 0);
    },


    insertRule: function(){
        let template = this._root.querySelector('.template');
        let newRule = template.cloneNode(true);

        newRule.classList.remove('template');
        newRule.classList.add('rule');

        this._root.querySelector('.rules').appendChild(newRule);

        this.adjustWindowSize();

        return newRule;
    },


    removeRule: function(aEvent){
        let rule = aEvent.target.parentNode.parentNode;
        let rules = rule.parentNode;

        if(rules.childNodes.length > 1){
            rule.parentNode.removeChild(rule);
        }

        this.adjustWindowSize();
    },


    clearRules: function(){
        let rules = this._root.querySelector('.rules');

        while(rules.childNodes.length > 0){
            rules.removeChild(rules.firstChild);
        }
    },


    toggleAutoNaming: function(){
        let checkbox = this._root.querySelector('.auto-naming');

        this._enableAutoNaming =
        this._labelbox.disabled = checkbox.checked;
    },


    setAutoNaming: function(enable){
        let checkbox = this._root.querySelector('.auto-naming');

        checkbox.checked =
        this._enableAutoNaming =
        this._labelbox.disabled = enable;
    },


    setLabel: function(){
        this._labelbox.value = this.getLabelText();
    },


    getLabelText: function(){
        let rules = this._root.querySelectorAll('.rule');

        if(!rules.length) return '';

        let rulesText = Array.slice(rules).map((rule) => {
            let target = rule.querySelector('.rule-target').selectedItem.label;
            let query = rule.querySelector('.rule-query').value;
            let condition = rule.querySelector('.rule-condition').selectedItem.label;

            return target + 'が' + query + condition;
        });

        let match = this._root.querySelector('.match').selectedItem.label;
        let target = this._root.querySelector('.target').selectedItem.label;

        return rulesText.join(', ') + ' の' + match + 'に一致する' + target;
    },


    getNgData: function(){
        let ngData = Object.create(NGExData);

        ngData.title = this._labelbox.value;
        ngData.match = this._root.querySelector('.match').value;
        ngData.target = this._root.querySelector('.target').value;
        ngData.autoNGID = this._root.querySelector('.autoNGID').checked;
        ngData.highlight = this._root.querySelector('.highlight').checked;

        ngData.hide = eval(this._root.querySelector('.hide-abone').value);
        ngData.chain = eval(this._root.querySelector('.chain-abone').value);

        if(this._root.querySelector('.set-expire').checked){
            let datepicker = this._root.querySelector('.expire-date');
            let timepicker = this._root.querySelector('.expire-time');
            let expire = new Date(datepicker.year, datepicker.month, datepicker.date,
                                  timepicker.hour, timepicker.minute, 0, 0);

            ngData.expire = expire.getTime();
        }

        let rules = this._root.querySelectorAll('.rule');

        ngData.rules = Array.slice(rules).map((rule) => {
            return {
                target: rule.querySelector('.rule-target').value,
                query: rule.querySelector('.rule-query').value,
                condition: rule.querySelector('.rule-condition').value,
                regexp: rule.querySelector('.rule-regexp').checked,
                ignoreCase: ! rule.querySelector('.rule-case-sensitive').checked
            };
        });


        return ngData;
    },


    populateData: function(ngData){
        this._labelbox.value = ngData.title || '';
        this._root.querySelector('.match').value = ngData.match;
        this._root.querySelector('.target').value = ngData.target;
        this._root.querySelector('.autoNGID').checked = !!ngData.autoNGID;
        this._root.querySelector('.highlight').checked = !!ngData.highlight;

        this._root.querySelector('.hide-abone').value = ngData.hide + '';
        this._root.querySelector('.chain-abone').value = ngData.chain + '';

        if(typeof ngData.expire === 'number'){
            this._root.querySelector('.set-expire').checked = true;

            let datepicker = this._root.querySelector('.expire-date');
            let timepicker = this._root.querySelector('.expire-time');
            let expire = new Date(ngData.expire);

            datepicker.year = expire.getFullYear();
            datepicker.month = expire.getMonth();
            datepicker.date = expire.getDate();
            timepicker.hour = expire.getHours();
            timepicker.minute = expire.getMinutes();
        }else{
            this._root.querySelector('.set-expire').checked = false;
        }


        this.clearRules();

        ngData.rules.forEach((rule) => {
            let node = this.insertRule();

            node.querySelector('.rule-target').value = rule.target;
            node.querySelector('.rule-query').value = rule.query;
            node.querySelector('.rule-condition').value = rule.condition;
            node.querySelector('.rule-regexp').checked = !!rule.regexp;
            node.querySelector('.rule-case-sensitive').checked = ! rule.ignoreCase;
        });


        //自動ネーミングと設定されているラベルが一致したら
        //自動ネーミングが有効だと判断する
        if(ngData.title === this.getLabelText()){
            this.setAutoNaming(true);
        }else{
            this.setAutoNaming(false);
        }

        //もし有効ならラベルをセットする
        if(this._enableAutoNaming){
            this.setLabel();
        }
    },

}
