"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/better-sqlite3/lib/util.js
var require_util = __commonJS({
  "node_modules/better-sqlite3/lib/util.js"(exports2) {
    "use strict";
    exports2.getBooleanOption = (options, key) => {
      let value = false;
      if (key in options && typeof (value = options[key]) !== "boolean") {
        throw new TypeError(`Expected the "${key}" option to be a boolean`);
      }
      return value;
    };
    exports2.cppdb = /* @__PURE__ */ Symbol();
    exports2.inspect = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
  }
});

// node_modules/better-sqlite3/lib/sqlite-error.js
var require_sqlite_error = __commonJS({
  "node_modules/better-sqlite3/lib/sqlite-error.js"(exports2, module2) {
    "use strict";
    var descriptor = { value: "SqliteError", writable: true, enumerable: false, configurable: true };
    function SqliteError(message, code) {
      if (new.target !== SqliteError) {
        return new SqliteError(message, code);
      }
      if (typeof code !== "string") {
        throw new TypeError("Expected second argument to be a string");
      }
      Error.call(this, message);
      descriptor.value = "" + message;
      Object.defineProperty(this, "message", descriptor);
      Error.captureStackTrace(this, SqliteError);
      this.code = code;
    }
    Object.setPrototypeOf(SqliteError, Error);
    Object.setPrototypeOf(SqliteError.prototype, Error.prototype);
    Object.defineProperty(SqliteError.prototype, "name", descriptor);
    module2.exports = SqliteError;
  }
});

// node_modules/file-uri-to-path/index.js
var require_file_uri_to_path = __commonJS({
  "node_modules/file-uri-to-path/index.js"(exports2, module2) {
    var sep2 = require("path").sep || "/";
    module2.exports = fileUriToPath;
    function fileUriToPath(uri) {
      if ("string" != typeof uri || uri.length <= 7 || "file://" != uri.substring(0, 7)) {
        throw new TypeError("must pass in a file:// URI to convert to a file path");
      }
      var rest = decodeURI(uri.substring(7));
      var firstSlash = rest.indexOf("/");
      var host = rest.substring(0, firstSlash);
      var path = rest.substring(firstSlash + 1);
      if ("localhost" == host) host = "";
      if (host) {
        host = sep2 + sep2 + host;
      }
      path = path.replace(/^(.+)\|/, "$1:");
      if (sep2 == "\\") {
        path = path.replace(/\//g, "\\");
      }
      if (/^.+\:/.test(path)) {
      } else {
        path = sep2 + path;
      }
      return host + path;
    }
  }
});

// node_modules/bindings/bindings.js
var require_bindings = __commonJS({
  "node_modules/bindings/bindings.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var fileURLToPath2 = require_file_uri_to_path();
    var join4 = path.join;
    var dirname3 = path.dirname;
    var exists = fs.accessSync && function(path2) {
      try {
        fs.accessSync(path2);
      } catch (e) {
        return false;
      }
      return true;
    } || fs.existsSync || path.existsSync;
    var defaults2 = {
      arrow: process.env.NODE_BINDINGS_ARROW || " \u2192 ",
      compiled: process.env.NODE_BINDINGS_COMPILED_DIR || "compiled",
      platform: process.platform,
      arch: process.arch,
      nodePreGyp: "node-v" + process.versions.modules + "-" + process.platform + "-" + process.arch,
      version: process.versions.node,
      bindings: "bindings.node",
      try: [
        // node-gyp's linked version in the "build" dir
        ["module_root", "build", "bindings"],
        // node-waf and gyp_addon (a.k.a node-gyp)
        ["module_root", "build", "Debug", "bindings"],
        ["module_root", "build", "Release", "bindings"],
        // Debug files, for development (legacy behavior, remove for node v0.9)
        ["module_root", "out", "Debug", "bindings"],
        ["module_root", "Debug", "bindings"],
        // Release files, but manually compiled (legacy behavior, remove for node v0.9)
        ["module_root", "out", "Release", "bindings"],
        ["module_root", "Release", "bindings"],
        // Legacy from node-waf, node <= 0.4.x
        ["module_root", "build", "default", "bindings"],
        // Production "Release" buildtype binary (meh...)
        ["module_root", "compiled", "version", "platform", "arch", "bindings"],
        // node-qbs builds
        ["module_root", "addon-build", "release", "install-root", "bindings"],
        ["module_root", "addon-build", "debug", "install-root", "bindings"],
        ["module_root", "addon-build", "default", "install-root", "bindings"],
        // node-pre-gyp path ./lib/binding/{node_abi}-{platform}-{arch}
        ["module_root", "lib", "binding", "nodePreGyp", "bindings"]
      ]
    };
    function bindings(opts) {
      if (typeof opts == "string") {
        opts = { bindings: opts };
      } else if (!opts) {
        opts = {};
      }
      Object.keys(defaults2).map(function(i2) {
        if (!(i2 in opts)) opts[i2] = defaults2[i2];
      });
      if (!opts.module_root) {
        opts.module_root = exports2.getRoot(exports2.getFileName());
      }
      if (path.extname(opts.bindings) != ".node") {
        opts.bindings += ".node";
      }
      var requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
      var tries = [], i = 0, l = opts.try.length, n, b, err;
      for (; i < l; i++) {
        n = join4.apply(
          null,
          opts.try[i].map(function(p) {
            return opts[p] || p;
          })
        );
        tries.push(n);
        try {
          b = opts.path ? requireFunc.resolve(n) : requireFunc(n);
          if (!opts.path) {
            b.path = n;
          }
          return b;
        } catch (e) {
          if (e.code !== "MODULE_NOT_FOUND" && e.code !== "QUALIFIED_PATH_RESOLUTION_FAILED" && !/not find/i.test(e.message)) {
            throw e;
          }
        }
      }
      err = new Error(
        "Could not locate the bindings file. Tried:\n" + tries.map(function(a) {
          return opts.arrow + a;
        }).join("\n")
      );
      err.tries = tries;
      throw err;
    }
    module2.exports = exports2 = bindings;
    exports2.getFileName = function getFileName(calling_file) {
      var origPST = Error.prepareStackTrace, origSTL = Error.stackTraceLimit, dummy = {}, fileName;
      Error.stackTraceLimit = 10;
      Error.prepareStackTrace = function(e, st) {
        for (var i = 0, l = st.length; i < l; i++) {
          fileName = st[i].getFileName();
          if (fileName !== __filename) {
            if (calling_file) {
              if (fileName !== calling_file) {
                return;
              }
            } else {
              return;
            }
          }
        }
      };
      Error.captureStackTrace(dummy);
      dummy.stack;
      Error.prepareStackTrace = origPST;
      Error.stackTraceLimit = origSTL;
      var fileSchema = "file://";
      if (fileName.indexOf(fileSchema) === 0) {
        fileName = fileURLToPath2(fileName);
      }
      return fileName;
    };
    exports2.getRoot = function getRoot(file) {
      var dir = dirname3(file), prev;
      while (true) {
        if (dir === ".") {
          dir = process.cwd();
        }
        if (exists(join4(dir, "package.json")) || exists(join4(dir, "node_modules"))) {
          return dir;
        }
        if (prev === dir) {
          throw new Error(
            'Could not find module root given file: "' + file + '". Do you have a `package.json` file? '
          );
        }
        prev = dir;
        dir = join4(dir, "..");
      }
    };
  }
});

// node_modules/better-sqlite3/lib/methods/wrappers.js
var require_wrappers = __commonJS({
  "node_modules/better-sqlite3/lib/methods/wrappers.js"(exports2) {
    "use strict";
    var { cppdb } = require_util();
    exports2.prepare = function prepare(sql) {
      return this[cppdb].prepare(sql, this, false);
    };
    exports2.exec = function exec(sql) {
      this[cppdb].exec(sql);
      return this;
    };
    exports2.close = function close() {
      this[cppdb].close();
      return this;
    };
    exports2.loadExtension = function loadExtension(...args) {
      this[cppdb].loadExtension(...args);
      return this;
    };
    exports2.defaultSafeIntegers = function defaultSafeIntegers(...args) {
      this[cppdb].defaultSafeIntegers(...args);
      return this;
    };
    exports2.unsafeMode = function unsafeMode(...args) {
      this[cppdb].unsafeMode(...args);
      return this;
    };
    exports2.getters = {
      name: {
        get: function name() {
          return this[cppdb].name;
        },
        enumerable: true
      },
      open: {
        get: function open() {
          return this[cppdb].open;
        },
        enumerable: true
      },
      inTransaction: {
        get: function inTransaction() {
          return this[cppdb].inTransaction;
        },
        enumerable: true
      },
      readonly: {
        get: function readonly() {
          return this[cppdb].readonly;
        },
        enumerable: true
      },
      memory: {
        get: function memory() {
          return this[cppdb].memory;
        },
        enumerable: true
      }
    };
  }
});

// node_modules/better-sqlite3/lib/methods/transaction.js
var require_transaction = __commonJS({
  "node_modules/better-sqlite3/lib/methods/transaction.js"(exports2, module2) {
    "use strict";
    var { cppdb } = require_util();
    var controllers = /* @__PURE__ */ new WeakMap();
    module2.exports = function transaction(fn) {
      if (typeof fn !== "function") throw new TypeError("Expected first argument to be a function");
      const db = this[cppdb];
      const controller = getController(db, this);
      const { apply } = Function.prototype;
      const properties = {
        default: { value: wrapTransaction(apply, fn, db, controller.default) },
        deferred: { value: wrapTransaction(apply, fn, db, controller.deferred) },
        immediate: { value: wrapTransaction(apply, fn, db, controller.immediate) },
        exclusive: { value: wrapTransaction(apply, fn, db, controller.exclusive) },
        database: { value: this, enumerable: true }
      };
      Object.defineProperties(properties.default.value, properties);
      Object.defineProperties(properties.deferred.value, properties);
      Object.defineProperties(properties.immediate.value, properties);
      Object.defineProperties(properties.exclusive.value, properties);
      return properties.default.value;
    };
    var getController = (db, self) => {
      let controller = controllers.get(db);
      if (!controller) {
        const shared = {
          commit: db.prepare("COMMIT", self, false),
          rollback: db.prepare("ROLLBACK", self, false),
          savepoint: db.prepare("SAVEPOINT `	_bs3.	`", self, false),
          release: db.prepare("RELEASE `	_bs3.	`", self, false),
          rollbackTo: db.prepare("ROLLBACK TO `	_bs3.	`", self, false)
        };
        controllers.set(db, controller = {
          default: Object.assign({ begin: db.prepare("BEGIN", self, false) }, shared),
          deferred: Object.assign({ begin: db.prepare("BEGIN DEFERRED", self, false) }, shared),
          immediate: Object.assign({ begin: db.prepare("BEGIN IMMEDIATE", self, false) }, shared),
          exclusive: Object.assign({ begin: db.prepare("BEGIN EXCLUSIVE", self, false) }, shared)
        });
      }
      return controller;
    };
    var wrapTransaction = (apply, fn, db, { begin, commit, rollback, savepoint, release, rollbackTo }) => function sqliteTransaction() {
      let before, after, undo;
      if (db.inTransaction) {
        before = savepoint;
        after = release;
        undo = rollbackTo;
      } else {
        before = begin;
        after = commit;
        undo = rollback;
      }
      before.run();
      try {
        const result = apply.call(fn, this, arguments);
        if (result && typeof result.then === "function") {
          throw new TypeError("Transaction function cannot return a promise");
        }
        after.run();
        return result;
      } catch (ex) {
        if (db.inTransaction) {
          undo.run();
          if (undo !== rollback) after.run();
        }
        throw ex;
      }
    };
  }
});

// node_modules/better-sqlite3/lib/methods/pragma.js
var require_pragma = __commonJS({
  "node_modules/better-sqlite3/lib/methods/pragma.js"(exports2, module2) {
    "use strict";
    var { getBooleanOption, cppdb } = require_util();
    module2.exports = function pragma(source, options) {
      if (options == null) options = {};
      if (typeof source !== "string") throw new TypeError("Expected first argument to be a string");
      if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
      const simple = getBooleanOption(options, "simple");
      const stmt = this[cppdb].prepare(`PRAGMA ${source}`, this, true);
      return simple ? stmt.pluck().get() : stmt.all();
    };
  }
});

// node_modules/better-sqlite3/lib/methods/backup.js
var require_backup = __commonJS({
  "node_modules/better-sqlite3/lib/methods/backup.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path = require("path");
    var { promisify } = require("util");
    var { cppdb } = require_util();
    var fsAccess = promisify(fs.access);
    module2.exports = async function backup(filename, options) {
      if (options == null) options = {};
      if (typeof filename !== "string") throw new TypeError("Expected first argument to be a string");
      if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
      filename = filename.trim();
      const attachedName = "attached" in options ? options.attached : "main";
      const handler = "progress" in options ? options.progress : null;
      if (!filename) throw new TypeError("Backup filename cannot be an empty string");
      if (filename === ":memory:") throw new TypeError('Invalid backup filename ":memory:"');
      if (typeof attachedName !== "string") throw new TypeError('Expected the "attached" option to be a string');
      if (!attachedName) throw new TypeError('The "attached" option cannot be an empty string');
      if (handler != null && typeof handler !== "function") throw new TypeError('Expected the "progress" option to be a function');
      await fsAccess(path.dirname(filename)).catch(() => {
        throw new TypeError("Cannot save backup because the directory does not exist");
      });
      const isNewFile = await fsAccess(filename).then(() => false, () => true);
      return runBackup(this[cppdb].backup(this, attachedName, filename, isNewFile), handler || null);
    };
    var runBackup = (backup, handler) => {
      let rate = 0;
      let useDefault = true;
      return new Promise((resolve3, reject) => {
        setImmediate(function step() {
          try {
            const progress = backup.transfer(rate);
            if (!progress.remainingPages) {
              backup.close();
              resolve3(progress);
              return;
            }
            if (useDefault) {
              useDefault = false;
              rate = 100;
            }
            if (handler) {
              const ret = handler(progress);
              if (ret !== void 0) {
                if (typeof ret === "number" && ret === ret) rate = Math.max(0, Math.min(2147483647, Math.round(ret)));
                else throw new TypeError("Expected progress callback to return a number or undefined");
              }
            }
            setImmediate(step);
          } catch (err) {
            backup.close();
            reject(err);
          }
        });
      });
    };
  }
});

// node_modules/better-sqlite3/lib/methods/serialize.js
var require_serialize = __commonJS({
  "node_modules/better-sqlite3/lib/methods/serialize.js"(exports2, module2) {
    "use strict";
    var { cppdb } = require_util();
    module2.exports = function serialize(options) {
      if (options == null) options = {};
      if (typeof options !== "object") throw new TypeError("Expected first argument to be an options object");
      const attachedName = "attached" in options ? options.attached : "main";
      if (typeof attachedName !== "string") throw new TypeError('Expected the "attached" option to be a string');
      if (!attachedName) throw new TypeError('The "attached" option cannot be an empty string');
      return this[cppdb].serialize(attachedName);
    };
  }
});

// node_modules/better-sqlite3/lib/methods/function.js
var require_function = __commonJS({
  "node_modules/better-sqlite3/lib/methods/function.js"(exports2, module2) {
    "use strict";
    var { getBooleanOption, cppdb } = require_util();
    module2.exports = function defineFunction(name, options, fn) {
      if (options == null) options = {};
      if (typeof options === "function") {
        fn = options;
        options = {};
      }
      if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
      if (typeof fn !== "function") throw new TypeError("Expected last argument to be a function");
      if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
      if (!name) throw new TypeError("User-defined function name cannot be an empty string");
      const safeIntegers = "safeIntegers" in options ? +getBooleanOption(options, "safeIntegers") : 2;
      const deterministic = getBooleanOption(options, "deterministic");
      const directOnly = getBooleanOption(options, "directOnly");
      const varargs = getBooleanOption(options, "varargs");
      let argCount = -1;
      if (!varargs) {
        argCount = fn.length;
        if (!Number.isInteger(argCount) || argCount < 0) throw new TypeError("Expected function.length to be a positive integer");
        if (argCount > 100) throw new RangeError("User-defined functions cannot have more than 100 arguments");
      }
      this[cppdb].function(fn, name, argCount, safeIntegers, deterministic, directOnly);
      return this;
    };
  }
});

// node_modules/better-sqlite3/lib/methods/aggregate.js
var require_aggregate = __commonJS({
  "node_modules/better-sqlite3/lib/methods/aggregate.js"(exports2, module2) {
    "use strict";
    var { getBooleanOption, cppdb } = require_util();
    module2.exports = function defineAggregate(name, options) {
      if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
      if (typeof options !== "object" || options === null) throw new TypeError("Expected second argument to be an options object");
      if (!name) throw new TypeError("User-defined function name cannot be an empty string");
      const start = "start" in options ? options.start : null;
      const step = getFunctionOption(options, "step", true);
      const inverse = getFunctionOption(options, "inverse", false);
      const result = getFunctionOption(options, "result", false);
      const safeIntegers = "safeIntegers" in options ? +getBooleanOption(options, "safeIntegers") : 2;
      const deterministic = getBooleanOption(options, "deterministic");
      const directOnly = getBooleanOption(options, "directOnly");
      const varargs = getBooleanOption(options, "varargs");
      let argCount = -1;
      if (!varargs) {
        argCount = Math.max(getLength(step), inverse ? getLength(inverse) : 0);
        if (argCount > 0) argCount -= 1;
        if (argCount > 100) throw new RangeError("User-defined functions cannot have more than 100 arguments");
      }
      this[cppdb].aggregate(start, step, inverse, result, name, argCount, safeIntegers, deterministic, directOnly);
      return this;
    };
    var getFunctionOption = (options, key, required) => {
      const value = key in options ? options[key] : null;
      if (typeof value === "function") return value;
      if (value != null) throw new TypeError(`Expected the "${key}" option to be a function`);
      if (required) throw new TypeError(`Missing required option "${key}"`);
      return null;
    };
    var getLength = ({ length }) => {
      if (Number.isInteger(length) && length >= 0) return length;
      throw new TypeError("Expected function.length to be a positive integer");
    };
  }
});

// node_modules/better-sqlite3/lib/methods/table.js
var require_table = __commonJS({
  "node_modules/better-sqlite3/lib/methods/table.js"(exports2, module2) {
    "use strict";
    var { cppdb } = require_util();
    module2.exports = function defineTable(name, factory) {
      if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
      if (!name) throw new TypeError("Virtual table module name cannot be an empty string");
      let eponymous = false;
      if (typeof factory === "object" && factory !== null) {
        eponymous = true;
        factory = defer(parseTableDefinition(factory, "used", name));
      } else {
        if (typeof factory !== "function") throw new TypeError("Expected second argument to be a function or a table definition object");
        factory = wrapFactory(factory);
      }
      this[cppdb].table(factory, name, eponymous);
      return this;
    };
    function wrapFactory(factory) {
      return function virtualTableFactory(moduleName, databaseName, tableName, ...args) {
        const thisObject = {
          module: moduleName,
          database: databaseName,
          table: tableName
        };
        const def = apply.call(factory, thisObject, args);
        if (typeof def !== "object" || def === null) {
          throw new TypeError(`Virtual table module "${moduleName}" did not return a table definition object`);
        }
        return parseTableDefinition(def, "returned", moduleName);
      };
    }
    function parseTableDefinition(def, verb, moduleName) {
      if (!hasOwnProperty.call(def, "rows")) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition without a "rows" property`);
      }
      if (!hasOwnProperty.call(def, "columns")) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition without a "columns" property`);
      }
      const rows = def.rows;
      if (typeof rows !== "function" || Object.getPrototypeOf(rows) !== GeneratorFunctionPrototype) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "rows" property (should be a generator function)`);
      }
      let columns = def.columns;
      if (!Array.isArray(columns) || !(columns = [...columns]).every((x) => typeof x === "string")) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "columns" property (should be an array of strings)`);
      }
      if (columns.length !== new Set(columns).size) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with duplicate column names`);
      }
      if (!columns.length) {
        throw new RangeError(`Virtual table module "${moduleName}" ${verb} a table definition with zero columns`);
      }
      let parameters;
      if (hasOwnProperty.call(def, "parameters")) {
        parameters = def.parameters;
        if (!Array.isArray(parameters) || !(parameters = [...parameters]).every((x) => typeof x === "string")) {
          throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "parameters" property (should be an array of strings)`);
        }
      } else {
        parameters = inferParameters(rows);
      }
      if (parameters.length !== new Set(parameters).size) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with duplicate parameter names`);
      }
      if (parameters.length > 32) {
        throw new RangeError(`Virtual table module "${moduleName}" ${verb} a table definition with more than the maximum number of 32 parameters`);
      }
      for (const parameter of parameters) {
        if (columns.includes(parameter)) {
          throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with column "${parameter}" which was ambiguously defined as both a column and parameter`);
        }
      }
      let safeIntegers = 2;
      if (hasOwnProperty.call(def, "safeIntegers")) {
        const bool = def.safeIntegers;
        if (typeof bool !== "boolean") {
          throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "safeIntegers" property (should be a boolean)`);
        }
        safeIntegers = +bool;
      }
      let directOnly = false;
      if (hasOwnProperty.call(def, "directOnly")) {
        directOnly = def.directOnly;
        if (typeof directOnly !== "boolean") {
          throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "directOnly" property (should be a boolean)`);
        }
      }
      const columnDefinitions = [
        ...parameters.map(identifier).map((str) => `${str} HIDDEN`),
        ...columns.map(identifier)
      ];
      return [
        `CREATE TABLE x(${columnDefinitions.join(", ")});`,
        wrapGenerator(rows, new Map(columns.map((x, i) => [x, parameters.length + i])), moduleName),
        parameters,
        safeIntegers,
        directOnly
      ];
    }
    function wrapGenerator(generator, columnMap, moduleName) {
      return function* virtualTable(...args) {
        const output = args.map((x) => Buffer.isBuffer(x) ? Buffer.from(x) : x);
        for (let i = 0; i < columnMap.size; ++i) {
          output.push(null);
        }
        for (const row of generator(...args)) {
          if (Array.isArray(row)) {
            extractRowArray(row, output, columnMap.size, moduleName);
            yield output;
          } else if (typeof row === "object" && row !== null) {
            extractRowObject(row, output, columnMap, moduleName);
            yield output;
          } else {
            throw new TypeError(`Virtual table module "${moduleName}" yielded something that isn't a valid row object`);
          }
        }
      };
    }
    function extractRowArray(row, output, columnCount, moduleName) {
      if (row.length !== columnCount) {
        throw new TypeError(`Virtual table module "${moduleName}" yielded a row with an incorrect number of columns`);
      }
      const offset = output.length - columnCount;
      for (let i = 0; i < columnCount; ++i) {
        output[i + offset] = row[i];
      }
    }
    function extractRowObject(row, output, columnMap, moduleName) {
      let count = 0;
      for (const key of Object.keys(row)) {
        const index = columnMap.get(key);
        if (index === void 0) {
          throw new TypeError(`Virtual table module "${moduleName}" yielded a row with an undeclared column "${key}"`);
        }
        output[index] = row[key];
        count += 1;
      }
      if (count !== columnMap.size) {
        throw new TypeError(`Virtual table module "${moduleName}" yielded a row with missing columns`);
      }
    }
    function inferParameters({ length }) {
      if (!Number.isInteger(length) || length < 0) {
        throw new TypeError("Expected function.length to be a positive integer");
      }
      const params = [];
      for (let i = 0; i < length; ++i) {
        params.push(`$${i + 1}`);
      }
      return params;
    }
    var { hasOwnProperty } = Object.prototype;
    var { apply } = Function.prototype;
    var GeneratorFunctionPrototype = Object.getPrototypeOf(function* () {
    });
    var identifier = (str) => `"${str.replace(/"/g, '""')}"`;
    var defer = (x) => () => x;
  }
});

// node_modules/better-sqlite3/lib/methods/inspect.js
var require_inspect = __commonJS({
  "node_modules/better-sqlite3/lib/methods/inspect.js"(exports2, module2) {
    "use strict";
    var DatabaseInspection = function Database2() {
    };
    module2.exports = function inspect(depth, opts) {
      return Object.assign(new DatabaseInspection(), this);
    };
  }
});

// node_modules/better-sqlite3/lib/database.js
var require_database = __commonJS({
  "node_modules/better-sqlite3/lib/database.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path = require("path");
    var util = require_util();
    var SqliteError = require_sqlite_error();
    var DEFAULT_ADDON;
    function Database2(filenameGiven, options) {
      if (new.target == null) {
        return new Database2(filenameGiven, options);
      }
      let buffer;
      if (Buffer.isBuffer(filenameGiven)) {
        buffer = filenameGiven;
        filenameGiven = ":memory:";
      }
      if (filenameGiven == null) filenameGiven = "";
      if (options == null) options = {};
      if (typeof filenameGiven !== "string") throw new TypeError("Expected first argument to be a string");
      if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
      if ("readOnly" in options) throw new TypeError('Misspelled option "readOnly" should be "readonly"');
      if ("memory" in options) throw new TypeError('Option "memory" was removed in v7.0.0 (use ":memory:" filename instead)');
      const filename = filenameGiven.trim();
      const anonymous = filename === "" || filename === ":memory:";
      const readonly = util.getBooleanOption(options, "readonly");
      const fileMustExist = util.getBooleanOption(options, "fileMustExist");
      const timeout = "timeout" in options ? options.timeout : 5e3;
      const verbose = "verbose" in options ? options.verbose : null;
      const nativeBinding = "nativeBinding" in options ? options.nativeBinding : null;
      if (readonly && anonymous && !buffer) throw new TypeError("In-memory/temporary databases cannot be readonly");
      if (!Number.isInteger(timeout) || timeout < 0) throw new TypeError('Expected the "timeout" option to be a positive integer');
      if (timeout > 2147483647) throw new RangeError('Option "timeout" cannot be greater than 2147483647');
      if (verbose != null && typeof verbose !== "function") throw new TypeError('Expected the "verbose" option to be a function');
      if (nativeBinding != null && typeof nativeBinding !== "string" && typeof nativeBinding !== "object") throw new TypeError('Expected the "nativeBinding" option to be a string or addon object');
      let addon;
      if (nativeBinding == null) {
        addon = DEFAULT_ADDON || (DEFAULT_ADDON = require_bindings()("better_sqlite3.node"));
      } else if (typeof nativeBinding === "string") {
        const requireFunc = typeof __non_webpack_require__ === "function" ? __non_webpack_require__ : require;
        addon = requireFunc(path.resolve(nativeBinding).replace(/(\.node)?$/, ".node"));
      } else {
        addon = nativeBinding;
      }
      if (!addon.isInitialized) {
        addon.setErrorConstructor(SqliteError);
        addon.isInitialized = true;
      }
      if (!anonymous && !filename.startsWith("file:") && !fs.existsSync(path.dirname(filename))) {
        throw new TypeError("Cannot open database because the directory does not exist");
      }
      Object.defineProperties(this, {
        [util.cppdb]: { value: new addon.Database(filename, filenameGiven, anonymous, readonly, fileMustExist, timeout, verbose || null, buffer || null) },
        ...wrappers.getters
      });
    }
    var wrappers = require_wrappers();
    Database2.prototype.prepare = wrappers.prepare;
    Database2.prototype.transaction = require_transaction();
    Database2.prototype.pragma = require_pragma();
    Database2.prototype.backup = require_backup();
    Database2.prototype.serialize = require_serialize();
    Database2.prototype.function = require_function();
    Database2.prototype.aggregate = require_aggregate();
    Database2.prototype.table = require_table();
    Database2.prototype.loadExtension = wrappers.loadExtension;
    Database2.prototype.exec = wrappers.exec;
    Database2.prototype.close = wrappers.close;
    Database2.prototype.defaultSafeIntegers = wrappers.defaultSafeIntegers;
    Database2.prototype.unsafeMode = wrappers.unsafeMode;
    Database2.prototype[util.inspect] = require_inspect();
    module2.exports = Database2;
  }
});

// node_modules/better-sqlite3/lib/index.js
var require_lib = __commonJS({
  "node_modules/better-sqlite3/lib/index.js"(exports2, module2) {
    "use strict";
    module2.exports = require_database();
    module2.exports.SqliteError = require_sqlite_error();
  }
});

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TranscriptMemoryVaultPlugin
});
module.exports = __toCommonJS(main_exports);

// src/obsidian/Plugin.ts
var import_obsidian5 = require("obsidian");
var import_node_fs3 = require("node:fs");
var import_node_path6 = require("node:path");

// src/db/connection.ts
var import_better_sqlite3 = __toESM(require_lib(), 1);

// src/db/migrations/index.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_url = require("node:url");
var defaultMigrationDirectory = () => (0, import_node_path.dirname)((0, import_node_url.fileURLToPath)("file:///__TRANSCRIPT_MEMORY_BUNDLE__/index.js"));
var PACKAGED_MIGRATIONS = [
  { id: "001", name: "initial_schema", filename: "001_initial_schema.sql" },
  { id: "002", name: "tighten_transcript_immutability", filename: "002_tighten_transcript_immutability.sql" },
  { id: "003", name: "transcript_ingestion", filename: "003_transcript_ingestion.sql" },
  { id: "004", name: "provenance_pointers", filename: "004_provenance_pointers.sql" },
  { id: "005", name: "memory_extraction", filename: "005_memory_extraction.sql" },
  { id: "006", name: "canonical_memory_status", filename: "006_canonical_memory_status.sql" },
  { id: "007", name: "search_retrieval", filename: "007_search_retrieval.sql" },
  { id: "008", name: "evidence_quality_scoring", filename: "008_evidence_quality_scoring.sql" },
  { id: "009", name: "ask_ai_pipeline", filename: "009_ask_ai_pipeline.sql" },
  { id: "010", name: "conflict_detection", filename: "010_conflict_detection.sql" },
  { id: "011", name: "agent_orchestration_hermes", filename: "011_agent_orchestration_hermes.sql" },
  { id: "012", name: "obsidian_views", filename: "012_obsidian_views.sql" },
  { id: "013", name: "ask_ai_claim_support", filename: "013_ask_ai_claim_support.sql" }
];
var PACKAGED_MIGRATION_COUNT = PACKAGED_MIGRATIONS.length;
function validateMigrationPackage(directory = defaultMigrationDirectory()) {
  const missing = PACKAGED_MIGRATIONS.map((migration) => migration.filename).filter((filename) => !(0, import_node_fs.existsSync)((0, import_node_path.join)(directory, filename)));
  return missing.length ? { ok: false, count: PACKAGED_MIGRATION_COUNT, missing } : { ok: true, count: PACKAGED_MIGRATION_COUNT };
}
function runMigrations(db, options = {}) {
  const directory = options.directory ?? defaultMigrationDirectory();
  const packageStatus = validateMigrationPackage(directory);
  if (!packageStatus.ok) throw new Error(`Missing packaged migrations: ${packageStatus.missing.join(", ")}`);
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const migration of PACKAGED_MIGRATIONS) {
    const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(migration.id);
    if (!applied) {
      db.transaction(() => {
        db.exec((0, import_node_fs.readFileSync)((0, import_node_path.join)(directory, migration.filename), "utf8"));
        db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, (/* @__PURE__ */ new Date()).toISOString());
      })();
    }
  }
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(search_text, content='search_documents', content_rowid='rowid')");
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS search_documents_ai AFTER INSERT ON search_documents BEGIN
        INSERT INTO search_documents_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
      END;
      CREATE TRIGGER IF NOT EXISTS search_documents_ad AFTER DELETE ON search_documents BEGIN
        INSERT INTO search_documents_fts(search_documents_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
      END;
      CREATE TRIGGER IF NOT EXISTS search_documents_au AFTER UPDATE ON search_documents BEGIN
        INSERT INTO search_documents_fts(search_documents_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
        INSERT INTO search_documents_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
      END;
    `);
  } catch {
  }
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_documents_fts USING fts5(
      target_type UNINDEXED,target_id UNINDEXED,title,search_text,speaker_name,topic_text,tokenize='unicode61'
    )`);
  } catch {
  }
}

// src/db/connection.ts
function openDatabase(filename = ":memory:", options = {}) {
  const sqliteOptions = {};
  if (options.readonly !== void 0) sqliteOptions.readonly = options.readonly;
  if (options.fileMustExist !== void 0) sqliteOptions.fileMustExist = options.fileMustExist;
  if (options.nativeBinding !== void 0) sqliteOptions.nativeBinding = options.nativeBinding;
  const db = new import_better_sqlite3.default(filename, sqliteOptions);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (filename !== ":memory:" && !options.readonly) {
    db.pragma("journal_mode = WAL");
  }
  if (options.runMigrations !== false && !options.readonly) {
    runMigrations(db, { directory: options.migrationDirectory });
  }
  return db;
}

// src/db/errors.ts
var DatabaseError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = new.target.name;
  }
};
var DuplicateContentError = class extends DatabaseError {
};
var NotFoundError = class extends DatabaseError {
};
var ValidationError = class extends DatabaseError {
};
var EvidenceRequiredError = class extends ValidationError {
};
var InvalidEvidenceError = class extends ValidationError {
};

// src/db/ids.ts
var import_node_crypto = require("node:crypto");
function createId(prefix) {
  return `${prefix}${(0, import_node_crypto.randomBytes)(16).toString("base64url")}`;
}
function contentHash(text) {
  return (0, import_node_crypto.createHash)("sha256").update(text).digest("hex");
}

// src/db/utils.ts
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var json = (value = {}) => JSON.stringify(value);
function parseRow(row) {
  if (!row) return null;
  const result = { ...row };
  for (const key of ["metadata_json", "input_json", "output_json", "error_json", "old_value_json", "new_value_json", "embedding_json"]) {
    if (key in result) {
      const target = key.replace(/_json$/, "");
      result[target] = result[key] == null ? null : JSON.parse(String(result[key]));
      delete result[key];
    }
  }
  return result;
}
function parseRows(rows) {
  return rows.map((row) => parseRow(row));
}
function assertScore(value, field) {
  if (value != null && (value < 0 || value > 1 || !Number.isFinite(value))) {
    throw new ValidationError(`${field} must be between 0 and 1`);
  }
}
function requireRow(db, table, id) {
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new NotFoundError(`${table} row not found: ${id}`);
}
function metadataHasMissingEvidence(metadata) {
  return metadata?.reason === "missing_evidence" || metadata?.missing_evidence_reason != null;
}

// src/db/repositories/transcriptsRepo.ts
function createTranscriptsRepo(db) {
  return {
    createTranscriptSource(input) {
      const row = { id: input.id ?? createId("src_"), ...input, original_filename: input.original_filename ?? null, created_at: now(), metadata_json: json(input.metadata) };
      try {
        db.prepare(`INSERT INTO transcript_sources(id,source_type,original_filename,raw_storage_uri,content_hash,byte_length,created_at,metadata_json)
          VALUES (@id,@source_type,@original_filename,@raw_storage_uri,@content_hash,@byte_length,@created_at,@metadata_json)`).run(row);
      } catch (error) {
        if (String(error).includes("content_hash")) throw new DuplicateContentError(`Transcript source content already exists: ${input.content_hash}`, { cause: error });
        throw error;
      }
      return parseRow(db.prepare("SELECT * FROM transcript_sources WHERE id = ?").get(row.id));
    },
    createTranscript(input) {
      const timestamp = now();
      const row = { id: input.id ?? createId("tr_"), source_id: input.source_id, title: input.title, language: input.language ?? null, status: input.status ?? "imported", content_hash: input.content_hash, imported_at: timestamp, updated_at: timestamp, metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO transcripts(id,source_id,title,language,status,content_hash,imported_at,updated_at,metadata_json)
        VALUES (@id,@source_id,@title,@language,@status,@content_hash,@imported_at,@updated_at,@metadata_json)`).run(row);
      return parseRow(db.prepare("SELECT * FROM transcripts WHERE id = ?").get(row.id));
    },
    getTranscript(id) {
      return parseRow(db.prepare("SELECT * FROM transcripts WHERE id = ?").get(id));
    },
    findTranscriptByContentHash(hash) {
      return parseRow(db.prepare("SELECT * FROM transcripts WHERE content_hash = ? ORDER BY imported_at LIMIT 1").get(hash));
    },
    listTranscripts() {
      return parseRows(db.prepare("SELECT * FROM transcripts ORDER BY imported_at").all());
    },
    updateTranscriptStatus(id, status) {
      const result = db.prepare("UPDATE transcripts SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
      if (!result.changes) throw new NotFoundError(`Transcript not found: ${id}`);
    }
  };
}

// src/db/repositories/spansRepo.ts
function createSpansRepo(db) {
  const createSpan = (input) => {
    if (input.end_char <= input.start_char || input.start_char < 0) throw new ValidationError("Span offsets must satisfy end_char > start_char >= 0");
    if (input.text_preview.length > 500) throw new ValidationError("text_preview must not exceed 500 characters");
    const transcript = db.prepare("SELECT source_id FROM transcripts WHERE id = ?").get(input.transcript_id);
    if (!transcript) throw new NotFoundError(`Transcript not found: ${input.transcript_id}`);
    if (transcript.source_id !== input.source_id) throw new ValidationError("Span source_id must match transcript source_id");
    if (input.speaker_id) {
      const speaker = db.prepare("SELECT transcript_id FROM transcript_speakers WHERE id = ?").get(input.speaker_id);
      if (!speaker || speaker.transcript_id !== input.transcript_id) throw new ValidationError("Speaker must belong to the span transcript");
    }
    const row = { id: input.id ?? createId("span_"), transcript_id: input.transcript_id, source_id: input.source_id, speaker_id: input.speaker_id ?? null, ordinal: input.ordinal, start_char: input.start_char, end_char: input.end_char, start_time_ms: input.start_time_ms ?? null, end_time_ms: input.end_time_ms ?? null, text_preview: input.text_preview, text_hash: input.text_hash, topic_hint: input.topic_hint ?? null, created_at: now(), metadata_json: json(input.metadata) };
    db.prepare(`INSERT INTO transcript_spans(id,transcript_id,source_id,speaker_id,ordinal,start_char,end_char,start_time_ms,end_time_ms,text_preview,text_hash,topic_hint,created_at,metadata_json)
      VALUES (@id,@transcript_id,@source_id,@speaker_id,@ordinal,@start_char,@end_char,@start_time_ms,@end_time_ms,@text_preview,@text_hash,@topic_hint,@created_at,@metadata_json)`).run(row);
    return parseRow(db.prepare("SELECT * FROM transcript_spans WHERE id = ?").get(row.id));
  };
  return {
    createSpeaker(input) {
      assertScore(input.confidence, "confidence");
      const row = { id: input.id ?? createId("spk_"), transcript_id: input.transcript_id, speaker_label: input.speaker_label, display_name: input.display_name ?? null, canonical_entity_id: input.canonical_entity_id ?? null, confidence: input.confidence ?? null, metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO transcript_speakers(id,transcript_id,speaker_label,display_name,canonical_entity_id,confidence,metadata_json)
        VALUES (@id,@transcript_id,@speaker_label,@display_name,@canonical_entity_id,@confidence,@metadata_json)`).run(row);
      return parseRow(db.prepare("SELECT * FROM transcript_speakers WHERE id = ?").get(row.id));
    },
    createSpan,
    createSpans(inputs) {
      return db.transaction(() => inputs.map(createSpan))();
    },
    getSpan(id) {
      return parseRow(db.prepare("SELECT * FROM transcript_spans WHERE id = ?").get(id));
    },
    listSpansForTranscript(transcriptId) {
      return parseRows(db.prepare("SELECT * FROM transcript_spans WHERE transcript_id = ? ORDER BY ordinal").all(transcriptId));
    },
    listSpansByIds(ids) {
      if (!ids.length) return [];
      return parseRows(db.prepare(`SELECT * FROM transcript_spans WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY transcript_id, ordinal`).all(...ids));
    }
  };
}

// src/db/repositories/runsRepo.ts
function createRunsRepo(db) {
  const getRun = (id) => parseRow(db.prepare("SELECT * FROM processing_runs WHERE id = ?").get(id));
  const finish = (id, status, value) => {
    const field = status === "completed" ? "output_json" : "error_json";
    const result = db.prepare(`UPDATE processing_runs SET status = ?, completed_at = ?, ${field} = ? WHERE id = ? AND status = 'running'`).run(status, now(), json(value), id);
    if (!result.changes) throw new NotFoundError(`Running processing run not found: ${id}`);
    return getRun(id);
  };
  return {
    startRun(input) {
      const row = { id: input.id ?? createId("run_"), run_type: input.run_type, status: "running", started_at: now(), model_name: input.model_name ?? null, agent_name: input.agent_name ?? null, input_json: json(input.input), metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO processing_runs(id,run_type,status,started_at,model_name,agent_name,input_json,metadata_json) VALUES (@id,@run_type,@status,@started_at,@model_name,@agent_name,@input_json,@metadata_json)`).run(row);
      return getRun(row.id);
    },
    completeRun(id, output = {}) {
      return finish(id, "completed", output);
    },
    failRun(id, error) {
      return finish(id, "failed", error);
    },
    getRun
  };
}

// src/memory/canonical.ts
function confidenceLabel(confidence) {
  return confidence >= 0.8 ? "high" : confidence >= 0.6 ? "medium" : "low";
}
function getCanonicalMemoryObject(row, evidenceSpanIds) {
  return {
    id: row.id,
    type: row.extraction_type ?? row.type,
    status: row.extraction_status ?? row.status,
    confidence: row.confidence,
    confidenceLabel: row.confidence_label ?? confidenceLabel(row.confidence),
    title: row.title ?? "",
    body: row.generated_text,
    evidenceSpanIds: [...new Set(evidenceSpanIds)],
    duplicateOfId: row.duplicate_of_id ?? null,
    userCorrected: Boolean(row.user_corrected)
  };
}
function isStrongMemoryObject(memory) {
  return memory.status === "active" && memory.evidenceSpanIds.length > 0 && memory.duplicateOfId == null && (memory.userCorrected || memory.confidenceLabel === "high" && memory.confidence >= 0.8);
}
function isReviewableMemoryObject(memory) {
  return (memory.status === "weak" || memory.status === "needs_review") && memory.evidenceSpanIds.length > 0;
}
function isUsableAsEvidence(memory, options = {}) {
  if (memory.duplicateOfId != null && !options.includeDuplicates) return false;
  if (isStrongMemoryObject(memory) || options.includeDuplicates === true && isStrongMemoryObject({ ...memory, duplicateOfId: null })) return true;
  return options.includeWeak === true && isReviewableMemoryObject(memory);
}

// src/db/repositories/memoryObjectsRepo.ts
function createMemoryObjectsRepo(db) {
  const getMemoryObject = (id) => parseRow(db.prepare("SELECT * FROM memory_objects WHERE id = ?").get(id));
  const canonicalize = (row) => {
    const evidence = db.prepare(`SELECT e.span_id FROM memory_object_evidence e JOIN transcript_spans s ON s.id=e.span_id WHERE e.memory_id=?
      UNION SELECT e.span_id FROM evidence_pointers e JOIN transcript_spans s ON s.id=e.span_id
      WHERE e.target_type IN ('memory_object','claim','summary') AND e.target_id=?`).all(row.id, row.id);
    return getCanonicalMemoryObject(row, evidence.map(({ span_id }) => span_id));
  };
  const addEvidence = (memoryId, input) => {
    assertScore(input.evidence_score, "evidence_score");
    requireRow(db, "memory_objects", memoryId);
    requireRow(db, "transcript_spans", input.span_id);
    const row = { id: input.id ?? createId("evi_"), memory_id: memoryId, span_id: input.span_id, role: input.role, evidence_score: input.evidence_score, explanation: input.explanation ?? null, created_at: now(), metadata_json: json(input.metadata) };
    db.prepare(`INSERT INTO memory_object_evidence(id,memory_id,span_id,role,evidence_score,explanation,created_at,metadata_json) VALUES (@id,@memory_id,@span_id,@role,@evidence_score,@explanation,@created_at,@metadata_json)`).run(row);
    return parseRow(db.prepare("SELECT * FROM memory_object_evidence WHERE id = ?").get(row.id));
  };
  const createMemoryObject = (input, evidenceInputs) => db.transaction(() => {
    assertScore(input.confidence, "confidence");
    const status = input.status ?? "active";
    if (!evidenceInputs.length && !(status === "needs_review" && metadataHasMissingEvidence(input.metadata))) throw new EvidenceRequiredError("Memory objects require evidence unless needs_review with a missing-evidence reason");
    const timestamp = now();
    const row = { id: input.id ?? createId("mem_"), type: input.type, title: input.title ?? null, generated_text: input.generated_text, normalized_text: input.normalized_text ?? null, status, confidence: input.confidence, created_by: input.created_by, created_run_id: input.created_run_id ?? null, supersedes_memory_id: input.supersedes_memory_id ?? null, created_at: timestamp, updated_at: timestamp, metadata_json: json(input.metadata) };
    db.prepare(`INSERT INTO memory_objects(id,type,title,generated_text,normalized_text,status,confidence,created_by,created_run_id,supersedes_memory_id,created_at,updated_at,metadata_json)
      VALUES (@id,@type,@title,@generated_text,@normalized_text,@status,@confidence,@created_by,@created_run_id,@supersedes_memory_id,@created_at,@updated_at,@metadata_json)`).run(row);
    evidenceInputs.forEach((item) => addEvidence(row.id, item));
    return getMemoryObject(row.id);
  })();
  return {
    createMemoryObject,
    getMemoryObject,
    addEvidence,
    getCanonicalMemoryObject(id) {
      const row = db.prepare("SELECT * FROM memory_objects WHERE id=?").get(id);
      return row ? canonicalize(row) : null;
    },
    listCanonicalMemoryObjects(filter = {}) {
      const rows = db.prepare("SELECT * FROM memory_objects ORDER BY created_at").all();
      return rows.map(canonicalize).filter((memory) => (!filter.type || memory.type === filter.type) && (!filter.status || memory.status === filter.status));
    },
    // Raw compatibility rows. Prefer listCanonicalMemoryObjects for downstream systems.
    listMemoryObjects(filter = {}) {
      const clauses = [], values = [];
      if (filter.type) {
        clauses.push("type = ?");
        values.push(filter.type);
      }
      if (filter.status) {
        clauses.push("status = ?");
        values.push(filter.status);
      }
      return parseRows(db.prepare(`SELECT * FROM memory_objects ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at`).all(...values));
    },
    getMemoryObjectWithEvidence(id) {
      const memory = getMemoryObject(id);
      if (!memory) return null;
      return { ...memory, evidence: parseRows(db.prepare("SELECT * FROM memory_object_evidence WHERE memory_id = ? ORDER BY created_at").all(id)) };
    },
    updateMemoryObjectStatus(id, status) {
      requireRow(db, "memory_objects", id);
      if (status === "active") {
        const current = db.prepare("SELECT extraction_status,confidence,confidence_label FROM memory_objects WHERE id=?").get(id);
        if (current.extraction_status != null && (current.confidence_label !== "high" || current.confidence < 0.8)) {
          throw new ValidationError("Weak or review-only extracted memory cannot be promoted to active without an explicit user correction");
        }
        const evidenceCount = db.prepare(`SELECT
          (SELECT COUNT(*) FROM memory_object_evidence WHERE memory_id = ?) +
          (SELECT COUNT(*) FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id = ?) count`).get(id, id).count;
        if (!evidenceCount) throw new EvidenceRequiredError("An active memory object requires evidence");
      }
      const result = db.prepare(`UPDATE memory_objects
        SET status = ?, extraction_status = CASE WHEN extraction_status IS NULL THEN NULL ELSE ? END, updated_at = ?
        WHERE id = ?`).run(status, status, now(), id);
      if (!result.changes) throw new NotFoundError(`Memory object status was not updated: ${id}`);
    },
    supersedeMemoryObject(oldId, newInput, evidenceInputs) {
      return db.transaction(() => {
        requireRow(db, "memory_objects", oldId);
        const created = createMemoryObject({ ...newInput, supersedes_memory_id: oldId }, evidenceInputs);
        db.prepare(`UPDATE memory_objects
          SET status = 'superseded', extraction_status = CASE WHEN extraction_status IS NULL THEN NULL ELSE 'superseded' END, updated_at = ?
          WHERE id = ?`).run(now(), oldId);
        return created;
      })();
    }
  };
}

// src/db/repositories/evidenceRepo.ts
function createEvidenceRepo(db, options = {}) {
  const timestamp = () => options.now?.().toISOString() ?? now();
  const getBundle = (id) => parseRow(db.prepare("SELECT * FROM evidence_bundles WHERE id = ?").get(id));
  return {
    createEvidenceBundle(input) {
      assertScore(input.overall_score, "overall_score");
      const row = { id: input.id ?? createId("evb_"), purpose: input.purpose, query_text: input.query_text ?? null, query_embedding_model: input.query_embedding_model ?? null, created_run_id: input.created_run_id ?? null, overall_score: input.overall_score ?? null, status: input.status ?? "needs_review", created_at: timestamp(), metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO evidence_bundles(id,purpose,query_text,query_embedding_model,created_run_id,overall_score,status,created_at,metadata_json)
        VALUES (@id,@purpose,@query_text,@query_embedding_model,@created_run_id,@overall_score,@status,@created_at,@metadata_json)`).run(row);
      return getBundle(row.id);
    },
    addEvidenceItem(bundleId, input) {
      requireRow(db, "evidence_bundles", bundleId);
      requireRow(db, "transcript_spans", input.span_id);
      for (const field of ["vector_score", "keyword_score", "recency_score", "speaker_score", "rerank_score", "final_score"]) assertScore(input[field], field);
      const row = { id: input.id ?? createId("evi_"), bundle_id: bundleId, span_id: input.span_id, memory_id: input.memory_id ?? null, retrieval_rank: input.retrieval_rank ?? null, vector_score: input.vector_score ?? null, keyword_score: input.keyword_score ?? null, recency_score: input.recency_score ?? null, speaker_score: input.speaker_score ?? null, rerank_score: input.rerank_score ?? null, final_score: input.final_score, stance: input.stance, reason: input.reason ?? null, created_at: timestamp(), metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO evidence_items(id,bundle_id,span_id,memory_id,retrieval_rank,vector_score,keyword_score,recency_score,speaker_score,rerank_score,final_score,stance,reason,created_at,metadata_json)
        VALUES (@id,@bundle_id,@span_id,@memory_id,@retrieval_rank,@vector_score,@keyword_score,@recency_score,@speaker_score,@rerank_score,@final_score,@stance,@reason,@created_at,@metadata_json)`).run(row);
      return parseRow(db.prepare("SELECT * FROM evidence_items WHERE id = ?").get(row.id));
    },
    getEvidenceBundleWithItems(bundleId) {
      const bundle = getBundle(bundleId);
      if (!bundle) return null;
      return { ...bundle, items: parseRows(db.prepare("SELECT * FROM evidence_items WHERE bundle_id = ? ORDER BY retrieval_rank, created_at").all(bundleId)) };
    },
    scoreEvidenceBundle(bundleId) {
      if (!getBundle(bundleId)) throw new NotFoundError(`Evidence bundle not found: ${bundleId}`);
      const items = db.prepare("SELECT final_score, stance FROM evidence_items WHERE bundle_id = ?").all(bundleId);
      const average = items.length ? items.reduce((sum, item) => sum + item.final_score, 0) / items.length : null;
      const high = (stance) => items.some((item) => item.stance === stance && item.final_score >= 0.75);
      const status = high("supports") && high("contradicts") ? "conflicting" : average != null && average >= 0.75 ? "strong" : average != null && average >= 0.45 ? "mixed" : "weak";
      db.prepare("UPDATE evidence_bundles SET overall_score = ?, status = ? WHERE id = ?").run(average, status, bundleId);
      return getBundle(bundleId);
    }
  };
}

// src/db/repositories/answersRepo.ts
function createAnswersRepo(db) {
  const getAnswer = (id) => parseRow(db.prepare("SELECT * FROM ai_answers WHERE id = ?").get(id));
  return {
    createAnswer(input) {
      const bundle = db.prepare("SELECT status FROM evidence_bundles WHERE id = ?").get(input.evidence_bundle_id);
      if (!bundle) throw new InvalidEvidenceError(`Evidence bundle not found: ${input.evidence_bundle_id}`);
      const itemCount = db.prepare("SELECT COUNT(*) count FROM evidence_items WHERE bundle_id = ?").get(input.evidence_bundle_id).count;
      if (input.answer_status !== "refused_no_evidence" && !itemCount) throw new InvalidEvidenceError("Non-refusal answers require evidence items");
      const allowed = {
        weak: ["weak_evidence", "refused_no_evidence"],
        conflicting: ["conflicting_evidence"],
        strong: ["answered"],
        mixed: ["answered"],
        needs_review: ["weak_evidence", "refused_no_evidence"]
      };
      if (!allowed[bundle.status].includes(input.answer_status)) throw new InvalidEvidenceError(`Answer status ${input.answer_status} is incompatible with ${bundle.status} evidence`);
      const row = { id: input.id ?? createId("ans_"), question_text: input.question_text, answer_text: input.answer_text, evidence_bundle_id: input.evidence_bundle_id, confidence: input.confidence, answer_status: input.answer_status, model_name: input.model_name ?? null, created_run_id: input.created_run_id ?? null, created_at: now(), metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO ai_answers(id,question_text,answer_text,evidence_bundle_id,confidence,answer_status,model_name,created_run_id,created_at,metadata_json)
        VALUES (@id,@question_text,@answer_text,@evidence_bundle_id,@confidence,@answer_status,@model_name,@created_run_id,@created_at,@metadata_json)`).run(row);
      return getAnswer(row.id);
    },
    addCitation(answerId, evidenceItemId, quotedText) {
      const pair = db.prepare(`SELECT a.evidence_bundle_id answer_bundle, e.bundle_id item_bundle FROM ai_answers a, evidence_items e WHERE a.id = ? AND e.id = ?`).get(answerId, evidenceItemId);
      if (!pair) throw new NotFoundError("Answer or evidence item not found");
      if (pair.answer_bundle !== pair.item_bundle) throw new InvalidEvidenceError("Citation evidence item must belong to the answer evidence bundle");
      const order = db.prepare("SELECT COALESCE(MAX(citation_order), 0) + 1 next_order FROM ai_answer_citations WHERE answer_id = ?").get(answerId).next_order;
      const row = { id: createId("evi_"), answer_id: answerId, evidence_item_id: evidenceItemId, citation_order: order, quoted_text: quotedText ?? null, created_at: now() };
      db.prepare("INSERT INTO ai_answer_citations(id,answer_id,evidence_item_id,citation_order,quoted_text,created_at) VALUES (@id,@answer_id,@evidence_item_id,@citation_order,@quoted_text,@created_at)").run(row);
      return row;
    },
    getAnswerWithCitations(answerId) {
      const answer = getAnswer(answerId);
      if (!answer) return null;
      return { ...answer, citations: parseRows(db.prepare("SELECT * FROM ai_answer_citations WHERE answer_id = ? ORDER BY citation_order").all(answerId)) };
    },
    listAnswers(filter = {}) {
      const clauses = [], values = [];
      for (const key of ["confidence", "answer_status", "evidence_bundle_id"]) if (filter[key]) {
        clauses.push(`${key} = ?`);
        values.push(filter[key]);
      }
      return parseRows(db.prepare(`SELECT * FROM ai_answers ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at`).all(...values));
    }
  };
}

// src/db/repositories/graphRepo.ts
function createGraphRepo(db, options = {}) {
  const timestamp = () => options.now?.().toISOString() ?? now();
  const createGraphNode = (input) => {
    const createdAt = timestamp(), row = { id: input.id ?? createId("node_"), node_type: input.node_type, ref_id: input.ref_id, label: input.label, created_at: createdAt, updated_at: createdAt, metadata_json: json(input.metadata) };
    db.prepare("INSERT INTO graph_nodes(id,node_type,ref_id,label,created_at,updated_at,metadata_json) VALUES (@id,@node_type,@ref_id,@label,@created_at,@updated_at,@metadata_json)").run(row);
    return parseRow(db.prepare("SELECT * FROM graph_nodes WHERE id = ?").get(row.id));
  };
  const getGraphEdge = (id) => parseRow(db.prepare("SELECT * FROM graph_edges WHERE id = ?").get(id));
  return {
    createGraphNode,
    getOrCreateGraphNode(input) {
      return parseRow(db.prepare("SELECT * FROM graph_nodes WHERE node_type = ? AND ref_id = ?").get(input.node_type, input.ref_id)) ?? createGraphNode(input);
    },
    createGraphEdge(input) {
      assertScore(input.confidence, "confidence");
      if (input.source_type === "source_backed" && !input.evidence_bundle_id) throw new EvidenceRequiredError("Source-backed graph edges require an evidence bundle");
      if (input.source_type !== "inferred" && !input.evidence_bundle_id) throw new EvidenceRequiredError("Only inferred graph edges may omit evidence");
      if (!input.evidence_bundle_id && input.source_type !== "inferred") throw new ValidationError("Evidence-free graph edges must be inferred");
      if (input.source_type === "source_backed") {
        const count = db.prepare("SELECT COUNT(*) count FROM evidence_items WHERE bundle_id = ?").get(input.evidence_bundle_id).count;
        if (!count) throw new EvidenceRequiredError("Source-backed graph edge evidence bundle must contain evidence items");
      }
      requireRow(db, "graph_nodes", input.from_node_id);
      requireRow(db, "graph_nodes", input.to_node_id);
      const createdAt = timestamp(), row = { id: input.id ?? createId("edge_"), from_node_id: input.from_node_id, to_node_id: input.to_node_id, edge_type: input.edge_type, source_type: input.source_type, confidence: input.confidence, evidence_bundle_id: input.evidence_bundle_id ?? null, created_run_id: input.created_run_id ?? null, status: input.status ?? "active", created_at: createdAt, updated_at: createdAt, metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO graph_edges(id,from_node_id,to_node_id,edge_type,source_type,confidence,evidence_bundle_id,created_run_id,status,created_at,updated_at,metadata_json)
        VALUES (@id,@from_node_id,@to_node_id,@edge_type,@source_type,@confidence,@evidence_bundle_id,@created_run_id,@status,@created_at,@updated_at,@metadata_json)`).run(row);
      return getGraphEdge(row.id);
    },
    getGraphEdge,
    listEdgesForNode(nodeId) {
      return parseRows(db.prepare("SELECT * FROM graph_edges WHERE from_node_id = ? OR to_node_id = ? ORDER BY created_at").all(nodeId, nodeId));
    },
    listContradictionsForNode(nodeId) {
      return parseRows(db.prepare("SELECT * FROM graph_edges WHERE edge_type = 'contradicts' AND (from_node_id = ? OR to_node_id = ?) ORDER BY created_at").all(nodeId, nodeId));
    },
    updateGraphEdgeStatus(id, status) {
      const result = db.prepare("UPDATE graph_edges SET status = ?, updated_at = ? WHERE id = ?").run(status, timestamp(), id);
      if (!result.changes) throw new NotFoundError(`Graph edge not found: ${id}`);
    }
  };
}

// src/db/repositories/correctionsRepo.ts
var memoryFields = /* @__PURE__ */ new Set(["title", "generated_text", "normalized_text", "status", "confidence", "metadata_json"]);
var edgeFields = /* @__PURE__ */ new Set(["edge_type", "source_type", "confidence", "evidence_bundle_id", "status", "metadata_json"]);
function createCorrectionsRepo(db) {
  const createCorrection = (input) => {
    const row = { id: input.id ?? createId("corr_"), target_type: input.target_type, target_id: input.target_id, correction_type: input.correction_type, old_value_json: input.old_value == null ? null : json(input.old_value), new_value_json: json(input.new_value), reason: input.reason ?? null, created_at: now(), created_by: input.created_by ?? "user", metadata_json: json(input.metadata) };
    db.prepare(`INSERT INTO user_corrections(id,target_type,target_id,correction_type,old_value_json,new_value_json,reason,created_at,created_by,metadata_json)
      VALUES (@id,@target_type,@target_id,@correction_type,@old_value_json,@new_value_json,@reason,@created_at,@created_by,@metadata_json)`).run(row);
    return parseRow(db.prepare("SELECT * FROM user_corrections WHERE id = ?").get(row.id));
  };
  const apply = (table, targetType, id, input, allowed) => db.transaction(() => {
    const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!current) throw new NotFoundError(`${targetType} not found: ${id}`);
    const entries = Object.entries(input.new_value);
    if (!entries.length || entries.some(([key]) => !allowed.has(key))) throw new ValidationError(`Correction contains unsupported ${targetType} fields`);
    const confidence = input.new_value.confidence;
    if (typeof confidence === "number") assertScore(confidence, "confidence");
    const resulting = { ...current, ...input.new_value };
    if (table === "memory_objects" && resulting.status === "active") {
      const count = db.prepare(`SELECT
        (SELECT COUNT(*) FROM memory_object_evidence WHERE memory_id=?) +
        (SELECT COUNT(*) FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=?) count`).get(id, id).count;
      if (!count) throw new EvidenceRequiredError("An active corrected memory object requires evidence");
    }
    if (table === "graph_edges" && resulting.source_type === "source_backed") {
      const count = resulting.evidence_bundle_id ? db.prepare("SELECT COUNT(*) count FROM evidence_items WHERE bundle_id = ?").get(resulting.evidence_bundle_id).count : 0;
      if (!count) throw new EvidenceRequiredError("A source-backed corrected graph edge requires evidence");
    }
    const assignments = entries.map(([key]) => `${key} = @${key}`).concat("updated_at = @updated_at");
    const values = Object.fromEntries(entries.map(([key, value]) => [key, key === "metadata_json" ? json(value) : value]));
    if (table === "memory_objects") {
      assignments.push("user_corrected = 1");
      if (input.new_value.status != null && current.extraction_status != null) {
        assignments.push("extraction_status = @canonical_status");
        values.canonical_status = input.new_value.status;
      }
      if (typeof input.new_value.confidence === "number" && current.confidence_label != null) {
        assignments.push("confidence_label = @canonical_confidence_label");
        values.canonical_confidence_label = input.new_value.confidence >= 0.8 ? "high" : input.new_value.confidence >= 0.6 ? "medium" : "low";
      }
    }
    db.prepare(`UPDATE ${table} SET ${assignments.join(", ")} WHERE id = @id`).run({ ...values, id, updated_at: now() });
    createCorrection({ ...input, target_type: targetType, target_id: id, old_value: Object.fromEntries(entries.map(([key]) => [key, current[key]])) });
    return parseRow(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  })();
  return {
    createCorrection,
    listCorrectionsForTarget(targetType, targetId) {
      return parseRows(db.prepare("SELECT * FROM user_corrections WHERE target_type = ? AND target_id = ? ORDER BY created_at").all(targetType, targetId));
    },
    applyMemoryObjectCorrection(memoryId, input) {
      return apply("memory_objects", "memory_object", memoryId, input, memoryFields);
    },
    applyGraphEdgeCorrection(edgeId2, input) {
      return apply("graph_edges", "graph_edge", edgeId2, input, edgeFields);
    }
  };
}

// src/db/repositories/searchRepo.ts
function createSearchRepo(db) {
  const getSearchDocument = (docType, refId) => parseRow(db.prepare("SELECT * FROM search_documents WHERE doc_type = ? AND ref_id = ?").get(docType, refId));
  return {
    upsertSearchDocument(input) {
      const existing = getSearchDocument(input.doc_type, input.ref_id), timestamp = now();
      const row = { id: existing?.id ?? input.id ?? createId("doc_"), doc_type: input.doc_type, ref_id: input.ref_id, search_text: input.search_text, language: input.language ?? null, created_at: existing?.created_at ?? timestamp, updated_at: timestamp, metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO search_documents(id,doc_type,ref_id,search_text,language,created_at,updated_at,metadata_json)
        VALUES (@id,@doc_type,@ref_id,@search_text,@language,@created_at,@updated_at,@metadata_json)
        ON CONFLICT(doc_type,ref_id) DO UPDATE SET search_text=excluded.search_text,language=excluded.language,updated_at=excluded.updated_at,metadata_json=excluded.metadata_json`).run(row);
      return getSearchDocument(input.doc_type, input.ref_id);
    },
    getSearchDocument,
    searchKeyword(query, limit = 20) {
      try {
        return parseRows(db.prepare(`SELECT d.* FROM search_documents_fts f JOIN search_documents d ON d.rowid=f.rowid WHERE search_documents_fts MATCH ? ORDER BY bm25(search_documents_fts) LIMIT ?`).all(query, limit));
      } catch {
        return parseRows(db.prepare("SELECT * FROM search_documents WHERE search_text LIKE ? ORDER BY updated_at DESC LIMIT ?").all(`%${query}%`, limit));
      }
    },
    createEmbeddingRecord(input) {
      const row = { id: input.id ?? createId("emb_"), doc_type: input.doc_type, ref_id: input.ref_id, embedding_model: input.embedding_model, embedding_dim: input.embedding_dim, embedding_storage_uri: input.embedding_storage_uri ?? null, embedding_json: input.embedding == null ? null : json(input.embedding), content_hash: input.content_hash, created_run_id: input.created_run_id ?? null, created_at: now(), metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO embedding_records(id,doc_type,ref_id,embedding_model,embedding_dim,embedding_storage_uri,embedding_json,content_hash,created_run_id,created_at,metadata_json)
        VALUES (@id,@doc_type,@ref_id,@embedding_model,@embedding_dim,@embedding_storage_uri,@embedding_json,@content_hash,@created_run_id,@created_at,@metadata_json)`).run(row);
      return parseRow(db.prepare("SELECT * FROM embedding_records WHERE id = ?").get(row.id));
    },
    getEmbeddingRecord(docType, refId, model, hash) {
      return parseRow(db.prepare("SELECT * FROM embedding_records WHERE doc_type = ? AND ref_id = ? AND embedding_model = ? AND content_hash = ?").get(docType, refId, model, hash));
    }
  };
}

// src/db/index.ts
function createRepositories(db) {
  return {
    transcripts: createTranscriptsRepo(db),
    spans: createSpansRepo(db),
    runs: createRunsRepo(db),
    memoryObjects: createMemoryObjectsRepo(db),
    evidence: createEvidenceRepo(db),
    answers: createAnswersRepo(db),
    graph: createGraphRepo(db),
    corrections: createCorrectionsRepo(db),
    search: createSearchRepo(db)
  };
}

// src/frontend/router.ts
var patterns = [
  { id: "dashboard", pattern: /^\/(?:dashboard\/?)?$/ },
  { id: "upload", pattern: /^\/upload\/?$/ },
  { id: "transcript", pattern: /^\/transcripts\/([^/]+)\/?$/, names: ["id"] },
  { id: "ask", pattern: /^\/ask\/?$/ },
  { id: "answer", pattern: /^\/answers\/([^/]+)\/?$/, names: ["id"] },
  { id: "evidence", pattern: /^\/evidence\/([^/]+)\/?$/, names: ["id"] },
  { id: "memory", pattern: /^\/memory\/([^/]+)\/?$/, names: ["id"] },
  { id: "graph", pattern: /^\/graph\/?$/ },
  { id: "search", pattern: /^\/search\/?$/ },
  { id: "review", pattern: /^\/review\/?$/ },
  { id: "review_detail", pattern: /^\/review\/([^/]+)\/?$/, names: ["id"] }
];
function matchRoute(input) {
  const internal = input.startsWith("mv://") ? new URL(input) : null;
  const inputPath = internal ? `/${internal.host}${internal.pathname}${internal.search}` : input;
  const url = new URL(inputPath, "http://vault.local");
  for (const route of patterns) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    return {
      id: route.id,
      path: url.pathname,
      params: Object.fromEntries((route.names ?? []).map((name, index) => [name, decodeURIComponent(match[index + 1])])),
      query: url.searchParams
    };
  }
  return { id: "not_found", path: url.pathname, params: {}, query: url.searchParams };
}
var OBSIDIAN_PROTOCOL_ACTION = "transcript-memory-vault";
function obsidianRouteFromProtocol(params, opts = {}) {
  if (typeof params.action === "string" && params.action !== (opts.action ?? OBSIDIAN_PROTOCOL_ACTION)) return null;
  const route = params.route;
  if (typeof route !== "string" || !route.startsWith("mv://")) return null;
  let parsed;
  try {
    parsed = matchRoute(route);
  } catch {
    return null;
  }
  return parsed.id === "not_found" ? null : route;
}
var routeHref = {
  dashboard: () => "mv://dashboard",
  upload: () => "mv://upload",
  ask: () => "mv://ask",
  graph: (query = "") => `mv://graph${query}`,
  search: (query = "") => `mv://search${query}`,
  reviewQueue: (query = "") => `mv://review${query}`,
  transcript: (id, spanId) => `mv://transcripts/${encodeURIComponent(id)}${spanId ? `?span=${encodeURIComponent(spanId)}` : ""}`,
  answer: (id) => `mv://answers/${encodeURIComponent(id)}`,
  evidence: (id) => `mv://evidence/${encodeURIComponent(id)}`,
  memory: (id) => `mv://memory/${encodeURIComponent(id)}`,
  review: (id) => `mv://review/${encodeURIComponent(id)}`
};

// src/frontend/navigation.ts
async function navigateInternal(navigation, target) {
  const route = matchRoute(target);
  switch (route.id) {
    case "dashboard":
      return navigation.openDashboard();
    case "upload":
      return navigation.openUpload();
    case "transcript":
      return navigation.openTranscript(route.params.id, { spanId: route.query.get("span") ?? void 0 });
    case "ask":
      return navigation.openAskAI();
    case "answer":
      return navigation.openAnswer(route.params.id);
    case "evidence":
      return navigation.openEvidence(route.params.id);
    case "memory":
      return navigation.openMemoryObject(route.params.id);
    case "graph":
      return navigation.openGraph({
        selectedNodeId: route.query.get("selectedNode") ?? void 0,
        selectedEdgeId: route.query.get("selectedEdge") ?? void 0,
        query: route.query.get("q") ?? void 0
      });
    case "search":
      return navigation.openSearch(route.query.get("q") ?? void 0);
    case "review_detail":
      return navigation.openReviewQueue({ reviewItemId: route.params.id });
    case "review":
      return navigation.openReviewQueue();
    default:
      throw new Error(`Unsupported internal navigation target: ${target}`);
  }
}

// src/frontend/html.ts
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
function trustBadge(state, label = state.replaceAll("_", " ")) {
  return `<span class="trust-badge trust-${escapeHtml(state)}" data-trust-state="${escapeHtml(state)}">${escapeHtml(label)}</span>`;
}
function score(value) {
  return value == null ? "not scored" : `${Math.round(value * 100)}%`;
}
function emptyState(title, detail, action) {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p>${action ? routeButton(action.href, action.label) : ""}</div>`;
}
function routeButton(target, label, className = "route-action") {
  return `<button type="button" class="${escapeHtml(className)}" data-route="${escapeHtml(target)}">${escapeHtml(label)}</button>`;
}
function appShell(title, body) {
  return `<div class="transcript-memory-vault vault-app">
    <header class="app-header">${routeButton("mv://dashboard", "Interview Intelligence Vault", "route-action brand")}<nav aria-label="Primary">
      ${routeButton("mv://dashboard", "Dashboard")}${routeButton("mv://search", "Search")}${routeButton("mv://graph", "Graph")}${routeButton("mv://review", "Review")}
      <details class="nav-advanced"><summary>Advanced</summary><div class="nav-advanced-items">${routeButton("mv://upload", "Upload")}${routeButton("mv://ask", "Ask AI")}</div></details>
    </nav></header>
    <main><header class="page-header"><h1>${escapeHtml(title)}</h1></header>${body}</main>
  </div>`;
}

// src/ask-ai/errors.ts
var SynthesisSetupRequiredError = class extends Error {
  code = "synthesis_setup_required";
  constructor(message = "Ask AI requires a configured LLM provider. Add a provider, model, and API key in Settings.") {
    super(message);
    this.name = "SynthesisSetupRequiredError";
  }
};
var SynthesisFailedError = class extends Error {
  code = "synthesis_failed";
  constructor(message = "The AI could not generate an answer right now. Please try again.") {
    super(message);
    this.name = "SynthesisFailedError";
  }
};

// src/ask-ai/queryUnderstanding.ts
var unique = (values) => [...new Set(values.filter(Boolean))];
function understandQuestion(question, options = {}) {
  const normalizedQuestion = question.trim().replace(/\s+/g, " ");
  if (!normalizedQuestion) throw new ValidationError("Ask AI question must not be empty");
  const lower = normalizedQuestion.toLowerCase();
  const needsRecommendation = options.mode === "recommendation" || /\b(should|recommend|what should|best option|what do i do)\b/.test(lower);
  const needsComparison = /\b(compare|compared|comparison|versus|vs\.?|difference|both sides)\b/.test(lower);
  const needsChronology = /\b(timeline|chronology|before|after|when|sequence)\b/.test(lower);
  const isSummary = options.mode === "summary" || /\b(summarize|summary|overview|recap)\b/.test(lower);
  const isPattern = /\b(pattern|often|usually|repeated|trend)\b/.test(lower);
  const isInference = /\b(why|infer|suggest|imply|likely)\b/.test(lower);
  const answerMode = options.mode ?? (needsRecommendation ? "recommendation" : isSummary ? "summary" : needsComparison || needsChronology ? "exploratory" : "direct");
  const requestedClaimKinds = unique([
    needsRecommendation ? "recommendation" : "",
    isPattern ? "pattern" : "",
    isInference ? "inference" : "",
    !needsRecommendation && !isPattern && !isInference ? "fact" : ""
  ]);
  const detectedEntities = unique([
    ...(normalizedQuestion.match(/\b[A-Z][\p{L}\p{N}_'-]*(?:\s+[A-Z][\p{L}\p{N}_'-]*)*/gu) ?? []).filter((value) => !/^(What|Why|When|How|Do|Does|Is|Are)$/i.test(value)),
    ...options.entityIds ?? []
  ]);
  const quoted = [...normalizedQuestion.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
  const timeHints = unique(normalizedQuestion.match(/\b(?:recently|today|yesterday|last week|last month|before|after|20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi) ?? []);
  return {
    originalQuestion: question,
    normalizedQuestion,
    answerMode,
    detectedEntities,
    detectedTopics: quoted,
    timeHints,
    requestedClaimKinds,
    needsRecommendation,
    needsComparison,
    needsChronology,
    shouldUseMemoryObjects: answerMode !== "direct" || isPattern,
    shouldUseRawTranscriptSpans: true,
    transcriptIds: [...options.transcriptIds ?? []],
    entityIds: [...options.entityIds ?? []],
    memoryObjectIds: [...options.memoryObjectIds ?? []],
    timeRange: options.timeRange
  };
}

// src/ask-ai/evidenceSelection.ts
var rank = { strong: 4, mixed: 3, weak: 2, conflicting: 1, no_evidence: 0 };
var sourceRank = { raw_transcript_span: 6, user_correction: 5, memory_object_with_pointers: 4, generated_summary_with_pointers: 3, graph_edge_with_pointers: 2, answer_claim_with_pointers: 1 };
function scoredCandidateToEvidence(item) {
  const candidate = item.candidate, spanId = candidate.spanIds[0];
  if (!candidate.evidencePointerId || !candidate.transcriptId || !spanId || !candidate.provenanceValidated || !candidate.quote) return null;
  return {
    evidencePointerId: candidate.evidencePointerId,
    sourcePointerId: typeof candidate.metadata?.sourcePointerId === "string" ? candidate.metadata.sourcePointerId : void 0,
    transcriptId: candidate.transcriptId,
    spanId,
    quotePreview: candidate.quote.slice(0, 500),
    speaker: candidate.speaker,
    timestampStart: candidate.turnTimestampStartMs == null ? void 0 : String(candidate.turnTimestampStartMs),
    timestampEnd: candidate.turnTimestampEndMs == null ? void 0 : String(candidate.turnTimestampEndMs),
    relevanceScore: item.components.relevance,
    evidenceScore: item.finalScore,
    evidenceConfidence: item.strength,
    scoringExplanation: item.reasons.join("; ") || `Evidence classified as ${item.strength}.`,
    clickbackUri: `mv://evidence/${encodeURIComponent(candidate.evidencePointerId)}`,
    stance: item.stance,
    sourceKind: candidate.sourceKind
  };
}
function selectEvidenceForAnswer(assessment, options = {}) {
  const max = Math.max(1, options.maxEvidenceItems ?? 8);
  const validSpans = new Set(assessment.usableEvidence.flatMap((item) => item.candidate.spanIds));
  const materialized = (options.materializedEvidence ?? assessment.scoredEvidence.map(scoredCandidateToEvidence).filter((item) => item != null)).filter((item) => validSpans.has(item.spanId));
  const seenSpans = /* @__PURE__ */ new Set(), seenQuotes = /* @__PURE__ */ new Set();
  const evidence = [...materialized].sort((a, b) => rank[b.evidenceConfidence] - rank[a.evidenceConfidence] || sourceRank[b.sourceKind] - sourceRank[a.sourceKind] || b.evidenceScore - a.evidenceScore || a.spanId.localeCompare(b.spanId)).filter((item) => {
    const quote2 = item.quotePreview.toLowerCase().replace(/\s+/g, " ").trim();
    if (!item.evidencePointerId || !item.transcriptId || !item.spanId || seenSpans.has(item.spanId) || seenQuotes.has(quote2)) return false;
    seenSpans.add(item.spanId);
    seenQuotes.add(quote2);
    return true;
  }).slice(0, max);
  return { evidence, confidence: evidence.length ? assessment.strength : "no_evidence", assessment };
}

// src/ask-ai/claimGeneration.ts
var import_node_crypto2 = require("node:crypto");
var stableId = (value) => `aiclaim_${(0, import_node_crypto2.createHash)("sha256").update(value).digest("hex").slice(0, 24)}`;
var supportStatus = (confidence) => confidence === "strong" || confidence === "mixed" ? "supported" : confidence === "conflicting" ? "conflicting" : confidence === "weak" ? "weakly_supported" : "unsupported";
function defaultClaimText(kind, evidence) {
  const quote2 = evidence[0]?.quotePreview.replace(/^[^:]{1,80}:\s*/, "").trim() ?? "";
  if (kind === "inference") return `Inference: ${quote2}`;
  if (kind === "recommendation") return `Recommendation based on the available transcript evidence: ${quote2}`;
  if (kind === "pattern") return evidence.length > 1 ? `Pattern across the selected evidence: ${quote2}` : `Tentative pattern from limited evidence: ${quote2}`;
  return quote2;
}
async function generateClaimsFromEvidence(query, evidence, citations, options) {
  if (!evidence.length || options.confidence === "no_evidence") return [];
  const citationByPointer = new Map(citations.map((item) => [item.evidencePointerId, item]));
  const selectedPointers = new Set(evidence.map((item) => item.evidencePointerId));
  const kinds = query.requestedClaimKinds.length ? query.requestedClaimKinds : ["fact"];
  const conflictEvidence = [
    evidence.find((item) => item.stance === "supports" || item.stance === "updates"),
    evidence.find((item) => item.stance === "opposes")
  ].filter((item) => item != null);
  const deterministicClaims = () => kinds.map((kind) => ({ kind, text: defaultClaimText(kind, evidence), evidencePointerIds: evidence.map((item) => item.evidencePointerId) }));
  let proposed;
  if (options.confidence === "conflicting") {
    options.onSynthesis?.("conflict");
    proposed = conflictEvidence.map((item) => ({ kind: kinds[0] ?? "fact", text: defaultClaimText(kinds[0] ?? "fact", [item]), evidencePointerIds: [item.evidencePointerId] }));
  } else if (options.llm) {
    try {
      const llmClaims = await options.llm.generateClaims({ query, evidence });
      if (llmClaims.length) {
        options.onSynthesis?.("llm");
        proposed = llmClaims;
      } else if (options.requireLlm) {
        throw new SynthesisFailedError();
      } else {
        options.onSynthesis?.("deterministic");
        proposed = deterministicClaims();
      }
    } catch (error) {
      if (error instanceof SynthesisFailedError) throw error;
      if (options.requireLlm) throw new SynthesisFailedError();
      options.onSynthesis?.("deterministic");
      proposed = deterministicClaims();
    }
  } else if (options.requireLlm) {
    throw new SynthesisSetupRequiredError();
  } else {
    options.onSynthesis?.("deterministic");
    proposed = deterministicClaims();
  }
  return proposed.flatMap((claim, index) => {
    const pointers = [...new Set(claim.evidencePointerIds)].filter((id) => selectedPointers.has(id));
    if (!claim.text.trim() || !pointers.length) return [];
    const claimEvidence = evidence.filter((item) => pointers.includes(item.evidencePointerId));
    const kind = claim.kind;
    let status = supportStatus(options.confidence);
    let explanation = claim.explanation;
    if (kind === "pattern" && claimEvidence.length < 2 && !/\b(always|usually|often|repeatedly|consistently)\b/i.test(claimEvidence[0]?.quotePreview ?? "")) {
      status = "weakly_supported";
      explanation = explanation ?? "Pattern is tentative because only one independent span supports it.";
    }
    if (kind === "inference") explanation = explanation ?? "This is an inference derived from the cited transcript evidence.";
    if (kind === "recommendation") explanation = explanation ?? "This recommendation is based only on the cited goals, constraints, or preferences.";
    const citationIds = pointers.map((id) => citationByPointer.get(id)?.id).filter((id) => id != null);
    if (!citationIds.length) return [];
    return [{ id: stableId(`${index}:${kind}:${claim.text}:${pointers.join(",")}`), kind, text: claim.text.trim(), supportStatus: status, evidencePointerIds: pointers, citationIds, explanation }];
  });
}

// src/ask-ai/llmSynthesis.ts
var LlmSynthesisError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LlmSynthesisError";
  }
};
var CLAIM_KINDS = ["fact", "pattern", "inference", "recommendation"];
var normalizeForMatch = (value) => value.toLowerCase().replace(/\s+/g, " ").trim();
function buildSynthesisPrompt(query, evidence) {
  const items = evidence.map((item, index) => `${index + 1}. pointerId: ${item.evidencePointerId}
   quote: ${item.quotePreview}`).join("\n");
  const system = [
    "You answer questions strictly from the transcript evidence provided.",
    "Use ONLY the listed evidence; never use outside knowledge or invent facts.",
    "Cite evidence by its exact pointerId. Each claim must include a supportingQuote copied verbatim from one of the quotes you cite.",
    "If the evidence does not support an answer, return an empty claims array. Respond with JSON only."
  ].join(" ");
  const prompt = [
    `Question: ${query.originalQuestion}`,
    "",
    "Evidence:",
    items,
    "",
    'Return JSON of the form: {"claims":[{"kind":"fact|pattern|inference|recommendation","text":"...","evidencePointerIds":["<pointerId>"],"supportingQuote":"<verbatim substring of a cited quote>","explanation":"<optional>"}]}'
  ].join("\n");
  return { system, prompt };
}
function parseAndGroundClaims(rawText, evidence) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new LlmSynthesisError("LLM synthesis output was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.claims)) {
    throw new LlmSynthesisError("LLM synthesis output did not contain a claims array");
  }
  const snippetByPointer = new Map(evidence.map((item) => [item.evidencePointerId, normalizeForMatch(item.quotePreview)]));
  const grounded = [];
  for (const raw of parsed.claims) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw;
    const kind = candidate.kind;
    if (typeof kind !== "string" || !CLAIM_KINDS.includes(kind)) continue;
    const text = candidate.text;
    if (typeof text !== "string" || !text.trim()) continue;
    const ids = candidate.evidencePointerIds;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) continue;
    const pointerIds = [...new Set(ids)].filter((id) => snippetByPointer.has(id));
    if (!pointerIds.length) continue;
    const quote2 = candidate.supportingQuote;
    if (typeof quote2 !== "string" || !quote2.trim()) continue;
    const needle = normalizeForMatch(quote2);
    const anchored = needle.length > 0 && pointerIds.some((id) => snippetByPointer.get(id)?.includes(needle));
    if (!anchored) continue;
    const explanation = typeof candidate.explanation === "string" ? candidate.explanation : void 0;
    grounded.push({ kind, text: text.trim(), evidencePointerIds: pointerIds, explanation });
  }
  return grounded;
}
function createLlmAskAILanguageModel(provider, options = {}) {
  return {
    async generateClaims({ query, evidence }) {
      const { system, prompt } = buildSynthesisPrompt(query, evidence);
      const requestOptions = {};
      if (options.timeoutMs != null) requestOptions.timeoutMs = options.timeoutMs;
      let text;
      try {
        text = (await provider.complete({ system, prompt, responseFormat: "json" }, requestOptions)).text;
      } catch {
        throw new LlmSynthesisError("LLM synthesis request failed");
      }
      return parseAndGroundClaims(text, evidence);
    }
  };
}

// src/ask-ai/citations.ts
var import_node_crypto3 = require("node:crypto");
var stableId2 = (value) => `aic_${(0, import_node_crypto3.createHash)("sha256").update(value).digest("hex").slice(0, 24)}`;
function buildCitations(evidence) {
  const seen = /* @__PURE__ */ new Set();
  return evidence.filter((item) => {
    if (seen.has(item.evidencePointerId)) return false;
    seen.add(item.evidencePointerId);
    return true;
  }).map((item, index) => ({
    id: stableId2(item.evidencePointerId),
    label: `[${index + 1}]`,
    evidencePointerId: item.evidencePointerId,
    sourcePointerId: item.sourcePointerId,
    transcriptId: item.transcriptId,
    spanId: item.spanId,
    quotePreview: item.quotePreview,
    clickbackUri: item.clickbackUri
  }));
}
var renderCitation = (citation) => `${citation.label}(${citation.clickbackUri})`;

// src/ask-ai/answerRendering.ts
function renderAnswer(input) {
  if (input.confidence === "no_evidence" || !input.claims.length) return "I don't have enough transcript-backed evidence to answer that.";
  const citations = new Map(input.citations.map((item) => [item.id, item]));
  const lines = input.claims.map((claim) => {
    const links2 = claim.citationIds.map((id) => citations.get(id)).filter((item) => item != null).map(renderCitation);
    if (!links2.length) throw new ValidationError(`Ask AI claim has no selected citation: ${claim.id}`);
    const label = claim.kind === "fact" ? "" : `**${claim.kind[0].toUpperCase()}${claim.kind.slice(1)}:** `;
    return `${label}${claim.text} ${links2.join(" ")}`;
  });
  const intro = input.confidence === "weak" ? "The evidence I found is weak, so this should be treated cautiously." : input.confidence === "conflicting" ? "The evidence conflicts, so I can't give one clean answer. Both sides are shown below." : input.confidence === "mixed" ? "The transcript evidence supports a qualified answer." : "Based on the transcript evidence:";
  return `${intro}

${lines.join("\n\n")}`;
}

// src/ask-ai/followups.ts
function suggestFollowups(confidence, query) {
  if (confidence === "no_evidence") return ["Do you want to search only within a specific transcript?", "Do you want to import more transcripts related to this topic?"];
  if (confidence === "weak") return ["Do you want to see the exact transcript spans I found?", "Do you want to broaden the search?"];
  if (confidence === "conflicting") return ["Do you want to compare the conflicting transcript moments?", "Do you want to review which source is newer?"];
  return query.needsChronology ? ["Do you want the answer grouped by speaker?", "Do you want the supporting transcript clips?"] : ["Do you want a timeline of this?", "Do you want the answer grouped by speaker?", "Do you want the supporting transcript clips?"];
}

// src/provenance/pointerFormat.ts
function encodeId(value, name) {
  if (!value.trim()) throw new ValidationError(`${name} must be non-empty`);
  return encodeURIComponent(value);
}
function makeSourcePointerUri(input) {
  return `mv://source/transcript/${encodeId(input.transcriptId, "transcriptId")}/span/${encodeId(input.spanId, "spanId")}`;
}
function parseSourcePointerUri(uri) {
  const match = uri.match(/^mv:\/\/source\/transcript\/([^/]+)\/span\/([^/]+)$/);
  if (!match) throw new ValidationError(`Malformed source pointer URI: ${uri}`);
  try {
    const transcriptId = decodeURIComponent(match[1]), spanId = decodeURIComponent(match[2]);
    if (!transcriptId.trim() || !spanId.trim()) throw new Error();
    return { transcriptId, spanId };
  } catch {
    throw new ValidationError(`Malformed source pointer URI: ${uri}`);
  }
}
function makeEvidencePointerUri(evidencePointerId) {
  return `mv://evidence/${encodeId(evidencePointerId, "evidencePointerId")}`;
}
function parseEvidencePointerUri(uri) {
  const match = uri.match(/^mv:\/\/evidence\/([^/]+)$/);
  if (!match) throw new ValidationError(`Malformed evidence pointer URI: ${uri}`);
  try {
    const evidencePointerId = decodeURIComponent(match[1]);
    if (!evidencePointerId.trim()) throw new Error();
    return { evidencePointerId };
  } catch {
    throw new ValidationError(`Malformed evidence pointer URI: ${uri}`);
  }
}

// src/provenance/sourcePointers.ts
function loadSpanSource(db, transcriptId, spanId) {
  return db.prepare(`SELECT s.id span_id,s.transcript_id,s.speaker_id,s.start_char,s.end_char,s.start_time_ms,s.end_time_ms,s.text,
      t.raw_text,t.raw_sha256,t.title
    FROM transcript_spans s JOIN transcripts t ON t.id=s.transcript_id
    WHERE s.id=? AND t.id=?`).get(spanId, transcriptId) ?? null;
}
function getSourcePointer(db, pointerUri) {
  return db.prepare("SELECT * FROM source_pointers WHERE pointer_uri = ?").get(pointerUri) ?? null;
}
function createSourcePointerForSpan(db, input) {
  const pointerUri = makeSourcePointerUri(input);
  const existing = getSourcePointer(db, pointerUri);
  if (existing) {
    const resolution = resolveSourcePointer(db, pointerUri);
    if (!resolution.ok) throw new ValidationError(`Existing source pointer is broken: ${resolution.reason}`);
    return existing;
  }
  const row = loadSpanSource(db, input.transcriptId, input.spanId);
  if (!row) throw new NotFoundError(`Transcript span not found: ${input.spanId}`);
  if (row.raw_text == null) throw new ValidationError(`Raw transcript is unavailable: ${input.transcriptId}`);
  if (row.start_char < 0 || row.end_char <= row.start_char || row.end_char > row.raw_text.length) throw new ValidationError("Span has invalid raw transcript offsets");
  const substring = row.raw_text.slice(row.start_char, row.end_char);
  if (row.text == null || row.text !== substring) throw new ValidationError("Span text does not match immutable raw transcript text");
  const turn = db.prepare(`SELECT id FROM transcript_turns WHERE transcript_id=? AND start_char<=? AND end_char>=? ORDER BY turn_index LIMIT 1`).get(input.transcriptId, row.start_char, row.end_char);
  db.prepare(`INSERT INTO source_pointers(pointer_uri,transcript_id,span_id,turn_id,raw_start_offset,raw_end_offset,raw_text_sha256,span_text_sha256,speaker_id,start_ms,end_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    pointerUri,
    input.transcriptId,
    input.spanId,
    turn?.id ?? null,
    row.start_char,
    row.end_char,
    contentHash(row.raw_text),
    contentHash(substring),
    row.speaker_id,
    row.start_time_ms,
    row.end_time_ms
  );
  return getSourcePointer(db, pointerUri);
}
function resolveSourcePointer(db, pointerUri) {
  try {
    parseSourcePointerUri(pointerUri);
  } catch {
    return { ok: false, reason: "not_found", pointerUri };
  }
  const pointer = getSourcePointer(db, pointerUri);
  if (!pointer) return { ok: false, reason: "not_found", pointerUri };
  const row = loadSpanSource(db, pointer.transcript_id, pointer.span_id);
  if (!row || row.raw_text == null) return { ok: false, reason: "raw_transcript_missing", pointerUri };
  if (pointer.raw_start_offset < 0 || pointer.raw_end_offset <= pointer.raw_start_offset || pointer.raw_end_offset > row.raw_text.length) {
    return { ok: false, reason: "invalid_offsets", pointerUri };
  }
  const spanText = row.raw_text.slice(pointer.raw_start_offset, pointer.raw_end_offset);
  if (row.text !== spanText || contentHash(row.raw_text) !== pointer.raw_text_sha256 || contentHash(spanText) !== pointer.span_text_sha256) {
    return { ok: false, reason: "hash_mismatch", pointerUri };
  }
  return { ok: true, pointer, rawText: row.raw_text, spanText, transcriptTitle: row.title };
}

// src/provenance/utils.ts
var import_node_crypto4 = require("node:crypto");
var stableProvenanceId = (prefix, value) => `${prefix}${(0, import_node_crypto4.createHash)("sha256").update(value).digest("hex").slice(0, 24)}`;
function validateScore(value, name) {
  if (value != null && (!Number.isFinite(value) || value < 0 || value > 1)) throw new ValidationError(`${name} must be between 0 and 1`);
}
function requireTarget(db, type, id) {
  const tables = {
    memory_object: "memory_objects",
    claim: "memory_objects",
    summary: "memory_objects",
    answer: "ai_answers",
    answer_claim: "answer_claims",
    graph_node: "graph_nodes",
    graph_edge: "graph_edges"
  };
  const idColumns = { answer_claim: "answer_claim_id" };
  const column = idColumns[type] ?? "id";
  const row = db.prepare(`SELECT 1 FROM ${tables[type]} WHERE ${column} = ?`).get(id);
  if (!row) throw new NotFoundError(`${type} target not found: ${id}`);
}

// src/provenance/evidencePointers.ts
var targetTypes = /* @__PURE__ */ new Set(["memory_object", "claim", "answer", "answer_claim", "graph_node", "graph_edge", "summary"]);
var roles = /* @__PURE__ */ new Set(["support", "opposition", "neutral", "conditional", "unclear"]);
var strengths = /* @__PURE__ */ new Set(["strong", "mixed", "weak", "conflicting", "unknown"]);
function quotePreview(text) {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length <= 240 ? clean : `${clean.slice(0, 237)}...`;
}
function updateAnswerClaimSupportStatus(db, answerClaimId) {
  const rows = db.prepare("SELECT evidence_role,evidence_strength FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=?").all(answerClaimId);
  const support = rows.filter((row) => row.evidence_role === "support");
  const opposition = rows.some((row) => row.evidence_role === "opposition");
  let status = "unsupported";
  if (support.length && opposition) status = "conflicted";
  else if (support.some((row) => row.evidence_strength === "strong" || row.evidence_strength === "mixed")) status = "supported";
  else if (support.length) status = "weakly_supported";
  else if (rows.length) status = "unclear";
  db.prepare("UPDATE answer_claims SET support_status=? WHERE answer_claim_id=?").run(status, answerClaimId);
}
function createEvidencePointer(db, input) {
  if (!targetTypes.has(input.targetType)) throw new ValidationError(`Invalid evidence target type: ${input.targetType}`);
  if (!roles.has(input.evidenceRole)) throw new ValidationError(`Invalid evidence role: ${input.evidenceRole}`);
  if (!strengths.has(input.evidenceStrength)) throw new ValidationError(`Invalid evidence strength: ${input.evidenceStrength}`);
  for (const [name, value] of Object.entries({
    confidence: input.confidence,
    relevanceScore: input.relevanceScore,
    semanticScore: input.semanticScore,
    lexicalScore: input.lexicalScore,
    recencyScore: input.recencyScore,
    finalScore: input.finalScore
  })) validateScore(value, name);
  requireTarget(db, input.targetType, input.targetId);
  const source = createSourcePointerForSpan(db, { transcriptId: input.transcriptId, spanId: input.spanId });
  const resolved = resolveSourcePointer(db, source.pointer_uri);
  if (!resolved.ok) throw new ValidationError(`Source pointer is broken: ${resolved.reason}`);
  const id = stableProvenanceId("evp_", `${input.targetType}:${input.targetId}:${source.pointer_uri}:${input.evidenceRole}`);
  const pointerUri = makeEvidencePointerUri(id);
  db.prepare(`INSERT OR IGNORE INTO evidence_pointers(
    evidence_pointer_id,pointer_uri,source_pointer_uri,target_type,target_id,transcript_id,span_id,evidence_role,evidence_strength,
    confidence,relevance_score,semantic_score,lexical_score,recency_score,final_score,quote_preview,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    pointerUri,
    source.pointer_uri,
    input.targetType,
    input.targetId,
    input.transcriptId,
    input.spanId,
    input.evidenceRole,
    input.evidenceStrength,
    input.confidence,
    input.relevanceScore ?? null,
    input.semanticScore ?? null,
    input.lexicalScore ?? null,
    input.recencyScore ?? null,
    input.finalScore ?? null,
    quotePreview(resolved.spanText),
    now()
  );
  if (input.targetType === "answer_claim") updateAnswerClaimSupportStatus(db, input.targetId);
  return db.prepare("SELECT * FROM evidence_pointers WHERE evidence_pointer_id=?").get(id);
}
function resolveEvidencePointer(db, idOrUri) {
  let id = idOrUri;
  if (idOrUri.startsWith("mv://")) {
    try {
      id = parseEvidencePointerUri(idOrUri).evidencePointerId;
    } catch {
      return { ok: false, reason: "not_found" };
    }
  }
  const evidence = db.prepare("SELECT * FROM evidence_pointers WHERE evidence_pointer_id=?").get(id);
  if (!evidence) return { ok: false, reason: "not_found" };
  const source = resolveSourcePointer(db, evidence.source_pointer_uri);
  if (!source.ok) return { ok: false, reason: source.reason };
  return { ok: true, evidence, source: source.pointer, spanText: source.spanText, rawText: source.rawText };
}
function createAnswerClaim(db, input) {
  requireTarget(db, "answer", input.answerId);
  if (input.claimOrder < 0 || !Number.isInteger(input.claimOrder)) throw new ValidationError("claimOrder must be a non-negative integer");
  const id = stableProvenanceId("ac_", `${input.answerId}:${input.claimOrder}:${input.claimText}`);
  db.prepare(`INSERT OR IGNORE INTO answer_claims(answer_claim_id,answer_id,claim_text,claim_order,support_status,created_at)
    VALUES (?,?,?,?, 'unsupported', ?)`).run(id, input.answerId, input.claimText, input.claimOrder, now());
  return db.prepare("SELECT * FROM answer_claims WHERE answer_claim_id=?").get(id);
}
function linkAnswerClaimToEvidence(db, input) {
  return createEvidencePointer(db, { targetType: "answer_claim", targetId: input.answerClaimId, transcriptId: input.transcriptId, spanId: input.spanId, evidenceRole: input.evidenceRole, evidenceStrength: input.evidenceStrength, confidence: input.confidence, ...input.scores });
}
function linkMemoryObjectToSpan(db, input) {
  return createEvidencePointer(db, { targetType: "memory_object", targetId: input.memoryObjectId, transcriptId: input.transcriptId, spanId: input.spanId, evidenceRole: input.evidenceRole ?? "support", evidenceStrength: input.evidenceStrength ?? "unknown", confidence: input.confidence ?? 0.5 });
}

// src/provenance/citations.ts
function formatCitationLabel(order) {
  if (!Number.isInteger(order) || order < 1) throw new ValidationError("Citation order must be a positive integer");
  return `[${order}]`;
}
function createCitationLinksForAnswer(db, input) {
  if (!db.prepare("SELECT 1 FROM ai_answers WHERE id=?").get(input.answerId)) throw new NotFoundError(`Answer not found: ${input.answerId}`);
  const claims = db.prepare("SELECT answer_claim_id,claim_order FROM answer_claims WHERE answer_id=? ORDER BY claim_order").all(input.answerId);
  const selected = input.answerClaimIds ? new Set(input.answerClaimIds) : null;
  const evidence = [];
  evidence.push(...db.prepare("SELECT *,NULL answer_claim_id,-1 claim_order FROM evidence_pointers WHERE target_type='answer' AND target_id=?").all(input.answerId));
  for (const claim of claims) {
    if (selected && !selected.has(claim.answer_claim_id)) continue;
    const rows = db.prepare("SELECT * FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=?").all(claim.answer_claim_id);
    evidence.push(...rows.map((row) => ({ ...row, answer_claim_id: claim.answer_claim_id, claim_order: claim.claim_order })));
  }
  const roleOrder = { support: 1, opposition: 2, conditional: 3, neutral: 4, unclear: 5 };
  evidence.sort((a, b) => a.claim_order - b.claim_order || roleOrder[a.evidence_role] - roleOrder[b.evidence_role] || (b.final_score ?? -1) - (a.final_score ?? -1) || a.evidence_pointer_id.localeCompare(b.evidence_pointer_id));
  return db.transaction(() => {
    db.prepare("DELETE FROM citation_links WHERE answer_id=?").run(input.answerId);
    return evidence.map((item, index) => {
      const order = index + 1;
      const id = stableProvenanceId("cit_", `${input.answerId}:${item.evidence_pointer_id}`);
      db.prepare(`INSERT INTO citation_links(citation_link_id,answer_id,answer_claim_id,evidence_pointer_id,citation_label,citation_order,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(id, input.answerId, item.answer_claim_id, item.evidence_pointer_id, formatCitationLabel(order), order, now());
      return db.prepare("SELECT * FROM citation_links WHERE citation_link_id=?").get(id);
    });
  })();
}

// src/conflicts/rules.ts
var stopwords = /* @__PURE__ */ new Set(["a", "an", "and", "are", "as", "be", "but", "for", "i", "in", "is", "it", "of", "on", "or", "the", "to", "we"]);
var conditional = /\b(if|when|unless|depending|except|only when|in uncertain|for uncertain|high[- ]confidence|low[- ]confidence)\b/i;
var negative = /\b(no|not|never|avoid|reject|without|cannot|can't|shouldn't|mustn't|do not|don't)\b/i;
var assertion = /\b(should|must|prefer|want|accept|use|require|allow|is|are|will)\b/i;
var tensionPairs = [
  [/\bautomatic|automated|speed|fast\b/i, /\bmanual|review|accurate|accuracy\b/i],
  [/\bsimple|simplicity\b/i, /\bvisible|reviewable|auditable|transparent\b/i],
  [/\bprivate|privacy\b/i, /\bshare|shared|collaborative\b/i]
];
var round = (value) => Math.round(Math.max(0, Math.min(1, value)) * 1e3) / 1e3;
var tokens = (text) => new Set(text.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2 && !stopwords.has(token)) ?? []);
var overlap = (a, b) => {
  const left = tokens(a), right = tokens(b);
  const shared = [...left].filter((token) => right.has(token)).length;
  return round(shared / Math.max(1, Math.min(left.size, right.size)));
};
function temporal(candidate) {
  const left = candidate.leftTimestamp ? Date.parse(candidate.leftTimestamp) : Number.NaN;
  const right = candidate.rightTimestamp ? Date.parse(candidate.rightTimestamp) : Number.NaN;
  if (!Number.isFinite(left) || !Number.isFinite(right) || left === right) return { score: 0, newerTargetId: null, olderTargetId: null };
  const distance = Math.min(1, Math.abs(left - right) / (1e3 * 60 * 60 * 24 * 30));
  return {
    score: round(distance),
    newerTargetId: left > right ? candidate.leftTargetId : candidate.rightTargetId,
    olderTargetId: left > right ? candidate.rightTargetId : candidate.leftTargetId
  };
}
function scoreConflict(candidate, kind, components, options = {}) {
  const validated = new Set(options.validatedEvidenceIds ?? [...candidate.leftEvidenceIds, ...candidate.rightEvidenceIds]);
  const leftValid = candidate.leftEvidenceIds.filter((id) => validated.has(id));
  const rightValid = candidate.rightEvidenceIds.filter((id) => validated.has(id));
  if (!leftValid.length || !rightValid.length) return round(0.15 + 0.2 * components.topicOverlap);
  const average = (ids) => ids.reduce((sum, id) => sum + (options.evidenceScores?.[id] ?? 0.7), 0) / ids.length;
  const quality = Math.min(average(leftValid), average(rightValid));
  const correctionBoost = new Set(options.userCorrectionTargetIds ?? []).has(candidate.leftTargetId) || new Set(options.userCorrectionTargetIds ?? []).has(candidate.rightTargetId) ? 0.08 : 0;
  const base = kind === "direct_contradiction" ? 0.45 + 0.2 * components.topicOverlap + 0.2 * quality + 0.15 * components.polarityOpposition : kind === "temporal_update" ? 0.4 + 0.15 * components.topicOverlap + 0.2 * quality + 0.2 * components.temporalDistance : kind === "conditional_difference" ? 0.4 + 0.15 * components.topicOverlap + 0.2 * quality + 0.15 * components.conditionality : kind === "tension" ? 0.4 + 0.2 * components.topicOverlap + 0.2 * quality : 0.15 + 0.15 * components.topicOverlap;
  const scored = round(base + correctionBoost);
  if (quality < 0.45) return Math.min(scored, 0.59);
  if (quality < 0.65) return Math.min(scored, 0.79);
  return scored;
}
function classifyConflictCandidate(candidate, options = {}) {
  const topicOverlap = candidate.sharedEntities?.length || candidate.sharedTopics?.length ? 1 : overlap(candidate.leftText, candidate.rightText);
  const leftNegative = negative.test(candidate.leftText), rightNegative = negative.test(candidate.rightText);
  const polarityOpposition = leftNegative !== rightNegative && assertion.test(candidate.leftText) && assertion.test(candidate.rightText) ? 1 : 0;
  const conditionality = conditional.test(candidate.leftText) || conditional.test(candidate.rightText) ? 1 : 0;
  const temporalInfo = temporal(candidate);
  const validated = new Set(options.validatedEvidenceIds ?? [...candidate.leftEvidenceIds, ...candidate.rightEvidenceIds]);
  const evidenceCoverage = candidate.leftEvidenceIds.some((id) => validated.has(id)) && candidate.rightEvidenceIds.some((id) => validated.has(id)) ? 1 : 0;
  const tension = tensionPairs.some(([left, right]) => left.test(candidate.leftText) && right.test(candidate.rightText) || right.test(candidate.leftText) && left.test(candidate.rightText));
  const components = { topicOverlap, polarityOpposition, conditionality, temporalDistance: temporalInfo.score, evidenceCoverage };
  let kind = "weak_or_ambiguous";
  if (evidenceCoverage && topicOverlap >= 0.15) {
    if (conditionality && (polarityOpposition || tension)) kind = "conditional_difference";
    else if ((options.preferTemporalUpdate ?? candidate.preferTemporalUpdate) && temporalInfo.score > 0 && (polarityOpposition || tension)) kind = "temporal_update";
    else if (polarityOpposition) kind = "direct_contradiction";
    else if (tension) kind = "tension";
  }
  const confidence = scoreConflict(candidate, kind, components, options);
  const labels = {
    direct_contradiction: "The two source-backed statements directly oppose each other.",
    tension: "The statements express competing goals or constraints.",
    temporal_update: "The newer source-backed statement appears to update the older one.",
    conditional_difference: "The statements differ under an explicit condition or context.",
    weak_or_ambiguous: "The pair lacks enough shared context or source-backed evidence for a reliable conflict."
  };
  return {
    kind,
    confidence,
    summary: `${kind.replaceAll("_", " ")} between ${candidate.leftTargetId} and ${candidate.rightTargetId}`,
    explanation: `${labels[kind]} Topic overlap=${topicOverlap.toFixed(3)}; polarity opposition=${polarityOpposition.toFixed(3)}; conditionality=${conditionality.toFixed(3)}; temporal clarity=${temporalInfo.score.toFixed(3)}; validated-side coverage=${evidenceCoverage.toFixed(3)}; confidence=${confidence.toFixed(3)}.`,
    componentScores: components,
    newerTargetId: kind === "temporal_update" ? temporalInfo.newerTargetId : null,
    olderTargetId: kind === "temporal_update" ? temporalInfo.olderTargetId : null
  };
}

// src/conflicts/repository.ts
var leftKey = (candidate) => `${candidate.leftTargetType}:${candidate.leftTargetId}`;
var rightKey = (candidate) => `${candidate.rightTargetType}:${candidate.rightTargetId}`;
var conflictPairKey = (candidate) => [leftKey(candidate), rightKey(candidate)].sort().join("|");
function normalizeCandidate(candidate) {
  return leftKey(candidate) <= rightKey(candidate) ? candidate : {
    ...candidate,
    leftTargetId: candidate.rightTargetId,
    leftTargetType: candidate.rightTargetType,
    leftText: candidate.rightText,
    leftEvidenceIds: candidate.rightEvidenceIds,
    leftTimestamp: candidate.rightTimestamp,
    rightTargetId: candidate.leftTargetId,
    rightTargetType: candidate.leftTargetType,
    rightText: candidate.leftText,
    rightEvidenceIds: candidate.leftEvidenceIds,
    rightTimestamp: candidate.leftTimestamp
  };
}
function parseLink(row) {
  return {
    id: String(row.id),
    conflictAssessmentId: String(row.conflict_assessment_id),
    evidencePointerId: String(row.evidence_pointer_id),
    side: row.side,
    role: row.role,
    provenanceValidated: Boolean(row.provenance_validated),
    transcriptId: row.transcript_id == null ? void 0 : String(row.transcript_id),
    spanId: row.span_id == null ? void 0 : String(row.span_id),
    sourcePointerId: row.source_pointer_uri == null ? void 0 : String(row.source_pointer_uri),
    quotePreview: row.quote_preview == null ? void 0 : String(row.quote_preview),
    evidenceStrength: row.evidence_strength == null ? void 0 : String(row.evidence_strength),
    confidence: row.confidence == null ? void 0 : Number(row.confidence),
    createdAt: String(row.created_at)
  };
}
function parseAssessment(db, row) {
  const links2 = db.prepare(`SELECT l.*,p.transcript_id,p.span_id,p.source_pointer_uri,p.quote_preview,p.evidence_strength,p.confidence FROM conflict_evidence_links l
    JOIN evidence_pointers p ON p.evidence_pointer_id=l.evidence_pointer_id
    WHERE l.conflict_assessment_id=? ORDER BY l.side,l.created_at,l.id`).all(row.id);
  return {
    id: String(row.id),
    kind: row.kind,
    confidence: Number(row.confidence),
    status: row.status,
    leftTargetType: row.left_target_type,
    leftTargetId: String(row.left_target_id),
    rightTargetType: row.right_target_type,
    rightTargetId: String(row.right_target_id),
    pairKey: String(row.pair_key),
    summary: String(row.summary),
    explanation: String(row.explanation),
    componentScores: JSON.parse(String(row.component_scores_json)),
    newerTargetId: row.newer_target_id == null ? null : String(row.newer_target_id),
    olderTargetId: row.older_target_id == null ? null : String(row.older_target_id),
    winningTargetId: row.winning_target_id == null ? null : String(row.winning_target_id),
    resolutionNote: row.resolution_note == null ? null : String(row.resolution_note),
    evidence: links2.map(parseLink),
    evidenceLinks: links2.map(parseLink),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
function validatedPointers(db, candidate, side) {
  const targetType = side === "left" ? candidate.leftTargetType : candidate.rightTargetType;
  const targetId = side === "left" ? candidate.leftTargetId : candidate.rightTargetId;
  const ids = side === "left" ? candidate.leftEvidenceIds : candidate.rightEvidenceIds;
  return ids.map((id) => {
    const resolution = resolveEvidencePointer(db, id);
    if (!resolution.ok) throw new ValidationError(`Conflict evidence pointer is broken: ${id}`);
    if (targetType !== "evidence_pointer" && (resolution.evidence.target_type !== targetType || resolution.evidence.target_id !== targetId)) {
      throw new ValidationError(`Conflict evidence pointer does not belong to ${targetType}:${targetId}: ${id}`);
    }
    if (targetType === "evidence_pointer" && id !== targetId) {
      throw new ValidationError(`Conflict evidence pointer target does not match itself: ${id}`);
    }
    return resolution.evidence;
  });
}
function createConflictRepository(db, options = {}) {
  const timestamp = () => (options.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
  const get = (id) => {
    const row = db.prepare("SELECT * FROM conflict_assessments WHERE id=?").get(id);
    return row ? parseAssessment(db, row) : null;
  };
  const list = (where = "", values = []) => db.prepare(`SELECT * FROM conflict_assessments ${where} ORDER BY created_at,id`).all(...values).map((row) => parseAssessment(db, row));
  const revalidate = (id) => db.transaction(() => {
    const conflict = get(id);
    if (!conflict) throw new NotFoundError(`Conflict assessment not found: ${id}`);
    for (const link of conflict.evidenceLinks) {
      const valid = resolveEvidencePointer(db, link.evidencePointerId).ok;
      if (valid !== link.provenanceValidated) {
        db.prepare("UPDATE conflict_evidence_links SET provenance_validated=? WHERE id=?").run(valid ? 1 : 0, link.id);
      }
    }
    const coverage = db.prepare(`SELECT
      EXISTS(SELECT 1 FROM conflict_evidence_links WHERE conflict_assessment_id=? AND side='left' AND provenance_validated=1) left_valid,
      EXISTS(SELECT 1 FROM conflict_evidence_links WHERE conflict_assessment_id=? AND side='right' AND provenance_validated=1) right_valid`).get(id, id);
    if (conflict.status === "active" && (!coverage.left_valid || !coverage.right_valid)) {
      db.prepare("UPDATE conflict_assessments SET status='needs_review',updated_at=? WHERE id=?").run(timestamp(), id);
    }
    return get(id);
  })();
  const pointerScore = (pointer) => {
    const raw = pointer.final_score ?? pointer.confidence;
    return pointer.evidence_strength === "strong" ? raw : pointer.evidence_strength === "mixed" ? Math.min(raw, 0.7) : pointer.evidence_strength === "weak" ? Math.min(raw, 0.4) : Math.min(raw, 0.5);
  };
  const targetIsTrusted = (type, id) => {
    if (type !== "memory_object" && type !== "claim" && type !== "summary") return true;
    const memory = createMemoryObjectsRepo(db).getCanonicalMemoryObject(id);
    return memory != null && isUsableAsEvidence(memory);
  };
  return {
    create(input) {
      return db.transaction(() => {
        const candidate = normalizeCandidate(input.candidate);
        const pairKey = conflictPairKey(candidate);
        const existing = db.prepare("SELECT * FROM conflict_assessments WHERE pair_key=? ORDER BY created_at LIMIT 1").get(pairKey);
        if (existing) return parseAssessment(db, existing);
        const left = validatedPointers(db, candidate, "left"), right = validatedPointers(db, candidate, "right");
        const allPointers = [...left, ...right];
        const userCorrected = [candidate.leftTargetId, candidate.rightTargetId].filter((targetId) => Boolean(db.prepare("SELECT 1 FROM memory_objects WHERE id=? AND user_corrected=1").get(targetId)));
        const evidenceOptions = {
          validatedEvidenceIds: allPointers.map((pointer) => pointer.evidence_pointer_id),
          evidenceScores: Object.fromEntries(allPointers.map((pointer) => [pointer.evidence_pointer_id, pointerScore(pointer)])),
          userCorrectionTargetIds: userCorrected
        };
        const computed = classifyConflictCandidate(candidate, evidenceOptions);
        const classification = input.classification ? { ...input.classification, confidence: Math.min(input.classification.confidence, computed.confidence) } : computed;
        if (!targetIsTrusted(candidate.leftTargetType, candidate.leftTargetId) || !targetIsTrusted(candidate.rightTargetType, candidate.rightTargetId)) {
          classification.confidence = Math.min(classification.confidence, 0.59);
        }
        const createdAt = timestamp();
        const id = stableProvenanceId("conf_", pairKey);
        db.prepare(`INSERT INTO conflict_assessments(
          id,kind,confidence,status,left_target_type,left_target_id,right_target_type,right_target_id,pair_key,summary,explanation,
          component_scores_json,newer_target_id,older_target_id,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id,
          classification.kind,
          classification.confidence,
          "needs_review",
          candidate.leftTargetType,
          candidate.leftTargetId,
          candidate.rightTargetType,
          candidate.rightTargetId,
          pairKey,
          classification.summary,
          classification.explanation,
          JSON.stringify(classification.componentScores),
          classification.newerTargetId,
          classification.olderTargetId,
          createdAt,
          createdAt
        );
        for (const [side, pointers] of [["left", left], ["right", right]]) {
          for (const pointer of pointers) {
            db.prepare(`INSERT OR IGNORE INTO conflict_evidence_links(
              id,conflict_assessment_id,evidence_pointer_id,side,role,provenance_validated,created_at
            ) VALUES (?,?,?,?,?,?,?)`).run(
              stableProvenanceId("cel_", `${id}:${side}:${pointer.evidence_pointer_id}`),
              id,
              pointer.evidence_pointer_id,
              side,
              side === "left" ? "supports_left" : "supports_right",
              1,
              createdAt
            );
          }
        }
        if (classification.kind !== "weak_or_ambiguous" && classification.confidence >= 0.6 && left.length && right.length) {
          db.prepare("UPDATE conflict_assessments SET status='active',updated_at=? WHERE id=?").run(createdAt, id);
        }
        return get(id);
      })();
    },
    createConflictAssessment(input) {
      return this.create(input);
    },
    get,
    getConflictAssessment(id) {
      return get(id);
    },
    listForTarget(targetType, targetId, options2 = {}) {
      return list(
        `WHERE ((left_target_type=? AND left_target_id=?) OR (right_target_type=? AND right_target_id=?))${options2.activeOnly ? " AND status='active'" : ""}`,
        [targetType, targetId, targetType, targetId]
      );
    },
    listConflictsForTarget(targetType, targetId, options2 = {}) {
      return list(
        `WHERE ((left_target_type=? AND left_target_id=?) OR (right_target_type=? AND right_target_id=?))${options2.activeOnly ? " AND status='active'" : ""}`,
        [targetType, targetId, targetType, targetId]
      );
    },
    listActiveForEvidencePointers(pointerIds) {
      if (!pointerIds.length) return [];
      const placeholders = pointerIds.map(() => "?").join(",");
      return list(`WHERE status='active' AND id IN (
        SELECT conflict_assessment_id FROM conflict_evidence_links WHERE evidence_pointer_id IN (${placeholders})
      )`, pointerIds).map((conflict) => revalidate(conflict.id)).filter((conflict) => conflict.status === "active");
    },
    listActiveConflicts() {
      return list("WHERE status='active'").map((conflict) => revalidate(conflict.id)).filter((conflict) => conflict.status === "active");
    },
    listConflictsForEvidence(evidencePointerId) {
      return list("WHERE id IN (SELECT conflict_assessment_id FROM conflict_evidence_links WHERE evidence_pointer_id=?)", [evidencePointerId]);
    },
    revalidateConflictEvidence(id) {
      return revalidate(id);
    },
    addEvidenceLink(id, evidencePointerId, role) {
      const conflict = get(id);
      if (!conflict) throw new NotFoundError(`Conflict assessment not found: ${id}`);
      const resolution = resolveEvidencePointer(db, evidencePointerId);
      if (!resolution.ok) throw new ValidationError(`Conflict evidence pointer is broken: ${evidencePointerId}`);
      const side = role === "supports_left" || role === "opposes_right" ? "left" : role === "supports_right" || role === "opposes_left" ? "right" : resolution.evidence.target_id === conflict.leftTargetId ? "left" : "right";
      db.prepare(`INSERT OR IGNORE INTO conflict_evidence_links(
        id,conflict_assessment_id,evidence_pointer_id,side,role,provenance_validated,created_at
      ) VALUES (?,?,?,?,?,1,?)`).run(stableProvenanceId("cel_", `${id}:${role}:${evidencePointerId}`), id, evidencePointerId, side, role, timestamp());
      return get(id);
    },
    updateConflictStatus(id, status) {
      const current = get(id);
      if (!current) throw new NotFoundError(`Conflict assessment not found: ${id}`);
      if (status === "active" && current.kind === "weak_or_ambiguous") throw new ValidationError("Weak or ambiguous conflicts cannot be promoted to active");
      const result = db.prepare("UPDATE conflict_assessments SET status=?,updated_at=? WHERE id=?").run(status, timestamp(), id);
      if (!result.changes) throw new NotFoundError(`Conflict assessment not found: ${id}`);
      return get(id);
    },
    deleteOrDowngradeConflictsForMissingEvidence(evidencePointerId) {
      const ids = db.prepare("SELECT DISTINCT conflict_assessment_id id FROM conflict_evidence_links WHERE evidence_pointer_id=?").all(evidencePointerId);
      db.prepare("DELETE FROM conflict_evidence_links WHERE evidence_pointer_id=?").run(evidencePointerId);
      if (!ids.length) return [];
      return list(`WHERE id IN (${ids.map(() => "?").join(",")})`, ids.map((row) => row.id));
    },
    applyCorrection(id, input) {
      return db.transaction(() => {
        const conflict = get(id);
        if (!conflict) throw new NotFoundError(`Conflict assessment not found: ${id}`);
        const winner = input.action === "mark_left_correct" ? conflict.leftTargetId : input.action === "mark_right_correct" ? conflict.rightTargetId : input.action === "mark_newer_supersedes_older" ? conflict.newerTargetId : null;
        if (input.action === "mark_newer_supersedes_older" && (!conflict.newerTargetId || !conflict.olderTargetId)) {
          throw new ValidationError("Conflict has no deterministic newer/older targets");
        }
        const correctedAt = timestamp();
        db.prepare(`INSERT INTO conflict_corrections(id,conflict_assessment_id,action,winning_target_id,note,created_by,created_at)
          VALUES (?,?,?,?,?,?,?)`).run(createId("cc_"), id, input.action, winner, input.note ?? null, input.createdBy ?? "user", correctedAt);
        const status = input.action === "dismiss_not_conflict" ? "dismissed" : input.action === "mark_both_contextual" || input.action === "keep_both_as_tension" ? "active" : "resolved";
        const kind = input.action === "mark_both_contextual" ? "conditional_difference" : input.action === "keep_both_as_tension" ? "tension" : conflict.kind;
        db.prepare(`UPDATE conflict_assessments SET status=?,kind=?,winning_target_id=?,resolution_note=?,updated_at=? WHERE id=?`).run(status, kind, winner, input.note ?? null, correctedAt, id);
        if (input.action === "mark_newer_supersedes_older" && conflict.olderTargetId) {
          const oldType = conflict.leftTargetId === conflict.olderTargetId ? conflict.leftTargetType : conflict.rightTargetType;
          if (oldType === "memory_object" || oldType === "claim" || oldType === "summary") {
            db.prepare(`UPDATE memory_objects SET status='superseded',
              extraction_status=CASE WHEN extraction_status IS NULL THEN NULL ELSE 'superseded' END,updated_at=? WHERE id=?`).run(correctedAt, conflict.olderTargetId);
          }
        }
        return get(id);
      })();
    },
    dismissConflict(id, note) {
      return this.applyCorrection(id, { action: "dismiss_not_conflict", note });
    },
    resolveConflict(id, winningTargetId, note) {
      const conflict = get(id);
      if (!conflict) throw new NotFoundError(`Conflict assessment not found: ${id}`);
      const action = winningTargetId === conflict.rightTargetId ? "mark_right_correct" : "mark_left_correct";
      return this.applyCorrection(id, { action, note });
    }
  };
}

// src/conflicts/render.ts
function renderConflictContext(conflicts) {
  const active = conflicts.filter((conflict) => conflict.status === "active");
  if (!active.length) return "";
  const lines = active.map((conflict) => {
    const citations = conflict.evidence.map((item) => `[source](mv://evidence/${item.evidencePointerId})`).join(" ");
    return `- **${conflict.kind.replaceAll("_", " ")}:** ${conflict.explanation} ${citations}`;
  });
  return `**Conflict context**

${lines.join("\n")}`;
}

// src/conflicts/askAiIntegration.ts
function confidenceWithConflicts(confidence, conflicts) {
  const active = conflicts.filter((conflict) => conflict.status === "active");
  if (active.some((conflict) => conflict.kind === "direct_contradiction")) return "conflicting";
  if (confidence === "strong" && active.some((conflict) => conflict.kind === "tension" || conflict.kind === "conditional_difference" || conflict.kind === "temporal_update")) return "mixed";
  return confidence;
}
function addConflictContext(answerMarkdown, conflicts) {
  const context = renderConflictContext(conflicts);
  return context ? `${answerMarkdown}

${context}` : answerMarkdown;
}
function conflictEvidenceForAnswer(conflicts) {
  const items = conflicts.filter((conflict) => conflict.status === "active").flatMap((conflict) => conflict.evidenceLinks.flatMap((link) => {
    if (!link.provenanceValidated || !link.transcriptId || !link.spanId || !link.quotePreview) return [];
    const stance = conflict.kind === "direct_contradiction" ? link.side === "left" ? "supports" : "opposes" : conflict.kind === "temporal_update" && link.side === (conflict.newerTargetId === conflict.leftTargetId ? "left" : "right") ? "updates" : "qualifies";
    const strength = link.evidenceStrength;
    const evidenceConfidence = strength === "strong" || strength === "mixed" || strength === "weak" || strength === "conflicting" ? strength : "weak";
    return [{
      evidencePointerId: link.evidencePointerId,
      sourcePointerId: link.sourcePointerId,
      transcriptId: link.transcriptId,
      spanId: link.spanId,
      quotePreview: link.quotePreview,
      evidenceScore: link.confidence ?? conflict.confidence,
      evidenceConfidence,
      scoringExplanation: conflict.explanation,
      clickbackUri: `mv://evidence/${link.evidencePointerId}`,
      stance,
      sourceKind: "raw_transcript_span"
    }];
  }));
  return [...new Map(items.map((item) => [item.evidencePointerId, item])).values()];
}

// src/ask-ai/repository.ts
var bundleStatus = (confidence) => confidence === "no_evidence" ? "weak" : confidence;
var answerStatus = (confidence) => confidence === "no_evidence" ? "refused_no_evidence" : confidence === "weak" ? "weak_evidence" : confidence === "conflicting" ? "conflicting_evidence" : "answered";
var answerConfidence = (confidence) => confidence === "strong" ? "high" : confidence === "mixed" || confidence === "conflicting" ? "medium" : "low";
var itemStance = (stance) => stance === "opposes" ? "contradicts" : stance === "qualifies" ? "qualifies" : stance === "supports" || stance === "updates" ? "supports" : "unknown";
var pointerRole = (stance) => stance === "opposes" ? "opposition" : stance === "qualifies" ? "conditional" : stance === "supports" || stance === "updates" ? "support" : "unclear";
var pointerStrength = (strength) => strength === "no_evidence" ? "weak" : strength;
var reconstructClaimSupport = (stored, evidenceConfidence) => {
  if (stored === "supported" || stored === "weakly_supported" || stored === "conflicting" || stored === "unsupported") return stored;
  switch (evidenceConfidence) {
    case "no_evidence":
      return "unsupported";
    case "conflicting":
      return "conflicting";
    case "weak":
      return "weakly_supported";
    default:
      return "supported";
  }
};
function persistAskAIResponse(db, response) {
  db.transaction(() => {
    const repos = createRepositories(db);
    const bundle = repos.evidence.createEvidenceBundle({
      purpose: "ask_ai",
      query_text: response.queryUnderstanding.normalizedQuestion,
      status: bundleStatus(response.evidenceConfidence),
      overall_score: response.evidence.length ? Math.max(...response.evidence.map((item) => item.evidenceScore)) : null,
      metadata: { ask_ai_run_id: response.id, score_run_id: response.scoreRunId ?? null }
    });
    response.evidence.forEach((item, index) => {
      const pointer = resolveEvidencePointer(db, item.evidencePointerId);
      if (!pointer.ok || pointer.evidence.transcript_id !== item.transcriptId || pointer.evidence.span_id !== item.spanId) {
        throw new ValidationError(`Ask AI evidence pointer is broken or mismatched: ${item.evidencePointerId}`);
      }
      const sourcePointerId = item.sourcePointerId ?? pointer.evidence.source_pointer_uri;
      if (!resolveSourcePointer(db, sourcePointerId).ok) throw new ValidationError(`Ask AI source pointer is broken: ${sourcePointerId}`);
      repos.evidence.addEvidenceItem(bundle.id, {
        span_id: item.spanId,
        retrieval_rank: index + 1,
        final_score: item.evidenceScore,
        stance: itemStance(item.stance),
        reason: item.scoringExplanation,
        metadata: { evidence_pointer_id: item.evidencePointerId, source_pointer_id: sourcePointerId }
      });
    });
    const answer = repos.answers.createAnswer({
      id: response.id,
      question_text: response.question,
      answer_text: response.answerMarkdown,
      evidence_bundle_id: bundle.id,
      confidence: answerConfidence(response.evidenceConfidence),
      answer_status: answerStatus(response.evidenceConfidence),
      // Only non-secret synthesis metadata is recorded: actual mode, provider id, model id, usedFallback, reason.
      model_name: response.synthesis?.model ?? null,
      metadata: { ask_ai: true, score_run_id: response.scoreRunId ?? null, synthesis: response.synthesis ?? null }
    });
    const selected = new Map(response.evidence.map((item) => [item.evidencePointerId, item]));
    response.claims.forEach((claim, index) => {
      const stored = createAnswerClaim(db, { answerId: answer.id, claimText: claim.text, claimOrder: index });
      db.prepare("INSERT INTO ask_ai_claim_metadata(answer_claim_id,kind,explanation,support_status) VALUES (?,?,?,?)").run(stored.answer_claim_id, claim.kind, claim.explanation ?? null, claim.supportStatus);
      claim.evidencePointerIds.forEach((pointerId) => {
        const item = selected.get(pointerId);
        if (!item) throw new ValidationError(`Ask AI claim references unselected evidence: ${pointerId}`);
        linkAnswerClaimToEvidence(db, {
          answerClaimId: stored.answer_claim_id,
          transcriptId: item.transcriptId,
          spanId: item.spanId,
          evidenceRole: pointerRole(item.stance),
          evidenceStrength: pointerStrength(item.evidenceConfidence),
          confidence: item.evidenceScore,
          scores: { relevanceScore: item.relevanceScore, finalScore: item.evidenceScore }
        });
      });
    });
    createCitationLinksForAnswer(db, { answerId: answer.id });
    db.prepare(`INSERT INTO ask_ai_runs(
      id,question,normalized_question,answer_markdown,evidence_confidence,query_understanding_json,answer_id,score_run_id,not_enough_evidence,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      response.id,
      response.question,
      response.queryUnderstanding.normalizedQuestion,
      response.answerMarkdown,
      response.evidenceConfidence,
      JSON.stringify(response.queryUnderstanding),
      answer.id,
      response.scoreRunId ?? null,
      response.notEnoughEvidence ? 1 : 0,
      response.createdAt
    );
    response.evidence.forEach((item, index) => db.prepare(`INSERT INTO ask_ai_run_evidence(
      ask_ai_run_id,evidence_pointer_id,source_pointer_id,transcript_id,span_id,rank,evidence_score,evidence_confidence,quote_preview,scoring_explanation
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      response.id,
      item.evidencePointerId,
      item.sourcePointerId ?? null,
      item.transcriptId,
      item.spanId,
      index + 1,
      item.evidenceScore,
      item.evidenceConfidence,
      item.quotePreview,
      item.scoringExplanation
    ));
    response.suggestedFollowups.forEach((text, index) => db.prepare(
      "INSERT INTO ask_ai_suggested_followups(id,ask_ai_run_id,text,rank) VALUES (?,?,?,?)"
    ).run(createId("aif_"), response.id, text, index + 1));
    response.conflicts.forEach((conflict) => db.prepare(
      "INSERT INTO ask_ai_run_conflicts(ask_ai_run_id,conflict_assessment_id) VALUES (?,?)"
    ).run(response.id, conflict.id));
  })();
}
function getAskAIResponse(db, id) {
  const run = db.prepare("SELECT * FROM ask_ai_runs WHERE id=?").get(id);
  if (!run) throw new NotFoundError(`Ask AI run not found: ${id}`);
  const evidenceRows = db.prepare("SELECT * FROM ask_ai_run_evidence WHERE ask_ai_run_id=? ORDER BY rank").all(id);
  const claimRows = db.prepare(`SELECT c.*,m.kind,m.explanation,m.support_status AS claim_support_status FROM answer_claims c
    JOIN ask_ai_claim_metadata m ON m.answer_claim_id=c.answer_claim_id
    WHERE c.answer_id=? ORDER BY c.claim_order`).all(run.answer_id);
  const linkRows = db.prepare(`SELECT l.*,e.source_pointer_uri,e.transcript_id,e.span_id,e.quote_preview
    FROM citation_links l JOIN evidence_pointers e ON e.evidence_pointer_id=l.evidence_pointer_id
    WHERE l.answer_id=? ORDER BY l.citation_order`).all(run.answer_id);
  const followups = db.prepare("SELECT text FROM ask_ai_suggested_followups WHERE ask_ai_run_id=? ORDER BY rank").all(id);
  const conflicts = db.prepare("SELECT conflict_assessment_id FROM ask_ai_run_conflicts WHERE ask_ai_run_id=? ORDER BY conflict_assessment_id").all(id).map((row) => createConflictRepository(db).get(row.conflict_assessment_id)).filter(Boolean);
  const evidenceConfidence = run.evidence_confidence;
  const evidence = evidenceRows.map((item) => ({
    evidencePointerId: String(item.evidence_pointer_id),
    sourcePointerId: item.source_pointer_id == null ? void 0 : String(item.source_pointer_id),
    transcriptId: String(item.transcript_id),
    spanId: String(item.span_id),
    quotePreview: String(item.quote_preview),
    evidenceScore: Number(item.evidence_score),
    evidenceConfidence: item.evidence_confidence,
    scoringExplanation: String(item.scoring_explanation),
    clickbackUri: `mv://evidence/${String(item.evidence_pointer_id)}`,
    stance: "unknown",
    sourceKind: "raw_transcript_span"
  }));
  const selectedBySpan = new Map(evidence.map((item) => [`${item.transcriptId}::${item.spanId}`, item]));
  const citations = linkRows.map((item) => {
    const selected = selectedBySpan.get(`${String(item.transcript_id)}::${String(item.span_id)}`);
    const evidencePointerId = selected?.evidencePointerId ?? String(item.evidence_pointer_id);
    return {
      id: String(item.citation_link_id),
      label: String(item.citation_label),
      evidencePointerId,
      sourcePointerId: selected?.sourcePointerId ?? String(item.source_pointer_uri),
      transcriptId: String(item.transcript_id),
      spanId: String(item.span_id),
      quotePreview: selected?.quotePreview ?? String(item.quote_preview),
      clickbackUri: `mv://evidence/${evidencePointerId}`
    };
  });
  const answerMeta = db.prepare("SELECT metadata_json FROM ai_answers WHERE id=?").get(run.answer_id);
  let synthesis;
  try {
    const parsedMeta = answerMeta?.metadata_json ? JSON.parse(answerMeta.metadata_json) : null;
    synthesis = parsedMeta?.synthesis ?? void 0;
  } catch {
    synthesis = void 0;
  }
  return {
    id,
    question: String(run.question),
    answerMarkdown: String(run.answer_markdown),
    evidenceConfidence,
    notEnoughEvidence: Boolean(run.not_enough_evidence),
    createdAt: String(run.created_at),
    queryUnderstanding: JSON.parse(String(run.query_understanding_json)),
    scoreRunId: run.score_run_id == null ? void 0 : String(run.score_run_id),
    evidence,
    claims: claimRows.map((item) => {
      const claimCitations = citations.filter((citation) => linkRows.some((link) => link.answer_claim_id === item.answer_claim_id && link.citation_link_id === citation.id));
      return {
        id: String(item.answer_claim_id),
        kind: item.kind,
        text: String(item.claim_text),
        supportStatus: reconstructClaimSupport(item.claim_support_status, evidenceConfidence),
        evidencePointerIds: claimCitations.map((citation) => citation.evidencePointerId),
        citationIds: claimCitations.map((citation) => citation.id),
        explanation: item.explanation == null ? void 0 : String(item.explanation)
      };
    }),
    citations,
    suggestedFollowups: followups.map((item) => item.text),
    conflicts,
    synthesis
  };
}

// src/evidence/rules.ts
var SCORER_VERSION = "mvp-evidence-v1";
var USE_TYPE_WEIGHTS = {
  direct_fact: { relevance: 0.2, directness: 0.26, specificity: 0.2, sourceStrength: 0.16, repetition: 0.04, recency: 0.04, correctionWeight: 0.06, confidence: 0.04 },
  pattern: { relevance: 0.18, directness: 0.14, specificity: 0.12, sourceStrength: 0.15, repetition: 0.24, recency: 0.06, correctionWeight: 0.06, confidence: 0.05 },
  inference: { relevance: 0.22, directness: 0.12, specificity: 0.14, sourceStrength: 0.18, repetition: 0.18, recency: 0.05, correctionWeight: 0.06, confidence: 0.05 },
  recommendation: { relevance: 0.2, directness: 0.15, specificity: 0.14, sourceStrength: 0.15, repetition: 0.1, recency: 0.14, correctionWeight: 0.08, confidence: 0.04 }
};
var stopWords = /* @__PURE__ */ new Set(["a", "an", "and", "are", "as", "at", "be", "because", "by", "for", "from", "has", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "with"]);
var clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
var round2 = (value) => Math.round(clamp(value) * 1e4) / 1e4;
function tokens2(text = "") {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((token) => token.length > 1 && !stopWords.has(token)) ?? [])];
}
function lexicalCoverage(claimText, quote2 = "") {
  const claim = tokens2(claimText), evidence = new Set(tokens2(quote2));
  return claim.length ? claim.filter((token) => evidence.has(token)).length / claim.length : 0;
}
function calculateRelevance(candidate, claimText, requiredTerms = []) {
  const available = [candidate.retrievalScore, candidate.vectorScore, candidate.keywordScore].filter((score2) => score2 != null).map(clamp);
  const lexical = lexicalCoverage(claimText, candidate.quote);
  const requiredCoverage = requiredTerms.length ? requiredTerms.filter((term) => candidate.quote?.toLowerCase().includes(term.toLowerCase())).length / requiredTerms.length : lexical;
  if (!available.length) return round2(0.75 * lexical + 0.25 * requiredCoverage);
  const retrieval = clamp(candidate.retrievalScore ?? lexical);
  const vector = clamp(candidate.vectorScore ?? lexical);
  const keyword = clamp(candidate.keywordScore ?? lexical);
  return round2(0.35 * retrieval + 0.2 * vector + 0.2 * keyword + 0.15 * lexical + 0.1 * requiredCoverage);
}
function calculateDirectness(candidate, useType3) {
  if (candidate.userCorrectionStatus === "confirmed") return 1;
  if (!candidate.spanIds.length) return 0;
  const base = {
    raw_transcript_span: candidate.quote ? 0.95 : 0.75,
    user_correction: 0.9,
    generated_summary_with_pointers: 0.62,
    memory_object_with_pointers: 0.62,
    graph_edge_with_pointers: 0.55,
    answer_claim_with_pointers: 0.58
  };
  return round2(base[candidate.sourceKind] + (useType3 === "inference" ? 0.05 : 0));
}
function calculateSpecificity(candidate, claimText, requiredTerms = []) {
  const quote2 = candidate.quote ?? "";
  const coverage = lexicalCoverage(claimText, quote2);
  const claimSpecifics = tokens2(claimText).filter((token) => /\d/.test(token) || token.length >= 7);
  const required = [.../* @__PURE__ */ new Set([...requiredTerms.map((term) => term.toLowerCase()), ...claimSpecifics])];
  const specificCoverage = required.length ? required.filter((term) => quote2.toLowerCase().includes(term)).length / required.length : coverage;
  const concrete = /\d|(?:\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b)/i.test(quote2) ? 0.15 : 0;
  return round2(0.55 * coverage + 0.45 * specificCoverage + concrete);
}
function calculateSourceStrength(candidate) {
  if (candidate.userCorrectionStatus === "rejected") return 0;
  if (candidate.userCorrectionStatus === "superseded") return 0.15;
  if (candidate.userCorrectionStatus === "confirmed") return 1;
  if (!candidate.spanIds.length) return 0;
  const strengths2 = {
    raw_transcript_span: 0.95,
    user_correction: 0.85,
    generated_summary_with_pointers: 0.68,
    memory_object_with_pointers: 0.68,
    graph_edge_with_pointers: 0.65,
    answer_claim_with_pointers: 0.62
  };
  return strengths2[candidate.sourceKind];
}
function calculateCorrectionWeight(candidate) {
  if (candidate.userCorrectionStatus === "confirmed" || candidate.isUserCorrection) return 1;
  if (candidate.userCorrectionStatus === "rejected" || candidate.userCorrectionStatus === "superseded") return 0;
  return 0.5;
}
function calculateConfidence(candidate) {
  const values = [candidate.sourceConfidence, candidate.extractionConfidence].filter((value) => value != null);
  return round2(values.length ? values.reduce((sum, value) => sum + clamp(value), 0) / values.length : 0.5);
}
function candidateCaps(candidate, useType3, components, requiredTerms = [], claimText = "") {
  const reasons = [];
  let maxStrength;
  const capWeak = (reason) => {
    if (maxStrength !== "no_evidence") maxStrength = "weak";
    reasons.push(reason);
  };
  const capNone = (reason) => {
    maxStrength = "no_evidence";
    reasons.push(reason);
  };
  if (candidate.userCorrectionStatus === "rejected") capNone("Rejected user correction is excluded");
  else if (candidate.userCorrectionStatus === "superseded" || candidate.metadata?.superseded === true) capWeak("Superseded evidence is not current truth");
  if (!candidate.spanIds.length && candidate.userCorrectionStatus !== "confirmed") capNone("No raw transcript span or confirmed correction");
  if (candidate.sourceKind !== "raw_transcript_span" && candidate.sourceKind !== "user_correction" && !candidate.spanIds.length) capNone("Generated-only evidence has no raw pointers");
  if (candidate.sourceKind !== "raw_transcript_span" && candidate.sourceKind !== "user_correction" && candidate.provenanceValidated !== true) {
    capNone("Generated-object evidence was not validated against a raw transcript span");
  }
  if (components.relevance < 0.35) capWeak("Low relevance cannot establish the claim");
  if (useType3 === "direct_fact" && components.directness < 0.5) capWeak("Direct fact lacks direct evidence");
  if (components.specificity < 0.4) capWeak("Specific claim lacks required details");
  if (candidate.vectorScore != null && candidate.keywordScore == null && candidate.retrievalScore == null && lexicalCoverage(claimText, candidate.quote) < 0.5) capWeak("Vector-only match cannot establish truth");
  const memoryStatus = candidate.metadata?.canonicalMemoryStatus;
  if (candidate.sourceKind === "memory_object_with_pointers" && memoryStatus !== void 0 && memoryStatus !== "active") capWeak("Canonical memory status is not active");
  if (candidate.metadata?.memoryUsableAsEvidence === false || candidate.metadata?.duplicateOfId != null) capWeak("Memory object is not independently usable as strong evidence");
  return { maxStrength, reasons };
}
var rank2 = { no_evidence: 0, weak: 1, mixed: 2, strong: 3, conflicting: 3 };
function classifyEvidenceStrength(score2, caps = { reasons: [] }) {
  let strength = score2 >= 0.78 ? "strong" : score2 >= 0.55 ? "mixed" : score2 >= 0.35 ? "weak" : "no_evidence";
  if (caps.maxStrength && rank2[strength] > rank2[caps.maxStrength]) strength = caps.maxStrength;
  return strength;
}

// src/evidence/repetition.ts
var normalizeQuote = (quote2 = "") => quote2.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function nearIdentical(left = "", right = "") {
  const a = new Set(normalizeQuote(left).split(" ").filter(Boolean)), b = new Set(normalizeQuote(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return false;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size) >= 0.9;
}
function areDuplicates(left, right) {
  if (left.evidencePointerId && left.evidencePointerId === right.evidencePointerId) return true;
  if (left.spanIds.some((id) => right.spanIds.includes(id))) return true;
  if (nearIdentical(left.quote, right.quote)) return true;
  return left.transcriptId != null && left.transcriptId === right.transcriptId && left.turnTimestampStartMs != null && left.turnTimestampStartMs === right.turnTimestampStartMs && left.turnTimestampEndMs != null && left.turnTimestampEndMs === right.turnTimestampEndMs;
}
function deduplicateEvidenceCandidates(candidates) {
  const accepted = [];
  for (const candidate of candidates) {
    if (!accepted.some((item) => areDuplicates(item, candidate))) accepted.push(candidate);
  }
  return accepted;
}
function calculateRepetitionScore(candidate, allCandidates, useType3 = "direct_fact") {
  const sameStance = deduplicateEvidenceCandidates(allCandidates).filter((item) => (item.stance ?? "unknown") === (candidate.stance ?? "unknown"));
  const count = sameStance.length;
  if (useType3 === "pattern") return round2(count >= 3 ? 1 : count === 2 ? 0.78 : 0.2);
  return round2(count >= 3 ? 1 : count === 2 ? 0.75 : 0.5);
}

// src/evidence/recency.ts
function calculateRecencyScore(candidate, now2, useType3) {
  const date = candidate.transcriptRecordedAt ?? candidate.createdAt;
  if (!date || !now2) return 0.5;
  const nowMs = Date.parse(now2), dateMs = Date.parse(date);
  if (!Number.isFinite(nowMs) || !Number.isFinite(dateMs)) return 0.5;
  const ageDays = Math.max(0, (nowMs - dateMs) / 864e5);
  let score2 = ageDays <= 7 ? 1 : ageDays <= 30 ? 0.8 : ageDays <= 180 ? 0.6 : 0.4;
  if (useType3 === "direct_fact" || useType3 === "inference") score2 = 0.5 + score2 * 0.5;
  return round2(score2);
}

// src/evidence/explain.ts
function explanationForStrength(strength, useType3) {
  const subject = useType3 === "inference" ? "inference" : useType3 === "recommendation" ? "recommendation" : "claim";
  if (strength === "strong") return `Strong evidence: the ${subject} is supported by specific source-backed evidence with no meaningful unresolved opposition.`;
  if (strength === "mixed") return `Mixed evidence: the ${subject} has usable support, but some evidence qualifies or partially challenges it.`;
  if (strength === "conflicting") return `Conflicting evidence: there is strong support for the ${subject}, but other source-backed evidence directly opposes it.`;
  if (strength === "weak") return `Weak evidence: the available source-backed evidence is related, but it is not sufficient to support the ${useType3 === "pattern" ? "pattern" : subject} confidently.`;
  return `No evidence: no usable source-backed transcript spans or confirmed corrections were found for this ${subject}.`;
}
function explainEvidenceScore(assessment) {
  return explanationForStrength(assessment.strength, assessment.useType);
}

// src/evidence/scoring.ts
var scoreOrder = { strong: 4, mixed: 3, weak: 2, conflicting: 1, no_evidence: 0 };
var byScore = (a, b) => b.finalScore - a.finalScore || a.candidate.id.localeCompare(b.candidate.id);
var meaningful = (item) => item.strength !== "no_evidence";
var supportStances = /* @__PURE__ */ new Set(["supports", "updates"]);
function scoreEvidenceCandidate(candidate, context) {
  const stance = context.knownOppositionCandidateIds?.includes(candidate.id) ? "opposes" : candidate.stance ?? "unknown";
  const components = {
    relevance: calculateRelevance(candidate, context.claimText, context.requiredSpecificityTerms),
    directness: calculateDirectness(candidate, context.useType),
    specificity: calculateSpecificity(candidate, context.claimText, context.requiredSpecificityTerms),
    sourceStrength: calculateSourceStrength(candidate),
    repetition: calculateRepetitionScore({ ...candidate, stance }, context.allCandidates, context.useType),
    recency: calculateRecencyScore(candidate, context.now, context.useType),
    correctionWeight: calculateCorrectionWeight(candidate),
    confidence: calculateConfidence(candidate),
    oppositionPenalty: stance === "opposes" ? 0.05 : 0
  };
  const weights = USE_TYPE_WEIGHTS[context.useType];
  const weighted = Object.entries(weights).reduce((sum, [key, weight]) => sum + components[key] * weight, 0);
  const finalScore = round2(weighted - components.oppositionPenalty);
  const caps = candidateCaps(candidate, context.useType, components, context.requiredSpecificityTerms, context.claimText);
  const strength = classifyEvidenceStrength(finalScore, caps);
  const reasons = [
    ...caps.reasons,
    components.relevance < 0.35 ? "Low relevance to the claim" : "",
    components.directness < 0.5 ? "Evidence is indirect" : "",
    components.specificity < 0.4 ? "Evidence lacks specific claim details" : "",
    components.repetition >= 0.75 ? "Independent evidence repeats the support" : "",
    candidate.userCorrectionStatus === "confirmed" ? "Confirmed user correction has priority" : ""
  ].filter(Boolean);
  return { candidate: { ...candidate, stance }, stance, components, finalScore, strength, caps, reasons };
}
function maxScore(items) {
  return round2(items.length ? Math.max(...items.map((item) => item.finalScore)) : 0);
}
function hasExplicitPattern(candidate) {
  return /\b(always|usually|often|repeatedly|consistently|tend(?:s)? to)\b/i.test(candidate.quote ?? "");
}
function passesUseTypeGate(input, support) {
  if (input.useType === "direct_fact") return support.some((item) => item.strength === "strong" && item.components.directness >= 0.7);
  if (input.useType === "pattern") return support.length >= 2 || support.some((item) => hasExplicitPattern(item.candidate) && item.finalScore >= 0.7);
  if (input.useType === "inference") return support.filter((item) => item.finalScore >= 0.55).length >= 2 && maxScore(support) >= 0.82;
  return support.some((item) => item.finalScore >= 0.72) && support.some((item) => item.components.recency >= 0.6 || item.candidate.userCorrectionStatus === "confirmed");
}
function hasStrongEnoughSupport(useType3, support) {
  if (support.some((item) => item.strength === "strong")) return true;
  if (useType3 === "pattern") return support.some((item) => hasExplicitPattern(item.candidate) && item.finalScore >= 0.7);
  return false;
}
function aggregateSupportAndOpposition(input, scoredCandidates) {
  const scoredEvidence = [...scoredCandidates].sort(byScore);
  const usableEvidence = scoredEvidence.filter(meaningful);
  const bestSupportingEvidence = usableEvidence.filter((item) => supportStances.has(item.stance)).sort(byScore);
  const bestOpposingEvidence = usableEvidence.filter((item) => item.stance === "opposes").sort(byScore);
  const qualifyingEvidence = usableEvidence.filter((item) => item.stance === "qualifies").sort(byScore);
  const supportScore = maxScore(bestSupportingEvidence);
  const oppositionScore = maxScore(bestOpposingEvidence);
  const qualificationScore = maxScore(qualifyingEvidence);
  const strongSupport = supportScore >= 0.7;
  const strongOpposition = oppositionScore >= 0.65;
  const comparableOpposition = oppositionScore >= Math.max(0.55, supportScore - 0.15);
  const updateWins = bestSupportingEvidence.some((item) => item.stance === "updates" && item.finalScore >= oppositionScore);
  const hasConflict = strongSupport && strongOpposition && comparableOpposition && !updateWins;
  let strength;
  if (!usableEvidence.length || !bestSupportingEvidence.length) strength = "no_evidence";
  else if (hasConflict) strength = "conflicting";
  else if (!passesUseTypeGate(input, bestSupportingEvidence)) strength = "weak";
  else if (strongOpposition || bestOpposingEvidence.length || qualifyingEvidence.length || updateWins) strength = "mixed";
  else if (hasStrongEnoughSupport(input.useType, bestSupportingEvidence)) strength = "strong";
  else strength = "weak";
  const reasons = [
    !usableEvidence.length ? "No usable source-backed evidence" : "",
    hasConflict ? "Comparable source-backed support and opposition remain unresolved" : "",
    qualifyingEvidence.length ? "Qualifying evidence requires a caveat" : "",
    updateWins ? "Newer or explicit update evidence changes older evidence" : "",
    strength === "weak" && input.useType === "pattern" ? "A pattern needs repeated independent evidence or an explicit pattern statement" : "",
    strength === "weak" && input.useType === "inference" ? "An inference needs multiple explainable supporting sources" : ""
  ].filter(Boolean);
  const assessment = {
    claimText: input.claimText,
    useType: input.useType,
    strength,
    supportScore,
    oppositionScore,
    qualificationScore,
    bestSupportingEvidence,
    bestOpposingEvidence,
    qualifyingEvidence,
    usableEvidence,
    hasConflict,
    scoredEvidence,
    hasWeakEvidenceOnly: usableEvidence.length > 0 && strength === "weak",
    hasNoEvidence: strength === "no_evidence",
    explanation: "",
    reasons,
    scorerVersion: SCORER_VERSION
  };
  assessment.explanation = explainEvidenceScore(assessment);
  return assessment;
}
function scoreEvidenceBundle(input) {
  const duplicateIds = new Set(input.knownDuplicateCandidateIds ?? []);
  const oppositionIds = new Set(input.knownOppositionCandidateIds ?? []);
  const candidates = deduplicateEvidenceCandidates(input.candidates.filter((candidate) => !duplicateIds.has(candidate.id)).map((candidate) => oppositionIds.has(candidate.id) ? { ...candidate, stance: "opposes" } : candidate));
  const context = {
    claimText: input.claimText,
    useType: input.useType,
    allCandidates: candidates,
    now: input.now,
    knownOppositionCandidateIds: input.knownOppositionCandidateIds,
    requiredSpecificityTerms: input.requiredSpecificityTerms
  };
  return aggregateSupportAndOpposition(input, candidates.map((candidate) => scoreEvidenceCandidate(candidate, context)).sort((a, b) => scoreOrder[b.strength] - scoreOrder[a.strength] || byScore(a, b)));
}

// src/evidence/repository.ts
var pointerStance = (role) => role === "support" ? "supports" : role === "opposition" ? "opposes" : role === "conditional" ? "qualifies" : role === "neutral" ? "neutral" : "unknown";
var memoryEvidenceStance = (role) => role === "supports" || role === "source" ? "supports" : role === "contradicts" ? "opposes" : role === "qualifies" ? "qualifies" : "neutral";
var sourceKindForTarget = (targetType) => {
  if (targetType === "memory_object" || targetType === "claim") return "memory_object_with_pointers";
  if (targetType === "summary") return "generated_summary_with_pointers";
  if (targetType === "graph_edge") return "graph_edge_with_pointers";
  if (targetType === "graph_node") return "graph_edge_with_pointers";
  if (targetType === "answer_claim" || targetType === "answer") return "answer_claim_with_pointers";
  return "raw_transcript_span";
};
function getEvidenceCandidatesForTarget(db, targetType, targetId) {
  const pointers = db.prepare("SELECT * FROM evidence_pointers WHERE target_type=? AND target_id=? ORDER BY created_at,evidence_pointer_id").all(targetType, targetId);
  const memoryRow = targetType === "memory_object" || targetType === "claim" || targetType === "summary" ? db.prepare("SELECT * FROM memory_objects WHERE id=?").get(targetId) : void 0;
  const memorySpanIds = memoryRow ? db.prepare(`SELECT span_id FROM memory_object_evidence WHERE memory_id=?
      UNION SELECT span_id FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=?`).all(targetId, targetId) : [];
  const memory = memoryRow ? getCanonicalMemoryObject(memoryRow, memorySpanIds.map((row) => row.span_id)) : void 0;
  const memoryMetadata = memory ? { canonicalMemoryStatus: memory.status, duplicateOfId: memory.duplicateOfId, memoryUsableAsEvidence: isUsableAsEvidence(memory) } : {};
  const pointerCandidates = pointers.flatMap((pointer) => {
    const resolved = resolveEvidencePointer(db, pointer.evidence_pointer_id);
    if (!resolved.ok) return [];
    return [{
      id: pointer.evidence_pointer_id,
      evidencePointerId: pointer.evidence_pointer_id,
      transcriptId: pointer.transcript_id,
      spanIds: [pointer.span_id],
      quote: resolved.spanText,
      sourceKind: sourceKindForTarget(targetType),
      createdAt: pointer.created_at,
      turnTimestampStartMs: resolved.source.start_ms,
      turnTimestampEndMs: resolved.source.end_ms,
      retrievalScore: pointer.relevance_score ?? pointer.final_score ?? void 0,
      vectorScore: pointer.semantic_score ?? void 0,
      keywordScore: pointer.lexical_score ?? void 0,
      stance: pointerStance(pointer.evidence_role),
      sourceConfidence: pointer.confidence,
      provenanceValidated: true,
      metadata: { ...memoryMetadata, sourcePointerId: pointer.source_pointer_uri }
    }];
  });
  if (!memory) return pointerCandidates;
  const pointerSpanIds = new Set(pointerCandidates.flatMap((candidate) => candidate.spanIds));
  const legacyRows = db.prepare(`SELECT e.id,e.span_id,e.role,e.evidence_score,e.created_at,s.transcript_id,s.text,s.start_time_ms,s.end_time_ms
    FROM memory_object_evidence e JOIN transcript_spans s ON s.id=e.span_id WHERE e.memory_id=? ORDER BY e.created_at,e.id`).all(targetId);
  const legacyCandidates = legacyRows.filter((row) => !pointerSpanIds.has(row.span_id)).map((row) => ({
    id: row.id,
    transcriptId: row.transcript_id,
    spanIds: [row.span_id],
    quote: row.text,
    sourceKind: "memory_object_with_pointers",
    createdAt: row.created_at,
    turnTimestampStartMs: row.start_time_ms,
    turnTimestampEndMs: row.end_time_ms,
    retrievalScore: row.evidence_score,
    stance: memoryEvidenceStance(row.role),
    sourceConfidence: row.evidence_score,
    provenanceValidated: true,
    metadata: memoryMetadata
  }));
  return [...pointerCandidates, ...legacyCandidates];
}
function saveEvidenceScoreRun(db, assessment, options) {
  const id = options.id ?? createId("esr_");
  db.transaction(() => {
    db.prepare(`INSERT INTO evidence_score_runs(
      id,target_type,target_id,claim_text,use_type,strength,support_score,opposition_score,qualification_score,has_conflict,scorer_version,reasons_json,assessment_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,
      options.targetType,
      options.targetId ?? null,
      assessment.claimText,
      assessment.useType,
      assessment.strength,
      assessment.supportScore,
      assessment.oppositionScore,
      assessment.qualificationScore,
      assessment.hasConflict ? 1 : 0,
      assessment.scorerVersion,
      JSON.stringify(assessment.reasons),
      JSON.stringify(assessment)
    );
    assessment.scoredEvidence.forEach((item) => {
      const pointerId = item.candidate.evidencePointerId && db.prepare("SELECT 1 FROM evidence_pointers WHERE evidence_pointer_id=?").get(item.candidate.evidencePointerId) ? item.candidate.evidencePointerId : null;
      db.prepare(`INSERT INTO evidence_score_items(
      id,run_id,evidence_pointer_id,candidate_id,stance,final_score,strength,relevance,directness,specificity,source_strength,repetition,
      recency,correction_weight,confidence,opposition_penalty,caps_json,reasons_json,candidate_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        createId("esi_"),
        id,
        pointerId,
        item.candidate.id,
        item.stance,
        item.finalScore,
        item.strength,
        item.components.relevance,
        item.components.directness,
        item.components.specificity,
        item.components.sourceStrength,
        item.components.repetition,
        item.components.recency,
        item.components.correctionWeight,
        item.components.confidence,
        item.components.oppositionPenalty,
        JSON.stringify(item.caps),
        JSON.stringify(item.reasons),
        JSON.stringify(item.candidate)
      );
    });
  })();
  return id;
}

// src/retrieval/embeddingProvider.ts
var import_node_crypto5 = require("node:crypto");
var DeterministicTestEmbeddingProvider = class {
  constructor(dimensions = 32) {
    this.dimensions = dimensions;
  }
  dimensions;
  name = "deterministic-test";
  model = "token-hash-v1";
  async embedTexts(texts) {
    return texts.map((text) => {
      const vector = Array(this.dimensions).fill(0);
      for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        const hash = (0, import_node_crypto5.createHash)("sha256").update(token).digest();
        vector[hash[0] % this.dimensions] += hash[1] % 2 ? 1 : -1;
      }
      return vector;
    });
  }
};
var NoopEmbeddingProvider = class {
  name = "noop";
  model = "disabled";
  dimensions = 0;
  async embedTexts(texts) {
    return texts.map(() => []);
  }
};

// src/retrieval/externalEmbeddingProvider.ts
var EmbeddingError = class extends Error {
  context;
  constructor(message, context, options) {
    super(message, options);
    this.name = new.target.name;
    this.context = context;
  }
};
var EmbeddingAuthError = class extends EmbeddingError {
};
var EmbeddingRateLimitError = class extends EmbeddingError {
};
var EmbeddingProviderError = class extends EmbeddingError {
};
var EmbeddingResponseError = class extends EmbeddingError {
};
var REDACTED = "[redacted]";
function redactSecret(text, secret) {
  if (!secret || !secret.trim()) return text;
  return text.split(secret).join(REDACTED);
}
var DEFAULT_BASE_URL = "https://api.openai.com/v1";
function createHttpEmbeddingTransport(fetchImpl = globalThis.fetch) {
  return async (request) => {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onExternalAbort, { once: true });
    let timer;
    if (request.timeoutMs != null) timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        try {
          body = await response.text();
        } catch {
          body = null;
        }
      }
      return { status: response.status, body };
    } finally {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", onExternalAbort);
    }
  };
}
var ExternalEmbeddingProvider = class {
  // Only name/model/dimensions are public. The secret-bearing internals are true ECMAScript
  // private fields (#), which are not reflectable: they never appear in JSON.stringify, object
  // spread, Object.keys/getOwnPropertyNames, Reflect.ownKeys, or util.inspect.
  name;
  model;
  dimensions;
  #apiKey;
  #baseUrl;
  #transport;
  #timeoutMs;
  constructor(config) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new EmbeddingAuthError("External embedding provider requires a non-blank API key", { provider: config.provider, model: config.model });
    }
    if (!Number.isInteger(config.dimensions) || config.dimensions <= 0) {
      throw new EmbeddingResponseError("External embedding provider requires positive integer dimensions", { provider: config.provider, model: config.model });
    }
    this.name = config.provider;
    this.model = config.model;
    this.dimensions = config.dimensions;
    this.#apiKey = config.apiKey.trim();
    this.#baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#transport = config.transport ?? createHttpEmbeddingTransport();
    this.#timeoutMs = config.timeoutMs;
  }
  context(status) {
    return { provider: this.name, model: this.model, status };
  }
  async embedTexts(texts) {
    if (!texts.length) return [];
    let response;
    try {
      response = await this.#transport({
        url: `${this.#baseUrl}/embeddings`,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.#apiKey}` },
        body: JSON.stringify({ model: this.model, input: texts }),
        timeoutMs: this.#timeoutMs
      });
    } catch (error) {
      const detail = redactSecret(error instanceof Error ? error.message : String(error), this.#apiKey);
      throw new EmbeddingProviderError(`Embedding request failed: ${detail}`, this.context());
    }
    if (response.status === 401 || response.status === 403) {
      throw new EmbeddingAuthError("Embedding provider rejected the API key", this.context(response.status));
    }
    if (response.status === 429) {
      throw new EmbeddingRateLimitError("Embedding provider rate limit exceeded", this.context(response.status));
    }
    if (response.status < 200 || response.status >= 300) {
      throw new EmbeddingProviderError(`Embedding provider returned status ${response.status}`, this.context(response.status));
    }
    const data = response.body?.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new EmbeddingResponseError("Embedding response did not contain one vector per input", this.context(response.status));
    }
    const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return ordered.map((item) => {
      const vector = item.embedding;
      if (!Array.isArray(vector) || vector.length !== this.dimensions || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        throw new EmbeddingResponseError(`Embedding response vector did not match expected ${this.dimensions} finite dimensions`, this.context(response.status));
      }
      return vector;
    });
  }
};
var createExternalEmbeddingProvider = (config) => new ExternalEmbeddingProvider(config);

// src/retrieval/embeddingSpace.ts
var embeddingSpaceOf = (provider) => ({
  provider: provider.name,
  model: provider.model,
  dimensions: provider.dimensions
});
var sameEmbeddingSpace = (a, b) => a.provider === b.provider && a.model === b.model && a.dimensions === b.dimensions;
var isVectorCapable = (space) => space.dimensions > 0;
var DEFAULT_EMBEDDING_PROVIDER_ID = "deterministic-test";
var TOKEN_HASH_MODEL = "token-hash-v1";
function resolveEmbeddingProvider(id = DEFAULT_EMBEDDING_PROVIDER_ID, options) {
  if (options?.external) {
    const external = options.external;
    if (external.apiKey && external.apiKey.trim().length > 0) {
      return { provider: createExternalEmbeddingProvider(external), requestedId: external.provider, usedFallback: false };
    }
    return {
      provider: new DeterministicTestEmbeddingProvider(options?.dimensions),
      requestedId: external.provider,
      usedFallback: true,
      reason: `Embedding provider "${external.provider}" has no API key configured; using local deterministic ${TOKEN_HASH_MODEL}.`
    };
  }
  if (id === "noop" || id === "disabled") {
    return { provider: new NoopEmbeddingProvider(), requestedId: id, usedFallback: false };
  }
  if (id === DEFAULT_EMBEDDING_PROVIDER_ID || id === TOKEN_HASH_MODEL) {
    return { provider: new DeterministicTestEmbeddingProvider(options?.dimensions), requestedId: id, usedFallback: false };
  }
  return {
    provider: new DeterministicTestEmbeddingProvider(options?.dimensions),
    requestedId: id,
    usedFallback: true,
    reason: `Embedding provider "${id}" is not available yet; using local deterministic ${TOKEN_HASH_MODEL}.`
  };
}

// src/retrieval/reindexStatus.ts
var isProvider = (value) => typeof value.embedTexts === "function";
function detectReindexNeeded(db, active, options = {}) {
  const activeSpace = isProvider(active) ? embeddingSpaceOf(active) : active;
  const vectorCapable = isVectorCapable(activeSpace);
  const types = options.targetTypes;
  const typeClause = types && types.length ? ` WHERE target_type IN (${types.map(() => "?").join(",")})` : "";
  const typeArgs = types && types.length ? types : [];
  const documentCount = db.prepare(`SELECT COUNT(*) c FROM retrieval_documents${typeClause}`).get(...typeArgs).c;
  const joinTypeClause = types && types.length ? ` AND d.target_type IN (${types.map(() => "?").join(",")})` : "";
  const embeddedUnderActive = db.prepare(
    `SELECT COUNT(*) c FROM retrieval_documents d
     JOIN search_embeddings e ON e.target_type=d.target_type AND e.target_id=d.target_id
     WHERE e.embedding_provider=? AND e.embedding_model=? AND e.embedding_dim=?${joinTypeClause}`
  ).get(activeSpace.provider, activeSpace.model, activeSpace.dimensions, ...typeArgs).c;
  const missingUnderActive = Math.max(0, documentCount - embeddedUnderActive);
  const indexedSpaces = db.prepare(
    `SELECT embedding_provider provider, embedding_model model, embedding_dim dimensions, COUNT(*) count
     FROM search_embeddings${typeClause}
     GROUP BY embedding_provider, embedding_model, embedding_dim
     ORDER BY embedding_provider, embedding_model, embedding_dim`
  ).all(...typeArgs);
  const foreignSpaces = indexedSpaces.filter((space) => !sameEmbeddingSpace(space, activeSpace));
  const reasons = [];
  if (!vectorCapable) reasons.push("Embeddings are disabled for the active provider (0 dimensions).");
  if (documentCount === 0) reasons.push("No indexed documents to embed.");
  if (vectorCapable && documentCount > 0 && missingUnderActive > 0) {
    reasons.push(`${missingUnderActive} of ${documentCount} document(s) are not embedded under the active space (${activeSpace.provider}/${activeSpace.model}@${activeSpace.dimensions}).`);
  }
  if (foreignSpaces.length) {
    const total = foreignSpaces.reduce((sum, space) => sum + space.count, 0);
    reasons.push(`${total} embedding(s) are indexed under a different provider/model and are ignored by vector search.`);
  }
  const needsReindex = vectorCapable && documentCount > 0 && missingUnderActive > 0;
  return { activeSpace, vectorCapable, documentCount, embeddedUnderActive, missingUnderActive, indexedSpaces, foreignSpaces, needsReindex, reasons };
}

// src/memory/dedup.ts
function dedupeCanonicalMemories(db, options = {}) {
  const ts = options.now ?? now;
  const result = { canonicalGroups: 0, duplicatesSuperseded: 0, evidenceLinksConsolidated: 0 };
  return db.transaction(() => {
    const rows = db.prepare(`SELECT id, object_fingerprint, COALESCE(extraction_type,type) AS type, user_corrected, created_at
      FROM memory_objects
      WHERE object_fingerprint IS NOT NULL AND duplicate_of_id IS NULL
        AND status NOT IN ('superseded','rejected')
        AND (extraction_status IS NULL OR extraction_status NOT IN ('superseded','rejected'))`).all();
    const groups = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const key = `${row.type}|${row.object_fingerprint}`;
      const list = groups.get(key);
      if (list) list.push(row);
      else groups.set(key, [row]);
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const sorted = [...members].sort((a, b) => b.user_corrected - a.user_corrected || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      const canonical = sorted[0];
      let changed = false;
      for (const dup of sorted.slice(1)) {
        if (dup.user_corrected === 1) continue;
        const evidence = db.prepare("SELECT span_id, transcript_id, turn_id, evidence_score FROM memory_object_evidence WHERE memory_id=?").all(dup.id);
        for (const e of evidence) {
          if (!db.prepare("SELECT 1 FROM memory_object_evidence WHERE memory_id=? AND span_id=? LIMIT 1").get(canonical.id, e.span_id)) {
            const newId = stableProvenanceId("mev_", `${canonical.id}:${e.span_id}:supporting`);
            db.prepare(`INSERT OR IGNORE INTO memory_object_evidence(
              id,memory_id,span_id,role,evidence_score,created_at,metadata_json,transcript_id,turn_id,extraction_role
            ) VALUES (?,?,?,'source',?,?, '{}',?,?, 'supporting')`).run(newId, canonical.id, e.span_id, e.evidence_score, ts(), e.transcript_id, e.turn_id);
            result.evidenceLinksConsolidated += 1;
          }
          if (e.transcript_id) {
            try {
              linkMemoryObjectToSpan(db, { memoryObjectId: canonical.id, transcriptId: e.transcript_id, spanId: e.span_id });
            } catch {
            }
          }
        }
        const updated = db.prepare(`UPDATE memory_objects
          SET duplicate_of_id=?, status='superseded',
              extraction_status=CASE WHEN extraction_status IS NULL THEN NULL ELSE 'superseded' END,
              updated_at=?
          WHERE id=? AND user_corrected=0`).run(canonical.id, ts(), dup.id);
        if (updated.changes > 0) {
          result.duplicatesSuperseded += updated.changes;
          changed = true;
        }
      }
      if (changed) result.canonicalGroups += 1;
    }
    return result;
  })();
}

// src/memory/extraction/prompt.ts
var MEMORY_EXTRACTION_PROMPT_VERSION = "mvp-memory-extraction-v1";
var MEMORY_EXTRACTION_LLM_PROMPT_VERSION = "mvp-memory-extraction-llm-v1";
var MEMORY_EXTRACTION_LLM_SYSTEM = "You extract source-backed memory objects strictly from the transcript spans provided. Use ONLY the listed spans; never invent facts or cite span_ids that are not listed. Every object must include a supportingQuote copied verbatim from one of the spans it cites. Prefer fewer high-quality objects. Respond with JSON only.";
function buildLlmMemoryExtractionPrompt(window) {
  return [
    'Extract memory objects as JSON: {"objects":[{"type":"topic|quote|question|decision|action_item|objection|advice_idea","title":"...","body":"...","evidenceSpanIds":["<span_id>"],"supportingQuote":"<verbatim substring of a cited span>"}]}',
    'Cite only the span_ids below. Each object must include a supportingQuote copied verbatim from one cited span. If nothing is well supported, return {"objects":[]}.',
    "",
    "Spans:",
    window.text
  ].join("\n");
}

// src/memory/extraction/llmExtractor.ts
var MemoryExtractionError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "MemoryExtractionError";
  }
};
var VALID_TYPES = ["topic", "quote", "question", "decision", "action_item", "objection", "advice_idea"];
var normalizeForMatch2 = (value) => value.toLowerCase().replace(/\s+/g, " ").trim();
function parseAndGroundMemoryCandidates(rawText, window) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new MemoryExtractionError("LLM memory extraction output was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.objects)) {
    throw new MemoryExtractionError("LLM memory extraction output did not contain an objects array");
  }
  const spanTextById = new Map(window.spans.map((span) => [span.spanId, normalizeForMatch2(span.text)]));
  const grounded = [];
  for (const raw of parsed.objects) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw;
    if (typeof candidate.type !== "string" || !VALID_TYPES.includes(candidate.type)) continue;
    if (typeof candidate.title !== "string" || !candidate.title.trim()) continue;
    if (typeof candidate.body !== "string" || !candidate.body.trim()) continue;
    const ids = candidate.evidenceSpanIds;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) continue;
    const evidenceSpanIds = [...new Set(ids)].filter((id) => spanTextById.has(id));
    if (!evidenceSpanIds.length) continue;
    const quote2 = candidate.supportingQuote;
    if (typeof quote2 !== "string" || !quote2.trim()) continue;
    const needle = normalizeForMatch2(quote2);
    const anchored = needle.length > 0 && evidenceSpanIds.some((id) => spanTextById.get(id)?.includes(needle));
    if (!anchored) continue;
    grounded.push({
      type: candidate.type,
      title: candidate.title.trim(),
      body: candidate.body.trim(),
      evidenceSpanIds,
      confidence: 0,
      // LLM self-reported confidence is NOT trusted; the pipeline caps LLM candidates to needs_review
      reason: quote2.trim()
      // grounded supportingQuote -> persisted in metadata_json.extraction_reason for audit
    });
  }
  return grounded;
}
function createLlmMemoryExtractor(provider, options = {}) {
  const fallback = options.fallback;
  return {
    kind: "llm",
    model: provider.model,
    promptVersion: MEMORY_EXTRACTION_LLM_PROMPT_VERSION,
    async extract(window) {
      const requestOptions = {};
      if (options.timeoutMs != null) requestOptions.timeoutMs = options.timeoutMs;
      let text;
      try {
        text = (await provider.complete({ system: MEMORY_EXTRACTION_LLM_SYSTEM, prompt: buildLlmMemoryExtractionPrompt(window), responseFormat: "json" }, requestOptions)).text;
      } catch {
        if (fallback) return fallback.extract(window);
        throw new MemoryExtractionError("LLM memory extraction request failed");
      }
      let grounded;
      try {
        grounded = parseAndGroundMemoryCandidates(text, window);
      } catch {
        if (fallback) return fallback.extract(window);
        throw new MemoryExtractionError("LLM memory extraction output was not valid");
      }
      return grounded.length ? grounded : fallback ? fallback.extract(window) : grounded;
    }
  };
}

// src/memory/extraction/normalize.ts
function normalizeMemoryText(title, body) {
  return `${title} ${body}`.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function memoryFingerprint(type, normalizedText) {
  return contentHash(`${type}:${normalizedText}`);
}
function tokenJaccard(a, b) {
  const left = new Set(a.split(/\s+/).filter(Boolean)), right = new Set(b.split(/\s+/).filter(Boolean));
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = (/* @__PURE__ */ new Set([...left, ...right])).size;
  return union ? intersection / union : 0;
}

// src/memory/extraction/confidence.ts
var vague = /* @__PURE__ */ new Set(["ai", "transcript", "discussion", "project", "thing", "something"]);
function scoreCandidateConfidence(candidate, spans) {
  const extractor = Math.max(0, Math.min(1, candidate.confidence));
  const coverage = Math.min(1, 0.55 + Math.max(0, spans.length - 1) * 0.2);
  const normalizedTitle = candidate.title.toLowerCase().trim();
  const specificity = vague.has(normalizedTitle) || normalizedTitle.split(/\s+/).length < 2 ? 0.25 : Math.min(1, 0.55 + normalizedTitle.split(/\s+/).length * 0.06);
  const typeRule = candidate.type === "quote" ? 1 : candidate.type === "decision" || candidate.type === "action_item" ? 0.9 : 0.8;
  const finalConfidence = Math.max(0, Math.min(1, 0.45 * extractor + 0.25 * coverage + 0.15 * specificity + 0.15 * typeRule));
  const confidenceLabel2 = finalConfidence >= 0.8 ? "high" : finalConfidence >= 0.6 ? "medium" : "low";
  const status = confidenceLabel2 === "low" ? candidate.type === "decision" || candidate.type === "action_item" ? "needs_review" : "weak" : candidate.type === "decision" || candidate.type === "action_item" ? confidenceLabel2 === "high" ? "active" : "needs_review" : "active";
  return { finalConfidence, confidenceLabel: confidenceLabel2, status };
}

// src/memory/extraction/validator.ts
var validTypes = /* @__PURE__ */ new Set(["topic", "quote", "question", "decision", "action_item", "objection", "advice_idea"]);
var genericTopics = /* @__PURE__ */ new Set(["ai", "transcript", "discussion", "project"]);
function validateMemoryCandidate(candidate, window) {
  if (!validTypes.has(candidate.type)) return { ok: false, problem: `Invalid memory object type: ${String(candidate.type)}` };
  if (!candidate.title?.trim() || !candidate.body?.trim()) return { ok: false, problem: "Candidate title and body are required" };
  if (candidate.title.length > 300 || candidate.body.length > 4e3) return { ok: false, problem: "Candidate title or body is too long" };
  if (!candidate.evidenceSpanIds?.length) return { ok: false, problem: "Candidate has no evidence spans" };
  const spanMap = new Map(window.spans.map((span) => [span.spanId, span]));
  const evidenceSpans = [...new Set(candidate.evidenceSpanIds)].map((id) => spanMap.get(id));
  if (evidenceSpans.some((span) => !span)) return { ok: false, problem: "Candidate references a span outside its extraction window" };
  const validSpans = evidenceSpans.filter((span) => span != null);
  if (validSpans.some((span) => span.transcriptId !== window.transcriptId)) return { ok: false, problem: "Evidence span belongs to another transcript" };
  if (candidate.type === "quote" && !validSpans.some((span) => span.text.includes(candidate.body))) return { ok: false, problem: "Quote body is not exact source text" };
  if (candidate.type === "topic" && genericTopics.has(candidate.title.trim().toLowerCase())) return { ok: false, problem: "Topic is too generic" };
  if (/\bthe transcript proves\b/i.test(candidate.body) && !validSpans.some((span) => /the transcript proves/i.test(span.text))) {
    return { ok: false, problem: "Candidate contains an unsupported meta-claim" };
  }
  const clamped = { ...candidate, confidence: Math.max(0, Math.min(1, Number.isFinite(candidate.confidence) ? candidate.confidence : 0)) };
  const normalizedText = normalizeMemoryText(clamped.title, clamped.body);
  const fingerprint = memoryFingerprint(clamped.type, normalizedText);
  const scored = scoreCandidateConfidence(clamped, validSpans);
  return { ok: true, candidate: { ...clamped, transcriptId: window.transcriptId, normalizedText, fingerprint, evidenceSpans: validSpans, ...scored } };
}

// src/memory/extraction/duplicateDetection.ts
function findDuplicateMemoryObject(db, candidate) {
  const spanIds = new Set(candidate.evidenceSpans.map((span) => span.spanId));
  const overlaps = (id) => db.prepare("SELECT span_id FROM memory_object_evidence WHERE memory_id=?").all(id).some((row) => spanIds.has(row.span_id));
  const exacts = db.prepare(`SELECT * FROM memory_objects WHERE object_fingerprint=? ORDER BY user_corrected DESC, created_at`).all(candidate.fingerprint);
  const exact = exacts.find((object) => overlaps(object.id)) ?? exacts[0];
  if (exact) return { object: exact, kind: "exact", evidenceOverlaps: overlaps(exact.id) };
  const candidates = db.prepare(`SELECT * FROM memory_objects WHERE extraction_type=? AND normalized_text IS NOT NULL ORDER BY user_corrected DESC, created_at`).all(candidate.type);
  for (const existing of candidates) {
    if (tokenJaccard(candidate.normalizedText, existing.normalized_text) >= 0.82) return { object: existing, kind: "near", evidenceOverlaps: overlaps(existing.id) };
  }
  return null;
}

// src/memory/extraction/repository.ts
var legacyType = { topic: "topic", quote: "quote", question: "question", decision: "decision", action_item: "task", objection: "concept", advice_idea: "concept" };
var legacyStatus = { active: "active", weak: "needs_review", needs_review: "needs_review" };
function createExtractionRun(db, input) {
  if (!db.prepare("SELECT 1 FROM transcripts WHERE id=?").get(input.transcriptId)) throw new NotFoundError(`Transcript not found: ${input.transcriptId}`);
  const id = createId("xrun_");
  db.prepare(`INSERT INTO extraction_runs(id,transcript_id,started_at,status,extractor_kind,extractor_model,prompt_version,config_json)
    VALUES (?,?,?,'running',?,?,?,?)`).run(id, input.transcriptId, now(), input.extractorKind, input.extractorModel ?? null, input.promptVersion, json(input.config));
  return id;
}
function completeExtractionRun(db, id) {
  db.prepare("UPDATE extraction_runs SET status='completed',completed_at=? WHERE id=?").run(now(), id);
}
function failExtractionRun(db, id, error) {
  db.prepare("UPDATE extraction_runs SET status='failed',completed_at=?,error_message=? WHERE id=?").run(now(), error, id);
}
function loadSpansForTranscript(db, transcriptId) {
  return db.prepare(`SELECT s.transcript_id transcriptId,
    (SELECT tt.id FROM transcript_turns tt WHERE tt.transcript_id=s.transcript_id AND tt.start_char<=s.start_char AND tt.end_char>=s.end_char ORDER BY tt.turn_index LIMIT 1) turnId,
    s.id spanId,s.speaker_label speaker,s.start_char startOffset,s.end_char endOffset,s.text,s.start_time_ms startTimeMs,s.end_time_ms endTimeMs
    FROM transcript_spans s WHERE s.transcript_id=? ORDER BY s.ordinal`).all(transcriptId);
}
function buildExtractionWindows(spans, maxWindowChars = 4e3, overlapSpans = 0) {
  if (!spans.length) return [];
  const windows = [];
  let start = 0;
  while (start < spans.length) {
    const selected = [];
    let chars = 0, index = start;
    while (index < spans.length && (!selected.length || chars + spans[index].text.length <= maxWindowChars)) {
      selected.push(spans[index]);
      chars += spans[index].text.length;
      index++;
    }
    const transcriptId = selected[0].transcriptId;
    windows.push({
      transcriptId,
      windowId: stableProvenanceId("win_", `${transcriptId}:${selected.map((span) => span.spanId).join(":")}`),
      spans: selected,
      text: selected.map((span) => `[span_id=${span.spanId} speaker=${span.speaker ?? "unknown"}]
${span.text}`).join("\n\n")
    });
    if (index >= spans.length) break;
    start = Math.max(start + 1, index - Math.max(0, overlapSpans));
  }
  return windows;
}
function storeMemoryObjectWithEvidence(db, runId, promptVersion, candidate, duplicateOfId = null) {
  const sortedSpanIds = candidate.evidenceSpans.map((span) => span.spanId).sort();
  const id = stableProvenanceId("mem_", `${candidate.transcriptId}:${candidate.type}:${candidate.normalizedText}:${sortedSpanIds.join(":")}`);
  return db.transaction(() => {
    const timestamp = now();
    db.prepare(`INSERT OR IGNORE INTO memory_objects(
      id,type,title,generated_text,normalized_text,status,confidence,created_by,created_at,updated_at,metadata_json,
      extraction_type,extraction_status,generated_by,generated_at,extraction_run_id,prompt_version,confidence_label,object_fingerprint,duplicate_of_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'needs_review',?,?,?,?,?,?,?)`).run(
      id,
      legacyType[candidate.type],
      candidate.title,
      candidate.body,
      candidate.normalizedText,
      legacyStatus[candidate.status],
      candidate.finalConfidence,
      "agent",
      timestamp,
      timestamp,
      json({ extraction_reason: candidate.reason ?? null }),
      candidate.type,
      "memory_extraction_pipeline",
      timestamp,
      runId,
      promptVersion,
      candidate.confidenceLabel,
      candidate.fingerprint,
      duplicateOfId
    );
    for (const [index, span] of candidate.evidenceSpans.entries()) {
      const evidenceId = stableProvenanceId("mev_", `${id}:${span.spanId}:primary`);
      db.prepare(`INSERT OR IGNORE INTO memory_object_evidence(
        id,memory_id,span_id,role,evidence_score,created_at,metadata_json,transcript_id,turn_id,extraction_role
      ) VALUES (?,?,?,'source',?,?, '{}',?,?,?)`).run(evidenceId, id, span.spanId, candidate.finalConfidence, timestamp, span.transcriptId, span.turnId, index === 0 ? "primary" : "supporting");
    }
    db.prepare("UPDATE memory_objects SET extraction_status=? WHERE id=? AND user_corrected=0").run(candidate.status, id);
    return db.prepare("SELECT * FROM memory_objects WHERE id=?").get(id);
  })();
}
function markDuplicate(db, candidate, existingObjectId, runId, promptVersion) {
  return storeMemoryObjectWithEvidence(db, runId, promptVersion, { ...candidate, status: "needs_review" }, existingObjectId);
}
function attachEvidenceToMemory(db, memoryId, candidate) {
  return db.transaction(() => {
    const timestamp = now();
    let added = 0;
    for (const span of candidate.evidenceSpans) {
      if (db.prepare("SELECT 1 FROM memory_object_evidence WHERE memory_id=? AND span_id=? LIMIT 1").get(memoryId, span.spanId)) continue;
      const evidenceId = stableProvenanceId("mev_", `${memoryId}:${span.spanId}:supporting`);
      db.prepare(`INSERT OR IGNORE INTO memory_object_evidence(
        id,memory_id,span_id,role,evidence_score,created_at,metadata_json,transcript_id,turn_id,extraction_role
      ) VALUES (?,?,?,'source',?,?, '{}',?,?, 'supporting')`).run(evidenceId, memoryId, span.spanId, candidate.finalConfidence, timestamp, span.transcriptId, span.turnId);
      added += 1;
    }
    return added;
  })();
}

// src/memory/extraction/pipeline.ts
async function extractMemoryObjectsForTranscript(db, options) {
  const promptVersion = options.extractor.promptVersion ?? MEMORY_EXTRACTION_PROMPT_VERSION;
  const runId = createExtractionRun(db, {
    transcriptId: options.transcriptId,
    extractorKind: options.extractor.kind ?? "test",
    extractorModel: options.extractor.model,
    promptVersion,
    config: { maxWindowChars: options.maxWindowChars ?? 4e3, overlapSpans: options.overlapSpans ?? 0, force: options.force ?? false }
  });
  const result = {
    extractionRunId: runId,
    transcriptId: options.transcriptId,
    windowsProcessed: 0,
    candidatesExtracted: 0,
    objectsInserted: 0,
    duplicatesSkipped: 0,
    weakObjectsInserted: 0,
    rejectedCandidates: 0,
    errors: []
  };
  try {
    const spans = loadSpansForTranscript(db, options.transcriptId);
    const windows = buildExtractionWindows(spans, options.maxWindowChars, options.overlapSpans);
    for (const window of windows) {
      let candidates;
      try {
        candidates = await options.extractor.extract(window);
        result.windowsProcessed++;
      } catch (error) {
        result.errors.push(`Window ${window.windowId}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      result.candidatesExtracted += candidates.length;
      for (const extracted of candidates) {
        const validation = validateMemoryCandidate(extracted, window);
        if (!validation.ok) {
          result.rejectedCandidates++;
          result.errors.push(validation.problem);
          continue;
        }
        const candidate = options.extractor.kind === "llm" ? { ...validation.candidate, status: "needs_review" } : validation.candidate;
        const duplicate = findDuplicateMemoryObject(db, candidate);
        if (duplicate) {
          const canonical = duplicate.object;
          const blocked = canonical.extraction_status === "rejected" || canonical.extraction_status === "superseded";
          if (!blocked && duplicate.kind === "exact") {
            attachEvidenceToMemory(db, canonical.id, candidate);
            result.duplicatesSkipped++;
            continue;
          }
          if (!blocked) {
            markDuplicate(db, candidate, canonical.id, runId, promptVersion);
            result.objectsInserted++;
            result.duplicatesSkipped++;
            result.weakObjectsInserted++;
            continue;
          }
          result.duplicatesSkipped++;
          continue;
        }
        try {
          storeMemoryObjectWithEvidence(db, runId, promptVersion, candidate);
          result.objectsInserted++;
          if (candidate.status !== "active") result.weakObjectsInserted++;
        } catch (error) {
          result.rejectedCandidates++;
          result.errors.push(`Store candidate "${candidate.title}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (windows.length > 0 && result.windowsProcessed === 0) failExtractionRun(db, runId, result.errors.join("\n") || "No extraction windows completed");
    else completeExtractionRun(db, runId);
    return result;
  } catch (error) {
    failExtractionRun(db, runId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// src/retrieval/embeddingStore.ts
function validateVector(vector, dimensions) {
  if (!vector.length || vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new ValidationError(`Invalid embedding vector; expected ${dimensions} finite dimensions`);
  }
}
function cosineSimilarity(a, b) {
  if (!a.length || a.length !== b.length) throw new ValidationError("Vector dimensions must match");
  let dot = 0, left = 0, right = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    left += a[i] ** 2;
    right += b[i] ** 2;
  }
  if (!left || !right) return 0;
  return Math.max(0, Math.min(1, (dot / Math.sqrt(left * right) + 1) / 2));
}
async function upsertEmbedding(db, input) {
  if (input.provider.dimensions <= 0) return false;
  const existing = db.prepare(`SELECT content_hash FROM search_embeddings WHERE target_type=? AND target_id=? AND embedding_provider=? AND embedding_model=?`).get(input.targetType, input.targetId, input.provider.name, input.provider.model);
  if (existing?.content_hash === input.contentHash) return false;
  const vector = (await input.provider.embedTexts([input.text]))[0];
  return storeEmbeddingVector(db, { targetType: input.targetType, targetId: input.targetId, contentHash: input.contentHash, provider: input.provider, vector });
}
function storeEmbeddingVector(db, input) {
  if (input.provider.dimensions <= 0) return false;
  const existing = db.prepare(`SELECT content_hash FROM search_embeddings WHERE target_type=? AND target_id=? AND embedding_provider=? AND embedding_model=?`).get(input.targetType, input.targetId, input.provider.name, input.provider.model);
  if (existing?.content_hash === input.contentHash) return false;
  const vector = input.vector;
  validateVector(vector, input.provider.dimensions);
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(`INSERT INTO search_embeddings(id,target_type,target_id,embedding_provider,embedding_model,embedding_dim,content_hash,vector_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(target_type,target_id,embedding_provider,embedding_model) DO UPDATE SET embedding_dim=excluded.embedding_dim,content_hash=excluded.content_hash,vector_json=excluded.vector_json,updated_at=excluded.updated_at`).run(stableProvenanceId("semb_", `${input.targetType}:${input.targetId}:${input.provider.name}:${input.provider.model}`), input.targetType, input.targetId, input.provider.name, input.provider.model, input.provider.dimensions, input.contentHash, JSON.stringify(vector), timestamp, timestamp);
  return true;
}

// src/retrieval/indexer.ts
function pointerMetadata(db, targetType, targetId) {
  const rows = db.prepare(`SELECT evidence_pointer_id,source_pointer_uri,transcript_id,evidence_role,evidence_strength,confidence,final_score
    FROM evidence_pointers WHERE target_type=? AND target_id=? ORDER BY evidence_pointer_id`).all(targetType, targetId);
  const support = rows.some((row) => row.evidence_role === "support"), opposition = rows.some((row) => row.evidence_role === "opposition");
  const supportRole = support && opposition ? "mixed" : opposition ? "opposing" : support ? "supporting" : "unknown";
  return {
    rows,
    supportRole,
    evidenceScore: rows.length ? Math.max(...rows.map((row) => row.final_score ?? row.confidence)) : 0.5,
    evidencePointerIds: rows.map((row) => row.evidence_pointer_id),
    sourcePointerIds: rows.map((row) => row.source_pointer_uri)
  };
}
function spanDocument(db, spanId) {
  const row = db.prepare(`SELECT s.id,s.transcript_id,s.source_id,s.speaker_id,s.speaker_label,s.text,s.created_at,t.updated_at
    FROM transcript_spans s JOIN transcripts t ON t.id=s.transcript_id WHERE s.id=?`).get(spanId);
  if (!row) throw new NotFoundError(`Transcript span not found: ${spanId}`);
  const pointers = db.prepare("SELECT pointer_uri FROM source_pointers WHERE span_id=?").all(spanId);
  const evidence = db.prepare("SELECT evidence_pointer_id,evidence_role,confidence,final_score FROM evidence_pointers WHERE span_id=?").all(spanId);
  const opposition = evidence.some((item) => item.evidence_role === "opposition"), support = evidence.some((item) => item.evidence_role === "support");
  return { targetType: "transcript_span", targetId: spanId, transcriptId: row.transcript_id, sourceId: row.source_id, speakerId: row.speaker_id, speakerName: row.speaker_label, memoryType: null, memoryStatus: null, title: null, text: row.text, topicText: null, createdAt: row.created_at, updatedAt: row.updated_at, evidenceScore: evidence.length ? Math.max(...evidence.map((item) => item.final_score ?? item.confidence)) : 0.5, supportRole: support && opposition ? "mixed" : opposition ? "opposing" : support ? "supporting" : "unknown", evidencePointerIds: evidence.map((item) => item.evidence_pointer_id), sourcePointerIds: pointers.map((item) => item.pointer_uri) };
}
function memoryDocument(db, id) {
  const raw = db.prepare("SELECT * FROM memory_objects WHERE id=?").get(id);
  const canonical = createMemoryObjectsRepo(db).getCanonicalMemoryObject(id);
  if (!raw || !canonical) throw new NotFoundError(`Memory object not found: ${id}`);
  const pointer = pointerMetadata(db, "memory_object", id);
  const legacyEvidence = db.prepare(`SELECT e.span_id,s.transcript_id,s.source_id,s.speaker_id,s.speaker_label
    FROM memory_object_evidence e JOIN transcript_spans s ON s.id=e.span_id WHERE e.memory_id=?`).all(id);
  const transcriptId = pointer.rows[0]?.transcript_id ?? legacyEvidence[0]?.transcript_id ?? null;
  const linkedSpan = legacyEvidence[0] ?? db.prepare(`SELECT s.transcript_id,s.source_id,s.speaker_id,s.speaker_label
    FROM evidence_pointers e JOIN transcript_spans s ON s.id=e.span_id WHERE e.target_type='memory_object' AND e.target_id=? LIMIT 1`).get(id);
  const sourcePointers = db.prepare(`SELECT sp.pointer_uri FROM source_pointers sp WHERE sp.span_id IN (SELECT span_id FROM memory_object_evidence WHERE memory_id=?)`).all(id);
  const evidencePointerIds = pointer.evidencePointerIds;
  return { targetType: "memory_object", targetId: id, transcriptId, sourceId: linkedSpan?.source_id ?? null, speakerId: linkedSpan?.speaker_id ?? null, speakerName: linkedSpan?.speaker_label ?? null, memoryType: canonical.type, memoryStatus: canonical.status, title: canonical.title, text: canonical.body, topicText: canonical.type === "topic" ? canonical.title : null, createdAt: String(raw.created_at), updatedAt: String(raw.updated_at), evidenceScore: isStrongMemoryObject(canonical) ? canonical.confidence : Math.min(canonical.confidence, 0.45), supportRole: pointer.supportRole, evidencePointerIds: [...evidencePointerIds], sourcePointerIds: [.../* @__PURE__ */ new Set([...pointer.sourcePointerIds, ...sourcePointers.map((item) => item.pointer_uri)])] };
}
function evidenceDocument(db, id) {
  const row = db.prepare("SELECT * FROM evidence_pointers WHERE evidence_pointer_id=?").get(id);
  if (!row) throw new NotFoundError(`Evidence pointer not found: ${id}`);
  const span = db.prepare("SELECT source_id,speaker_id,speaker_label FROM transcript_spans WHERE id=?").get(row.span_id);
  return { targetType: "evidence_pointer", targetId: id, transcriptId: row.transcript_id, sourceId: span.source_id, speakerId: span.speaker_id, speakerName: span.speaker_label, memoryType: null, memoryStatus: null, title: null, text: row.quote_preview, topicText: null, createdAt: row.created_at, updatedAt: row.created_at, evidenceScore: row.final_score ?? row.confidence, supportRole: row.evidence_role === "support" ? "supporting" : row.evidence_role === "opposition" ? "opposing" : "unknown", evidencePointerIds: [id], sourcePointerIds: [row.source_pointer_uri] };
}
function getDocument(db, type, id) {
  return type === "transcript_span" ? spanDocument(db, id) : type === "memory_object" ? memoryDocument(db, id) : evidenceDocument(db, id);
}
async function indexDocument(db, type, id, options = {}) {
  try {
    const doc = getDocument(db, type, id);
    const text = `${doc.title ?? ""}
${doc.text}`.trim(), embeddingHash = contentHash(text);
    const hash = contentHash(JSON.stringify({ text, transcriptId: doc.transcriptId, sourceId: doc.sourceId, speakerId: doc.speakerId, speakerName: doc.speakerName, memoryType: doc.memoryType, memoryStatus: doc.memoryStatus, evidenceScore: doc.evidenceScore, supportRole: doc.supportRole, evidencePointerIds: doc.evidencePointerIds, sourcePointerIds: doc.sourcePointerIds }));
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const previous = db.prepare("SELECT indexed_hash FROM retrieval_index_status WHERE target_type=? AND target_id=?").get(type, id);
    const skipped = previous?.indexed_hash === hash && !options.force;
    if (!skipped) {
      db.prepare(`INSERT INTO retrieval_documents(id,target_type,target_id,transcript_id,source_id,speaker_id,speaker_name,memory_type,memory_status,title,search_text,topic_text,created_at,updated_at,evidence_score,support_role,evidence_pointer_ids_json,source_pointer_ids_json,content_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(target_type,target_id) DO UPDATE SET transcript_id=excluded.transcript_id,source_id=excluded.source_id,speaker_id=excluded.speaker_id,speaker_name=excluded.speaker_name,memory_type=excluded.memory_type,memory_status=excluded.memory_status,title=excluded.title,search_text=excluded.search_text,topic_text=excluded.topic_text,created_at=excluded.created_at,updated_at=excluded.updated_at,evidence_score=excluded.evidence_score,support_role=excluded.support_role,evidence_pointer_ids_json=excluded.evidence_pointer_ids_json,source_pointer_ids_json=excluded.source_pointer_ids_json,content_hash=excluded.content_hash`).run(`${type}:${id}`, type, id, doc.transcriptId, doc.sourceId, doc.speakerId, doc.speakerName, doc.memoryType, doc.memoryStatus, doc.title, doc.text, doc.topicText, doc.createdAt, doc.updatedAt, doc.evidenceScore, doc.supportRole, JSON.stringify(doc.evidencePointerIds), JSON.stringify(doc.sourcePointerIds), hash);
      try {
        db.prepare("DELETE FROM retrieval_documents_fts WHERE target_type=? AND target_id=?").run(type, id);
        db.prepare("INSERT INTO retrieval_documents_fts(target_type,target_id,title,search_text,speaker_name,topic_text) VALUES (?,?,?,?,?,?)").run(type, id, doc.title, doc.text, doc.speakerName, doc.topicText);
      } catch {
      }
    }
    const embedded = options.embeddingProvider ? await upsertEmbedding(db, { targetType: type, targetId: id, text, contentHash: embeddingHash, provider: options.embeddingProvider }) : false;
    db.prepare(`INSERT INTO retrieval_index_status(target_type,target_id,indexed_hash,keyword_indexed_at,embedding_indexed_at,embedding_provider,embedding_model,error)
      VALUES (?,?,?,?,?,?,?,NULL)
      ON CONFLICT(target_type,target_id) DO UPDATE SET indexed_hash=excluded.indexed_hash,keyword_indexed_at=excluded.keyword_indexed_at,embedding_indexed_at=COALESCE(excluded.embedding_indexed_at,retrieval_index_status.embedding_indexed_at),embedding_provider=COALESCE(excluded.embedding_provider,retrieval_index_status.embedding_provider),embedding_model=COALESCE(excluded.embedding_model,retrieval_index_status.embedding_model),error=NULL`).run(type, id, hash, timestamp, embedded ? timestamp : null, options.embeddingProvider?.name ?? null, options.embeddingProvider?.model ?? null);
    return { embedded, skipped };
  } catch (error) {
    db.prepare(`INSERT INTO retrieval_index_status(target_type,target_id,indexed_hash,error) VALUES (?,?,'',?)
      ON CONFLICT(target_type,target_id) DO UPDATE SET error=excluded.error`).run(type, id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
function removeRetrievalDocument(db, targetType, targetId) {
  try {
    db.prepare("DELETE FROM retrieval_documents_fts WHERE target_type=? AND target_id=?").run(targetType, targetId);
  } catch {
  }
  db.prepare("DELETE FROM retrieval_documents WHERE target_type=? AND target_id=?").run(targetType, targetId);
  db.prepare("DELETE FROM search_embeddings WHERE target_type=? AND target_id=?").run(targetType, targetId);
  db.prepare("DELETE FROM retrieval_index_status WHERE target_type=? AND target_id=?").run(targetType, targetId);
}
async function rebuildRetrievalIndex(db, options = {}) {
  const types = options.targetTypes ?? ["transcript_span", "memory_object", "evidence_pointer"];
  let indexed = 0, skipped = 0, embedded = 0, errors = 0;
  const table = { transcript_span: ["transcript_spans", "id"], memory_object: ["memory_objects", "id"], evidence_pointer: ["evidence_pointers", "evidence_pointer_id"] };
  for (const type of types) {
    for (const row of db.prepare(`SELECT ${table[type][1]} id FROM ${table[type][0]}`).all()) {
      try {
        const result = await indexDocument(db, type, row.id, { ...options, embeddingProvider: void 0 });
        result.skipped ? skipped++ : indexed++;
      } catch {
        errors++;
      }
    }
  }
  const provider = options.embeddingProvider;
  if (provider && provider.dimensions > 0) {
    const placeholders = types.map(() => "?").join(",");
    const documents = db.prepare(`SELECT target_type,target_id,title,search_text FROM retrieval_documents WHERE target_type IN (${placeholders})`).all(...types);
    const pending = documents.map((doc) => {
      const text = `${doc.title ?? ""}
${doc.search_text}`.trim(), hash = contentHash(text);
      const existing = db.prepare(`SELECT content_hash FROM search_embeddings WHERE target_type=? AND target_id=? AND embedding_provider=? AND embedding_model=?`).get(doc.target_type, doc.target_id, provider.name, provider.model);
      return existing?.content_hash === hash ? null : { ...doc, text, hash };
    }).filter((item) => item != null);
    const batchSize = Math.max(1, options.batchSize ?? 64);
    for (let start = 0; start < pending.length; start += batchSize) {
      const batch = pending.slice(start, start + batchSize);
      try {
        const vectors = await provider.embedTexts(batch.map((item) => item.text));
        if (vectors.length !== batch.length) throw new Error("Embedding provider returned the wrong batch size");
        vectors.forEach((vector, index) => {
          const item = batch[index];
          validateVector(vector, provider.dimensions);
          if (storeEmbeddingVector(db, { targetType: item.target_type, targetId: item.target_id, contentHash: item.hash, provider, vector })) embedded++;
          db.prepare(`UPDATE retrieval_index_status SET embedding_indexed_at=?,embedding_provider=?,embedding_model=?,error=NULL WHERE target_type=? AND target_id=?`).run((/* @__PURE__ */ new Date()).toISOString(), provider.name, provider.model, item.target_type, item.target_id);
        });
      } catch (error) {
        errors += batch.length;
        for (const item of batch) db.prepare("UPDATE retrieval_index_status SET error=? WHERE target_type=? AND target_id=?").run(error instanceof Error ? error.message : String(error), item.target_type, item.target_id);
      }
    }
  }
  return { indexed, skipped, embedded, errors };
}

// src/retrieval/transcriptIndex.ts
var mapEvidenceRole = (role) => role === "contradicts" ? "opposition" : role === "qualifies" ? "conditional" : role === "context" ? "neutral" : "support";
async function indexTranscriptForRetrieval(db, transcriptId) {
  const repo = createMemoryObjectsRepo(db);
  const memoryIds = db.prepare("SELECT DISTINCT memory_id FROM memory_object_evidence WHERE transcript_id=?").all(transcriptId);
  let evidencePointersBridged = 0;
  for (const { memory_id } of memoryIds) {
    const canonical = repo.getCanonicalMemoryObject(memory_id);
    if (!canonical || !isUsableAsEvidence(canonical)) continue;
    const rows = db.prepare("SELECT span_id, role, evidence_score, transcript_id FROM memory_object_evidence WHERE memory_id=? AND transcript_id=?").all(memory_id, transcriptId);
    for (const row of rows) {
      linkMemoryObjectToSpan(db, { memoryObjectId: memory_id, transcriptId: row.transcript_id, spanId: row.span_id, evidenceRole: mapEvidenceRole(row.role), confidence: row.evidence_score });
      evidencePointersBridged++;
    }
  }
  const index = await rebuildRetrievalIndex(db);
  return { transcriptId, evidencePointersBridged, indexed: index.indexed, skipped: index.skipped };
}

// src/retrieval/filters.ts
function inList(value, list, insensitive = false) {
  if (!list?.length) return true;
  if (value == null) return false;
  return insensitive ? list.some((item) => item.toLowerCase() === value.toLowerCase()) : list.includes(value);
}
function validDate(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function documentMatchesFilters(row, filters = {}) {
  if (!inList(row.transcript_id, filters.transcriptIds) || !inList(row.source_id, filters.sourceIds) || !inList(row.speaker_id, filters.speakerIds) || !inList(row.speaker_name, filters.speakerNames, true) || !inList(row.memory_type, filters.memoryTypes) || !inList(row.memory_status, filters.memoryStatuses)) return false;
  if (filters.minEvidenceScore != null && row.evidence_score < filters.minEvidenceScore) return false;
  if (filters.includeGenerated === false && row.target_type !== "transcript_span") return false;
  if (row.target_type === "memory_object" && filters.includeUnsupportedMemory !== true) {
    if (row.memory_status === "rejected" || row.memory_status === "superseded" || JSON.parse(row.evidence_pointer_ids_json).length === 0 && JSON.parse(row.source_pointer_ids_json).length === 0) return false;
  }
  const created = validDate(row.created_at ?? void 0), updated = validDate(row.updated_at ?? void 0);
  const createdAfter = validDate(filters.createdAfter), createdBefore = validDate(filters.createdBefore);
  const updatedAfter = validDate(filters.updatedAfter), updatedBefore = validDate(filters.updatedBefore);
  if (createdAfter != null && (created == null || created < createdAfter)) return false;
  if (createdBefore != null && (created == null || created > createdBefore)) return false;
  if (updatedAfter != null && (updated == null || updated < updatedAfter)) return false;
  if (updatedBefore != null && (updated == null || updated > updatedBefore)) return false;
  return true;
}
function rowToCandidate(row) {
  return {
    targetType: row.target_type,
    targetId: row.target_id,
    transcriptId: row.transcript_id ?? void 0,
    sourceId: row.source_id ?? void 0,
    speakerId: row.speaker_id ?? void 0,
    speakerName: row.speaker_name ?? void 0,
    title: row.title ?? void 0,
    textPreview: row.search_text.slice(0, 500),
    createdAt: row.created_at ?? void 0,
    updatedAt: row.updated_at ?? void 0,
    evidenceScore: row.evidence_score,
    finalScore: 0,
    matchReasons: [],
    evidencePointerIds: JSON.parse(row.evidence_pointer_ids_json),
    sourcePointerIds: JSON.parse(row.source_pointer_ids_json),
    supportRole: row.support_role
  };
}

// src/retrieval/keywordSearch.ts
var scopeTypes = {
  transcript_spans: ["transcript_span"],
  memory_objects: ["memory_object"],
  evidence_pointers: ["evidence_pointer"],
  all: ["transcript_span", "memory_object", "evidence_pointer"]
};
function keywordScore(row, query) {
  const phrase = query.toLowerCase(), title = (row.title ?? "").toLowerCase(), text = row.search_text.toLowerCase();
  const speaker = (row.speaker_name ?? "").toLowerCase(), topic = (row.topic_text ?? "").toLowerCase();
  const tokens3 = phrase.match(/[\p{L}\p{N}]+/gu) ?? [];
  let score2 = 0;
  const reasons = [];
  if (title.includes(phrase)) {
    score2 += 0.65;
    reasons.push("keyword:title", "keyword:exact_phrase");
  }
  if (text.includes(phrase)) {
    score2 += 0.55;
    reasons.push(row.target_type === "transcript_span" ? "keyword:span_text" : "keyword:body", "keyword:exact_phrase");
  }
  if (speaker.includes(phrase)) {
    score2 += 0.35;
    reasons.push("keyword:speaker");
  }
  if (topic.includes(phrase)) {
    score2 += 0.35;
    reasons.push("keyword:topic");
  }
  const matched = tokens3.filter((token) => title.includes(token) || text.includes(token) || speaker.includes(token) || topic.includes(token)).length;
  if (tokens3.length) score2 += 0.35 * (matched / tokens3.length);
  return { score: Math.min(1, score2), reasons: [...new Set(reasons)] };
}
function keywordSearch(db, query) {
  const text = query.query.trim();
  if (!text) return [];
  const types = scopeTypes[query.scope ?? "all"];
  const candidateLimit = Math.max(query.keywordLimit ?? query.limit ?? 50, 20) * 10;
  let rows = [];
  try {
    const fts = (text.match(/[\p{L}\p{N}]+/gu) ?? []).map((token) => `"${token.replaceAll('"', '""')}"*`).join(" OR ");
    if (fts) {
      const ids = db.prepare("SELECT target_type,target_id FROM retrieval_documents_fts WHERE retrieval_documents_fts MATCH ? LIMIT ?").all(fts, candidateLimit);
      if (ids.length) {
        const clauses = ids.map(() => "(target_type=? AND target_id=?)").join(" OR ");
        rows = db.prepare(`SELECT * FROM retrieval_documents WHERE ${clauses}`).all(...ids.flatMap((id) => [id.target_type, id.target_id]));
      }
    }
  } catch {
  }
  if (!rows.length) rows = db.prepare("SELECT * FROM retrieval_documents WHERE lower(search_text) LIKE lower(?) OR lower(COALESCE(title,'')) LIKE lower(?) OR lower(COALESCE(speaker_name,'')) LIKE lower(?) LIMIT ?").all(`%${text}%`, `%${text}%`, `%${text}%`, candidateLimit);
  return rows.filter((row) => types.includes(row.target_type) && documentMatchesFilters(row, query.filters)).map((row) => {
    const scored = keywordScore(row, text), candidate = rowToCandidate(row);
    return { ...candidate, keywordScore: scored.score, finalScore: scored.score, metadataScore: query.filters && Object.keys(query.filters).length ? 1 : 0.5, matchReasons: [...scored.reasons, row.evidence_score === 0.5 ? "evidence:unscored" : `evidence:${row.evidence_score < 0.45 ? "weak" : "scored"}`] };
  }).filter((item) => (item.keywordScore ?? 0) > 0).sort((a, b) => (b.keywordScore ?? 0) - (a.keywordScore ?? 0)).slice(0, query.keywordLimit ?? query.limit ?? 50);
}

// src/retrieval/vectorSearch.ts
var scopeTypes2 = {
  transcript_spans: ["transcript_span"],
  memory_objects: ["memory_object"],
  evidence_pointers: ["evidence_pointer"],
  all: ["transcript_span", "memory_object", "evidence_pointer"]
};
async function vectorSearch(db, query) {
  const text = query.query.trim(), provider = query.embeddingProvider;
  if (!text || !provider || provider.dimensions <= 0) return [];
  const vector = (await provider.embedTexts([text]))[0];
  validateVector(vector, provider.dimensions);
  const types = scopeTypes2[query.scope ?? "all"];
  const embeddings = db.prepare(`SELECT e.*,d.* FROM search_embeddings e JOIN retrieval_documents d
    ON d.target_type=e.target_type AND d.target_id=e.target_id
    WHERE e.embedding_provider=? AND e.embedding_model=? AND e.embedding_dim=?`).all(provider.name, provider.model, provider.dimensions);
  return embeddings.filter((row) => types.includes(row.target_type) && documentMatchesFilters(row, query.filters)).map((row) => {
    const stored = JSON.parse(row.vector_json);
    validateVector(stored, provider.dimensions);
    const score2 = cosineSimilarity(vector, stored), candidate = rowToCandidate(row);
    return { ...candidate, vectorScore: score2, finalScore: score2, metadataScore: query.filters && Object.keys(query.filters).length ? 1 : 0.5, matchReasons: ["vector:semantic", row.evidence_score === 0.5 ? "evidence:unscored" : `evidence:${row.evidence_score < 0.45 ? "weak" : "scored"}`] };
  }).sort((a, b) => (b.vectorScore ?? 0) - (a.vectorScore ?? 0)).slice(0, query.vectorLimit ?? query.limit ?? 50);
}

// src/retrieval/ranking.ts
var clamp2 = (value) => Math.max(0, Math.min(1, value));
function recencyScore(timestamp, now2) {
  if (!timestamp) return 0.5;
  const time2 = Date.parse(timestamp), current = now2 == null ? Date.now() : Date.parse(now2);
  if (!Number.isFinite(time2) || !Number.isFinite(current)) return 0.5;
  const ageDays = Math.max(0, (current - time2) / 864e5);
  return clamp2(1 / (1 + ageDays / 365));
}
function rankCandidate(candidate, vectorAvailable, recencyBoost = false, now2) {
  const vector = candidate.vectorScore ?? 0, keyword = candidate.keywordScore ?? 0;
  const evidence = candidate.evidenceScore ?? 0.5, metadata = candidate.metadataScore ?? 0.5;
  const recency = recencyBoost ? recencyScore(candidate.updatedAt ?? candidate.createdAt, now2) : 0.5;
  const score2 = vectorAvailable ? 0.4 * vector + 0.3 * keyword + 0.15 * evidence + 0.1 * metadata + 0.05 * recency : 0.55 * keyword + 0.25 * evidence + 0.15 * metadata + 0.05 * recency;
  return { ...candidate, recencyScore: recency, finalScore: clamp2(score2) };
}
function mergeCandidates(candidates) {
  const merged = /* @__PURE__ */ new Map();
  for (const item of candidates) {
    const key = `${item.targetType}:${item.targetId}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }
    merged.set(key, {
      ...existing,
      keywordScore: Math.max(existing.keywordScore ?? 0, item.keywordScore ?? 0),
      vectorScore: Math.max(existing.vectorScore ?? 0, item.vectorScore ?? 0),
      evidenceScore: Math.max(existing.evidenceScore ?? 0, item.evidenceScore ?? 0),
      matchReasons: [.../* @__PURE__ */ new Set([...existing.matchReasons, ...item.matchReasons])],
      evidencePointerIds: [.../* @__PURE__ */ new Set([...existing.evidencePointerIds, ...item.evidencePointerIds])],
      sourcePointerIds: [.../* @__PURE__ */ new Set([...existing.sourcePointerIds, ...item.sourcePointerIds])]
    });
  }
  return [...merged.values()];
}
function dedupeUnderlyingEvidence(candidates) {
  const priority = { transcript_span: 3, evidence_pointer: 2, memory_object: 1 };
  const kept = /* @__PURE__ */ new Map();
  for (const candidate of candidates.sort((a, b) => b.finalScore - a.finalScore)) {
    const key = candidate.sourcePointerIds[0] ?? `${candidate.targetType}:${candidate.targetId}`;
    const existing = kept.get(key);
    if (!existing || priority[candidate.targetType] > priority[existing.targetType]) {
      kept.set(key, existing ? {
        ...candidate,
        evidencePointerIds: [.../* @__PURE__ */ new Set([...candidate.evidencePointerIds, ...existing.evidencePointerIds])],
        sourcePointerIds: [.../* @__PURE__ */ new Set([...candidate.sourcePointerIds, ...existing.sourcePointerIds])],
        matchReasons: [.../* @__PURE__ */ new Set([...candidate.matchReasons, ...existing.matchReasons])]
      } : candidate);
    }
  }
  return [...kept.values()];
}

// src/retrieval/hybridSearch.ts
async function searchRetrieval(db, query) {
  if (!query.query.trim()) return [];
  const mode = query.mode ?? "hybrid";
  const keyword = mode === "vector" ? [] : keywordSearch(db, query);
  const vector = mode === "keyword" ? [] : await vectorSearch(db, query);
  const ranked = mergeCandidates([...keyword, ...vector]).map((candidate) => rankCandidate(candidate, vector.length > 0, query.recencyBoost, query.now));
  const filtered = query.requireEvidencePointers ? ranked.filter((candidate) => candidate.evidencePointerIds.length > 0) : ranked;
  return dedupeUnderlyingEvidence(filtered).sort((a, b) => b.finalScore - a.finalScore).slice(0, query.finalLimit ?? query.limit ?? 20);
}
var searchEvidencePointers = (db, query) => searchRetrieval(db, { ...query, scope: "evidence_pointers" });

// src/ask-ai/dependencies.ts
var useType = (kind) => kind === "fact" ? "direct_fact" : kind === "pattern" ? "pattern" : kind;
async function retrieve(db, query) {
  const results = await searchEvidencePointers(db, {
    query: query.normalizedQuestion,
    mode: "hybrid",
    finalLimit: 50,
    requireEvidencePointers: true,
    filters: {
      transcriptIds: query.transcriptIds.length ? query.transcriptIds : void 0,
      createdAfter: query.timeRange?.start,
      createdBefore: query.timeRange?.end
    }
  });
  return results.flatMap((result) => {
    const pointer = db.prepare("SELECT target_type,target_id FROM evidence_pointers WHERE evidence_pointer_id=?").get(result.targetId);
    if (!pointer) return [];
    return getEvidenceCandidatesForTarget(db, pointer.target_type, pointer.target_id).filter((item) => item.evidencePointerId === result.targetId).map((item) => ({ ...item, retrievalScore: result.finalScore, vectorScore: result.vectorScore, keywordScore: result.keywordScore }));
  });
}
function createDatabaseAskAIDependencies(db, options = {}) {
  return {
    db,
    now: options.now,
    llm: options.llm,
    synthesisInfo: options.synthesisInfo,
    requireLlm: options.requireLlm,
    retrieveCandidates: (query) => retrieve(db, query),
    scoreEvidence: async (question, candidates, query) => scoreEvidenceBundle({
      claimText: question,
      candidates,
      useType: useType(query.requestedClaimKinds[0] ?? "fact"),
      now: options.now?.().toISOString()
    }),
    findConflicts: async (evidence) => createConflictRepository(db, { now: options.now }).listActiveForEvidencePointers(evidence.map((item) => item.evidencePointerId))
  };
}

// src/ask-ai/pipeline.ts
var useType2 = (kind) => kind === "fact" ? "direct_fact" : kind === "pattern" ? "pattern" : kind;
function resolveAnswerSynthesis(deps, actualMode) {
  const configured = deps.synthesisInfo ?? { mode: deps.llm ? "external_llm" : "deterministic" };
  const mode = actualMode === "llm" ? "external_llm" : actualMode;
  const runtimeFallback = deps.llm != null && actualMode === "deterministic";
  const usedFallback = Boolean(configured.usedFallback) || runtimeFallback;
  const reason = runtimeFallback ? `Configured external LLM "${configured.provider ?? "external"}" did not produce grounded claims; used deterministic synthesis.` : configured.usedFallback ? "External LLM was selected but not fully configured; used deterministic synthesis." : void 0;
  return { mode, provider: configured.provider, model: configured.model, usedFallback, reason };
}
async function askAI(request, deps) {
  const query = understandQuestion(request.question, request);
  const timestamp = deps.now?.() ?? /* @__PURE__ */ new Date();
  const candidates = await deps.retrieveCandidates(query);
  const assessment = deps.scoreEvidence ? await deps.scoreEvidence(query.normalizedQuestion, candidates, query) : scoreEvidenceBundle({
    claimText: query.normalizedQuestion,
    useType: useType2(query.requestedClaimKinds[0] ?? "fact"),
    candidates,
    now: timestamp.toISOString()
  });
  const materialized = deps.createEvidencePointers ? await deps.createEvidencePointers(assessment.usableEvidence) : void 0;
  const selection = selectEvidenceForAnswer(assessment, { maxEvidenceItems: request.maxEvidenceItems, materializedEvidence: materialized });
  const conflicts = deps.findConflicts ? await deps.findConflicts(selection.evidence) : [];
  const selectedEvidence = [...new Map([...selection.evidence, ...conflictEvidenceForAnswer(conflicts)].map((item) => [item.evidencePointerId, item])).values()];
  const citations = buildCitations(selectedEvidence);
  const selectedConfidence = confidenceWithConflicts(selection.confidence, conflicts);
  let actualMode = "deterministic";
  const claims = await generateClaimsFromEvidence(query, selectedEvidence, citations, {
    confidence: selectedConfidence,
    llm: deps.llm,
    requireLlm: deps.requireLlm,
    onSynthesis: (mode) => {
      actualMode = mode;
    }
  });
  const confidence = claims.length ? selectedConfidence : "no_evidence";
  const usedPointers = new Set(claims.flatMap((claim) => claim.evidencePointerIds));
  const finalEvidence = selectedEvidence.filter((item) => usedPointers.has(item.evidencePointerId));
  const finalCitations = citations.filter((item) => usedPointers.has(item.evidencePointerId));
  const response = {
    id: createId("ask_"),
    question: request.question,
    answerMarkdown: addConflictContext(renderAnswer({ confidence, claims, citations: finalCitations }), conflicts),
    evidenceConfidence: confidence,
    claims,
    citations: finalCitations,
    evidence: finalEvidence,
    suggestedFollowups: request.includeSuggestedFollowups === false ? [] : suggestFollowups(confidence, query),
    notEnoughEvidence: confidence === "no_evidence",
    createdAt: timestamp.toISOString(),
    queryUnderstanding: query,
    conflicts,
    synthesis: resolveAnswerSynthesis(deps, actualMode)
  };
  if (deps.persistAnswer) await deps.persistAnswer(response);
  else if (deps.db) {
    deps.db.transaction(() => {
      response.scoreRunId = saveEvidenceScoreRun(deps.db, assessment, { targetType: "ask_ai", targetId: response.id });
      persistAskAIResponse(deps.db, response);
    })();
  }
  return response;
}

// src/ingest/hash.ts
function computeRawSha256(rawText) {
  return contentHash(rawText);
}

// src/ingest/detectTranscriptFormat.ts
var import_node_path2 = require("node:path");
var supported = /* @__PURE__ */ new Set(["txt", "md", "srt", "vtt"]);
function detectTranscriptFormat(filename, _rawText) {
  const extension = (0, import_node_path2.extname)(filename).slice(1).toLowerCase();
  if (!supported.has(extension)) {
    throw new ValidationError(`Unsupported transcript extension: ${extension || "(none)"}`);
  }
  return extension;
}

// src/ingest/parseTimestamps.ts
var timestampPattern = /^(\d{1,2}:)?(\d{1,2}):(\d{2})([.,]\d{1,3})?$/;
function parseTimestampToMs(value) {
  const match = value.trim().match(timestampPattern);
  if (!match) return null;
  const hours = match[1] ? Number(match[1].slice(0, -1)) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  const fraction = match[4] ? match[4].slice(1).padEnd(3, "0").slice(0, 3) : "0";
  return ((hours * 60 + minutes) * 60 + seconds) * 1e3 + Number(fraction);
}
function parseTimestampRange(value) {
  const parts = value.split("-->");
  if (parts.length !== 2) return null;
  const startTimeMs = parseTimestampToMs(parts[0]);
  const endToken = parts[1].trim().split(/\s+/)[0];
  const endTimeMs = parseTimestampToMs(endToken);
  return startTimeMs == null || endTimeMs == null ? null : { startTimeMs, endTimeMs };
}

// src/ingest/offsets.ts
function getSourceLines(rawText) {
  const lines = [];
  let start = 0;
  let number = 1;
  for (let index = 0; index < rawText.length; index++) {
    if (rawText[index] !== "\n" && rawText[index] !== "\r") continue;
    const contentEnd = index;
    if (rawText[index] === "\r" && rawText[index + 1] === "\n") index++;
    const end = index + 1;
    lines.push({ number, start, contentEnd, end, content: rawText.slice(start, contentEnd) });
    start = end;
    number++;
  }
  if (start < rawText.length || rawText.length === 0) {
    lines.push({ number, start, contentEnd: rawText.length, end: rawText.length, content: rawText.slice(start) });
  }
  return lines;
}
function lineNumberAt(rawText, offset) {
  let line = 1;
  for (let index = 0; index < Math.min(offset, rawText.length); index++) {
    if (rawText[index] === "\n") line++;
    else if (rawText[index] === "\r") {
      line++;
      if (rawText[index + 1] === "\n") index++;
    }
  }
  return line;
}

// src/ingest/parseSpeakerTurns.ts
var timestampToken = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?`;
var prefixedLine = new RegExp(String.raw`^(?:(?:\[(${timestampToken})\]|\((${timestampToken})\)|(${timestampToken}))\s+)?([^:\r\n]{1,100}):(?:\s|$)`);
var timestampOnlyLine = new RegExp(String.raw`^(?:\[(${timestampToken})\]|\((${timestampToken})\)|(${timestampToken}))\s*`);
function normalizeSpeaker(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function marker(line) {
  const speaker = line.match(prefixedLine);
  if (speaker) {
    const speakerLabel = speaker[4].trim();
    return {
      speakerLabel,
      speakerNormalized: normalizeSpeaker(speakerLabel),
      startTimeMs: parseTimestampToMs(speaker[1] ?? speaker[2] ?? speaker[3] ?? "")
    };
  }
  const timestamp = line.match(timestampOnlyLine);
  if (timestamp) return { speakerLabel: null, speakerNormalized: null, startTimeMs: parseTimestampToMs(timestamp[1] ?? timestamp[2] ?? timestamp[3]) };
  return null;
}
function makeTurn(lines, details, times) {
  const first = lines[0], last = lines[lines.length - 1];
  return {
    turnIndex: 0,
    speakerLabel: details?.speakerLabel ?? null,
    speakerNormalized: details?.speakerNormalized ?? null,
    startTimeMs: times?.startTimeMs ?? details?.startTimeMs ?? null,
    endTimeMs: times?.endTimeMs ?? null,
    startLine: first.number,
    endLine: last.number,
    startChar: first.start,
    endChar: last.contentEnd,
    rawText: ""
  };
}
function parseCaptions(rawText, lines) {
  const turns = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && !lines[index].content.trim()) index++;
    if (index >= lines.length) break;
    const block = [];
    while (index < lines.length && lines[index].content.trim()) block.push(lines[index++]);
    const timingIndex = block.findIndex((line) => parseTimestampRange(line.content) != null);
    if (timingIndex < 0 || timingIndex === block.length - 1) continue;
    const body = block.slice(timingIndex + 1);
    const turn = makeTurn(body, marker(body[0].content), parseTimestampRange(block[timingIndex].content));
    turn.rawText = rawText.slice(turn.startChar, turn.endChar);
    turns.push(turn);
  }
  return turns.map((turn, turnIndex) => ({ ...turn, turnIndex }));
}
function parsePlain(rawText, lines) {
  const hasMarkers = lines.some((line) => marker(line.content) != null);
  const hasParagraphBreaks = lines.some((line) => !line.content.trim());
  if (!hasMarkers && !hasParagraphBreaks) {
    return lines.filter((line) => line.content.trim()).map((line, turnIndex) => ({
      ...makeTurn([line]),
      turnIndex,
      rawText: rawText.slice(line.start, line.contentEnd)
    }));
  }
  const groups = [];
  let current = [];
  let details = null;
  const flush = () => {
    if (current.some((line) => line.content.trim())) groups.push({ lines: current, details });
    current = [];
    details = null;
  };
  for (const line of lines) {
    if (!line.content.trim()) {
      flush();
      continue;
    }
    const lineMarker = marker(line.content);
    if (hasMarkers && lineMarker) {
      flush();
      details = lineMarker;
      current.push(line);
      continue;
    }
    if (!hasMarkers && current.length === 0) details = null;
    current.push(line);
  }
  flush();
  return groups.map((group, turnIndex) => {
    const turn = makeTurn(group.lines, group.details);
    turn.turnIndex = turnIndex;
    turn.rawText = rawText.slice(turn.startChar, turn.endChar);
    return turn;
  });
}
function parseSpeakerTurns(rawText, format) {
  const lines = getSourceLines(rawText);
  return format === "srt" || format === "vtt" ? parseCaptions(rawText, lines) : parsePlain(rawText, lines);
}

// src/ingest/createTranscriptSpans.ts
var MAX_SPAN_CHARS = 1500;
function splitPoint(text, start, maxEnd) {
  const window = text.slice(start, maxEnd);
  let best = -1;
  for (const match of window.matchAll(/(?:\r\n|\r|\n)|[.!?](?=\s)/g)) best = match.index + match[0].length;
  return best >= Math.floor(MAX_SPAN_CHARS * 0.5) ? start + best : maxEnd;
}
function createSpansFromTurns(rawText, turns) {
  const spans = [];
  for (const turn of turns) {
    let startChar = turn.startChar;
    while (startChar < turn.endChar) {
      const maxEnd = Math.min(startChar + MAX_SPAN_CHARS, turn.endChar);
      const endChar = maxEnd < turn.endChar ? splitPoint(rawText, startChar, maxEnd) : turn.endChar;
      const text = rawText.slice(startChar, endChar);
      if (text.trim()) {
        spans.push({
          spanIndex: spans.length,
          kind: "turn",
          speakerLabel: turn.speakerLabel,
          startTimeMs: turn.startTimeMs,
          endTimeMs: turn.endTimeMs,
          startLine: lineNumberAt(rawText, startChar),
          endLine: lineNumberAt(rawText, endChar - 1),
          startChar,
          endChar,
          text
        });
      }
      startChar = endChar;
    }
  }
  return spans;
}

// src/ingest/importTranscript.ts
var import_node_crypto6 = require("node:crypto");
function stableId3(prefix, value, length = 24) {
  return `${prefix}${(0, import_node_crypto6.createHash)("sha256").update(value).digest("hex").slice(0, length)}`;
}
function sourceTypeForDatabase(sourceType) {
  if (sourceType === "paste" || sourceType === "test") return "pasted_text";
  return sourceType === "vault_file" ? "external_reference" : "imported_file";
}
function insertTurns(db, transcriptId, rawText, turns) {
  const statement = db.prepare(`INSERT INTO transcript_turns(
    id,transcript_id,turn_index,speaker_label,speaker_normalized,start_time_ms,end_time_ms,start_line,end_line,start_char,end_char,raw_text
  ) VALUES (@id,@transcript_id,@turn_index,@speaker_label,@speaker_normalized,@start_time_ms,@end_time_ms,@start_line,@end_line,@start_char,@end_char,@raw_text)`);
  for (const turn of turns) {
    if (turn.rawText !== rawText.slice(turn.startChar, turn.endChar)) throw new ValidationError("Turn text does not match its raw transcript offsets");
    statement.run({
      id: stableId3("turn_", `${transcriptId}:${turn.turnIndex}:${turn.startChar}:${turn.endChar}`),
      transcript_id: transcriptId,
      turn_index: turn.turnIndex,
      speaker_label: turn.speakerLabel,
      speaker_normalized: turn.speakerNormalized,
      start_time_ms: turn.startTimeMs,
      end_time_ms: turn.endTimeMs,
      start_line: turn.startLine,
      end_line: turn.endLine,
      start_char: turn.startChar,
      end_char: turn.endChar,
      raw_text: turn.rawText
    });
  }
}
function insertSpans(db, transcriptId, sourceId, rawText, spans) {
  const speakerIds = /* @__PURE__ */ new Map();
  const speakerInsert = db.prepare(`INSERT OR IGNORE INTO transcript_speakers(id,transcript_id,speaker_label,metadata_json)
    VALUES (?, ?, ?, '{}')`);
  const statement = db.prepare(`INSERT INTO transcript_spans(
    id,transcript_id,source_id,speaker_id,ordinal,span_index,start_char,end_char,start_time_ms,end_time_ms,
    text_preview,text_hash,created_at,metadata_json,kind,speaker_label,start_line,end_line,text,created_by
  ) VALUES (
    @id,@transcript_id,@source_id,@speaker_id,@ordinal,@span_index,@start_char,@end_char,@start_time_ms,@end_time_ms,
    @text_preview,@text_hash,@created_at,'{}',@kind,@speaker_label,@start_line,@end_line,@text,'deterministic_span_creator'
  )`);
  for (const span of spans) {
    if (span.text !== rawText.slice(span.startChar, span.endChar)) throw new ValidationError("Span text does not match its raw transcript offsets");
    let speakerId = null;
    if (span.speakerLabel) {
      speakerId = speakerIds.get(span.speakerLabel) ?? stableId3("spk_", `${transcriptId}:${span.speakerLabel}`);
      speakerIds.set(span.speakerLabel, speakerId);
      speakerInsert.run(speakerId, transcriptId, span.speakerLabel);
    }
    statement.run({
      id: stableId3("sp_", `${transcriptId}:${span.kind}:${span.startChar}:${span.endChar}`),
      transcript_id: transcriptId,
      source_id: sourceId,
      speaker_id: speakerId,
      ordinal: span.spanIndex,
      span_index: span.spanIndex,
      start_char: span.startChar,
      end_char: span.endChar,
      start_time_ms: span.startTimeMs,
      end_time_ms: span.endTimeMs,
      text_preview: span.text.slice(0, 500),
      text_hash: contentHash(span.text),
      created_at: now(),
      kind: span.kind,
      speaker_label: span.speakerLabel,
      start_line: span.startLine,
      end_line: span.endLine,
      text: span.text
    });
  }
}
function importTranscript(db, input) {
  if (!input.filename.trim()) throw new ValidationError("Transcript filename is required");
  if (!input.rawText.trim()) throw new ValidationError("Transcript rawText must contain non-whitespace content");
  const format = detectTranscriptFormat(input.filename, input.rawText);
  const rawSha256 = computeRawSha256(input.rawText);
  const existing = db.prepare("SELECT id FROM transcripts WHERE raw_sha256 = ? OR (raw_sha256 IS NULL AND content_hash = ?) ORDER BY imported_at LIMIT 1").get(rawSha256, rawSha256);
  if (existing) {
    return {
      status: "duplicate",
      transcriptId: existing.id,
      duplicateOfTranscriptId: existing.id,
      rawSha256,
      warning: "Duplicate transcript detected. Existing transcript was reused.",
      turnsCreated: 0,
      spansCreated: 0
    };
  }
  const transcriptId = `tr_${rawSha256.slice(0, 24)}`;
  const sourceId = `src_${rawSha256.slice(0, 24)}`;
  const sourceType = input.sourceType ?? "upload";
  const importedAt = input.importedAt ?? now();
  const turns = parseSpeakerTurns(input.rawText, format);
  const spans = createSpansFromTurns(input.rawText, turns);
  if (!turns.length || !spans.length) throw new ValidationError("Transcript did not produce any usable turns or spans");
  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO transcript_sources(id,source_type,original_filename,raw_storage_uri,content_hash,byte_length,created_at,metadata_json)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      sourceId,
      sourceTypeForDatabase(sourceType),
      input.filename,
      `db://transcripts/${transcriptId}/raw`,
      rawSha256,
      Buffer.byteLength(input.rawText),
      importedAt,
      json({ ...input.metadata, ingestion_source_type: sourceType })
    );
    const storedSourceId = db.prepare("SELECT id FROM transcript_sources WHERE content_hash = ?").get(rawSha256).id;
    db.prepare(`INSERT INTO transcripts(
      id,source_id,title,status,content_hash,imported_at,updated_at,metadata_json,raw_sha256,source_filename,source_type,raw_text
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      transcriptId,
      storedSourceId,
      input.filename,
      "chunked",
      rawSha256,
      importedAt,
      importedAt,
      json(input.metadata),
      rawSha256,
      input.filename,
      sourceType,
      input.rawText
    );
    insertTurns(db, transcriptId, input.rawText, turns);
    insertSpans(db, transcriptId, storedSourceId, input.rawText, spans);
  })();
  return { status: "imported", transcriptId, rawSha256, turnsCreated: turns.length, spansCreated: spans.length };
}

// src/obsidian/graphBuilder.ts
var import_node_crypto7 = require("node:crypto");

// src/obsidian/paths.ts
function safeName(value, fallback = "Untitled") {
  const clean = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  return (clean || fallback).slice(0, 100);
}
var labelFromText = (text, max = 60) => {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max), lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
};
var shortId = (id, bodyChars = 6) => {
  const sep2 = id.indexOf("_");
  return sep2 > 0 && sep2 < id.length - 1 ? `${id.slice(0, sep2 + 1)}${id.slice(sep2 + 1, sep2 + 1 + bodyChars)}` : id.slice(0, bodyChars + 4);
};
var noteBasename = (label) => safeName(labelFromText(label));
var QUESTION_STEM = /^\s*(what|which|who|whom|whose|where|when|why|how)\b(\s+(is|are|was|were|do|does|did|should|would|will|can|could|has|have|had))?(\s+(the|a|an|this|that|these|those))?\s*/i;
var questionLabel = (question) => labelFromText(question.replace(QUESTION_STEM, "").trim()) || labelFromText(question);
var readableNotePath = (category, label, id) => `${category}/${shortId(id)}/${noteBasename(label)}.md`;
var memoryFolder = (type) => type === "decision" ? "Decisions" : type === "preference" ? "Preferences" : type === "task" ? "Tasks" : type === "question" ? "Questions" : type === "claim" ? "Facts" : "Other";
var transcriptPath = (title, id) => readableNotePath("Transcripts", title, id);
var memoryPath = (title, id, type) => readableNotePath(`Memories/${memoryFolder(type)}`, title, id);
var evidencePath = (label, id) => readableNotePath("Evidence", label, id);
var answerPath = (label, id) => readableNotePath("Answers", label, id);
var conflictPath = (label, id) => readableNotePath("Conflicts", label, id);
var entityPath = (kind, label, id) => readableNotePath(kind === "person" ? "People" : kind === "topic" ? "Topics" : "Decisions", label, id);
var stripMd = (path) => path.replace(/\.md$/i, "");
var wikiLink = (path, label, anchor) => `[[${stripMd(path)}${anchor ? `#${anchor}` : ""}${label ? `|${label}` : ""}]]`;

// src/obsidian/graphBuilder.ts
var edgeId = (source, target, type, evidence = "") => `ov_edge_${(0, import_node_crypto7.createHash)("sha256").update(`${source}:${target}:${type}:${evidence}`).digest("hex").slice(0, 24)}`;
var mapEdgeType = (value) => value === "contradicts" ? "contradicts" : value === "updates" ? "updates" : value === "mentions" ? "mentions" : value === "supports" ? "supports" : value === "derived_from" ? "derived_from" : "about";
var memoryNodeId = (id) => `memory:${id}`;
var evidenceNodeId = (id) => `evidence:${id}`;
var spanNodeId = (id) => `span:${id}`;
var transcriptNodeId = (id) => `transcript:${id}`;
function buildObsidianGraph(db) {
  const nodes = /* @__PURE__ */ new Map(), edges = /* @__PURE__ */ new Map(), warnings = [];
  const addNode = (node) => nodes.set(node.id, node);
  const addEdge = (edge) => {
    const id = edgeId(edge.source, edge.target, edge.type, edge.evidencePointerId);
    edges.set(id, { id, ...edge });
  };
  const transcripts = db.prepare("SELECT id,title FROM transcripts ORDER BY id").all();
  transcripts.forEach((row) => addNode({ id: transcriptNodeId(row.id), type: "transcript", label: row.title, notePath: transcriptPath(row.title, row.id), transcriptId: row.id }));
  const memories = db.prepare(`SELECT id,type,title,generated_text,confidence,status FROM memory_objects
    WHERE duplicate_of_id IS NULL AND status NOT IN ('superseded','rejected')
      AND (extraction_status IS NULL OR extraction_status NOT IN ('superseded','rejected'))
    ORDER BY id`).all();
  const canonicalMemoryIds = new Set(memories.map((row) => row.id));
  memories.forEach((row) => addNode({ id: memoryNodeId(row.id), type: row.type === "decision" ? "decision" : row.type === "person" ? "person" : row.type === "topic" ? "topic" : "memory", label: row.title ?? row.generated_text.slice(0, 80), notePath: row.type === "decision" ? entityPath("decision", row.title ?? row.generated_text.slice(0, 80), row.id) : memoryPath(row.title ?? row.generated_text.slice(0, 80), row.id, row.type), confidence: row.confidence, supportStatus: row.status }));
  const pointers = db.prepare("SELECT * FROM evidence_pointers ORDER BY evidence_pointer_id").all();
  for (const pointer of pointers) {
    if (String(pointer.target_type) === "memory_object" && !canonicalMemoryIds.has(String(pointer.target_id))) continue;
    const id = String(pointer.evidence_pointer_id), resolved = resolveEvidencePointer(db, id);
    const evidenceLabel = resolved.ok ? labelFromText(resolved.spanText) || id : "Broken evidence";
    addNode({ id: evidenceNodeId(id), type: "evidence", label: resolved.ok ? evidenceLabel : id, notePath: evidencePath(evidenceLabel, id), evidenceUri: String(pointer.pointer_uri), transcriptId: String(pointer.transcript_id), spanId: String(pointer.span_id), confidence: Number(pointer.confidence), supportStatus: String(pointer.evidence_strength) });
    if (!resolved.ok) {
      warnings.push(`Broken evidence pointer ${id}: ${resolved.reason}`);
      continue;
    }
    const spanId = String(pointer.span_id), transcriptId = String(pointer.transcript_id);
    addNode({ id: spanNodeId(spanId), type: "span", label: spanId, sourceUri: String(pointer.source_pointer_uri), transcriptId, spanId });
    addEdge({ source: spanNodeId(spanId), target: transcriptNodeId(transcriptId), type: "belongs_to" });
    addEdge({ source: evidenceNodeId(id), target: spanNodeId(spanId), type: "derived_from", evidencePointerId: id, confidence: Number(pointer.confidence) });
    const targetType = String(pointer.target_type), targetId = String(pointer.target_id);
    const target = targetType === "memory_object" || targetType === "claim" || targetType === "summary" ? memoryNodeId(targetId) : targetType === "answer" ? `answer:${targetId}` : targetType === "answer_claim" ? `claim:${targetId}` : `graph:${targetId}`;
    if (targetType === "answer") {
      const ans = db.prepare("SELECT question_text FROM ai_answers WHERE id=?").get(targetId);
      addNode({ id: target, type: "answer", label: ans?.question_text ?? targetId, notePath: answerPath(questionLabel(ans?.question_text ?? targetId), targetId) });
    }
    if (targetType === "answer_claim") {
      const claim = db.prepare("SELECT claim_text,support_status FROM answer_claims WHERE answer_claim_id=?").get(targetId);
      if (claim) addNode({ id: target, type: "claim", label: claim.claim_text, supportStatus: claim.support_status });
    }
    if (targetType === "graph_node" || targetType === "graph_edge") {
      const object = targetType === "graph_node" ? db.prepare("SELECT label FROM graph_nodes WHERE id=?").get(targetId) : db.prepare("SELECT edge_type label FROM graph_edges WHERE id=?").get(targetId);
      if (object) addNode({ id: target, type: "memory", label: object.label, metadata: { graphTargetType: targetType } });
    }
    if (nodes.has(target)) addEdge({ source: target, target: evidenceNodeId(id), type: targetType === "answer_claim" || targetType === "answer" ? "cites" : "derived_from", evidencePointerId: id, confidence: Number(pointer.confidence) });
  }
  const answers = db.prepare("SELECT id,question_text,answer_status FROM ai_answers ORDER BY id").all();
  answers.forEach((row) => addNode({ id: `answer:${row.id}`, type: "answer", label: row.question_text, notePath: answerPath(questionLabel(row.question_text), row.id), supportStatus: row.answer_status }));
  const claims = db.prepare("SELECT * FROM answer_claims ORDER BY answer_claim_id").all();
  claims.forEach((row) => {
    const pointer = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=? ORDER BY evidence_pointer_id LIMIT 1").get(row.answer_claim_id);
    addNode({ id: `claim:${row.answer_claim_id}`, type: "claim", label: String(row.claim_text), supportStatus: String(row.support_status) });
    addEdge({ source: `claim:${row.answer_claim_id}`, target: `answer:${row.answer_id}`, type: "answered_by", evidencePointerId: pointer?.evidence_pointer_id });
  });
  const conflicts = db.prepare("SELECT * FROM conflict_assessments ORDER BY id").all();
  conflicts.forEach((row) => {
    const id = String(row.id), conflictNode = `conflict:${id}`;
    addNode({ id: conflictNode, type: "conflict", label: String(row.summary), notePath: conflictPath(String(row.summary), id), confidence: Number(row.confidence), supportStatus: String(row.status) });
    for (const side of ["left", "right"]) {
      const type = String(row[`${side}_target_type`]), targetId = String(row[`${side}_target_id`]);
      const target = type === "memory_object" || type === "claim" || type === "summary" ? memoryNodeId(targetId) : type === "answer_claim" ? `claim:${targetId}` : type === "evidence_pointer" ? evidenceNodeId(targetId) : `graph:${targetId}`;
      const pointer = db.prepare("SELECT evidence_pointer_id FROM conflict_evidence_links WHERE conflict_assessment_id=? AND side=? AND provenance_validated=1 ORDER BY evidence_pointer_id LIMIT 1").get(id, side);
      if (nodes.has(target)) addEdge({ source: conflictNode, target, type: String(row.kind) === "temporal_update" ? "updates" : "contradicts", confidence: Number(row.confidence), evidencePointerId: pointer?.evidence_pointer_id, metadata: { side } });
    }
  });
  const graphNodes = db.prepare("SELECT * FROM graph_nodes ORDER BY id").all();
  graphNodes.forEach((row) => {
    const type = row.node_type === "entity" ? "person" : row.node_type === "topic" ? "topic" : row.node_type === "memory_object" ? "memory" : row.node_type === "transcript" ? "transcript" : "span";
    const id = `graph:${row.id}`;
    addNode({ id, type, label: String(row.label), notePath: type === "person" || type === "topic" ? entityPath(type, String(row.label), String(row.ref_id)) : void 0, metadata: { refId: row.ref_id } });
  });
  const graphEdges = db.prepare("SELECT * FROM graph_edges ORDER BY id").all();
  for (const row of graphEdges) {
    let pointerId;
    if (row.evidence_bundle_id) {
      const evidence = db.prepare("SELECT metadata_json FROM evidence_items WHERE bundle_id=? ORDER BY id LIMIT 1").get(row.evidence_bundle_id);
      try {
        pointerId = evidence ? JSON.parse(evidence.metadata_json).evidence_pointer_id : void 0;
      } catch {
        pointerId = void 0;
      }
    }
    if (row.source_type === "source_backed" && !pointerId) {
      warnings.push(`Source-backed graph edge ${row.id} lacks an evidence pointer view link.`);
      continue;
    }
    addEdge({ source: `graph:${row.from_node_id}`, target: `graph:${row.to_node_id}`, type: mapEdgeType(String(row.edge_type)), evidencePointerId: pointerId, confidence: Number(row.confidence), metadata: { sourceType: row.source_type, status: row.status, generatedWithoutEvidence: row.source_type === "inferred" } });
  }
  return { graph: { nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)) }, warnings };
}

// src/frontend/sqliteApi.ts
var trust = (value) => {
  const state = String(value ?? "no_evidence");
  return ["strong", "mixed", "weak", "conflicting", "no_evidence", "broken", "needs_review", "rejected", "superseded"].includes(state) ? state : "weak";
};
var preview = (value, length = 180) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= length ? text : `${text.slice(0, length - 3)}...`;
};
var evidenceRole = (value) => value === "support" ? "supporting" : value === "opposition" ? "opposing" : "context";
function validateTranscriptUpload(input) {
  if (!/\.(txt|md|srt|vtt)$/i.test(input.filename)) throw new Error("Unsupported transcript type. Use .txt, .md, .srt, or .vtt.");
  if (!input.rawText.trim()) throw new Error("Select a non-empty transcript file.");
}
function transcriptList(db) {
  return db.prepare(`SELECT t.id,t.title,t.status,t.imported_at,t.source_type,COUNT(DISTINCT s.id) span_count,COUNT(DISTINCT s.speaker_id) speaker_count
    FROM transcripts t LEFT JOIN transcript_spans s ON s.transcript_id=t.id
    GROUP BY t.id ORDER BY t.imported_at DESC,t.id`).all().map((row) => ({
    id: String(row.id),
    title: String(row.title),
    sourceType: String(row.source_type),
    status: String(row.status),
    createdAt: String(row.imported_at),
    importedAt: String(row.imported_at),
    spanCount: Number(row.span_count),
    speakerCount: Number(row.speaker_count),
    processingStatus: row.status === "failed" ? "failed" : row.status === "imported" ? "processing" : "ready"
  }));
}
function brokenEvidence(db, id, reason) {
  const row = db.prepare(`SELECT p.*,t.title transcript_title FROM evidence_pointers p
    LEFT JOIN transcripts t ON t.id=p.transcript_id WHERE p.evidence_pointer_id=?`).get(id);
  if (!row) {
    return {
      id,
      pointerUri: `mv://evidence/${id}`,
      sourcePointerUri: "",
      targetType: "unknown",
      targetId: "",
      role: "unclear",
      strength: "broken",
      confidence: 0,
      finalScore: null,
      quotePreview: "",
      transcriptId: "",
      transcriptTitle: "Unavailable",
      spanId: "",
      spanText: "",
      rawText: "",
      brokenReason: reason
    };
  }
  return {
    id,
    pointerUri: String(row.pointer_uri),
    sourcePointerUri: String(row.source_pointer_uri),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    role: evidenceRole(String(row.evidence_role)),
    strength: "broken",
    confidence: Number(row.confidence),
    finalScore: row.final_score == null ? null : Number(row.final_score),
    quotePreview: String(row.quote_preview),
    transcriptId: String(row.transcript_id),
    transcriptTitle: String(row.transcript_title ?? row.transcript_id),
    spanId: String(row.span_id),
    spanText: "",
    rawText: "",
    brokenReason: reason
  };
}
function evidenceView(db, id) {
  const resolved = resolveEvidencePointer(db, id);
  if (!resolved.ok) return brokenEvidence(db, id, resolved.reason);
  const title = db.prepare("SELECT title FROM transcripts WHERE id=?").get(resolved.evidence.transcript_id);
  return {
    id: resolved.evidence.evidence_pointer_id,
    pointerUri: resolved.evidence.pointer_uri,
    sourcePointerUri: resolved.evidence.source_pointer_uri,
    targetType: resolved.evidence.target_type,
    targetId: resolved.evidence.target_id,
    role: evidenceRole(resolved.evidence.evidence_role),
    strength: trust(resolved.evidence.evidence_strength),
    confidence: resolved.evidence.confidence,
    finalScore: resolved.evidence.final_score,
    quotePreview: resolved.evidence.quote_preview,
    transcriptId: resolved.evidence.transcript_id,
    transcriptTitle: title?.title ?? resolved.evidence.transcript_id,
    spanId: resolved.evidence.span_id,
    spanText: resolved.spanText,
    rawText: resolved.rawText,
    brokenReason: null
  };
}
function reviewItems(db) {
  const items = [];
  const userReviewedMemoryIds = new Set(
    db.prepare("SELECT id FROM memory_objects WHERE user_corrected=1").all().map((row) => row.id)
  );
  const pointers = db.prepare("SELECT evidence_pointer_id,evidence_strength,target_type,target_id,quote_preview,transcript_id,created_at FROM evidence_pointers ORDER BY created_at,evidence_pointer_id").all();
  for (const pointer of pointers) {
    const resolved = resolveEvidencePointer(db, pointer.evidence_pointer_id);
    if (!resolved.ok) {
      items.push({
        id: `broken:${pointer.evidence_pointer_id}`,
        type: "broken_pointer",
        title: "Broken evidence pointer",
        detail: `${pointer.evidence_pointer_id}: ${resolved.reason}`,
        targetType: pointer.target_type,
        targetId: pointer.target_id,
        trustState: "broken",
        href: routeHref.evidence(pointer.evidence_pointer_id),
        createdAt: pointer.created_at,
        severity: "high",
        status: "open",
        relatedTranscriptIds: [pointer.transcript_id],
        relatedEvidenceIds: [pointer.evidence_pointer_id]
      });
    } else if ((pointer.evidence_strength === "weak" || pointer.evidence_strength === "unknown") && !(pointer.target_type === "memory_object" && userReviewedMemoryIds.has(pointer.target_id))) {
      items.push({
        id: `weak:${pointer.evidence_pointer_id}`,
        type: "weak_evidence",
        title: "Weak evidence",
        detail: preview(pointer.quote_preview),
        targetType: pointer.target_type,
        targetId: pointer.target_id,
        trustState: "weak",
        href: routeHref.evidence(pointer.evidence_pointer_id),
        createdAt: pointer.created_at,
        severity: "medium",
        status: "open",
        relatedTranscriptIds: [resolved.evidence.transcript_id],
        relatedEvidenceIds: [pointer.evidence_pointer_id]
      });
    }
  }
  for (const memory of createMemoryObjectsRepo(db).listCanonicalMemoryObjects()) {
    if (memory.status === "needs_review" || memory.status === "weak") {
      const row = db.prepare("SELECT created_at FROM memory_objects WHERE id=?").get(memory.id);
      const transcriptIds = db.prepare(`SELECT DISTINCT s.transcript_id FROM transcript_spans s
        WHERE s.id IN (SELECT span_id FROM memory_object_evidence WHERE memory_id=?) ORDER BY s.transcript_id`).all(memory.id).map((item) => item.transcript_id);
      items.push({
        id: `memory:${memory.id}`,
        type: "memory_needs_review",
        title: memory.title || memory.body,
        detail: `${memory.status}; ${memory.evidenceSpanIds.length} evidence span(s)`,
        targetType: "memory_object",
        targetId: memory.id,
        trustState: memory.status,
        href: routeHref.memory(memory.id),
        createdAt: row.created_at,
        severity: "medium",
        status: "open",
        relatedTranscriptIds: transcriptIds,
        relatedEvidenceIds: []
      });
    }
  }
  const conflictRepo = createConflictRepository(db);
  const conflicts = db.prepare("SELECT id FROM conflict_assessments ORDER BY created_at,id").all().map(({ id }) => conflictRepo.get(id)).filter((item) => item != null);
  for (const conflict of conflicts) {
    if (conflict.status === "resolved" || conflict.status === "dismissed" || conflict.status === "superseded") continue;
    items.push({
      id: `conflict:${conflict.id}`,
      type: "conflict",
      title: conflict.summary,
      detail: conflict.explanation,
      targetType: conflict.leftTargetType,
      targetId: conflict.leftTargetId,
      trustState: "conflicting",
      href: routeHref.review(`conflict:${conflict.id}`),
      createdAt: conflict.createdAt,
      severity: "high",
      status: "open",
      relatedTranscriptIds: [...new Set(conflict.evidenceLinks.flatMap((link) => link.transcriptId ? [link.transcriptId] : []))],
      relatedEvidenceIds: conflict.evidenceLinks.map((link) => link.evidencePointerId)
    });
  }
  for (const row of db.prepare("SELECT id,target_type,target_id,reason,created_at FROM user_corrections WHERE correction_type NOT IN ('confirm','reject') ORDER BY created_at,id").all()) {
    items.push({
      id: `correction:${String(row.id)}`,
      type: "user_correction",
      title: "User correction received",
      detail: String(row.reason ?? "Awaiting review or reprocessing"),
      targetType: String(row.target_type),
      targetId: String(row.target_id),
      trustState: "needs_review",
      href: routeHref.review(`correction:${String(row.id)}`),
      createdAt: String(row.created_at),
      severity: "low",
      status: "open",
      relatedTranscriptIds: [],
      relatedEvidenceIds: []
    });
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}
function normalizeCorrectionTarget(db, input) {
  if (["memory_object", "graph_edge", "speaker", "answer", "span", "transcript"].includes(input.targetType)) {
    return { targetType: input.targetType, targetId: input.targetId };
  }
  if (input.targetType === "answer_claim") {
    const row = db.prepare("SELECT answer_id FROM answer_claims WHERE answer_claim_id=?").get(input.targetId);
    if (row) return { targetType: "answer", targetId: row.answer_id };
  }
  if (input.targetType === "citation") {
    const row = db.prepare("SELECT answer_id FROM citation_links WHERE citation_link_id=?").get(input.targetId);
    if (row?.answer_id) return { targetType: "answer", targetId: row.answer_id };
  }
  if (input.targetType === "evidence") {
    const row = db.prepare("SELECT target_type,target_id FROM evidence_pointers WHERE evidence_pointer_id=?").get(input.targetId);
    if (row && ["memory_object", "graph_edge", "answer"].includes(row.target_type)) return { targetType: row.target_type, targetId: row.target_id };
    if (row?.target_type === "answer_claim") return normalizeCorrectionTarget(db, { ...input, targetType: "answer_claim", targetId: row.target_id });
    if (row?.target_type === "graph_node") return normalizeCorrectionTarget(db, { ...input, targetType: "graph_node", targetId: row.target_id });
  }
  if (input.targetType === "graph_node") {
    const row = db.prepare("SELECT node_type,ref_id FROM graph_nodes WHERE id=?").get(input.targetId);
    if (row?.node_type === "memory_object") return { targetType: "memory_object", targetId: row.ref_id };
    if (row?.node_type === "transcript") return { targetType: "transcript", targetId: row.ref_id };
    if (row?.node_type === "span") return { targetType: "span", targetId: row.ref_id };
  }
  throw new Error(`Correction target ${input.targetType}:${input.targetId} has no supported append-only owner`);
}
function generatedSyncStatus(db) {
  try {
    const run = db.prepare(`SELECT created_at,file_count,graph_node_count,graph_edge_count,status,error_message
      FROM obsidian_view_runs ORDER BY created_at DESC,id DESC LIMIT 1`).get();
    if (!run) return { synced: false };
    return {
      synced: true,
      lastSyncedAt: String(run.created_at),
      fileCount: Number(run.file_count),
      graphNodeCount: Number(run.graph_node_count),
      graphEdgeCount: Number(run.graph_edge_count),
      status: run.status === "failed" ? "failed" : "completed",
      error: run.error_message ? String(run.error_message) : void 0
    };
  } catch {
    return { synced: false };
  }
}
function createSqliteFrontendApi(db, options = {}) {
  return {
    async getDashboard() {
      const answers = db.prepare("SELECT id,question,evidence_confidence,created_at FROM ask_ai_runs ORDER BY created_at DESC,id LIMIT 8").all();
      const review = reviewItems(db);
      const severityRank = { high: 3, medium: 2, low: 1 };
      const attention = review.filter((item) => item.trustState === "weak" || item.trustState === "broken" || item.trustState === "conflicting").sort((a, b) => severityRank[b.severity] - severityRank[a.severity]).slice(0, 5);
      return {
        totalTranscriptCount: transcriptList(db).length,
        transcripts: transcriptList(db).slice(0, 10),
        recentAnswers: answers.map((row) => ({ id: String(row.id), question: String(row.question), confidence: trust(row.evidence_confidence), createdAt: String(row.created_at) })),
        reviewCount: review.length,
        weakCount: review.filter((item) => item.trustState === "weak" || item.trustState === "needs_review").length,
        conflictCount: review.filter((item) => item.trustState === "conflicting").length,
        brokenCount: review.filter((item) => item.trustState === "broken").length,
        health: options.health,
        llmRequired: !!options.llmRequired,
        llmReady: options.getLlmReady ? options.getLlmReady() : !options.llmRequired,
        generatedSync: generatedSyncStatus(db),
        attention
      };
    },
    async listTranscripts() {
      return transcriptList(db);
    },
    async uploadTranscript(input) {
      validateTranscriptUpload(input);
      const result = importTranscript(db, { filename: input.filename, rawText: input.rawText, sourceType: "upload" });
      let warning = result.warning;
      const extractor = result.status === "imported" ? options.getMemoryExtractor?.() : void 0;
      if (result.status === "imported" && !extractor && options.llmRequired) {
        warning = warning ?? 'Transcript imported. AI memory extraction needs a configured LLM \u2014 set one up in Settings, then run "Run AI extraction".';
      }
      if (extractor && !db.prepare("SELECT 1 FROM extraction_runs WHERE transcript_id=? AND status='completed' LIMIT 1").get(result.transcriptId)) {
        try {
          const extraction = await extractMemoryObjectsForTranscript(db, { transcriptId: result.transcriptId, extractor });
          const runStatus = db.prepare("SELECT status FROM extraction_runs WHERE id=?").get(extraction.extractionRunId);
          if (runStatus?.status !== "completed") warning = warning ?? "Transcript imported, but automatic memory extraction did not complete.";
        } catch {
          warning = warning ?? "Transcript imported, but automatic memory extraction did not complete.";
        }
        try {
          await indexTranscriptForRetrieval(db, result.transcriptId);
        } catch {
          warning = warning ?? "Transcript imported, but automatic memory indexing did not complete.";
        }
      }
      return { transcriptId: result.transcriptId, status: result.status, warning };
    },
    async getTranscript(id) {
      const row = db.prepare("SELECT id,title,status,imported_at,raw_text,source_type FROM transcripts WHERE id=?").get(id);
      if (!row) return null;
      const spans = db.prepare(`SELECT s.id,s.ordinal,s.start_time_ms,s.end_time_ms,s.start_char,s.end_char,s.text,
        COALESCE(s.speaker_label,sp.display_name,sp.speaker_label) speaker
        FROM transcript_spans s LEFT JOIN transcript_speakers sp ON sp.id=s.speaker_id
        WHERE s.transcript_id=? ORDER BY s.ordinal,s.id`).all(id);
      return {
        id,
        title: String(row.title),
        sourceType: String(row.source_type),
        status: String(row.status),
        createdAt: String(row.imported_at),
        importedAt: String(row.imported_at),
        rawText: String(row.raw_text),
        immutable: true,
        speakerCount: new Set(spans.map((span) => span.speaker).filter(Boolean)).size,
        processingStatus: row.status === "failed" ? "failed" : row.status === "imported" ? "processing" : "ready",
        spanCount: spans.length,
        spans: spans.map((span) => ({
          id: String(span.id),
          transcriptId: id,
          ordinal: Number(span.ordinal),
          speaker: span.speaker == null ? null : String(span.speaker),
          startTimeMs: span.start_time_ms == null ? null : Number(span.start_time_ms),
          startChar: Number(span.start_char),
          endTimeMs: span.end_time_ms == null ? null : Number(span.end_time_ms),
          endChar: Number(span.end_char),
          text: String(span.text)
        }))
      };
    },
    async ask(question, askOptions) {
      const synth = options.getSynthesis?.();
      if (options.llmRequired && !synth?.llm) throw new SynthesisSetupRequiredError();
      return askAI({ question, transcriptIds: askOptions?.transcriptIds, maxEvidenceItems: askOptions?.maxEvidence }, createDatabaseAskAIDependencies(db, { now: options.now, llm: synth?.llm, synthesisInfo: synth?.info, requireLlm: options.llmRequired }));
    },
    async askAI(question, askOptions) {
      const synth = options.getSynthesis?.();
      if (options.llmRequired && !synth?.llm) throw new SynthesisSetupRequiredError();
      return askAI({ question, transcriptIds: askOptions?.transcriptIds, maxEvidenceItems: askOptions?.maxEvidence }, createDatabaseAskAIDependencies(db, { now: options.now, llm: synth?.llm, synthesisInfo: synth?.info, requireLlm: options.llmRequired }));
    },
    async getAnswer(id) {
      try {
        const answer = getAskAIResponse(db, id);
        return { ...answer, brokenCitationIds: answer.citations.filter((citation) => !resolveEvidencePointer(db, citation.evidencePointerId).ok).map((citation) => citation.id) };
      } catch {
        return null;
      }
    },
    async getEvidence(id) {
      return evidenceView(db, id);
    },
    async getMemory(id) {
      const memory = createMemoryObjectsRepo(db).getCanonicalMemoryObject(id);
      if (!memory) return null;
      const pointers = db.prepare(`SELECT evidence_pointer_id FROM evidence_pointers
        WHERE target_type IN ('memory_object','claim','summary') AND target_id=? ORDER BY evidence_pointer_id`).all(id);
      return {
        memory,
        trustState: isStrongMemoryObject(memory) ? "strong" : trust(memory.status),
        evidence: pointers.map((pointer) => evidenceView(db, pointer.evidence_pointer_id)),
        conflicts: createConflictRepository(db).listConflictsForTarget("memory_object", id)
      };
    },
    async getMemoryObject(id) {
      return this.getMemory(id);
    },
    async getGraph(graphOptions) {
      const built = buildObsidianGraph(db);
      if (!graphOptions) return built;
      const query = graphOptions.query?.toLowerCase(), types = graphOptions.nodeTypes, limit = Math.min(graphOptions.limit ?? 100, 100);
      const nodes = built.graph.nodes.filter((node) => (!query || node.label.toLowerCase().includes(query)) && (!types?.length || types.includes(node.type))).slice(0, limit);
      const ids = new Set(nodes.map((node) => node.id));
      return { ...built, graph: { nodes, edges: built.graph.edges.filter((edge) => ids.has(edge.source) || ids.has(edge.target)).slice(0, limit) } };
    },
    async search(query, filters) {
      if (!query.trim()) return [];
      const like = `%${query.trim()}%`;
      const results = [];
      for (const row of db.prepare("SELECT id,title,raw_text FROM transcripts WHERE title LIKE ? OR raw_text LIKE ? ORDER BY imported_at DESC LIMIT 20").all(like, like)) {
        results.push({ type: "transcript", id: String(row.id), title: String(row.title), preview: preview(row.raw_text), href: routeHref.transcript(String(row.id)) });
      }
      for (const row of db.prepare("SELECT id,transcript_id,text FROM transcript_spans WHERE text LIKE ? ORDER BY transcript_id,ordinal LIMIT 30").all(like)) {
        results.push({ type: "span", id: String(row.id), title: `Transcript span ${String(row.id)}`, preview: preview(row.text), href: routeHref.transcript(String(row.transcript_id), String(row.id)) });
      }
      for (const memory of createMemoryObjectsRepo(db).listCanonicalMemoryObjects().filter((item) => `${item.title} ${item.body}`.toLowerCase().includes(query.toLowerCase())).slice(0, 20)) {
        results.push({ type: "memory_object", id: memory.id, title: memory.title || memory.type, preview: preview(memory.body), href: routeHref.memory(memory.id), trustState: isStrongMemoryObject(memory) ? "strong" : trust(memory.status) });
      }
      for (const row of db.prepare("SELECT id,question,answer_markdown,evidence_confidence FROM ask_ai_runs WHERE question LIKE ? OR answer_markdown LIKE ? ORDER BY created_at DESC LIMIT 20").all(like, like)) {
        results.push({ type: "answer", id: String(row.id), title: String(row.question), preview: preview(row.answer_markdown), href: routeHref.answer(String(row.id)), trustState: trust(row.evidence_confidence) });
      }
      for (const row of db.prepare("SELECT evidence_pointer_id,quote_preview,evidence_strength FROM evidence_pointers WHERE quote_preview LIKE ? ORDER BY created_at DESC LIMIT 30").all(like)) {
        results.push({
          type: "evidence",
          id: String(row.evidence_pointer_id),
          title: `Evidence ${String(row.evidence_pointer_id)}`,
          preview: preview(row.quote_preview),
          href: routeHref.evidence(String(row.evidence_pointer_id)),
          trustState: trust(row.evidence_strength)
        });
      }
      return results.filter((item) => (!filters?.evidenceStrength || item.trustState === filters.evidenceStrength) && (!filters?.type || filters.type === "all" || filters.type === "transcripts" && (item.type === "transcript" || item.type === "span") || filters.type === "memory" && item.type === "memory_object" || filters.type === "answers" && item.type === "answer" || filters.type === "evidence" && item.type === "evidence"));
    },
    async searchVault(query, filters) {
      const results = await this.search(query, filters);
      return {
        transcripts: results.filter((item) => item.type === "transcript" || item.type === "span"),
        memoryObjects: results.filter((item) => item.type === "memory_object"),
        answers: results.filter((item) => item.type === "answer"),
        evidence: results.filter((item) => item.type === "evidence")
      };
    },
    async listReviewItems(filter) {
      return reviewItems(db).filter((item) => (!filter?.type || item.type === filter.type) && (!filter?.status || item.status === filter.status));
    },
    async getReviewItem(id) {
      return reviewItems(db).find((item) => item.id === id) ?? null;
    },
    async submitCorrection(input) {
      const target = normalizeCorrectionTarget(db, input);
      const correction = createCorrectionsRepo(db).createCorrection({
        target_type: target.targetType,
        target_id: target.targetId,
        correction_type: "edit",
        new_value: { correction_text: input.correctionText },
        reason: input.reason ?? null,
        metadata: { submitted_from: "frontend_review_queue", append_only: true, requested_target_type: input.targetType, requested_target_id: input.targetId }
      });
      return { correctionId: correction.id, status: "received" };
    },
    async reviewMemoryObject(memoryId, decision) {
      const corrections = createCorrectionsRepo(db);
      if (decision === "approve") {
        corrections.applyMemoryObjectCorrection(memoryId, { correction_type: "confirm", new_value: { status: "active" } });
        let warning;
        try {
          const transcriptIds = db.prepare("SELECT DISTINCT transcript_id FROM memory_object_evidence WHERE memory_id=? AND transcript_id IS NOT NULL").all(memoryId);
          for (const { transcript_id } of transcriptIds) await indexTranscriptForRetrieval(db, transcript_id);
        } catch {
          warning = "Memory approved, but automatic retrieval indexing did not complete.";
        }
        return { status: "approved", warning };
      }
      corrections.applyMemoryObjectCorrection(memoryId, { correction_type: "reject", new_value: { status: "rejected" } });
      try {
        db.prepare("DELETE FROM evidence_pointers WHERE target_type='memory_object' AND target_id=?").run(memoryId);
        removeRetrievalDocument(db, "memory_object", memoryId);
      } catch {
        return { status: "rejected", warning: "Memory rejected, but evidence cleanup did not complete." };
      }
      return { status: "rejected" };
    },
    async getLlmStatus() {
      const required = !!options.llmRequired;
      return { required, ready: options.getLlmReady ? options.getLlmReady() : !required };
    },
    async runExtraction(transcriptId) {
      if (!db.prepare("SELECT 1 FROM transcripts WHERE id=?").get(transcriptId)) return { status: "failed", warning: "Transcript not found." };
      if (db.prepare("SELECT 1 FROM extraction_runs WHERE transcript_id=? AND status='completed' LIMIT 1").get(transcriptId)) return { status: "skipped" };
      const extractor = options.getMemoryExtractor?.();
      if (!extractor) return { status: "setup_required", warning: "AI memory extraction needs a configured LLM \u2014 set one up in Settings." };
      try {
        const extraction = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
        const runStatus = db.prepare("SELECT status FROM extraction_runs WHERE id=?").get(extraction.extractionRunId);
        if (runStatus?.status !== "completed") return { status: "failed", warning: "AI memory extraction did not complete. Please try again." };
      } catch {
        return { status: "failed", warning: "AI memory extraction did not complete. Please try again." };
      }
      try {
        await indexTranscriptForRetrieval(db, transcriptId);
      } catch {
      }
      return { status: "extracted" };
    },
    async syncGeneratedGraphNotes() {
      if (!options.syncGeneratedViews) {
        return { status: "unavailable", message: 'Generated graph notes can only be synced inside the Obsidian plugin. Use the "Sync generated graph notes" command.' };
      }
      return options.syncGeneratedViews();
    }
  };
}

// src/frontend/render.ts
var section = (title, body, className = "") => `<section class="vault-section${className ? ` ${escapeHtml(className)}` : ""}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
var links = (items) => `<div class="route-actions">${items.map((item) => routeButton(item.href, item.label)).join("")}</div>`;
var correctionForm = (targetType, targetId) => ["memory_object", "answer_claim", "citation", "graph_node", "graph_edge", "evidence", "speaker", "answer", "span", "transcript"].includes(targetType) ? `<form data-action="correction"><input type="hidden" name="targetType" value="${escapeHtml(targetType)}"><input type="hidden" name="targetId" value="${escapeHtml(targetId)}">
      <label>Append-only correction <textarea name="correctionText" required></textarea></label><label>Reason <input name="reason"></label>
      <button type="submit">Submit correction</button></form><div data-form-result></div>` : `<p class="trust-warning">This target type does not yet have a backend correction record type. Use its owning memory, answer, or graph edge.</p>`;
function evidenceCard(evidence) {
  const clickback = evidence.brokenReason ? `<p class="error">Pointer resolution failed: ${escapeHtml(evidence.brokenReason)}</p>` : `<a class="transcript-clickback" href="${escapeHtml(routeHref.transcript(evidence.transcriptId, evidence.spanId))}">Open exact transcript span</a>`;
  return `<article class="evidence-card" data-evidence-id="${escapeHtml(evidence.id)}">
    <header>${trustBadge(evidence.strength)} <strong>${escapeHtml(evidence.role)}</strong> <span>${score(evidence.finalScore ?? evidence.confidence)}</span></header>
    <blockquote>${escapeHtml(evidence.quotePreview || evidence.spanText)}</blockquote>
    <p>${escapeHtml(evidence.transcriptTitle)} \xB7 span ${escapeHtml(evidence.spanId)}</p><button type="button" data-copy-quote="${escapeHtml(evidence.quotePreview || evidence.spanText)}">Copy quote</button>
    ${links([{ href: routeHref.evidence(evidence.id), label: "Evidence details" }])} ${clickback}
  </article>`;
}
function answerView(answer) {
  const hasTraceableAnswer = answer.claims.length > 0 && answer.citations.length > 0 && answer.evidence.length > 0;
  const confidence = hasTraceableAnswer ? answer.evidenceConfidence : "no_evidence";
  const brokenWarning = answer.brokenCitationIds?.length ? `<aside class="trust-warning">${trustBadge("broken")} ${answer.brokenCitationIds.length} citation pointer(s) no longer resolve.</aside>` : "";
  const warning = confidence === "weak" || confidence === "no_evidence" ? `<aside class="trust-warning">${trustBadge(confidence)} This answer must not be treated as strong truth.</aside>` : confidence === "conflicting" ? `<aside class="trust-warning">${trustBadge("conflicting")} Supporting and opposing evidence are both preserved below.</aside>` : "";
  const citations = new Map(answer.citations.map((citation) => [citation.id, citation]));
  const claims = answer.claims.map((claim) => `<article class="answer-claim" data-support-status="${escapeHtml(claim.supportStatus)}">
    <p>${escapeHtml(claim.text)}</p>
    <footer>${trustBadge(claim.supportStatus === "supported" ? "strong" : claim.supportStatus === "conflicting" ? "conflicting" : claim.supportStatus === "weakly_supported" ? "weak" : "no_evidence")}
      ${claim.citationIds.map((id) => {
    const citation = citations.get(id);
    return citation ? `<span class="citation-preview"><a class="citation-link" href="${escapeHtml(routeHref.evidence(citation.evidencePointerId))}" title="${escapeHtml(citation.quotePreview)}">${escapeHtml(citation.label)}</a><small>${escapeHtml(citation.quotePreview)}</small>${correctionForm("citation", citation.id)}</span>` : "";
  }).join(" ")}
    </footer>
    ${correctionForm("answer_claim", claim.id)}
  </article>`).join("");
  const evidence = answer.evidence.map((item) => `<article class="evidence-card">
    ${trustBadge(item.evidenceConfidence)} <strong>${escapeHtml(item.stance === "opposes" ? "Opposing/conflicting evidence" : item.stance === "supports" ? "Supporting evidence" : item.stance)}</strong>
    <blockquote>${escapeHtml(item.quotePreview)}</blockquote>
    <p>${escapeHtml(item.scoringExplanation)}</p>
    <a href="${escapeHtml(routeHref.evidence(item.evidencePointerId))}">Inspect evidence and transcript source</a>
    ${correctionForm("evidence", item.evidencePointerId)}
  </article>`).join("");
  const conflict = answer.conflicts.map((item) => `<article class="conflict-card">${trustBadge("conflicting")}<h3>${escapeHtml(item.summary)}</h3><p>${escapeHtml(item.explanation)}</p></article>`).join("");
  return `${brokenWarning}${warning}<article class="answer"><h2>Generated answer</h2><pre>${escapeHtml(answer.answerMarkdown)}</pre></article>
    ${section("Claims and citations", claims || emptyState("No supported claims", "The answer correctly refused to invent claims."))}
    ${section("Evidence", evidence || emptyState("No evidence", "No transcript-backed evidence was available."))}
    ${conflict ? section("Conflicts", conflict) : ""}${section("Submit a correction", correctionForm("answer", answer.id))}`;
}
function transcriptView(transcript, selectedSpanId) {
  const selectedIndex = selectedSpanId ? transcript.spans.findIndex((span) => span.id === selectedSpanId) : -1;
  const start = selectedIndex >= 0 ? Math.max(0, selectedIndex - 20) : 0;
  const visibleSpans = transcript.spans.slice(start, start + 100);
  const spans = visibleSpans.map((span) => `<article id="span-${escapeHtml(span.id)}" class="transcript-span${span.id === selectedSpanId ? " selected-span" : ""}" data-span-id="${escapeHtml(span.id)}">
    <header><strong>${escapeHtml(span.speaker ?? "Unknown speaker")}</strong> <span>${span.startTimeMs == null ? "" : `${Math.round(span.startTimeMs / 1e3)}s`}</span></header>
    <pre>${escapeHtml(span.text)}</pre><button type="button" data-copy-quote="${escapeHtml(span.text)}">Copy quote</button><small>Raw offsets ${span.startChar}-${span.endChar}</small>
  </article>`).join("");
  const missing = selectedSpanId && !transcript.spans.some((span) => span.id === selectedSpanId) ? `<aside class="trust-warning">${trustBadge("broken")} Requested span ${escapeHtml(selectedSpanId)} was not found.</aside>` : "";
  return `<aside class="immutable-notice">Raw transcript source is immutable. Generated text and corrections are stored separately.</aside>${missing}
    <p>${escapeHtml(transcript.status)} \xB7 ${transcript.spanCount} spans \xB7 showing ${visibleSpans.length} \xB7 imported ${escapeHtml(transcript.importedAt)}</p>
    <div class="transcript-viewer" data-selected-span="${escapeHtml(selectedSpanId ?? "")}">${spans}</div>`;
}
function memoryView(view) {
  const memory = view.memory;
  const warning = view.trustState === "strong" ? "" : `<aside class="trust-warning">${trustBadge(view.trustState)} This memory is not independent strong truth.</aside>`;
  const reviewable = memory.status === "needs_review" || memory.status === "weak";
  const reviewSection = reviewable ? section("Review decision", `<p>Approve to promote this memory to active, citable evidence, or Reject to remove it from Ask AI and search. Both are append-only and never edit raw transcript text.</p>${memoryReviewControls(memory.id)}`) : "";
  return `${warning}<article class="memory-object">
    <p>${trustBadge(view.trustState)} ${escapeHtml(memory.type)} \xB7 confidence ${score(memory.confidence)} (${escapeHtml(memory.confidenceLabel)})</p>
    <h2>${escapeHtml(memory.title || memory.type)}</h2><p>${escapeHtml(memory.body)}</p>
    <dl><dt>Canonical status</dt><dd>${escapeHtml(memory.status)}</dd><dt>Evidence spans</dt><dd>${memory.evidenceSpanIds.length}</dd><dt>User corrected</dt><dd>${memory.userCorrected ? "yes" : "no"}</dd><dt>Duplicate of</dt><dd>${escapeHtml(memory.duplicateOfId ?? "none")}</dd></dl>
  </article>${section("Evidence", view.evidence.map(evidenceCard).join("") || emptyState("No linked evidence pointers", "This memory cannot be treated as strong."))}
  ${view.conflicts.length ? section("Conflicts", view.conflicts.map((item) => `<article>${trustBadge("conflicting")} <strong>${escapeHtml(item.summary)}</strong><p>${escapeHtml(item.explanation)}</p></article>`).join("")) : ""}
  ${reviewSection}
  ${section("Submit a correction", correctionForm("memory_object", memory.id))}`;
}
var memoryReviewControls = (memoryId) => `<form data-action="review" class="review-actions"><input type="hidden" name="memoryId" value="${escapeHtml(memoryId)}">
      <button type="submit" name="decision" value="approve">Approve</button>
      <button type="submit" name="decision" value="reject">Reject</button></form><div data-form-result></div>`;
var reviewActions = (item) => {
  if (item.targetType === "memory_object" && (item.type === "memory_needs_review" || item.type === "weak_evidence")) {
    return memoryReviewControls(item.targetId);
  }
  if (item.type === "weak_evidence") {
    return `<p class="trust-warning">This weak-evidence item is attached to a ${escapeHtml(item.targetType)}, not a memory object, so it has no direct Approve/Reject. Open the linked evidence and use the append-only correction below.</p>`;
  }
  return "";
};
function reviewCard(item) {
  return `<article class="review-card">${trustBadge(item.trustState)}<h3><a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a></h3>
    <p>${escapeHtml(item.detail)}</p><small>${escapeHtml(item.severity)} severity \xB7 ${escapeHtml(item.status)} \xB7 ${escapeHtml(item.type)} \xB7 ${escapeHtml(item.targetType)}:${escapeHtml(item.targetId)}</small>
    <a href="${escapeHtml(routeHref.review(item.id))}">Review and correct</a>${reviewActions(item)}</article>`;
}
function searchCard(item) {
  return `<article class="search-result">${item.trustState ? trustBadge(item.trustState) : ""}<h3><a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a></h3>
    <p>${escapeHtml(item.preview)}</p><small>${escapeHtml(item.type)}</small></article>`;
}
function graphNodeLink(nodeId) {
  const [kind, id] = nodeId.split(":", 2);
  if (!id) return null;
  return kind === "memory" ? routeHref.memory(id) : kind === "transcript" ? routeHref.transcript(id) : kind === "evidence" ? routeHref.evidence(id) : null;
}
function healthView(health) {
  const status = health.status === "ready" ? trustBadge("strong", "database connected") : health.status === "unsupported" ? trustBadge("no_evidence", "desktop only") : health.status === "error" ? trustBadge("broken", "startup failed") : trustBadge("needs_review", "initializing");
  return section("Database health", `<article class="database-health">${status}<dl>
    <dt>SQLite storage</dt><dd>${health.realSqliteStorage ? "real local SQLite" : "not connected"}</dd>
    <dt>Migration status</dt><dd>${escapeHtml(health.migrationStatus)}</dd>
    <dt>Packaged migrations</dt><dd>${health.packagedMigrationCount}</dd>
    <dt>Applied migrations</dt><dd>${health.appliedMigrationCount}</dd>
    <dt>Database location</dt><dd>${escapeHtml(health.databasePath ?? "unavailable")}</dd>
    <dt>Last initialization error</dt><dd>${escapeHtml(health.lastInitializationError ?? "none")}</dd>
    <dt>Native binding target</dt><dd>${escapeHtml(health.nativeBindingTarget ?? "unresolved")}</dd>
    <dt>Packaged native targets</dt><dd>${escapeHtml(health.packagedNativeTargets.join(", ") || "none")}</dd>
  </dl></article>`, "database-health-section");
}
async function renderPage(context) {
  const { api, route } = context;
  switch (route.id) {
    case "dashboard": {
      const view = await api.getDashboard();
      const readyStatus = view.health?.status === "ready" ? `<aside class="immutable-notice status-banner"><strong>Transcript Memory Vault is ready.</strong> ${view.health.firstRun ? "Upload a transcript to begin. " : ""}Imported raw transcript snapshots are immutable and stored in local SQLite at ${escapeHtml(view.health.databasePath)}.</aside>` : "";
      const startupProblem = view.health && view.health.status !== "ready" ? `<aside class="trust-warning">${view.health.status === "unsupported" ? trustBadge("no_evidence", "desktop only") : trustBadge("broken", "startup unavailable")} ${escapeHtml(view.health.lastInitializationError ?? "Database initialization has not completed.")}</aside>` : "";
      const llmBanner = view.llmRequired && view.llmReady === false ? `<aside class="trust-warning llm-setup-required">${trustBadge("no_evidence", "LLM required")} AI is not configured. Ask AI and AI memory extraction need an external LLM \u2014 open plugin Settings and add a provider, model, and API key. Transcripts still import; run the "Run AI extraction" command afterward.</aside>` : "";
      const sync = view.generatedSync;
      const syncStatusLine = !sync ? "Generated graph notes status is unavailable in this context." : !sync.synced ? "Never synced \u2014 Obsidian's native graph has no generated notes yet. Sync after importing transcripts, running AI extraction, or asking AI." : `Last synced ${escapeHtml(sync.lastSyncedAt ?? "unknown")} \xB7 ${sync.fileCount ?? 0} files \xB7 ${sync.graphNodeCount ?? 0} nodes \xB7 ${sync.graphEdgeCount ?? 0} edges.`;
      const syncWarn = sync?.status === "failed" ? `<aside class="trust-warning">${trustBadge("broken", "last sync had errors")} ${escapeHtml(sync.error ?? "Some generated files could not be written.")}</aside>` : "";
      const generatedNotesSection = section("Native Obsidian graph", `<p>These generated Markdown notes power Obsidian's <strong>native (ribbon) graph</strong>. The plugin's own Graph page reads SQLite live; the native graph only sees Markdown files and wiki links, so it needs these notes. SQLite stays the source of truth \u2014 editing a generated note never changes memory.</p>
        <p class="generated-sync-status">${syncStatusLine}</p>${syncWarn}
        <form data-action="sync-graph"><button type="submit">Sync Obsidian graph notes</button></form>
        <p data-loading-message hidden>Generating Markdown graph notes\u2026</p><div data-form-result></div>`, "generated-notes-section");
      const vaultStatus = section("Vault status", `<p><strong>SQLite is the source of truth.</strong> Imported raw transcript snapshots are immutable; generated Markdown is a disposable view layer for Obsidian's native graph.</p>
        <div class="metric-grid"><span>${view.totalTranscriptCount} transcripts</span>${routeButton(routeHref.reviewQueue(), `${view.reviewCount} review items`, "route-action metric-action")}<span>${view.weakCount} weak/review</span><span>${view.conflictCount} conflicts</span><span>${view.brokenCount} broken pointers</span></div>
        ${view.health ? healthView(view.health) : ""}`, "vault-status-section");
      const dbPath = view.health?.databasePath;
      const mcpCard = section("Use Claude Desktop (MCP)", `<p><strong>Claude Desktop is the recommended chat UI.</strong> It connects to this vault through a local MCP server and answers from the same evidence-first pipeline. This plugin is your evidence viewer, graph browser, transcript/memory navigator, and review/control panel.</p>
        ${dbPath ? `<p>Point Claude Desktop's <code>TMV_DB_PATH</code> at this vault's database:</p><p class="mcp-db-path"><code>${escapeHtml(dbPath)}</code></p>` : `<p><code>TMV_DB_PATH</code> will appear here once the plugin has initialized its database.</p>`}
        <p>See <code>docs/MCP.md</code> for the full Claude Desktop / MCP setup. (Opening Claude Desktop is a manual step \u2014 there is no in-app launcher.)</p>`, "mcp-card");
      const attention = view.attention ?? [];
      const attentionSection = section("Evidence needing attention", attention.length ? attention.map((item) => `<article class="attention-item">${trustBadge(item.trustState)} <a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a> <small>${escapeHtml(item.detail)}</small></article>`).join("") : emptyState("Nothing needs attention", "No weak, broken, or conflicting evidence right now."), "attention-section");
      const recentAnswers = section("Recent answers", view.recentAnswers.map((item) => `<article>${trustBadge(item.confidence)} <a href="${escapeHtml(routeHref.answer(item.id))}">${escapeHtml(item.question)}</a></article>`).join("") || emptyState("No answers yet", "Ask in Claude Desktop, or use the Ask AI page under Advanced.", { href: routeHref.ask(), label: "Ask AI" }), "recent-answers-section");
      const reviewSection = section("Review queue / conflicts", `<p>${view.reviewCount} open review item(s)${view.conflictCount ? `, including ${view.conflictCount} conflict(s)` : ""}.</p>${links([{ href: routeHref.reviewQueue(), label: "Open review queue" }])}`, "review-summary-section");
      const transcriptsSection = section("Transcripts", `${view.transcripts.map((item) => `<article><a href="${escapeHtml(routeHref.transcript(item.id))}">${escapeHtml(item.title)}</a> \xB7 ${item.spanCount} spans</article>`).join("") || emptyState("No transcripts", "Import a transcript to begin.")}
        ${links([{ href: routeHref.upload(), label: "Upload transcript" }])}`, "transcripts-section");
      const searchSection = section("Search vault", `<p>Find transcripts, spans, memory objects, answers, and evidence.</p>${links([{ href: routeHref.search(), label: "Search vault" }])}`, "search-section");
      const body = `${readyStatus}${startupProblem}${llmBanner}
        ${vaultStatus}
        ${mcpCard}
        ${attentionSection}
        ${recentAnswers}
        ${reviewSection}
        ${generatedNotesSection}
        ${transcriptsSection}
        ${searchSection}`;
      return { title: "Dashboard", html: appShell("Dashboard", body) };
    }
    case "upload":
      return { title: "Upload transcript", html: appShell("Upload transcript", `<aside class="immutable-notice">Uploads become immutable raw transcript sources. Re-uploading identical content reuses the existing transcript.</aside>
        <form data-action="upload"><label>Transcript file (.txt, .md, .srt, .vtt) <input name="file" type="file" accept=".txt,.md,.srt,.vtt" required></label>
        <p data-file-status>No file selected.</p><input name="filename" type="hidden"><textarea name="rawText" hidden></textarea>
        <button type="submit">Import transcript</button></form><p data-loading-message hidden>Importing immutable transcript source...</p><div data-form-result></div>`) };
    case "transcript": {
      const view = await api.getTranscript(route.params.id);
      return { title: view?.title ?? "Transcript not found", html: appShell(view?.title ?? "Transcript not found", view ? transcriptView(view, route.query.get("span") ?? void 0) : emptyState("Transcript not found", "The requested immutable source is unavailable.")) };
    }
    case "ask": {
      const llm = await api.getLlmStatus();
      const claudeDesktopBanner = `<aside class="immutable-notice claude-desktop-banner">Claude Desktop (via MCP) is the recommended chat UI; this page runs the same evidence-grounded, LLM-required pipeline.</aside>`;
      if (llm.required && !llm.ready) {
        return { title: "Ask AI", html: appShell("Ask AI", `${claudeDesktopBanner}<section class="trust-warning ask-setup-required">${trustBadge("no_evidence", "LLM required")}<h2>Set up an LLM to use Ask AI</h2>
          <p>Ask AI answers only from your transcripts, with citations \u2014 but it needs a configured external LLM to generate the answer. Add a provider, model, and API key in the plugin Settings.</p>
          ${links([{ href: routeHref.dashboard(), label: "Open dashboard" }])}</section>`) };
      }
      const transcripts = (await api.listTranscripts()).slice(0, 100);
      return { title: "Ask AI", html: appShell("Ask AI", `${claudeDesktopBanner}<aside class="immutable-notice">Ask AI retrieves and scores evidence before answering. Weak or conflicting evidence remains visibly labeled.</aside>
        <form data-action="ask"><label>Question <textarea name="question" required></textarea></label>
        <label>Optional transcript filter <select name="transcriptIds" multiple>${transcripts.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("")}</select></label>
        <button type="submit">Retrieve, score, and answer</button></form>
        <p data-loading-message hidden>Retrieving and scoring evidence before answer synthesis...</p><div data-form-result></div>`) };
    }
    case "answer": {
      const answer = await api.getAnswer(route.params.id);
      return { title: answer?.question ?? "Answer not found", html: appShell(answer?.question ?? "Answer not found", answer ? answerView(answer) : emptyState("Answer not found", "The requested Ask AI run is unavailable.")) };
    }
    case "evidence": {
      const evidence = await api.getEvidence(route.params.id);
      const body = `${evidence.brokenReason ? `<aside class="trust-warning">${trustBadge("broken")} This pointer cannot be trusted until repaired.</aside>` : ""}
        ${evidenceCard(evidence)}${section("Resolved transcript span", evidence.brokenReason ? emptyState("Resolution failed", evidence.brokenReason) : `<blockquote>${escapeHtml(evidence.spanText)}</blockquote><a href="${escapeHtml(routeHref.transcript(evidence.transcriptId, evidence.spanId))}">Open highlighted source span</a>`)}
        ${section("Submit a correction", correctionForm("evidence", evidence.id))}`;
      return { title: `Evidence ${evidence.id}`, html: appShell(`Evidence ${evidence.id}`, body) };
    }
    case "memory": {
      const view = await api.getMemory(route.params.id);
      return { title: view?.memory.title || "Memory object", html: appShell(view?.memory.title || "Memory object", view ? memoryView(view) : emptyState("Memory not found", "The requested canonical memory object is unavailable.")) };
    }
    case "graph": {
      const { graph, warnings } = await api.getGraph();
      const query = (route.query.get("q") ?? "").toLowerCase(), type = route.query.get("type") ?? "all";
      const limit = Math.min(Math.max(Number(route.query.get("limit") ?? 100) || 100, 1), 100);
      const visibleNodes = graph.nodes.filter((node) => (!query || node.label.toLowerCase().includes(query)) && (type === "all" || node.type === type)).slice(0, limit);
      const ids = new Set(visibleNodes.map((node) => node.id));
      const visibleEdges = graph.edges.filter((edge) => ids.has(edge.source) || ids.has(edge.target)).slice(0, limit);
      const nodes = visibleNodes.map((node) => `<li tabindex="0"><a href="${routeHref.graph(`?selectedNode=${encodeURIComponent(node.id)}`)}"><strong>${escapeHtml(node.label)}</strong></a> <small>${escapeHtml(node.type)}</small> ${node.supportStatus ? `<span class="support-status">${escapeHtml(node.supportStatus)}</span>` : ""}</li>`).join("");
      const edges = visibleEdges.map((edge) => `<li tabindex="0">${edge.type === "contradicts" || edge.type === "updates" ? trustBadge("conflicting", edge.type) : ""} <a href="${routeHref.graph(`?selectedEdge=${encodeURIComponent(edge.id)}`)}">${escapeHtml(edge.source)} \u2192 ${escapeHtml(edge.target)} <strong>${escapeHtml(edge.type)}</strong></a> ${edge.evidencePointerId ? `<a href="${escapeHtml(routeHref.evidence(edge.evidencePointerId))}">evidence</a>` : `<span>${trustBadge("needs_review", "inferred / no evidence link")}</span>`}</li>`).join("");
      const selectedNode = graph.nodes.find((node) => node.id === route.query.get("selectedNode"));
      const selectedEdge = graph.edges.find((edge) => edge.id === route.query.get("selectedEdge"));
      const details = selectedNode ? section("Selected node", `<article><h3>${escapeHtml(selectedNode.label)}</h3><p>${escapeHtml(selectedNode.type)} \xB7 ${escapeHtml(selectedNode.supportStatus ?? "no status")} \xB7 confidence ${score(selectedNode.confidence)}</p><p>${graph.edges.filter((edge) => (edge.source === selectedNode.id || edge.target === selectedNode.id) && edge.evidencePointerId).length} evidence-linked edge(s)</p>${graphNodeLink(selectedNode.id) ? `<a href="${escapeHtml(graphNodeLink(selectedNode.id))}">Open related item</a>` : ""}</article>`) : selectedEdge ? section("Selected edge", `<article>${selectedEdge.type === "contradicts" || selectedEdge.type === "updates" ? trustBadge("conflicting", selectedEdge.type) : ""}<p>${escapeHtml(selectedEdge.source)} \u2192 ${escapeHtml(selectedEdge.target)}</p><p>${escapeHtml(selectedEdge.type)} \xB7 confidence ${score(selectedEdge.confidence)} \xB7 ${selectedEdge.evidencePointerId ? "1 evidence link" : "0 evidence links"}</p>${selectedEdge.evidencePointerId ? `<a href="${escapeHtml(routeHref.evidence(selectedEdge.evidencePointerId))}">Open linked evidence</a>` : ""}</article>`) : "";
      return { title: "Graph", html: appShell("Graph", `<form data-action="filter" data-view="graph"><label>Filter graph <input name="q" value="${escapeHtml(query)}"></label><label>Node type <input name="type" value="${escapeHtml(type)}"></label><label>Limit (max 100) <input name="limit" type="number" min="1" max="100" value="${limit}"></label><button type="submit">Apply</button></form>
        <p>Showing ${visibleNodes.length} of ${graph.nodes.length} nodes and ${visibleEdges.length} edges.</p>${warnings.length ? `<aside class="trust-warning">${warnings.map(escapeHtml).join("<br>")}</aside>` : ""}${details}${section("Nodes", `<ul>${nodes}</ul>`)}${section("Edges", `<ul>${edges}</ul>`)}`) };
    }
    case "search": {
      const query = route.query.get("q") ?? "";
      const results = await api.search(query);
      const filter = route.query.get("type") ?? "all", strength = route.query.get("strength") ?? "all";
      const filtered = results.filter((item) => (filter === "all" || filter === "evidence" && item.type === "evidence" || item.type === filter || filter === "memory" && item.type === "memory_object" || filter === "answers" && item.type === "answer" || filter === "transcripts" && (item.type === "transcript" || item.type === "span")) && (strength === "all" || item.trustState === strength));
      const groups = [...new Set(filtered.map((item) => item.type))].map((group) => section(group.replaceAll("_", " "), filtered.filter((item) => item.type === group).map(searchCard).join(""))).join("");
      return { title: "Search", html: appShell("Search", `<aside class="immutable-notice">Search finds candidate evidence; evidence scores decide how much to trust it.</aside><form data-action="filter" data-view="search"><label>Search transcripts, spans, memory, answers, and evidence <input name="q" value="${escapeHtml(query)}"></label><label>Type <select name="type"><option>${escapeHtml(filter)}</option><option>all</option><option>transcripts</option><option>memory</option><option>answers</option><option>evidence</option></select></label><label>Evidence strength <select name="strength"><option>${escapeHtml(strength)}</option><option>all</option><option>strong</option><option>mixed</option><option>weak</option><option>conflicting</option><option>broken</option></select></label><button type="submit">Search</button></form>
        ${query ? section(`${filtered.length} results`, groups || emptyState("No results", "No source-backed content matched.")) : emptyState("Search the vault", "Enter a phrase to search structured SQLite content.")}`) };
    }
    case "review": {
      const items = await api.listReviewItems(), type = route.query.get("type") ?? "all", status = route.query.get("status") ?? "open";
      const filtered = items.filter((item) => (type === "all" || item.type === type) && (status === "all" || item.status === status));
      return { title: "Review queue", html: appShell("Review queue", `<form data-action="filter" data-view="review"><label>Item type <input name="type" value="${escapeHtml(type)}"></label><label>Status <select name="status"><option>${escapeHtml(status)}</option><option>open</option><option>resolved</option><option>dismissed</option><option>all</option></select></label><button type="submit">Filter items</button></form>${filtered.map(reviewCard).join("") || emptyState("Review queue is clear", "No weak, broken, conflicting, or review-only items were found.")}`) };
    }
    case "review_detail": {
      const item = await api.getReviewItem(route.params.id);
      const form = item ? correctionForm(item.targetType, item.targetId) : "";
      const related2 = item ? `${item.relatedTranscriptIds.length ? section("Linked transcripts", item.relatedTranscriptIds.map((id) => `<a href="${escapeHtml(routeHref.transcript(id))}">${escapeHtml(id)}</a>`).join(" ")) : ""}${item.relatedEvidenceIds.length ? section("Linked evidence", item.relatedEvidenceIds.map((id) => `<a href="${escapeHtml(routeHref.evidence(id))}">${escapeHtml(id)}</a>`).join(" ")) : ""}` : "";
      return { title: item?.title ?? "Review item not found", html: appShell(item?.title ?? "Review item not found", item ? `${reviewCard(item)}${related2}<aside class="immutable-notice">Resolution is read-only here. Corrections are appended as separate records; raw source text is never edited.</aside>${form}` : emptyState("Review item not found", "This item may already have been resolved.")) };
    }
    default:
      return { title: "Not found", html: appShell("Not found", emptyState("Page not found", "The requested frontend route does not exist.", { href: "/", label: "Dashboard" })) };
  }
}

// src/frontend/app.ts
async function renderRoute(api, url) {
  try {
    return (await renderPage({ api, route: matchRoute(url) })).html;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Transcript Memory Vault UI render failed", error);
    return appShell("Unable to load view", `<section class="trust-warning"><h2>Transcript Memory Vault could not load this view</h2><p>${escapeHtml(detail)}</p><p>The plugin did not continue as if unavailable data were trustworthy. Open the dashboard or plugin settings for database health details.</p></section>`);
  }
}
var mountControllers = /* @__PURE__ */ new WeakMap();
var MUTATING_ACTIONS = /* @__PURE__ */ new Set(["upload", "ask", "correction", "review", "sync-graph"]);
async function mountObsidianUi(root, api, navigation, initialTarget, onMutation) {
  mountControllers.get(root)?.abort();
  const controller = new AbortController();
  mountControllers.set(root, controller);
  const { signal } = controller;
  let currentTarget = initialTarget;
  const render = async (target) => {
    currentTarget = target;
    root.innerHTML = await renderRoute(api, target);
    const span = new URL(target).searchParams.get("span");
    if (span) document.getElementById(`span-${span}`)?.scrollIntoView({ block: "center" });
  };
  root.addEventListener("click", (event) => {
    const copy = event.target.closest("[data-copy-quote]");
    if (copy) {
      void navigator.clipboard?.writeText(copy.dataset.copyQuote ?? "");
      copy.textContent = "Quote copied";
      return;
    }
    const routeControl = event.target.closest("[data-route], a[href]");
    const target = routeControl?.dataset.route ?? routeControl?.getAttribute("href");
    if (!isInternalNavigationTarget(target)) return;
    event.preventDefault();
    event.stopPropagation();
    void navigateInternal(navigation, target);
  }, { signal });
  root.addEventListener("change", (event) => {
    const input = event.target;
    if (input.name !== "file" || !input.files?.[0]) return;
    const file = input.files[0];
    const form = input.form;
    const status = form?.querySelector("[data-file-status]") ?? form?.parentElement?.querySelector("[data-file-status]");
    if (status) status.textContent = `${file.name} \xB7 ${file.size} bytes`;
    void file.text().then((text) => {
      const filename = form?.elements.namedItem("filename");
      const rawText = form?.elements.namedItem("rawText");
      if (filename) filename.value = file.name;
      if (rawText) rawText.value = text;
    });
  }, { signal });
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const result = form.parentElement?.querySelector("[data-form-result]");
    const loading = form.parentElement?.querySelector("[data-loading-message]");
    const action = form.dataset.action;
    void (async () => {
      try {
        if (loading) loading.hidden = false;
        if (action === "upload") {
          const imported = await api.uploadTranscript({ filename: String(data.get("filename") ?? ""), rawText: String(data.get("rawText") ?? "") });
          if (result) {
            result.innerHTML = `${imported.status === "duplicate" ? "<strong>Duplicate transcript:</strong> existing immutable source reused." : "<strong>Transcript imported successfully.</strong>"}
              <a href="${escapeHtml(routeHref.transcript(imported.transcriptId))}">Open transcript</a> <a href="${routeHref.dashboard()}">Dashboard</a>${imported.warning ? `<p class="trust-warning">${escapeHtml(imported.warning)}</p>` : ""}`;
          }
        } else if (action === "ask") {
          const answer = await api.ask(String(data.get("question") ?? ""), { transcriptIds: data.getAll("transcriptIds").map(String) });
          await navigation.openAnswer(answer.id);
        } else if (action === "correction") {
          const correction = await api.submitCorrection({
            targetType: String(data.get("targetType")),
            targetId: String(data.get("targetId")),
            correctionText: String(data.get("correctionText") ?? ""),
            reason: String(data.get("reason") ?? "") || void 0
          });
          if (result) result.innerHTML = `Correction appended: <code>${escapeHtml(correction.correctionId)}</code>`;
        } else if (action === "review") {
          await performReviewAction(api, String(data.get("memoryId") ?? ""), data.get("decision") === "reject" ? "reject" : "approve", render, currentTarget);
        } else if (action === "sync-graph") {
          const summary = await api.syncGeneratedGraphNotes?.();
          if (result) result.innerHTML = renderSyncSummary(summary);
        } else if (action === "filter") {
          const view = form.dataset.view ?? "dashboard";
          await render(`mv://${view}?${new URLSearchParams(data)}`);
        }
        if (action && MUTATING_ACTIONS.has(action)) {
          try {
            await onMutation?.();
          } catch (refreshError) {
            console.error("Transcript Memory Vault cross-view refresh failed", refreshError);
          }
        }
      } catch (error) {
        if (result) result.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        if (loading) loading.hidden = true;
      }
    })();
  }, { signal });
  await render(initialTarget);
}
function isInternalNavigationTarget(target) {
  return target?.startsWith("mv://") ?? false;
}
function renderSyncSummary(summary) {
  if (!summary || summary.status === "unavailable") {
    return `<p class="trust-warning">${escapeHtml(summary?.message ?? 'Generated graph notes can only be synced inside the Obsidian plugin. Use the "Sync generated graph notes" command.')}</p>`;
  }
  if (summary.status === "failed") return `<p class="trust-warning">Sync failed: ${escapeHtml(summary.message)}</p>`;
  const warn = summary.warnings.length ? `<p class="trust-warning">${summary.warnings.length} warning(s) \u2014 weak/broken evidence is preserved and labeled in the generated notes.</p>` : "";
  const err = summary.errors.length ? `<p class="trust-warning">${summary.errors.length} file(s) could not be written.</p>` : "";
  return `<p><strong>Graph notes synced.</strong> ${summary.filesWritten} written, ${summary.filesSkipped} unchanged \xB7 ${summary.graphNodeCount} nodes \xB7 ${summary.graphEdgeCount} edges. Open Obsidian's native graph to see them.</p>${warn}${err}`;
}
function refreshTargetAfterAction(currentTarget) {
  return matchRoute(currentTarget).id === "review_detail" ? routeHref.reviewQueue() : currentTarget;
}
async function performReviewAction(api, memoryId, decision, refresh, currentTarget) {
  await api.reviewMemoryObject(memoryId, decision);
  await refresh(refreshTargetAfterAction(currentTarget));
}

// src/obsidian/pluginTypes.ts
var OBSIDIAN_VIEW_TYPES = {
  dashboard: "transcript-memory-dashboard",
  upload: "transcript-memory-upload",
  transcript: "transcript-memory-transcript",
  ask: "transcript-memory-ask",
  answer: "transcript-memory-answer",
  evidence: "transcript-memory-evidence",
  memory: "transcript-memory-memory-object",
  graph: "transcript-memory-graph",
  search: "transcript-memory-search",
  review: "transcript-memory-review"
};
var OBSIDIAN_COMMANDS = [
  { id: "open-dashboard", name: "Open Transcript Memory Dashboard", viewType: OBSIDIAN_VIEW_TYPES.dashboard },
  { id: "upload-transcript", name: "Upload Transcript", viewType: OBSIDIAN_VIEW_TYPES.upload },
  { id: "ask-ai", name: "Ask AI About Transcripts", viewType: OBSIDIAN_VIEW_TYPES.ask },
  { id: "search-vault", name: "Search Transcript Memory Vault", viewType: OBSIDIAN_VIEW_TYPES.search },
  { id: "open-graph", name: "Open Memory Graph", viewType: OBSIDIAN_VIEW_TYPES.graph },
  { id: "open-review", name: "Open Review Queue", viewType: OBSIDIAN_VIEW_TYPES.review }
];
var OBSIDIAN_RIBBON = { icon: "database", title: "Open Transcript Memory Dashboard" };
var OBSIDIAN_REINDEX_COMMAND = { id: "rebuild-embedding-index", name: "Rebuild Embedding Index" };
var OBSIDIAN_SYNC_GRAPH_COMMAND = { id: "sync-generated-graph-notes", name: "Sync generated graph notes" };
var OBSIDIAN_DEDUPE_COMMAND = { id: "merge-duplicate-memories", name: "Merge duplicate memories" };
var GENERATED_VAULT_FOLDER = "Transcript Memory Vault";
var viewTitle = (type) => ({
  [OBSIDIAN_VIEW_TYPES.dashboard]: "Transcript Memory Dashboard",
  [OBSIDIAN_VIEW_TYPES.upload]: "Upload Transcript",
  [OBSIDIAN_VIEW_TYPES.transcript]: "Transcript Source",
  [OBSIDIAN_VIEW_TYPES.ask]: "Ask AI",
  [OBSIDIAN_VIEW_TYPES.answer]: "AI Answer",
  [OBSIDIAN_VIEW_TYPES.evidence]: "Evidence",
  [OBSIDIAN_VIEW_TYPES.memory]: "Memory Object",
  [OBSIDIAN_VIEW_TYPES.graph]: "Memory Graph",
  [OBSIDIAN_VIEW_TYPES.search]: "Search Transcript Memory",
  [OBSIDIAN_VIEW_TYPES.review]: "Review Queue"
})[type];
var defaultTarget = (type) => ({
  [OBSIDIAN_VIEW_TYPES.dashboard]: "mv://dashboard",
  [OBSIDIAN_VIEW_TYPES.upload]: "mv://upload",
  [OBSIDIAN_VIEW_TYPES.transcript]: "mv://transcripts/missing",
  [OBSIDIAN_VIEW_TYPES.ask]: "mv://ask",
  [OBSIDIAN_VIEW_TYPES.answer]: "mv://answers/missing",
  [OBSIDIAN_VIEW_TYPES.evidence]: "mv://evidence/missing",
  [OBSIDIAN_VIEW_TYPES.memory]: "mv://memory/missing",
  [OBSIDIAN_VIEW_TYPES.graph]: "mv://graph",
  [OBSIDIAN_VIEW_TYPES.search]: "mv://search",
  [OBSIDIAN_VIEW_TYPES.review]: "mv://review"
})[type];

// src/obsidian/ObsidianNavigation.ts
function createObsidianNavigation(app) {
  const open = async (type, target) => {
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type, active: true, state: { target } });
    app.workspace.revealLeaf(leaf);
  };
  return {
    openDashboard: () => open(OBSIDIAN_VIEW_TYPES.dashboard, "mv://dashboard"),
    openUpload: () => open(OBSIDIAN_VIEW_TYPES.upload, "mv://upload"),
    openTranscript: (id, options) => open(OBSIDIAN_VIEW_TYPES.transcript, `mv://transcripts/${encodeURIComponent(id)}${options?.spanId ? `?span=${encodeURIComponent(options.spanId)}` : ""}`),
    openAskAI: (options) => open(OBSIDIAN_VIEW_TYPES.ask, `mv://ask${options?.transcriptIds?.length ? `?transcriptIds=${options.transcriptIds.map(encodeURIComponent).join(",")}` : ""}`),
    openAnswer: (id) => open(OBSIDIAN_VIEW_TYPES.answer, `mv://answers/${encodeURIComponent(id)}`),
    openEvidence: (id) => open(OBSIDIAN_VIEW_TYPES.evidence, `mv://evidence/${encodeURIComponent(id)}`),
    openMemoryObject: (id) => open(OBSIDIAN_VIEW_TYPES.memory, `mv://memory/${encodeURIComponent(id)}`),
    openGraph: (options) => {
      const params = new URLSearchParams();
      if (options?.selectedNodeId) params.set("selectedNode", options.selectedNodeId);
      if (options?.selectedEdgeId) params.set("selectedEdge", options.selectedEdgeId);
      if (options?.query) params.set("q", options.query);
      return open(OBSIDIAN_VIEW_TYPES.graph, `mv://graph${params.size ? `?${params}` : ""}`);
    },
    openSearch: (query) => open(OBSIDIAN_VIEW_TYPES.search, `mv://search${query ? `?q=${encodeURIComponent(query)}` : ""}`),
    openReviewQueue: (options) => open(OBSIDIAN_VIEW_TYPES.review, options?.reviewItemId ? `mv://review/${encodeURIComponent(options.reviewItemId)}` : "mv://review")
  };
}

// src/obsidian/generateVault.ts
var import_node_path4 = require("node:path");

// src/obsidian/markdown.ts
var generatedWarning = `> [!warning] Generated view
> This note is generated from the SQLite database. The database is the source of truth. Editing this Markdown file will not update memory truth.`;
var frontmatter = (input) => `---
${Object.entries(input).filter(([, value]) => value != null).map(([key, value]) => `${key}: ${typeof value === "string" ? JSON.stringify(value) : value}`).join("\n")}
---`;
var quote = (text, max = 500) => (text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text).split("\n").map((line) => `> ${line}`).join("\n");
var makeGeneratedFile = (logicalType, relativePath, content, entityType, entityId) => ({
  logicalType,
  relativePath,
  content: content.endsWith("\n") ? content : `${content}
`,
  contentHash: contentHash(content.endsWith("\n") ? content : `${content}
`),
  entityType,
  entityId
});

// src/obsidian/citations.ts
function renderEvidenceCitation(db, evidencePointerId, maxQuoteLength = 300) {
  const resolved = resolveEvidencePointer(db, evidencePointerId);
  if (!resolved.ok) return { markdown: `> [!danger] Broken evidence pointer
> \`${evidencePointerId}\`: ${resolved.reason}`, broken: true };
  const title = db.prepare("SELECT title FROM transcripts WHERE id=?").get(resolved.evidence.transcript_id).title;
  const score2 = resolved.evidence.final_score ?? resolved.evidence.confidence;
  return {
    broken: false,
    markdown: `${wikiLink(transcriptPath(title, resolved.evidence.transcript_id), `${title}, ${resolved.evidence.span_id}`, resolved.evidence.span_id)}  
${wikiLink(evidencePath(resolved.spanText, evidencePointerId), "Evidence note")}  
\`${resolved.evidence.pointer_uri}\`  
\`${resolved.evidence.source_pointer_uri}\`  
**Role:** ${resolved.evidence.evidence_role} \xB7 **Strength:** ${resolved.evidence.evidence_strength} \xB7 **Score:** ${score2.toFixed(3)}

${quote(resolved.spanText, maxQuoteLength)}`
  };
}

// src/obsidian/answerNotes.ts
function generateAnswerNotes(db, maxQuoteLength = 300) {
  const answers = db.prepare("SELECT * FROM ai_answers ORDER BY id").all();
  return answers.map((answer) => {
    const claims = db.prepare("SELECT * FROM answer_claims WHERE answer_id=? ORDER BY claim_order").all(answer.id);
    const claimSections = claims.map((claim) => {
      const pointers = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=? ORDER BY evidence_pointer_id").all(claim.answer_claim_id);
      return `### Claim ${Number(claim.claim_order) + 1}: ${claim.support_status}

${claim.claim_text}

${pointers.map((pointer) => renderEvidenceCitation(db, pointer.evidence_pointer_id, maxQuoteLength).markdown).join("\n\n") || "> [!danger] Unsupported claim\n> No evidence pointers."}`;
    }).join("\n\n");
    const warning = answer.answer_status === "weak_evidence" || answer.answer_status === "refused_no_evidence" ? "> [!caution] Weak or missing evidence\n> This answer is limited by its evidence." : answer.answer_status === "conflicting_evidence" ? "> [!warning] Conflicting evidence\n> The answer must preserve both sides." : "";
    return makeGeneratedFile("answer_note", answerPath(questionLabel(String(answer.question_text)), String(answer.id)), `${frontmatter({ mv_entity_type: "answer", mv_entity_id: String(answer.id), mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: String(answer.answer_status), mv_confidence: String(answer.confidence) })}
# Ask AI Answer

#tmv/answer

${generatedWarning}

${warning}

## Question

${answer.question_text}

## Generated Answer

> [!note] Generated text
> ${String(answer.answer_text).replace(/\n/g, "\n> ")}

## Claim-Level Citations

${claimSections || "_No claims were generated._"}`, "answer", String(answer.id));
  });
}

// src/obsidian/conflictNotes.ts
function generateConflictNotes(db, maxQuoteLength = 300) {
  return db.prepare("SELECT id FROM conflict_assessments ORDER BY id").all().map(({ id }) => {
    const conflict = createConflictRepository(db).getConflictAssessment(id);
    const side = (targetType, targetId, name) => {
      const memory = targetType === "memory_object" || targetType === "claim" || targetType === "summary" ? db.prepare("SELECT title,generated_text,type FROM memory_objects WHERE id=?").get(targetId) : void 0;
      const links2 = conflict.evidenceLinks.filter((item) => item.side === name.toLowerCase()).map((item) => renderEvidenceCitation(db, item.evidencePointerId, maxQuoteLength).markdown).join("\n\n");
      return `### ${name} Side

**Target:** ${memory ? wikiLink(memoryPath(memory.title ?? memory.generated_text.slice(0, 80), targetId, memory.type), memory.title ?? targetId) : `\`${targetType}:${targetId}\``}

${links2 || "> [!danger] Missing side evidence"}`;
    };
    return makeGeneratedFile("conflict_note", conflictPath(conflict.summary, id), `${frontmatter({ mv_entity_type: "conflict", mv_entity_id: id, mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: conflict.status, mv_confidence: conflict.confidence })}
# ${conflict.summary}

#tmv/conflict

${generatedWarning}

> [!warning] Conflict / tension
> Both sides are shown. This generated view does not resolve transcript truth.

**Type:** ${conflict.kind}  
**Status:** ${conflict.status}  
**Confidence:** ${conflict.confidence.toFixed(3)}  
**Resolution:** ${conflict.resolutionNote ?? "Unresolved"}

${side(conflict.leftTargetType, conflict.leftTargetId, "Left")}

${side(conflict.rightTargetType, conflict.rightTargetId, "Right")}

## Generated Explanation

${conflict.explanation}`, "conflict", id);
  });
}

// src/obsidian/entityNotes.ts
function generateEntityNotes(db) {
  const graphRows = db.prepare("SELECT * FROM graph_nodes WHERE node_type IN ('entity','topic') ORDER BY node_type,id").all();
  const decisions = db.prepare(`SELECT id,title,generated_text,status FROM memory_objects
    WHERE COALESCE(extraction_type,type)='decision' AND duplicate_of_id IS NULL AND status NOT IN ('superseded','rejected')
      AND (extraction_status IS NULL OR extraction_status NOT IN ('superseded','rejected'))
    ORDER BY id`).all();
  const graphNotes = graphRows.map((row) => {
    const kind = row.node_type === "entity" ? "person" : "topic";
    const evidence = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type='graph_node' AND target_id=? ORDER BY evidence_pointer_id").all(row.id).map((item) => renderEvidenceCitation(db, item.evidence_pointer_id).markdown).join("\n\n") || "_No direct source evidence pointers._";
    const related2 = db.prepare(`SELECT other.label,other.node_type,other.ref_id,e.edge_type FROM graph_edges e
      JOIN graph_nodes other ON other.id=CASE WHEN e.from_node_id=? THEN e.to_node_id ELSE e.from_node_id END
      WHERE e.from_node_id=? OR e.to_node_id=? ORDER BY other.label`).all(row.id, row.id, row.id).map((item) => `- ${item.edge_type}: ${item.node_type === "entity" || item.node_type === "topic" ? wikiLink(entityPath(item.node_type === "entity" ? "person" : "topic", item.label, item.ref_id), item.label) : item.label}`).join("\n") || "_No related graph objects._";
    return makeGeneratedFile(kind === "person" ? "person_note" : "topic_note", entityPath(kind, String(row.label), String(row.ref_id)), `${frontmatter({ mv_entity_type: kind, mv_entity_id: String(row.ref_id), mv_generated: true, mv_source_of_truth: "sqlite" })}
# ${row.label}

#tmv/${kind}

${generatedWarning}

This is a generated ${kind} view. Related source-backed relationships appear in graph views.

**Graph node:** \`${row.id}\`

## Source Evidence

${evidence}

## Related

${related2}`, kind, String(row.ref_id));
  });
  const decisionNotes = decisions.map((row) => {
    const evidence = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=? ORDER BY evidence_pointer_id").all(row.id).map((item) => renderEvidenceCitation(db, item.evidence_pointer_id).markdown).join("\n\n") || "> [!danger] Unsupported decision\n> No evidence pointers.";
    return makeGeneratedFile("decision_note", entityPath("decision", String(row.title ?? row.generated_text), String(row.id)), `${frontmatter({ mv_entity_type: "decision", mv_entity_id: String(row.id), mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: String(row.status) })}
# ${row.title ?? "Decision"}

#tmv/memory

${generatedWarning}

> [!note] Generated decision text
> ${String(row.generated_text).replace(/\n/g, "\n> ")}

## Source Evidence

${evidence}`, "decision", String(row.id));
  });
  return [...graphNotes, ...decisionNotes];
}

// src/obsidian/evidenceNotes.ts
function generateEvidenceNotes(db, maxQuoteLength = 300) {
  const rows = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers ORDER BY evidence_pointer_id").all();
  const warnings = [];
  const files = rows.map(({ evidence_pointer_id }) => {
    const resolved = resolveEvidencePointer(db, evidence_pointer_id);
    if (!resolved.ok) {
      warnings.push(`Broken evidence pointer ${evidence_pointer_id}: ${resolved.reason}`);
      return makeGeneratedFile("evidence_note", evidencePath("Broken evidence", evidence_pointer_id), `${frontmatter({ mv_entity_type: "evidence", mv_entity_id: evidence_pointer_id, mv_generated: true, mv_source_of_truth: "sqlite" })}
# Evidence ${evidence_pointer_id}

#tmv/evidence

${generatedWarning}

> [!danger] Broken evidence pointer
> ${resolved.reason}`, "evidence", evidence_pointer_id);
    }
    const title = db.prepare("SELECT title FROM transcripts WHERE id=?").get(resolved.evidence.transcript_id).title;
    let targetLink = `\`${resolved.evidence.target_type}:${resolved.evidence.target_id}\``;
    if (["memory_object", "claim", "summary"].includes(resolved.evidence.target_type)) {
      const memory = db.prepare(`SELECT title, generated_text, COALESCE(extraction_type,type) AS type FROM memory_objects
        WHERE id=? AND duplicate_of_id IS NULL AND status NOT IN ('superseded','rejected')
          AND (extraction_status IS NULL OR extraction_status NOT IN ('superseded','rejected'))`).get(resolved.evidence.target_id);
      if (memory) {
        const memoryTitle = memory.title ?? memory.generated_text.slice(0, 80);
        targetLink = wikiLink(memoryPath(memoryTitle, resolved.evidence.target_id, memory.type), memoryTitle);
      }
    }
    const content = `${frontmatter({ mv_entity_type: "evidence", mv_entity_id: evidence_pointer_id, mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: resolved.evidence.evidence_strength, mv_confidence: resolved.evidence.confidence })}
# Evidence ${evidence_pointer_id}

#tmv/evidence

${generatedWarning}

**Target:** ${targetLink}
**Role:** ${resolved.evidence.evidence_role}
**Strength:** ${resolved.evidence.evidence_strength}
**Evidence URI:** \`${resolved.evidence.pointer_uri}\`
**Source URI:** \`${resolved.evidence.source_pointer_uri}\`
**Transcript span:** ${wikiLink(transcriptPath(title, resolved.evidence.transcript_id), `${title}, ${resolved.evidence.span_id}`, resolved.evidence.span_id)}

## Immutable Source Quote

${quote(resolved.spanText, maxQuoteLength)}`;
    return makeGeneratedFile("evidence_note", evidencePath(resolved.spanText, evidence_pointer_id), content, "evidence", evidence_pointer_id);
  });
  return { files, warnings };
}

// src/obsidian/graphFilters.ts
function filterGraphByNodeTypes(graph, types) {
  const allowed = new Set(types), nodes = graph.nodes.filter((node) => allowed.has(node.type)), ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
}
var related = (graph, focus) => {
  const ids = new Set(graph.nodes.filter((node) => focus.includes(node.type)).map((node) => node.id));
  graph.edges.forEach((edge) => {
    if (ids.has(edge.source) || ids.has(edge.target)) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
  });
  return { nodes: graph.nodes.filter((node) => ids.has(node.id)), edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
};
var buildTopicGraph = (graph) => related(graph, ["topic"]);
var buildPeopleGraph = (graph) => related(graph, ["person"]);
var buildDecisionGraph = (graph) => related(graph, ["decision"]);
var buildSourceEvidenceGraph = (graph) => {
  const filtered = filterGraphByNodeTypes(graph, ["transcript", "span", "evidence", "memory", "decision", "answer", "claim"]);
  return {
    nodes: filtered.nodes,
    edges: filtered.edges.map((edge) => {
      const sourceType = filtered.nodes.find((node) => node.id === edge.source)?.type;
      const targetType = filtered.nodes.find((node) => node.id === edge.target)?.type;
      const reverse = sourceType === "span" && targetType === "transcript" || sourceType === "evidence" && targetType === "span" || (sourceType === "memory" || sourceType === "decision" || sourceType === "claim" || sourceType === "answer") && targetType === "evidence";
      return reverse ? { ...edge, source: edge.target, target: edge.source, metadata: { ...edge.metadata, sourceLineageView: true } } : edge;
    })
  };
};

// src/obsidian/graphRenderers.ts
function graphJson(graph, includedNodeTypes = [], includedEdgeTypes = []) {
  return `${JSON.stringify({ version: 1, generatedFrom: "sqlite", nodes: graph.nodes, edges: graph.edges, filters: { includedNodeTypes, includedEdgeTypes } }, null, 2)}
`;
}
function graphMarkdown(title, graph, jsonPath, brokenPointerCount) {
  const important = graph.nodes.filter((node) => node.notePath).slice(0, 20).map((node) => `- ${node.label}`).join("\n") || "_No nodes yet._";
  return `---
tags: [tmv/system]
---
# ${title}

#tmv/system

${generatedWarning}

This is a generated SQLite-backed summary. For the actual graph, use Obsidian's native graph with a tag
filter (see \`_system/graph-guide.md\`); this note intentionally does not link to content notes.

- Nodes: ${graph.nodes.length}
- Edges: ${graph.edges.length}
- Broken evidence pointers: ${brokenPointerCount}
- JSON data: ${jsonPath} (plain path, not a link)

## Nodes (names only)

${important}`;
}
var makeGraphJsonFile = (path, graph) => makeGeneratedFile("graph_json", path, graphJson(graph));
var makeGraphMarkdownFile = (title, path, jsonPath, graph, broken) => makeGeneratedFile("graph_markdown", path, graphMarkdown(title, graph, jsonPath, broken));

// src/obsidian/home.ts
function generateHomeNote(db) {
  const count = (table, where = "") => db.prepare(`SELECT COUNT(*) count FROM ${table} ${where}`).get().count;
  return makeGeneratedFile("home", "00 Home.md", `---
tags: [tmv/system]
---
# Memory Vault

#tmv/system

${generatedWarning}

## Overview

- Transcripts: ${count("transcripts")}
- Memory objects: ${count("memory_objects")}
- Evidence pointers: ${count("evidence_pointers")}
- People: ${count("graph_nodes", "WHERE node_type='entity'")}
- Topics: ${count("graph_nodes", "WHERE node_type='topic'")}
- Decisions: ${count("memory_objects", "WHERE COALESCE(extraction_type,type)='decision'")}
- Answers: ${count("ai_answers")}
- Conflicts: ${count("conflict_assessments")}

## Browse (folders)

Open these folders in the file explorer; they are plain paths, not links, so this note stays out of the graph:

- Transcripts/
- Memories/
- People/  \xB7  Topics/  \xB7  Decisions/
- Evidence/
- Answers/
- Conflicts/
- _system/graph-guide.md (recommended Obsidian graph filters)`);
}

// src/obsidian/manifest.ts
function buildManifest(files, graph, warnings) {
  const stableFiles = files.map(({ content: _content, ...file }) => file).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = contentHash(stableFiles.map((file) => `${file.relativePath}:${file.contentHash}`).join("\n"));
  const manifest = {
    version: 1,
    generatedFrom: "sqlite",
    contentHash: hash,
    files: stableFiles,
    entityPaths: Object.fromEntries(stableFiles.filter((file) => file.entityType && file.entityId).map((file) => [`${file.entityType}:${file.entityId}`, file.relativePath])),
    graphStats: { nodes: graph.nodes.length, edges: graph.edges.length },
    warnings: [...warnings].sort(),
    brokenPointerCount: warnings.filter((warning) => warning.startsWith("Broken evidence pointer")).length
  };
  return { manifest, file: makeGeneratedFile("system_manifest", "_system/view-manifest.json", `${JSON.stringify(manifest, null, 2)}
`) };
}

// src/obsidian/memoryNotes.ts
function generateMemoryNotes(db, maxQuoteLength = 300) {
  const rows = db.prepare(`SELECT * FROM memory_objects
    WHERE duplicate_of_id IS NULL AND status NOT IN ('superseded','rejected')
      AND (extraction_status IS NULL OR extraction_status NOT IN ('superseded','rejected'))
    ORDER BY id`).all();
  return rows.map((row) => {
    const pointers = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=? ORDER BY evidence_pointer_id").all(row.id);
    const legacy = db.prepare("SELECT span_id FROM memory_object_evidence WHERE memory_id=? ORDER BY span_id").all(row.id);
    const canonical = getCanonicalMemoryObject(row, [...legacy.map((x) => x.span_id)]);
    const conflicts = createConflictRepository(db).listConflictsForTarget("memory_object", row.id);
    const citations = pointers.map((pointer, index) => `${index + 1}. ${renderEvidenceCitation(db, pointer.evidence_pointer_id, maxQuoteLength).markdown}`).join("\n\n");
    const strongest = pointers.length ? db.prepare(`SELECT evidence_strength FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=?
      ORDER BY CASE evidence_strength WHEN 'strong' THEN 1 WHEN 'mixed' THEN 2 WHEN 'conflicting' THEN 3 WHEN 'weak' THEN 4 ELSE 5 END LIMIT 1`).get(row.id).evidence_strength : "unsupported";
    const warning = strongest === "weak" || strongest === "unknown" || !isStrongMemoryObject(canonical) ? "> [!caution] Weak or review-only evidence\n> This memory must not be treated as strong truth." : strongest === "conflicting" || conflicts.some((item) => item.status === "active") ? "> [!warning] Conflicting evidence\n> Both sides must be reviewed." : "";
    const title = canonical.title || canonical.body.slice(0, 80) || row.id;
    const conflictLinks = conflicts.map((item) => `- ${wikiLink(conflictPath(item.summary, item.id), item.summary)}`).join("\n") || "_None._";
    const content = `${frontmatter({ mv_entity_type: "memory", mv_entity_id: row.id, mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: strongest, mv_confidence: canonical.confidence })}
# ${title}

#tmv/memory

${generatedWarning}

${warning}

**Type:** ${canonical.type}  
**Status:** ${canonical.status}  
**Confidence:** ${canonical.confidence.toFixed(3)}  
**Evidence quality:** ${strongest}

## Generated Memory

> [!note] Generated text
> ${canonical.body.replace(/\n/g, "\n> ")}

## Source Evidence

${citations || "> [!danger] Unsupported memory\n> No evidence pointer resolves this generated object."}

## Conflicts / Tensions

${conflictLinks}`;
    return makeGeneratedFile("memory_note", memoryPath(title, row.id, String(canonical.type)), content, "memory", row.id);
  });
}

// src/obsidian/transcriptNotes.ts
var time = (ms) => ms == null ? "Unknown" : `${String(Math.floor(ms / 6e4)).padStart(2, "0")}:${String(Math.floor(ms % 6e4 / 1e3)).padStart(2, "0")}`;
function generateTranscriptNotes(db, maxQuoteLength = 1e4) {
  const transcripts = db.prepare("SELECT * FROM transcripts ORDER BY id").all();
  return transcripts.map((item) => {
    const spans = db.prepare("SELECT * FROM transcript_spans WHERE transcript_id=? ORDER BY ordinal,id").all(item.id);
    const sections = spans.map((span) => {
      const sourceUri = makeSourcePointerUri({ transcriptId: String(item.id), spanId: String(span.id) });
      const source = resolveSourcePointer(db, sourceUri);
      return `### Span ${span.id}

<span id="${span.id}"></span>

**Speaker:** ${span.speaker_label ?? "Unknown"}  
**Time:** ${time(span.start_time_ms)}-${time(span.end_time_ms)}  
**Source URI:** ${source.ok ? `\`${sourceUri}\`` : "_No validated source pointer for this span._"}

> [!quote] Immutable raw source text
${quote(String(span.text ?? span.text_preview), maxQuoteLength)}
`;
    }).join("\n");
    const evidenceLinks = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE transcript_id=? ORDER BY evidence_pointer_id").all(item.id).map(({ evidence_pointer_id }) => {
      const resolved = resolveEvidencePointer(db, evidence_pointer_id);
      return `- ${wikiLink(evidencePath(resolved.ok ? resolved.spanText : "Broken evidence", evidence_pointer_id), `Evidence ${evidence_pointer_id}`)}`;
    }).join("\n") || "_No source-backed evidence drawn from this transcript yet._";
    const content = `${frontmatter({ mv_entity_type: "transcript", mv_entity_id: String(item.id), mv_generated: true, mv_source_of_truth: "sqlite", mv_raw_hash: String(item.raw_sha256 ?? item.content_hash) })}
# ${item.title}

#tmv/transcript

${generatedWarning}

> [!important] Immutable source
> Transcript text and spans are rendered from immutable SQLite source records.

**Transcript ID:** \`${item.id}\`
**Source ID:** \`${item.source_id}\`
**Raw hash:** \`${item.raw_sha256 ?? item.content_hash}\`
**Imported:** ${item.imported_at}

## Source-Backed Evidence

${evidenceLinks}

## Transcript Spans

${sections || "_No spans found._"}`;
    return makeGeneratedFile("transcript_note", transcriptPath(String(item.title), String(item.id)), content, "transcript", String(item.id));
  });
}

// src/obsidian/vaultWriter.ts
var import_promises = require("node:fs/promises");
var import_node_path3 = require("node:path");
var safeTarget = (root, relativePath) => {
  if ((0, import_node_path3.isAbsolute)(relativePath) || relativePath.split(/[\\/]/).includes("..")) throw new Error(`Unsafe generated path: ${relativePath}`);
  const target = (0, import_node_path3.resolve)(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${import_node_path3.sep}`)) throw new Error(`Generated path escapes output root: ${relativePath}`);
  return target;
};
async function writeGeneratedVault(outputRoot, files, cleanBeforeWrite = false) {
  const root = (0, import_node_path3.resolve)(outputRoot), errors = [];
  await (0, import_promises.mkdir)(root, { recursive: true });
  for (const directory of ["Transcripts", "Memories/Facts", "Memories/Preferences", "Memories/Decisions", "Memories/Tasks", "Memories/Questions", "Memories/Other", "People", "Topics", "Decisions", "Evidence", "Answers", "Conflicts", "Graphs", "_system"]) {
    await (0, import_promises.mkdir)(safeTarget(root, directory), { recursive: true });
  }
  if (cleanBeforeWrite) {
    try {
      const old = JSON.parse(await (0, import_promises.readFile)(safeTarget(root, "_system/view-manifest.json"), "utf8"));
      for (const file of old.files ?? []) await (0, import_promises.rm)(safeTarget(root, file.relativePath), { force: true });
    } catch {
    }
  }
  let filesWritten = 0, filesSkipped = 0;
  for (const file of files) {
    try {
      const target = safeTarget(root, file.relativePath);
      await (0, import_promises.mkdir)((0, import_node_path3.dirname)(target), { recursive: true });
      try {
        if (await (0, import_promises.readFile)(target, "utf8") === file.content) {
          filesSkipped++;
          continue;
        }
      } catch {
      }
      await (0, import_promises.writeFile)(target, file.content, "utf8");
      filesWritten++;
    } catch (error) {
      errors.push(`${file.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { filesWritten, filesSkipped, errors };
}

// src/obsidian/generateVault.ts
var defaults = {
  includeTranscriptNotes: true,
  includeMemoryNotes: true,
  includeEntityNotes: true,
  includeAnswerNotes: true,
  includeConflictNotes: true,
  includeEvidenceNotes: true,
  includeGraphJson: true,
  includeGraphMarkdown: true,
  maxQuoteLength: 300
};
async function generateObsidianVault(db, config) {
  const options = { ...defaults, ...config }, outputRoot = (0, import_node_path4.resolve)(config.outputRoot), files = [generateHomeNote(db)], warnings = [];
  if (options.includeTranscriptNotes) files.push(...generateTranscriptNotes(db));
  if (options.includeMemoryNotes) files.push(...generateMemoryNotes(db, options.maxQuoteLength));
  if (options.includeEntityNotes) files.push(...generateEntityNotes(db));
  if (options.includeAnswerNotes) files.push(...generateAnswerNotes(db, options.maxQuoteLength));
  if (options.includeConflictNotes) files.push(...generateConflictNotes(db, options.maxQuoteLength));
  if (options.includeEvidenceNotes) {
    const evidence = generateEvidenceNotes(db, options.maxQuoteLength);
    files.push(...evidence.files);
    warnings.push(...evidence.warnings);
  }
  const built = buildObsidianGraph(db);
  warnings.push(...built.warnings);
  const graphs = [
    ["Topic Graph", "topic-graph.json", buildTopicGraph(built.graph)],
    ["People Graph", "people-graph.json", buildPeopleGraph(built.graph)],
    ["Decision Graph", "decision-graph.json", buildDecisionGraph(built.graph)],
    ["Source Evidence Graph", "source-evidence-graph.json", buildSourceEvidenceGraph(built.graph)]
  ];
  if (options.includeGraphJson) {
    files.push(makeGraphJsonFile("Graphs/graph-data.json", built.graph));
    graphs.forEach(([, path, graph]) => files.push(makeGraphJsonFile(`Graphs/${path}`, graph)));
  }
  const broken = warnings.filter((warning) => warning.startsWith("Broken evidence pointer")).length;
  if (options.includeGraphMarkdown) graphs.forEach(([title, path, graph]) => files.push(makeGraphMarkdownFile(title, `Graphs/${title}.md`, `Graphs/${path}`, graph, broken)));
  files.push(makeGeneratedFile("system_manifest", "_system/generation-log.md", `---
tags: [tmv/system]
---
# Generation Log

#tmv/system

This deterministic generated view contains ${files.length + 3} files, ${built.graph.nodes.length} graph nodes, and ${built.graph.edges.length} graph edges.

SQLite remains the source of truth. Generated Markdown is disposable and is never read back into SQLite.`));
  files.push(makeGeneratedFile("system_manifest", "_system/graph-guide.md", `---
tags: [tmv/system]
---
# Transcript Memory Vault \u2014 Graph Guide

#tmv/system

> [!warning] Generated view
> SQLite is the source of truth. These Markdown notes are a disposable view layer for Obsidian's native graph and are never read back into SQLite.

## How to read the graph

- **Global graph** \u2014 overview of the whole memory network.
- **Local graph** (open on a Memory, Evidence, or Answer note) \u2014 the provenance chain: Transcript -> Evidence -> Memory -> Answer / Conflict.

## Tags (for graph filters)

Every generated note carries one tag so you can filter the graph:

- #tmv/transcript \u2014 raw transcript notes
- #tmv/evidence \u2014 evidence pointers (scored, provenance-backed)
- #tmv/memory \u2014 canonical memory objects
- #tmv/answer \u2014 Ask AI answers
- #tmv/conflict \u2014 conflicts / tensions
- #tmv/person, #tmv/topic \u2014 entities
- #tmv/system \u2014 index/navigation notes (this guide, 00 Home, graph summaries); usually filter these OUT

## Recommended graph filters (Obsidian filter box)

- Hide system hubs: \`-tag:#tmv/system\`
- Source graph: \`tag:#tmv/transcript OR tag:#tmv/evidence\`
- Memory graph: \`tag:#tmv/evidence OR tag:#tmv/memory\`
- Answer graph: \`tag:#tmv/answer OR tag:#tmv/evidence\`
- Conflict graph: \`tag:#tmv/conflict OR tag:#tmv/memory\`
- People / topics: \`tag:#tmv/person OR tag:#tmv/topic OR tag:#tmv/memory\`

If your Obsidian version does not support \`OR\` in the graph filter, filter one tag at a time (e.g. \`tag:#tmv/memory\`).`));
  const duplicates = files.map((file) => file.relativePath).filter((path, index, all) => all.indexOf(path) !== index);
  if (duplicates.length) throw new Error(`Generated path collision: ${[...new Set(duplicates)].join(", ")}`);
  const { manifest, file: manifestFile } = buildManifest(files, built.graph, warnings);
  files.push(manifestFile);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const written = await writeGeneratedVault(outputRoot, files, options.cleanBeforeWrite);
  const createdAt = (options.now?.() ?? /* @__PURE__ */ new Date()).toISOString(), runId = createId("ovr_");
  db.transaction(() => {
    db.prepare(`INSERT INTO obsidian_view_runs(id,created_at,output_root,file_count,graph_node_count,graph_edge_count,content_hash,status,error_message)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(runId, createdAt, outputRoot, files.length, built.graph.nodes.length, built.graph.edges.length, manifest.contentHash, written.errors.length ? "failed" : "completed", written.errors.join("\n") || null);
    const insert = db.prepare(`INSERT INTO obsidian_generated_files(id,view_run_id,logical_type,entity_type,entity_id,relative_path,content_hash,created_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    files.forEach((generated) => insert.run(createId("ovf_"), runId, generated.logicalType, generated.entityType ?? null, generated.entityId ?? null, generated.relativePath, generated.contentHash, createdAt));
  })();
  return { outputRoot, filesWritten: written.filesWritten, filesSkipped: written.filesSkipped, graphNodeCount: built.graph.nodes.length, graphEdgeCount: built.graph.edges.length, warnings, errors: written.errors, manifestPath: (0, import_node_path4.resolve)(outputRoot, "_system/view-manifest.json"), contentHash: manifest.contentHash, files };
}

// src/obsidian/nativeBindings.ts
var import_node_fs2 = require("node:fs");
var import_node_path5 = require("node:path");
var nativeBindingTarget = (runtime) => `${runtime.platform}-${runtime.arch}-abi${runtime.modules ?? "unknown"}`;
function currentNativeRuntime() {
  return {
    platform: process.platform,
    arch: process.arch,
    modules: process.versions.modules,
    electron: process.versions.electron
  };
}
function listPackagedNativeTargets(pluginDirectory) {
  const nativeDirectory = (0, import_node_path5.join)(pluginDirectory, "native");
  try {
    return (0, import_node_fs2.readdirSync)(nativeDirectory, { withFileTypes: true }).filter((entry) => entry.isDirectory() && (0, import_node_fs2.existsSync)((0, import_node_path5.join)(nativeDirectory, entry.name, "better_sqlite3.node"))).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}
function resolveNativeBinding(pluginDirectory, runtime = currentNativeRuntime()) {
  const target = nativeBindingTarget(runtime);
  const packagedTargets = listPackagedNativeTargets(pluginDirectory);
  const bindingPath = (0, import_node_path5.join)(pluginDirectory, "native", target, "better_sqlite3.node");
  if ((0, import_node_fs2.existsSync)(bindingPath)) return { ok: true, target, bindingPath, packagedTargets, error: null };
  const electron = runtime.electron ? ` Electron ${runtime.electron}` : "";
  return {
    ok: false,
    target,
    bindingPath: null,
    packagedTargets,
    error: `SQLite native binding unavailable for ${target}.${electron} Packaged targets: ${packagedTargets.join(", ") || "none"}.`
  };
}
function nativeBindingLoadError(resolution, error) {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`SQLite native binding ${resolution.target} is unavailable or incompatible: ${detail}`);
}

// src/obsidian/SettingsTab.ts
var import_obsidian = require("obsidian");

// src/obsidian/settings.ts
var LLM_PROVIDER_OPTIONS = ["none", "openai"];
var EMBEDDING_PROVIDER_OPTIONS = ["deterministic-test", "noop", "openai"];
var EXTERNAL_LLM_PROVIDERS = ["openai"];
var isExternalLlmProvider = (providerId) => EXTERNAL_LLM_PROVIDERS.includes(providerId);
var EXTERNAL_EMBEDDING_PROVIDERS = ["openai"];
var isExternalEmbeddingProvider = (providerId) => EXTERNAL_EMBEDDING_PROVIDERS.includes(providerId);
function isLlmConfigured(settings) {
  return settings.mode === "external" && isExternalLlmProvider(settings.llm.provider) && settings.llm.model.trim().length > 0 && (settings.apiKeys[settings.llm.provider]?.trim().length ?? 0) > 0;
}
var DEFAULT_SETTINGS = {
  schemaVersion: 1,
  mode: "local",
  llm: { provider: "none", model: "" },
  embedding: { provider: "deterministic-test", model: "token-hash-v1" },
  apiKeys: {}
};
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var asString = (value, fallback) => typeof value === "string" ? value : fallback;
var normalizeMode = (value) => value === "external" ? "external" : "local";
var positiveInt = (value) => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : void 0;
};
var positiveNumber = (value) => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : void 0;
};
var normalizeBaseUrl = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : void 0;
var normalizeLlmSelection = (value, fallback) => {
  const record = isRecord(value) ? value : {};
  const result = {
    provider: asString(record.provider, fallback.provider),
    model: asString(record.model, fallback.model)
  };
  const baseUrl = normalizeBaseUrl(record.baseUrl);
  if (baseUrl !== void 0) result.baseUrl = baseUrl;
  const timeoutMs = positiveNumber(record.timeoutMs);
  if (timeoutMs !== void 0) result.timeoutMs = timeoutMs;
  return result;
};
var normalizeEmbeddingSelection = (value, fallback) => {
  const record = isRecord(value) ? value : {};
  const result = {
    provider: asString(record.provider, fallback.provider),
    model: asString(record.model, fallback.model)
  };
  const dimensions = positiveInt(record.dimensions);
  if (dimensions !== void 0) result.dimensions = dimensions;
  const baseUrl = normalizeBaseUrl(record.baseUrl);
  if (baseUrl !== void 0) result.baseUrl = baseUrl;
  const timeoutMs = positiveNumber(record.timeoutMs);
  if (timeoutMs !== void 0) result.timeoutMs = timeoutMs;
  return result;
};
var normalizeApiKeys = (value) => {
  if (!isRecord(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && raw.trim().length > 0) result[key] = raw;
  }
  return result;
};
function normalizeSettings(raw) {
  const record = isRecord(raw) ? raw : {};
  return {
    schemaVersion: 1,
    mode: normalizeMode(record.mode),
    llm: normalizeLlmSelection(record.llm, DEFAULT_SETTINGS.llm),
    embedding: normalizeEmbeddingSelection(record.embedding, DEFAULT_SETTINGS.embedding),
    apiKeys: normalizeApiKeys(record.apiKeys)
  };
}
function setApiKey(settings, providerId, key) {
  const apiKeys = { ...settings.apiKeys };
  const trimmed = key.trim();
  if (trimmed) apiKeys[providerId] = trimmed;
  else delete apiKeys[providerId];
  return { ...settings, apiKeys };
}
function redactApiKey(key) {
  return key && key.trim().length > 0 ? "configured" : "not set";
}
function settingsHealthSummary(settings) {
  return {
    providerMode: settings.mode,
    llmProvider: settings.llm.provider,
    llmModel: settings.llm.model,
    embeddingProvider: settings.embedding.provider,
    embeddingModel: settings.embedding.model,
    apiKeyConfigured: Object.values(settings.apiKeys).some((value) => value.trim().length > 0),
    llmReady: isLlmConfigured(settings)
  };
}

// src/obsidian/SettingsTab.ts
var TranscriptMemorySettingsTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin, getHealth, navigation, getSettings, onSave) {
    super(app, plugin);
    this.getHealth = getHealth;
    this.navigation = navigation;
    this.getSettings = getSettings;
    this.onSave = onSave;
  }
  getHealth;
  navigation;
  getSettings;
  onSave;
  display() {
    const health = this.getHealth();
    const settings = this.getSettings();
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Transcript Memory Vault" });
    this.containerEl.createEl("h3", { text: "AI providers" });
    const warning = this.containerEl.createEl("p", {
      text: `API keys are stored in this plugin's local data file (data.json) as plain text. If your vault is synced, the key may sync with it. Run the "Rebuild Embedding Index" command to (re)build the index with the configured provider \u2014 that command is the only action that may make a network call.`
    });
    warning.addClass("setting-item-description");
    const required = this.containerEl.createEl("p", {
      text: isLlmConfigured(settings) ? `AI is configured: ${settings.llm.provider} / ${settings.llm.model}. Ask AI and AI memory extraction are enabled.` : "AI is NOT configured. Ask AI and AI memory extraction require an external LLM provider, model, and API key. Configure one below to enable AI features."
    });
    required.addClass("setting-item-description");
    new import_obsidian.Setting(this.containerEl).setName("LLM provider").setDesc('Required. Ask AI and AI memory extraction use this external provider. Select "none" to disable AI features.').addDropdown((dropdown) => {
      for (const option of LLM_PROVIDER_OPTIONS) dropdown.addOption(option, option);
      dropdown.setValue(settings.llm.provider).onChange(async (value) => {
        const mode = value !== "none" ? "external" : "local";
        await this.onSave({ ...this.getSettings(), mode, llm: { ...this.getSettings().llm, provider: value } });
        this.display();
      });
    });
    new import_obsidian.Setting(this.containerEl).setName("LLM model").setDesc("Model identifier. Required for an external provider.").addText(
      (text) => text.setPlaceholder("e.g. gpt-4o-mini").setValue(settings.llm.model).onChange(async (value) => {
        await this.onSave({ ...this.getSettings(), llm: { ...this.getSettings().llm, model: value } });
      })
    );
    new import_obsidian.Setting(this.containerEl).setName("LLM base URL").setDesc("Optional. Override the OpenAI-compatible endpoint for the external LLM provider.").addText(
      (text) => text.setPlaceholder("https://api.openai.com/v1").setValue(settings.llm.baseUrl ?? "").onChange(async (value) => {
        const baseUrl = value.trim().length > 0 ? value.trim() : void 0;
        await this.onSave({ ...this.getSettings(), llm: { ...this.getSettings().llm, baseUrl } });
      })
    );
    new import_obsidian.Setting(this.containerEl).setName("LLM request timeout (ms)").setDesc("Optional. Applied to the external LLM provider; the local provider ignores it.").addText(
      (text) => text.setPlaceholder("e.g. 30000").setValue(settings.llm.timeoutMs != null ? String(settings.llm.timeoutMs) : "").onChange(async (value) => {
        const parsed = Number(value.trim());
        const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : void 0;
        await this.onSave({ ...this.getSettings(), llm: { ...this.getSettings().llm, timeoutMs } });
      })
    );
    new import_obsidian.Setting(this.containerEl).setName("Embedding provider").setDesc("For future semantic retrieval. The deterministic test provider is the default.").addDropdown((dropdown) => {
      for (const option of EMBEDDING_PROVIDER_OPTIONS) dropdown.addOption(option, option);
      dropdown.setValue(settings.embedding.provider).onChange(async (value) => {
        await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, provider: value } });
        this.display();
      });
    });
    new import_obsidian.Setting(this.containerEl).setName("Embedding model").setDesc("Model identifier placeholder.").addText(
      (text) => text.setPlaceholder("token-hash-v1").setValue(settings.embedding.model).onChange(async (value) => {
        await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, model: value } });
      })
    );
    const embeddingProviderId = settings.embedding.provider;
    const embeddingIsExternal = isExternalEmbeddingProvider(embeddingProviderId);
    new import_obsidian.Setting(this.containerEl).setName("Embedding dimensions").setDesc("Required for an external embedding provider: the vector length the model returns.").addText(
      (text) => text.setPlaceholder("e.g. 1536").setValue(settings.embedding.dimensions != null ? String(settings.embedding.dimensions) : "").onChange(async (value) => {
        const parsed = Number(value.trim());
        const dimensions = Number.isInteger(parsed) && parsed > 0 ? parsed : void 0;
        await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, dimensions } });
      })
    );
    new import_obsidian.Setting(this.containerEl).setName("Embedding base URL").setDesc("Optional. Override the OpenAI-compatible endpoint for the external embedding provider.").addText(
      (text) => text.setPlaceholder("https://api.openai.com/v1").setValue(settings.embedding.baseUrl ?? "").onChange(async (value) => {
        const baseUrl = value.trim().length > 0 ? value.trim() : void 0;
        await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, baseUrl } });
      })
    );
    new import_obsidian.Setting(this.containerEl).setName("Embedding request timeout (ms)").setDesc("Optional. Applied only to the external embedding HTTP transport.").addText(
      (text) => text.setPlaceholder("e.g. 30000").setValue(settings.embedding.timeoutMs != null ? String(settings.embedding.timeoutMs) : "").onChange(async (value) => {
        const parsed = Number(value.trim());
        const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : void 0;
        await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, timeoutMs } });
      })
    );
    new import_obsidian.Setting(this.containerEl).setName("Embedding API key").setDesc(
      embeddingIsExternal ? `Stored for "${embeddingProviderId}": ${redactApiKey(settings.apiKeys[embeddingProviderId])}. Type a new key to replace it; leave blank to keep the existing one.` : "The selected embedding provider runs locally and needs no API key."
    ).addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("Enter API key").onChange(async (value) => {
        if (!embeddingIsExternal) return;
        const trimmed = value.trim();
        if (!trimmed) return;
        await this.onSave(setApiKey(this.getSettings(), embeddingProviderId, trimmed));
      });
    }).addButton(
      (button) => button.setButtonText("Clear").onClick(async () => {
        if (!embeddingIsExternal) return;
        await this.onSave(setApiKey(this.getSettings(), embeddingProviderId, ""));
        this.display();
      })
    );
    const llmProviderId = settings.llm.provider;
    const llmKeyStatus = redactApiKey(settings.apiKeys[llmProviderId]);
    new import_obsidian.Setting(this.containerEl).setName("LLM API key").setDesc(
      llmProviderId === "none" ? "Select an LLM provider to set its API key." : `Stored for "${llmProviderId}": ${llmKeyStatus}. Type a new key to replace it; leave blank to keep the existing one.`
    ).addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("Enter API key").onChange(async (value) => {
        if (llmProviderId === "none") return;
        const trimmed = value.trim();
        if (!trimmed) return;
        await this.onSave(setApiKey(this.getSettings(), llmProviderId, trimmed));
      });
    }).addButton(
      (button) => button.setButtonText("Clear").onClick(async () => {
        if (llmProviderId === "none") return;
        await this.onSave(setApiKey(this.getSettings(), llmProviderId, ""));
        this.display();
      })
    );
    this.containerEl.createEl("h3", { text: "Status" });
    new import_obsidian.Setting(this.containerEl).setName("Plugin status").setDesc(health.status);
    new import_obsidian.Setting(this.containerEl).setName("API key").setDesc(health.apiKeyConfigured ? "configured" : "not configured");
    new import_obsidian.Setting(this.containerEl).setName("AI (LLM)").setDesc(
      isLlmConfigured(settings) ? `Configured: ${settings.llm.provider}${settings.llm.model ? ` / ${settings.llm.model}` : ""} (external).` : "Not configured. Ask AI and AI memory extraction are disabled until you set an LLM provider, model, and API key."
    );
    new import_obsidian.Setting(this.containerEl).setName("Embedding index").setDesc(
      health.reindexNeeded === void 0 ? "Status unavailable until the database is ready." : health.reindexNeeded ? `Reindex needed \u2014 run the "Rebuild Embedding Index" command. ${health.reindexSummary ?? ""}`.trim() : `Up to date. ${health.reindexSummary ?? ""}`.trim()
    );
    if (health.embeddingUsedFallback) {
      new import_obsidian.Setting(this.containerEl).setName("Embedding fallback").setDesc("The configured external embedding provider is not fully set up; using local token-hash-v1.");
    }
    new import_obsidian.Setting(this.containerEl).setName("Database location").setDesc(health.databasePath ?? "Unavailable");
    new import_obsidian.Setting(this.containerEl).setName("SQLite storage").setDesc(health.realSqliteStorage ? "Connected to real local SQLite storage" : "Not connected");
    new import_obsidian.Setting(this.containerEl).setName("Migration status").setDesc(`${health.migrationStatus}: ${health.appliedMigrationCount}/${health.packagedMigrationCount} applied`);
    new import_obsidian.Setting(this.containerEl).setName("Last initialization error").setDesc(health.lastInitializationError ?? "None");
    new import_obsidian.Setting(this.containerEl).setName("Native binding target").setDesc(health.nativeBindingTarget ?? "Unresolved");
    new import_obsidian.Setting(this.containerEl).setName("Packaged native targets").setDesc(health.packagedNativeTargets.join(", ") || "None");
    new import_obsidian.Setting(this.containerEl).setName("Dashboard").addButton((button) => button.setButtonText("Open dashboard").onClick(() => void this.navigation.openDashboard()));
  }
};

// src/obsidian/TranscriptMemoryItemView.ts
var import_obsidian2 = require("obsidian");
var TranscriptMemoryItemView = class extends import_obsidian2.ItemView {
  constructor(leaf, type, getApi, vaultNavigation, registry) {
    super(leaf);
    this.type = type;
    this.getApi = getApi;
    this.vaultNavigation = vaultNavigation;
    this.registry = registry;
  }
  type;
  getApi;
  vaultNavigation;
  registry;
  state = {};
  getViewType() {
    return this.type;
  }
  getDisplayText() {
    return viewTitle(this.type);
  }
  getIcon() {
    return "database";
  }
  getState() {
    return this.state;
  }
  async setState(state) {
    this.state = state;
    await this.render();
  }
  async onOpen() {
    this.registry.register(this);
    await this.render();
  }
  async onClose() {
    this.registry.unregister(this);
    this.contentEl.empty();
  }
  /** Re-fetch and re-render this view's current route. Invoked by the registry after a mutation elsewhere. */
  async refresh() {
    await this.render();
  }
  async render() {
    this.contentEl.empty();
    this.contentEl.addClass("transcript-memory-vault-host");
    try {
      await mountObsidianUi(this.contentEl, this.getApi(), this.vaultNavigation, this.state.target ?? defaultTarget(this.type), () => this.registry.notifyMutation(this));
    } catch (error) {
      console.error("Transcript Memory Vault view load failed", error);
      this.contentEl.empty();
      this.contentEl.createEl("h2", { text: "Transcript Memory Vault could not load this view" });
      this.contentEl.createEl("p", { text: error instanceof Error ? error.message : String(error) });
      this.contentEl.createEl("p", { text: "The plugin did not continue as if the database were trustworthy. Open the dashboard or plugin settings for database health details." });
    }
  }
};

// src/obsidian/services/ObsidianAppApi.ts
function createObsidianAppApi(db, vault, health, getSynthesis, getMemoryExtractor, options) {
  const api = createSqliteFrontendApi(db, { health, getSynthesis, getMemoryExtractor, llmRequired: options?.llmRequired, getLlmReady: options?.getLlmReady, syncGeneratedViews: options?.syncGeneratedViews });
  return {
    ...api,
    async uploadVaultFile(file) {
      const rawText = await vault.read(file);
      validateTranscriptUpload({ filename: file.name, rawText });
      return api.uploadTranscript({ filename: file.name, rawText });
    }
  };
}

// src/obsidian/startup.ts
var DESKTOP_ONLY_MESSAGE = "Transcript Memory Vault is desktop-only right now because it uses local SQLite storage.";
var initialPluginHealth = () => ({
  status: "initializing",
  databaseConnected: false,
  migrationStatus: "pending",
  packagedMigrationCount: PACKAGED_MIGRATION_COUNT,
  appliedMigrationCount: 0,
  databasePath: null,
  realSqliteStorage: false,
  firstRun: false,
  lastInitializationError: null,
  nativeBindingTarget: null,
  packagedNativeTargets: [],
  ...settingsHealthSummary(DEFAULT_SETTINGS)
});
function startupSupport(input) {
  return input.isDesktopApp && input.hasLocalFilesystem ? { supported: true } : { supported: false, message: DESKTOP_ONLY_MESSAGE };
}
var unavailable = (health) => {
  throw new Error(health.lastInitializationError ?? DESKTOP_ONLY_MESSAGE);
};
function createUnavailableFrontendApi(getHealth) {
  return {
    async getDashboard() {
      return {
        totalTranscriptCount: 0,
        transcripts: [],
        recentAnswers: [],
        reviewCount: 0,
        weakCount: 0,
        conflictCount: 0,
        brokenCount: 0,
        health: getHealth()
      };
    },
    async listTranscripts() {
      return [];
    },
    async uploadTranscript() {
      return unavailable(getHealth());
    },
    async getTranscript() {
      return unavailable(getHealth());
    },
    async ask() {
      return unavailable(getHealth());
    },
    async askAI() {
      return unavailable(getHealth());
    },
    async getAnswer() {
      return unavailable(getHealth());
    },
    async getEvidence() {
      return unavailable(getHealth());
    },
    async getMemory() {
      return unavailable(getHealth());
    },
    async getMemoryObject() {
      return unavailable(getHealth());
    },
    async getGraph() {
      return unavailable(getHealth());
    },
    async search() {
      return unavailable(getHealth());
    },
    async searchVault() {
      return unavailable(getHealth());
    },
    async listReviewItems() {
      return unavailable(getHealth());
    },
    async getReviewItem() {
      return unavailable(getHealth());
    },
    async submitCorrection() {
      return unavailable(getHealth());
    },
    async reviewMemoryObject() {
      return unavailable(getHealth());
    },
    async getLlmStatus() {
      return { required: true, ready: Boolean(getHealth().llmReady) };
    },
    async runExtraction() {
      return unavailable(getHealth());
    }
  };
}
function readableStartupError(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/obsidian/embeddingSettings.ts
function externalEmbeddingConfigFromSettings(settings) {
  if (settings.mode !== "external") return null;
  const { provider, model, dimensions, baseUrl, timeoutMs } = settings.embedding;
  if (!isExternalEmbeddingProvider(provider)) return null;
  const apiKey = settings.apiKeys[provider];
  if (!apiKey || !apiKey.trim()) return null;
  if (typeof dimensions !== "number" || !Number.isInteger(dimensions) || dimensions <= 0) return null;
  const config = { provider, model, dimensions, apiKey: apiKey.trim() };
  if (baseUrl) config.baseUrl = baseUrl;
  if (typeof timeoutMs === "number" && timeoutMs > 0) config.timeoutMs = timeoutMs;
  return config;
}
var summarizeResolution = (resolution) => ({
  requestedId: resolution.requestedId,
  model: resolution.provider.model,
  usedFallback: resolution.usedFallback,
  reason: resolution.reason
});
function resolveEmbeddingProviderFromSettings(settings, options = {}) {
  const external = externalEmbeddingConfigFromSettings(settings);
  if (external) {
    const config = options.transport ? { ...external, transport: options.transport } : external;
    return resolveEmbeddingProvider(void 0, { external: config });
  }
  if (settings.mode === "external" && isExternalEmbeddingProvider(settings.embedding.provider)) {
    const fallback = resolveEmbeddingProvider();
    return {
      ...fallback,
      requestedId: settings.embedding.provider,
      usedFallback: true,
      reason: `External embedding provider "${settings.embedding.provider}" is not fully configured (needs a non-blank API key and positive dimensions); using local ${TOKEN_HASH_MODEL}.`
    };
  }
  return resolveEmbeddingProvider(settings.embedding.provider, { dimensions: settings.embedding.dimensions });
}
function embeddingReindexStatus(db, settings) {
  const resolution = resolveEmbeddingProviderFromSettings(settings);
  const assessment = detectReindexNeeded(db, resolution.provider);
  return { summary: summarizeResolution(resolution), assessment };
}
async function runEmbeddingReindex(db, settings, options = {}) {
  const resolution = resolveEmbeddingProviderFromSettings(settings, options);
  const result = await rebuildRetrievalIndex(db, { embeddingProvider: resolution.provider });
  const assessment = detectReindexNeeded(db, resolution.provider);
  return { summary: summarizeResolution(resolution), result, assessment };
}

// src/obsidian/embeddingTransport.ts
var import_obsidian3 = require("obsidian");
function createObsidianEmbeddingTransport() {
  return async (request) => {
    const response = await (0, import_obsidian3.requestUrl)({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body,
      throw: false
    });
    let body = null;
    try {
      body = response.json;
    } catch {
      body = response.text ?? null;
    }
    return { status: response.status, body };
  };
}

// src/llm/errors.ts
var LlmError = class extends Error {
  context;
  constructor(message, context, options) {
    super(message, options);
    this.name = new.target.name;
    this.context = context;
  }
};
var LlmTimeoutError = class extends LlmError {
};
var LlmCancelledError = class extends LlmError {
};
var LlmAuthError = class extends LlmError {
};
var LlmRateLimitError = class extends LlmError {
};
var LlmProviderError = class extends LlmError {
};
var LlmResponseFormatError = class extends LlmError {
};

// src/llm/redaction.ts
var REDACTED2 = "[redacted]";
function redactSecret2(text, secret) {
  if (!secret || !secret.trim()) return text;
  return text.split(secret).join(REDACTED2);
}

// src/llm/timeout.ts
async function runWithTimeout(operation, options = {}) {
  const context = { provider: options.provider, model: options.model };
  if (options.signal?.aborted) throw new LlmCancelledError("LLM request was cancelled", context);
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  let timedOut = false;
  let timer;
  const timeout = options.timeoutMs != null ? new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new LlmTimeoutError(`LLM request timed out after ${options.timeoutMs}ms`, context));
    }, options.timeoutMs);
  }) : null;
  try {
    return await (timeout ? Promise.race([operation(controller.signal), timeout]) : operation(controller.signal));
  } catch (error) {
    if (timedOut) throw error instanceof LlmTimeoutError ? error : new LlmTimeoutError(`LLM request timed out after ${options.timeoutMs}ms`, context);
    if (options.signal?.aborted) throw new LlmCancelledError("LLM request was cancelled", context);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

// src/llm/externalLlmProvider.ts
var DEFAULT_BASE_URL2 = "https://api.openai.com/v1";
function createHttpLlmTransport(fetchImpl = globalThis.fetch) {
  return async (request) => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      try {
        body = await response.text();
      } catch {
        body = null;
      }
    }
    return { status: response.status, body };
  };
}
var asTokenCount = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
var ExternalLlmProvider = class {
  id;
  model;
  isLocal = false;
  #apiKey;
  #baseUrl;
  #transport;
  #timeoutMs;
  constructor(config) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new LlmAuthError("External LLM provider requires a non-blank API key", { provider: config.id, model: config.model });
    }
    this.id = config.id;
    this.model = config.model;
    this.#apiKey = config.apiKey.trim();
    this.#baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL2).replace(/\/+$/, "");
    this.#transport = config.transport ?? createHttpLlmTransport();
    this.#timeoutMs = config.timeoutMs;
  }
  async complete(request, options) {
    const messages = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.prompt });
    const payload = { model: this.model, messages };
    if (request.maxOutputTokens != null) payload.max_tokens = request.maxOutputTokens;
    if (request.responseFormat === "json") payload.response_format = { type: "json_object" };
    const body = JSON.stringify(payload);
    let response;
    try {
      response = await runWithTimeout(
        (signal) => this.#transport({
          url: `${this.#baseUrl}/chat/completions`,
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.#apiKey}` },
          body,
          signal
        }),
        { timeoutMs: options?.timeoutMs ?? this.#timeoutMs, signal: options?.signal, provider: this.id, model: this.model }
      );
    } catch (error) {
      if (error instanceof LlmError) throw error;
      const detail = redactSecret2(error instanceof Error ? error.message : String(error), this.#apiKey);
      throw new LlmProviderError(`LLM request failed: ${detail}`, { provider: this.id, model: this.model });
    }
    if (response.status === 401 || response.status === 403) {
      throw new LlmAuthError("LLM provider rejected the API key", { provider: this.id, model: this.model });
    }
    if (response.status === 429) {
      throw new LlmRateLimitError("LLM provider rate limit exceeded", { provider: this.id, model: this.model });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new LlmProviderError(`LLM provider returned status ${response.status}`, { provider: this.id, model: this.model });
    }
    const choice = response.body?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string") {
      throw new LlmResponseFormatError("LLM response did not contain a text completion", { provider: this.id, model: this.model });
    }
    const finishReason = choice?.finish_reason === "length" ? "length" : "stop";
    const usageRaw = response.body.usage;
    const inputTokens = asTokenCount(usageRaw?.prompt_tokens);
    const outputTokens = asTokenCount(usageRaw?.completion_tokens);
    const usage = inputTokens !== void 0 || outputTokens !== void 0 ? { inputTokens, outputTokens } : void 0;
    return { provider: this.id, model: this.model, text: content, finishReason, usage };
  }
};

// src/obsidian/llmSettings.ts
function externalLlmConfigFromSettings(settings) {
  if (settings.mode !== "external") return null;
  const { provider, model, baseUrl, timeoutMs } = settings.llm;
  if (!isExternalLlmProvider(provider)) return null;
  if (!model || !model.trim()) return null;
  const apiKey = settings.apiKeys[provider];
  if (!apiKey || !apiKey.trim()) return null;
  const config = { id: provider, model: model.trim(), apiKey: apiKey.trim() };
  if (baseUrl) config.baseUrl = baseUrl;
  if (typeof timeoutMs === "number" && timeoutMs > 0) config.timeoutMs = timeoutMs;
  return config;
}
function externalProviderFromSettings(settings, options) {
  const external = externalLlmConfigFromSettings(settings);
  if (!external) return null;
  return new ExternalLlmProvider(options.transport ? { ...external, transport: options.transport } : external);
}
function askAiSynthesisFromSettings(settings, options = {}) {
  const provider = externalProviderFromSettings(settings, options);
  if (!provider) return void 0;
  return {
    llm: createLlmAskAILanguageModel(provider),
    info: { mode: "external_llm", provider: provider.id, model: provider.model, usedFallback: false }
  };
}
function memoryExtractorFromSettings(settings, options = {}) {
  const provider = externalProviderFromSettings(settings, options);
  if (!provider) return void 0;
  return createLlmMemoryExtractor(provider);
}

// src/obsidian/llmTransport.ts
var import_obsidian4 = require("obsidian");
function createObsidianLlmTransport() {
  return async (request) => {
    const response = await (0, import_obsidian4.requestUrl)({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body,
      throw: false
    });
    let body = null;
    try {
      body = response.json;
    } catch {
      body = response.text ?? null;
    }
    return { status: response.status, body };
  };
}

// src/obsidian/viewRefreshRegistry.ts
var ViewRefreshRegistry = class {
  views = /* @__PURE__ */ new Set();
  register(view) {
    this.views.add(view);
  }
  unregister(view) {
    this.views.delete(view);
  }
  size() {
    return this.views.size;
  }
  /** Refresh every registered view except `origin`. Never throws; logs and continues per view. */
  async notifyMutation(origin) {
    for (const view of [...this.views]) {
      if (view === origin) continue;
      try {
        await view.refresh();
      } catch (error) {
        console.error("Transcript Memory Vault view refresh failed", error);
      }
    }
  }
};

// src/obsidian/Plugin.ts
var TranscriptMemoryVaultPlugin = class extends import_obsidian5.Plugin {
  db = null;
  // Absolute on-disk vault root (desktop only); the generated Markdown view layer is written under it.
  vaultBasePath = null;
  pluginSettings = DEFAULT_SETTINGS;
  health = initialPluginHealth();
  api = createUnavailableFrontendApi(() => this.health);
  // Built once; reused. The transport makes no call until the synthesis adapter actually runs.
  llmTransport = createObsidianLlmTransport();
  // Tracks open plugin views so a mutating action in one refreshes the others (cross-view invalidation).
  viewRegistry = new ViewRefreshRegistry();
  async onload() {
    await this.loadSettings();
    const navigation = createObsidianNavigation(this.app);
    for (const type of Object.values(OBSIDIAN_VIEW_TYPES)) {
      this.registerView(type, (leaf) => new TranscriptMemoryItemView(leaf, type, () => this.api, navigation, this.viewRegistry));
    }
    for (const command of OBSIDIAN_COMMANDS) {
      this.addCommand({ id: command.id, name: command.name, callback: () => void navigationForView(navigation, command.viewType) });
    }
    this.addCommand({ id: OBSIDIAN_REINDEX_COMMAND.id, name: OBSIDIAN_REINDEX_COMMAND.name, callback: () => void this.rebuildEmbeddingIndex() });
    this.addCommand({ id: "run-ai-extraction", name: "Run AI extraction for transcripts missing it", callback: () => void this.runPendingExtraction() });
    this.addCommand({ id: OBSIDIAN_SYNC_GRAPH_COMMAND.id, name: OBSIDIAN_SYNC_GRAPH_COMMAND.name, callback: () => void this.syncGeneratedGraphNotesCommand() });
    this.addCommand({ id: OBSIDIAN_DEDUPE_COMMAND.id, name: OBSIDIAN_DEDUPE_COMMAND.name, callback: () => void this.mergeDuplicateMemoriesCommand() });
    this.addRibbonIcon(OBSIDIAN_RIBBON.icon, OBSIDIAN_RIBBON.title, () => void navigation.openDashboard());
    this.registerObsidianProtocolHandler(OBSIDIAN_PROTOCOL_ACTION, (params) => {
      const route = obsidianRouteFromProtocol(params);
      if (route) void navigateInternal(navigation, route);
      else new import_obsidian5.Notice("Transcript Memory Vault: could not open that link (unrecognized or invalid route).");
    });
    this.addSettingTab(new TranscriptMemorySettingsTab(this.app, this, () => this.health, navigation, () => this.pluginSettings, (next) => this.saveSettings(next)));
    const adapter = this.app.vault.adapter;
    const fileSystemAdapter = adapter instanceof import_obsidian5.FileSystemAdapter ? adapter : null;
    const support = startupSupport({ isDesktopApp: import_obsidian5.Platform.isDesktopApp, hasLocalFilesystem: fileSystemAdapter != null });
    if (!support.supported) {
      this.health = { ...this.health, status: "unsupported", lastInitializationError: support.message };
      new import_obsidian5.Notice(DESKTOP_ONLY_MESSAGE);
      console.error("Transcript Memory Vault unsupported environment:", support.message);
      return;
    }
    this.vaultBasePath = fileSystemAdapter.getBasePath();
    const pluginDirectory = (0, import_node_path6.join)(this.vaultBasePath, this.app.vault.configDir, "plugins", this.manifest.id);
    const databasePath = (0, import_node_path6.join)(pluginDirectory, "transcript-memory.sqlite");
    const migrationDirectory = (0, import_node_path6.join)(pluginDirectory, "migrations");
    const nativeBinding = resolveNativeBinding(pluginDirectory);
    this.health = {
      ...this.health,
      databasePath,
      nativeBindingTarget: nativeBinding.target,
      packagedNativeTargets: nativeBinding.packagedTargets
    };
    if (!nativeBinding.ok) {
      this.health = { ...this.health, status: "error", lastInitializationError: nativeBinding.error };
      this.api = createUnavailableFrontendApi(() => this.health);
      new import_obsidian5.Notice(nativeBinding.error);
      console.error("Transcript Memory Vault native binding unavailable:", nativeBinding.error);
      return;
    }
    try {
      (0, import_node_fs3.mkdirSync)(pluginDirectory, { recursive: true });
      const migrationPackage = validateMigrationPackage(migrationDirectory);
      if (!migrationPackage.ok) throw new Error(`Missing packaged migrations: ${migrationPackage.missing.join(", ")}`);
      const firstRun = !(0, import_node_fs3.existsSync)(databasePath);
      try {
        this.db = openDatabase(databasePath, { nativeBinding: nativeBinding.bindingPath, migrationDirectory });
      } catch (error) {
        throw nativeBindingLoadError(nativeBinding, error);
      }
      const appliedMigrationCount = this.db.prepare("SELECT COUNT(*) count FROM schema_migrations").get().count;
      this.health = {
        ...this.health,
        status: "ready",
        databaseConnected: true,
        migrationStatus: "current",
        appliedMigrationCount,
        realSqliteStorage: true,
        firstRun,
        lastInitializationError: null
      };
      this.api = createObsidianAppApi(
        this.db,
        this.app.vault,
        this.health,
        () => askAiSynthesisFromSettings(this.pluginSettings, { transport: this.llmTransport }),
        () => memoryExtractorFromSettings(this.pluginSettings, { transport: this.llmTransport }),
        { llmRequired: true, getLlmReady: () => isLlmConfigured(this.pluginSettings), syncGeneratedViews: () => this.syncGeneratedGraphNotesForApi() }
      );
      this.refreshReindexStatus();
      if (firstRun) new import_obsidian5.Notice("Transcript Memory Vault is ready. Upload a transcript to begin.");
    } catch (error) {
      this.db?.close();
      this.db = null;
      const message = readableStartupError(error);
      this.health = { ...this.health, status: "error", databaseConnected: false, migrationStatus: "failed", realSqliteStorage: false, lastInitializationError: message };
      this.api = createUnavailableFrontendApi(() => this.health);
      new import_obsidian5.Notice(`Transcript Memory Vault could not initialize: ${message}`);
      console.error("Transcript Memory Vault initialization failed", error);
    }
  }
  onunload() {
    for (const type of Object.values(OBSIDIAN_VIEW_TYPES)) this.app.workspace.detachLeavesOfType(type);
    this.db?.close();
    this.db = null;
    this.api = createUnavailableFrontendApi(() => this.health);
  }
  async loadSettings() {
    try {
      this.pluginSettings = normalizeSettings(await this.loadData());
    } catch (error) {
      this.pluginSettings = DEFAULT_SETTINGS;
      console.error("Transcript Memory Vault settings could not be loaded; using local deterministic defaults.");
    }
    this.health = { ...this.health, ...settingsHealthSummary(this.pluginSettings) };
  }
  async saveSettings(next) {
    this.pluginSettings = normalizeSettings(next);
    await this.saveData(this.pluginSettings);
    this.health = { ...this.health, ...settingsHealthSummary(this.pluginSettings) };
    this.refreshReindexStatus();
  }
  /** Read-only, network-free. Safe to call on startup and after every settings change. */
  refreshReindexStatus() {
    if (!this.db) return;
    try {
      const { summary, assessment } = embeddingReindexStatus(this.db, this.pluginSettings);
      this.health = {
        ...this.health,
        reindexNeeded: assessment.needsReindex,
        reindexSummary: assessment.reasons.join(" ") || "Embedding index is up to date.",
        embeddingUsedFallback: summary.usedFallback
      };
    } catch {
      this.health = { ...this.health, reindexSummary: "Reindex status unavailable." };
    }
  }
  /** Run AI extraction for any transcript imported before the LLM was configured. Requires a configured LLM. */
  async runPendingExtraction() {
    if (!this.db || this.health.status !== "ready") {
      new import_obsidian5.Notice("Transcript Memory Vault is not ready.");
      return;
    }
    if (!isLlmConfigured(this.pluginSettings)) {
      new import_obsidian5.Notice("Configure an LLM provider, model, and API key in Settings first.");
      return;
    }
    new import_obsidian5.Notice("Running AI extraction\u2026");
    let extracted = 0, failed = 0, skipped = 0;
    for (const transcript of await this.api.listTranscripts()) {
      const result = await this.api.runExtraction(transcript.id);
      if (result.status === "extracted") extracted += 1;
      else if (result.status === "failed") failed += 1;
      else skipped += 1;
    }
    new import_obsidian5.Notice(`AI extraction: ${extracted} processed, ${skipped} already done, ${failed} failed.`);
    await this.viewRegistry.notifyMutation();
  }
  /** EXPLICIT manual action. The only path that may make a network call (when external is configured). */
  async rebuildEmbeddingIndex() {
    if (!this.db || this.health.status !== "ready") {
      new import_obsidian5.Notice("Transcript Memory Vault is not ready; cannot rebuild the embedding index.");
      return;
    }
    new import_obsidian5.Notice("Rebuilding embedding index\u2026");
    try {
      const { summary, result } = await runEmbeddingReindex(this.db, this.pluginSettings, { transport: createObsidianEmbeddingTransport() });
      if (summary.usedFallback && summary.reason) new import_obsidian5.Notice(summary.reason);
      new import_obsidian5.Notice(`Embedding index rebuilt: ${result.indexed} indexed, ${result.embedded} embedded, ${result.errors} error(s).`);
      this.refreshReindexStatus();
    } catch (error) {
      new import_obsidian5.Notice(`Embedding index rebuild failed: ${readableStartupError(error)}`);
      console.error("Transcript Memory Vault embedding reindex failed", error);
    }
  }
  /**
   * Core generated-Markdown sync (no UI side effects). Writes the disposable view layer under
   * `<vault>/Transcript Memory Vault/` so Obsidian's native ribbon graph has notes + wikilinks.
   * `cleanBeforeWrite` removes ONLY previously-generated files (tracked in the manifest) and never
   * touches user-created notes. SQLite stays the source of truth; generated Markdown is never read back.
   */
  async runGeneratedVaultSync() {
    if (!this.db || this.health.status !== "ready") throw new Error("Transcript Memory Vault is not ready.");
    if (!this.vaultBasePath) throw new Error("Vault filesystem path is unavailable.");
    return generateObsidianVault(this.db, { outputRoot: (0, import_node_path6.join)(this.vaultBasePath, GENERATED_VAULT_FOLDER), cleanBeforeWrite: true });
  }
  /** EXPLICIT manual action (command palette). Writes generated graph notes and reports via Notices. */
  async syncGeneratedGraphNotesCommand() {
    if (!this.db || this.health.status !== "ready") {
      new import_obsidian5.Notice("Transcript Memory Vault is not ready; cannot sync graph notes.");
      return;
    }
    new import_obsidian5.Notice("Syncing generated graph notes\u2026");
    try {
      const result = await this.runGeneratedVaultSync();
      new import_obsidian5.Notice(result.errors.length ? `Graph notes synced with ${result.errors.length} file error(s); see "${GENERATED_VAULT_FOLDER}/_system/generation-log.md".` : `Graph notes synced into "${GENERATED_VAULT_FOLDER}/": ${result.filesWritten} written, ${result.filesSkipped} unchanged, ${result.graphNodeCount} nodes, ${result.graphEdgeCount} edges. Open Obsidian's graph view to see them.`);
      await this.viewRegistry.notifyMutation();
    } catch (error) {
      new import_obsidian5.Notice(`Graph notes sync failed: ${readableStartupError(error)}`);
      console.error("Transcript Memory Vault generated graph sync failed", error);
    }
  }
  /**
   * EXPLICIT manual action (command palette). Deterministic, idempotent: merges EXACT duplicate memories
   * onto one canonical and consolidates their evidence. Never deletes raw data; never touches near-dups
   * (those stay needs_review for human review). Reports the result via a Notice.
   */
  async mergeDuplicateMemoriesCommand() {
    if (!this.db || this.health.status !== "ready") {
      new import_obsidian5.Notice("Transcript Memory Vault is not ready; cannot merge duplicate memories.");
      return;
    }
    try {
      const r = dedupeCanonicalMemories(this.db);
      new import_obsidian5.Notice(r.canonicalGroups === 0 ? "No exact duplicate memories found. Near-duplicates (if any) remain in the review queue." : `Merged duplicate memories: ${r.canonicalGroups} canonical group(s), ${r.duplicatesSuperseded} duplicate(s) superseded, ${r.evidenceLinksConsolidated} evidence link(s) consolidated. Resync graph notes to refresh the native graph.`);
      await this.viewRegistry.notifyMutation();
    } catch (error) {
      new import_obsidian5.Notice(`Merge duplicate memories failed: ${readableStartupError(error)}`);
      console.error("Transcript Memory Vault memory dedupe failed", error);
    }
  }
  /** Same sync, triggered from the dashboard button. Returns a frontend-friendly summary (no Notices). */
  async syncGeneratedGraphNotesForApi() {
    try {
      const result = await this.runGeneratedVaultSync();
      return {
        status: "synced",
        filesWritten: result.filesWritten,
        filesSkipped: result.filesSkipped,
        graphNodeCount: result.graphNodeCount,
        graphEdgeCount: result.graphEdgeCount,
        warnings: result.warnings,
        errors: result.errors
      };
    } catch (error) {
      return { status: "failed", message: readableStartupError(error) };
    }
  }
};
function navigationForView(navigation, viewType) {
  if (viewType === OBSIDIAN_VIEW_TYPES.upload) return navigation.openUpload();
  if (viewType === OBSIDIAN_VIEW_TYPES.ask) return navigation.openAskAI();
  if (viewType === OBSIDIAN_VIEW_TYPES.search) return navigation.openSearch();
  if (viewType === OBSIDIAN_VIEW_TYPES.graph) return navigation.openGraph();
  if (viewType === OBSIDIAN_VIEW_TYPES.review) return navigation.openReviewQueue();
  return navigation.openDashboard();
}
