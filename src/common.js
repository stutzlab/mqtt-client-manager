/** GUID GENERATOR * */
var mqtt_generateUUID = (function() {
		function s4() {
			return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
		}
		return function() {
			return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
		};
})();

var mqtt_defaultOptions = {
	randomServerOrder:false,
	connectionTimeoutSeconds:3000,
	connectionKeepaliveSeconds:30,
	maxRetries:3,
	timeBetweenRetriesMillis:500,
	lastWillPayload: null,
	lastWillTopicName: null,
	useSSL: false,
	username: null,
	password: null,
	serverFallbackMaxRetries: 3,
	serverFallbackTimeBetweenRetriesMillis: 500
}

/**
 * Overwrites obj1's values with obj2's and adds obj2's if non existent in obj1
 * @param obj1
 * @param obj2
 * @returns obj3 a new object based on obj1 and obj2
 */
function mqtt_mergeObjects(obj1, obj2) {
    var obj3 = {};
    for (var attrname in obj1) { obj3[attrname] = obj1[attrname]; }
    for (var attrname in obj2) { obj3[attrname] = obj2[attrname]; }
    return obj3;
}
