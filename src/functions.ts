/// <reference path="../typings/modules/lodash/index.d.ts" />
import {
    Http, XHRBackend, BaseRequestOptions, ConnectionBackend,
    Headers
} from  '@angular/http';
import {Observable} from 'rxjs/Observable';
import {ReflectiveInjector} from "@angular/core";

// Support `collection.sortBy('attr')` and `collection.findWhere({id: 1})`.
function cb(iteratee, instance) {
    if (_.isFunction(iteratee)) return iteratee;
    if (_.isObject(iteratee) && !instance._isModel(iteratee)) return modelMatcher(iteratee);
    if (_.isString(iteratee)) return function(model) { return model.get(iteratee); };
    return iteratee;
}

function modelMatcher(attrs) {
    var matcher = _.matches(attrs);
    return function(model) {
        return matcher(model.attributes);
    };
}

function addMethod(length: number, method, attribute) {
    switch (length) {
        case 1: return function() {
            return _[method](this[attribute]);
        };
        case 2: return function(value) {
            return _[method](this[attribute], value);
        };
        case 3: return function(iteratee, context) {
            return _[method](this[attribute], cb(iteratee, this), context);
        };
        case 4: return function(iteratee, defaultVal, context) {
            return _[method](this[attribute], cb(iteratee, this), defaultVal, context);
        };
        default: return () => {
            var args = this.slice.call(arguments);
            args.unshift(this[attribute]);
            return _[method].apply(_, args);
        };
    }
}

export function addUnderscoreMethods(Class, methods, attribute) {
    _.each(methods, function(length, method) {
        if (_[method]) Class.prototype[method] = addMethod(length, method, attribute);
    });
}


// Map from CRUD to HTTP for our default `Backbone.sync` implementation.
var methodMap = {
    'create': 'POST',
    'update': 'PUT',
    'patch':  'PATCH',
    'delete': 'DELETE',
    'read':   'GET'
};

export function sync(method, model, options) {
    var type = methodMap[method];

    // Default JSON-request options.
    var params = {method: type};

    // Ensure that we have a URL.
    if (!options.url) {
        params['url'] = _.result(model, 'url') || urlError();
    }

    if(options.data)
    {
        params['body'] = options.data;
    }

    // Ensure that we have the appropriate request data.
    if (options.data == null && model && (method === 'create' || method === 'update' || method === 'patch')) {
        params['contentType'] = 'application/json';
        params['body'] = JSON.stringify(options.attrs || model.toJSON(options));
    }

    // Pass along `textStatus` and `errorThrown` from jQuery.
    var error = options.error;
    options.error = (xhr, textStatus, errorThrown) => {
        options.textStatus = textStatus;
        options.errorThrown = errorThrown;
        if (error) error.call(options.context, xhr, textStatus, errorThrown);
    };

    // Make the request, allowing the user to override any Ajax options.
    return ajax(_.extend(params, options));
}

let http: Http = null;
// Set the default implementation of `Backbone.ajax` to proxy through to `$`.
// Override this if you'd like to use a different library.
export function ajax(params: Object): Observable {
    if (null === http)
    {
        let injector = ReflectiveInjector.resolveAndCreate([
            BaseRequestOptions, XHRBackend, {
                provide: Http,
                useFactory: function(backend: ConnectionBackend, defaultOptions: BaseRequestOptions) {
                    return new Http(backend, defaultOptions);
                },
                deps: [XHRBackend, BaseRequestOptions]
            }
        ]);

        http = injector.get(Http);
    }

    let url = params['url'];
    delete params['url'];
    var headers = new Headers();
    headers.append('Content-Type', params['contentType']);
    params['headers'] = headers;
    return http.request(url, params);
}


// Throw an error when a URL is needed, and none is supplied.
export function urlError() {
    throw new Error('A "url" property or function must be specified');
}

// Wrap an optional error callback with a fallback error event.
export function wrapError(model, options) {
    var error = options.error;
    options.error = (resp) => {
        if (error) error.call(options.context, model, resp, options);
        model.trigger('error', model, resp, options);
    };
}



