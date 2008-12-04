/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is chaika.
 *
 * The Initial Developer of the Original Code is
 * chaika.xrea.jp
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *    flyson <flyson.moz at gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */


EXPORTED_SYMBOLS = ["ChaikaBoard"];
Components.utils.import("resource://chaika-modules/ChaikaCore.js");


const Ci = Components.interfaces;
const Cc = Components.classes;
const Cr = Components.results;


/** @ignore */
function makeException(aResult){
	var stack = Components.stack.caller.caller;
	return new Components.Exception("exception", aResult, stack);
}


// getBoardType で利用する例外的な URL のリスト (2ch だけど板じゃない URL)
const EX_HOSTS = [
		"find.2ch.net",
		"info.2ch.net",
		"epg.2ch.net",
		"headline.2ch.net",
		"newsnavi.2ch.net",
		"headline.bbspink.com"
	];


function ChaikaBoard(){
}


ChaikaBoard.getBoardID = function ChaikaBoard_getBoardID(aBoardURL){
	if(!(aBoardURL instanceof Ci.nsIURL)){
		throw makeException(Cr.NS_ERROR_INVALID_POINTER);
	}
	if(aBoardURL.scheme.indexOf("http") != 0){
		throw makeException(Cr.NS_ERROR_INVALID_ARG);
	}

	var boardID = "/";
	if(aBoardURL.host.indexOf(".2ch.net")!=-1){
		boardID += "2ch" + aBoardURL.path;
	}else if(aBoardURL.host.indexOf(".machi.to")!=-1){
		boardID += "machi" + aBoardURL.path;
	}else if(aBoardURL.host.indexOf(".bbspink.com")!=-1){
		boardID += "bbspink" + aBoardURL.path;
	}else if(aBoardURL.host == "jbbs.livedoor.jp"){
		boardID += "jbbs" + aBoardURL.path;
	}else{
		boardID += "outside/";
		boardID += aBoardURL.host +  aBoardURL.path;
	}
	return boardID;
}


ChaikaBoard.getLogFileAtURL = function ChaikaBoard_getLogFileAtURL(aURL){
	var logFile = null;
	try{
		var boardID = ChaikaBoard.getBoardID(aURL);
		logFile = ChaikaBoard.getLogFileAtBoardID(boardID);
	}catch(ex){
		ChaikaCore.logger.error(ex);
		throw makeException(ex.result);
	}
	return logFile;
}

ChaikaBoard.getLogFileAtBoardID = function ChaikaBoard_getLogFileAtBoardID(aBoardID){
	var logFile = ChaikaCore.getLogDir();

	var pathArray = aBoardID.split("/");
	for(let i=0; i<pathArray.length; i++){
		if(pathArray[i]) logFile.appendRelativePath(pathArray[i]);
	}
	return logFile;
}


ChaikaBoard.getBoardType = function ChaikaBoard_getBoardType(aURL){
	if(!(aURL instanceof Ci.nsIURI)){
		throw makeException(Cr.NS_ERROR_INVALID_POINTER);
	}

	if(!(aURL instanceof Ci.nsIURL)) return Ci.nsIBbs2chService.BOARD_TYPE_PAGE;
		// HTTP 以外
	if(aURL.scheme != "http") return Ci.nsIBbs2chService.BOARD_TYPE_PAGE;
		// HOST だけの URL
	if(aURL.directory.length == 1) return Ci.nsIBbs2chService.BOARD_TYPE_PAGE;

	if(EX_HOSTS.indexOf(aURL.host) != -1) return Ci.nsIBbs2chService.BOARD_TYPE_PAGE;

		// Be@2ch.net
	if(aURL.host == "be.2ch.net") return Ci.nsIBbs2chService.BOARD_TYPE_BE2CH;
		// 2ch.net
	if(aURL.host.indexOf(".2ch.net") != -1) return Ci.nsIBbs2chService.BOARD_TYPE_2CH;
		// bbspink.com
	if(aURL.host.indexOf(".bbspink.com") != -1) return Ci.nsIBbs2chService.BOARD_TYPE_2CH;
		// まちBBS
	if(aURL.host.indexOf(".machi.to") != -1) return Ci.nsIBbs2chService.BOARD_TYPE_MACHI;
		// JBBS
	if(aURL.host == "jbbs.livedoor.jp") return Ci.nsIBbs2chService.BOARD_TYPE_JBBS;

		// スレッド URL
	if(aURL.directory.indexOf("/test/read.cgi/") != -1) return Ci.nsIBbs2chService.BOARD_TYPE_2CH;
	if((aURL.fileName == "read.cgi") && (aURL.query.indexOf("key=") != -1))
			return Ci.nsIBbs2chService.BOARD_TYPE_OLD2CH;

	return Ci.nsIBbs2chService.BOARD_TYPE_PAGE;
}