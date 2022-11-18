"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.INSTALL_TYPE_NPM = exports.INSTALL_TYPE_LOCAL = exports.INSTALL_TYPE_GITHUB = exports.INSTALL_TYPE_GIT = exports.INSTALL_TYPES = exports.ExtensionConfig = void 0;

require("source-map-support/register");

var _lodash = _interopRequireDefault(require("lodash"));

var _bluebird = _interopRequireDefault(require("bluebird"));

var _path = _interopRequireDefault(require("path"));

var _resolveFrom = _interopRequireDefault(require("resolve-from"));

var _semver = require("semver");

var _support = require("@appium/support");

var _extension = require("../cli/extension");

var _config = require("../config");

var _logger = _interopRequireDefault(require("../logger"));

var _schema = require("../schema/schema");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const INSTALL_TYPE_NPM = 'npm';
exports.INSTALL_TYPE_NPM = INSTALL_TYPE_NPM;
const INSTALL_TYPE_LOCAL = 'local';
exports.INSTALL_TYPE_LOCAL = INSTALL_TYPE_LOCAL;
const INSTALL_TYPE_GITHUB = 'github';
exports.INSTALL_TYPE_GITHUB = INSTALL_TYPE_GITHUB;
const INSTALL_TYPE_GIT = 'git';
exports.INSTALL_TYPE_GIT = INSTALL_TYPE_GIT;
const INSTALL_TYPES = new Set([INSTALL_TYPE_GIT, INSTALL_TYPE_GITHUB, INSTALL_TYPE_LOCAL, INSTALL_TYPE_NPM]);
exports.INSTALL_TYPES = INSTALL_TYPES;

class ExtensionConfig {
  extensionType;
  configKey;
  installedExtensions;
  log;
  manifest;
  _listDataCache;

  constructor(extensionType, manifest) {
    this.extensionType = extensionType;
    this.configKey = `${extensionType}s`;
    this.installedExtensions = manifest.getExtensionData(extensionType);
    this.manifest = manifest;
  }

  get manifestPath() {
    return this.manifest.manifestPath;
  }

  get appiumHome() {
    return this.manifest.appiumHome;
  }

  getProblems(extName, extManifest) {
    return [...this.getGenericConfigProblems(extManifest, extName), ...this.getConfigProblems(extManifest, extName), ...this.getSchemaProblems(extManifest, extName)];
  }

  async getWarnings(extName, extManifest) {
    const [genericConfigWarnings, configWarnings] = await _bluebird.default.all([this.getGenericConfigWarnings(extManifest, extName), this.getConfigWarnings(extManifest, extName)]);
    return [...genericConfigWarnings, ...configWarnings];
  }

  async getConfigWarnings(extManifest, extName) {
    return [];
  }

  getValidationResultSummaries(errorMap = new Map(), warningMap = new Map()) {
    const errorSummaries = [];

    for (const [extName, problems] of errorMap.entries()) {
      if (_lodash.default.isEmpty(problems)) {
        continue;
      }

      errorSummaries.push(`${this.extensionType} "${extName}" had ${_support.util.pluralize('error', problems.length)} and will not be available:`);

      for (const problem of problems) {
        errorSummaries.push(`  - ${problem.err} (Actual value: ` + `${JSON.stringify(problem.val)})`);
      }
    }

    const warningSummaries = [];

    for (const [extName, warnings] of warningMap.entries()) {
      if (_lodash.default.isEmpty(warnings)) {
        continue;
      }

      const extTypeText = _lodash.default.capitalize(this.extensionType);

      const problemEnumerationText = _support.util.pluralize('potential problem', warnings.length, true);

      warningSummaries.push(`${extTypeText} "${extName}" has ${problemEnumerationText}: `);

      for (const warning of warnings) {
        warningSummaries.push(`  - ${warning}`);
      }
    }

    return {
      errorSummaries,
      warningSummaries
    };
  }

  async _validate(exts) {
    const errorMap = new Map();
    const warningMap = new Map();

    for (const [extName, extManifest] of _lodash.default.toPairs(exts)) {
      const [errors, warnings] = await _bluebird.default.all([this.getProblems(extName, extManifest), this.getWarnings(extName, extManifest)]);

      if (errors.length) {
        delete exts[extName];
      }

      errorMap.set(extName, errors);
      warningMap.set(extName, warnings);
    }

    const {
      errorSummaries,
      warningSummaries
    } = this.getValidationResultSummaries(errorMap, warningMap);

    if (!_lodash.default.isEmpty(errorSummaries)) {
      _logger.default.error(`Appium encountered ${_support.util.pluralize('error', errorMap.size, true)} while validating ${this.configKey} found in manifest ${this.manifestPath}`);

      for (const summary of errorSummaries) {
        _logger.default.error(summary);
      }
    } else {
      if (!_lodash.default.isEmpty(warningSummaries)) {
        _logger.default.warn(`Appium encountered ${_support.util.pluralize('warning', warningMap.size, true)} while validating ${this.configKey} found in manifest ${this.manifestPath}`);

        for (const summary of warningSummaries) {
          _logger.default.warn(summary);
        }
      }
    }

    return exts;
  }

  async getListData() {
    if (this._listDataCache) {
      return this._listDataCache;
    }

    const CommandClass = _extension.commandClasses[this.extensionType];
    const cmd = new CommandClass({
      config: this,
      json: true
    });
    const listData = await cmd.list({
      showInstalled: true,
      showUpdates: true
    });
    this._listDataCache = listData;
    return listData;
  }

  async getGenericConfigWarnings(extManifest, extName) {
    const {
      appiumVersion,
      installSpec,
      installType,
      pkgName
    } = extManifest;
    const warnings = [];
    const invalidFields = [];

    if (!_lodash.default.isString(installSpec)) {
      invalidFields.push('installSpec');
    }

    if (!INSTALL_TYPES.has(installType)) {
      invalidFields.push('installType');
    }

    const extTypeText = _lodash.default.capitalize(this.extensionType);

    if (invalidFields.length) {
      const invalidFieldsEnumerationText = _support.util.pluralize('invalid or missing field', invalidFields.length, true);

      const invalidFieldsText = invalidFields.map(field => `"${field}"`).join(', ');
      warnings.push(`${extTypeText} "${extName}" (package \`${pkgName}\`) has ${invalidFieldsEnumerationText} (${invalidFieldsText}) in \`extensions.yaml\`; this may cause upgrades done via the \`appium\` CLI tool to fail. Please reinstall with \`appium ${this.extensionType} uninstall ${extName}\` and \`appium ${this.extensionType} install ${extName}\` to attempt a fix.`);
    }

    const createPeerWarning = reason => `${extTypeText} "${extName}" (package \`${pkgName}\`) may be incompatible with the current version of Appium (v${_config.APPIUM_VER}) due to ${reason}`;

    if (_lodash.default.isString(appiumVersion) && !(0, _semver.satisfies)(_config.APPIUM_VER, appiumVersion)) {
      const listData = await this.getListData();
      const extListData = listData[extName];

      if (extListData !== null && extListData !== void 0 && extListData.installed) {
        const {
          updateVersion,
          upToDate
        } = extListData;

        if (!upToDate) {
          warnings.push(createPeerWarning(`its peer dependency on older Appium v${appiumVersion}. Please upgrade \`${pkgName}\` to v${updateVersion} or newer.`));
        } else {
          warnings.push(createPeerWarning(`its peer dependency on older Appium v${appiumVersion}. Please ask the developer of \`${pkgName}\` to update the peer dependency on Appium to v${_config.APPIUM_VER}.`));
        }
      }
    } else if (!_lodash.default.isString(appiumVersion)) {
      const listData = await this.getListData();
      const extListData = listData[extName];

      if (!(extListData !== null && extListData !== void 0 && extListData.upToDate) && extListData !== null && extListData !== void 0 && extListData.updateVersion) {
        warnings.push(createPeerWarning(`an invalid or missing peer dependency on Appium. A newer version of \`${pkgName}\` is available; please attempt to upgrade "${extName}" to v${extListData.updateVersion} or newer.`));
      } else {
        warnings.push(createPeerWarning(`an invalid or missing peer dependency on Appium. Please ask the developer of \`${pkgName}\` to add a peer dependency on \`^appium@${_config.APPIUM_VER}\`.`));
      }
    }

    return warnings;
  }

  getSchemaProblems(extManifest, extName) {
    const problems = [];
    const {
      schema: argSchemaPath
    } = extManifest;

    if (ExtensionConfig.extDataHasSchema(extManifest)) {
      if (_lodash.default.isString(argSchemaPath)) {
        if ((0, _schema.isAllowedSchemaFileExtension)(argSchemaPath)) {
          try {
            this.readExtensionSchema(extName, extManifest);
          } catch (err) {
            problems.push({
              err: `Unable to register schema at path ${argSchemaPath}; ${err.message}`,
              val: argSchemaPath
            });
          }
        } else {
          problems.push({
            err: `Schema file has unsupported extension. Allowed: ${[..._schema.ALLOWED_SCHEMA_EXTENSIONS].join(', ')}`,
            val: argSchemaPath
          });
        }
      } else if (_lodash.default.isPlainObject(argSchemaPath)) {
        try {
          this.readExtensionSchema(extName, extManifest);
        } catch (err) {
          problems.push({
            err: `Unable to register embedded schema; ${err.message}`,
            val: argSchemaPath
          });
        }
      } else {
        problems.push({
          err: 'Incorrectly formatted schema field; must be a path to a schema file or a schema object.',
          val: argSchemaPath
        });
      }
    }

    return problems;
  }

  getGenericConfigProblems(extManifest, extName) {
    const {
      version,
      pkgName,
      mainClass
    } = extManifest;
    const problems = [];

    if (!_lodash.default.isString(version)) {
      problems.push({
        err: `Invalid or missing \`version\` field in my \`package.json\` and/or \`extensions.yaml\` (must be a string)`,
        val: version
      });
    }

    if (!_lodash.default.isString(pkgName)) {
      problems.push({
        err: `Invalid or missing \`name\` field in my \`package.json\` and/or \`extensions.yaml\` (must be a string)`,
        val: pkgName
      });
    }

    if (!_lodash.default.isString(mainClass)) {
      problems.push({
        err: `Invalid or missing \`appium.mainClass\` field in my \`package.json\` and/or \`mainClass\` field in \`extensions.yaml\` (must be a string)`,
        val: mainClass
      });
    }

    return problems;
  }

  getConfigProblems(extManifest, extName) {
    return [];
  }

  async addExtension(extName, extManifest, {
    write = true
  } = {}) {
    this.manifest.addExtension(this.extensionType, extName, extManifest);

    if (write) {
      await this.manifest.write();
    }
  }

  async updateExtension(extName, extManifest, {
    write = true
  } = {}) {
    this.installedExtensions[extName] = { ...this.installedExtensions[extName],
      ...extManifest
    };

    if (write) {
      await this.manifest.write();
    }
  }

  async removeExtension(extName, {
    write = true
  } = {}) {
    delete this.installedExtensions[extName];

    if (write) {
      await this.manifest.write();
    }
  }

  print(activeNames) {
    if (_lodash.default.isEmpty(this.installedExtensions)) {
      _logger.default.info(`No ${this.configKey} have been installed in ${this.appiumHome}. Use the "appium ${this.extensionType}" ` + 'command to install the one(s) you want to use.');

      return;
    }

    _logger.default.info(`Available ${this.configKey}:`);

    for (const [extName, extManifest] of _lodash.default.toPairs(this.installedExtensions)) {
      _logger.default.info(`  - ${this.extensionDesc(extName, extManifest)}`);
    }
  }

  extensionDesc(extName, extManifest) {
    throw new Error('This must be implemented in a subclass');
  }

  getInstallPath(extName) {
    return _path.default.join(this.appiumHome, 'node_modules', this.installedExtensions[extName].pkgName);
  }

  require(extName) {
    const {
      mainClass
    } = this.installedExtensions[extName];
    const reqPath = this.getInstallPath(extName);
    let reqResolved;

    try {
      reqResolved = require.resolve(reqPath);
    } catch (err) {
      throw new ReferenceError(`Could not find a ${this.extensionType} installed at ${reqPath}`);
    }

    if (process.env.APPIUM_RELOAD_EXTENSIONS && require.cache[reqResolved]) {
      _logger.default.debug(`Removing ${reqResolved} from require cache`);

      delete require.cache[reqResolved];
    }

    _logger.default.debug(`Requiring ${this.extensionType} at ${reqPath}`);

    const MainClass = require(reqPath)[mainClass];

    if (!MainClass) {
      throw new ReferenceError(`Could not find a class named "${mainClass}" exported by ${this.extensionType} "${extName}"`);
    }

    return MainClass;
  }

  isInstalled(extName) {
    return _lodash.default.includes(Object.keys(this.installedExtensions), extName);
  }

  static _readExtensionSchema(appiumHome, extType, extName, extManifest) {
    const {
      pkgName,
      schema: argSchemaPath
    } = extManifest;

    if (!argSchemaPath) {
      throw new TypeError(`No \`schema\` property found in config for ${extType} ${pkgName} -- why is this function being called?`);
    }

    let moduleObject;

    if (_lodash.default.isString(argSchemaPath)) {
      const schemaPath = (0, _resolveFrom.default)(appiumHome, _path.default.join(pkgName, argSchemaPath));
      moduleObject = require(schemaPath);
    } else {
      moduleObject = argSchemaPath;
    }

    const schema = moduleObject.__esModule ? moduleObject.default : moduleObject;
    (0, _schema.registerSchema)(extType, extName, schema);
    return schema;
  }

  static extDataHasSchema(extManifest) {
    return _lodash.default.isString(extManifest === null || extManifest === void 0 ? void 0 : extManifest.schema) || _lodash.default.isObject(extManifest === null || extManifest === void 0 ? void 0 : extManifest.schema);
  }

  readExtensionSchema(extName, extManifest) {
    return ExtensionConfig._readExtensionSchema(this.appiumHome, this.extensionType, extName, extManifest);
  }

}

exports.ExtensionConfig = ExtensionConfig;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJJTlNUQUxMX1RZUEVfTlBNIiwiSU5TVEFMTF9UWVBFX0xPQ0FMIiwiSU5TVEFMTF9UWVBFX0dJVEhVQiIsIklOU1RBTExfVFlQRV9HSVQiLCJJTlNUQUxMX1RZUEVTIiwiU2V0IiwiRXh0ZW5zaW9uQ29uZmlnIiwiZXh0ZW5zaW9uVHlwZSIsImNvbmZpZ0tleSIsImluc3RhbGxlZEV4dGVuc2lvbnMiLCJsb2ciLCJtYW5pZmVzdCIsIl9saXN0RGF0YUNhY2hlIiwiY29uc3RydWN0b3IiLCJnZXRFeHRlbnNpb25EYXRhIiwibWFuaWZlc3RQYXRoIiwiYXBwaXVtSG9tZSIsImdldFByb2JsZW1zIiwiZXh0TmFtZSIsImV4dE1hbmlmZXN0IiwiZ2V0R2VuZXJpY0NvbmZpZ1Byb2JsZW1zIiwiZ2V0Q29uZmlnUHJvYmxlbXMiLCJnZXRTY2hlbWFQcm9ibGVtcyIsImdldFdhcm5pbmdzIiwiZ2VuZXJpY0NvbmZpZ1dhcm5pbmdzIiwiY29uZmlnV2FybmluZ3MiLCJCIiwiYWxsIiwiZ2V0R2VuZXJpY0NvbmZpZ1dhcm5pbmdzIiwiZ2V0Q29uZmlnV2FybmluZ3MiLCJnZXRWYWxpZGF0aW9uUmVzdWx0U3VtbWFyaWVzIiwiZXJyb3JNYXAiLCJNYXAiLCJ3YXJuaW5nTWFwIiwiZXJyb3JTdW1tYXJpZXMiLCJwcm9ibGVtcyIsImVudHJpZXMiLCJfIiwiaXNFbXB0eSIsInB1c2giLCJ1dGlsIiwicGx1cmFsaXplIiwibGVuZ3RoIiwicHJvYmxlbSIsImVyciIsIkpTT04iLCJzdHJpbmdpZnkiLCJ2YWwiLCJ3YXJuaW5nU3VtbWFyaWVzIiwid2FybmluZ3MiLCJleHRUeXBlVGV4dCIsImNhcGl0YWxpemUiLCJwcm9ibGVtRW51bWVyYXRpb25UZXh0Iiwid2FybmluZyIsIl92YWxpZGF0ZSIsImV4dHMiLCJ0b1BhaXJzIiwiZXJyb3JzIiwic2V0IiwiZXJyb3IiLCJzaXplIiwic3VtbWFyeSIsIndhcm4iLCJnZXRMaXN0RGF0YSIsIkNvbW1hbmRDbGFzcyIsImNvbW1hbmRDbGFzc2VzIiwiY21kIiwiY29uZmlnIiwianNvbiIsImxpc3REYXRhIiwibGlzdCIsInNob3dJbnN0YWxsZWQiLCJzaG93VXBkYXRlcyIsImFwcGl1bVZlcnNpb24iLCJpbnN0YWxsU3BlYyIsImluc3RhbGxUeXBlIiwicGtnTmFtZSIsImludmFsaWRGaWVsZHMiLCJpc1N0cmluZyIsImhhcyIsImludmFsaWRGaWVsZHNFbnVtZXJhdGlvblRleHQiLCJpbnZhbGlkRmllbGRzVGV4dCIsIm1hcCIsImZpZWxkIiwiam9pbiIsImNyZWF0ZVBlZXJXYXJuaW5nIiwicmVhc29uIiwiQVBQSVVNX1ZFUiIsInNhdGlzZmllcyIsImV4dExpc3REYXRhIiwiaW5zdGFsbGVkIiwidXBkYXRlVmVyc2lvbiIsInVwVG9EYXRlIiwic2NoZW1hIiwiYXJnU2NoZW1hUGF0aCIsImV4dERhdGFIYXNTY2hlbWEiLCJpc0FsbG93ZWRTY2hlbWFGaWxlRXh0ZW5zaW9uIiwicmVhZEV4dGVuc2lvblNjaGVtYSIsIm1lc3NhZ2UiLCJBTExPV0VEX1NDSEVNQV9FWFRFTlNJT05TIiwiaXNQbGFpbk9iamVjdCIsInZlcnNpb24iLCJtYWluQ2xhc3MiLCJhZGRFeHRlbnNpb24iLCJ3cml0ZSIsInVwZGF0ZUV4dGVuc2lvbiIsInJlbW92ZUV4dGVuc2lvbiIsInByaW50IiwiYWN0aXZlTmFtZXMiLCJpbmZvIiwiZXh0ZW5zaW9uRGVzYyIsIkVycm9yIiwiZ2V0SW5zdGFsbFBhdGgiLCJwYXRoIiwicmVxdWlyZSIsInJlcVBhdGgiLCJyZXFSZXNvbHZlZCIsInJlc29sdmUiLCJSZWZlcmVuY2VFcnJvciIsInByb2Nlc3MiLCJlbnYiLCJBUFBJVU1fUkVMT0FEX0VYVEVOU0lPTlMiLCJjYWNoZSIsImRlYnVnIiwiTWFpbkNsYXNzIiwiaXNJbnN0YWxsZWQiLCJpbmNsdWRlcyIsIk9iamVjdCIsImtleXMiLCJfcmVhZEV4dGVuc2lvblNjaGVtYSIsImV4dFR5cGUiLCJUeXBlRXJyb3IiLCJtb2R1bGVPYmplY3QiLCJzY2hlbWFQYXRoIiwicmVzb2x2ZUZyb20iLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsInJlZ2lzdGVyU2NoZW1hIiwiaXNPYmplY3QiXSwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvZXh0ZW5zaW9uL2V4dGVuc2lvbi1jb25maWcuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCBCIGZyb20gJ2JsdWViaXJkJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHJlc29sdmVGcm9tIGZyb20gJ3Jlc29sdmUtZnJvbSc7XG5pbXBvcnQge3NhdGlzZmllc30gZnJvbSAnc2VtdmVyJztcbmltcG9ydCB7dXRpbH0gZnJvbSAnQGFwcGl1bS9zdXBwb3J0JztcbmltcG9ydCB7Y29tbWFuZENsYXNzZXN9IGZyb20gJy4uL2NsaS9leHRlbnNpb24nO1xuaW1wb3J0IHtBUFBJVU1fVkVSfSBmcm9tICcuLi9jb25maWcnO1xuaW1wb3J0IGxvZyBmcm9tICcuLi9sb2dnZXInO1xuaW1wb3J0IHtcbiAgQUxMT1dFRF9TQ0hFTUFfRVhURU5TSU9OUyxcbiAgaXNBbGxvd2VkU2NoZW1hRmlsZUV4dGVuc2lvbixcbiAgcmVnaXN0ZXJTY2hlbWEsXG59IGZyb20gJy4uL3NjaGVtYS9zY2hlbWEnO1xuXG5jb25zdCBJTlNUQUxMX1RZUEVfTlBNID0gJ25wbSc7XG5jb25zdCBJTlNUQUxMX1RZUEVfTE9DQUwgPSAnbG9jYWwnO1xuY29uc3QgSU5TVEFMTF9UWVBFX0dJVEhVQiA9ICdnaXRodWInO1xuY29uc3QgSU5TVEFMTF9UWVBFX0dJVCA9ICdnaXQnO1xuXG4vKiogQHR5cGUge1NldDxJbnN0YWxsVHlwZT59ICovXG5jb25zdCBJTlNUQUxMX1RZUEVTID0gbmV3IFNldChbXG4gIElOU1RBTExfVFlQRV9HSVQsXG4gIElOU1RBTExfVFlQRV9HSVRIVUIsXG4gIElOU1RBTExfVFlQRV9MT0NBTCxcbiAgSU5TVEFMTF9UWVBFX05QTSxcbl0pO1xuXG4vKipcbiAqIFRoaXMgY2xhc3MgaXMgYWJzdHJhY3QuIEl0IHNob3VsZCBub3QgYmUgaW5zdGFudGlhdGVkIGRpcmVjdGx5LlxuICpcbiAqIFN1YmNsYXNzZXMgc2hvdWxkIHByb3ZpZGUgdGhlIGdlbmVyaWMgcGFyYW1ldGVyIHRvIGltcGxlbWVudC5cbiAqIEB0ZW1wbGF0ZSB7RXh0ZW5zaW9uVHlwZX0gRXh0VHlwZVxuICovXG5leHBvcnQgY2xhc3MgRXh0ZW5zaW9uQ29uZmlnIHtcbiAgLyoqIEB0eXBlIHtFeHRUeXBlfSAqL1xuICBleHRlbnNpb25UeXBlO1xuXG4gIC8qKiBAdHlwZSB7YCR7RXh0VHlwZX1zYH0gKi9cbiAgY29uZmlnS2V5O1xuXG4gIC8qKiBAdHlwZSB7RXh0UmVjb3JkPEV4dFR5cGU+fSAqL1xuICBpbnN0YWxsZWRFeHRlbnNpb25zO1xuXG4gIC8qKiBAdHlwZSB7aW1wb3J0KCdAYXBwaXVtL3R5cGVzJykuQXBwaXVtTG9nZ2VyfSAqL1xuICBsb2c7XG5cbiAgLyoqIEB0eXBlIHtNYW5pZmVzdH0gKi9cbiAgbWFuaWZlc3Q7XG5cbiAgLyoqXG4gICAqIEB0eXBlIHtFeHRlbnNpb25MaXN0RGF0YX1cbiAgICovXG4gIF9saXN0RGF0YUNhY2hlO1xuXG4gIC8qKlxuICAgKiBAcHJvdGVjdGVkXG4gICAqIEBwYXJhbSB7RXh0VHlwZX0gZXh0ZW5zaW9uVHlwZSAtIFR5cGUgb2YgZXh0ZW5zaW9uXG4gICAqIEBwYXJhbSB7TWFuaWZlc3R9IG1hbmlmZXN0IC0gYE1hbmlmZXN0YCBpbnN0YW5jZVxuICAgKi9cbiAgY29uc3RydWN0b3IoZXh0ZW5zaW9uVHlwZSwgbWFuaWZlc3QpIHtcbiAgICB0aGlzLmV4dGVuc2lvblR5cGUgPSBleHRlbnNpb25UeXBlO1xuICAgIHRoaXMuY29uZmlnS2V5ID0gYCR7ZXh0ZW5zaW9uVHlwZX1zYDtcbiAgICB0aGlzLmluc3RhbGxlZEV4dGVuc2lvbnMgPSBtYW5pZmVzdC5nZXRFeHRlbnNpb25EYXRhKGV4dGVuc2lvblR5cGUpO1xuICAgIHRoaXMubWFuaWZlc3QgPSBtYW5pZmVzdDtcbiAgfVxuXG4gIGdldCBtYW5pZmVzdFBhdGgoKSB7XG4gICAgcmV0dXJuIHRoaXMubWFuaWZlc3QubWFuaWZlc3RQYXRoO1xuICB9XG5cbiAgZ2V0IGFwcGl1bUhvbWUoKSB7XG4gICAgcmV0dXJuIHRoaXMubWFuaWZlc3QuYXBwaXVtSG9tZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgbGlzdCBvZiBlcnJvcnMgZm9yIGEgZ2l2ZW4gZXh0ZW5zaW9uLlxuICAgKlxuICAgKiBAcGFyYW0ge0V4dE5hbWU8RXh0VHlwZT59IGV4dE5hbWVcbiAgICogQHBhcmFtIHtFeHRNYW5pZmVzdDxFeHRUeXBlPn0gZXh0TWFuaWZlc3RcbiAgICogQHJldHVybnMge0V4dE1hbmlmZXN0UHJvYmxlbVtdfVxuICAgKi9cbiAgZ2V0UHJvYmxlbXMoZXh0TmFtZSwgZXh0TWFuaWZlc3QpIHtcbiAgICByZXR1cm4gW1xuICAgICAgLi4udGhpcy5nZXRHZW5lcmljQ29uZmlnUHJvYmxlbXMoZXh0TWFuaWZlc3QsIGV4dE5hbWUpLFxuICAgICAgLi4udGhpcy5nZXRDb25maWdQcm9ibGVtcyhleHRNYW5pZmVzdCwgZXh0TmFtZSksXG4gICAgICAuLi50aGlzLmdldFNjaGVtYVByb2JsZW1zKGV4dE1hbmlmZXN0LCBleHROYW1lKSxcbiAgICBdO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBsaXN0IG9mIHdhcm5pbmdzIGZvciBhIGdpdmVuIGV4dGVuc2lvbi5cbiAgICpcbiAgICogQHBhcmFtIHtFeHROYW1lPEV4dFR5cGU+fSBleHROYW1lXG4gICAqIEBwYXJhbSB7RXh0TWFuaWZlc3Q8RXh0VHlwZT59IGV4dE1hbmlmZXN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn1cbiAgICovXG4gIGFzeW5jIGdldFdhcm5pbmdzKGV4dE5hbWUsIGV4dE1hbmlmZXN0KSB7XG4gICAgY29uc3QgW2dlbmVyaWNDb25maWdXYXJuaW5ncywgY29uZmlnV2FybmluZ3NdID0gYXdhaXQgQi5hbGwoW1xuICAgICAgdGhpcy5nZXRHZW5lcmljQ29uZmlnV2FybmluZ3MoZXh0TWFuaWZlc3QsIGV4dE5hbWUpLFxuICAgICAgdGhpcy5nZXRDb25maWdXYXJuaW5ncyhleHRNYW5pZmVzdCwgZXh0TmFtZSksXG4gICAgXSk7XG5cbiAgICByZXR1cm4gWy4uLmdlbmVyaWNDb25maWdXYXJuaW5ncywgLi4uY29uZmlnV2FybmluZ3NdO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBsaXN0IG9mIGV4dGVuc2lvbi10eXBlLXNwZWNpZmljIGlzc3Vlcy4gVG8gYmUgaW1wbGVtZW50ZWQgYnkgc3ViY2xhc3Nlcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7RXh0TWFuaWZlc3Q8RXh0VHlwZT59IGV4dE1hbmlmZXN0XG4gICAqIEBwYXJhbSB7RXh0TmFtZTxFeHRUeXBlPn0gZXh0TmFtZVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59XG4gICAqL1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tdW51c2VkLXZhcnMscmVxdWlyZS1hd2FpdFxuICBhc3luYyBnZXRDb25maWdXYXJuaW5ncyhleHRNYW5pZmVzdCwgZXh0TmFtZSkge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge01hcDxFeHROYW1lPEV4dFR5cGU+LEV4dE1hbmlmZXN0UHJvYmxlbVtdPn0gW2Vycm9yTWFwXVxuICAgKiBAcGFyYW0ge01hcDxFeHROYW1lPEV4dFR5cGU+LHN0cmluZ1tdPn0gW3dhcm5pbmdNYXBdXG4gICAqL1xuICBnZXRWYWxpZGF0aW9uUmVzdWx0U3VtbWFyaWVzKGVycm9yTWFwID0gbmV3IE1hcCgpLCB3YXJuaW5nTWFwID0gbmV3IE1hcCgpKSB7XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgY29tcHV0ZWQgc3RyaW5nc1xuICAgICAqIEB0eXBlIHtzdHJpbmdbXX1cbiAgICAgKi9cbiAgICBjb25zdCBlcnJvclN1bW1hcmllcyA9IFtdO1xuICAgIGZvciAoY29uc3QgW2V4dE5hbWUsIHByb2JsZW1zXSBvZiBlcnJvck1hcC5lbnRyaWVzKCkpIHtcbiAgICAgIGlmIChfLmlzRW1wdHkocHJvYmxlbXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gcmVtb3ZlIHRoaXMgZXh0ZW5zaW9uIGZyb20gdGhlIGxpc3Qgc2luY2UgaXQncyBub3QgdmFsaWRcbiAgICAgIGVycm9yU3VtbWFyaWVzLnB1c2goXG4gICAgICAgIGAke3RoaXMuZXh0ZW5zaW9uVHlwZX0gXCIke2V4dE5hbWV9XCIgaGFkICR7dXRpbC5wbHVyYWxpemUoXG4gICAgICAgICAgJ2Vycm9yJyxcbiAgICAgICAgICBwcm9ibGVtcy5sZW5ndGhcbiAgICAgICAgKX0gYW5kIHdpbGwgbm90IGJlIGF2YWlsYWJsZTpgXG4gICAgICApO1xuICAgICAgZm9yIChjb25zdCBwcm9ibGVtIG9mIHByb2JsZW1zKSB7XG4gICAgICAgIGVycm9yU3VtbWFyaWVzLnB1c2goXG4gICAgICAgICAgYCAgLSAke3Byb2JsZW0uZXJyfSAoQWN0dWFsIHZhbHVlOiBgICsgYCR7SlNPTi5zdHJpbmdpZnkocHJvYmxlbS52YWwpfSlgXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3Qgd2FybmluZ1N1bW1hcmllcyA9IFtdO1xuICAgIGZvciAoY29uc3QgW2V4dE5hbWUsIHdhcm5pbmdzXSBvZiB3YXJuaW5nTWFwLmVudHJpZXMoKSkge1xuICAgICAgaWYgKF8uaXNFbXB0eSh3YXJuaW5ncykpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBleHRUeXBlVGV4dCA9IF8uY2FwaXRhbGl6ZSh0aGlzLmV4dGVuc2lvblR5cGUpO1xuICAgICAgY29uc3QgcHJvYmxlbUVudW1lcmF0aW9uVGV4dCA9IHV0aWwucGx1cmFsaXplKCdwb3RlbnRpYWwgcHJvYmxlbScsIHdhcm5pbmdzLmxlbmd0aCwgdHJ1ZSk7XG4gICAgICB3YXJuaW5nU3VtbWFyaWVzLnB1c2goYCR7ZXh0VHlwZVRleHR9IFwiJHtleHROYW1lfVwiIGhhcyAke3Byb2JsZW1FbnVtZXJhdGlvblRleHR9OiBgKTtcbiAgICAgIGZvciAoY29uc3Qgd2FybmluZyBvZiB3YXJuaW5ncykge1xuICAgICAgICB3YXJuaW5nU3VtbWFyaWVzLnB1c2goYCAgLSAke3dhcm5pbmd9YCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtlcnJvclN1bW1hcmllcywgd2FybmluZ1N1bW1hcmllc307XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGV4dGVuc2lvbnMgZm9yIHByb2JsZW1zLiAgVG8gYmUgY2FsbGVkIGJ5IHN1YmNsYXNzZXMnIGB2YWxpZGF0ZWAgbWV0aG9kLlxuICAgKlxuICAgKiBFcnJvcnMgYW5kIHdhcm5pbmdzIHdpbGwgYmUgZGlzcGxheWVkIHRvIHRoZSB1c2VyLlxuICAgKlxuICAgKiBUaGlzIG1ldGhvZCBtdXRhdGVzIGBleHRzYC5cbiAgICpcbiAgICogQHByb3RlY3RlZFxuICAgKiBAcGFyYW0ge0V4dFJlY29yZDxFeHRUeXBlPn0gZXh0cyAtIExvb2t1cCBvZiBleHRlbnNpb24gbmFtZXMgdG8ge0BsaW5rY29kZSBFeHRNYW5pZmVzdH0gb2JqZWN0c1xuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxFeHRSZWNvcmQ8RXh0VHlwZT4+fSBUaGUgc2FtZSBsb29rdXAsIGJ1dCBwaWNraW5nIG9ubHkgZXJyb3ItZnJlZSBleHRlbnNpb25zXG4gICAqL1xuICBhc3luYyBfdmFsaWRhdGUoZXh0cykge1xuICAgIC8qKlxuICAgICAqIExvb2t1cCBvZiBleHRlbnNpb24gbmFtZXMgdG8ge0BsaW5rY29kZSBFeHRNYW5pZmVzdFByb2JsZW0gRXh0TWFuaWZlc3RQcm9ibGVtc31cbiAgICAgKiBAdHlwZSB7TWFwPEV4dE5hbWU8RXh0VHlwZT4sRXh0TWFuaWZlc3RQcm9ibGVtW10+fVxuICAgICAqL1xuICAgIGNvbnN0IGVycm9yTWFwID0gbmV3IE1hcCgpO1xuICAgIC8qKlxuICAgICAqIExvb2t1cCBvZiBleHRlbnNpb24gbmFtZXMgdG8gd2FybmluZ3MuXG4gICAgICogQHR5cGUge01hcDxFeHROYW1lPEV4dFR5cGU+LHN0cmluZ1tdPn1cbiAgICAgKi9cbiAgICBjb25zdCB3YXJuaW5nTWFwID0gbmV3IE1hcCgpO1xuXG4gICAgZm9yIChjb25zdCBbZXh0TmFtZSwgZXh0TWFuaWZlc3RdIG9mIF8udG9QYWlycyhleHRzKSkge1xuICAgICAgY29uc3QgW2Vycm9ycywgd2FybmluZ3NdID0gYXdhaXQgQi5hbGwoW1xuICAgICAgICB0aGlzLmdldFByb2JsZW1zKGV4dE5hbWUsIGV4dE1hbmlmZXN0KSxcbiAgICAgICAgdGhpcy5nZXRXYXJuaW5ncyhleHROYW1lLCBleHRNYW5pZmVzdCksXG4gICAgICBdKTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoKSB7XG4gICAgICAgIGRlbGV0ZSBleHRzW2V4dE5hbWVdO1xuICAgICAgfVxuICAgICAgZXJyb3JNYXAuc2V0KGV4dE5hbWUsIGVycm9ycyk7XG4gICAgICB3YXJuaW5nTWFwLnNldChleHROYW1lLCB3YXJuaW5ncyk7XG4gICAgfVxuXG4gICAgY29uc3Qge2Vycm9yU3VtbWFyaWVzLCB3YXJuaW5nU3VtbWFyaWVzfSA9IHRoaXMuZ2V0VmFsaWRhdGlvblJlc3VsdFN1bW1hcmllcyhcbiAgICAgIGVycm9yTWFwLFxuICAgICAgd2FybmluZ01hcFxuICAgICk7XG5cbiAgICBpZiAoIV8uaXNFbXB0eShlcnJvclN1bW1hcmllcykpIHtcbiAgICAgIGxvZy5lcnJvcihcbiAgICAgICAgYEFwcGl1bSBlbmNvdW50ZXJlZCAke3V0aWwucGx1cmFsaXplKCdlcnJvcicsIGVycm9yTWFwLnNpemUsIHRydWUpfSB3aGlsZSB2YWxpZGF0aW5nICR7XG4gICAgICAgICAgdGhpcy5jb25maWdLZXlcbiAgICAgICAgfSBmb3VuZCBpbiBtYW5pZmVzdCAke3RoaXMubWFuaWZlc3RQYXRofWBcbiAgICAgICk7XG4gICAgICBmb3IgKGNvbnN0IHN1bW1hcnkgb2YgZXJyb3JTdW1tYXJpZXMpIHtcbiAgICAgICAgbG9nLmVycm9yKHN1bW1hcnkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBvbmx5IGRpc3BsYXkgd2FybmluZ3MgaWYgdGhlcmUgYXJlIG5vIGVycm9ycyFcblxuICAgICAgaWYgKCFfLmlzRW1wdHkod2FybmluZ1N1bW1hcmllcykpIHtcbiAgICAgICAgbG9nLndhcm4oXG4gICAgICAgICAgYEFwcGl1bSBlbmNvdW50ZXJlZCAke3V0aWwucGx1cmFsaXplKFxuICAgICAgICAgICAgJ3dhcm5pbmcnLFxuICAgICAgICAgICAgd2FybmluZ01hcC5zaXplLFxuICAgICAgICAgICAgdHJ1ZVxuICAgICAgICAgICl9IHdoaWxlIHZhbGlkYXRpbmcgJHt0aGlzLmNvbmZpZ0tleX0gZm91bmQgaW4gbWFuaWZlc3QgJHt0aGlzLm1hbmlmZXN0UGF0aH1gXG4gICAgICAgICk7XG4gICAgICAgIGZvciAoY29uc3Qgc3VtbWFyeSBvZiB3YXJuaW5nU3VtbWFyaWVzKSB7XG4gICAgICAgICAgbG9nLndhcm4oc3VtbWFyeSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGV4dHM7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIGxpc3RpbmcgZGF0YSBmb3IgZXh0ZW5zaW9ucyB2aWEgY29tbWFuZCBjbGFzcy5cbiAgICogQ2FjaGVzIHRoZSByZXN1bHQgaW4ge0BsaW5rY29kZSBFeHRlbnNpb25Db25maWcuX2xpc3REYXRhQ2FjaGV9XG4gICAqIEBwcm90ZWN0ZWRcbiAgICogQHJldHVybnMge1Byb21pc2U8RXh0ZW5zaW9uTGlzdERhdGE+fVxuICAgKi9cbiAgYXN5bmMgZ2V0TGlzdERhdGEoKSB7XG4gICAgaWYgKHRoaXMuX2xpc3REYXRhQ2FjaGUpIHtcbiAgICAgIHJldHVybiB0aGlzLl9saXN0RGF0YUNhY2hlO1xuICAgIH1cbiAgICBjb25zdCBDb21tYW5kQ2xhc3MgPSAvKiogQHR5cGUge0V4dENvbW1hbmQ8RXh0VHlwZT59ICovIChjb21tYW5kQ2xhc3Nlc1t0aGlzLmV4dGVuc2lvblR5cGVdKTtcbiAgICBjb25zdCBjbWQgPSBuZXcgQ29tbWFuZENsYXNzKHtjb25maWc6IHRoaXMsIGpzb246IHRydWV9KTtcbiAgICBjb25zdCBsaXN0RGF0YSA9IGF3YWl0IGNtZC5saXN0KHtzaG93SW5zdGFsbGVkOiB0cnVlLCBzaG93VXBkYXRlczogdHJ1ZX0pO1xuICAgIHRoaXMuX2xpc3REYXRhQ2FjaGUgPSBsaXN0RGF0YTtcbiAgICByZXR1cm4gbGlzdERhdGE7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIGxpc3Qgb2Ygd2FybmluZ3MgZm9yIGEgcGFydGljdWxhciBleHRlbnNpb24uXG4gICAqXG4gICAqIEJ5IGRlZmluaXRpb24sIGEgbm9uLWVtcHR5IGxpc3Qgb2Ygd2FybmluZ3MgZG9lcyBfbm90XyBpbXBseSB0aGUgZXh0ZW5zaW9uIGNhbm5vdCBiZSBsb2FkZWQsXG4gICAqIGJ1dCBpdCBtYXkgbm90IHdvcmsgYXMgZXhwZWN0ZWQgb3Igb3RoZXJ3aXNlIHRocm93IGFuIGV4Y2VwdGlvbiBhdCBydW50aW1lLlxuICAgKlxuICAgKiBAcGFyYW0ge0V4dE1hbmlmZXN0PEV4dFR5cGU+fSBleHRNYW5pZmVzdFxuICAgKiBAcGFyYW0ge0V4dE5hbWU8RXh0VHlwZT59IGV4dE5hbWVcbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fVxuICAgKi9cbiAgYXN5bmMgZ2V0R2VuZXJpY0NvbmZpZ1dhcm5pbmdzKGV4dE1hbmlmZXN0LCBleHROYW1lKSB7XG4gICAgY29uc3Qge2FwcGl1bVZlcnNpb24sIGluc3RhbGxTcGVjLCBpbnN0YWxsVHlwZSwgcGtnTmFtZX0gPSBleHRNYW5pZmVzdDtcbiAgICBjb25zdCB3YXJuaW5ncyA9IFtdO1xuXG4gICAgY29uc3QgaW52YWxpZEZpZWxkcyA9IFtdO1xuICAgIGlmICghXy5pc1N0cmluZyhpbnN0YWxsU3BlYykpIHtcbiAgICAgIGludmFsaWRGaWVsZHMucHVzaCgnaW5zdGFsbFNwZWMnKTtcbiAgICB9XG5cbiAgICBpZiAoIUlOU1RBTExfVFlQRVMuaGFzKGluc3RhbGxUeXBlKSkge1xuICAgICAgaW52YWxpZEZpZWxkcy5wdXNoKCdpbnN0YWxsVHlwZScpO1xuICAgIH1cblxuICAgIGNvbnN0IGV4dFR5cGVUZXh0ID0gXy5jYXBpdGFsaXplKHRoaXMuZXh0ZW5zaW9uVHlwZSk7XG5cbiAgICBpZiAoaW52YWxpZEZpZWxkcy5sZW5ndGgpIHtcbiAgICAgIGNvbnN0IGludmFsaWRGaWVsZHNFbnVtZXJhdGlvblRleHQgPSB1dGlsLnBsdXJhbGl6ZShcbiAgICAgICAgJ2ludmFsaWQgb3IgbWlzc2luZyBmaWVsZCcsXG4gICAgICAgIGludmFsaWRGaWVsZHMubGVuZ3RoLFxuICAgICAgICB0cnVlXG4gICAgICApO1xuICAgICAgY29uc3QgaW52YWxpZEZpZWxkc1RleHQgPSBpbnZhbGlkRmllbGRzLm1hcCgoZmllbGQpID0+IGBcIiR7ZmllbGR9XCJgKS5qb2luKCcsICcpO1xuXG4gICAgICB3YXJuaW5ncy5wdXNoKFxuICAgICAgICBgJHtleHRUeXBlVGV4dH0gXCIke2V4dE5hbWV9XCIgKHBhY2thZ2UgXFxgJHtwa2dOYW1lfVxcYCkgaGFzICR7aW52YWxpZEZpZWxkc0VudW1lcmF0aW9uVGV4dH0gKCR7aW52YWxpZEZpZWxkc1RleHR9KSBpbiBcXGBleHRlbnNpb25zLnlhbWxcXGA7IHRoaXMgbWF5IGNhdXNlIHVwZ3JhZGVzIGRvbmUgdmlhIHRoZSBcXGBhcHBpdW1cXGAgQ0xJIHRvb2wgdG8gZmFpbC4gUGxlYXNlIHJlaW5zdGFsbCB3aXRoIFxcYGFwcGl1bSAke3RoaXMuZXh0ZW5zaW9uVHlwZX0gdW5pbnN0YWxsICR7ZXh0TmFtZX1cXGAgYW5kIFxcYGFwcGl1bSAke3RoaXMuZXh0ZW5zaW9uVHlwZX0gaW5zdGFsbCAke2V4dE5hbWV9XFxgIHRvIGF0dGVtcHQgYSBmaXguYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBIZWxwcyBjb25jYXRlbmF0ZSB3YXJuaW5nIG1lc3NhZ2VzIHJlbGF0ZWQgdG8gcGVlciBkZXBlbmRlbmNpZXNcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gcmVhc29uXG4gICAgICogQHJldHVybnMgc3RyaW5nXG4gICAgICovXG4gICAgY29uc3QgY3JlYXRlUGVlcldhcm5pbmcgPSAocmVhc29uKSA9PlxuICAgICAgYCR7ZXh0VHlwZVRleHR9IFwiJHtleHROYW1lfVwiIChwYWNrYWdlIFxcYCR7cGtnTmFtZX1cXGApIG1heSBiZSBpbmNvbXBhdGlibGUgd2l0aCB0aGUgY3VycmVudCB2ZXJzaW9uIG9mIEFwcGl1bSAodiR7QVBQSVVNX1ZFUn0pIGR1ZSB0byAke3JlYXNvbn1gO1xuXG4gICAgaWYgKF8uaXNTdHJpbmcoYXBwaXVtVmVyc2lvbikgJiYgIXNhdGlzZmllcyhBUFBJVU1fVkVSLCBhcHBpdW1WZXJzaW9uKSkge1xuICAgICAgY29uc3QgbGlzdERhdGEgPSBhd2FpdCB0aGlzLmdldExpc3REYXRhKCk7XG4gICAgICBjb25zdCBleHRMaXN0RGF0YSA9IC8qKiBAdHlwZSB7SW5zdGFsbGVkRXh0ZW5zaW9uTGlzdERhdGF9ICovIChsaXN0RGF0YVtleHROYW1lXSk7XG4gICAgICBpZiAoZXh0TGlzdERhdGE/Lmluc3RhbGxlZCkge1xuICAgICAgICBjb25zdCB7dXBkYXRlVmVyc2lvbiwgdXBUb0RhdGV9ID0gZXh0TGlzdERhdGE7XG4gICAgICAgIGlmICghdXBUb0RhdGUpIHtcbiAgICAgICAgICB3YXJuaW5ncy5wdXNoKFxuICAgICAgICAgICAgY3JlYXRlUGVlcldhcm5pbmcoXG4gICAgICAgICAgICAgIGBpdHMgcGVlciBkZXBlbmRlbmN5IG9uIG9sZGVyIEFwcGl1bSB2JHthcHBpdW1WZXJzaW9ufS4gUGxlYXNlIHVwZ3JhZGUgXFxgJHtwa2dOYW1lfVxcYCB0byB2JHt1cGRhdGVWZXJzaW9ufSBvciBuZXdlci5gXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB3YXJuaW5ncy5wdXNoKFxuICAgICAgICAgICAgY3JlYXRlUGVlcldhcm5pbmcoXG4gICAgICAgICAgICAgIGBpdHMgcGVlciBkZXBlbmRlbmN5IG9uIG9sZGVyIEFwcGl1bSB2JHthcHBpdW1WZXJzaW9ufS4gUGxlYXNlIGFzayB0aGUgZGV2ZWxvcGVyIG9mIFxcYCR7cGtnTmFtZX1cXGAgdG8gdXBkYXRlIHRoZSBwZWVyIGRlcGVuZGVuY3kgb24gQXBwaXVtIHRvIHYke0FQUElVTV9WRVJ9LmBcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICghXy5pc1N0cmluZyhhcHBpdW1WZXJzaW9uKSkge1xuICAgICAgY29uc3QgbGlzdERhdGEgPSBhd2FpdCB0aGlzLmdldExpc3REYXRhKCk7XG4gICAgICBjb25zdCBleHRMaXN0RGF0YSA9IC8qKiBAdHlwZSB7SW5zdGFsbGVkRXh0ZW5zaW9uTGlzdERhdGF9ICovIChsaXN0RGF0YVtleHROYW1lXSk7XG4gICAgICBpZiAoIWV4dExpc3REYXRhPy51cFRvRGF0ZSAmJiBleHRMaXN0RGF0YT8udXBkYXRlVmVyc2lvbikge1xuICAgICAgICB3YXJuaW5ncy5wdXNoKFxuICAgICAgICAgIGNyZWF0ZVBlZXJXYXJuaW5nKFxuICAgICAgICAgICAgYGFuIGludmFsaWQgb3IgbWlzc2luZyBwZWVyIGRlcGVuZGVuY3kgb24gQXBwaXVtLiBBIG5ld2VyIHZlcnNpb24gb2YgXFxgJHtwa2dOYW1lfVxcYCBpcyBhdmFpbGFibGU7IHBsZWFzZSBhdHRlbXB0IHRvIHVwZ3JhZGUgXCIke2V4dE5hbWV9XCIgdG8gdiR7ZXh0TGlzdERhdGEudXBkYXRlVmVyc2lvbn0gb3IgbmV3ZXIuYFxuICAgICAgICAgIClcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHdhcm5pbmdzLnB1c2goXG4gICAgICAgICAgY3JlYXRlUGVlcldhcm5pbmcoXG4gICAgICAgICAgICBgYW4gaW52YWxpZCBvciBtaXNzaW5nIHBlZXIgZGVwZW5kZW5jeSBvbiBBcHBpdW0uIFBsZWFzZSBhc2sgdGhlIGRldmVsb3BlciBvZiBcXGAke3BrZ05hbWV9XFxgIHRvIGFkZCBhIHBlZXIgZGVwZW5kZW5jeSBvbiBcXGBeYXBwaXVtQCR7QVBQSVVNX1ZFUn1cXGAuYFxuICAgICAgICAgIClcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHdhcm5pbmdzO1xuICB9XG4gIC8qKlxuICAgKiBSZXR1cm5zIGxpc3Qgb2YgdW5yZWNvdmVyYWJsZSBlcnJvcnMgKGlmIGFueSkgZm9yIHRoZSBnaXZlbiBleHRlbnNpb24gX2lmXyBpdCBoYXMgYSBgc2NoZW1hYCBwcm9wZXJ0eS5cbiAgICpcbiAgICogQHBhcmFtIHtFeHRNYW5pZmVzdDxFeHRUeXBlPn0gZXh0TWFuaWZlc3QgLSBFeHRlbnNpb24gZGF0YSAoZnJvbSBtYW5pZmVzdClcbiAgICogQHBhcmFtIHtFeHROYW1lPEV4dFR5cGU+fSBleHROYW1lIC0gRXh0ZW5zaW9uIG5hbWUgKGZyb20gbWFuaWZlc3QpXG4gICAqIEByZXR1cm5zIHtFeHRNYW5pZmVzdFByb2JsZW1bXX1cbiAgICovXG4gIGdldFNjaGVtYVByb2JsZW1zKGV4dE1hbmlmZXN0LCBleHROYW1lKSB7XG4gICAgLyoqIEB0eXBlIHtFeHRNYW5pZmVzdFByb2JsZW1bXX0gKi9cbiAgICBjb25zdCBwcm9ibGVtcyA9IFtdO1xuICAgIGNvbnN0IHtzY2hlbWE6IGFyZ1NjaGVtYVBhdGh9ID0gZXh0TWFuaWZlc3Q7XG4gICAgaWYgKEV4dGVuc2lvbkNvbmZpZy5leHREYXRhSGFzU2NoZW1hKGV4dE1hbmlmZXN0KSkge1xuICAgICAgaWYgKF8uaXNTdHJpbmcoYXJnU2NoZW1hUGF0aCkpIHtcbiAgICAgICAgaWYgKGlzQWxsb3dlZFNjaGVtYUZpbGVFeHRlbnNpb24oYXJnU2NoZW1hUGF0aCkpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGhpcy5yZWFkRXh0ZW5zaW9uU2NoZW1hKGV4dE5hbWUsIGV4dE1hbmlmZXN0KTtcbiAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIHByb2JsZW1zLnB1c2goe1xuICAgICAgICAgICAgICBlcnI6IGBVbmFibGUgdG8gcmVnaXN0ZXIgc2NoZW1hIGF0IHBhdGggJHthcmdTY2hlbWFQYXRofTsgJHtlcnIubWVzc2FnZX1gLFxuICAgICAgICAgICAgICB2YWw6IGFyZ1NjaGVtYVBhdGgsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcHJvYmxlbXMucHVzaCh7XG4gICAgICAgICAgICBlcnI6IGBTY2hlbWEgZmlsZSBoYXMgdW5zdXBwb3J0ZWQgZXh0ZW5zaW9uLiBBbGxvd2VkOiAke1tcbiAgICAgICAgICAgICAgLi4uQUxMT1dFRF9TQ0hFTUFfRVhURU5TSU9OUyxcbiAgICAgICAgICAgIF0uam9pbignLCAnKX1gLFxuICAgICAgICAgICAgdmFsOiBhcmdTY2hlbWFQYXRoLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKF8uaXNQbGFpbk9iamVjdChhcmdTY2hlbWFQYXRoKSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHRoaXMucmVhZEV4dGVuc2lvblNjaGVtYShleHROYW1lLCBleHRNYW5pZmVzdCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIHByb2JsZW1zLnB1c2goe1xuICAgICAgICAgICAgZXJyOiBgVW5hYmxlIHRvIHJlZ2lzdGVyIGVtYmVkZGVkIHNjaGVtYTsgJHtlcnIubWVzc2FnZX1gLFxuICAgICAgICAgICAgdmFsOiBhcmdTY2hlbWFQYXRoLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwcm9ibGVtcy5wdXNoKHtcbiAgICAgICAgICBlcnI6ICdJbmNvcnJlY3RseSBmb3JtYXR0ZWQgc2NoZW1hIGZpZWxkOyBtdXN0IGJlIGEgcGF0aCB0byBhIHNjaGVtYSBmaWxlIG9yIGEgc2NoZW1hIG9iamVjdC4nLFxuICAgICAgICAgIHZhbDogYXJnU2NoZW1hUGF0aCxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBwcm9ibGVtcztcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gYSBsaXN0IG9mIGdlbmVyaWMgdW5yZWNvdmVyYWJsZSBlcnJvcnMgZm9yIHRoZSBnaXZlbiBleHRlbnNpb25cbiAgICogQHBhcmFtIHtFeHRNYW5pZmVzdDxFeHRUeXBlPn0gZXh0TWFuaWZlc3QgLSBFeHRlbnNpb24gZGF0YSAoZnJvbSBtYW5pZmVzdClcbiAgICogQHBhcmFtIHtFeHROYW1lPEV4dFR5cGU+fSBleHROYW1lIC0gRXh0ZW5zaW9uIG5hbWUgKGZyb20gbWFuaWZlc3QpXG4gICAqIEByZXR1cm5zIHtFeHRNYW5pZmVzdFByb2JsZW1bXX1cbiAgICovXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnVzZWQtdmFyc1xuICBnZXRHZW5lcmljQ29uZmlnUHJvYmxlbXMoZXh0TWFuaWZlc3QsIGV4dE5hbWUpIHtcbiAgICBjb25zdCB7dmVyc2lvbiwgcGtnTmFtZSwgbWFpbkNsYXNzfSA9IGV4dE1hbmlmZXN0O1xuICAgIGNvbnN0IHByb2JsZW1zID0gW107XG5cbiAgICBpZiAoIV8uaXNTdHJpbmcodmVyc2lvbikpIHtcbiAgICAgIHByb2JsZW1zLnB1c2goe1xuICAgICAgICBlcnI6IGBJbnZhbGlkIG9yIG1pc3NpbmcgXFxgdmVyc2lvblxcYCBmaWVsZCBpbiBteSBcXGBwYWNrYWdlLmpzb25cXGAgYW5kL29yIFxcYGV4dGVuc2lvbnMueWFtbFxcYCAobXVzdCBiZSBhIHN0cmluZylgLFxuICAgICAgICB2YWw6IHZlcnNpb24sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoIV8uaXNTdHJpbmcocGtnTmFtZSkpIHtcbiAgICAgIHByb2JsZW1zLnB1c2goe1xuICAgICAgICBlcnI6IGBJbnZhbGlkIG9yIG1pc3NpbmcgXFxgbmFtZVxcYCBmaWVsZCBpbiBteSBcXGBwYWNrYWdlLmpzb25cXGAgYW5kL29yIFxcYGV4dGVuc2lvbnMueWFtbFxcYCAobXVzdCBiZSBhIHN0cmluZylgLFxuICAgICAgICB2YWw6IHBrZ05hbWUsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoIV8uaXNTdHJpbmcobWFpbkNsYXNzKSkge1xuICAgICAgcHJvYmxlbXMucHVzaCh7XG4gICAgICAgIGVycjogYEludmFsaWQgb3IgbWlzc2luZyBcXGBhcHBpdW0ubWFpbkNsYXNzXFxgIGZpZWxkIGluIG15IFxcYHBhY2thZ2UuanNvblxcYCBhbmQvb3IgXFxgbWFpbkNsYXNzXFxgIGZpZWxkIGluIFxcYGV4dGVuc2lvbnMueWFtbFxcYCAobXVzdCBiZSBhIHN0cmluZylgLFxuICAgICAgICB2YWw6IG1haW5DbGFzcyxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBwcm9ibGVtcztcbiAgfVxuXG4gIC8qKlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtFeHRNYW5pZmVzdDxFeHRUeXBlPn0gZXh0TWFuaWZlc3RcbiAgICogQHBhcmFtIHtFeHROYW1lPEV4dFR5cGU+fSBleHROYW1lXG4gICAqIEByZXR1cm5zIHtFeHRNYW5pZmVzdFByb2JsZW1bXX1cbiAgICovXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnVzZWQtdmFyc1xuICBnZXRDb25maWdQcm9ibGVtcyhleHRNYW5pZmVzdCwgZXh0TmFtZSkge1xuICAgIC8vIHNob3VkIG92ZXJyaWRlIHRoaXMgbWV0aG9kIGlmIHNwZWNpYWwgdmFsaWRhdGlvbiBpcyBuZWNlc3NhcnkgZm9yIHRoaXMgZXh0ZW5zaW9uIHR5cGVcbiAgICByZXR1cm4gW107XG4gIH1cblxuICAvKipcbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4dE5hbWVcbiAgICogQHBhcmFtIHtFeHRNYW5pZmVzdDxFeHRUeXBlPn0gZXh0TWFuaWZlc3RcbiAgICogQHBhcmFtIHtFeHRlbnNpb25Db25maWdNdXRhdGlvbk9wdHN9IFtvcHRzXVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGFkZEV4dGVuc2lvbihleHROYW1lLCBleHRNYW5pZmVzdCwge3dyaXRlID0gdHJ1ZX0gPSB7fSkge1xuICAgIHRoaXMubWFuaWZlc3QuYWRkRXh0ZW5zaW9uKHRoaXMuZXh0ZW5zaW9uVHlwZSwgZXh0TmFtZSwgZXh0TWFuaWZlc3QpO1xuICAgIGlmICh3cml0ZSkge1xuICAgICAgYXdhaXQgdGhpcy5tYW5pZmVzdC53cml0ZSgpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAcGFyYW0ge0V4dE5hbWU8RXh0VHlwZT59IGV4dE5hbWVcbiAgICogQHBhcmFtIHtFeHRNYW5pZmVzdDxFeHRUeXBlPnxpbXBvcnQoJy4uL2NsaS9leHRlbnNpb24tY29tbWFuZCcpLkV4dGVuc2lvbkZpZWxkczxFeHRUeXBlPn0gZXh0TWFuaWZlc3RcbiAgICogQHBhcmFtIHtFeHRlbnNpb25Db25maWdNdXRhdGlvbk9wdHN9IFtvcHRzXVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHVwZGF0ZUV4dGVuc2lvbihleHROYW1lLCBleHRNYW5pZmVzdCwge3dyaXRlID0gdHJ1ZX0gPSB7fSkge1xuICAgIHRoaXMuaW5zdGFsbGVkRXh0ZW5zaW9uc1tleHROYW1lXSA9IHtcbiAgICAgIC4uLnRoaXMuaW5zdGFsbGVkRXh0ZW5zaW9uc1tleHROYW1lXSxcbiAgICAgIC4uLmV4dE1hbmlmZXN0LFxuICAgIH07XG4gICAgaWYgKHdyaXRlKSB7XG4gICAgICBhd2FpdCB0aGlzLm1hbmlmZXN0LndyaXRlKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZSBhbiBleHRlbnNpb24gZnJvbSB0aGUgbGlzdCBvZiBpbnN0YWxsZWQgZXh0ZW5zaW9ucywgYW5kIG9wdGlvbmFsbHkgYXZvaWQgYSB3cml0ZSB0byB0aGUgbWFuaWZlc3QgZmlsZS5cbiAgICpcbiAgICogQHBhcmFtIHtFeHROYW1lPEV4dFR5cGU+fSBleHROYW1lXG4gICAqIEBwYXJhbSB7RXh0ZW5zaW9uQ29uZmlnTXV0YXRpb25PcHRzfSBbb3B0c11cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZW1vdmVFeHRlbnNpb24oZXh0TmFtZSwge3dyaXRlID0gdHJ1ZX0gPSB7fSkge1xuICAgIGRlbGV0ZSB0aGlzLmluc3RhbGxlZEV4dGVuc2lvbnNbZXh0TmFtZV07XG4gICAgaWYgKHdyaXRlKSB7XG4gICAgICBhd2FpdCB0aGlzLm1hbmlmZXN0LndyaXRlKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEBwYXJhbSB7RXh0TmFtZTxFeHRUeXBlPltdfSBbYWN0aXZlTmFtZXNdXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXVudXNlZC12YXJzXG4gIHByaW50KGFjdGl2ZU5hbWVzKSB7XG4gICAgaWYgKF8uaXNFbXB0eSh0aGlzLmluc3RhbGxlZEV4dGVuc2lvbnMpKSB7XG4gICAgICBsb2cuaW5mbyhcbiAgICAgICAgYE5vICR7dGhpcy5jb25maWdLZXl9IGhhdmUgYmVlbiBpbnN0YWxsZWQgaW4gJHt0aGlzLmFwcGl1bUhvbWV9LiBVc2UgdGhlIFwiYXBwaXVtICR7dGhpcy5leHRlbnNpb25UeXBlfVwiIGAgK1xuICAgICAgICAgICdjb21tYW5kIHRvIGluc3RhbGwgdGhlIG9uZShzKSB5b3Ugd2FudCB0byB1c2UuJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsb2cuaW5mbyhgQXZhaWxhYmxlICR7dGhpcy5jb25maWdLZXl9OmApO1xuICAgIGZvciAoY29uc3QgW2V4dE5hbWUsIGV4dE1hbmlmZXN0XSBvZiAvKiogQHR5cGUge1tzdHJpbmcsIEV4dE1hbmlmZXN0PEV4dFR5cGU+XVtdfSAqLyAoXG4gICAgICBfLnRvUGFpcnModGhpcy5pbnN0YWxsZWRFeHRlbnNpb25zKVxuICAgICkpIHtcbiAgICAgIGxvZy5pbmZvKGAgIC0gJHt0aGlzLmV4dGVuc2lvbkRlc2MoZXh0TmFtZSwgZXh0TWFuaWZlc3QpfWApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgc3RyaW5nIGRlc2NyaWJpbmcgdGhlIGV4dGVuc2lvbi4gU3ViY2xhc3NlcyBtdXN0IGltcGxlbWVudC5cbiAgICogQHBhcmFtIHtFeHROYW1lPEV4dFR5cGU+fSBleHROYW1lIC0gRXh0ZW5zaW9uIG5hbWVcbiAgICogQHBhcmFtIHtFeHRNYW5pZmVzdDxFeHRUeXBlPn0gZXh0TWFuaWZlc3QgLSBFeHRlbnNpb24gZGF0YVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgKiBAYWJzdHJhY3RcbiAgICovXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnVzZWQtdmFyc1xuICBleHRlbnNpb25EZXNjKGV4dE5hbWUsIGV4dE1hbmlmZXN0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdUaGlzIG11c3QgYmUgaW1wbGVtZW50ZWQgaW4gYSBzdWJjbGFzcycpO1xuICB9XG5cbiAgLyoqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleHROYW1lXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAqL1xuICBnZXRJbnN0YWxsUGF0aChleHROYW1lKSB7XG4gICAgcmV0dXJuIHBhdGguam9pbih0aGlzLmFwcGl1bUhvbWUsICdub2RlX21vZHVsZXMnLCB0aGlzLmluc3RhbGxlZEV4dGVuc2lvbnNbZXh0TmFtZV0ucGtnTmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgZXh0ZW5zaW9uIGFuZCByZXR1cm5zIGl0cyBtYWluIGNsYXNzIChjb25zdHJ1Y3RvcilcbiAgICogQHBhcmFtIHtFeHROYW1lPEV4dFR5cGU+fSBleHROYW1lXG4gICAqIEByZXR1cm5zIHtFeHRDbGFzczxFeHRUeXBlPn1cbiAgICovXG4gIHJlcXVpcmUoZXh0TmFtZSkge1xuICAgIGNvbnN0IHttYWluQ2xhc3N9ID0gdGhpcy5pbnN0YWxsZWRFeHRlbnNpb25zW2V4dE5hbWVdO1xuICAgIGNvbnN0IHJlcVBhdGggPSB0aGlzLmdldEluc3RhbGxQYXRoKGV4dE5hbWUpO1xuICAgIC8qKiBAdHlwZSB7c3RyaW5nfSAqL1xuICAgIGxldCByZXFSZXNvbHZlZDtcbiAgICB0cnkge1xuICAgICAgcmVxUmVzb2x2ZWQgPSByZXF1aXJlLnJlc29sdmUocmVxUGF0aCk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyBuZXcgUmVmZXJlbmNlRXJyb3IoYENvdWxkIG5vdCBmaW5kIGEgJHt0aGlzLmV4dGVuc2lvblR5cGV9IGluc3RhbGxlZCBhdCAke3JlcVBhdGh9YCk7XG4gICAgfVxuICAgIC8vIG5vdGU6IHRoaXMgd2lsbCBvbmx5IHJlbG9hZCB0aGUgZW50cnkgcG9pbnRcbiAgICBpZiAocHJvY2Vzcy5lbnYuQVBQSVVNX1JFTE9BRF9FWFRFTlNJT05TICYmIHJlcXVpcmUuY2FjaGVbcmVxUmVzb2x2ZWRdKSB7XG4gICAgICBsb2cuZGVidWcoYFJlbW92aW5nICR7cmVxUmVzb2x2ZWR9IGZyb20gcmVxdWlyZSBjYWNoZWApO1xuICAgICAgZGVsZXRlIHJlcXVpcmUuY2FjaGVbcmVxUmVzb2x2ZWRdO1xuICAgIH1cbiAgICBsb2cuZGVidWcoYFJlcXVpcmluZyAke3RoaXMuZXh0ZW5zaW9uVHlwZX0gYXQgJHtyZXFQYXRofWApO1xuICAgIGNvbnN0IE1haW5DbGFzcyA9IHJlcXVpcmUocmVxUGF0aClbbWFpbkNsYXNzXTtcbiAgICBpZiAoIU1haW5DbGFzcykge1xuICAgICAgdGhyb3cgbmV3IFJlZmVyZW5jZUVycm9yKFxuICAgICAgICBgQ291bGQgbm90IGZpbmQgYSBjbGFzcyBuYW1lZCBcIiR7bWFpbkNsYXNzfVwiIGV4cG9ydGVkIGJ5ICR7dGhpcy5leHRlbnNpb25UeXBlfSBcIiR7ZXh0TmFtZX1cImBcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBNYWluQ2xhc3M7XG4gIH1cblxuICAvKipcbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4dE5hbWVcbiAgICogQHJldHVybnMge2Jvb2xlYW59XG4gICAqL1xuICBpc0luc3RhbGxlZChleHROYW1lKSB7XG4gICAgcmV0dXJuIF8uaW5jbHVkZXMoT2JqZWN0LmtleXModGhpcy5pbnN0YWxsZWRFeHRlbnNpb25zKSwgZXh0TmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogSW50ZW5kZWQgdG8gYmUgY2FsbGVkIGJ5IGNvcnJlc3BvbmRpbmcgaW5zdGFuY2UgbWV0aG9kcyBvZiBzdWJjbGFzcy5cbiAgICogQHByaXZhdGVcbiAgICogQHRlbXBsYXRlIHtFeHRlbnNpb25UeXBlfSBFeHRUeXBlXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcHBpdW1Ib21lXG4gICAqIEBwYXJhbSB7RXh0VHlwZX0gZXh0VHlwZVxuICAgKiBAcGFyYW0ge0V4dE5hbWU8RXh0VHlwZT59IGV4dE5hbWUgLSBFeHRlbnNpb24gbmFtZSAodW5pcXVlIHRvIGl0cyB0eXBlKVxuICAgKiBAcGFyYW0ge0V4dE1hbmlmZXN0V2l0aFNjaGVtYTxFeHRUeXBlPn0gZXh0TWFuaWZlc3QgLSBFeHRlbnNpb24gY29uZmlnXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoJ2FqdicpLlNjaGVtYU9iamVjdHx1bmRlZmluZWR9XG4gICAqL1xuICBzdGF0aWMgX3JlYWRFeHRlbnNpb25TY2hlbWEoYXBwaXVtSG9tZSwgZXh0VHlwZSwgZXh0TmFtZSwgZXh0TWFuaWZlc3QpIHtcbiAgICBjb25zdCB7cGtnTmFtZSwgc2NoZW1hOiBhcmdTY2hlbWFQYXRofSA9IGV4dE1hbmlmZXN0O1xuICAgIGlmICghYXJnU2NoZW1hUGF0aCkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgYE5vIFxcYHNjaGVtYVxcYCBwcm9wZXJ0eSBmb3VuZCBpbiBjb25maWcgZm9yICR7ZXh0VHlwZX0gJHtwa2dOYW1lfSAtLSB3aHkgaXMgdGhpcyBmdW5jdGlvbiBiZWluZyBjYWxsZWQ/YFxuICAgICAgKTtcbiAgICB9XG4gICAgbGV0IG1vZHVsZU9iamVjdDtcbiAgICBpZiAoXy5pc1N0cmluZyhhcmdTY2hlbWFQYXRoKSkge1xuICAgICAgY29uc3Qgc2NoZW1hUGF0aCA9IHJlc29sdmVGcm9tKGFwcGl1bUhvbWUsIHBhdGguam9pbihwa2dOYW1lLCBhcmdTY2hlbWFQYXRoKSk7XG4gICAgICBtb2R1bGVPYmplY3QgPSByZXF1aXJlKHNjaGVtYVBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBtb2R1bGVPYmplY3QgPSBhcmdTY2hlbWFQYXRoO1xuICAgIH1cbiAgICAvLyB0aGlzIHN1Y2tzLiBkZWZhdWx0IGV4cG9ydHMgc2hvdWxkIGJlIGRlc3Ryb3llZFxuICAgIGNvbnN0IHNjaGVtYSA9IG1vZHVsZU9iamVjdC5fX2VzTW9kdWxlID8gbW9kdWxlT2JqZWN0LmRlZmF1bHQgOiBtb2R1bGVPYmplY3Q7XG4gICAgcmVnaXN0ZXJTY2hlbWEoZXh0VHlwZSwgZXh0TmFtZSwgc2NoZW1hKTtcbiAgICByZXR1cm4gc2NoZW1hO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYHRydWVgIGlmIGEgc3BlY2lmaWMge0BsaW5rIEV4dE1hbmlmZXN0fSBvYmplY3QgaGFzIGEgYHNjaGVtYWAgcHJvcC5cbiAgICogVGhlIHtAbGluayBFeHRNYW5pZmVzdH0gb2JqZWN0IGJlY29tZXMgYSB7QGxpbmsgRXh0TWFuaWZlc3RXaXRoU2NoZW1hfSBvYmplY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RXh0ZW5zaW9uVHlwZX0gRXh0VHlwZVxuICAgKiBAcGFyYW0ge0V4dE1hbmlmZXN0PEV4dFR5cGU+fSBleHRNYW5pZmVzdFxuICAgKiBAcmV0dXJucyB7ZXh0TWFuaWZlc3QgaXMgRXh0TWFuaWZlc3RXaXRoU2NoZW1hPEV4dFR5cGU+fVxuICAgKi9cbiAgc3RhdGljIGV4dERhdGFIYXNTY2hlbWEoZXh0TWFuaWZlc3QpIHtcbiAgICByZXR1cm4gXy5pc1N0cmluZyhleHRNYW5pZmVzdD8uc2NoZW1hKSB8fCBfLmlzT2JqZWN0KGV4dE1hbmlmZXN0Py5zY2hlbWEpO1xuICB9XG5cbiAgLyoqXG4gICAqIElmIGFuIGV4dGVuc2lvbiBwcm92aWRlcyBhIHNjaGVtYSwgdGhpcyB3aWxsIGxvYWQgdGhlIHNjaGVtYSBhbmQgYXR0ZW1wdCB0b1xuICAgKiByZWdpc3RlciBpdCB3aXRoIHRoZSBzY2hlbWEgcmVnaXN0cmFyLlxuICAgKiBAcGFyYW0ge0V4dE5hbWU8RXh0VHlwZT59IGV4dE5hbWUgLSBOYW1lIG9mIGV4dGVuc2lvblxuICAgKiBAcGFyYW0ge0V4dE1hbmlmZXN0V2l0aFNjaGVtYTxFeHRUeXBlPn0gZXh0TWFuaWZlc3QgLSBFeHRlbnNpb24gZGF0YVxuICAgKiBAcmV0dXJucyB7aW1wb3J0KCdhanYnKS5TY2hlbWFPYmplY3R8dW5kZWZpbmVkfVxuICAgKi9cbiAgcmVhZEV4dGVuc2lvblNjaGVtYShleHROYW1lLCBleHRNYW5pZmVzdCkge1xuICAgIHJldHVybiBFeHRlbnNpb25Db25maWcuX3JlYWRFeHRlbnNpb25TY2hlbWEoXG4gICAgICB0aGlzLmFwcGl1bUhvbWUsXG4gICAgICB0aGlzLmV4dGVuc2lvblR5cGUsXG4gICAgICBleHROYW1lLFxuICAgICAgZXh0TWFuaWZlc3RcbiAgICApO1xuICB9XG59XG5cbmV4cG9ydCB7SU5TVEFMTF9UWVBFX05QTSwgSU5TVEFMTF9UWVBFX0dJVCwgSU5TVEFMTF9UWVBFX0xPQ0FMLCBJTlNUQUxMX1RZUEVfR0lUSFVCLCBJTlNUQUxMX1RZUEVTfTtcblxuLyoqXG4gKiBBbiBpc3N1ZSB3aXRoIHRoZSB7QGxpbmtjb2RlIEV4dE1hbmlmZXN0fSBmb3IgYSBwYXJ0aWN1bGFyIGV4dGVuc2lvbi5cbiAqXG4gKiBUaGUgZXhpc3RhbmNlIG9mIHN1Y2ggYW4gb2JqZWN0IGltcGxpZXMgdGhhdCB0aGUgZXh0ZW5zaW9uIGNhbm5vdCBiZSBsb2FkZWQuXG4gKiBAdHlwZWRlZiBFeHRNYW5pZmVzdFByb2JsZW1cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBlcnIgLSBFcnJvciBtZXNzYWdlXG4gKiBAcHJvcGVydHkge2FueX0gdmFsIC0gQXNzb2NpYXRlZCB2YWx1ZVxuICovXG5cbi8qKlxuICogQW4gb3B0aW9uYWwgbG9nZ2luZyBmdW5jdGlvbiBwcm92aWRlZCB0byBhbiB7QGxpbmsgRXh0ZW5zaW9uQ29uZmlnfSBzdWJjbGFzcy5cbiAqIEBjYWxsYmFjayBFeHRlbnNpb25Mb2dGblxuICogQHBhcmFtIHsuLi5hbnl9IGFyZ3NcbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge2ltcG9ydCgnQGFwcGl1bS90eXBlcycpLkV4dGVuc2lvblR5cGV9IEV4dGVuc2lvblR5cGVcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJy4vbWFuaWZlc3QnKS5NYW5pZmVzdH0gTWFuaWZlc3RcbiAqL1xuXG4vKipcbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdhcHBpdW0vdHlwZXMnKS5FeHRNYW5pZmVzdDxUPn0gRXh0TWFuaWZlc3RcbiAqL1xuXG4vKipcbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdhcHBpdW0vdHlwZXMnKS5FeHRNYW5pZmVzdFdpdGhTY2hlbWE8VD59IEV4dE1hbmlmZXN0V2l0aFNjaGVtYVxuICovXG5cbi8qKlxuICogQHRlbXBsYXRlIFRcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJ2FwcGl1bS90eXBlcycpLkV4dE5hbWU8VD59IEV4dE5hbWVcbiAqL1xuXG4vKipcbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdhcHBpdW0vdHlwZXMnKS5FeHRDbGFzczxUPn0gRXh0Q2xhc3NcbiAqL1xuXG4vKipcbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdhcHBpdW0vdHlwZXMnKS5FeHRSZWNvcmQ8VD59IEV4dFJlY29yZFxuICovXG5cbi8qKlxuICogQHRlbXBsYXRlIFRcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJy4uL2NsaS9leHRlbnNpb24nKS5FeHRDb21tYW5kPFQ+fSBFeHRDb21tYW5kXG4gKi9cblxuLyoqXG4gKiBPcHRpb25zIGZvciB2YXJpb3VzIG1ldGhvZHMgaW4ge0BsaW5rIEV4dGVuc2lvbkNvbmZpZ31cbiAqIEB0eXBlZGVmIEV4dGVuc2lvbkNvbmZpZ011dGF0aW9uT3B0c1xuICogQHByb3BlcnR5IHtib29sZWFufSBbd3JpdGU9dHJ1ZV0gV2hldGhlciBvciBub3QgdG8gd3JpdGUgdGhlIG1hbmlmZXN0IHRvIGRpc2sgYWZ0ZXIgYSBtdXRhdGlvbiBvcGVyYXRpb25cbiAqL1xuXG4vKipcbiAqIEEgdmFsaWQgaW5zdGFsbCB0eXBlXG4gKiBAdHlwZWRlZiB7dHlwZW9mIElOU1RBTExfVFlQRV9OUE0gfCB0eXBlb2YgSU5TVEFMTF9UWVBFX0dJVCB8IHR5cGVvZiBJTlNUQUxMX1RZUEVfTE9DQUwgfCB0eXBlb2YgSU5TVEFMTF9UWVBFX0dJVEhVQn0gSW5zdGFsbFR5cGVcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJy4uL2NsaS9leHRlbnNpb24tY29tbWFuZCcpLkV4dGVuc2lvbkxpc3REYXRhfSBFeHRlbnNpb25MaXN0RGF0YVxuICogQHR5cGVkZWYge2ltcG9ydCgnLi4vY2xpL2V4dGVuc2lvbi1jb21tYW5kJykuSW5zdGFsbGVkRXh0ZW5zaW9uTGlzdERhdGF9IEluc3RhbGxlZEV4dGVuc2lvbkxpc3REYXRhXG4gKi9cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUE7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7QUFNQSxNQUFNQSxnQkFBZ0IsR0FBRyxLQUF6Qjs7QUFDQSxNQUFNQyxrQkFBa0IsR0FBRyxPQUEzQjs7QUFDQSxNQUFNQyxtQkFBbUIsR0FBRyxRQUE1Qjs7QUFDQSxNQUFN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