/** MQTT CLUSTER CLIENT **/
// With this client you can indicate a list of mqtt servers so that it will be made the best
// effort for always having at least one connection available. eg. If a server goes down, it will
// try to reconnect and after a specified timeout/number of retries, it will try the next server
//
//clusterOptions = {
//  serverOptions: [{serverHost:'test.mosquitto.org', serverPort:8081, useSSL:true, username:'', password:''}],
//  useRandomServerOrder:false,
//  connectionTimeoutSeconds:3000,
//  connectionKeepaliveSeconds:30,
//  maxRetries:5,
//  timeBetweenRetriesMillis:500,
//  lastWillPayload:'{online:false}',
//  lastWillTopicName: '/users/me',
//  maxServerFallbackRetries: 2
//}
//author: Flávio Stutz@2016
var MQTTClusterClient = function(clusterOptions) {
	if(!Paho.MQTT.Client) {
		throw "MQTTClusterClient depends on Eclipse Paho javascript MQTT Client in order to work";
	}

	var _self = this;
	_self._currentManagedConnection = null;
	_self._serverIndex = -1;
	_self._serverFallbackRetries = 0;
	_self._active = false;

	if(clusterOptions==null) {
		throw 'Cluster options indefined';
	} else {
		clusterOptions = mqtt_mergeObjects(mqtt_defaultOptions, clusterOptions);
		if(clusterOptions.serverOptions == null || clusterOptions.serverOptions.length==0) {
			throw 'At least one serverOptions element must be defined in custerOptions';
		} else {
			for(var i=0; i<clusterOptions.serverOptions.length; i++) {
				if(!clusterOptions.serverOptions[i].serverHost) {
					throw 'serverHost must be defined in serverOptions';
				}
				clusterOptions.serverOptions[i] = mqtt_mergeObjects(clusterOptions, clusterOptions.serverOptions[i]);
			}
		}
	}
	_self._clusterOptions = clusterOptions;

	/* CONNECT */
	_self.connectToNextServer = function() {
		if(!_self._active) throw 'mqtt cluster client deactivated';

		//define next server to connect to
		if(clusterOptions.useRandomServerOrder) {
			_self._serverIndex = Math.ceil(Math.random() * clusterOptions.serverOptions.length) - 1;
		} else {
			_self._serverIndex++;
			if(_self._serverIndex>=clusterOptions.serverOptions.length) {
				_self._serverIndex = 0;
			}
		}

		var subscribedTopics = null;
		if(_self.currentManagedConnection!=null) {
			//maintain subscribed topics from last server
			subscribedTopics = _self.currentManagedConnection.subscribedTopics;
			//cleanup previous connection manager
			if(_self.currentManagedConnection.isMaintainingConnectionToServer()) {
				_self.currentManagedConnection.disconnectFromServer();
			}
		}

		//start managing a connection to the new server
		var serverOptions = _self._clusterOptions.serverOptions[_self._serverIndex];
		console.log('Selected cluster server is ' + serverOptions.serverHost + ':' + serverOptions.serverPort);
		_self.currentManagedConnection = new MQTTManagedConnection(serverOptions);
		if(subscribedTopics!=null) {
			_self.currentManagedConnection.subscribedTopics = subscribedTopics;
		}
		_self.currentManagedConnection.onConnectedToTargetServer = function() {
			_self._serverFallbackRetries = 0;
		}
		_self.currentManagedConnection.onDisconnectedFromServer = function() {
			if(_self._active) {
				if(_self._serverFallbackRetries<_self._clusterOptions.serverFallbackMaxRetries) {
					window.setTimeout(function() {
						_self._serverFallbackRetries++;
						console.log('Falling back to next server. serverFallbacks=' + _self._serverFallbackRetries + '/' + _self._clusterOptions.serverFallbackMaxRetries);
						_self.connectToNextServer();
					}, _self._clusterOptions.serverFallbackTimeBetweenRetriesMillis);
				} else {
					console.log('Max server fallback retries reached. Deactivating mqtt cluster client. serverFallbacks=' + _self._serverFallbackRetries + '/' + _self._clusterOptions.serverFallbackMaxRetries);
				}
			}
		}
		_self.currentManagedConnection.connectToServer();
	}

	/* ACTIVATE CLUSTER CLIENT */
	_self.connect = function() {
		_self._active = true;
		_self.connectToNextServer();
	}

	/* DEACTIVATE CLUSTER CLIENT */
	_self.disconnect = function() {
		_self._active = false;
		if(_self.currentManagedConnection!=null && _self.currentManagedConnection.isMaintainingConnectionToServer()) {
			_self.currentManagedConnection.disconnectFromServer();
		}
	}

}
