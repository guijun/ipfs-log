'use strict';

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

var _assign = require('babel-runtime/core-js/object/assign');

var _assign2 = _interopRequireDefault(_assign);

var _values = require('babel-runtime/core-js/object/values');

var _values2 = _interopRequireDefault(_values);

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _getPrototypeOf = require('babel-runtime/core-js/object/get-prototype-of');

var _getPrototypeOf2 = _interopRequireDefault(_getPrototypeOf);

var _classCallCheck2 = require('babel-runtime/helpers/classCallCheck');

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

var _createClass2 = require('babel-runtime/helpers/createClass');

var _createClass3 = _interopRequireDefault(_createClass2);

var _possibleConstructorReturn2 = require('babel-runtime/helpers/possibleConstructorReturn');

var _possibleConstructorReturn3 = _interopRequireDefault(_possibleConstructorReturn2);

var _inherits2 = require('babel-runtime/helpers/inherits');

var _inherits3 = _interopRequireDefault(_inherits2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var pMap = require('p-map');
var GSet = require('./g-set');
var Entry = require('./entry');
var LogIO = require('./log-io');
var LogError = require('./log-errors');
var Clock = require('./lamport-clock');
var isDefined = require('./utils/is-defined');
var _uniques = require('./utils/uniques');

var randomId = function randomId() {
  return new Date().getTime().toString();
};
var getHash = function getHash(e) {
  return e.hash;
};
var flatMap = function flatMap(res, acc) {
  return res.concat(acc);
};
var getNextPointers = function getNextPointers(entry) {
  return entry.next;
};
var maxClockTimeReducer = function maxClockTimeReducer(res, acc) {
  return Math.max(res, acc.clock.time);
};
var uniqueEntriesReducer = function uniqueEntriesReducer(res, acc) {
  res[acc.hash] = acc;
  return res;
};

/**
 * Log
 *
 * @description
 * Log implements a G-Set CRDT and adds ordering
 *
 * From:
 * "A comprehensive study of Convergent and Commutative Replicated Data Types"
 * https://hal.inria.fr/inria-00555588
 */

var Log = function (_GSet) {
  (0, _inherits3.default)(Log, _GSet);

  /**
   * Create a new Log instance
   * @param  {IPFS}           ipfs    An IPFS instance
   * @param  {String}         id      ID of the log
   * @param  {[Array<Entry>]} entries An Array of Entries from which to create the log from
   * @param  {[Array<Entry>]} heads   Set the heads of the log
   * @param  {[Clock]}        clock   Set the clock of the log
   * @return {Log}            Log
   */
  function Log(ipfs, id, entries, heads, clock, key) {
    var keys = arguments.length > 6 && arguments[6] !== undefined ? arguments[6] : [];
    (0, _classCallCheck3.default)(this, Log);

    if (!isDefined(ipfs)) {
      throw LogError.ImmutableDBNotDefinedError();
    }

    if (isDefined(entries) && !Array.isArray(entries)) {
      throw new Error('\'entries\' argument must be an array of Entry instances');
    }

    if (isDefined(heads) && !Array.isArray(heads)) {
      throw new Error('\'heads\' argument must be an array');
    }

    var _this = (0, _possibleConstructorReturn3.default)(this, (Log.__proto__ || (0, _getPrototypeOf2.default)(Log)).call(this));

    _this._storage = ipfs;
    _this._id = id || randomId

    // Signing related setup
    ();_this._keystore = _this._storage.keystore;
    _this._key = key;
    _this._keys = Array.isArray(keys) ? keys : [keys];

    // Add entries to the internal cache
    entries = entries || [];
    _this._entryIndex = entries.reduce(uniqueEntriesReducer, {}

    // Set heads if not passed as an argument
    );heads = heads || Log.findHeads(entries);
    _this._headsIndex = heads.reduce(uniqueEntriesReducer, {}

    // Index of all next pointers in this log
    );_this._nextsIndex = {};
    entries.forEach(function (e) {
      return e.next.forEach(function (a) {
        return _this._nextsIndex[a] = e.hash;
      });
    }

    // Set the length, we calculate the length manually internally
    );_this._length = entries ? entries.length : 0;

    // Set the clock
    var maxTime = Math.max(clock ? clock.time : 0, _this.heads.reduce(maxClockTimeReducer, 0));
    _this._clock = new Clock(_this.id, maxTime);
    return _this;
  }

  /**
   * Returns the ID of the log
   * @returns {string}
   */


  (0, _createClass3.default)(Log, [{
    key: 'get',


    /**
     * Find an entry
     * @param {string} [hash] The Multihash of the entry as Base58 encoded string
     * @returns {Entry|undefined}
     */
    value: function get(hash) {
      return this._entryIndex[hash];
    }
  }, {
    key: 'has',
    value: function has(entry) {
      return this._entryIndex[entry.hash || entry] !== undefined;
    }
  }, {
    key: 'traverse',
    value: function traverse(rootEntries, amount) {
      // console.log("traverse>", rootEntry)
      var stack = rootEntries.map(getNextPointers).reduce(flatMap, []);
      var traversed = {};
      var result = {};
      var count = 0;

      var addToStack = function addToStack(hash) {
        if (!result[hash] && !traversed[hash]) {
          stack.push(hash);
          traversed[hash] = true;
        }
      };

      var addRootHash = function addRootHash(rootEntry) {
        result[rootEntry.hash] = rootEntry.hash;
        traversed[rootEntry.hash] = true;
        count++;
      };

      rootEntries.forEach(addRootHash);

      while (stack.length > 0 && count < amount) {
        var hash = stack.shift();
        var entry = this.get(hash);
        if (entry) {
          count++;
          result[entry.hash] = entry.hash;
          traversed[entry.hash] = true;
          entry.next.forEach(addToStack);
        }
      }
      return result;
    }

    /**
     * Append an entry to the log
     * @param  {Entry} entry Entry to add
     * @return {Log}   New Log containing the appended value
     */

  }, {
    key: 'append',
    value: async function append(data) {
      var _this2 = this;

      var pointerCount = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 1;

      // Verify that we're allowed to append
      if (this._key && !this._keys.includes(this._key.getPublic('hex')) && !this._keys.includes('*')) {
        throw new Error("Not allowed to write");
      }

      // Update the clock (find the latest clock)
      var newTime = Math.max(this.clock.time, this.heads.reduce(maxClockTimeReducer, 0)) + 1;
      this._clock = new Clock(this.clock.id, newTime);
      // Get the required amount of hashes to next entries (as per current state of the log)
      var nexts = (0, _keys2.default)(this.traverse(this.heads, pointerCount)
      // Create the entry and add it to the internal cache
      );var entry = await Entry.create(this._storage, this.id, data, nexts, this.clock, this._key);
      this._entryIndex[entry.hash] = entry;
      nexts.forEach(function (e) {
        return _this2._nextsIndex[e] = entry.hash;
      });
      this._headsIndex = {};
      this._headsIndex[entry.hash] = entry;
      // Update the length
      this._length++;
      return entry;
    }

    /**
     * Join two logs
     *
     * @description Joins two logs returning a new log. Doesn't mutate the original logs.
     *
     * @param {IPFS}   [ipfs] An IPFS instance
     * @param {Log}    log    Log to join with this Log
     * @param {Number} [size] Max size of the joined log
     * @param {string} [id]   ID to use for the new log
     *
     * @example
     * log1.join(log2)
     *
     * @returns {Promise<Log>}
     */

  }, {
    key: 'join',
    value: async function join(log) {
      var _this3 = this;

      var size = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : -1;
      var id = arguments[2];

      if (!isDefined(log)) throw LogError.LogNotDefinedError();
      if (!Log.isLog(log)) throw LogError.NotALogError

      // Verify the entries
      // TODO: move to Entry
      ();var verifyEntries = async function verifyEntries(entries) {
        var isTrue = function isTrue(e) {
          return e === true;
        };
        var getPubKey = function getPubKey(e) {
          return e.getPublic ? e.getPublic('hex') : e;
        };
        var checkAllKeys = function checkAllKeys(keys, entry) {
          var keyMatches = function keyMatches(e) {
            return e === entry.key;
          };
          return keys.find(keyMatches);
        };
        var pubkeys = _this3._keys.map(getPubKey);

        var verify = async function verify(entry) {
          if (!entry.key) throw new Error("Entry doesn't have a public key");
          if (!entry.sig) throw new Error("Entry doesn't have a signature");

          if (_this3._keys.length === 1 && _this3._keys[0] === _this3._key) {
            if (entry.id !== _this3.id) throw new Error("Entry doesn't belong in this log (wrong ID)");
          }

          if (_this3._keys.length > 0 && !_this3._keys.includes('*') && !checkAllKeys(_this3._keys.concat([_this3._key]), entry)) {
            console.warn("Warning: Input log contains entries that are not allowed in this log. Logs weren't joined.");
            return false;
          }

          try {
            await Entry.verifyEntry(entry, _this3._keystore);
          } catch (e) {
            console.log(e);
            console.log("Couldn't verify entry:\n", entry);
            return false;
          }

          return true;
        };

        var checked = await pMap(entries, verify);
        return checked.every(isTrue);
      };

      var difference = function difference(log, exclude) {
        var stack = (0, _keys2.default)(log._headsIndex);
        var traversed = {};
        var res = {};

        var pushToStack = function pushToStack(hash) {
          if (!traversed[hash] && !exclude.get(hash)) {
            stack.push(hash);
            traversed[hash] = true;
          }
        };

        while (stack.length > 0) {
          var hash = stack.shift();
          var entry = log.get(hash);
          if (entry && !exclude.get(hash)) {
            res[entry.hash] = entry;
            traversed[entry.hash] = true;
            entry.next.forEach(pushToStack);
          }
        }
        return res;
      };

      // If id is not specified, use greater id of the two logs
      id = id ? id : [log, this].sort(function (a, b) {
        return a.id > b.id;
      })[0].id;

      // Merge the entries
      var newItems = difference(log, this

      // if a key was given, verify the entries from the incoming log
      );if (this._key) {
        var canJoin = await verifyEntries((0, _values2.default)(newItems)
        // Return early if any of the given entries didn't verify
        );if (!canJoin) return this;
      }

      // Update the internal entry index
      this._entryIndex = (0, _assign2.default)(this._entryIndex, newItems

      // Update the internal next pointers index
      );var addToNextsIndex = function addToNextsIndex(e) {
        return e.next.forEach(function (a) {
          return _this3._nextsIndex[a] = e.hash;
        });
      };
      (0, _values2.default)(newItems).forEach(addToNextsIndex

      // Update the length
      );this._length += (0, _values2.default)(newItems).length;

      // Slice to the requested size
      if (size > -1) {
        var tmp = this.values;
        tmp = tmp.slice(-size);
        this._entryIndex = tmp.reduce(uniqueEntriesReducer, {});
        this._length = (0, _values2.default)(this._entryIndex).length;
      }

      // Merge the heads
      var notReferencedByNewItems = function notReferencedByNewItems(e) {
        return !nextsFromNewItems.find(function (a) {
          return a === e.hash;
        });
      };
      var notInCurrentNexts = function notInCurrentNexts(e) {
        return !_this3._nextsIndex[e.hash];
      };
      var nextsFromNewItems = (0, _values2.default)(newItems).map(getNextPointers).reduce(flatMap, []);
      var mergedHeads = Log.findHeads((0, _values2.default)((0, _assign2.default)({}, this._headsIndex, log._headsIndex))).filter(notReferencedByNewItems).filter(notInCurrentNexts).reduce(uniqueEntriesReducer, {});

      this._headsIndex = mergedHeads;

      // Find the latest clock from the heads
      var maxClock = (0, _values2.default)(this._headsIndex).reduce(maxClockTimeReducer, 0);
      var clock = new Clock(this.id, Math.max(this.clock.time, maxClock));

      this._id = id;
      this._clock = clock;
      return this;
    }

    /**
     * Get the log in JSON format
     * @returns {Object<{heads}>}
     */

  }, {
    key: 'toJSON',
    value: function toJSON() {
      return {
        id: this.id,
        heads: this.heads.map(getHash)
      };
    }
  }, {
    key: 'toSnapshot',
    value: function toSnapshot() {
      return {
        id: this.id,
        heads: this.heads,
        values: this.values
      };
    }
    /**
     * Get the log as a Buffer
     * @returns {Buffer}
     */

  }, {
    key: 'toBuffer',
    value: function toBuffer() {
      return Buffer.from((0, _stringify2.default)(this.toJSON()));
    }

    /**
     * Returns the log entries as a formatted string
     * @example
     * two
     * └─one
     *   └─three
     * @returns {string}
     */

  }, {
    key: 'toString',
    value: function toString(payloadMapper) {
      var _this4 = this;

      return this.values.slice().reverse().map(function (e, idx) {
        var parents = Entry.findChildren(e, _this4.values);
        var len = parents.length;
        var padding = new Array(Math.max(len - 1, 0));
        padding = len > 1 ? padding.fill('  ') : padding;
        padding = len > 0 ? padding.concat(['└─']) : padding;
        return padding.join('') + (payloadMapper ? payloadMapper(e.payload) : e.payload);
      }).join('\n');
    }

    /**
     * Check whether an object is a Log instance
     * @param {Object} log An object to check
     * @returns {true|false}
     */

  }, {
    key: 'toMultihash',


    /**
     * Get the log's multihash
     * @returns {Promise<string>} Multihash of the Log as Base58 encoded string
     */
    value: function toMultihash() {
      return LogIO.toMultihash(this._storage, this);
    }

    /**
     * Create a log from multihash
     * @param {IPFS}   ipfs        An IPFS instance
     * @param {string} hash        Multihash (as a Base58 encoded string) to create the log from
     * @param {Number} [length=-1] How many items to include in the log
     * @param {Function(hash, entry, parent, depth)} onProgressCallback
     * @return {Promise<Log>}      New Log
     */

  }, {
    key: 'id',
    get: function get() {
      return this._id;
    }

    /**
     * Returns the clock of the log
     * @returns {string}
     */

  }, {
    key: 'clock',
    get: function get() {
      return this._clock;
    }

    /**
     * Returns the length of the log
     * @return {Number} Length
     */

  }, {
    key: 'length',
    get: function get() {
      return this._length;
    }

    /**
     * Returns the values in the log
     * @returns {Array<Entry>}
     */

  }, {
    key: 'values',
    get: function get() {
      return (0, _values2.default)(this._entryIndex).sort(Entry.compare) || [];
    }

    /**
     * Returns an array of heads as multihashes
     * @returns {Array<string>}
     */

  }, {
    key: 'heads',
    get: function get() {
      return (0, _values2.default)(this._headsIndex) || [];
    }

    /**
     * Returns an array of Entry objects that reference entries which
     * are not in the log currently
     * @returns {Array<Entry>}
     */

  }, {
    key: 'tails',
    get: function get() {
      return Log.findTails(this.values);
    }

    /**
     * Returns an array of multihashes that are referenced by entries which
     * are not in the log currently
     * @returns {Array<string>} Array of multihashes
     */

  }, {
    key: 'tailHashes',
    get: function get() {
      return Log.findTailHashes(this.values);
    }
  }], [{
    key: 'isLog',
    value: function isLog(log) {
      return log.id !== undefined && log.heads !== undefined && log._entryIndex !== undefined;
    }
  }, {
    key: 'fromMultihash',
    value: function fromMultihash(ipfs, hash) {
      var length = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : -1;
      var exclude = arguments[3];
      var key = arguments[4];
      var onProgressCallback = arguments[5];

      if (!isDefined(ipfs)) throw LogError.ImmutableDBNotDefinedError();
      if (!isDefined(hash)) throw new Error('Invalid hash: ' + hash);

      // TODO: need to verify the entries with 'key'
      return LogIO.fromMultihash(ipfs, hash, length, exclude, onProgressCallback).then(function (data) {
        return new Log(ipfs, data.id, data.values, data.heads, data.clock, key);
      });
    }

    /**
     * Create a log from a single entry's multihash
     * @param {IPFS}   ipfs        An IPFS instance
     * @param {string} hash        Multihash (as a Base58 encoded string) of the Entry from which to create the log from
     * @param {Number} [length=-1] How many entries to include in the log
     * @param {Function(hash, entry, parent, depth)} onProgressCallback
     * @return {Promise<Log>}      New Log
     */

  }, {
    key: 'fromEntryHash',
    value: function fromEntryHash(ipfs, hash, id) {
      var length = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : -1;
      var exclude = arguments[4];
      var key = arguments[5];
      var keys = arguments[6];
      var onProgressCallback = arguments[7];

      if (!isDefined(ipfs)) throw LogError.ImmutableDBNotDefinedError();
      if (!isDefined(hash)) throw new Error("'hash' must be defined");

      // TODO: need to verify the entries with 'key'
      return LogIO.fromEntryHash(ipfs, hash, id, length, exclude, onProgressCallback).then(function (data) {
        return new Log(ipfs, id, data.values, null, null, key, keys);
      });
    }

    /**
     * Create a log from a Log Snapshot JSON
     * @param {IPFS} ipfs          An IPFS instance
     * @param {Object} json        Log snapshot as JSON object
     * @param {Number} [length=-1] How many entries to include in the log
     * @param {Function(hash, entry, parent, depth)} [onProgressCallback]
     * @return {Promise<Log>}      New Log
     */

  }, {
    key: 'fromJSON',
    value: function fromJSON(ipfs, json) {
      var length = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : -1;
      var key = arguments[3];
      var keys = arguments[4];
      var timeout = arguments[5];
      var onProgressCallback = arguments[6];

      if (!isDefined(ipfs)) throw LogError.ImmutableDBNotDefinedError

      // TODO: need to verify the entries with 'key'
      ();return LogIO.fromJSON(ipfs, json, length, key, timeout, onProgressCallback).then(function (data) {
        return new Log(ipfs, data.id, data.values, null, null, key, keys);
      });
    }

    /**
     * Create a new log from an Entry instance
     * @param {IPFS}                ipfs          An IPFS instance
     * @param {Entry|Array<Entry>}  sourceEntries An Entry or an array of entries to fetch a log from
     * @param {Number}              [length=-1]   How many entries to include. Default: infinite.
     * @param {Array<Entry|string>} [exclude]     Array of entries or hashes or entries to not fetch (foe eg. cached entries)
     * @param {Function(hash, entry, parent, depth)} [onProgressCallback]
     * @return {Promise<Log>}       New Log
     */

  }, {
    key: 'fromEntry',
    value: function fromEntry(ipfs, sourceEntries) {
      var length = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : -1;
      var exclude = arguments[3];
      var onProgressCallback = arguments[4];

      if (!isDefined(ipfs)) throw LogError.ImmutableDBNotDefinedError();
      if (!isDefined(sourceEntries)) throw new Error("'sourceEntries' must be defined");

      // TODO: need to verify the entries with 'key'
      return LogIO.fromEntry(ipfs, sourceEntries, length, exclude, onProgressCallback).then(function (data) {
        return new Log(ipfs, data.id, data.values);
      });
    }

    /**
     * Expands the log with a specified number of new values
     *
     * @param  {IPFS}               ipfs    An IPFS instance
     * @param  {Log}                log     Log to expand
     * @param  {Entry|Array<Entry>} entries An Entry or an Array of entries to expand from
     * @param  {Number}             amount  How many new entries to include
     * @return {Promise<Log>}       New Log
     */

  }, {
    key: 'expandFrom',
    value: function expandFrom(ipfs, log, entries) {
      var amount = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : -1;

      if (!isDefined(ipfs)) throw LogError.ImmutableDBNotDefinedError();
      if (!isDefined(log)) throw LogError.LogNotDefinedError();
      if (!isDefined(entries)) throw new Error('\'entries\' must be given as argument');
      if (!Log.isLog(log)) throw LogError.NotALogError();

      return LogIO.expandFrom(ipfs, log, entries, amount).then(function (data) {
        return new Log(ipfs, log.id, data.values, null, log.clock);
      });
    }

    /**
     * Expands the log with a specified amount of Entries
     * @param  {IPFS}   ipfs   An IPFS instance
     * @param  {Log}    log    Log to expand
     * @param  {Number} amount How many new entries to include
     * @return {Promise<Log>}  New Log
     */

  }, {
    key: 'expand',
    value: function expand(ipfs, log, amount) {
      if (!isDefined(ipfs)) throw LogError.ImmutableDBNotDefinedError();
      if (!isDefined(log)) throw LogError.LogNotDefinedError();
      if (!Log.isLog(log)) throw LogError.NotALogError();

      return LogIO.expand(ipfs, log, amount).then(function (data) {
        return new Log(ipfs, log.id, data.values, log.heads, log.clock);
      });
    }

    /**
     * Find heads from a collection of entries
     *
     * @description
     * Finds entries that are the heads of this collection,
     * ie. entries that are not referenced by other entries
     *
     * @param {Array<Entry>} Entries to search heads from
     * @returns {Array<Entry>}
     */

  }, {
    key: 'findHeads',
    value: function findHeads(entries) {
      var indexReducer = function indexReducer(res, entry, idx, arr) {
        var addToResult = function addToResult(e) {
          return res[e] = entry.hash;
        };
        entry.next.forEach(addToResult);
        return res;
      };

      var items = entries.reduce(indexReducer, {});

      var exists = function exists(e) {
        return items[e.hash] === undefined;
      };
      var compareIds = function compareIds(a, b) {
        return a.id > b.id;
      };

      return entries.filter(exists).sort(compareIds);
    }

    // Find entries that point to another entry that is not in the
    // input array

  }, {
    key: 'findTails',
    value: function findTails(entries) {
      // Reverse index { next -> entry }
      var reverseIndex = {};
      // Null index containing entries that have no parents (nexts)
      var nullIndex = [];
      // Hashes for all entries for quick lookups
      var hashes = {};
      // Hashes of all next entries
      var nexts = [];

      var addToIndex = function addToIndex(e) {
        if (e.next.length === 0) {
          nullIndex.push(e);
        }
        var addToReverseIndex = function addToReverseIndex(a) {
          /* istanbul ignore else */
          if (!reverseIndex[a]) reverseIndex[a] = [];
          reverseIndex[a].push(e);
        };

        // Add all entries and their parents to the reverse index
        e.next.forEach(addToReverseIndex
        // Get all next references
        );nexts = nexts.concat(e.next
        // Get the hashes of input entries
        );hashes[e.hash] = true;
      };

      // Create our indices
      entries.forEach(addToIndex);

      var addUniques = function addUniques(res, entries, idx, arr) {
        return res.concat(_uniques(entries, 'hash'));
      };
      var exists = function exists(e) {
        return hashes[e] === undefined;
      };
      var findFromReverseIndex = function findFromReverseIndex(e) {
        return reverseIndex[e];
      };

      // Drop hashes that are not in the input entries
      var tails = nexts // For every multihash in nexts:
      .filter(exists // Remove undefineds and nulls
      ).map(findFromReverseIndex // Get the Entry from the reverse index
      ).reduce(addUniques, [] // Flatten the result and take only uniques
      ).concat(nullIndex // Combine with tails the have no next refs (ie. first-in-their-chain)

      );return _uniques(tails, 'hash').sort(Entry.compare);
    }

    // Find the hashes to entries that are not in a collection
    // but referenced by other entries

  }, {
    key: 'findTailHashes',
    value: function findTailHashes(entries) {
      var hashes = {};
      var addToIndex = function addToIndex(e) {
        return hashes[e.hash] = true;
      };

      var reduceTailHashes = function reduceTailHashes(res, entry, idx, arr) {
        var addToResult = function addToResult(e) {
          /* istanbul ignore else */
          if (hashes[e] === undefined) {
            res.splice(0, 0, e);
          }
        };
        entry.next.reverse().forEach(addToResult);
        return res;
      };

      entries.forEach(addToIndex);
      return entries.reduce(reduceTailHashes, []);
    }
  }]);
  return Log;
}(GSet);

module.exports = Log;