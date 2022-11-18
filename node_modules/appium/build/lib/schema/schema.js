"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.validate = exports.resetSchema = exports.registerSchema = exports.isFinalized = exports.isAllowedSchemaFileExtension = exports.hasArgSpec = exports.getSchema = exports.getDefaultsForSchema = exports.getDefaultsForExtension = exports.getArgSpec = exports.getAllArgSpecs = exports.flattenSchema = exports.finalizeSchema = exports.SchemaUnsupportedSchemaError = exports.SchemaUnknownSchemaError = exports.SchemaNameConflictError = exports.SchemaFinalizationError = exports.RoachHotelMap = exports.ALLOWED_SCHEMA_EXTENSIONS = void 0;

require("source-map-support/register");

var _ajv = _interopRequireDefault(require("ajv"));

var _ajvFormats = _interopRequireDefault(require("ajv-formats"));

var _lodash = _interopRequireDefault(require("lodash"));

var _path = _interopRequireDefault(require("path"));

var _constants = require("../constants");

var _schema = require("@appium/schema");

var _argSpec = require("./arg-spec");

var _keywords = require("./keywords");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class RoachHotelMap extends Map {
  set(key, value) {
    if (this.has(key)) {
      throw new Error(`${key} is already set`);
    }

    return super.set(key, value);
  }

  delete(key) {
    return false;
  }

  clear() {
    throw new Error(`Cannot clear RoachHotelMap`);
  }

}

exports.RoachHotelMap = RoachHotelMap;
const ALLOWED_SCHEMA_EXTENSIONS = new Set(['.json', '.js', '.cjs']);
exports.ALLOWED_SCHEMA_EXTENSIONS = ALLOWED_SCHEMA_EXTENSIONS;

class AppiumSchema {
  _argSpecs = new RoachHotelMap();
  _registeredSchemas = {
    [_constants.DRIVER_TYPE]: new Map(),
    [_constants.PLUGIN_TYPE]: new Map()
  };
  _ajv;
  static _instance;
  _finalizedSchemas = null;

  constructor() {
    this._ajv = AppiumSchema._instantiateAjv();
  }

  static create() {
    if (!AppiumSchema._instance) {
      const instance = new AppiumSchema();
      AppiumSchema._instance = instance;

      _lodash.default.bindAll(instance, ['finalize', 'flatten', 'getAllArgSpecs', 'getArgSpec', 'getDefaults', 'getDefaultsForExtension', 'getSchema', 'hasArgSpec', 'isFinalized', 'registerSchema', 'hasRegisteredSchema', 'reset', 'validate']);
    }

    return AppiumSchema._instance;
  }

  hasRegisteredSchema(extType, extName) {
    return this._registeredSchemas[extType].has(extName);
  }

  isFinalized() {
    return Boolean(this._finalizedSchemas);
  }

  getAllArgSpecs() {
    return this._argSpecs;
  }

  finalize() {
    if (this.isFinalized()) {
      return this._finalizedSchemas;
    }

    const ajv = this._ajv;

    const baseSchema = _lodash.default.cloneDeep(_schema.AppiumConfigJsonSchema);

    const addArgSpecs = (schema, extType, extName) => {
      for (let [propName, propSchema] of Object.entries(schema)) {
        const argSpec = _argSpec.ArgSpec.create(propName, {
          dest: propSchema.appiumCliDest,
          defaultValue: propSchema.default,
          extType,
          extName
        });

        const {
          arg
        } = argSpec;

        this._argSpecs.set(arg, argSpec);
      }
    };

    addArgSpecs(_lodash.default.omit(baseSchema.properties.server.properties, [_constants.DRIVER_TYPE, _constants.PLUGIN_TYPE]));
    const finalizedSchemas = {};

    const finalSchema = _lodash.default.reduce(this._registeredSchemas, (baseSchema, extensionSchemas, extType) => {
      extensionSchemas.forEach((schema, extName) => {
        const $ref = _argSpec.ArgSpec.toSchemaBaseRef(extType, extName);

        schema.$id = $ref;
        schema.additionalProperties = false;
        baseSchema.properties.server.properties[extType].properties[extName] = {
          $ref,
          $comment: extName
        };
        ajv.validateSchema(schema, true);
        addArgSpecs(schema.properties, extType, extName);
        ajv.addSchema(schema, $ref);
        finalizedSchemas[$ref] = schema;
      });
      return baseSchema;
    }, baseSchema);

    ajv.addSchema(finalSchema, _argSpec.APPIUM_CONFIG_SCHEMA_ID);
    finalizedSchemas[_argSpec.APPIUM_CONFIG_SCHEMA_ID] = finalSchema;
    ajv.validateSchema(finalSchema, true);
    this._finalizedSchemas = finalizedSchemas;
    return Object.freeze(finalizedSchemas);
  }

  static _instantiateAjv() {
    const ajv = (0, _ajvFormats.default)(new _ajv.default({
      allErrors: true
    }));

    _lodash.default.forEach(_keywords.keywords, keyword => {
      ajv.addKeyword(keyword);
    });

    return ajv;
  }

  reset() {
    for (const schemaId of Object.keys(this._finalizedSchemas ?? {})) {
      this._ajv.removeSchema(schemaId);
    }

    this._argSpecs = new RoachHotelMap();
    this._registeredSchemas = {
      [_constants.DRIVER_TYPE]: new Map(),
      [_constants.PLUGIN_TYPE]: new Map()
    };
    this._finalizedSchemas = null;
    this._ajv = AppiumSchema._instantiateAjv();
  }

  registerSchema(extType, extName, schema) {
    if (!(extType && extName) || _lodash.default.isUndefined(schema)) {
      throw new TypeError('Expected extension type, extension name, and a defined schema');
    }

    if (!AppiumSchema.isSupportedSchemaType(schema)) {
      throw new SchemaUnsupportedSchemaError(schema, extType, extName);
    }

    const normalizedExtName = _lodash.default.kebabCase(extName);

    if (this.hasRegisteredSchema(extType, normalizedExtName)) {
      if (this._registeredSchemas[extType].get(normalizedExtName) === schema) {
        return;
      }

      throw new SchemaNameConflictError(extType, extName);
    }

    this._ajv.validateSchema(schema, true);

    this._registeredSchemas[extType].set(normalizedExtName, schema);
  }

  getArgSpec(name, extType, extName) {
    return this._argSpecs.get(_argSpec.ArgSpec.toArg(name, extType, extName));
  }

  hasArgSpec(name, extType, extName) {
    return this._argSpecs.has(_argSpec.ArgSpec.toArg(name, extType, extName));
  }

  getDefaults(flatten = true) {
    if (!this.isFinalized()) {
      throw new SchemaFinalizationError();
    }

    const reducer = flatten ? (defaults, {
      defaultValue,
      dest
    }) => {
      if (!_lodash.default.isUndefined(defaultValue)) {
        defaults[dest] = defaultValue;
      }

      return defaults;
    } : (defaults, {
      defaultValue,
      dest
    }) => {
      if (!_lodash.default.isUndefined(defaultValue)) {
        _lodash.default.set(defaults, dest, defaultValue);
      }

      return defaults;
    };
    const retval = {};
    return [...this._argSpecs.values()].reduce(reducer, retval);
  }

  getDefaultsForExtension(extType, extName) {
    if (!this.isFinalized()) {
      throw new SchemaFinalizationError();
    }

    const specs = [...this._argSpecs.values()].filter(spec => spec.extType === extType && spec.extName === extName);
    return specs.reduce((defaults, {
      defaultValue,
      rawDest
    }) => {
      if (!_lodash.default.isUndefined(defaultValue)) {
        defaults[rawDest] = defaultValue;
      }

      return defaults;
    }, {});
  }

  flatten() {
    const schema = this.getSchema();
    const stack = [{
      properties: schema.properties,
      prefix: []
    }];
    const flattened = [];

    for (const {
      properties,
      prefix
    } of stack) {
      const pairs = _lodash.default.toPairs(properties);

      for (const [key, value] of pairs) {
        const {
          properties,
          $ref
        } = value;

        if (properties) {
          stack.push({
            properties,
            prefix: key === _argSpec.SERVER_PROP_NAME ? [] : [...prefix, key]
          });
        } else if ($ref) {
          let refSchema;

          try {
            refSchema = this.getSchema($ref);
          } catch (err) {
            throw new SchemaUnknownSchemaError($ref);
          }

          const {
            normalizedExtName
          } = _argSpec.ArgSpec.extensionInfoFromRootSchemaId($ref);

          if (!normalizedExtName) {
            throw new ReferenceError(`Could not determine extension name from schema ID ${$ref}. This is a bug.`);
          }

          stack.push({
            properties: refSchema.properties,
            prefix: [...prefix, key, normalizedExtName]
          });
        } else if (key !== _constants.DRIVER_TYPE && key !== _constants.PLUGIN_TYPE) {
          const [extType, extName] = prefix;
          const argSpec = this.getArgSpec(key, extType, extName);

          if (!argSpec) {
            throw new ReferenceError(`Unknown argument with key ${key}, extType ${extType} and extName ${extName}. This is a bug.`);
          }

          flattened.push({
            schema: _lodash.default.cloneDeep(value),
            argSpec
          });
        }
      }
    }

    return flattened;
  }

  getSchema(ref = _argSpec.APPIUM_CONFIG_SCHEMA_ID) {
    return this._getValidator(ref).schema;
  }

  _getValidator(id = _argSpec.APPIUM_CONFIG_SCHEMA_ID) {
    const validator = this._ajv.getSchema(id);

    if (!validator) {
      if (id === _argSpec.APPIUM_CONFIG_SCHEMA_ID) {
        throw new SchemaFinalizationError();
      } else {
        throw new SchemaUnknownSchemaError(id);
      }
    }

    return validator;
  }

  validate(value, ref = _argSpec.APPIUM_CONFIG_SCHEMA_ID) {
    const validator = this._getValidator(ref);

    return !validator(value) && _lodash.default.isArray(validator.errors) ? [...validator.errors] : [];
  }

  static isAllowedSchemaFileExtension(filename) {
    return ALLOWED_SCHEMA_EXTENSIONS.has(_path.default.extname(filename));
  }

  static isSupportedSchemaType(schema) {
    return _lodash.default.isPlainObject(schema) && schema.$async !== true;
  }

}

class SchemaFinalizationError extends Error {
  code = 'APPIUMERR_SCHEMA_FINALIZATION';

  constructor() {
    super('Schema not yet finalized; `finalize()` must be called first.');
  }

}

exports.SchemaFinalizationError = SchemaFinalizationError;

class SchemaNameConflictError extends Error {
  code = 'APPIUMERR_SCHEMA_NAME_CONFLICT';
  data;

  constructor(extType, extName) {
    super(`Name for ${extType} schema "${extName}" conflicts with an existing schema`);
    this.data = {
      extType,
      extName
    };
  }

}

exports.SchemaNameConflictError = SchemaNameConflictError;

class SchemaUnknownSchemaError extends ReferenceError {
  code = 'APPIUMERR_SCHEMA_UNKNOWN_SCHEMA';
  data;

  constructor(schemaId) {
    super(`Unknown schema: "${schemaId}"`);
    this.data = {
      schemaId
    };
  }

}

exports.SchemaUnknownSchemaError = SchemaUnknownSchemaError;

class SchemaUnsupportedSchemaError extends TypeError {
  code = 'APPIUMERR_SCHEMA_UNSUPPORTED_SCHEMA';
  data;

  constructor(schema, extType, extName) {
    super((() => {
      let msg = `Unsupported schema from ${extType} "${extName}":`;

      if (_lodash.default.isBoolean(schema)) {
        return `${msg} schema cannot be a boolean`;
      }

      if (_lodash.default.isPlainObject(schema)) {
        if (schema.$async) {
          return `${msg} schema cannot be an async schema`;
        }

        throw new TypeError(`schema IS supported; this error should not be thrown (this is a bug). value of schema: ${JSON.stringify(schema)}`);
      }

      return `${msg} schema must be a plain object without a true "$async" property`;
    })());
    this.data = {
      schema,
      extType,
      extName
    };
  }

}

exports.SchemaUnsupportedSchemaError = SchemaUnsupportedSchemaError;
const appiumSchema = AppiumSchema.create();
const {
  registerSchema,
  getAllArgSpecs,
  getArgSpec,
  hasArgSpec,
  isFinalized,
  finalize: finalizeSchema,
  reset: resetSchema,
  validate,
  getSchema,
  flatten: flattenSchema,
  getDefaults: getDefaultsForSchema,
  getDefaultsForExtension
} = appiumSchema;
exports.getDefaultsForExtension = getDefaultsForExtension;
exports.getDefaultsForSchema = getDefaultsForSchema;
exports.flattenSchema = flattenSchema;
exports.getSchema = getSchema;
exports.validate = validate;
exports.resetSchema = resetSchema;
exports.finalizeSchema = finalizeSchema;
exports.isFinalized = isFinalized;
exports.hasArgSpec = hasArgSpec;
exports.getArgSpec = getArgSpec;
exports.getAllArgSpecs = getAllArgSpecs;
exports.registerSchema = registerSchema;
const {
  isAllowedSchemaFileExtension
} = AppiumSchema;
exports.isAllowedSchemaFileExtension = isAllowedSchemaFileExtension;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSb2FjaEhvdGVsTWFwIiwiTWFwIiwic2V0Iiwia2V5IiwidmFsdWUiLCJoYXMiLCJFcnJvciIsImRlbGV0ZSIsImNsZWFyIiwiQUxMT1dFRF9TQ0hFTUFfRVhURU5TSU9OUyIsIlNldCIsIkFwcGl1bVNjaGVtYSIsIl9hcmdTcGVjcyIsIl9yZWdpc3RlcmVkU2NoZW1hcyIsIkRSSVZFUl9UWVBFIiwiUExVR0lOX1RZUEUiLCJfYWp2IiwiX2luc3RhbmNlIiwiX2ZpbmFsaXplZFNjaGVtYXMiLCJjb25zdHJ1Y3RvciIsIl9pbnN0YW50aWF0ZUFqdiIsImNyZWF0ZSIsImluc3RhbmNlIiwiXyIsImJpbmRBbGwiLCJoYXNSZWdpc3RlcmVkU2NoZW1hIiwiZXh0VHlwZSIsImV4dE5hbWUiLCJpc0ZpbmFsaXplZCIsIkJvb2xlYW4iLCJnZXRBbGxBcmdTcGVjcyIsImZpbmFsaXplIiwiYWp2IiwiYmFzZVNjaGVtYSIsImNsb25lRGVlcCIsIkFwcGl1bUNvbmZpZ0pzb25TY2hlbWEiLCJhZGRBcmdTcGVjcyIsInNjaGVtYSIsInByb3BOYW1lIiwicHJvcFNjaGVtYSIsIk9iamVjdCIsImVudHJpZXMiLCJhcmdTcGVjIiwiQXJnU3BlYyIsImRlc3QiLCJhcHBpdW1DbGlEZXN0IiwiZGVmYXVsdFZhbHVlIiwiZGVmYXVsdCIsImFyZyIsIm9taXQiLCJwcm9wZXJ0aWVzIiwic2VydmVyIiwiZmluYWxpemVkU2NoZW1hcyIsImZpbmFsU2NoZW1hIiwicmVkdWNlIiwiZXh0ZW5zaW9uU2NoZW1hcyIsImZvckVhY2giLCIkcmVmIiwidG9TY2hlbWFCYXNlUmVmIiwiJGlkIiwiYWRkaXRpb25hbFByb3BlcnRpZXMiLCIkY29tbWVudCIsInZhbGlkYXRlU2NoZW1hIiwiYWRkU2NoZW1hIiwiQVBQSVVNX0NPTkZJR19TQ0hFTUFfSUQiLCJmcmVlemUiLCJhZGRGb3JtYXRzIiwiQWp2IiwiYWxsRXJyb3JzIiwia2V5d29yZHMiLCJrZXl3b3JkIiwiYWRkS2V5d29yZCIsInJlc2V0Iiwic2NoZW1hSWQiLCJrZXlzIiwicmVtb3ZlU2NoZW1hIiwicmVnaXN0ZXJTY2hlbWEiLCJpc1VuZGVmaW5lZCIsIlR5cGVFcnJvciIsImlzU3VwcG9ydGVkU2NoZW1hVHlwZSIsIlNjaGVtYVVuc3VwcG9ydGVkU2NoZW1hRXJyb3IiLCJub3JtYWxpemVkRXh0TmFtZSIsImtlYmFiQ2FzZSIsImdldCIsIlNjaGVtYU5hbWVDb25mbGljdEVycm9yIiwiZ2V0QXJnU3BlYyIsIm5hbWUiLCJ0b0FyZyIsImhhc0FyZ1NwZWMiLCJnZXREZWZhdWx0cyIsImZsYXR0ZW4iLCJTY2hlbWFGaW5hbGl6YXRpb25FcnJvciIsInJlZHVjZXIiLCJkZWZhdWx0cyIsInJldHZhbCIsInZhbHVlcyIsImdldERlZmF1bHRzRm9yRXh0ZW5zaW9uIiwic3BlY3MiLCJmaWx0ZXIiLCJzcGVjIiwicmF3RGVzdCIsImdldFNjaGVtYSIsInN0YWNrIiwicHJlZml4IiwiZmxhdHRlbmVkIiwicGFpcnMiLCJ0b1BhaXJzIiwicHVzaCIsIlNFUlZFUl9QUk9QX05BTUUiLCJyZWZTY2hlbWEiLCJlcnIiLCJTY2hlbWFVbmtub3duU2NoZW1hRXJyb3IiLCJleHRlbnNpb25JbmZvRnJvbVJvb3RTY2hlbWFJZCIsIlJlZmVyZW5jZUVycm9yIiwicmVmIiwiX2dldFZhbGlkYXRvciIsImlkIiwidmFsaWRhdG9yIiwidmFsaWRhdGUiLCJpc0FycmF5IiwiZXJyb3JzIiwiaXNBbGxvd2VkU2NoZW1hRmlsZUV4dGVuc2lvbiIsImZpbGVuYW1lIiwicGF0aCIsImV4dG5hbWUiLCJpc1BsYWluT2JqZWN0IiwiJGFzeW5jIiwiY29kZSIsImRhdGEiLCJtc2ciLCJpc0Jvb2xlYW4iLCJKU09OIiwic3RyaW5naWZ5IiwiYXBwaXVtU2NoZW1hIiwiZmluYWxpemVTY2hlbWEiLCJyZXNldFNjaGVtYSIsImZsYXR0ZW5TY2hlbWEiLCJnZXREZWZhdWx0c0ZvclNjaGVtYSJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2xpYi9zY2hlbWEvc2NoZW1hLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBBanYgZnJvbSAnYWp2JztcbmltcG9ydCBhZGRGb3JtYXRzIGZyb20gJ2Fqdi1mb3JtYXRzJztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7RFJJVkVSX1RZUEUsIFBMVUdJTl9UWVBFfSBmcm9tICcuLi9jb25zdGFudHMnO1xuaW1wb3J0IHtBcHBpdW1Db25maWdKc29uU2NoZW1hfSBmcm9tICdAYXBwaXVtL3NjaGVtYSc7XG5pbXBvcnQge0FQUElVTV9DT05GSUdfU0NIRU1BX0lELCBBcmdTcGVjLCBTRVJWRVJfUFJPUF9OQU1FfSBmcm9tICcuL2FyZy1zcGVjJztcbmltcG9ydCB7a2V5d29yZHN9IGZyb20gJy4va2V5d29yZHMnO1xuXG4vKipcbiAqIEtleS92YWx1ZSBwYWlycyBnbyBpbi4uLiBidXQgdGhleSBkb24ndCBjb21lIG91dC5cbiAqXG4gKiBAdGVtcGxhdGUgSyxWXG4gKiBAZXh0ZW5kcyB7TWFwPEssVj59XG4gKi9cbmV4cG9ydCBjbGFzcyBSb2FjaEhvdGVsTWFwIGV4dGVuZHMgTWFwIHtcbiAgLyoqXG4gICAqIEBwYXJhbSB7S30ga2V5XG4gICAqIEBwYXJhbSB7Vn0gdmFsdWVcbiAgICovXG4gIHNldChrZXksIHZhbHVlKSB7XG4gICAgaWYgKHRoaXMuaGFzKGtleSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtrZXl9IGlzIGFscmVhZHkgc2V0YCk7XG4gICAgfVxuICAgIHJldHVybiBzdXBlci5zZXQoa2V5LCB2YWx1ZSk7XG4gIH1cblxuICAvKipcbiAgICogQHBhcmFtIHtLfSBrZXlcbiAgICovXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnVzZWQtdmFyc1xuICBkZWxldGUoa2V5KSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY2xlYXIoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY2xlYXIgUm9hY2hIb3RlbE1hcGApO1xuICB9XG59XG5cbi8qKlxuICogRXh0ZW5zaW9ucyB0aGF0IGFuIGV4dGVuc2lvbiBzY2hlbWEgZmlsZSBjYW4gaGF2ZS5cbiAqL1xuZXhwb3J0IGNvbnN0IEFMTE9XRURfU0NIRU1BX0VYVEVOU0lPTlMgPSBuZXcgU2V0KFsnLmpzb24nLCAnLmpzJywgJy5janMnXSk7XG5cbi8qKlxuICogQSB3cmFwcGVyIGFyb3VuZCBBanYgYW5kIHNjaGVtYS1yZWxhdGVkIGZ1bmN0aW9ucy5cbiAqXG4gKiBTaG91bGQgaGF2ZSBiZWVuIG5hbWVkIEhpZ2hsYW5kZXIsIGJlY2F1c2UgX3RoZXJlIGNhbiBvbmx5IGJlIG9uZV9cbiAqL1xuY2xhc3MgQXBwaXVtU2NoZW1hIHtcbiAgLyoqXG4gICAqIEEgbWFwcGluZyBvZiB1bmlxdWUgYXJndW1lbnQgSURzIHRvIHRoZWlyIGNvcnJlc3BvbmRpbmcge0BsaW5rIEFyZ1NwZWN9cy5cbiAgICpcbiAgICogQW4gXCJhcmd1bWVudFwiIGlzIGEgQ0xJIGFyZ3VtZW50IG9yIGEgY29uZmlnIHByb3BlcnR5LlxuICAgKlxuICAgKiBVc2VkIHRvIHByb3ZpZGUgZWFzeSBsb29rdXBzIG9mIGFyZ3VtZW50IG1ldGFkYXRhIHdoZW4gY29udmVydGluZyBiZXR3ZWVuIGRpZmZlcmVudCByZXByZXNlbnRhdGlvbnMgb2YgdGhvc2UgYXJndW1lbnRzLlxuICAgKiBAcHJpdmF0ZVxuICAgKiBAdHlwZSB7Um9hY2hIb3RlbE1hcDxzdHJpbmcsQXJnU3BlYz59XG4gICAqL1xuICBfYXJnU3BlY3MgPSBuZXcgUm9hY2hIb3RlbE1hcCgpO1xuXG4gIC8qKlxuICAgKiBBIG1hcCBvZiBleHRlbnNpb24gdHlwZXMgdG8gZXh0ZW5zaW9uIG5hbWVzIHRvIHNjaGVtYSBvYmplY3RzLlxuICAgKlxuICAgKiBUaGlzIGRhdGEgc3RydWN0dXJlIGlzIHVzZWQgdG8gZW5zdXJlIHRoZXJlIGFyZSBubyBuYW1pbmcgY29uZmxpY3RzLiBUaGUgc2NoZW1hc1xuICAgKiBhcmUgc3RvcmVkIGhlcmUgaW4gbWVtb3J5IHVudGlsIHRoZSBpbnN0YW5jZSBpcyBfZmluYWxpemVkXy5cbiAgICogQHByaXZhdGVcbiAgICogQHR5cGUge1JlY29yZDxFeHRlbnNpb25UeXBlLE1hcDxzdHJpbmcsU2NoZW1hT2JqZWN0Pj59XG4gICAqL1xuICBfcmVnaXN0ZXJlZFNjaGVtYXMgPSB7W0RSSVZFUl9UWVBFXTogbmV3IE1hcCgpLCBbUExVR0lOX1RZUEVdOiBuZXcgTWFwKCl9O1xuXG4gIC8qKlxuICAgKiBBanYgaW5zdGFuY2VcbiAgICpcbiAgICogQHByaXZhdGVcbiAgICogQHR5cGUge0Fqdn1cbiAgICovXG4gIF9hanY7XG5cbiAgLyoqXG4gICAqIFNpbmdsZXRvbiBpbnN0YW5jZS5cbiAgICogQHByaXZhdGVcbiAgICogQHR5cGUge0FwcGl1bVNjaGVtYX1cbiAgICovXG4gIHN0YXRpYyBfaW5zdGFuY2U7XG5cbiAgLyoqXG4gICAqIExvb2t1cCBvZiBzY2hlbWEgSURzIHRvIGZpbmFsaXplZCBzY2hlbWFzLlxuICAgKlxuICAgKiBUaGlzIGRvZXMgbm90IGluY2x1ZGUgcmVmZXJlbmNlcywgYnV0IHJhdGhlciB0aGUgcm9vdCBzY2hlbWFzIHRoZW1zZWx2ZXMuXG4gICAqIEBwcml2YXRlXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLFN0cmljdFNjaGVtYU9iamVjdD4/fVxuICAgKi9cbiAgX2ZpbmFsaXplZFNjaGVtYXMgPSBudWxsO1xuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplcyBBanYsIGFkZHMgc3RhbmRhcmQgZm9ybWF0cyBhbmQgb3VyIGN1c3RvbSBrZXl3b3Jkcy5cbiAgICogQHNlZSBodHRwczovL25wbS5pbS9hanYtZm9ybWF0c1xuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5fYWp2ID0gQXBwaXVtU2NoZW1hLl9pbnN0YW50aWF0ZUFqdigpO1xuICB9XG5cbiAgLyoqXG4gICAqIEZhY3RvcnkgZnVuY3Rpb24gZm9yIHtAbGluayBBcHBpdW1TY2hlbWF9IGluc3RhbmNlcy5cbiAgICpcbiAgICogUmV0dXJucyBhIHNpbmdsZXRvbiBpbnN0YW5jZSBpZiBvbmUgZXhpc3RzLCBvdGhlcndpc2UgY3JlYXRlcyBhIG5ldyBvbmUuXG4gICAqIEJpbmRzIHB1YmxpYyBtZXRob2RzIHRvIHRoZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge0FwcGl1bVNjaGVtYX1cbiAgICovXG4gIHN0YXRpYyBjcmVhdGUoKSB7XG4gICAgaWYgKCFBcHBpdW1TY2hlbWEuX2luc3RhbmNlKSB7XG4gICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBBcHBpdW1TY2hlbWEoKTtcbiAgICAgIEFwcGl1bVNjaGVtYS5faW5zdGFuY2UgPSBpbnN0YW5jZTtcbiAgICAgIF8uYmluZEFsbChpbnN0YW5jZSwgW1xuICAgICAgICAnZmluYWxpemUnLFxuICAgICAgICAnZmxhdHRlbicsXG4gICAgICAgICdnZXRBbGxBcmdTcGVjcycsXG4gICAgICAgICdnZXRBcmdTcGVjJyxcbiAgICAgICAgJ2dldERlZmF1bHRzJyxcbiAgICAgICAgJ2dldERlZmF1bHRzRm9yRXh0ZW5zaW9uJyxcbiAgICAgICAgJ2dldFNjaGVtYScsXG4gICAgICAgICdoYXNBcmdTcGVjJyxcbiAgICAgICAgJ2lzRmluYWxpemVkJyxcbiAgICAgICAgJ3JlZ2lzdGVyU2NoZW1hJyxcbiAgICAgICAgJ2hhc1JlZ2lzdGVyZWRTY2hlbWEnLFxuICAgICAgICAncmVzZXQnLFxuICAgICAgICAndmFsaWRhdGUnLFxuICAgICAgXSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIEFwcGl1bVNjaGVtYS5faW5zdGFuY2U7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBgdHJ1ZWAgaWYgYSBzY2hlbWEgaGFzIGJlZW4gcmVnaXN0ZXJlZCB1c2luZyBnaXZlbiBleHRlbnNpb24gdHlwZSBhbmQgbmFtZS5cbiAgICpcbiAgICogVGhpcyBkb2VzIG5vdCBkZXBlbmQgb24gd2hldGhlciBvciBub3QgdGhlIGluc3RhbmNlIGhhcyBiZWVuIF9maW5hbGl6ZWRfLlxuICAgKiBAcGFyYW0ge0V4dGVuc2lvblR5cGV9IGV4dFR5cGUgLSBFeHRlbnNpb24gdHlwZVxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXh0TmFtZSAtIE5hbWVcbiAgICogQHJldHVybnMge2Jvb2xlYW59IElmIHJlZ2lzdGVyZWRcbiAgICovXG4gIGhhc1JlZ2lzdGVyZWRTY2hlbWEoZXh0VHlwZSwgZXh0TmFtZSkge1xuICAgIHJldHVybiB0aGlzLl9yZWdpc3RlcmVkU2NoZW1hc1tleHRUeXBlXS5oYXMoZXh0TmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIGB0cnVlYCBpZiB7QGxpbmsgQXBwaXVtU2NoZW1hLmZpbmFsaXplIGZpbmFsaXplfSBoYXMgYmVlbiBjYWxsZWRcbiAgICogc3VjY2Vzc2Z1bGx5IGFuZCB7QGxpbmsgQXBwaXVtU2NoZW1hLnJlc2V0IHJlc2V0fSBoYXMgbm90IGJlZW4gY2FsbGVkIHNpbmNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gSWYgZmluYWxpemVkXG4gICAqL1xuICBpc0ZpbmFsaXplZCgpIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLl9maW5hbGl6ZWRTY2hlbWFzKTtcbiAgfVxuXG4gIGdldEFsbEFyZ1NwZWNzKCkge1xuICAgIHJldHVybiB0aGlzLl9hcmdTcGVjcztcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsIHRoaXMgd2hlbiBubyBtb3JlIHNjaGVtYXMgd2lsbCBiZSByZWdpc3RlcmVkLlxuICAgKlxuICAgKiBUaGlzIGRvZXMgdGhyZWUgdGhpbmdzOlxuICAgKiAxLiBJdCBjb21iaW5lcyBhbGwgc2NoZW1hcyBmcm9tIGV4dGVuc2lvbnMgaW50byB0aGUgQXBwaXVtIGNvbmZpZyBzY2hlbWEsXG4gICAqICAgIHRoZW4gYWRkcyB0aGUgcmVzdWx0IHRvIHRoZSBgQWp2YCBpbnN0YW5jZS5cbiAgICogMi4gSXQgYWRkcyBzY2hlbWFzIGZvciBfZWFjaF8gYXJndW1lbnQvcHJvcGVydHkgZm9yIHZhbGlkYXRpb24gcHVycG9zZXMuXG4gICAqICAgIFRoZSBDTEkgdXNlcyB0aGVzZSBzY2hlbWFzIHRvIHZhbGlkYXRlIHNwZWNpZmljIGFyZ3VtZW50cy5cbiAgICogMy4gVGhlIHNjaGVtYXMgYXJlIHZhbGlkYXRlZCBhZ2FpbnN0IEpTT04gc2NoZW1hIGRyYWZ0LTA3ICh3aGljaCBpcyB0aGVcbiAgICogICAgb25seSBvbmUgc3VwcG9ydGVkIGF0IHRoaXMgdGltZSlcbiAgICpcbiAgICogQW55IG1ldGhvZCBpbiB0aGlzIGluc3RhbmNlIHRoYXQgbmVlZHMgdG8gaW50ZXJhY3Qgd2l0aCB0aGUgYEFqdmAgaW5zdGFuY2VcbiAgICogd2lsbCB0aHJvdyBpZiB0aGlzIG1ldGhvZCBoYXMgbm90IGJlZW4gY2FsbGVkLlxuICAgKlxuICAgKiBJZiB0aGUgaW5zdGFuY2UgaGFzIGFscmVhZHkgYmVlbiBmaW5hbGl6ZWQsIHRoaXMgaXMgYSBuby1vcC5cbiAgICogQHB1YmxpY1xuICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIHNjaGVtYSBpcyBub3QgdmFsaWRcbiAgICogQHJldHVybnMge1JlYWRvbmx5PFJlY29yZDxzdHJpbmcsU3RyaWN0U2NoZW1hT2JqZWN0Pj59IFJlY29yZCBvZiBzY2hlbWEgSURzIHRvIGZ1bGwgc2NoZW1hIG9iamVjdHNcbiAgICovXG4gIGZpbmFsaXplKCkge1xuICAgIGlmICh0aGlzLmlzRmluYWxpemVkKCkpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge05vbk51bGxhYmxlPHR5cGVvZiB0aGlzLl9maW5hbGl6ZWRTY2hlbWFzPn0gKi8gKHRoaXMuX2ZpbmFsaXplZFNjaGVtYXMpO1xuICAgIH1cblxuICAgIGNvbnN0IGFqdiA9IHRoaXMuX2FqdjtcblxuICAgIC8vIEFqdiB3aWxsIF9tdXRhdGVfIHRoZSBzY2hlbWEsIHNvIHdlIG5lZWQgdG8gY2xvbmUgaXQuXG4gICAgY29uc3QgYmFzZVNjaGVtYSA9IF8uY2xvbmVEZWVwKEFwcGl1bUNvbmZpZ0pzb25TY2hlbWEpO1xuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1NjaGVtYU9iamVjdH0gc2NoZW1hXG4gICAgICogQHBhcmFtIHtFeHRlbnNpb25UeXBlfSBbZXh0VHlwZV1cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gW2V4dE5hbWVdXG4gICAgICovXG4gICAgY29uc3QgYWRkQXJnU3BlY3MgPSAoc2NoZW1hLCBleHRUeXBlLCBleHROYW1lKSA9PiB7XG4gICAgICBmb3IgKGxldCBbcHJvcE5hbWUsIHByb3BTY2hlbWFdIG9mIE9iamVjdC5lbnRyaWVzKHNjaGVtYSkpIHtcbiAgICAgICAgY29uc3QgYXJnU3BlYyA9IEFyZ1NwZWMuY3JlYXRlKHByb3BOYW1lLCB7XG4gICAgICAgICAgZGVzdDogcHJvcFNjaGVtYS5hcHBpdW1DbGlEZXN0LFxuICAgICAgICAgIGRlZmF1bHRWYWx1ZTogcHJvcFNjaGVtYS5kZWZhdWx0LFxuICAgICAgICAgIGV4dFR5cGUsXG4gICAgICAgICAgZXh0TmFtZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHthcmd9ID0gYXJnU3BlYztcbiAgICAgICAgdGhpcy5fYXJnU3BlY3Muc2V0KGFyZywgYXJnU3BlYyk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGFkZEFyZ1NwZWNzKF8ub21pdChiYXNlU2NoZW1hLnByb3BlcnRpZXMuc2VydmVyLnByb3BlcnRpZXMsIFtEUklWRVJfVFlQRSwgUExVR0lOX1RZUEVdKSk7XG5cbiAgICAvKipcbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZyxTdHJpY3RTY2hlbWFPYmplY3Q+fVxuICAgICAqL1xuICAgIGNvbnN0IGZpbmFsaXplZFNjaGVtYXMgPSB7fTtcblxuICAgIGNvbnN0IGZpbmFsU2NoZW1hID0gXy5yZWR1Y2UoXG4gICAgICB0aGlzLl9yZWdpc3RlcmVkU2NoZW1hcyxcbiAgICAgIC8qKlxuICAgICAgICogQHBhcmFtIHt0eXBlb2YgYmFzZVNjaGVtYX0gYmFzZVNjaGVtYVxuICAgICAgICogQHBhcmFtIHtNYXA8c3RyaW5nLFNjaGVtYU9iamVjdD59IGV4dGVuc2lvblNjaGVtYXNcbiAgICAgICAqIEBwYXJhbSB7RXh0ZW5zaW9uVHlwZX0gZXh0VHlwZVxuICAgICAgICovXG4gICAgICAoYmFzZVNjaGVtYSwgZXh0ZW5zaW9uU2NoZW1hcywgZXh0VHlwZSkgPT4ge1xuICAgICAgICBleHRlbnNpb25TY2hlbWFzLmZvckVhY2goKHNjaGVtYSwgZXh0TmFtZSkgPT4ge1xuICAgICAgICAgIGNvbnN0ICRyZWYgPSBBcmdTcGVjLnRvU2NoZW1hQmFzZVJlZihleHRUeXBlLCBleHROYW1lKTtcbiAgICAgICAgICBzY2hlbWEuJGlkID0gJHJlZjtcbiAgICAgICAgICBzY2hlbWEuYWRkaXRpb25hbFByb3BlcnRpZXMgPSBmYWxzZTsgLy8gdGhpcyBtYWtlcyBgc2NoZW1hYCBiZWNvbWUgYSBgU3RyaWN0U2NoZW1hT2JqZWN0YFxuICAgICAgICAgIGJhc2VTY2hlbWEucHJvcGVydGllcy5zZXJ2ZXIucHJvcGVydGllc1tleHRUeXBlXS5wcm9wZXJ0aWVzW2V4dE5hbWVdID0ge1xuICAgICAgICAgICAgJHJlZixcbiAgICAgICAgICAgICRjb21tZW50OiBleHROYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgICAgYWp2LnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwgdHJ1ZSk7XG4gICAgICAgICAgYWRkQXJnU3BlY3Moc2NoZW1hLnByb3BlcnRpZXMsIGV4dFR5cGUsIGV4dE5hbWUpO1xuICAgICAgICAgIGFqdi5hZGRTY2hlbWEoc2NoZW1hLCAkcmVmKTtcbiAgICAgICAgICBmaW5hbGl6ZWRTY2hlbWFzWyRyZWZdID0gLyoqIEB0eXBlIHtTdHJpY3RTY2hlbWFPYmplY3R9ICovIChzY2hlbWEpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIGJhc2VTY2hlbWE7XG4gICAgICB9LFxuICAgICAgYmFzZVNjaGVtYVxuICAgICk7XG5cbiAgICBhanYuYWRkU2NoZW1hKGZpbmFsU2NoZW1hLCBBUFBJVU1fQ09ORklHX1NDSEVNQV9JRCk7XG4gICAgZmluYWxpemVkU2NoZW1hc1tBUFBJVU1fQ09ORklHX1NDSEVNQV9JRF0gPSBmaW5hbFNjaGVtYTtcbiAgICBhanYudmFsaWRhdGVTY2hlbWEoZmluYWxTY2hlbWEsIHRydWUpO1xuXG4gICAgdGhpcy5fZmluYWxpemVkU2NoZW1hcyA9IGZpbmFsaXplZFNjaGVtYXM7XG4gICAgcmV0dXJuIE9iamVjdC5mcmVlemUoZmluYWxpemVkU2NoZW1hcyk7XG4gIH1cblxuICAvKipcbiAgICogQ29uZmlndXJlcyBhbmQgY3JlYXRlcyBhbiBBanYgaW5zdGFuY2UuXG4gICAqIEBwcml2YXRlXG4gICAqIEByZXR1cm5zIHtBanZ9XG4gICAqL1xuICBzdGF0aWMgX2luc3RhbnRpYXRlQWp2KCkge1xuICAgIGNvbnN0IGFqdiA9IGFkZEZvcm1hdHMoXG4gICAgICBuZXcgQWp2KHtcbiAgICAgICAgLy8gd2l0aG91dCB0aGlzIG5vdCBtdWNoIHZhbGlkYXRpb24gYWN0dWFsbHkgaGFwcGVuc1xuICAgICAgICBhbGxFcnJvcnM6IHRydWUsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBhZGQgY3VzdG9tIGtleXdvcmRzIHRvIGFqdi4gc2VlIHNjaGVtYS1rZXl3b3Jkcy5qc1xuICAgIF8uZm9yRWFjaChrZXl3b3JkcywgKGtleXdvcmQpID0+IHtcbiAgICAgIGFqdi5hZGRLZXl3b3JkKGtleXdvcmQpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFqdjtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldHMgdGhpcyBpbnN0YW5jZSB0byBpdHMgb3JpZ2luYWwgc3RhdGUuXG4gICAqXG4gICAqIC0gUmVtb3ZlcyBhbGwgYWRkZWQgc2NoZW1hcyBmcm9tIHRoZSBgQWp2YCBpbnN0YW5jZVxuICAgKiAtIFJlc2V0cyB0aGUgbWFwIG9mIHtAbGluayBBcmdTcGVjIEFyZ1NwZWNzfVxuICAgKiAtIFJlc2V0cyB0aGUgbWFwIG9mIHJlZ2lzdGVyZWQgc2NoZW1hc1xuICAgKiAtIFNldHMgdGhlIHtAbGluayBBcHBpdW1TY2hlbWEuX2ZpbmFsaXplZCBfZmluYWxpemVkfSBmbGFnIHRvIGBmYWxzZWBcbiAgICpcbiAgICogSWYgeW91IG5lZWQgdG8gY2FsbCB7QGxpbmsgQXBwaXVtU2NoZW1hLmZpbmFsaXplfSBhZ2FpbiwgeW91J2xsIHdhbnQgdG8gY2FsbCB0aGlzIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlc2V0KCkge1xuICAgIGZvciAoY29uc3Qgc2NoZW1hSWQgb2YgT2JqZWN0LmtleXModGhpcy5fZmluYWxpemVkU2NoZW1hcyA/PyB7fSkpIHtcbiAgICAgIHRoaXMuX2Fqdi5yZW1vdmVTY2hlbWEoc2NoZW1hSWQpO1xuICAgIH1cbiAgICB0aGlzLl9hcmdTcGVjcyA9IG5ldyBSb2FjaEhvdGVsTWFwKCk7XG4gICAgdGhpcy5fcmVnaXN0ZXJlZFNjaGVtYXMgPSB7XG4gICAgICBbRFJJVkVSX1RZUEVdOiBuZXcgTWFwKCksXG4gICAgICBbUExVR0lOX1RZUEVdOiBuZXcgTWFwKCksXG4gICAgfTtcbiAgICB0aGlzLl9maW5hbGl6ZWRTY2hlbWFzID0gbnVsbDtcblxuICAgIC8vIEFqdiBzZWVtcyB0byBoYXZlIGFuIG92ZXItZWFnZXIgY2FjaGUsIHNvIHdlIGhhdmUgdG8gZHVtcCB0aGUgb2JqZWN0IGVudGlyZWx5LlxuICAgIHRoaXMuX2FqdiA9IEFwcGl1bVNjaGVtYS5faW5zdGFudGlhdGVBanYoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBzY2hlbWEgZnJvbSBhbiBleHRlbnNpb24uXG4gICAqXG4gICAqIFRoaXMgaXMgXCJmYWlsLWZhc3RcIiBpbiB0aGF0IHRoZSBzY2hlbWEgd2lsbCBpbW1lZGlhdGVseSBiZSB2YWxpZGF0ZWQgYWdhaW5zdCBKU09OIHNjaGVtYSBkcmFmdC0wNyBfb3JfIHdoYXRldmVyIHRoZSB2YWx1ZSBvZiB0aGUgc2NoZW1hJ3MgYCRzY2hlbWFgIHByb3AgaXMuXG4gICAqXG4gICAqIERvZXMgX25vdF8gYWRkIHRoZSBzY2hlbWEgdG8gdGhlIGBhanZgIGluc3RhbmNlICh0aGlzIGlzIGRvbmUgYnkge0BsaW5rIEFwcGl1bVNjaGVtYS5maW5hbGl6ZX0pLlxuICAgKiBAcGFyYW0ge0V4dGVuc2lvblR5cGV9IGV4dFR5cGUgLSBFeHRlbnNpb24gdHlwZVxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXh0TmFtZSAtIFVuaXF1ZSBleHRlbnNpb24gbmFtZSBmb3IgYHR5cGVgXG4gICAqIEBwYXJhbSB7U2NoZW1hT2JqZWN0fSBzY2hlbWEgLSBTY2hlbWEgb2JqZWN0XG4gICAqIEB0aHJvd3Mge1NjaGVtYU5hbWVDb25mbGljdEVycm9yfSBJZiB0aGUgc2NoZW1hIGlzIGFuIGludmFsaWRcbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWdpc3RlclNjaGVtYShleHRUeXBlLCBleHROYW1lLCBzY2hlbWEpIHtcbiAgICBpZiAoIShleHRUeXBlICYmIGV4dE5hbWUpIHx8IF8uaXNVbmRlZmluZWQoc2NoZW1hKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRXhwZWN0ZWQgZXh0ZW5zaW9uIHR5cGUsIGV4dGVuc2lvbiBuYW1lLCBhbmQgYSBkZWZpbmVkIHNjaGVtYScpO1xuICAgIH1cbiAgICBpZiAoIUFwcGl1bVNjaGVtYS5pc1N1cHBvcnRlZFNjaGVtYVR5cGUoc2NoZW1hKSkge1xuICAgICAgdGhyb3cgbmV3IFNjaGVtYVVuc3VwcG9ydGVkU2NoZW1hRXJyb3Ioc2NoZW1hLCBleHRUeXBlLCBleHROYW1lKTtcbiAgICB9XG4gICAgY29uc3Qgbm9ybWFsaXplZEV4dE5hbWUgPSBfLmtlYmFiQ2FzZShleHROYW1lKTtcbiAgICBpZiAodGhpcy5oYXNSZWdpc3RlcmVkU2NoZW1hKGV4dFR5cGUsIG5vcm1hbGl6ZWRFeHROYW1lKSkge1xuICAgICAgaWYgKHRoaXMuX3JlZ2lzdGVyZWRTY2hlbWFzW2V4dFR5cGVdLmdldChub3JtYWxpemVkRXh0TmFtZSkgPT09IHNjaGVtYSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgU2NoZW1hTmFtZUNvbmZsaWN0RXJyb3IoZXh0VHlwZSwgZXh0TmFtZSk7XG4gICAgfVxuICAgIHRoaXMuX2Fqdi52YWxpZGF0ZVNjaGVtYShzY2hlbWEsIHRydWUpO1xuXG4gICAgdGhpcy5fcmVnaXN0ZXJlZFNjaGVtYXNbZXh0VHlwZV0uc2V0KG5vcm1hbGl6ZWRFeHROYW1lLCBzY2hlbWEpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSB7QGxpbmsgQXJnU3BlY30gZm9yIHRoZSBnaXZlbiBhcmd1bWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIENMSSBhcmd1bWVudCBuYW1lXG4gICAqIEBwYXJhbSB7RXh0ZW5zaW9uVHlwZX0gW2V4dFR5cGVdIC0gRXh0ZW5zaW9uIHR5cGVcbiAgICogQHBhcmFtIHtzdHJpbmd9IFtleHROYW1lXSAtIEV4dGVuc2lvbiBuYW1lXG4gICAqIEByZXR1cm5zIHtBcmdTcGVjfHVuZGVmaW5lZH0gQXJnU3BlYyBvciBgdW5kZWZpbmVkYCBpZiBub3QgZm91bmRcbiAgICovXG4gIGdldEFyZ1NwZWMobmFtZSwgZXh0VHlwZSwgZXh0TmFtZSkge1xuICAgIHJldHVybiB0aGlzLl9hcmdTcGVjcy5nZXQoQXJnU3BlYy50b0FyZyhuYW1lLCBleHRUeXBlLCBleHROYW1lKSk7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBgdHJ1ZWAgaWYgdGhlIGluc3RhbmNlIGtub3dzIGFib3V0IGFuIGFyZ3VtZW50IGJ5IHRoZSBnaXZlbiBgbmFtZWAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ0xJIGFyZ3VtZW50IG5hbWVcbiAgICogQHBhcmFtIHtFeHRlbnNpb25UeXBlfSBbZXh0VHlwZV0gLSBFeHRlbnNpb24gdHlwZVxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2V4dE5hbWVdIC0gRXh0ZW5zaW9uIG5hbWVcbiAgICogQHJldHVybnMge2Jvb2xlYW59IGB0cnVlYCBpZiBzdWNoIGFuIHtAbGluayBBcmdTcGVjfSBleGlzdHNcbiAgICovXG4gIGhhc0FyZ1NwZWMobmFtZSwgZXh0VHlwZSwgZXh0TmFtZSkge1xuICAgIHJldHVybiB0aGlzLl9hcmdTcGVjcy5oYXMoQXJnU3BlYy50b0FyZyhuYW1lLCBleHRUeXBlLCBleHROYW1lKSk7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIGBSZWNvcmRgIG9mIGFyZ3VtZW50IFwiZGVzdFwiIHN0cmluZ3MgdG8gZGVmYXVsdCB2YWx1ZXMuXG4gICAqXG4gICAqIFRoZSBcImRlc3RcIiBzdHJpbmcgaXMgdGhlIHByb3BlcnR5IG5hbWUgaW4gb2JqZWN0IHJldHVybmVkIGJ5XG4gICAqIGBhcmdwYXJzZS5Bcmd1bWVudFBhcnNlclsncGFyc2VfYXJncyddYC5cbiAgICogQHRlbXBsYXRlIHtib29sZWFufHVuZGVmaW5lZH0gRmxhdHRlbmVkXG4gICAqIEBwYXJhbSB7RmxhdHRlbmVkfSBbZmxhdHRlbj10cnVlXSAtIElmIGB0cnVlYCwgZmxhdHRlbnMgdGhlIHJldHVybmVkIG9iamVjdFxuICAgKiB1c2luZyBcImtleXBhdGhcIi1zdHlsZSBrZXlzIG9mIHRoZSBmb3JtYXQgYDxleHRUeXBlPi48ZXh0TmFtZT4uPGFyZ05hbWU+YC5cbiAgICogT3RoZXJ3aXNlLCByZXR1cm5zIGEgbmVzdGVkIG9iamVjdCB1c2luZyBgZXh0VHlwZWAgYW5kIGBleHROYW1lYCBhc1xuICAgKiBwcm9wZXJ0aWVzLiBCYXNlIGFyZ3VtZW50cyAoc2VydmVyIGFyZ3VtZW50cykgYXJlIGFsd2F5cyBhdCB0aGUgdG9wIGxldmVsLlxuICAgKiBAcmV0dXJucyB7RGVmYXVsdFZhbHVlczxGbGF0dGVuZWQ+fVxuICAgKi9cbiAgZ2V0RGVmYXVsdHMoZmxhdHRlbiA9IC8qKiBAdHlwZSB7RmxhdHRlbmVkfSAqLyAodHJ1ZSkpIHtcbiAgICBpZiAoIXRoaXMuaXNGaW5hbGl6ZWQoKSkge1xuICAgICAgdGhyb3cgbmV3IFNjaGVtYUZpbmFsaXphdGlvbkVycm9yKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAY2FsbGJhY2sgRGVmYXVsdFJlZHVjZXJcbiAgICAgKiBAcGFyYW0ge0RlZmF1bHRWYWx1ZXM8RmxhdHRlbmVkPn0gZGVmYXVsdHNcbiAgICAgKiBAcGFyYW0ge0FyZ1NwZWN9IGFyZ1NwZWNcbiAgICAgKiBAcmV0dXJucyB7RGVmYXVsdFZhbHVlczxGbGF0dGVuZWQ+fVxuICAgICAqL1xuICAgIC8qKiBAdHlwZSB7RGVmYXVsdFJlZHVjZXJ9ICovXG4gICAgY29uc3QgcmVkdWNlciA9IGZsYXR0ZW5cbiAgICAgID8gKGRlZmF1bHRzLCB7ZGVmYXVsdFZhbHVlLCBkZXN0fSkgPT4ge1xuICAgICAgICAgIGlmICghXy5pc1VuZGVmaW5lZChkZWZhdWx0VmFsdWUpKSB7XG4gICAgICAgICAgICBkZWZhdWx0c1tkZXN0XSA9IGRlZmF1bHRWYWx1ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIGRlZmF1bHRzO1xuICAgICAgICB9XG4gICAgICA6IChkZWZhdWx0cywge2RlZmF1bHRWYWx1ZSwgZGVzdH0pID0+IHtcbiAgICAgICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGVmYXVsdFZhbHVlKSkge1xuICAgICAgICAgICAgXy5zZXQoZGVmYXVsdHMsIGRlc3QsIGRlZmF1bHRWYWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBkZWZhdWx0cztcbiAgICAgICAgfTtcblxuICAgIC8qKiBAdHlwZSB7RGVmYXVsdFZhbHVlczxGbGF0dGVuZWQ+fSAqL1xuICAgIGNvbnN0IHJldHZhbCA9IHt9O1xuICAgIHJldHVybiBbLi4udGhpcy5fYXJnU3BlY3MudmFsdWVzKCldLnJlZHVjZShyZWR1Y2VyLCByZXR2YWwpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBmbGF0dGVuZWQgUmVjb3JkIG9mIGRlZmF1bHRzIGZvciBhIHNwZWNpZmljIGV4dGVuc2lvbi4gS2V5cyB3aWxsXG4gICAqIGJlIG9mIGZvcm1hdCBgPGFyZ05hbWU+YC5cbiAgICogQHBhcmFtIHtFeHRlbnNpb25UeXBlfSBleHRUeXBlIC0gRXh0ZW5zaW9uIHR5cGVcbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4dE5hbWUgLSBFeHRlbnNpb24gbmFtZVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZyxBcmdTcGVjRGVmYXVsdFZhbHVlPn1cbiAgICovXG4gIGdldERlZmF1bHRzRm9yRXh0ZW5zaW9uKGV4dFR5cGUsIGV4dE5hbWUpIHtcbiAgICBpZiAoIXRoaXMuaXNGaW5hbGl6ZWQoKSkge1xuICAgICAgdGhyb3cgbmV3IFNjaGVtYUZpbmFsaXphdGlvbkVycm9yKCk7XG4gICAgfVxuICAgIGNvbnN0IHNwZWNzID0gWy4uLnRoaXMuX2FyZ1NwZWNzLnZhbHVlcygpXS5maWx0ZXIoXG4gICAgICAoc3BlYykgPT4gc3BlYy5leHRUeXBlID09PSBleHRUeXBlICYmIHNwZWMuZXh0TmFtZSA9PT0gZXh0TmFtZVxuICAgICk7XG4gICAgcmV0dXJuIHNwZWNzLnJlZHVjZSgoZGVmYXVsdHMsIHtkZWZhdWx0VmFsdWUsIHJhd0Rlc3R9KSA9PiB7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGVmYXVsdFZhbHVlKSkge1xuICAgICAgICBkZWZhdWx0c1tyYXdEZXN0XSA9IGRlZmF1bHRWYWx1ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBkZWZhdWx0cztcbiAgICB9LCB7fSk7XG4gIH1cblxuICAvKipcbiAgICogRmxhdHRlbiBzY2hlbWEgaW50byBhbiBhcnJheSBvZiBgU2NoZW1hT2JqZWN0YHMgYW5kIGFzc29jaWF0ZWRcbiAgICoge0BsaW5rIEFyZ1NwZWMgQXJnU3BlY3N9LlxuICAgKlxuICAgKiBDb252ZXJ0cyBuZXN0ZWQgZXh0ZW5zaW9uIHNjaGVtYXMgdG8ga2V5cyBiYXNlZCBvbiB0aGUgZXh0ZW5zaW9uIHR5cGUgYW5kXG4gICAqIG5hbWUuIFVzZWQgd2hlbiB0cmFuc2xhdGluZyB0byBgYXJncGFyc2VgIG9wdGlvbnMgb3IgZ2V0dGluZyB0aGUgbGlzdCBvZlxuICAgKiBkZWZhdWx0IHZhbHVlcyAoc2VlIHtAbGluayBBcHBpdW1TY2hlbWEuZ2V0RGVmYXVsdHN9KSBmb3IgQ0xJIG9yIG90aGVyd2lzZS5cbiAgICpcbiAgICogVGhlIHJldHVybiB2YWx1ZSBpcyBhbiBpbnRlcm1lZGlhdGUgcmVwcnNlbnRhdGlvbiB1c2VkIGJ5IGBjbGktYXJnc2BcbiAgICogbW9kdWxlJ3MgYHRvUGFyc2VyQXJnc2AsIHdoaWNoIGNvbnZlcnRzIHRoZSBmaW5hbGl6ZWQgc2NoZW1hIHRvIHBhcmFtZXRlcnNcbiAgICogdXNlZCBieSBgYXJncGFyc2VgLlxuICAgKiBAdGhyb3dzIElmIHtAbGluayBBcHBpdW1TY2hlbWEuZmluYWxpemV9IGhhcyBub3QgYmVlbiBjYWxsZWQgeWV0LlxuICAgKiBAcmV0dXJucyB7RmxhdHRlbmVkU2NoZW1hfVxuICAgKi9cbiAgZmxhdHRlbigpIHtcbiAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldFNjaGVtYSgpO1xuXG4gICAgLyoqIEB0eXBlIHsge3Byb3BlcnRpZXM6IFNjaGVtYU9iamVjdCwgcHJlZml4OiBzdHJpbmdbXX1bXSB9ICovXG4gICAgY29uc3Qgc3RhY2sgPSBbe3Byb3BlcnRpZXM6IHNjaGVtYS5wcm9wZXJ0aWVzLCBwcmVmaXg6IFtdfV07XG4gICAgLyoqIEB0eXBlIHtGbGF0dGVuZWRTY2hlbWF9ICovXG4gICAgY29uc3QgZmxhdHRlbmVkID0gW107XG5cbiAgICAvLyB0aGlzIGJpdCBpcyBhIHJlY3Vyc2l2ZSBhbGdvcml0aG0gcmV3cml0dGVuIGFzIGEgZm9yIGxvb3AuXG4gICAgLy8gd2hlbiB3ZSBmaW5kIHNvbWV0aGluZyB3ZSB3YW50IHRvIHRyYXZlcnNlLCB3ZSBhZGQgaXQgdG8gYHN0YWNrYFxuICAgIGZvciAoY29uc3Qge3Byb3BlcnRpZXMsIHByZWZpeH0gb2Ygc3RhY2spIHtcbiAgICAgIGNvbnN0IHBhaXJzID0gXy50b1BhaXJzKHByb3BlcnRpZXMpO1xuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgcGFpcnMpIHtcbiAgICAgICAgY29uc3Qge3Byb3BlcnRpZXMsICRyZWZ9ID0gdmFsdWU7XG4gICAgICAgIGlmIChwcm9wZXJ0aWVzKSB7XG4gICAgICAgICAgc3RhY2sucHVzaCh7XG4gICAgICAgICAgICBwcm9wZXJ0aWVzLFxuICAgICAgICAgICAgcHJlZml4OiBrZXkgPT09IFNFUlZFUl9QUk9QX05BTUUgPyBbXSA6IFsuLi5wcmVmaXgsIGtleV0sXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAoJHJlZikge1xuICAgICAgICAgIGxldCByZWZTY2hlbWE7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHJlZlNjaGVtYSA9IHRoaXMuZ2V0U2NoZW1hKCRyZWYpO1xuICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgLy8gdGhpcyBjYW4gaGFwcGVuIGlmIGFuIGV4dGVuc2lvbiBzY2hlbWEgc3VwcGxpZXMgYSAkcmVmIHRvIGEgbm9uLWV4aXN0ZW50IHNjaGVtYVxuICAgICAgICAgICAgdGhyb3cgbmV3IFNjaGVtYVVua25vd25TY2hlbWFFcnJvcigkcmVmKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3Qge25vcm1hbGl6ZWRFeHROYW1lfSA9IEFyZ1NwZWMuZXh0ZW5zaW9uSW5mb0Zyb21Sb290U2NoZW1hSWQoJHJlZik7XG4gICAgICAgICAgaWYgKCFub3JtYWxpemVkRXh0TmFtZSkge1xuICAgICAgICAgICAgLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbiAgICAgICAgICAgIHRocm93IG5ldyBSZWZlcmVuY2VFcnJvcihcbiAgICAgICAgICAgICAgYENvdWxkIG5vdCBkZXRlcm1pbmUgZXh0ZW5zaW9uIG5hbWUgZnJvbSBzY2hlbWEgSUQgJHskcmVmfS4gVGhpcyBpcyBhIGJ1Zy5gXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBzdGFjay5wdXNoKHtcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHJlZlNjaGVtYS5wcm9wZXJ0aWVzLFxuICAgICAgICAgICAgcHJlZml4OiBbLi4ucHJlZml4LCBrZXksIG5vcm1hbGl6ZWRFeHROYW1lXSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChrZXkgIT09IERSSVZFUl9UWVBFICYmIGtleSAhPT0gUExVR0lOX1RZUEUpIHtcbiAgICAgICAgICBjb25zdCBbZXh0VHlwZSwgZXh0TmFtZV0gPSBwcmVmaXg7XG4gICAgICAgICAgY29uc3QgYXJnU3BlYyA9IHRoaXMuZ2V0QXJnU3BlYyhrZXksIC8qKiBAdHlwZSB7RXh0ZW5zaW9uVHlwZX0gKi8gKGV4dFR5cGUpLCBleHROYW1lKTtcbiAgICAgICAgICBpZiAoIWFyZ1NwZWMpIHtcbiAgICAgICAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgICAgICAgICB0aHJvdyBuZXcgUmVmZXJlbmNlRXJyb3IoXG4gICAgICAgICAgICAgIGBVbmtub3duIGFyZ3VtZW50IHdpdGgga2V5ICR7a2V5fSwgZXh0VHlwZSAke2V4dFR5cGV9IGFuZCBleHROYW1lICR7ZXh0TmFtZX0uIFRoaXMgaXMgYSBidWcuYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZmxhdHRlbmVkLnB1c2goe3NjaGVtYTogXy5jbG9uZURlZXAodmFsdWUpLCBhcmdTcGVjfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmxhdHRlbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyB0aGUgc2NoZW1hIGl0c2VsZlxuICAgKiBAcHVibGljXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbcmVmXSAtIFNjaGVtYSBJRFxuICAgKiBAdGhyb3dzIElmIHRoZSBzY2hlbWEgaGFzIG5vdCB5ZXQgYmVlbiBmaW5hbGl6ZWRcbiAgICogQHJldHVybnMge1NjaGVtYU9iamVjdH1cbiAgICovXG4gIGdldFNjaGVtYShyZWYgPSBBUFBJVU1fQ09ORklHX1NDSEVNQV9JRCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge1NjaGVtYU9iamVjdH0gKi8gKHRoaXMuX2dldFZhbGlkYXRvcihyZWYpLnNjaGVtYSk7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIHNjaGVtYSB2YWxpZGF0b3IgZnVuY3Rpb24gZnJvbSBBanZcbiAgICogQHBhcmFtIHtzdHJpbmd9IFtpZF0gLSBTY2hlbWEgSURcbiAgICogQHByaXZhdGVcbiAgICogQHJldHVybnMge2ltcG9ydCgnYWp2JykuVmFsaWRhdGVGdW5jdGlvbn1cbiAgICovXG4gIF9nZXRWYWxpZGF0b3IoaWQgPSBBUFBJVU1fQ09ORklHX1NDSEVNQV9JRCkge1xuICAgIGNvbnN0IHZhbGlkYXRvciA9IHRoaXMuX2Fqdi5nZXRTY2hlbWEoaWQpO1xuICAgIGlmICghdmFsaWRhdG9yKSB7XG4gICAgICBpZiAoaWQgPT09IEFQUElVTV9DT05GSUdfU0NIRU1BX0lEKSB7XG4gICAgICAgIHRocm93IG5ldyBTY2hlbWFGaW5hbGl6YXRpb25FcnJvcigpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IFNjaGVtYVVua25vd25TY2hlbWFFcnJvcihpZCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB2YWxpZGF0b3I7XG4gIH1cblxuICAvKipcbiAgICogR2l2ZW4gYW4gb2JqZWN0LCB2YWxpZGF0ZXMgaXQgYWdhaW5zdCB0aGUgQXBwaXVtIGNvbmZpZyBzY2hlbWEuXG4gICAqIElmIGVycm9ycyBvY2N1ciwgdGhlIHJldHVybmVkIGFycmF5IHdpbGwgYmUgbm9uLWVtcHR5LlxuICAgKiBAcGFyYW0ge2FueX0gdmFsdWUgLSBUaGUgdmFsdWUgKGhvcGVmdWxseSBhbiBvYmplY3QpIHRvIHZhbGlkYXRlIGFnYWluc3QgdGhlIHNjaGVtYVxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3JlZl0gLSBTY2hlbWEgSUQgb3IgcmVmLlxuICAgKiBAcHVibGljXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoJ2FqdicpLkVycm9yT2JqZWN0W119IEFycmF5IG9mIGVycm9ycywgaWYgYW55LlxuICAgKi9cbiAgdmFsaWRhdGUodmFsdWUsIHJlZiA9IEFQUElVTV9DT05GSUdfU0NIRU1BX0lEKSB7XG4gICAgY29uc3QgdmFsaWRhdG9yID0gdGhpcy5fZ2V0VmFsaWRhdG9yKHJlZik7XG4gICAgcmV0dXJuICF2YWxpZGF0b3IodmFsdWUpICYmIF8uaXNBcnJheSh2YWxpZGF0b3IuZXJyb3JzKSA/IFsuLi52YWxpZGF0b3IuZXJyb3JzXSA6IFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYHRydWVgIGlmIGBmaWxlbmFtZWAncyBmaWxlIGV4dGVuc2lvbiBpcyBhbGxvd2VkIChpbiB7QGxpbmsgQUxMT1dFRF9TQ0hFTUFfRVhURU5TSU9OU30pLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZW5hbWVcbiAgICogQHJldHVybnMge2Jvb2xlYW59XG4gICAqL1xuICBzdGF0aWMgaXNBbGxvd2VkU2NoZW1hRmlsZUV4dGVuc2lvbihmaWxlbmFtZSkge1xuICAgIHJldHVybiBBTExPV0VEX1NDSEVNQV9FWFRFTlNJT05TLmhhcyhwYXRoLmV4dG5hbWUoZmlsZW5hbWUpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGB0cnVlYCBpZiBgc2NoZW1hYCBpcyBhIHBsYWluIG9iamVjdCB3aXRoIGEgbm9uLXRydWUgYCRhc3luY2AgcHJvcGVydHkuXG4gICAqIEBwYXJhbSB7YW55fSBzY2hlbWEgLSBTY2hlbWEgdG8gY2hlY2tcbiAgICogQHJldHVybnMge3NjaGVtYSBpcyBTY2hlbWFPYmplY3R9XG4gICAqL1xuICBzdGF0aWMgaXNTdXBwb3J0ZWRTY2hlbWFUeXBlKHNjaGVtYSkge1xuICAgIHJldHVybiBfLmlzUGxhaW5PYmplY3Qoc2NoZW1hKSAmJiBzY2hlbWEuJGFzeW5jICE9PSB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogVGhyb3duIHdoZW4gdGhlIHtAbGluayBBcHBpdW1TY2hlbWF9IGluc3RhbmNlIGhhcyBub3QgeWV0IGJlZW4gZmluYWxpemVkLCBidXRcbiAqIHRoZSBtZXRob2QgY2FsbGVkIHJlcXVpcmVzIGl0LlxuICovXG5leHBvcnQgY2xhc3MgU2NoZW1hRmluYWxpemF0aW9uRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBAdHlwZSB7UmVhZG9ubHk8c3RyaW5nPn1cbiAgICovXG4gIGNvZGUgPSAnQVBQSVVNRVJSX1NDSEVNQV9GSU5BTElaQVRJT04nO1xuXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKCdTY2hlbWEgbm90IHlldCBmaW5hbGl6ZWQ7IGBmaW5hbGl6ZSgpYCBtdXN0IGJlIGNhbGxlZCBmaXJzdC4nKTtcbiAgfVxufVxuXG4vKipcbiAqIFRocm93biB3aGVuIGEgXCJ1bmlxdWVcIiBzY2hlbWEgSUQgY29uZmxpY3RzIHdpdGggYW4gZXhpc3Rpbmcgc2NoZW1hIElELlxuICpcbiAqIFRoaXMgaXMgbGlrZWx5IGdvaW5nIHRvIGJlIGNhdXNlZCBieSBhdHRlbXB0aW5nIHRvIHJlZ2lzdGVyIHRoZSBzYW1lIHNjaGVtYSB0d2ljZS5cbiAqL1xuZXhwb3J0IGNsYXNzIFNjaGVtYU5hbWVDb25mbGljdEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogQHR5cGUge1JlYWRvbmx5PHN0cmluZz59XG4gICAqL1xuICBjb2RlID0gJ0FQUElVTUVSUl9TQ0hFTUFfTkFNRV9DT05GTElDVCc7XG5cbiAgLyoqXG4gICAqIEB0eXBlIHtSZWFkb25seTx7ZXh0VHlwZTogRXh0ZW5zaW9uVHlwZSwgZXh0TmFtZTogc3RyaW5nfT59XG4gICAqL1xuICBkYXRhO1xuXG4gIC8qKlxuICAgKiBAcGFyYW0ge0V4dGVuc2lvblR5cGV9IGV4dFR5cGVcbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4dE5hbWVcbiAgICovXG4gIGNvbnN0cnVjdG9yKGV4dFR5cGUsIGV4dE5hbWUpIHtcbiAgICBzdXBlcihgTmFtZSBmb3IgJHtleHRUeXBlfSBzY2hlbWEgXCIke2V4dE5hbWV9XCIgY29uZmxpY3RzIHdpdGggYW4gZXhpc3Rpbmcgc2NoZW1hYCk7XG4gICAgdGhpcy5kYXRhID0ge2V4dFR5cGUsIGV4dE5hbWV9O1xuICB9XG59XG5cbi8qKlxuICogVGhyb3duIHdoZW4gYSBzY2hlbWEgSUQgd2FzIGV4cGVjdGVkLCBidXQgaXQgZG9lc24ndCBleGlzdCBvbiB0aGUge0BsaW5rIEFqdn0gaW5zdGFuY2UuXG4gKi9cbmV4cG9ydCBjbGFzcyBTY2hlbWFVbmtub3duU2NoZW1hRXJyb3IgZXh0ZW5kcyBSZWZlcmVuY2VFcnJvciB7XG4gIC8qKlxuICAgKiBAdHlwZSB7UmVhZG9ubHk8c3RyaW5nPn1cbiAgICovXG4gIGNvZGUgPSAnQVBQSVVNRVJSX1NDSEVNQV9VTktOT1dOX1NDSEVNQSc7XG5cbiAgLyoqXG4gICAqIEB0eXBlIHtSZWFkb25seTx7c2NoZW1hSWQ6IHN0cmluZ30+fVxuICAgKi9cbiAgZGF0YTtcblxuICAvKipcbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVtYUlkXG4gICAqL1xuICBjb25zdHJ1Y3RvcihzY2hlbWFJZCkge1xuICAgIHN1cGVyKGBVbmtub3duIHNjaGVtYTogXCIke3NjaGVtYUlkfVwiYCk7XG4gICAgdGhpcy5kYXRhID0ge3NjaGVtYUlkfTtcbiAgfVxufVxuXG4vKipcbiAqIFRocm93biB3aGVuIGEgc2NoZW1hIGlzIHByb3ZpZGVkLCBidXQgaXQncyBvZiBhbiB1bnN1cHBvcnRlZCB0eXBlLlxuICpcbiAqIFwiVmFsaWRcIiBzY2hlbWFzIHdoaWNoIGFyZSB1bnN1cHBvcnRlZCBpbmNsdWRlIGJvb2xlYW4gc2NoZW1hcyBhbmQgYXN5bmMgc2NoZW1hc1xuICogKGhhdmluZyBhIGB0cnVlYCBgJGFzeW5jYCBwcm9wZXJ0eSkuXG4gKi9cbmV4cG9ydCBjbGFzcyBTY2hlbWFVbnN1cHBvcnRlZFNjaGVtYUVycm9yIGV4dGVuZHMgVHlwZUVycm9yIHtcbiAgLyoqXG4gICAqIEB0eXBlIHtSZWFkb25seTxzdHJpbmc+fVxuICAgKi9cbiAgY29kZSA9ICdBUFBJVU1FUlJfU0NIRU1BX1VOU1VQUE9SVEVEX1NDSEVNQSc7XG5cbiAgLyoqXG4gICAqIEB0eXBlIHtSZWFkb25seTx7c2NoZW1hOiBhbnksIGV4dFR5cGU6IEV4dGVuc2lvblR5cGUsIGV4dE5hbWU6IHN0cmluZ30+fVxuICAgKi9cbiAgZGF0YTtcblxuICAvKipcbiAgICogQHBhcmFtIHthbnl9IHNjaGVtYVxuICAgKiBAcGFyYW0ge0V4dGVuc2lvblR5cGV9IGV4dFR5cGVcbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4dE5hbWVcbiAgICovXG4gIGNvbnN0cnVjdG9yKHNjaGVtYSwgZXh0VHlwZSwgZXh0TmFtZSkge1xuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9NaWNyb3NvZnQvVHlwZVNjcmlwdC9pc3N1ZXMvODI3N1xuICAgIHN1cGVyKFxuICAgICAgKCgpID0+IHtcbiAgICAgICAgbGV0IG1zZyA9IGBVbnN1cHBvcnRlZCBzY2hlbWEgZnJvbSAke2V4dFR5cGV9IFwiJHtleHROYW1lfVwiOmA7XG4gICAgICAgIGlmIChfLmlzQm9vbGVhbihzY2hlbWEpKSB7XG4gICAgICAgICAgcmV0dXJuIGAke21zZ30gc2NoZW1hIGNhbm5vdCBiZSBhIGJvb2xlYW5gO1xuICAgICAgICB9XG4gICAgICAgIGlmIChfLmlzUGxhaW5PYmplY3Qoc2NoZW1hKSkge1xuICAgICAgICAgIGlmIChzY2hlbWEuJGFzeW5jKSB7XG4gICAgICAgICAgICByZXR1cm4gYCR7bXNnfSBzY2hlbWEgY2Fubm90IGJlIGFuIGFzeW5jIHNjaGVtYWA7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICAgIGBzY2hlbWEgSVMgc3VwcG9ydGVkOyB0aGlzIGVycm9yIHNob3VsZCBub3QgYmUgdGhyb3duICh0aGlzIGlzIGEgYnVnKS4gdmFsdWUgb2Ygc2NoZW1hOiAke0pTT04uc3RyaW5naWZ5KFxuICAgICAgICAgICAgICBzY2hlbWFcbiAgICAgICAgICAgICl9YFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGAke21zZ30gc2NoZW1hIG11c3QgYmUgYSBwbGFpbiBvYmplY3Qgd2l0aG91dCBhIHRydWUgXCIkYXN5bmNcIiBwcm9wZXJ0eWA7XG4gICAgICB9KSgpXG4gICAgKTtcbiAgICB0aGlzLmRhdGEgPSB7c2NoZW1hLCBleHRUeXBlLCBleHROYW1lfTtcbiAgfVxufVxuXG5jb25zdCBhcHBpdW1TY2hlbWEgPSBBcHBpdW1TY2hlbWEuY3JlYXRlKCk7XG5cbmV4cG9ydCBjb25zdCB7XG4gIHJlZ2lzdGVyU2NoZW1hLFxuICBnZXRBbGxBcmdTcGVjcyxcbiAgZ2V0QXJnU3BlYyxcbiAgaGFzQXJnU3BlYyxcbiAgaXNGaW5hbGl6ZWQsXG4gIGZpbmFsaXplOiBmaW5hbGl6ZVNjaGVtYSxcbiAgcmVzZXQ6IHJlc2V0U2NoZW1hLFxuICB2YWxpZGF0ZSxcbiAgZ2V0U2NoZW1hLFxuICBmbGF0dGVuOiBmbGF0dGVuU2NoZW1hLFxuICBnZXREZWZhdWx0czogZ2V0RGVmYXVsdHNGb3JTY2hlbWEsXG4gIGdldERlZmF1bHRzRm9yRXh0ZW5zaW9uLFxufSA9IGFwcGl1bVNjaGVtYTtcbmV4cG9ydCBjb25zdCB7aXNBbGxvd2VkU2NoZW1hRmlsZUV4dGVuc2lvbn0gPSBBcHBpdW1TY2hlbWE7XG5cbi8qKlxuICogQXBwaXVtIG9ubHkgc3VwcG9ydHMgc2NoZW1hcyB0aGF0IGFyZSBwbGFpbiBvYmplY3RzOyBub3QgYXJyYXlzLlxuICogQHR5cGVkZWYge2ltcG9ydCgnYWp2JykuU2NoZW1hT2JqZWN0ICYge1trZXk6IG51bWJlcl06IG5ldmVyfX0gU2NoZW1hT2JqZWN0XG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdAYXBwaXVtL3R5cGVzJykuRXh0ZW5zaW9uVHlwZX0gRXh0ZW5zaW9uVHlwZVxuICovXG5cbi8qKlxuICogQW4gb2JqZWN0IGhhdmluZyBwcm9wZXJ0eSBgYWRkaXRpb25hbFByb3BlcnRpZXM6IGZhbHNlYFxuICogQHR5cGVkZWYgU3RyaWN0UHJvcFxuICogQHByb3BlcnR5IHtmYWxzZX0gYWRkaXRpb25hbFByb3BlcnRpZXNcbiAqL1xuXG4vKipcbiAqIEEge0BsaW5rIFNjaGVtYU9iamVjdH0gd2l0aCBgYWRkaXRpb25hbFByb3BlcnRpZXM6IGZhbHNlYFxuICogQHR5cGVkZWYge1NjaGVtYU9iamVjdCAmIFN0cmljdFByb3B9IFN0cmljdFNjaGVtYU9iamVjdFxuICovXG5cbi8qKlxuICogQSBsaXN0IG9mIHNjaGVtYXMgYXNzb2NpYXRlZCB3aXRoIHByb3BlcnRpZXMgYW5kIHRoZWlyIGNvcnJlc3BvbmRpbmcge0BsaW5rIEFyZ1NwZWN9IG9iamVjdHMuXG4gKlxuICogSW50ZXJtZWRpYXRlIGRhdGEgc3RydWN0dXJlIHVzZWQgd2hlbiBjb252ZXJ0aW5nIHRoZSBlbnRpcmUgc2NoZW1hIGRvd24gdG8gQ0xJIGFyZ3VtZW50cy5cbiAqIEB0eXBlZGVmIHsge3NjaGVtYTogU2NoZW1hT2JqZWN0LCBhcmdTcGVjOiBBcmdTcGVjfVtdIH0gRmxhdHRlbmVkU2NoZW1hXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7QXJnU3BlY1snZGVmYXVsdFZhbHVlJ119IEFyZ1NwZWNEZWZhdWx0VmFsdWVcbiAqL1xuXG4vKipcbiAqIGUuZy4gYHtkcml2ZXI6IHtmb286ICdiYXInfX1gIHdoZXJlIGBmb29gIGlzIHRoZSBhcmcgbmFtZSBhbmQgYGJhcmAgaXMgdGhlIGRlZmF1bHQgdmFsdWUuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZyxSZWNvcmQ8c3RyaW5nLEFyZ1NwZWNEZWZhdWx0VmFsdWU+Pn0gTmVzdGVkQXJnU3BlY0RlZmF1bHRWYWx1ZVxuICovXG5cbi8qKlxuICogSGVscGVyIHR5cGUgZm9yIHRoZSByZXR1cm4gdmFsdWUgb2Yge0BsaW5rIEFwcGl1bVNjaGVtYS5nZXREZWZhdWx0c31cbiAqIEB0ZW1wbGF0ZSB7Ym9vbGVhbnx1bmRlZmluZWR9IEZsYXR0ZW5lZFxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsRmxhdHRlbmVkIGV4dGVuZHMgdHJ1ZSA/IEFyZ1NwZWNEZWZhdWx0VmFsdWUgOiBBcmdTcGVjRGVmYXVsdFZhbHVlIHwgTmVzdGVkQXJnU3BlY0RlZmF1bHRWYWx1ZT59IERlZmF1bHRWYWx1ZXNcbiAqL1xuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7OztBQVFPLE1BQU1BLGFBQU4sU0FBNEJDLEdBQTVCLENBQWdDO0VBS3JDQyxHQUFHLENBQUNDLEdBQUQsRUFBTUMsS0FBTixFQUFhO0lBQ2QsSUFBSSxLQUFLQyxHQUFMLENBQVNGLEdBQVQsQ0FBSixFQUFtQjtNQUNqQixNQUFNLElBQUlHLEtBQUosQ0FBVyxHQUFFSCxHQUFJLGlCQUFqQixDQUFOO0lBQ0Q7O0lBQ0QsT0FBTyxNQUFNRCxHQUFOLENBQVVDLEdBQVYsRUFBZUMsS0FBZixDQUFQO0VBQ0Q7O0VBTURHLE1BQU0sQ0FBQ0osR0FBRCxFQUFNO0lBQ1YsT0FBTyxLQUFQO0VBQ0Q7O0VBRURLLEtBQUssR0FBRztJQUNOLE1BQU0sSUFBSUYsS0FBSixDQUFXLDRCQUFYLENBQU47RUFDRDs7QUF0Qm9DOzs7QUE0QmhDLE1BQU1HLHlCQUF5QixHQUFHLElBQUlDLEdBQUosQ0FBUSxDQUFDLE9BQUQsRUFBVSxLQUFWLEVBQWlCLE1BQWpCLENBQVIsQ0FBbEM7OztBQU9QLE1BQU1DLFlBQU4sQ0FBbUI7RUFVakJDLFNBQVMsR0FBRyxJQUFJWixhQUFKLEVBQUg7RUFVVGEsa0JBQWtCLEdBQUc7SUFBQyxDQUFDQyxzQkFBRCxHQUFlLElBQUliLEdBQUosRUFBaEI7SUFBMkIsQ0FBQ2Msc0JBQUQsR0FBZSxJQUFJZCxHQUFKO0VBQTFDLENBQUg7RUFRbEJlLElBQUk7RUFPWSxPQUFUQyxTQUFTO0VBU2hCQyxpQkFBaUIsR0FBRyxJQUFI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