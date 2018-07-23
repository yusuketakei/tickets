// Copyright 2017, Google, Inc.
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/views'));
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());
app.use(session({
    secret: 'keyboard cat',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60
    }
}));

const url = require('url');
const ejs = require('ejs');
const https = require('https');
const fs = require('fs');
const config = require('config');
const util = require('util');

//geth rpc設定
const Web3 = require('web3');
var web3 = new Web3(new Web3.providers.HttpProvider(config.geth_url));

//gas
const gas = config.gas;
//from address
const fromAddress = config.from_address;

//contract設定
var ticketContract = new web3.eth.Contract(config.contract_ticket_abi, config.contract_ticket_address, {
    from: fromAddress
});

//初期値byte32
const zeroByte32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

//デモ用
//const USER_ADDRESS_1 = "0x2c078255bfed63def0c29879835d5aadc19fe63a";
//const USER_ADDRESS_2 = "0x18771ecc67ce6ea09d784343fa048433b3e1e29f";

//AWS
const USER_ADDRESS_1 = "0x2ece2166f3232a49345bb99e8481121a448661f9";
const USER_ADDRESS_2 = "0xd39884029517d044d03c5e0889832b41c60e19d4";


//一覧処理のget処理
app.get('/', async(req, res) => {

    var userId = await getUserIdParam(req);
    req.session.userId = userId;

    res.header('Content-Type', 'text/plain;charset=utf-8');
    //パラメータを設定してejsをレンダリング
    //ejsに渡す用のパラメータをセットしてく
    var ejsParams = {};

    //userInfoを取得
    var userInfo = {};
    await getUserInfoFromContract(ticketContract,userId, userInfo);
    ejsParams["userInfo"] = userInfo;

    //ticketCategoryに関するリストを取得する
    //ユーザが持つチケットのリストを取得
    var ticketOwnList = [];
    await getOwnedTicketsByUserAddress(ticketContract, userInfo.userAddress, ticketOwnList);
    console.log(ticketOwnList);
    //ユーザが持つApprovedのリストを取得
    //await getApprovefTicketsByUserAddress(ticketContract,userAddress,ticketList) ;

    //カテゴリーごとに保有数を集計
    //Map Key:ticketCategoryName Value:CategorySumInfo
    var ticketCategoryMap = new Map();
    for (var i = 0; i < ticketOwnList.length; i++) {
        //初見のカテゴリーかどうかの判定。初見じゃなければそちらのマップの保有数に加算する
        if (ticketCategoryMap.has(ticketOwnList[i].ticketCategoryName)) {
            ticketCategoryMap.get(ticketOwnList[i].ticketCategoryName).ownTotal++
                ticketCategoryMap.get(ticketOwnList[i].ticketCategoryName).ticketIdList.push(ticketOwnList[i].ticketId);
        } else {
            //新規CategorySumInfoをMapに追加
            var categorySumInfo = {};
            categorySumInfo.ticketCategoryName = ticketOwnList[i].ticketCategoryName;
            categorySumInfo.ownTotal = 1;
            categorySumInfo.approvedTotal = 0;
            categorySumInfo.ticketIdList = [];
            categorySumInfo.ticketIdList.push(ticketOwnList[i].ticketId);
            ticketCategoryMap.set(ticketOwnList[i].ticketCategoryName, categorySumInfo);
            
        }
    }

    //カテゴリーマップに代理件数を追加


    console.log(ticketCategoryMap);

    //ejsに渡す
    ejsParams["ticketCategoryMap"] = ticketCategoryMap;

    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/";
    //レンダリング
    fs.readFile('./views/index.ejs', 'utf-8', function (err, data) {
        renderEjsView(res, data, ejsParams);
    });
});

//振込処理実行
app.post('/doTransfer', async(req, res) => {
    res.header('Content-Type', 'text/plain;charset=utf-8');
    //post data
    var transactionInfo = {};
    transactionInfo.fromAccountNo = req.body.fromAccountNo;
    transactionInfo.toAccountNo = req.body.toAccountNo;
    transactionInfo.fromAccountHolderName = req.body.fromAccountHolderName;
    transactionInfo.toAccountHolderName = req.body.toAccountHolderName;
    transactionInfo.fromPrinc = req.body.fromPrinc;
    transactionInfo.fromCurrency = req.body.fromCurrency;
    transactionInfo.transactionType = 0;
    transactionInfo.rate = 1;

    //取引実行
    await transfer(bankContract, transactionInfo);

    var ejsParams = {};
    //express4でejsテンプレートを読み込むための呪文
    ejsParams["filename"] = "filename";
    //navbar用
    ejsParams["navActive"] = "/transfer";

    res.redirect(302, "../");

});

//userIdを取得
async function getUserIdParam(req) {
    //getパラメータを取得
    var url_parts = url.parse(req.url, true);

    if (url_parts.query.userId) {
        var userId = url_parts.query.userId;
    }
    //sessionからaccountを取得
    else if (req.session.userId) {
        var userId = req.session.userId;
    } else {
        var userId = "";
    }
    return userId;
}

//Contractから所有しているチケットのリストを取得
async function getOwnedTicketsByUserAddress(ticketContract, userAddress, ticketOwnList) {
    //debug
    //    var ticketOwnInfo1 = {} ;
    //    ticketOwnInfo1.ticketId = 1 ;
    //    ticketOwnInfo1.ticketCategoryName = "ticket_category1" ;
    //
    //    var ticketOwnInfo2 = {} ;
    //    ticketOwnInfo2.ticketId = 2 ;
    //    ticketOwnInfo2.ticketCategoryName = "ticket_category2" ;
    //
    //    var ticketOwnInfo3 = {} ;
    //    ticketOwnInfo3.ticketId = 3 ;
    //    ticketOwnInfo3.ticketCategoryName = "ticket_category1" ;
    //    
    //    ticketOwnList.push(ticketOwnInfo1) ;
    //    ticketOwnList.push(ticketOwnInfo2) ;    
    //    ticketOwnList.push(ticketOwnInfo3) ;
    //チケットIDのリストを取得
    var ticketIdList = [];
    await ticketContract.methods.tokensOfOwner(userAddress).call(function (err, result) {
        //コンバージョンする
        ticketIdList = result;
    });

    //チケットIDの情報を取得
    for (var i = 0; i < ticketIdList.length; i++) {
        await ticketContract.methods.getTicketInfoById(ticketIdList[i]).call(function (err, result) {
            var ticketInfo = {}

            //コンバージョンする
            ticketInfo.ticketId = getUint(result[0]);
            ticketInfo.ticketInternalId = getUint(result[1]);
            ticketInfo.ticketCategoryName = toAscii(result[2]);
            ticketInfo.IPFSHashFirst = toAscii(result[3]);
            ticketInfo.IPFSHashSecond = toAscii(result[4]);
            ticketInfo.ticketIssuer = getAddressBytes(result[5]);
            ticketInfo.issueTime = getEpochTimeInt(result[6]);

            console.log(ticketInfo);

            ticketOwnList.push(ticketInfo);
        });
    }


}

//ContractからUserInfoを取得する
async function getUserInfoFromContract(contract, userId, userInfo) {
    //    await bankContract.methods.getUserInfo(userId).call(function(err,result){
    //        //コンバージョンする
    //        userInfo.userId = getUint(result[0]);
    //        userInfo.userName = toAscii(result[1]);
    //        userInfo.userAddress = toAscii(result[2]);
    //        return ;
    //    }) ;
    if (userId == 1) {
        userInfo.userId = 1;
        userInfo.userName = "みずほ太郎";
        userInfo.userAddress = USER_ADDRESS_1;
    } else if (userId == 2) {
        userInfo.userId = 1;
        userInfo.userName = "みずほ花子";
        userInfo.userAddress = USER_ADDRESS_2;
    }
}
//ContractからtransactionIdに該当する取引情報を取得する
async function getTransactionInfoFromContractById(bankContract, transactionId, transactionInfo) {
    await bankContract.methods.getTransactionInfo(transactionId).call(function (err, resultTransactionInfo) {
        transactionInfo.transactionId = getUint(resultTransactionInfo[0]);
        transactionInfo.transactionStatus = getUint(resultTransactionInfo[1]);
        transactionInfo.transactionType = getUint(resultTransactionInfo[2]);
        transactionInfo.fromAccountNo = toAscii(resultTransactionInfo[3]);
        transactionInfo.toAccountNo = toAscii(resultTransactionInfo[4]);
        transactionInfo.fromAccountHolderName = toAscii(resultTransactionInfo[5]);
        transactionInfo.toAccountHolderName = toAscii(resultTransactionInfo[6]);
        transactionInfo.fromCurrency = toAscii(resultTransactionInfo[7]);
        transactionInfo.toCurrency = toAscii(resultTransactionInfo[8]);
        transactionInfo.rate = getRateFromBytes(resultTransactionInfo[9]);
        transactionInfo.fromPrinc = getUint(resultTransactionInfo[10]);
        transactionInfo.toPrinc = getUint(resultTransactionInfo[11]);
        transactionInfo.timestamp = getEpochTimeInt(resultTransactionInfo[12]);
    });
}

//Contractからtransfer取引実行
async function transfer(ticketContract, toAddress,ticketId) {
    await bankContract.methods.transfer(toAddress,ticketId).send({
        "from": fromAddress,
        "gas": gas
    });
}
//Utility
//16進Byte表現⇒Ascii文字列変換（null文字削除込み)
//ethereumのコントラクトでは、整数のみの値はintに解釈されてしまうので、現状は文字列としてdecodeすると値がおかしくなる。
function toAscii(byteStr) {
    return web3.utils.hexToAscii(byteStr).replace(/\0/g, "");
}
//byte表現からehtereumアカウントアドレスを切り出す
function getAddressBytes(byteStr) {
    return "0x" + byteStr.substr(byteStr.length - 40, 40);
}
//byte表現からuintの表現を取り出す
function getUint(byteStr) {
    return parseInt(byteStr.substr(2, byteStr.length - 2), 16);
}
//byte表現からepochの日時を取得する
function getEpochTimeInt(byteStr) {
    return parseInt((parseInt(byteStr.substr(2, byteStr.length - 2), 16)).toString().substr(0, 10) + "000");
}
//byte表現からレートを取得する
function getRateFromBytes(byteStr) {
    return parseFloat(toAscii(byteStr).replace(rateDelimiter, "."));
}
//レートを文字表現に変換
function rateToByte(rate) {
    return new Number(rate).toFixed(decimalScale).replace("\.", rateDelimiter);
}

//ejs render
function renderEjsView(res, data, ejsParams) {
    var view = ejs.render(data, ejsParams);
    res.writeHead(200, {
        'Content-Type': 'text/html'
    });
    res.write(view);
    res.end();
}
//read rate file
function getRate(fromCurrency, toCurrency) {
    var rateList = JSON.parse(fs.readFileSync('./data/rate.json', 'utf-8'));
    return rateList[fromCurrency + "to" + toCurrency];
}

if (module === require.main) {
    // [START server]
    // Start the server
    const server = app.listen(process.env.PORT || 8081, () => {
        const port = server.address().port;
        console.log(`App listening on port ${port}`);
    });
    // [END server]
}

module.exports = app;
