/** MQTT CONNECTION MANAGER **/
//An MQTT connection manager that handles automatic reconnections when the underlying
//mqtt server connection is lost so that the users have the sensation that he is always
//connected to the topics as soon as there is any kind of connectivity to the server,
//without any user action
//connectionOptions = {
//  serverHost:'test.mosquitto.org', serverPort:8081, useSSL:true, username:'', password:'',
//  randomServerOrder:false,
//  connectionTimeoutSeconds:3000,
//  connectionKeepaliveSeconds:30,
//  maxRetries:5,
//  timeBetweenRetriesMillis:500,
//  lastWillPayload:'{online:false}',
//  lastWillTopicName: '/users/me'
//}
//author: Flávio Stutz@2014
var MQTTManagedConnection = function(connectionOptions) {
	if(!Paho.MQTT.Client) {
		throw "MQTTConnectionManager depends on Eclipse Paho javascript MQTT Client in order to work";
	}

	var _self = this;
	var SubscribedTopic = function(topicName, onMessageArrivedCallback) {
		this.topicName = topicName;
		if (typeof onMessageArrivedCallback === 'function') {
			this.receiveMessage = onMessageArrivedCallback;
		}
	}
	_self.subscribedTopics = new Array();
	_self.connectionOptions = connectionOptions;
	if(connectionOptions.lastWillPayload!=null && connectionOptions.lastWillTopicName!=null) {
		connectionOptions.lastWillMessage = new Paho.MQTT.Message(connectionOptions.lastWillPayload);
		connectionOptions.lastWillMessage.destinationName = connectionOptions.lastWillTopicName;
	}

	//callback functions
	_self.onDisconnectedFromServer = null;
	_self.onDisconnectingFromServer = null;
	_self.onMaxConnectionRetriesReached = null;
	_self.onMaxPublishRetriesReached = null;
	_self.onConnectingToTargetServer = null;
	_self.onConnectedToTargetServer = null;
	_self.onFailedToConnectToTargetServer = null;
	_self.onDisconnectedFromTargetServer = null;
	_self.onSubscribedToTargetTopic = null;
	_self.onWaitingBeforeRetrying = null;
	_self.onStartedRetrying = null;

	_self.mqttClient = null;
	_self._isTargetServerConnected = false;
	_self._failedConnectionRetryCount = 0;
	_self._failedPublishRetryCount = 0;

	_self.mqttConnectionOptions = {
		timeout : connectionOptions.connectionTimeoutSeconds,
		keepAliveInterval : connectionOptions.connectionKeepaliveSeconds,
		//willMessage: connectionOptions.lastWillMessage,
		onSuccess : function() {
			console.log("Connected successfuly to MQTT server " + _self.connectionOptions.serverHost + ":" + _self.connectionOptions.serverPort);
			_self._failedConnectionRetryCount = 0;
			_self._isTargetServerConnected = true;
			_self._performSubscriptions();
			if(_self.onConnectedToTargetServer) {
				try {
					_self.onConnectedToTargetServer.call();
				} catch(e) {
					console.log(e);
				}
			}
		},
		onFailure : function(e) {
			console.log("Failed to connect to MQTT server");
			console.log(e);
			_self._isTargetServerConnected = false;
			if(_self.onFailedToConnectToTargetServer) {
				try {
					_self.onFailedToConnectToTargetServer.call();
				} catch(e) {
					console.log(e);
				}
			}

			//retry connection attempt
			_self._failedConnectionRetryCount++;
			if(connectionOptions.maxRetries==0 || _self._failedConnectionRetryCount <= connectionOptions.maxRetries) {
				console.log("Connection failure. Trying again in "+ connectionOptions.timeBetweenRetriesMillis +"ms. counter=" + _self._failedConnectionRetryCount);
				if(_self.onWaitingBeforeRetrying) {
					try {
						_self.onWaitingBeforeRetrying.call();
					} catch(e) {
						console.log(e);
					}
				}
				window.setTimeout(
					function() {
						if(_self.onStartedRetrying) {
							try {
								_self.onStartedRetrying.call();
							} catch(e) {
								console.log(e);
							}
						}
						if (_self.mqttClient!=null) {
							_self._connectToTargetServer();
						}
					}, connectionOptions.timeBetweenRetriesMillis
				);
			} else {
				console.log("Max connection retry count reached. Aborting attempts");
				if(_self.onMaxConnectionRetriesReached) {
					try {
						_self.onMaxConnectionRetriesReached.call();
					} catch(e) {
						console.log(e);
					}
				}
				_self.disconnectFromServer();
			}
		},
		userName: connectionOptions.username,
		password: connectionOptions.password,
		useSSL: connectionOptions.useSSL
	};

	_self._connectToTargetServer = function() {
		console.log("Establishing connection to MQTT server " + connectionOptions.serverHost + ":" + connectionOptions.serverPort + "...");
		_self._isTargetServerConnected = false;//will confirm later
		try {
			_self.mqttClient.disconnect();
		} catch(e) {
			// console.log(e);
		}
		if(_self.onConnectingToTargetServer) {
			try {
				_self.onConnectingToTargetServer.call();
			} catch(e) {
				console.log(e);
			}
		}
		delete _self.mqttConnectionOptions.mqttVersionExplicit;
		_self.mqttClient.connect(_self.mqttConnectionOptions);
	}

	_self._disconnectFromTargetServer = function() {
		console.log("Disconnecting from MQTT server " + connectionOptions.serverHost + ":" + connectionOptions.serverPort + "...");
		_self._isTargetServerConnected = false;
		try {
			_self.mqttClient.disconnect(_self.mqttConnectionOptions);
		} catch (e) {
			console.log(e);
			// console.log("disconnectFromServer: Ignoring error during disconnection");
		}
		if(_self.onDisconnectedFromTargetServer) {
			try {
				_self.onDisconnectedFromTargetServer.call();
			} catch(e) {
				console.log(e);
			}
		}
	}

	_self._performSubscriptions = function() {
		console.log("Subscribing to topics");
		for(var i=0; i<_self.subscribedTopics.length; i++) {
			var topicName = _self.subscribedTopics[i].topicName;
			_self._subscribeToTargetTopic(topicName);
		}
	}

	_self._subscribeToTargetTopic = function(topicName) {
		try {
			console.log("Subscribing to '"+topicName+"'...");
			_self.mqttClient.subscribe(topicName,
				{timeout:_self.mqttConnectionOptions.timeout,
					onFailure: function(e) {console.log(e)}});
			if(_self.onSubscribedToTargetTopic) {
				try {
					_self.onSubscribedToTargetTopic.call();
				} catch(e) {
					console.log(e);
				}
			}
		} catch (e) {
			console.log("Failed to subscribe to '" + topicName + "'. Ignoring.");
			console.log(e);
		}
	}

	_self._unsubscribeFromRealTopic = function(topicName) {
		try {
			console.log("Unsubscribing from '"+topicName+"'...");
			_self.mqttClient.unsubscribe(topicName,
				{timeout:_self.mqttConnectionOptions.timeout,
				onFailure: function(e) {console.log(e)}}
			);
		} catch (e) {
			console.log(e);
		}
	}


	_self.topicNameMatch = function(topicNameLookup, targetTopicName) {
		return topicNameLookup == targetTopicName;
	}
	_self.connectToServer = function() {
		console.log("Connecting to MQTT server '"+ connectionOptions.serverHost +":"+ connectionOptions.serverPort +"'. From now the connection will be reestablished when dropped.");
		_self.mqttClient = new Paho.MQTT.Client(
								connectionOptions.serverHost, parseInt(connectionOptions.serverPort),
								new Date().getTime()+"");
		_self.mqttClient.onConnectionLost = function(message) {
			console.log("Connection lost from real MQTT server");
			_self.mqttConnectionOptions.onFailure(message);
		}
		_self.mqttClient.onMessageArrived = function(message) {
			try {
				for (var i = 0; i < _self.subscribedTopics.length; i++) {
					if(_self.topicNameMatch(_self.subscribedTopics[i].topicName, "/"+message.destinationName)) {
						_self.subscribedTopics[i].receiveMessage(message);
					}
				};
			} catch(e) {
				console.log(e);
			}
		}
		_self._connectToTargetServer();

	}
	_self.isMaintainingConnectionToServer = function() {
		return _self.mqttClient!=null;
	}
	_self.disconnectFromServer = function() {
		console.log("Disconnecting from MQTT server. Will not try to maintain connections anymore");
		if(_self.onDisconnectingFromServer) {
			try {
				_self.onDisconnectingFromServer.call();
			} catch(e) {
				console.log(e);
			}
		}
		_self._disconnectFromTargetServer();
		_self.mqttClient = null;
		if(_self.onDisconnectedFromServer) {
			try {
				_self.onDisconnectedFromServer.call();
			} catch(e) {
				console.log(e);
			}
		}
	}

	_self.subscribeToTopic = function(topicName, callback) {
		_self.subscribedTopics.push(new SubscribedTopic(topicName, callback));
		if(_self._isTargetServerConnected) {
			_self._subscribeToTargetTopic(topicName);
		}
	}

	_self.unsubscribeFromTopic = function(topicName) {
		var index = 0;
		for (var i = 0; i < _self.subscribedTopics.length; i++) {
			if(_self.subscribedTopics[i].topicName == topicName) {
				index = i;
			}
		};
		if(index>-1) {
			_self.subscribedTopics.splice(index, 1);
		} else {
			//throw "Topic " + topicName + " is not subscribed"
		}
		if(_self._isTargetServerConnected) {
			_self._unsubscribeFromRealTopic(topicName);
		}
	}

	_self.publishMessage = function(topicName, payload) {
		if(_self._isTargetServerConnected) {
			try {
				console.log("Publishing message to topic " + topicName);
				var message = new Paho.MQTT.Message(payload);
				message.destinationName = topicName;
				_self.mqttClient.send(message);
			} catch(e) {
				console.log("Failed to publish message to topic " + topicName);
				console.log(e);
				_self._failedPublishRetryCount++;
				if(connectionOptions.maxRetries==0 || _self._failedPublishRetryCount <= connectionOptions.maxRetries) {
					console.log("Trying to reestablish connection to target MQTT server in order to retry to publish the message");
					_self._disconnectFromTargetServer();
					_self._connectToTargetServer();
					_self.publishMessage(topicName, payload);
					_self._failedPublishRetryCount = 0;
				} else {
					console.log("Max publish retries reached. Aborting.");
					if(_self.onMaxPublishRetriesReached) {
						try {
							_self.onMaxPublishRetriesReached.call();
						} catch(e) {
							console.log(e);
						}
					}
					_self.disconnectFromServer();
				}
			}
		} else {
			console.log("Ignoring publish request. Manager not connected to server");
		}
	}
}
/** END OF MQTT CONNECTION MANAGER OBJECT **/
