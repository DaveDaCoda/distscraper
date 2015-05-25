var request = require('request');
var cheerio = require('cheerio');
var async = require('async');
var sugar = require('sugar');
var cookieJar = request.jar();
var URL = require('url');
var debug = require('debug')('distscraper:request');
var mirrors = require('./mirrors.js');
var request = request.defaults({
	method: 'GET'
});

var requestQueues = {};
function getRequestQueue(host) {
	host = host.toLowerCase();
	var requestQueue = requestQueues[host];
	if (!requestQueue) {
		requestQueue = requestQueues[host] = async.queue(request,1);
	}
	return requestQueue;
}

function requestMirror(options,result) {
	var url = options.url || options;
	var mirrorUrls = options.mirrors || mirrors.map(function(mirror) { return mirror(url); }).flatten();
	requestBase(options, function(err, response, body) {
		if (err || response.statusCode >= 400) {
			if (mirrorUrls.length > 0) {
				return requestMirror(Object.merge({ url: mirrorUrls.shift(), mirrors: mirrorUrls }), result);
			}
		}
		return result(err, response, body);
	});
}

function requestBase(options,result) {
	if (typeof options === 'string') {
		return requestBase({
			url: options
		}, result);
	}
	debug('queue', options.url);
	var url = URL.parse(options.url);
	var host = url.host;
	var q = getRequestQueue(host);
	q.push(options,handleResponse);
	function handleResponse(err,response,body) {
		if (err) {
			err.url = options.url;
			return result(err);
		}
		debug('response', options.url, response.statusCode, response.statusMessage);
		if (response.statusCode === 302) { // Handle redirects after POST
			requestQueue.pushRequest({url:response.headers.location},handleResponse);
			return;
		}
		response.url = options.url;
		result(null,response,body);
	}
}

function requestText(options,result) {
	requestMirror(options,function(err,response,body) {
		if (err) { return result(err); }
		result(null,body);
	});
}

function requestDom(options,result) {
	requestMirror(options,function(err,response,body) {
		if (err) { return result(err); }
		var $ = cheerio.load(body);
		result(null,$,response);
	});
}

function requestXmlDom(options,result) {
	requestMirror(options,function(err,response,body) {
		if (err) { return result(err); }
		var $ = cheerio.load(body,{xmlMode: true});
		result(null,$,response);
	});
}

function requestContentLength(options,result) {
	if (typeof options === 'string') {
		options = { url: options };
	}
	var newOptions = { method: 'HEAD' };
	Object.merge(newOptions,options);
	requestMirror(newOptions,function(err,response) {
		if (err) { return result(err,null,response); }
		if (response.statusCode < 200 || response.statusCode >= 300) { return result(null,null,response); }
		var contentLength = response.headers['content-length'];
		if (contentLength === undefined) {
			result(null,contentLength,response);
		}
		try {
			contentLength = parseInt(contentLength,10);
		} catch(e) {
			result(e,null,response);
		}
		result(null,contentLength,response);
	});
}


// Cheerio helpers
cheerio.prototype.filter = function(f) {
	return cheerio(this.toArray().filter(function(e) {
		return f(cheerio(e));
	}));
};

cheerio.prototype.map = function(f) {
	return this.toArray().map(function(e) {
		return f(cheerio(e));
	});
};

cheerio.prototype.mapFilter = function(f) {
	return this.toArray().map(function(e) {
		return f(cheerio(e));
	}).filter(function(e) { return e; });
};

module.exports = requestMirror;
module.exports.text = requestText;
module.exports.dom = requestDom;
module.exports.xmldom = requestXmlDom;
module.exports.contentlength = requestContentLength;
