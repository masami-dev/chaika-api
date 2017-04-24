chaika-api
==========

[chaika](https://github.com/chaika/chaika) に 2ch の API を実装する非公式なプロジェクトです。

* [プロジェクトの概要](https://github.com/masami-dev/chaika-api/wiki)
* [2ch API 拡張部の説明](https://github.com/masami-dev/chaika-api/wiki/%E4%BB%98%E5%B1%9E%E6%96%87%E6%9B%B8%28README%29)

### 使用上の注意

このバージョンの chaika は、アドオン名やアドオンIDが元のオリジナル版 chaika とは別のものに変更されているため、オリジナル版とは別のアドオンとして Firefox に認識されます。そのため、オリジナル版と同時にインストールすることができてしまいますが、オリジナル版と同時にインストールされると正常に動作しません。すなわち、オリジナル版との共存はできません。

従いまして、オリジナル版 chaika から移行する際には、**必ず、アドオンマネージャにてオリジナル版 chaika を削除（アンインストール）した後にインストールしてください**。オリジナル版 chaika を削除してもデータや設定はそのまま残り、それらは全て引き継がれます。

2ch API サポートは非公式対応となっており、2ch API 機能を働かせるには所定のAPIキーを入力する必要があります。初めて使用する際には、[2ch API 拡張部の説明](https://github.com/masami-dev/chaika-api/wiki/%E4%BB%98%E5%B1%9E%E6%96%87%E6%9B%B8%28README%29) を参照の上、必要な初期設定を行なってください。

### オリジナル版 chaika との違い

このバージョンの chaika は、元々の chaika に対し、2ch API サポートを筆頭にいくつかの機能を追加し、既知の不具合を修正したカスタム版となっています。

#### オリジナル版からの変更点一覧

末尾の (XXX.zip) という表記は、[公式アップローダー](http://bbs2ch.osdn.jp/uploader/upload.php) に上げられているパッチが元になっていることを意味します。

* 2ch API サポートの追加 (2ch API extension v0.13)
* サイドバーのメニューに chaika-api の組み込みリリースノートを開くリンクを追加
* サイドバーのスレッド検索に ff2ch.syoboi.jp を追加 ([767.zip](http://bbs2ch.osdn.jp/uploader/img/767.zip))
* 2ch.net と bbspink.com ドメインの BE 2.0 ログインに対応 ([818.zip](http://bbs2ch.osdn.jp/uploader/img/818.zip))
* 外部板に対する動作を2chと同等にできる機能を追加 ([819.zip](http://bbs2ch.osdn.jp/uploader/img/819.zip))
* スレタイの [転載禁止] ©2ch.net などを消去して表示できる機能を追加 ([833.zip](http://bbs2ch.osdn.jp/uploader/img/833.zip))
* defaultmail.txt/defaultname.txt で適用対象を指定できるようにした ([833.zip](http://bbs2ch.osdn.jp/uploader/img/833.zip))
* スレッドタイトルの©マークが正常に表示されない現象を修正 ([833.zip](http://bbs2ch.osdn.jp/uploader/img/833.zip))
* スレ一覧などの右メニューから「ブラウザで開く」を選んでもchaikaで開いてしまう不具合を修正
* 板URLリンクを右クリックして「リンク先を chaika で開く」を選んでも反応しない不具合を修正
* スレ一覧で一部の2ch実況板の板名が何れも｢実況せんかいｺﾞﾙｧ！｣になる不具合を修正
* サーバーによってdat落ちを認識できず正しく過去ログを取得できない問題を修正
* https: で始まるスレッドURL・板URLを認識できるようにした
* BBSMENU の読み込みで // で始まるURLも正常に認識できるようにした
* chaikaサイドバー板一覧にてキーボードで板を開けるようにした（Enter，Ctrl+Enter）
* chaikaサイドバー板一覧リストを複数選択動作できるようにした
* スレ一覧で「シングルクリックで開く」が有効の時はカーソルをリンクポインタにするようにした
* スレ一覧・ログマネージャにてフォーカスのあるスレッドが選択状態として扱われる不具合を修正
* スレ一覧・ログマネージャにてキーボードでコンテキストメニューを開けない場合があるのを修正
* 板・スレッドに対するコンテキストメニューが上下矢印キーで項目を選択できなかったのを修正
* 板一覧・スレ一覧のフォントサイズを変更したとき即座に反映されない場合があるのを修正
* 「常に最前面にする」が有効のときに書き込みウィザードを複数開くと競合状態になる現象を修正
* トリップキーに&<>◆などがあると正しいトリップがプレビューに表示されない現象を修正
* 2ch.netの新サーバでdat落ちしたスレッドへのアクセスが「エラー:404」と表示されるのを修正
* サーバの移転先URLを正しく認識できない場合があるのを修正
* まちBBSの http://machi.to/ で始まる URL を認識できるようにした
* まちBBSのスレッドURLに対してスレッドリダイレクタが働いていなかった不具合を修正
* Firefox 40 以降であぼーんマネージャのリスト内容が表示されなくなっていたのを修正
* Firefox 44 以降でスレ一覧などのコンテキストメニューが効かなくなっていたのを修正
* Firefox 46 以降でスレッド表示が 404 Not Found となり動作しない不具合を修正
* Firefox 48 以降で板やスレッドの読み込みが全くできなくなる不具合を修正
* Firefox 50 以降でスレ一覧・ログマネージャからの drag&drop ができない不具合を修正
* Firefox 53 以降でスレッドリダイレクタの回避ができなくなる不具合を修正
* Firefox 53 以降でスキンから書き込みウィザードを開けない不具合を修正
* Firefox 54 以降で chaika 独自のプロキシ設定をするとネットワークエラーになるのを修正
* 将来的に廃止予定とされている Javascript の要素（構文・メソッドなど）を除去
* そのほか、細かな不具合をいくつか修正


----

**以下、オリジナル版 chaika の `README.md`**

----

chaika
======

Firefox に 2ちゃんねる専用ブラウザ相当の機能を追加するアドオンです。


Install
---

[Mozilla 公式サイト](https://addons.mozilla.org/ja/firefox/addon/chaika/)よりインストール可能です。


For User
---

* [chaika 公式サイト](http://chaika.xrea.jp/)
* [bbs2chreader 公式サイト](http://bbs2ch.sourceforge.jp/)
* [2ch現行スレッド](http://find.2ch.net/?STR=bbs2chreader%2Fchaika&BBS=ALL&TYPE=TITLE) ([避難所](http://yy22.kakiko.com/test/read.cgi/bbs2ch/1222488320/))
* [FAQ(よくある質問)](http://bbs2ch.sourceforge.jp/?page=FAQ)
* [Uploader](http://bbs2ch.sourceforge.jp/uploader/upload.php)
* [スキン一覧](http://bbs2ch.sourceforge.jp/?page=Skin%2F0.4.5)


For Developer
---

### Links ###

* [テスト板](http://yy22.kakiko.com/bbs2ch/) : バグ再現レスなどはこちらに投稿。

### バグ一覧/ToDo ###
* 最新バグ一覧: [Issues](https://github.com/chaika/chaika/issues)

* 更新が停止したバグ一覧など  
    (新規投稿は上にお願いします)
	* [旧旧ToDo](https://spreadsheets.google.com/pub?key=pbbe5TFNb21RVxOf7ygNJfg) : b2r 0.5系 (flysonさん作成)
	* [旧ToDo](http://d.hatena.ne.jp/nazodane/20080609/1212999112) : b2r 0.5系 (Nazoさん作成)
	* [launchpad](https://bugs.launchpad.net/bbs2ch) : b2r バグトラッカー
	* [あぼーん改善案](http://bbs2ch.sourceforge.jp/?page=%A4%A2%A4%DC%A1%BC%A4%F3%B2%FE%C1%B1)
	* [書きこみ改善案](http://bbs2ch.sourceforge.jp/?page=%BD%F1%A4%AD%B9%FE%A4%DF%B2%FE%C1%B1)

### branch について ###
基本規則は http://havelog.ayumusato.com/develop/git/e513-git_branch_model.html に準拠。

* **master**  
  主にタグ付専用として使用。直接コミットはせず、基本的にマージのみ。
* **develop**  
  開発用のブランチ。
  
  * **feature**  
    大規模修正用のブランチ。
  * **release**  
    リリース候補用のブランチ。AMOは登録に時間がかかるため、登録が完了するまではこちらでバグフィックスする。開発はdevelopブランチで継続する。