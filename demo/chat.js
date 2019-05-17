var ChatApp = function() {
	var _self = this;

	// create and store an uid for this application for later reuse
	_self.clientUUID = localStorage["clientUUID"];
	if (_self.clientUUID == null) {
		_self.clientUUID = generateUUID();
		localStorage["clientUUID"] = _self.clientUUID;
	}

	//MQTT connection manager setup
	_self.mqttConnectionManager = new MQTTConnectionManager(
										"test.mosquitto.org", 8081, true, "", "",
										10, 25, 0, 2000,
										JSON.stringify({clientUUID:_self.clientUUID}), "/clients/lastwills");
	_self.mqttConnectionManager.onConnectingToTargetServer = function() {
		_self.mqttConnecting(true);
	}
	_self.mqttConnectionManager.onConnectedToTargetServer = function() {
		_self.mqttConnecting(false);
		_self.mqttConnected(true);
		localStorage["connectedToServer"] = true;
		_self.publishStickersInfoToServer(true, true);
		_self.loading(false);
	}

	_self.mqttConnectionManager.onDisconnectingFromServer = function() {
		_self.publishStickersInfoToServer(false, false);
	}
	_self.mqttConnectionManager.onDisconnectedFromServer = function() {
		_self.mqttConnected(false);
		localStorage["connectedToServer"] = false;
		_self.mqttConnecting(false);
	}

	_self.onConnectionMessageArrived = function(message) {
		try {
			console.log("Message arrived: " + message.payloadString);
			stickersInfo = JSON.parse(message.payloadString);
			if (stickersInfo.clientUUID == _self.clientUUID)
				return;

			stickersInfo.timeElapsedInfo = ko.observable(_self.calculateElapsedTime(stickersInfo.time));
			stickersInfo.isOnline = ko.observable(stickersInfo.online);

			//remove previous results from peer
			var index = -1;
			for(var i=0; i<_self.receivedStickersInfo.length; i++) {
				if(stickersInfo.clientUUID==_self.receivedStickersInfo[i].clientUUID) {
					index = i;
					stickersInfo.chatMessages = _self.receivedStickersInfo[i].chatMessages;
					stickersInfo.messages = ko.observableArray(_self.receivedStickersInfo[i].chatMessages);
					break;
				}
			}

			//remove previous results from this peer
			if(index > -1) {
				_self.receivedStickersInfo.splice(index,1);
			}

			_self.receivedStickersInfo.push(stickersInfo);
			_self.recalculateStickersInfoRanking();

			if(_self.viewChat.currentPeer().clientUUID == stickersInfo.clientUUID) {
				_self.viewChat.currentPeer(stickersInfo);
			}

			_self.updateReceivedStickersLocalInfo();
		} catch(e) {
			console.log(e);
		}
	};


	_self.onChatMessageArrived = function(mqttMessage) {
		var chatMessage = JSON.parse(mqttMessage.payloadString);
		var sender = $(_self.receivedStickersInfo).filter(function(){
			return this.clientUUID === chatMessage.fromClient;
		})[0];
		sender.messages.push(chatMessage);
		//sender.chatMessages.push(chatMessage);
		_self.viewChat.showMessage(chatMessage);

		_self.updateReceivedStickersLocalInfo();
	}

	_self.mqttConnectionManager.subscribeToTopic("/main/notclassified", _self.onConnectionMessageArrived);
	_self.mqttConnectionManager.subscribeToTopic("/clients/" + _self.clientUUID + "/connection/peerslist", _self.onConnectionMessageArrived);
	_self.mqttConnectionManager.subscribeToTopic("/clients/" + _self.clientUUID + "/connection/pendingmessages", _self.onChatMessageArrived);
	_self.mqttConnectionManager.subscribeToTopic("/clients/" + _self.clientUUID + "/messages", _self.onChatMessageArrived);

	_self.mqttConnecting =  ko.observable(false);
	_self.mqttConnected =  ko.observable(false);
	// /END OF ____model stuff


	//views ~ <section>
	//Do smart assynchronous publishing
	_self.lastDirtyTime = new Date().getTime();
	_self.stickersUpdateTimerActivated = false;
	_self.handleStickersUpdate = function() {
		var timeSinceLastDirtyUpdate = new Date().getTime()-_self.lastDirtyTime;
		if(timeSinceLastDirtyUpdate > 4000) {
			_self.publishStickersInfoToServer(false, true)
			_self.recalculateStickersInfoRanking();
		} else {
			//if nothing else happens, do the real publishing
			if(!_self.stickersUpdateTimerActivated) {
				window.setTimeout(
					function() {
						_self.publishStickersInfoToServer(false, true)
						_self.recalculateStickersInfoRanking();
						_self.stickersUpdateTimerActivated = false;
					}, 4000);
				_self.stickersUpdateTimerActivated = true;
			}
		}
		_self.lastDirtyTime = new Date().getTime();
	}

	//#1 - needed stickers
	_self.viewNeededStickers = new SelectableItemsViewModel(1, "Figurinhas Faltando", "needed-stickers", _defaultItems1);
	_self.viewNeededStickers.subscribeToChanges(_self.handleStickersUpdate);

	//#2 - available stickers
	_self.viewAvailableStickers = new SelectableItemsViewModel(2, "Figurinhas Repetidas", "available-stickers", _defaultItems2);
	_self.viewAvailableStickers.subscribeToChanges(_self.handleStickersUpdate);

	//#3 - connect form
	_self.viewConnect = new ConnectViewModel(4, "Conectando-se");
	_self.viewConnect.nickname = localStorage["nickname"] === undefined ? ko.observable() : ko.observable(localStorage["nickname"]);
	_self.viewConnect.place = localStorage["place"] === undefined ? ko.observable() : ko.observable(localStorage["place"]);
	_self.viewConnect.selfInfo = localStorage["selfInfo"] === undefined ? ko.observable() : ko.observable(localStorage["selfInfo"]);

	//#4 - list with people in the same neighborhood
	_self.viewNearPeople = new NearPeopleViewModel(5, "Pessoas próximas");

	//#5 - selecting stickers you want and you are giving
	_self.viewExchangingArena = new ExchangingArenaViewModel(6, "Trocando Figurinhas");

	//#6 - Conversando
	_self.viewChat = new ChatViewModel(7, "Conversando", this);

	_self.viewNearPeople.selectedPeer.subscribe(function(newValue) {
		_self.viewChat.currentPeer(newValue);
	});

	// /END OF views ~ <section>

	//section interaction ~ <article>
	//#1 - first time the app is loaded interaction
	selectNeededStickersState = new InteractionModelState(_self.viewNeededStickers, null, "avançar");
	selectAvailableStickersState = new InteractionModelState(_self.viewAvailableStickers, "voltar", "concluir");
	_self.interactionWelcome = new InteractionModel(_self, 1, selectNeededStickersState);
	_self.interactionWelcome.addTransition(selectNeededStickersState, selectAvailableStickersState, "confirm", 1);
	_self.interactionWelcome.addTransition(selectAvailableStickersState, selectNeededStickersState, "cancel", 2);
	_self.interactionWelcome.addTransition(selectAvailableStickersState, null, "confirm", 3, function() {
		_self.firstTimeRunning(false);
		localStorage["firstTimeFlag"] = 0;
	});

	//#2 - checking the stickers needed to complete the collection allowing to mark the ones got to remove them from the list
	selectNeededStickersStateNoAction = new InteractionModelState(_self.viewNeededStickers);
	_self.interactionNeededStickers = new InteractionModel(_self, 2, selectNeededStickersStateNoAction);

	//#3 - checking the stickers that are available to exchange allowing to mark the ones that are no available anymore to remove them from the list
	selectAvailableStickersStateNoAction = new InteractionModelState(_self.viewAvailableStickers);
	_self.interactionAvailableStickers = new InteractionModel(_self, 3, selectAvailableStickersStateNoAction);

	//#4 - connect (if not), locate people, choose one and exchange the stickers by marking the ones the user will got from the other peer and the ones the user is giving
	connectingState = new InteractionModelState(_self.viewConnect);
	chosingPeerState = new InteractionModelState(_self.viewNearPeople, "desconectar");
	exchangingState = new InteractionModelState(_self.viewExchangingArena, "voltar");
	chattingState = new InteractionModelState(_self.viewChat, "voltar");
	_self.interactionExchangeNow = new InteractionModel(_self, 4, connectingState);
	_self.interactionExchangeNow.addTransition(connectingState, chosingPeerState, "connected", 1);
	_self.interactionExchangeNow.addTransition(chosingPeerState, exchangingState, "exchange", 2);
	_self.interactionExchangeNow.addTransition(chosingPeerState, connectingState, "cancel", 3, function() {
		if(_self.mqttConnectionManager.isMaintainingConnectionToServer()) {
			_self.mqttConnectionManager.disconnectFromServer();
		}
	});
	_self.interactionExchangeNow.addTransition(exchangingState, chosingPeerState, "cancel", 4);
	_self.interactionExchangeNow.addTransition(exchangingState, chattingState, "confirm", 5);
	_self.interactionExchangeNow.addTransition(chattingState, exchangingState, "cancel", 6);

	_self.viewNearPeople.selectedPeer.subscribe(function(newValue) {
		if (newValue!=null) {
			_self.viewExchangingArena.currentPeer(newValue);
			_self.interactionExchangeNow.triggerTransition("exchange");
		}
	});
	_self.mqttConnected.subscribe(function(newValue) {
		if (newValue) {
			_self.interactionExchangeNow.triggerTransition("connected");
		}else{
			_self.interactionExchangeNow.triggerTransition("cancel");
		}
	});

	//checks if it is first time running the App
	_self.firstTimeRunning = ko.observable(localStorage["firstTimeFlag"] == undefined ? true : false);
	_self.firstTimeRunning(false); //
	if (_self.firstTimeRunning()) {
		_self.currentInteraction = ko.observable(_self.interactionWelcome);
    } else if(localStorage["connectedToServer"]=="true") {
		_self.currentInteraction = ko.observable(_self.interactionExchangeNow);
	} else {
		_self.currentInteraction = ko.observable(_self.interactionNeededStickers);
	}

	_self.openDefaultInteraction = function() {
		_self.currentInteraction(_self.interactionNeededStickers);
	}

	_self.calculateElapsedTime = function(timeParam) {
		var info = "";
		var timeElapsed = new Date().getTime() - timeParam;
		if(timeElapsed < 60000) {
			info = "Há poucos segundos";
		} else if(timeElapsed < 3600000) {
			info = "Há "+ Math.ceil(timeElapsed/60000) +" minutos";
		} else if(timeElapsed >= 3600000) {
			info = "Há "+ Math.ceil(timeElapsed/3600000) +" horas";
		}
		return info;
	}

	_self.initializeReceivedStickersInfo = function() {
		if(localStorage["receivedStickersInfo"] == undefined || localStorage["receivedStickersInfo"] == "undefined" || localStorage["receivedStickersInfo"] == null){
			_self.receivedStickersInfo = new Array();
		}else{
			_self.receivedStickersInfo = JSON.parse(localStorage["receivedStickersInfo"]);
			$(_self.receivedStickersInfo).each(function(idx, stickersInfo) {
				stickersInfo.timeElapsedInfo = ko.observable(_self.calculateElapsedTime(stickersInfo.time));
				stickersInfo.online = false;
				stickersInfo.isOnline = ko.observable(stickersInfo.online);
				stickersInfo.messages = ko.observableArray(stickersInfo.chatMessages);
			});
		}
		_self.viewNearPeople.connectedPeople(_self.receivedStickersInfo);
	}
	_self.initializeReceivedStickersInfo();

	//update elapsed time informations
	window.setInterval(function() {
		//add time messages
		for(var i=0; i<_self.receivedStickersInfo.length; i++) {
 			var stickersInfo = _self.receivedStickersInfo[i];
			stickersInfo.timeElapsedInfo(_self.calculateElapsedTime(stickersInfo.time));
		}
		_self.updateReceivedStickersLocalInfo();
		_self.publishStickersInfoToServer(false, true);
	}, 50000);


	_self.connectToMQTTServer = function() {
			//store info for later use
		localStorage["nickname"] = _self.viewConnect.nickname();
		localStorage["place"] = _self.viewConnect.place();
		localStorage["selfInfo"] = _self.viewConnect.selfInfo();

		_self.initializeReceivedStickersInfo();

		//connect to mqtt server
		_self.mqttConnectionManager.connectToServer();
	}

	_self.publishStickersInfoToServer = function(firstMessage, online) {
		if(_self.mqttConnectionManager.isMaintainingConnectionToServer()) {
			console.log("Preparing stickers info...");
			var stickersInfo = new StickersInfo(_self.clientUUID,
				new Date().getTime(),
				_self.viewConnect.nickname.peek(),
				_self.viewConnect.place.peek(),
				_self.viewConnect.selfInfo.peek(),
				_self.getOnlySelectedItems(_self.viewNeededStickers.items()),
				_self.getOnlySelectedItems(_self.viewAvailableStickers.items()),
				firstMessage,
				online
				//stickersForReceivingFromPeer: Array - used later during ranking calculations
				//stickersForGivingToPeer: Array - used later during ranking calculations
			);

			console.log("Publishing stickers info to MQTT server...");
			_self.mqttConnectionManager.publishMessage("/main/notclassified", JSON.stringify(stickersInfo));

		} else {
			console.log("Not connected to server");
		}
	}

	_self.getOnlySelectedItems = function(items) {
		var result = new Array();
		for(var i=0; i<items.length; i++) {
			if(items[i].selected()) {
				result.push(items[i]);
			}
		}
		return result;
	}

	_self.recalculateStickersInfoRanking = function() {
		if(_self.receivedStickersInfo!=null && _self.viewNeededStickers!=null && _self.viewAvailableStickers!=null) {

			//look for stickers that the current user needs and are available from others
			for(var i=0; i<_self.receivedStickersInfo.length; i++) {
				var receivedStickerInfo = _self.receivedStickersInfo[i];
				receivedStickerInfo.stickersForReceivingFromPeer = new Array();
				receivedStickerInfo.stickersForGivingToPeer = new Array();

				//find stickers that the current user could get from other peers
				var filteredNeedStickersModelItems = _self.getOnlySelectedItems(_self.viewNeededStickers.items());
				for(var j=0; j<filteredNeedStickersModelItems.length; j++) {
					var neededStickerByUser = filteredNeedStickersModelItems[j];

					for(var k=0; k<receivedStickerInfo.availableStickers.length; k++) {
						var availableStickerFromPeer = receivedStickerInfo.availableStickers[k];
						if(neededStickerByUser.number==availableStickerFromPeer.number) {
							receivedStickerInfo.stickersForReceivingFromPeer.push(neededStickerByUser);
							break;
						}
					}
				}

				//find stickers that the current user could give to other peers
				var filteredAvailableStickersModelItems = _self.getOnlySelectedItems(_self.viewAvailableStickers.items());
				for(var j=0; j<filteredAvailableStickersModelItems.length; j++) {
					var availableStickerByUser = filteredAvailableStickersModelItems[j];

					for(var k=0; k<receivedStickerInfo.neededStickers.length; k++) {
						var neededStickerFromPeer = receivedStickerInfo.neededStickers[k];
						if(availableStickerByUser.number==neededStickerFromPeer.number) {
							receivedStickerInfo.stickersForGivingToPeer.push(availableStickerByUser);
							break;
						}
					}
				}
			}

			//order ranking by best matches
			if(_self.receivedStickersInfo.length>0) {
				_self.receivedStickersInfo.sort(function(left,right) {
					if (left.online && !right.online) {
						return -1;
					}else if (!left.online && right.online) {
						return 1;
					}
					if(left.stickersForReceivingFromPeer.length > right.stickersForReceivingFromPeer.length) {
						return -1;
					} else {
						return 1;
					}
				});

				//update screen items
				_self.viewNearPeople.connectedPeople(_self.receivedStickersInfo);
			}
		}

	}

	if (localStorage["connectedToServer"]=="true") {
		_self.connectToMQTTServer();
	}else{
		_self.loading(false);
	}
}

//***** /end of VIEW VIEWMODELS ******//
