"use strict"
// 引入模块
var fs = require("fs");

// var privateKey  = fs.readFileSync(path.join(__dirname, './key/privateKey.key'), 'utf8');
// var certificate = fs.readFileSync(path.join(__dirname, './key/mysign.crt'), 'utf8');

// 设置自己的证书路径
var credentials = {
	key: fs.readFileSync("./key/privateKey.key"),
	cert: fs.readFileSync("./key/mysign.crt")
	//key : fs.readFileSync("/etc/nginx/ssl_key/2_wx.ggzzrj.cn.key"),
	//cert: fs.readFileSync("/etc/nginx/ssl_key/1_wx.ggzzrj.cn_bundle.crt")
};

// 创建app
var express = require('express');
var app = express();
var http = require('http').Server(app);
var https = require("https").createServer(credentials, app);
var io = require('socket.io')(https, { }); // 初始化socket.io的一个实例
var path = require('path');

app.use(express.static(path.join(__dirname, 'public'))); // 设置public文件夹为存放静态文件的目录


http.listen(3000, function () {
	console.log('listening on *:3000');
});

https.listen(8443,
	function () {
		console.log('listening on *:8443');
	});


app.get('/', function (req, res) {
	if (req.protocol == 'https') {
		//res.status(200).send('<h1>This is https visit!</h1>');
		res.sendFile(__dirname + '/index.html'); // 加载网页
	} else {
		res.status(200).send('<h1>This is http visit!</h1>'); // 直接返回文本
	}
});

app.get('/index2', function (req, res) {
	if (req.protocol == 'https') {
		res.sendFile(__dirname + '/index2.html'); // 加载网页
	} else {
		res.status(200).send('<h1>This is http visit!</h1>'); // 直接返回文本
	}
});

app.get('/patient', function (req, res) {
	if (req.protocol == 'https') {
		res.sendFile(__dirname + '/patient.html'); // 加载网页
	} else {
		res.status(200).send('<h1>This is http visit!</h1>'); // 直接返回文本
	}
});

app.get('/seat', function (req, res) {
	if (req.protocol == 'https') {
		res.sendFile(__dirname + '/seat.html'); // 加载网页
	} else {
		res.status(200).send('<h1>This is http visit!</h1>'); // 直接返回文本
	}
});


const users = {}; // 保存用户（key为房间号，value为房间号对应的数组，存储用户列表对象(socket_id、account)）
const sockS = {}; // 保存客户端对应的socket，key为用户名，value为socket套接字对象，
// 注意：虽然区分了不同房间，理论上不同房间的用户名可以相同，
// 但是本系统要求用户名必须全局唯一，在实际业务场景中表现用用户唯一id，也就表现为同一个用户不能登录到2个或更多房间

// 新的浏览器页面访问连接
io.on('connection', function (socket) {
	console.log("========================================");
	console.log('a user connected: ' + socket.id);
	console.log("========================================");

	// 加入房间
	socket.on("join", function (data, cbFn) {
		console.log(">>>>>>>>>> enter room >>>>>>>>>>>");
		console.log("入参:", data); // { roomid: 'room1', account: '1' }

		// 判断参数是否为空
		if (!data.roomid || !data.account) {
			cbFn({
				"code": -1,
				"msg": "roomid or account is null"
			});
			return;
		}

		// 获取参数
		var roomid = data.roomid;
		var account = data.account;

		// 全局判断用户是否已经加入某个房间（本系统要求全局用户名唯一）
		for (let this_roomid in users) {
			var ret = checkUserInRoom(this_roomid, account); // 判断当前要进入房间的用户是否在某个房间
			if (ret == 0) { // account用户已经在this_roomid房间
				var msg = "enter " + roomid + " failure, user " + account + " has been entered in " + this_roomid;
				console.log(msg);
				cbFn({
					"code": -1,
					"msg": msg
				});
				return;
			}
		}

		// 创建房间数组对象，保存账号和对应的套接字id信息
		if (!users[roomid]) users[roomid] = [];

		// 登录账号信息
		let accountInfo = {
			account: account,
			id: socket.id
		};

		// 检索当前加入的账号，是否已经存在于当前房间（有前面的全局判断，这一行其实已经无用，但是考虑到今后的扩展，先留着）
		let arr = users[roomid].filter(v => v.account === account);
		if (!arr.length) { // 如果不存在，则加入房间
			console.log("user " + account + " not exists, enter " + roomid);
			socket.join(roomid); // 加入房间
			users[roomid].push(accountInfo); // 保存登录账号信息到用户房间对象
			// console.log("socket ==> ", socket.id);
			sockS[account] = socket; // 保存该用户的socket
			socket.broadcast.to(roomid).emit('joined', users[roomid], account, socket.id); // 加入信息通知给本房间内所有人
			// io.emit('joined', users[roomid], account, socket.id);  // 将消息发送给所有用户，包括发送者
			// socket.broadcast.emit('joined', msg);  // 将消息发给除特定socket外的其他用户

			// 回调
			cbFn({
				"code": 0,
				"msg": "enter successful",
				"room": roomid,
				"accounts": users[roomid]
			});
		} else { // 如果用户已经进入房间
			console.log("user " + account + " is existed in " + roomid)
			cbFn({
				"code": -1,
				"msg": "enter " + roomid + " failure, user " + account + " is existed"
			});
		}

		printUserList();
		console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>")
	});


	// 离开房间
	socket.on("leave", function (data, cbFn) {
		console.log(">>>>>>>>>> leave room >>>>>>>>>>>");
		console.log("入参:", data); // { roomid: 'room1', account: '2' }

		// 判断参数是否为空
		if (!data.roomid || !data.account) {
			cbFn({
				"code": -1,
				"msg": "roomid or account is null"
			});
			return;
		}

		// 获取参数
		var roomid = data.roomid;
		var account = data.account;

		// 判断当前用户是否在房间
		if (users[roomid]) { // 先要判断下是否存在该房间数组对象
			let arr = users[roomid].filter(v => v.account === account);
			if (!arr.length) { // 如果用户不在房间，则返回报错信息
				cbFn({
					"code": -1,
					"msg": "user " + account + " is not existed in " + roomid
				});
				return;
			}
		} else {
			cbFn({
				"code": -1,
				"msg": "there is no create room: " + roomid
			});
			return;
		}

		socket.leave(roomid); // 离开房间

		for (let this_roomid in users) {
			// console.log(users[this_roomid])
			/*
				[
				  { account: '1', id: 'QZHg9p9D15AQy-lQAAAF' },
				  { account: '2', id: 'R8W5aqiLVf5xfqCXAAAH' }
				]
			*/
			// 筛选出不为离开房间的用户账号（也即去掉离开房间的用户）
			users[this_roomid] = users[this_roomid].filter(v => v.account !== account);
			// console.log(users[this_roomid])
			/*
				[ { account: '1', id: 'QZHg9p9D15AQy-lQAAAF' } ]
			*/
		}

		// 离开信息通知给本房间内所有人
		socket.broadcast.to(roomid).emit('leaved', users[roomid], account, socket.id);
		// 回调客户端方法
		cbFn({
			"code": 0,
			"msg": account + " exited from " + roomid
		});

		printUserList(); // 打印当前用户列表
		console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>")
	});


	// 监听chatMessage事件
	socket.on('chatMessage', function (data, cbFn) {
		console.log(">>>>>>>>>> chatMessage >>>>>>>>>>");
		console.log("入参:", data); // { roomid: 'room1', account: '2', "message": "你好" }

		// 判断当前用户是否在房间
		if (checkUserInRoom(data.roomid, data.account, cbFn) != 0) return;

		try {
			// io.emit('broadcastMsg', data);  // 将消息发送给所有用户，包括发送者
			// socket.broadcast.emit('broadcastMsg', data);    // 将消息发给除特定socket外的其他用户
			socket.to(data.roomid).emit('broadcastMsg', data); // 将消息发送给房间内的用户
			cbFn("server get msg: " + data.message); // 回调客户端方法
		}
		catch (e) {

		}
	});


	// =============== 1v1 点对点视频 =============== 
	// 转发呼叫申请
	socket.on('call', (data, cbFn) => {
		console.log(">>>>>>>>>> call >>>>>>>>>>");
		console.log("入参:", data); // { roomid: 'room1', callee: '2', caller: '1' }
		if (data && data.callee) {
			// 先判断被呼叫方是否也在房间
			if (checkUserInRoom(data.roomid, data.callee, cbFn) != 0) return;

			try {
				// 通知被呼叫方
				sockS[data.callee].emit('call', data);

				// 回调消息给呼叫方
				if (cbFn) cbFn({
					"code": 0,
					"msg": "send call msg to " + data.callee
				});
			} catch (e) {

			}
		}
	});


	// 转发呼叫回复
	socket.on('reply', data => {
		console.log(">>>>>>>>>> reply >>>>>>>>>>");
		console.log("入参:", data); // { roomid: 'room1', callee: '2', caller: '1' }
		if (data && data.caller && sockS[data.caller]) {
			// 通知呼叫发起方
			sockS[data.caller].emit('reply', data);
		}
	});


	// 转发Offer（呼叫端主动调用）
	socket.on('1v1offer', data => {
		console.log(">>>>>>>>>> 1v1offer >>>>>>>>>>");
		console.log("入参:", data); // { callee: '2', caller: '1', from: '2', to: '1' , sdp: ..}

		// 这里取to是因为1呼叫2成功，此时如2切换摄像头，重新要生成offer，就变成2向1发送offer了
		if (sockS[data.to]) sockS[data.to].emit('1v1offer', data);
	});


	// 转发 answer（被呼叫端主动调用）
	socket.on('1v1answer', data => {
		console.log(">>>>>>>>>> 1v1answer >>>>>>>>>>");
		console.log("入参:", data); // { callee: '2', caller: '1', from: '2', to: '1' , sdp: ..}
		if (sockS[data.from]) sockS[data.from].emit('1v1answer', data); // 回复给呼叫请求端
	});


	// 转发 ICE
	socket.on('1v1ICE', data => {
		console.log(">>>>>>>>>> 1v1ICE >>>>>>>>>>");
		console.log("入参:", data);
		if (sockS[data.to]) sockS[data.to].emit('1v1ICE', data); // 注意这里使用了to变量通知对方
	});


	// 转发 mute
	socket.on('1v1mute', data => {
		console.log(">>>>>>>>>> 1v1mute >>>>>>>>>>");
		console.log("入参:", data);
		if (data && data.to && sockS[data.to]) {
			sockS[data.to].emit('1v1mute', data); // 注意这里使用了to变量通知对方
		}
	});


	// 转发 shareLocal （分享本地桌面消息）
	socket.on('shareLocal', data => {
		console.log(">>>>>>>>>> shareLocal >>>>>>>>>>");
		console.log("入参:", data);
		if (data && data.to && sockS[data.to]) {
			sockS[data.to].emit('shareLocal', data); // 注意这里使用了to变量通知对方
		}
	});


	// 转发changeCamera （切换摄像头消息）
	socket.on('changeCamera', data => {
		console.log(">>>>>>>>>> changeCamera >>>>>>>>>>");
		console.log("入参:", data);
		if (data && data.to && sockS[data.to]) {
			sockS[data.to].emit('changeCamera', data); // 注意这里使用了to变量通知对方
		}
	});


	// 转发 hangup（两端都可以发，因此采用to变量）
	socket.on('1v1hangup', data => {
		console.log(">>>>>>>>>> 1v1hangup >>>>>>>>>>");
		console.log("入参:", data); // { callee: '2', caller: '1', from: '2', to: '1' }
		console.log("send hangup msg to " + data.to)
		if (data && data.to && sockS[data.to]) {
			sockS[data.to].emit('1v1hangup', data);
		}
	});


	// socket错误
	socket.on('error', error => {
		console.log('>>>>>>>>>> error >>>>>>>>>>');
		console.log(error);
	});


	// socket断开
	socket.on('disconnect', function (e) {
		console.log('>>>>>>>>>> user disconnected >>>>>>>>>>');
		console.log("socket.id : " + socket.id)

		// Step1 找到断线用户对应的用户名（需先登录房间）
		var disconnect_user; // 断开连接（且进入房间）的用户名
		for (let account in sockS) {
			// console.log(account);
			if (sockS[account] == socket) {
				disconnect_user = account;
			}
		}

		if (!disconnect_user) { // 如果用户在房间内没找到，说明没进入房间，只是访问了网页
			console.log("not enter in any room, to be disconnected");
			socket.disconnect(true); // 直接断开连接
			console.log("-------------------------------------");
			return;
		}

		// Step2 将断线用户从房间排除
		for (let roomid in users) {
			// console.log("room: " + roomid)
			var ret = checkUserInRoom(roomid, disconnect_user); // 判断当前用户是否在当前房间
			if (ret == 0) { // 找到了该离线用户所在房间
				console.log("send disconnect msg to " + roomid)
				// io.to(roomid).emit('userDisconnect'); 

				// (1)去掉离线用户对应的socket对象
				if (sockS[disconnect_user]) {
					// console.log(sockS[disconnect_user] == socket);  // true
					sockS[disconnect_user].disconnect(true); // 关闭该socket连接(true表示彻底关闭，否则它只是断开命名空间）
					delete sockS[disconnect_user]; // 移除一个用户对应的socket对象
				}

				// (2)将该用户从该房间的用户列表中清除去
				users[roomid] = users[roomid].filter(v => v.id !== socket.id);

				// (3)找到该用户所在的房间，然后给房间其他用户发送断线消息，可做必要的逻辑操作，例如视频自动挂断等
				socket.to(roomid).emit("1v1UserDisconnect", roomid, disconnect_user, users[roomid]); // 发出断线通知给房间其他用户
			}
		}

		printUserList();
		printSockSList();
	});


	// 打印当前用户列表信息
	function printUserList() {
		console.log("-------------------------------------");
		console.log("current userlist: ");
		console.log("users.len = " + Object.keys(users).length); // 房间个数（每个房间保存若干用户）
		console.log(users);
		/*
			{
			  room1: [
				{ account: '1', id: 'B79i3loBZoS8rSEsAAAL' },
				{ account: '2', id: 'diYHBc53URDcDgyxAAAH' },
				{ account: '3', id: 'B79i3loBZoS8rSEsAAAL' }
			  ]
			}
		*/
		console.log("-------------------------------------");
	}


	// 打印当前SockS套接字列表信息
	function printSockSList() {
		console.log("-------------------------------------");
		console.log("current sockSlist: ");
		console.log("sockS.len = " + Object.keys(sockS).length); // 打印当前保存的socket连接个数
		for (let k in sockS) console.log(sockS[k].id); // 打印套接字id
		console.log("-------------------------------------");
	}


	// 判断当前用户是否在房间
	var checkUserInRoom = function (roomid, account, cbFn) {
		// 先要判断下是否存在该房间数组对象
		if (users[roomid]) {
			let arr = users[roomid].filter(v => v.account === account);
			// console.log(arr);
			if (!arr.length) { // 如果用户不在房间
				if (cbFn) {
					cbFn({
						"code": -1,
						"msg": "user " + account + " is not existed in " + roomid
					});
				}
				return -1;
			}
		} else { // 如果不存在房间数组对象
			if (cbFn) cbFn({
				"code": -1,
				"msg": "there is no create room: " + roomid
			}); // 没创建房间
			return -2;
		}

		return 0;
	}

});
