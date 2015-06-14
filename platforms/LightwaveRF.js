// LightwaveRF Platform
//
var types = require('../lib/HAP-NodeJS/accessories/types.js');
var request = require('request');
var plist = require('plist');
var dgram = require('dgram');
// Counts sent packets for hub
var commandCounter = 0;

function LightwaveRfPlatform(log, config){
	this.log = log;
	// Needed to access Hub
	this.email = config.email;
	this.pin = config.pin;
	this.hub = config.hub;
	// Plist request details
	this.configUrl = 'http://www.s15363777.onlinehome-server.info/getsettingsxml.php';
	this.configUrlQueryParams = {
		action: 'D',
		email: config.email,
		pin: config.pin
	};

	this.hub = config.hub;
}

LightwaveRfPlatform.prototype = {
	accessories: function(callback) {

		this.log('Getting LightwaveRF Config file...');

		request({
			method: 'GET',
			url: this.configUrl,
			qs: this.configUrlQueryParams
		}, function(error, response, body){
			if(!error){
				this.log('Got config, creating accessories...');
				var accessories = this.createAccessoriesFromConfigFile(body);
				callback(accessories);
			} else {
				this.log('Couldn\'t get config file because: ', error);
			}
		}.bind(this));
	},

	createAccessoriesFromConfigFile: function(plistString){
		var config = plist.parse(plistString);
		var accessories = [];

		config.deviceStatus.forEach(function(typeCode, idx){
			// device status codes
			// D - a Dimmer device
			// O - an On/Off device
			// I - an Inactive device
			// m - a Mood
			// o - the All Off function

			// Ignore any inactive devices, moods and all-off commmands
			if(typeCode === 'I' || typeCode === 'm' || typeCode === 'M' || typeCode === 'o') {
				return;
			}

			// there are 10 items per room, the device's room is derived from it's position in idx
			// Indexes begin from 1, not 0
			var roomId = Math.floor(idx / 10) + 1;
			var deviceId = idx - (10 * (roomId - 1)) + 1;

			accessories.push(
				new LightwaveRfAccessory(this.log, {
					name: config.deviceNames[idx],
					deviceId: deviceId,
					roomId: roomId,
					type: typeCode,
					hubIp: this.hub
				})
			);

		}.bind(this));

		return accessories;

	}
};

function LightwaveRfAccessory(log, config) {
	// device info
	this.name = config.name;
	this.config = config;
  this.log = log;
  this.hub = config.hubIp;
}

function createSwitchCommandString(roomId, deviceId, turnOn, topLine, bottomLine){
	var msg = commandCounter + ',' + '!R' + roomId + 'D' +
		deviceId + (turnOn ? 'F1' : 'F0') + '|' + topLine + '|' + bottomLine;

	return msg;
}

function createDimmerCommandString(roomId, deviceId, brightness, topLine, bottomLine){
	var msg = commandCounter + ',' + '!R' + roomId + 'D' +
		deviceId + 'FdP' + (brightness * 0.32).toFixed(0) + '|' + topLine + '|' + bottomLine;

	return msg;
}

LightwaveRfAccessory.prototype = {

	setPowerState: function(powerOn) {
		var message;

		if (powerOn) {
			this.log('Attempting to turn on ' + this.config.name);

			message = new Buffer(
				createSwitchCommandString(this.config.roomId, this.config.deviceId, true, this.config.name, 'On')
			);

		} else {
			this.log('Attempting to turn off ' + this.config.name);

			message = new Buffer(
				createSwitchCommandString(this.config.roomId, this.config.deviceId, false, this.config.name, 'Off')
			);
		}

		var client = dgram.createSocket('udp4');

		client.send(message, 0, message.length, 9760, this.hub, function(){
			client.close();
		});

	},

	setBrightness: function(level) {

		this.log('Attempting to set brightness of ' + this.config.name + ' to ' + level);

		var message = new Buffer(
			createDimmerCommandString(this.config.roomId, this.config.deviceId, level, this.config.name, level)
		);

		var client = dgram.createSocket('udp4');

		client.send(message, 0, message.length, 9760, this.hub, function(){
			client.close();
		});

	},

	getServices: function() {

		var characteristics = [{
				cType: types.NAME_CTYPE,
				onUpdate: null,
				perms: ['pr'],
				format: 'string',
				initialValue: this.name,
				supportEvents: true,
				supportBonjour: false,
				manfDescription: 'Name of service',
				designedMaxLength: 255
			}, {
				cType: types.POWER_STATE_CTYPE,
				onUpdate: function(value) { this.setPowerState(value); }.bind(this),
				perms: ['pw', 'pr', 'ev'],
				format: 'bool',
				initialValue: 0,
				supportEvents: true,
				supportBonjour: false,
				manfDescription: 'Change the power state of the Bulb',
				designedMaxLength: 1
		}];

		// If we have a Dimmer (type D), add the dimmer control characteristic
		if(this.config.type === 'D'){
			characteristics.push({
				cType: types.BRIGHTNESS_CTYPE,
				onUpdate: function(value) { this.setBrightness(value); }.bind(this),
				perms: ['pw', 'pr', 'ev'],
				format: 'int',
				initialValue: 0,
				supportEvents: true,
				supportBonjour: false,
				manfDescription: 'Adjust Brightness of Light',
				designedMinValue: 0,
				designedMaxValue: 100,
				designedMinStep: 1,
				unit: '%'
			});
		}

		return [{
			sType: types.ACCESSORY_INFORMATION_STYPE,
			characteristics: [{
				cType: types.NAME_CTYPE,
				onUpdate: null,
				perms: ['pr'],
				format: 'string',
				initialValue: this.name,
				supportEvents: false,
				supportBonjour: false,
				manfDescription: 'Name of the accessory',
				designedMaxLength: 255
			}, {
				cType: types.MANUFACTURER_CTYPE,
				onUpdate: null,
				perms: ['pr'],
				format: 'string',
				initialValue: 'LightwaveRF',
				supportEvents: false,
				supportBonjour: false,
				manfDescription: 'Manufacturer',
				designedMaxLength: 255
			}, {
				cType: types.MODEL_CTYPE,
				onUpdate: null,
				perms: ['pr'],
				format: 'string',
				initialValue: 'Rev-1',
				supportEvents: false,
				supportBonjour: false,
				manfDescription: 'Model',
				designedMaxLength: 255
			}, {
				cType: types.SERIAL_NUMBER_CTYPE,
				onUpdate: null,
				perms: ['pr'],
				format: 'string',
				initialValue: 'A1S2NASF88EW',
				supportEvents: false,
				supportBonjour: false,
				manfDescription: 'SN',
				designedMaxLength: 255
			}, {
				cType: types.IDENTIFY_CTYPE,
				onUpdate: null,
				perms: ['pw'],
				format: 'bool',
				initialValue: false,
				supportEvents: false,
				supportBonjour: false,
				manfDescription: 'Identify Accessory',
				designedMaxLength: 1
			}]
		}, {
			sType: types.LIGHTBULB_STYPE,
			characteristics: characteristics
		}];
	}
};

module.exports.accessory = LightwaveRfAccessory;
module.exports.platform = LightwaveRfPlatform;
