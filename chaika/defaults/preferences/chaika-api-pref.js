/*
 * chaika-api-pref.js - 2ch API extension for chaika - 設定初期値定義
 *
 * このファイルのあるべき位置：defaults/preferences/chaika-api-pref.js
 *
 * Written by masami ◆U7rHG6DINI
 * 使用条件・ライセンス等については chaika 本体に準じます。
 *
 * 註：このファイルは、オリジナルの bbs2chreader/chaika の構成要素ではありません。
 *     この 2ch API extension for chaika は、オリジナルの bbs2chreader/chaika の
 *     作成者・開発者とは全く別の人物が開発しているものです。
 *     license.txtやその他のソースコード・付属文書・公式サイトなどで明記されている
 *     オリジナルの bbs2chreader/chaika の作成者・開発者・寄付者/貢献者などは、
 *     この 2ch API extension for chaika の開発には一切関与しておりません。
 *
 * Last Modified : 2015/06/07 21:03:08
 */

pref("extensions.chaika.2chapi.enabled", false);
pref("extensions.chaika.2chapi.auth_url", "https://api.2ch.net/v1/auth/");
pref("extensions.chaika.2chapi.api_url", "https://api.2ch.net/v1/");
pref("extensions.chaika.2chapi.hmkey", "");
pref("extensions.chaika.2chapi.appkey", "");
pref("extensions.chaika.2chapi.useragent", "");
pref("extensions.chaika.2chapi.post_ua", "");
pref("extensions.chaika.2chapi.auth_ua", "");
pref("extensions.chaika.2chapi.2ch_ua", "");
pref("extensions.chaika.2chapi.ct_value", "Time");
pref("extensions.chaika.2chapi.use_ronin", true);
pref("extensions.chaika.2chapi.auto_auth", 1);
pref("extensions.chaika.2chapi.auth_interval", 43200);
pref("extensions.chaika.2chapi.retry_interval", 1800);
pref("extensions.chaika.2chapi.wake_delay", 10);
pref("extensions.chaika.2chapi.last_auth_time", 0);
pref("extensions.chaika.2chapi.session_id", "");
