/**
 * 国光点对点在线音视频SDK库
 * Author: yangsu
 * version: 1.0
 */
class GGRtcClient {
	
	// 摄像头像素
	static g_pixel_mode = [
		{ type : "qvga-240P", desc : "普通", pixel : { "width" : 320, "height" : 240 } },
		{ type : "sd-480P",   desc : "标清", pixel : { "width" : 640, "height" : 480 }, default : true},  // 默认
		{ type : "hd-720P",   desc : "高清", pixel : { "width" : 1280, "height" : 720 } }
	];
	
	// ice通信服务配置
	// 纯内网使用
	// static _iceConfig = null;
	// NAT场景使用
	static g_iceConfig = {"iceServers": [
	 	{"url": "stun:stun.l.google.com:19302"},
	 	{"url": "turn:106.12.24.238", "username": "yangsu", "credential": "123456"}
	]};
	
    // 构造函数
    constructor(options) {
    	console.log("入参options", options);
    	
    	// RTCPeerConnection对象
    	this._peer = null;     
    	
    	// 信令服务器的地址(如：https://127.0.0.1:8443)
    	this._SignalServerAddr = options.SignalServerAddr || "";
    	
    	// ===================== 主要参数 =======================
    	this._offerOption = {offerToReceiveAudio: 1, offerToReceiveVideo: 1};  // offer参数，如果只有语音，那offerToReceiveVideo为0
    	this._constraints = options.constraints;   // 音视频流初始化约束入参(重要)
    	if(options.muteVideo) { // 如果不使用视频
    		this._offerOption = {offerToReceiveAudio: 1, offerToReceiveVideo: 0}; 
    		this._constraints.video = false;
    	}
    	
    	this._room = options.roomId;      // 房间号
		this._localUser = options.userId; // 本地用户名
		this._remoteUser = "";            // 远端用户名
		this._calleeUser = "";            // 被呼叫端用户名
		this._callerUser = "";            // 呼叫发起用户名
		
		this._local_stream_video = options.local_stream_play_video;      // 本地视频流dom(<video>标签id)
		this._remote_stream_video = options.remote_stream_play_video ;   // 远端视频流dom
		this._remote_share_stream_video = options.remote_share_stream_play_video || "share";  // 远端分享流dom
        
		this._localstream = null;         // 本地音视频流对象
		this._localShareStream = null;    // 本地分享流对象
    	
		this._localstream_id = "";        // 本地视频流id
		this._localShareStream_id = "";   // 本地分享流id
		
		this._remotestream_id = "";       // 对端视频流id（通过1v1offer传递）
		this._remoteShareStream_id = "";  // 对端分享流id（通过1v1offer传递）
		
		this._mediaRecorder = null;     // 录制操作对象
		this._recBuffer = null;         // 录制内容的缓存（数组）
		
		this._disableRateMonitor = options.disableRateMonitor || false;  // 是否禁用流量监控机制
		this._showStatInterval = null;  // 显示收发数据状态的定时器对象
        

        // ===================== 辅助参数 =======================
        this._isJoinRoom = false;    // 当前用户是否进入了房间
        this._isCalling = false;     // 当前用户是否在通话中
        
        
        // ===================== 参数校验 =======================
        if(!this._room) {
			throw new Error("未指定房间号roomId参数");
		}
        if(!this._localUser) {
			throw new Error("未指定用户userId参数");
		}
        if(!this._local_stream_video || !this._remote_stream_video) {
			throw new Error("未指定本地视频或对端视频的<video>标签参数");
		}
        
        
        // ===================== 运行准备 =======================
        console.log("this._SignalServerAddr", this._SignalServerAddr);
        this._socket = io(this._SignalServerAddr);  // 不带参数会开启自动发现
        
        // 回调函数方法库（本类内部使用）
		this.callbackFunc = options.callback || {};
        this.initSocket(this.callbackFunc);  // 初始化Socket各种绑定事件
    }
    
    
    // 初始化Socket
    // 入参：callbackFunc - 回调函数对象（多个，初始化本类时传入）
    initSocket(callbackFunc) {
    	
    	// ================================== 信令消息处理部分 ============================================
		// 接收其他用户加入房间消息（自己要先进入房间）
		this._socket.on('joined', (userlist, account, socketid) => {
			console.log("【服务端joined消息】用户" + account + "进入房间");
			console.log("当前用户列表：", userlist);
			// 回调前端方法
			let cbFuncName = "onAnotherUserJoin";
			if(callbackFunc[cbFuncName]) {
				callbackFunc[cbFuncName](account, userlist);
			}
		});
		
		
		// 监听broadcastMsg广播事件，用来接收其他用户推送的消息
		this._socket.on("broadcastMsg", (data) => {
			console.log("【服务端broadcastMsg消息】" + JSON.stringify(data)); 
			// 回调前端方法
			// data格式：{"roomid":"room1","account":"user_1990724","message":"222"}
			let cbFuncName = "onBroadcastMsg";
			if(callbackFunc[cbFuncName]) {
				callbackFunc[cbFuncName](data);
			}
		});
		
		
		// 接收其他用户离开房间消息（自己要在房间里）
		this._socket.on('leaved', (userlist, account, socketid) => {
			console.log("【服务端leaved消息】用户" + account + "离开房间");
			// 回调前端方法
			let cbFuncName = "onAnotherUserLeave";
			if(callbackFunc[cbFuncName]) {
				callbackFunc[cbFuncName](account, userlist);
			}
		});
		
		
		//（被呼叫端）收到呼叫请求消息
		this._socket.on('call', async (data) => {
			console.log("【服务端call消息】入参：" + JSON.stringify(data));  // {"roomid":"room1","callee":"2","caller":"1"}
			// 回调前端方法
			let cbFuncName = "onCall";
			if(callbackFunc[cbFuncName]) {
				callbackFunc[cbFuncName](data, this._isCalling);
			}
		});
		
		
		//（主叫端）收到对端的呼叫响应回复
		this._socket.on('reply', async (data) => { // 收到回复
			console.log("【服务端reply消息】:" + JSON.stringify(data));  // {"roomid":"room1","callee":"2","caller":"1","type":1}
			switch (data.replyCode) {
				case 1: // 同意
					// 对端（被呼叫端）同意后，本端（呼叫端）保存相应的用户信息
					//this._room = data.roomid;        // 房间号
					this._callerUser = data.caller;  // 呼叫端
					this._calleeUser = data.callee;  // 被呼叫端
					this._remoteUser = data.callee;  // 保存远端用户名（被呼叫端）

					// 对方同意之后创建自己的peer，开启并添加视频到peer
					await this._createP2P(data);
					
					// 给对方发送offer
					await this._createOffer(data, "camera", this._localstream.id);
					
					// 当前处于通话状态
					this._isCalling = true;
					break;
					
				case 2: // 拒绝
					alert("对方拒绝了你的请求！");
					break;
					
				case 3: // 正在通话中
					alert("对方正在通话中！");
					break;
			}
			
			// 回调前端方法
			let cbFuncName = "onReply";
			if(callbackFunc[cbFuncName]) {
				callbackFunc[cbFuncName](data, this._isCalling);
			}
		});
		

		// 远端用户静音/静视设置消息（开启或解除静音/静视）
		this._socket.on("1v1mute", (data) => {
			console.log("【服务端1v1mute消息】:" + JSON.stringify(data));
			// 回调前端方法
			let cbFuncName = "onRemoteMute";
			if(callbackFunc[cbFuncName]) {
				callbackFunc[cbFuncName](data, this._isCalling);
			}
		});
		
		
		// 远端用户发来挂断消息
		this._socket.on("1v1hangup", (data) =>  {
			console.log("【服务端1v1hangup消息】:" + JSON.stringify(data));
			// 本端也挂断
			console.log("远端主动挂断，本地也自动挂断操作");
			this._doHangup();
			
			// 回调前端方法
			let cbFuncName = "onRemoteHandup";
			if(callbackFunc[cbFuncName]) {
				callbackFunc[cbFuncName](data, this._isCalling);
			}
		});
		
		
		// 房间其他用户断线消息（对应点对点通信来说，收到该消息就执行挂断操作）
		this._socket.on("1v1UserDisconnect", (roomid, disconnect_user, userlist) => {
			console.log("【服务端1v1UserDisconnect消息】" + roomid + ":" + disconnect_user);
			// 本端自动挂断
			console.log("远端断线，本地自动挂断");
			this._doHangup();  // 本端也挂断
			
			// 回调前端方法
			let cbFuncName = "onRemoteDisconnect";
			if(callbackFunc[cbFuncName]) {
				callbackFunc[cbFuncName](roomid, disconnect_user, userlist);
			}
		});
		
		
		// 对方本地桌面分享状态通知
		this._socket.on("shareLocal", (data) => {
			console.log("【服务端shareLocal消息】" + JSON.stringify(data));
			if(data.op == "share") {  // 对方开启桌面分享
			}
			else if(data.op == "unshare") {  // 对方停止桌面分享
				let share = document.querySelector('#' + this._remote_share_stream_video);
				share.srcObject = null;  // 清除本地video标签的显示（变成默认的黑色背景）
				console.log("清除本地分享流video标签的显示");
			}
			
			// 回调前端方法
			let cbFuncName = "onRemoteShare";
			if(callbackFunc[cbFuncName]) {
				callbackFunc[cbFuncName](data.op, data);
			}
		});
		
		
		// 对方切换摄像头通知
		this._socket.on("changeCamera", (data) => {
			console.log("【服务端changeCamera消息】" + JSON.stringify(data));
			
			// 回调前端方法
			let cbFuncName = "onRemoteChangeCamera";
			if(callbackFunc[cbFuncName]) {
				callbackFunc[cbFuncName](data, this._isCalling);
			}
		});
		
		
		
		// ======================== 媒体协商函数操作部分 ==========================
		// 接收到 offer（被呼叫端）
		this._socket.on('1v1offer', (data) => {
			console.log("【服务端1v1offer消息】:" + JSON.stringify(data));
			this._onOffer(data);
		});
		
		
		// 接收到 answer（呼叫端）
		this._socket.on('1v1answer', (data) => {
			console.log("【服务端1v1answer消息】:" + JSON.stringify(data));
			this._onAnswer(data);
		});
		
		
		// 接收到 ICE（相互）
		this._socket.on('1v1ICE', (data) => {
			console.log("【服务端1v1ICE消息】:" + JSON.stringify(data));
			this._onIce(data);
		});
		
		
    	// ===================================  其他常规处理函数 ==================================
		// 连接成功后执行该函数
		this._socket.on('connect', () => {
		    console.log("connect 连接服务端成功");
		});

		// 连接错误触发事件处理器
		this._socket.on('connect_error', (error) => {
		    console.log("connect_error");
		});

		// 与服务端的连接断开
		this._socket.on('disconnect', () => {
		    console.log("disconnect");
		});
		
		// 成功的重连时触发时间处理器
		this._socket.on('reconnect', (timeout) => {
		    console.log("reconnect");
		});
		
		// 重连错误时触发时间处理器
		this._socket.on('reconnect_error', (timeout) => {
		    console.log("reconnect_error");
		});
    }
    
    
    
    // ================================= 客户端可调用操作 ======================================
    
    // 类方法 - 监测是否支持WebRTC
    static CheckSupportWebRTC() {
    	if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
			alert("您的浏览器不支持WebRTC");
			return false;
		}
    	return true;
    }
    
    
    // 类方法 - 获取设备访问权限
    static async getPermissions() {
    	// 获取权限
		console.log("========== 获取权限 ===========");
		let stream = await navigator.mediaDevices.getUserMedia({audio: true,  video: true});
		let tracks = stream.getTracks();
		tracks.forEach(item => {
			//console.log(item);       // 音视频流轨道对象
			//console.log(item.kind);  // video audio
			//console.log(item.getCapabilities());  // 音视频流轨道对象的能力信息
			item.stop();
		});
		stream = null;
    }
    
    
    // 类方法 - 静态方法：本机摄像头/麦克风设备信息获取
    // 回调客户端方法，方便添加到下拉框等操作
    static async GetInitLocalDevices(callback) {
		// 列出相机和麦克风
		await navigator.mediaDevices.enumerateDevices()
		.then(devices => {
			if(callback) callback(devices);  // 回调应用层
			devices.forEach(dev => {
			    console.log('device label: ' + dev.label + ' deviceId: ' + dev.deviceId);
			});
		})
		.catch(function (err) {
			console.log(err.name + ": " + err.message);
		});
    }
    
    
    // 类方法 - 绑定设备变更事件(客户端定义)
    static bindOnDeviceChange(bindFunc) {
    	if(!bindFunc)  
    		bindFunc = function(event) {
			  console.log("device changed")
		};
    	// 设备变更(插拔媒体设备会触发)
		navigator.mediaDevices.ondevicechange = bindFunc;
    }
    
    
    // 加入房间（信令）
	// callback - 前端回调函数
    join(callback) {
    	// 入参设置
    	let jsonDataObj = {"roomid": this._room, "account": this._localUser};
    	console.log("join jsonDataObj ==>", jsonDataObj);
    	
    	// 发送加入房间请求
		this._socket.emit('join', jsonDataObj, callback);
		
		// 加入房间标志
		this._isJoinRoom = true;
    }
    
    
    // 离开房间（信令）
	// callback - 前端回调函数
    leave(callback) {
    	// 入参设置
    	let jsonDataObj = {"roomid": this._room, "account": this._localUser};
    	console.log("leave jsonDataObj ==>", jsonDataObj);
    	
    	// 如果当前已经建立通话，则先挂断连接
		if(this._isCalling)  {
			console.log("挂断与" + this._remoteUser + "的连接");
			this._socket.emit('1v1hangup', this._createMsg());  // 发出通知消息
			this._doHangup();  // 挂断处理
		}
		
    	// 发送离开房间请求
    	// callback的回调消息格式：{"code":0,"msg":"user_9328986 exited from room1"}
		this._socket.emit("leave", jsonDataObj, callback);
		
		// 清空本地用户变量
		this._localUser = null;
		
		// 离开房间标志
		this._isJoinRoom = false;
    }
    
    
    // 对房间用户发送聊天消息（信令）
    // msg - 发送的消息文本
	// callback - 前端回调函数
    sendChatMessage (msg, callback) {
    	if(!msg) throw new Error("发送消息不能为空");
    		
    	// 入参设置
    	let jsonDataObj = {"roomid": this._room, "account": this._localUser, "message": msg};
    	console.log("sendChatMessage jsonDataObj ==>", jsonDataObj);
    	
    	// 判断是否进入房间
    	if(!this._checkJoinRoom()) return;
    	
    	 // 发送
		this._socket.emit('chatMessage', jsonDataObj, callback);
    }
    
    
    // 挂断（信令）
	// callback - 前端回调函数
    hangup(callback) {
    	// 判断状态
    	if(!this._checkIsCalling()) return;
		
    	console.log("挂断与" + this._remoteUser + "的连接");
		this._socket.emit('1v1hangup', this._createMsg());  // 发出信令消息
		this._doHangup();  // 本地挂断处理
		if(callback) callback();  // 如果有客户端回调函数则执行
    }
    
    
    // 呼叫对端（信令）
    // callee - 被呼叫的用户名
    // callback - 前端回调函数
    call(callee, callback) {
    	if(!callee) throw new Error("被呼叫用户名参数callee不能为空");
    	if(this._localUser === callee) throw new Error("不能跟自己进行视频会话");
    	
    	// 入参设置（caller-主动呼叫端用户名）
    	let jsonDataObj = {"roomid": this._room, "caller": this._localUser, "callee": callee};
    	console.log("call jsonDataObj ==>", jsonDataObj);
    	
    	// 判断是否进入房间
    	if(!this._checkJoinRoom()) return;
    	
    	// 发出信令消息
		this._socket.emit('call', jsonDataObj, callback);
    }
    
    
    // （被呼叫端）主动响应对方的视频呼叫（信令）
    async reply(data) {
    	// 判断是否进入房间
    	if(!this._checkJoinRoom()) return;
    	
    	console.log("reply ==> ", data); // {roomid: "room1", callee: "user_93", caller: "user_12", replyCode: 1}
    	
    	// 如果接受呼叫（1-同意，2-拒绝，3-已经在通话中）
    	if(data.replyCode == 1) {
    		// 置通话中标志位为true
    		this._isCalling = true;
    		
    		// 保存一些变量信息
    		this._calleeUser = data.callee;  // 被呼端用户
			this._callerUser = data.caller;  // 呼叫端用户
			this._remoteUser = data.caller;  // 远端用户（接受call呼叫时，远端用户为主呼叫方的账号）
			
			// 开始创建P2P连接
    		await this._createP2P(data);
    	}
    	
    	// 发出信令消息
    	this._socket.emit('reply', data);
    }
    
    
    // 静音（信令）
    // flag：true-静音, false-解除静音
    muteAudio(flag) {
    	// 判断状态
    	if(!this._checkIsCalling()) return;
    	
    	// 设置操作
    	this._doMute ("audio", !flag);
    	
    	// 给对端发静音操作消息
		var data = {"type": "audio", "op": (flag ? "mute" : "unmute")};
		this._socket.emit('1v1mute', this._createMsg(data));  // 发出通知消息
    }
    
    
    // 静视（信令）
    // flag：true-静视, false-解除静视
    muteVideo(flag) {
    	// 判断状态
    	if(!this._checkIsCalling()) return;
    	
    	// 设置操作
    	this._doMute ("video", !flag);
    	
    	// 给对端发静音操作消息
		var data = {"type": "video", "op": (flag ? "mute" : "unmute")};
		this._socket.emit('1v1mute', this._createMsg(data));  // 发出通知消息
    }
    
    
    // 切换摄像头的具体操作
	async doChangeCamera () {
		// 判断状态
		if(!this._checkIsCalling()) return;
		
		console.log("切摄像头流");
		
		// Step1 发本地切换摄像头消息给对端
		this._socket.emit("changeCamera", this._createMsg());
		
		// Step2 移除和停止当前(摄像头视频)流
		if(this._localstream) {
			// 停止当前视频流信道
			let tracks = this._localstream.getTracks();
			// console.log("track", tracks);
			tracks.forEach(item => {
				// console.log(item);       // 音视频流轨道对象
				// console.log(item.kind);  // video audio
				// console.log(item.getCapabilities());  // 音视频流轨道对象的能力信息
				item.stop();
				item.enabled = false;
				item = null;
			});
			
			this._localstream = null;
		}
		
		// Step3 重新生成新的本地流
		await this._createAndPlay_localstream(this._local_stream_video);
		
		// Step3 从peer中获得RTCRtpSender对象，然后调用replaceTrack方法直接替换轨道信号源
		// 注意在此前不能执行this._peer.removeStream(g_localstream)，否则取不到RTP发送对象
		// console.log("==>", this._peer.getSenders());  // 一般是两个发送对象，一个是音频，另一个是视频
		// 视频发送器
		let vsender = this._peer.getSenders().find(sender => {
				if(sender.track) {
					return sender.track.kind === 'video';
				}
			}
		);
		// 音频发送器
		let asender = this._peer.getSenders().find(sender => {
				if(sender.track) {
					return sender.track.kind === 'audio';
				}
			}
		);
		
		// 轮询本地流的音视频轨道，分别用相应的发送器进行信号替换即可
		this._localstream.getTracks().forEach(track => {
			// console.log("track.id = " + track.id);
			if(track.kind == "video") {
				console.log("切换摄像头信号");
				vsender.replaceTrack(track);
			}
			else if(track.kind == "audio") {
				console.log("切换麦克风信号");
				asender.replaceTrack(track);
			}
		});
		
		/* 
		// 以下是我最开始用的方法，但是这种方法需要重新做媒体协商，
		// 后来用了上述的RTCRtpSender的replaceTrack方法，经研究发现_peer.removeStream执行之后，
		// 就获取不到RTCRtpSender对象，我理解就是执行之后，连媒体信息轨信息收发器也一起给释放了
		// Step2 移除和停止当前(摄像头视频)流
		if(this._localstream) {
			// 从peer对象中移除现有摄像头视频流对象(不执行则chrome浏览器会报错)
			this._peer.removeStream(this._localstream);
			// this._peer.removeStream(_localShareStream);  // 视频分享流不用清除，因为没有变化
			
			// 停止当前视频流信道
			let tracks = this._localstream.getTracks();
			// console.log("track", tracks);
			tracks.forEach(item => {
				// console.log(item);       // 音视频流轨道对象
				// console.log(item.kind);  // video audio
				// console.log(item.getCapabilities());  // 音视频流轨道对象的能力信息
				item.stop();
				item.enabled = false;
				item = null;
			});
			
			this._localstream = null;
		}
		
		// Step3 重新生成新的本地流
		await this._createAndPlay_localstream(this._local_stream_video);
		
		// Step4 将新流添加到peer
		if(this._peer) {
			console.log("发送视频流信息到远端");
			this._peer.addStream(this._localstream);  // 发送摄像头视频流
		}
		
		// Step5 创建新的offer（从切换视频端发出）
		this._createOffer(this._createMsg(), "camera", this._localstream.id);
		*/
	};
	
	
	// 修改码率
    // bw-码率值，例如125、500等整数,单位kbps
    async doChangeBandwidth (bw) {
    	// 判断状态
		if(!this._checkIsCalling()) return;
    	if(!this._peer || !bw) return;
    	
    	// console.log(this._peer.getSenders());
		var vsender = this._peer.getSenders().find(sender => {
			if(sender.track) {
				return sender.track.kind === 'video';
			}
		});
		
		var parameters = vsender.getParameters();
		if(!parameters.encodings) {
			parameters.encodings = [{}];	
		}
	
		if(bw === 'unlimited') {
			console.log("delete parameters.encodings[0].maxBitrate");
			delete parameters.encodings[0].maxBitrate;
		} else {
			parameters.encodings[0].maxBitrate = bw * 1024;	
		}
	
		await vsender.setParameters(parameters);
    }
	
	
	// 开始分享桌面（信令）
	doLocalShare () {
		// 判断状态
		if(!this._checkIsCalling()) return;
		
		// 执行操作
		this._doLocalShare();
		
		// 发出通知消息
		var data = { "type" : "video", "op" : "share" };
		this._socket.emit('shareLocal', this._createMsg(data));
		// {"type":"video","op":"share","from":"user_68","to":"user_58","callee":"user_58","caller":"user_68"}
	}
	
	
	// 停止分享桌面（信令）
	stopLocalShare () {
		// 判断状态
		if(!this._checkIsCalling()) return;
		
		// 执行操作
		this._stopLocalShare();
		
		// 发出通知消息
		var data = { "type" : "video", "op" : "unshare" };
		this._socket.emit('shareLocal', this._createMsg(data));
		// {"type":"video","op":"unshare","from":"user_68","to":"user_58","callee":"user_58","caller":"user_68"}
	}


	// 开始录制
	startRecord () {
		console.log("开始录制");
		this._startRecord();
	}
	
	// 停止录制
	stopRecord () {
		console.log("停止录制");
		this._stopRecord();       
	};
	
	// 播放录制
	// videoDomId - video标签的id
	playRecord (videoDomId) {
		console.log("播放录制");
		this._playRecord(videoDomId);
	}
	
	// 保存录制
	saveRecord() {
		console.log("保存录制");
		this._saveRecord();
	}
    
    // ================================== 相关操作的逻辑实现 ============================================
	
	// 进房检测
	_checkJoinRoom () {
		// 判断状态
		if(!this._isJoinRoom) {
			alert("系统提示：未加入房间！");
			return false;
		}
		return true;
	}
	
	
	// 通话中状态检测
	_checkIsCalling () {
		// 判断状态
		if(!this._isCalling) {
			alert("系统提示：请先建立视频通话！");
			return false;
		}
		return true;
	}
		
		
	// 创建本地流并播放到video标签
	async _createAndPlay_localstream (domID) {
		console.log("_createAndPlay_localstream ==> ", domID);
		this._localstream = await navigator.mediaDevices.getUserMedia(this._constraints);
		this._localstream_id = this._localstream.id;
		console.log("本地流对象", this._localstream);
		this._localstream.getTracks().forEach(track => {
			console.log("******************");
			console.log(track);
			console.log("track.id = " + track.id);
			console.log("track.kind = " + track.kind);
			console.log("******************");
		});
		
		let video = document.querySelector("#" + domID);
		video.srcObject = this._localstream;
		video.play();  // 苹果手机微信需要主动调用play(),不会触发onloadedmetadata,需要点击开始播放才会触发
		
		// 如果video标签未设置autoplay，则需要下面代码
		//video.onloadedmetadata = function (e) {    
		//	video.play();
		//};
		
		// window.stream = this._localstream; // 将stream变量放入全局中
		// window.stream = video.srcObject;  // 也可以
	}
	
		
	// 创建P2P连接
	async _createP2P (data) {
		console.log("执行createP2P");
		await this._createMedia(data);
	}

		
	// 创建媒体流，并在本地播放
	async _createMedia (data) {
		console.log("执行createMedia");
		// 保存本地流到全局
		try {
			console.log("_constraints = " + JSON.stringify(this._constraints));
			await this._createAndPlay_localstream(this._local_stream_video);
		} catch (e) {
			console.error('getUserMedia: ', e)
		}
		
		this._initPeer(data); // 获取到媒体流后，调用函数初始化RTCPeerConnection
	}
		
	
	// 初始化RTCPeerConnection
	_initPeer (data) {
		console.log("执行initPeer");  // {"roomid":"room1","callee":"2","caller":"1","type":1}

		// 创建输出端 PeerConnection
		let PeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
		
		// ice通信服务配置
		// 纯内网使用
		// console.log("GGRtcClient.g_iceConfig", GGRtcClient.g_iceConfig);
		this._peer = new PeerConnection(GGRtcClient.g_iceConfig);
		// console.log("_peer", _peer);
		
		console.log("stream.id = " + this._localstream.id);
		// 方法1：
		this._peer.addStream(this._localstream); // 添加本地流（目前这个也可以，不过据说后续会废弃）
		// 方法2：
		/*
		this._localstream.getTracks().forEach(track => {
			console.log("******************");
			console.log(track);
			console.log("track.id = " + track.id);
			console.log("track.kind = " + track.kind);
			console.log("******************");
			this_peer.addTrack(track, this._localstream);
		});
		*/
		
		// 监听ICE候选信息 如果收集到，就发送给对方
		this._peer.onicecandidate = (event) => {
			console.log("peer.onicecandidate");
			console.log(event);
			if (event.candidate) {
		    var data = {};
				data.sdp = event.candidate;
				this._socket.emit('1v1ICE', this._createMsg(data)); // ice信息需要双方交换，为了确定双发的往来关系，需增加from和to变量
			}
		};
		
		// 媒体流接入会触发
		// 官方定义：该event对象将在MediaStreamTrack被创建时或者是关联到已被添加到接收集合的RTCRtpReceiver对象中时被发送
		this._peer.ontrack = (event) => {
			console.log("peer.ontrack");
			console.log(event);
		};
		
		// 监听是否有媒体流接入，如果有就赋值给 rtcB 的 src
		this._peer.onaddstream = (event) => {
			console.log("_peer.onaddstream");
			console.log(event.stream);
			
			console.log("_remotestream_id = " + this._remotestream_id);
			console.log("_remoteShareStream_id = " + this._remoteShareStream_id);
			
			// 打印流信道信息
			event.stream.getTracks().forEach(track => {
				console.log("******************");
				console.log(track);
				console.log("track.id = " + track.id);
				console.log("track.kind = " + track.kind);
				console.log("******************");
			});
			
		    // 判定当前流的id值是摄像头视频流还是屏幕分享流
			switch(event.stream.id) 
			{
				case this._remotestream_id:
					console.log("摄像头流");
					let video = document.querySelector('#' + this._remote_stream_video);
					video.srcObject = event.stream;
					video.play();  // 苹果手机微信需要主动调用play(),不会触发onloadedmetadata,需要点击开始播放才会触发
					// 如果video标签未设置autoplay，则需要下面代码
					//video.onloadedmetadata = function (e) {
					//	video.play();
					//};
					break;
					
				case this._remoteShareStream_id:
					console.log("桌面分享流");
					// console.log("this._remote_share_stream_video", this._remote_share_stream_video);
					let share = document.querySelector('#' + this._remote_share_stream_video);
					share.srcObject = event.stream;
					share.play();
					// 如果video标签未设置autoplay，则需要下面代码
					//share.onloadedmetadata = function (e) {
					//	share.play();
					//};
					break;
					
				default:
					console.log("未知流id");
			}
		};
		
		// 需要做ICE协商时触发
		/*
		   一般是如下情况：
		   1.媒体流被添加到RTCPeerConnection中
		   2.连接已经建立但是网络环境发生了变化，为了适应新的网络而调用了restartIce()方法
		*/
		this._peer.onnegotiationneeded = async (event) => {
			if(!this._peer) return;
			console.log("+++ _peer.onnegotiationneeded +++");
			console.log("_peer.iceConnectionState = " + this._peer.iceConnectionState);
			// 首次：_peer.iceConnectionState = new
			if(this._peer && this._peer.iceConnectionState === "failed")  {
				await this._createOffer(this._createMsg());
			}
		};
		
		// ice连接状态变更事件
		this._peer.oniceconnectionstatechange = (event) => {
			if(!this._peer) return;
			console.log("_peer.oniceconnectionstatechange", this._peer.iceConnectionState);
			/*
				"new": ICE 代理正在搜集地址或者等待远程候选可用。
				"checking": ICE 代理已收到至少一个远程候选，并进行校验，无论此时是否有可用连接。同时可能在继续收集候选。
				"connected": ICE代理至少对每个候选发现了一个可用的连接，此时仍然会继续测试远程候选以便发现更优的连接。同时可能在继续收集候选。
				"completed": ICE代理已经发现了可用的连接，不再测试远程候选。
				"failed": ICE候选测试了所有远程候选没有发现匹配的候选。也可能有些候选中发现了一些可用连接。
				"disconnected": 测试不再活跃，这可能是一个暂时的状态，可以自我恢复。
				"closed": ICE代理关闭，不再应答任何请求。
			*/
		    // 我测试的执行顺序是 checking -> connected -> completed
			// Ice连接状态变为failed时，调用restartIce方法，会主动触发onnegotiationneeded事件
			if(this._peer && this._peer.iceConnectionState === "failed") {
				console.log("网络发生变化，需要重新ice协商");
				// this._peer.restartIce();
			}
		};
		
		// WebRTC连接状态变更事件
		this._peer.onconnectionstatechange = (event) => {
		    // connecting -> connected
			if(!this._peer) return;
			
			console.log("_peer.onconnectionstatechange", this._peer.connectionState);
			if(!this._peer) console.log("WebRTC连接状态变更，但是_peer已注销");
			switch (this._peer.connectionState) {
			    case 'connected' :
			        const config = this._peer.getConfiguration();
			        console.log("*** Connection Configuration: " + JSON.stringify(config));
			        
			        console.log("开启实时码率显示");
			        this._showStats();
			        
			        // 回调前端方法 - 视频P2P2握手连接完成
					let cbFuncName = "onP2PConnectCompleted";
					if(this.callbackFunc[cbFuncName]) {
						this.callbackFunc[cbFuncName]();
					}
			       
			        break;
					
			    case 'disconnected':
			        break;
					
			    case 'failed' :
			        console.warn("Connection failed, now restartIce()...");
							console.log("_peer == null "  + (this._peer == null));
							console.log(this._peer);
					
							// ICE重启(调用restartIce方法，会主动触发onnegotiationneeded事件)
							// 之所以判断是否有restartIce方法，是因为我发现QQ浏览器不支持
							if(this._peer.restartIce) this._peer.restartIce();
							// 10秒后，判断iceConnectionState，如果不是connected，则
					   		setTimeout(()=> {
							    if(this._peer.iceConnectionState !== 'connected') {
								  console.error("restartIce failed! close video call! Connection state:" + this._peer.connectionState); // 断网状态下是：failed
								  this._doHangup();  // 主动执行挂断
								}
							}, 10000);
					    break;
			  }
		};
		
		console.log("执行initPeer完毕");
	}
	
	
	// （呼叫端）创建并发送offer（给被呼叫端）
	// streamType-媒体流类型(camera-摄像头，share-分享流)，streamId-流id，用于对端确认流类型做不同的显示处理
	async _createOffer(data, streamType, streamId) {
		console.log("执行createOffer");  
		console.log(data); // {"roomid":"room1","callee":"2","caller":"1","type":1}
		try {
			// 创建offer
			let offer = await this._peer.createOffer(this._offerOption);
			// 呼叫端设置本地 offer 描述
			await this._peer.setLocalDescription(offer);
			data = this._createMsg(data);
			// 给对方发送 offer
			data.sdp = offer;
			// 媒体流
			if(streamType) data.streamType = streamType;
			if(streamId) data.streamId = streamId;
			console.log("准备发送1v1offer:" +　JSON.stringify(data));
			this._socket.emit('1v1offer', data);
		} catch (e) {
			console.error('createOffer: ', e);
		}
	}
	
	
	// 创建消息体
	_createMsg (data) {
		var msg = data || {};
		msg.roomId = this._room;
		msg.from = this._localUser;
		msg.to = this._remoteUser;
		msg.callee = this._calleeUser;
		msg.caller = this._callerUser;
		return msg;
	};
    
    
    // （被呼叫端）接收offer并发送 answer（给呼叫端）
	async _onOffer (data) {
		console.log("执行onOffer：" + JSON.stringify(data));  // { callee: '2', caller: '1', from: '2', to: '1' , sdp: ..}
		
		// 将收到的对端的流id保存起来
		if(data.streamType == "camera") this._remotestream_id = data.streamId;
		else if(data.streamType == "share") this._remoteShareStream_id = data.streamId;
		
		try {
			// 接收端设置远程 offer 描述
			console.log("await peer.setRemoteDescription == begin");
			await this._peer.setRemoteDescription(data.sdp);
			console.log("await peer.setRemoteDescription == end");
			
			// 接收端创建 answer
			console.log("await peer.createAnswer == begin");
			let answer = await this._peer.createAnswer();
			console.log("await peer.createAnswer == end");
			
			// 接收端设置本地 answer 描述
			console.log("await peer.setLocalDescription == begin");
			await this._peer.setLocalDescription(answer);
			console.log("await peer.setLocalDescription == end");
			
			// 将自己的流id和类型给对端发回去
			if(data.streamType == "camera" && this._localstream_id) data.streamId = this._localstream_id;
			else if(data.streamType == "share" && this._localShareStream_id) data.streamId = this._localShareStream_id;
			
			// 给对方发送 answer
			data.sdp = answer;
			console.log("准备发送1v1answer：" + JSON.stringify(data));
			this._socket.emit("1v1answer", data);
		} 
		catch (e) {
			console.error("onOffer: ", e);
		}
	};
	
	
	//（呼叫端）接收answer
	async _onAnswer (data) {
		console.log("执行onAnswer");
		
		if(data.streamType == "camera") this._remotestream_id = data.streamId;
		else if(data.streamType == "share") this._remoteShareStream_id = data.streamId;
		try {
			// console.log(data.sdp)
			await this._peer.setRemoteDescription(data.sdp); // 呼叫端设置远程 answer 描述
		} catch (e) {
			console.error('onAnswer: ', e);
		}
	};
	
	
	//（相互）接收ICE候选
	async _onIce (data) {
		console.log("执行onIce：" + JSON.stringify(data));
		try {
			// console.log(data.sdp);
			await this._peer.addIceCandidate(data.sdp); // 设置远程 ICE
			console.log("执行onIce添加成功");
		} catch (e) {
			console.error('onIce: ', e);
		}
	};
	
	
	// 挂断处理
	_doHangup () {
		console.log("doHangup执行挂断");
		
		// 停止分享本地流
		this._stopLocalShare();
		
		// 停止收发数据状态的定时器对象
		this._clearShowStats();
		
		// 停止本地流的播放
		this._stopLocalStream();
		
		// 关闭RTCPeerConnection对象
		if(this._peer) {
			this._peer.close();
			this._peer = null;
		}
		
		// 清空相关变量
		this._calleeUser = null;
		this._callerUser = null;
		this._remoteUser = null;
	  	this._remotestream_id = null;
		this._remoteShareStream_id = null;
		
		this._isCalling = false;  // 未开启视频会话标志
		// this._isJoinRoom = false; // 离开房间标志（放在leave操作执行较为合适,因为挂断不一定要退房)
	}
	

	// 停止本地流的播放
	_stopLocalStream () {
		if(this._localstream) {
			// 从peer对象中移除现有摄像头视频流对象(不执行则chrome浏览器会报错)
			this._peer.removeStream(this._localstream);
			// this._peer.removeStream(_localShareStream);  // 视频分享流不用清除，因为没有变化
			
			// 停止当前视频流轨道
			let tracks = this._localstream.getTracks(); // stream为MediaStream
			// console.log("track", tracks);
			tracks.forEach(item => {
				// console.log(item);       // 音视频流轨道对象
				// console.log(item.kind);  // video audio
				// console.log(item.getCapabilities());  // 音视频流轨道对象的能力信息
				item.stop();
				item.enabled = false;
				item = null;
			});
			
			this._localstream = null;
			this._localstream_id = null;
		}
	}
	
	
	// 静音/视设置
	// type：video，audio， enabled：true-解除静音/视, false-静音/视
	_doMute (type, enabled) {
		console.log("_doMute", type, enabled);
		var tracks = this._localstream.getTracks();
		tracks.forEach(item => {
			// console.log(item.kind); // video audio
			if (item.kind == type) {
				item.enabled = enabled;
			}
		});
	};


	// 设置分享流的视频内容属性
	// 参考:
	// https://baijiahao.baidu.com/s?id=1711021650424254666&wfr=spider&for=pc
	// https://www.cnblogs.com/qwj-sysu/p/15490288.html
	// https://www.w3.org/TR/mst-content-hint/
	_setVideoTrackContentHints (shareStream, hint) {
		const track = shareStream.getVideoTracks()[0];
		if("contentHint" in track) {
			//console.log("shareStream.videotrack.contentHint = ", track.contentHint);
			track.contentHint = hint;
			console.log("shareStream.videotrack.contentHint = ", track.contentHint);
			if(track.contentHint !== hint) {
				console.log("Invalid video track contentHint:\'" + hint + "\'");
			}
		}
		else {
			console.log("MediaStreamTrack contentHint attribute not supported");
		}
	}


	// 分享本地桌面
	_doLocalShare (videoDomId) {
		// 获取可以显示的媒体
		navigator.mediaDevices.getDisplayMedia({video: true}).then(share_stream => {
			console.log("本地分享流：", share_stream);
			this._localShareStream = share_stream;  // 保存到全局对象
			this._localShareStream_id = share_stream.id;
			// console.log(this._localShareStream);
			
			// 设置视频轨道的流畅度优先模式(保证传输速率)
			// 默认为空,表示让系统去猜测,motion为运动模式,在网络条件差的情况下尽可能保持帧率（忽略质量的丧失)
			// 然后是detail和text
			this._setVideoTrackContentHints(this._localShareStream, "motion"); 
			
			// 在本地显示共享的屏幕
			/*
				let share = document.querySelector('#share');
				share.srcObject = share_stream;
				share.onloadedmetadata = function (e) {
					share.play();
				};
			*/
			
			// 检测用户已停止共享屏幕（经测试,这个是用户点击浏览器自带的停止共享按钮时才触发)
	        share_stream.getVideoTracks()[0].addEventListener('ended', () => {
	            console.log('用户已结束共享屏幕');
	            this.stopLocalShare();  // 这里主动调用一下
	            
	            // 回调前端方法(由于点的是浏览器自带的停止共享按钮,所以这里抛出一个事件)
				let cbFuncName = "onStopLocalShareBySystsem";
				if(this.callbackFunc[cbFuncName]) {
					this.callbackFunc[cbFuncName]();
				}
	        });
	        
      
			// 打印分享流track信息
			console.log("打印分享流track信息");
			share_stream.getTracks().forEach(track => {
				console.log("******************");
				console.log(track);
				console.log("track.id = " + track.id);
				console.log("track.kind = " + track.kind);
				console.log("******************");
				// this._peer.addTrack(track, share_stream);  // 添加分享流视频轨道到g_peer(添加方法1)
			});
			
			console.log("开始推送分享流");
		
			// step1 添加流到g_peer(添加方法2)
		  	this._peer.addStream(this._localShareStream);
			
			// step2 重新创建offer
			this._createOffer(this._createMsg(), "share", share_stream.id);
			
		}).catch(error => {
			console.log(error);
		});
	};
	
	
	// 停止分享本地桌面
	_stopLocalShare () {
	  	console.log("停止并清空分享流");
		if(this._localShareStream) {
			console.log("++++++++++++++++++++========================");
			// 从peer对象中移除现有视频分享流对象(不执行则chrome浏览器会报错)
			this._peer.removeStream(this._localShareStream);
			
			// 停止当前视频分享流信道
			this._localShareStream.getTracks().forEach(item => {
				console.log(item);       // 音视频流轨道对象
				console.log(item.kind);  // video audio
				console.log(item.getCapabilities());  // 音视频流轨道对象的能力信息
				item.stop();
				item = null;
			});
			
			this._localShareStream_id = null;
			this._localShareStream = null;
		}
	};
	
	
	// 实现音视频通话参数-目前显示收发包，定期1秒刷新
	_showStats () {
		// 判断状态
    	if(!this._checkIsCalling()) return;   // 不在视频通话状态,退出
		if(!this._peer) return;               // _peer对象不存在,退出
		if(this._disableRateMonitor) return;  // 如果明确禁用流量监控功能,退出
		if(!this.callbackFunc["onStreamRate"]) return;  // 监控回调方法不存在,退出
		
		var last_receivedTotalBytes = 0;  // 上一次获取到的总接收字节数
		var last_sendTotalBytes = 0;      // 上一次获取到的总发送字节数

		// 先清理一下定时器
		this._clearShowStats();

		// 定时处理
		this._showStatInterval = setInterval(async () => {
			var receivedBytes = 0;  // 本次迭代间隔的接收数据
			var sendBytes = 0;      // 本次迭代间隔的发送数据
			
			// 测试显示一把信息
			var statReportTest = await this._peer.getStats();  // 返回一个map对象，key为每个value对象里的id属性
			// console.log(statReportTest);
			/*
			var it = statReportTest.keys();  // 返回一个Iterator迭代器
			var c = it.next();
			while(!c.done) { // 最后一个迭代器元素的c.done是ture
				console.log("key = " + c.value);
				c = it.next();
			}
			*/
				
			statReportTest.forEach(report => {
				// 查找总的统计信息-通过RTCTransport对象来获取总的收发字节数
				if(report.id.startsWith("RTCTransport")) {
					// console.log(">> report:", report);
					// 本次迭代接收字节数
					receivedBytes = report.bytesReceived - last_receivedTotalBytes;
					last_receivedTotalBytes = report.bytesReceived;
					// 本次迭代发送字节数
					sendBytes = report.bytesSent - last_sendTotalBytes;
					last_sendTotalBytes = report.bytesSent;
				}
			});
			
		  	// 回调前端方法(可供显示)
			this.callbackFunc["onStreamRate"](Math.floor(sendBytes / 1024), Math.floor(receivedBytes / 1024));  // 单位:kpbs
		}, 1000);
	};


	// 清空先前的流量定时显示对象
	_clearShowStats () {
		// 停止收发数据状态的定时器对象
		if(this._showStatInterval) {
			console.log("清理定时器对象");
			clearInterval(this._showStatInterval);
		}
	}
	
	
	// 开始录制
	_startRecord () {
		// 判断状态
		if(!this._checkIsCalling()) return;
		
		this._recBuffer = [];  // 录制内容的缓存(录制前先清空)
		var options = {
			mimeType: "video/webm;codecs=h264"
		};
	
		if(!MediaRecorder.isTypeSupported(options.mimeType)){   
			console.error(options.mimeType + " is not suppported!");
			return;
		}
	
		try {
			//this._mediaRecorder = new MediaRecorder(window.stream, options);
			this._mediaRecorder = new MediaRecorder(this._localstream, options);
		} catch(e) {
			console.error("Failed to create MediaRecoder!");
			return;
		}
	
		// 每次记录一定时间的数据时（如果没有指定时间片，则记录整个数据时)会定期触发。
		this._mediaRecorder.ondataavailable = (e) => {
			if(e && e.data && e.data.size > 0){
				this._recBuffer.push(e.data);
			}
		};
		// 如果不填，则所有的数据会存储到一个大的buffer中，设置了timeslice，则会按timeslice分块存储数据，存为小块的数据
		this._mediaRecorder.start(100);  // timeslice，单位毫秒
	};

	
	// 停止录制
	_stopRecord () {
		if(!this._mediaRecorder) return;
		this._mediaRecorder.stop();       
	};
	
	
	// 播放录制内容
	_playRecord (videoDomId)
	{
		if(!videoDomId) return;
		if(!this._recBuffer) return;
		
		var blob = new Blob(this._recBuffer, {type: 'video/webm'});
		var recvideoplay = document.querySelector("#" + videoDomId);  // rtcREC
		recvideoplay.src = window.URL.createObjectURL(blob);  
		recvideoplay.srcObject = null;    
		recvideoplay.controls = true;   
		recvideoplay.play();  
	}
	
	
	// 保存录制
	_saveRecord() {
		if(!this._recBuffer) return;
		
		var blob = new Blob(this._recBuffer, {type: 'video/webm'});
		var url = window.URL.createObjectURL(blob);
		var a = document.createElement("a");   
		a.href = url;
		a.style.display = "none";   
		a.download = "video.webm";
		a.click();  // 捕获will-download
	}
}