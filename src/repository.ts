/// <reference path="../typings/modules/lodash/index.d.ts" />
import {Entity} from './entity';
import {Event} from './event';
import {addUnderscoreMethods, sync, wrapError} from './functions';

interface SortBy {
    n: (n: Entity) => number | string;
}

interface Sort {
    n: (n: Entity, o: Entity) => number;
}

export class Repository extends Event {
    // Default options for `Repository#set`.
    private setOptions = {add: true, remove: true, merge: true};
    private addOptions = {add: true, remove: false};
    private comparator: SortBy | Sort | string;
    public length = 0;
    private _byId = {};
    public models : Entity[];

    constructor(models, options) {
        options || (options = {});
        this.preinitialize.apply(this, arguments);
        if (options.model) this.model = options.model;
        if (options.comparator !== void 0) this.comparator = options.comparator;
        this._reset();
        this.initialize.apply(this, arguments);
        if (models) this.reset(models, _.extend({silent: true}, options));
    }

    // Splices `insert` into `array` at index `at`.
    private splice(array, insert, at) {
        at = Math.min(Math.max(at, 0), array.length);
        var tail = Array(array.length - at);
        var length = insert.length;
        var i;
        for (i = 0; i < tail.length; i++) tail[i] = array[i + at];
        for (i = 0; i < length; i++) array[i + at] = insert[i];
        for (i = 0; i < tail.length; i++) array[i + length + at] = tail[i];
    }


    // The default model for a collection is just a **Backbone.Model**.
    // This should be overridden in most cases.
    private model = Entity;


    // preinitialize is an empty function by default. You can override it with a function
    // or object.  preinitialize will run before any instantiation logic is run in the Repository.
    preinitialize() {
    }

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize() {
    }

    // The JSON representation of a Repository is an array of the
    // models' attributes.
    toJSON(options) {
        return this.map(function (model) {
            return model.toJSON(options);
        });
    }

    sync() {
        return sync.apply(this, arguments);
    }

    // Add a model, or list of models to the set. `models` may be Backbone
    // Models or raw JavaScript objects to be converted to Models, or any
    // combination of the two.
    add(models, options) {
        return this.set(models, _.extend({merge: false}, options, this.addOptions));
    }

    // Remove a model, or a list of models from the set.
    remove(models, options) {
        options = _.extend({}, options);
        var singular = !_.isArray(models);
        models = singular ? [models] : models.slice();
        var removed = this._removeModels(models, options);
        if (!options.silent && removed.length) {
            options.changes = {added: [], merged: [], removed: removed};
            this.trigger('update', this, options);
        }
        return singular ? removed[0] : removed;
    }

    // Update a collection by `set`-ing a new list of models, adding new ones,
    // removing models that are no longer present, and merging models that
    // already exist in the collection, as necessary. Similar to **Model#set**,
    // the core operation for updating the data contained by the collection.
    set(models, options) {
        if (models == null) return;

        options = _.extend({}, this.setOptions, options);
        if (options.parse && !this._isModel(models)) {
            models = this.parse(models, options) || [];
        }

        var singular = !_.isArray(models);
        models = singular ? [models] : models.slice();

        var at = options.at;
        if (at != null) at = +at;
        if (at > this.length) at = this.length;
        if (at < 0) at += this.length + 1;

        var set = [];
        var toAdd = [];
        var toMerge = [];
        var toRemove = [];
        var modelMap = {};

        var add = options.add;
        var merge = options.merge;
        var remove = options.remove;

        var sort = false;
        var sortable = this.comparator && at == null && options.sort !== false;
        var sortAttr = _.isString(this.comparator) ? this.comparator : null;

        // Turn bare objects into model references, and prevent invalid models
        // from being added.
        var model, i;
        for (i = 0; i < models.length; i++) {
            model = models[i];

            // If a duplicate is found, prevent it from being added and
            // optionally merge it into the existing model.
            var existing = this.get(model);
            if (existing) {
                if (merge && model !== existing) {
                    var attrs = this._isModel(model) ? model.attributes : model;
                    if (options.parse) attrs = existing.parse(attrs, options);
                    existing.set(attrs, options);
                    toMerge.push(existing);
                    if (sortable && !sort) sort = existing.hasChanged(sortAttr);
                }
                if (!modelMap[existing.cid]) {
                    modelMap[existing.cid] = true;
                    set.push(existing);
                }
                models[i] = existing;

                // If this is a new, valid model, push it to the `toAdd` list.
            } else if (add) {
                model = models[i] = this._prepareModel(model, options);
                if (model) {
                    toAdd.push(model);
                    this._addReference(model, options);
                    modelMap[model.cid] = true;
                    set.push(model);
                }
            }
        }

        // Remove stale models.
        if (remove) {
            for (i = 0; i < this.length; i++) {
                model = this.models[i];
                if (!modelMap[model.cid]) toRemove.push(model);
            }
            if (toRemove.length) this._removeModels(toRemove, options);
        }

        // See if sorting is needed, update `length` and splice in new models.
        var orderChanged = false;
        var replace = !sortable && add && remove;
        if (set.length && replace) {
            orderChanged = this.length !== set.length || _.some(this.models, function (m, index) {
                    return m !== set[index];
                });
            this.models.length = 0;
            this.splice(this.models, set, 0);
            this.length = this.models.length;
        } else if (toAdd.length) {
            if (sortable) sort = true;
            this.splice(this.models, toAdd, at == null ? this.length : at);
            this.length = this.models.length;
        }

        // Silently sort the collection if appropriate.
        if (sort) this.sort({silent: true});

        // Unless silenced, it's time to fire all appropriate add/sort/update events.
        if (!options.silent) {
            for (i = 0; i < toAdd.length; i++) {
                if (at != null) options.index = at + i;
                model = toAdd[i];
                model.trigger('add', model, this, options);
            }
            if (sort || orderChanged) this.trigger('sort', this, options);
            if (toAdd.length || toRemove.length || toMerge.length) {
                options.changes = {
                    added: toAdd,
                    removed: toRemove,
                    merged: toMerge
                };
                this.trigger('update', this, options);
            }
        }

        // Return the added (or merged) model (or models).
        return singular ? models[0] : models;
    }

    // When you have more items than you want to add or remove individually,
    // you can reset the entire set with a new list of models, without firing
    // any granular `add` or `remove` events. Fires `reset` when finished.
    // Useful for bulk operations and optimizations.
    reset(models, options) {
        options = options ? _.clone(options) : {};
        for (var i = 0; i < this.models.length; i++) {
            this._removeReference(this.models[i], options);
        }
        options.previousModels = this.models;
        this._reset();
        models = this.add(models, _.extend({silent: true}, options));
        if (!options.silent) this.trigger('reset', this, options);
        return models;
    }

    // Add a model to the end of the collection.
    push(model, options) {
        return this.add(model, _.extend({at: this.length}, options));
    }

    // Remove a model from the end of the collection.
    pop(options) {
        var model = this.at(this.length - 1);
        return this.remove(model, options);
    }

    // Add a model to the beginning of the collection.
    unshift(model: Entity, options) {
        return this.add(model, _.extend({at: 0}, options));
    }

    // Remove a model from the beginning of the collection.
    shift(options) {
        var model = this.at(0);
        return this.remove(model, options);
    }

    // Slice out a sub-array of models from the collection.
    slice() {
        return this.slice.apply(this.models, arguments);
    }

    // Get a model from the set by id, cid, model object with id or cid
    // properties, or an attributes object that is transformed through modelId.
    get(obj: Entity) {
        if (obj == null) return void 0;
        return this._byId[obj] ||
            this._byId[this.modelId(obj.attributes || obj)] ||
            obj.cid && this._byId[obj.cid];
    }

    // Returns `true` if the model is in the collection.
    has(obj: Entity) {
        return this.get(obj) != null;
    }

    // Get the model at the given index.
    at(index: number) {
        if (index < 0) index += this.length;
        return this.models[index];
    }

    // Return models with matching attributes. Useful for simple cases of
    // `filter`.
    where(attrs: Object, first?: boolean) {
        return this[first ? 'find' : 'filter'](attrs);
    }

    // Return the first model with matching attributes. Useful for simple cases
    // of `find`.
    findWhere(attrs: Object) {
        return this.where(attrs, true);
    }

    // Force the collection to re-sort itself. You don't need to call this under
    // normal circumstances, as the set will maintain sort order as each item
    // is added.
    sort(options) {
        var comparator = this.comparator;
        if (!comparator) throw new Error('Cannot sort a set without a comparator');
        options || (options = {});

        var length = comparator.length;
        if (_.isFunction(comparator)) comparator = _.bind(comparator, this);

        // Run sort based on type of `comparator`.
        if (length === 1 || _.isString(comparator)) {
            this.models = this.sortBy(comparator);
        } else {
            this.models.sort(comparator);
        }
        if (!options.silent) this.trigger('sort', this, options);
        return this;
    }

    // Pluck an attribute from each model in the collection.
    pluck(attr) {
        return this.map(attr + '');
    }

    // Fetch the default set of models for this collection, resetting the
    // collection when they arrive. If `reset: true` is passed, the response
    // data will be passed through the `reset` method instead of `set`.
    fetch(options) {
        options = _.extend({parse: true}, options);
        var success = options.success;
        var collection = this;
        options.success = function (resp) {
            var method = options.reset ? 'reset' : 'set';
            collection[method](resp, options);
            if (success) success.call(options.context, collection, resp, options);
            collection.trigger('sync', collection, resp, options);
        };
        wrapError(this, options);
        return this.sync('read', this, options);
    }

    // Create a new instance of a model in this collection. Add the model to the
    // collection immediately, unless `wait: true` is passed, in which case we
    // wait for the server to agree.
    create(model, options) {
        options = options ? _.clone(options) : {};
        var wait = options.wait;
        model = this._prepareModel(model, options);
        if (!model) return false;
        if (!wait) this.add(model, options);
        var collection = this;
        var success = options.success;
        options.success = function (m, resp, callbackOpts) {
            if (wait) collection.add(m, callbackOpts);
            if (success) success.call(callbackOpts.context, m, resp, callbackOpts);
        };
        model.save(null, options);
        return model;
    }

    // **parse** converts a response into a list of models to be added to the
    // collection. The default implementation is just to pass it through.
    parse(resp, options) {
        return resp;
    }

    // Create a new collection with an identical list of models as this one.
    clone() {
        return new this.constructor(this.models, {
            model: this.model,
            comparator: this.comparator
        });
    }

    // Define how to uniquely identify models in the collection.
    modelId(attrs: Object) {
        return attrs[this.model.prototype.idAttribute || 'id'];
    }

    // Private method to reset all internal state. Called when the collection
    // is first initialized or reset.
    private _reset() {
        this.length = 0;
        this.models = [];
        this._byId = {};
    }

    // Prepare a hash of attributes (or other model) to be added to this
    // collection.
    private _prepareModel(attrs, options) {
        if (this._isModel(attrs)) {
            if (!attrs.collection) attrs.collection = this;
            return attrs;
        }
        options = options ? _.clone(options) : {};
        options.collection = this;
        var model = new this.model(attrs, options);
        if (!model.validationError) return model;
        this.trigger('invalid', this, model.validationError, options);
        return false;
    }

    // Internal method called by both remove and set.
    private _removeModels(models, options) {
        var removed = [];
        for (var i = 0; i < models.length; i++) {
            var model = this.get(models[i]);
            if (!model) continue;

            var index = this.indexOf(model);
            this.models.splice(index, 1);
            this.length--;

            // Remove references before triggering 'remove' event to prevent an
            // infinite loop. #3693
            delete this._byId[model.cid];
            var id = this.modelId(model.attributes);
            if (id != null) delete this._byId[id];

            if (!options.silent) {
                options.index = index;
                model.trigger('remove', model, this, options);
            }

            removed.push(model);
            this._removeReference(model, options);
        }
        return removed;
    }

    // Method for checking whether an object should be considered a model for
    // the purposes of adding to the collection.
    private _isModel(model) {
        return model instanceof Entity;
    }

    // Internal method to create a model's ties to a collection.
    private _addReference(model, options) {
        this._byId[model.cid] = model;
        var id = this.modelId(model.attributes);
        if (id != null) this._byId[id] = model;
        model.on('all', this._onModelEvent, this);
    }

    // Internal method to sever a model's ties to a collection.
    private _removeReference(model, options) {
        delete this._byId[model.cid];
        var id = this.modelId(model.attributes);
        if (id != null) delete this._byId[id];
        if (this === model.collection) delete model.collection;
        model.off('all', this._onModelEvent, this);
    }

    // Internal method called every time a model in the set fires an event.
    // Sets need to update their indexes when models change ids. All other
    // events simply proxy through. "add" and "remove" events that originate
    // in other collections are ignored.
    private _onModelEvent(event, model, collection, options) {
        if (model) {
            if ((event === 'add' || event === 'remove') && collection !== this) return;
            if (event === 'destroy') this.remove(model, options);
            if (event === 'change') {
                var prevId = this.modelId(model.previousAttributes());
                var id = this.modelId(model.attributes);
                if (prevId !== id) {
                    if (prevId != null) delete this._byId[prevId];
                    if (id != null) this._byId[id] = model;
                }
            }
        }
        this.trigger.apply(this, arguments);
    }
}

// Underscore methods that we want to implement on the Collection.
// 90% of the core usefulness of Backbone Collections is actually implemented
// right here:
let collectionMethods = { forEach: 3, each: 3, map: 3, collect: 3, reduce: 4,
    foldl: 4, inject: 4, reduceRight: 4, foldr: 4, find: 3, detect: 3, filter: 3,
    select: 3, reject: 3, every: 3, all: 3, some: 3, any: 3, include: 3, includes: 3,
    contains: 3, invoke: 0, max: 3, min: 3, toArray: 1, size: 1, first: 3,
    head: 3, take: 3, initial: 3, rest: 3, tail: 3, drop: 3, last: 3,
    without: 0, difference: 0, indexOf: 3, shuffle: 1, lastIndexOf: 3,
    isEmpty: 1, chain: 1, sample: 3, partition: 3, groupBy: 3, countBy: 3,
    sortBy: 3, indexBy: 3};

// Mix in each Underscore method as a proxy to `Collection#models`.
addUnderscoreMethods(Repository, collectionMethods, 'models');
    
