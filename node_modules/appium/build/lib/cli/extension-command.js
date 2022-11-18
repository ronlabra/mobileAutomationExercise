"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.ExtensionCommand = void 0;

require("source-map-support/register");

var _bluebird = _interopRequireDefault(require("bluebird"));

var _lodash = _interopRequireDefault(require("lodash"));

var _path = _interopRequireDefault(require("path"));

var _support = require("@appium/support");

var _utils = require("./utils");

var _teen_process = require("teen_process");

var _extensionConfig = require("../extension/extension-config");

var _packageChanged = require("../extension/package-changed");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const UPDATE_ALL = 'installed';

class NotUpdatableError extends Error {}

class NoUpdatesAvailableError extends Error {}

class ExtensionCommand {
  config;
  knownExtensions;
  isJsonOutput;

  constructor({
    config,
    json
  }) {
    this.config = config;
    this.log = new _support.console.CliConsole({
      jsonMode: json
    });
    this.isJsonOutput = Boolean(json);
  }

  get type() {
    return this.config.extensionType;
  }

  _createFatalError(message) {
    return new Error(this.log.decorate(message, 'error'));
  }

  async execute(args) {
    const cmd = args[`${this.type}Command`];

    if (!_lodash.default.isFunction(this[cmd])) {
      throw this._createFatalError(`Cannot handle ${this.type} command ${cmd}`);
    }

    const executeCmd = this[cmd].bind(this);
    return await executeCmd(args);
  }

  async list({
    showInstalled,
    showUpdates
  }) {
    const lsMsg = `Listing ${showInstalled ? 'installed' : 'available'} ${this.type}s`;
    const installedNames = Object.keys(this.config.installedExtensions);
    const knownNames = Object.keys(this.knownExtensions);
    const exts = [...installedNames, ...knownNames].reduce((acc, name) => {
      if (!acc[name]) {
        if (installedNames.includes(name)) {
          acc[name] = { ...this.config.installedExtensions[name],
            installed: true
          };
        } else if (!showInstalled) {
          acc[name] = {
            pkgName: this.knownExtensions[name],
            installed: false
          };
        }
      }

      return acc;
    }, {});
    await (0, _utils.spinWith)(this.isJsonOutput, lsMsg, async () => {
      if (!showUpdates) {
        return;
      }

      for (const [ext, data] of _lodash.default.toPairs(exts)) {
        if (!data.installed || data.installType !== _extensionConfig.INSTALL_TYPE_NPM) {
          continue;
        }

        const updates = await this.checkForExtensionUpdate(ext);
        data.updateVersion = updates.safeUpdate;
        data.unsafeUpdateVersion = updates.unsafeUpdate;
        data.upToDate = updates.safeUpdate === null && updates.unsafeUpdate === null;
      }
    });
    const listData = exts;

    if (this.isJsonOutput) {
      return listData;
    }

    for (const [name, data] of _lodash.default.toPairs(listData)) {
      let installTxt = ' [not installed]'.grey;
      let updateTxt = '';
      let upToDateTxt = '';
      let unsafeUpdateTxt = '';

      if (data.installed) {
        const {
          installType,
          installSpec,
          updateVersion,
          unsafeUpdateVersion,
          version,
          upToDate
        } = data;
        let typeTxt;

        switch (installType) {
          case _extensionConfig.INSTALL_TYPE_GIT:
          case _extensionConfig.INSTALL_TYPE_GITHUB:
            typeTxt = `(cloned from ${installSpec})`.yellow;
            break;

          case _extensionConfig.INSTALL_TYPE_LOCAL:
            typeTxt = `(linked from ${installSpec})`.magenta;
            break;

          default:
            typeTxt = '(NPM)';
        }

        installTxt = `@${version.yellow} ${('[installed ' + typeTxt + ']').green}`;

        if (showUpdates) {
          if (updateVersion) {
            updateTxt = ` [${updateVersion} available]`.magenta;
          }

          if (upToDate) {
            upToDateTxt = ` [Up to date]`.green;
          }

          if (unsafeUpdateVersion) {
            unsafeUpdateTxt = ` [${unsafeUpdateVersion} available (potentially unsafe)]`.cyan;
          }
        }
      }

      this.log.log(`- ${name.yellow}${installTxt}${updateTxt}${upToDateTxt}${unsafeUpdateTxt}`);
    }

    return listData;
  }

  async _install({
    installSpec,
    installType,
    packageName
  }) {
    let extData;

    if (packageName && [_extensionConfig.INSTALL_TYPE_LOCAL, _extensionConfig.INSTALL_TYPE_NPM].includes(installType)) {
      throw this._createFatalError(`When using --source=${installType}, cannot also use --package`);
    }

    if (!packageName && [_extensionConfig.INSTALL_TYPE_GIT, _extensionConfig.INSTALL_TYPE_GITHUB].includes(installType)) {
      throw this._createFatalError(`When using --source=${installType}, must also use --package`);
    }

    let installOpts;
    let probableExtName = '';

    if (installType === _extensionConfig.INSTALL_TYPE_GITHUB) {
      if (installSpec.split('/').length !== 2) {
        throw this._createFatalError(`Github ${this.type} spec ${installSpec} appeared to be invalid; ` + 'it should be of the form <org>/<repo>');
      }

      installOpts = {
        installSpec,
        pkgName: packageName
      };
      probableExtName = installSpec;
    } else if (installType === _extensionConfig.INSTALL_TYPE_GIT) {
      installSpec = installSpec.replace(/\.git$/, '');
      installOpts = {
        installSpec,
        pkgName: packageName
      };
      probableExtName = installSpec;
    } else {
      let pkgName, pkgVer;

      if (installType === _extensionConfig.INSTALL_TYPE_LOCAL) {
        pkgName = _path.default.isAbsolute(installSpec) ? installSpec : _path.default.resolve(installSpec);
      } else {
        let name;
        const splits = installSpec.split('@');

        if (installSpec[0] === '@') {
          [name, pkgVer] = [`@${splits[1]}`, splits[2]];
        } else {
          [name, pkgVer] = splits;
        }

        if (installType === _extensionConfig.INSTALL_TYPE_NPM) {
          pkgName = name;
        } else {
          const knownNames = Object.keys(this.knownExtensions);

          if (!_lodash.default.includes(knownNames, name)) {
            const msg = `Could not resolve ${this.type}; are you sure it's in the list ` + `of supported ${this.type}s? ${JSON.stringify(knownNames)}`;
            throw this._createFatalError(msg);
          }

          probableExtName = name;
          pkgName = this.knownExtensions[name];
          installType = _extensionConfig.INSTALL_TYPE_NPM;
        }
      }

      installOpts = {
        installSpec,
        pkgName,
        pkgVer
      };
    }

    if (probableExtName && this.config.isInstalled(probableExtName)) {
      throw this._createFatalError(`A ${this.type} named "${probableExtName}" is already installed. ` + `Did you mean to update? Run "appium ${this.type} update". See ` + `installed ${this.type}s with "appium ${this.type} list --installed".`);
    }

    extData = await this.installViaNpm(installOpts);
    const extName = extData[`${this.type}Name`];

    if (this.config.isInstalled(extName)) {
      throw this._createFatalError(`A ${this.type} named "${extName}" is already installed. ` + `Did you mean to update? Run "appium ${this.type} update". See ` + `installed ${this.type}s with "appium ${this.type} list --installed".`);
    }

    delete extData[`${this.type}Name`];
    const extManifest = { ...extData,
      installType,
      installSpec
    };
    const [errors, warnings] = await _bluebird.default.all([this.config.getProblems(extName, extManifest), this.config.getWarnings(extName, extManifest)]);
    const errorMap = new Map([[extName, errors]]);
    const warningMap = new Map([[extName, warnings]]);
    const {
      errorSummaries,
      warningSummaries
    } = this.config.getValidationResultSummaries(errorMap, warningMap);

    if (!_lodash.default.isEmpty(errorSummaries)) {
      throw this._createFatalError(errorSummaries.join('\n'));
    }

    if (!_lodash.default.isEmpty(warningSummaries)) {
      this.log.warn(warningSummaries.join('\n'));
    }

    await this.config.addExtension(extName, extManifest);

    if (await _support.env.hasAppiumDependency(this.config.appiumHome)) {
      await (0, _packageChanged.packageDidChange)(this.config.appiumHome);
    }

    this.log.info(this.getPostInstallText({
      extName,
      extData
    }));
    return this.config.installedExtensions;
  }

  async installViaNpm({
    installSpec,
    pkgName,
    pkgVer
  }) {
    const npmSpec = `${pkgName}${pkgVer ? '@' + pkgVer : ''}`;
    const specMsg = npmSpec === installSpec ? '' : ` using NPM install spec '${npmSpec}'`;
    const msg = `Installing '${installSpec}'${specMsg}`;

    try {
      const pkgJsonData = await (0, _utils.spinWith)(this.isJsonOutput, msg, async () => {
        const pkgJsonData = await _support.npm.installPackage(this.config.appiumHome, pkgName, {
          pkgVer
        });
        this.validatePackageJson(pkgJsonData, installSpec);
        return pkgJsonData;
      });
      return this.getExtensionFields(pkgJsonData);
    } catch (err) {
      throw this._createFatalError(`Encountered an error when installing package: ${err.message}`);
    }
  }

  getPostInstallText(args) {
    throw this._createFatalError('Must be implemented in final class');
  }

  getExtensionFields(pkgJson) {
    const {
      appium,
      name,
      version,
      peerDependencies
    } = pkgJson;
    const result = { ...appium,
      pkgName: name,
      version,
      appiumVersion: peerDependencies === null || peerDependencies === void 0 ? void 0 : peerDependencies.appium
    };
    return result;
  }

  validatePackageJson(pkgJson, installSpec) {
    const {
      appium,
      name,
      version
    } = pkgJson;

    const createMissingFieldError = field => new ReferenceError(`${this.type} "${installSpec}" invalid; missing a \`${field}\` field of its \`package.json\``);

    if (!name) {
      throw createMissingFieldError('name');
    }

    if (!version) {
      throw createMissingFieldError('version');
    }

    if (!appium) {
      throw createMissingFieldError('appium');
    }

    this.validateExtensionFields(appium, installSpec);
    return true;
  }

  validateExtensionFields(extMetadata, installSpec) {
    throw this._createFatalError('Must be implemented in final class');
  }

  async _uninstall({
    installSpec
  }) {
    if (!this.config.isInstalled(installSpec)) {
      throw this._createFatalError(`Can't uninstall ${this.type} '${installSpec}'; it is not installed`);
    }

    const pkgName = this.config.installedExtensions[installSpec].pkgName;
    await _support.npm.uninstallPackage(this.config.appiumHome, pkgName);
    await this.config.removeExtension(installSpec);
    this.log.ok(`Successfully uninstalled ${this.type} '${installSpec}'`.green);
    return this.config.installedExtensions;
  }

  async _update({
    installSpec,
    unsafe
  }) {
    const shouldUpdateAll = installSpec === UPDATE_ALL;

    if (!shouldUpdateAll && !this.config.isInstalled(installSpec)) {
      throw this._createFatalError(`The ${this.type} "${installSpec}" was not installed, so can't be updated`);
    }

    const extsToUpdate = shouldUpdateAll ? Object.keys(this.config.installedExtensions) : [installSpec];
    const errors = {};
    const updates = {};

    for (const e of extsToUpdate) {
      try {
        await (0, _utils.spinWith)(this.isJsonOutput, `Checking if ${this.type} '${e}' is updatable`, () => {
          if (this.config.installedExtensions[e].installType !== _extensionConfig.INSTALL_TYPE_NPM) {
            throw new NotUpdatableError();
          }
        });
        const update = await (0, _utils.spinWith)(this.isJsonOutput, `Checking if ${this.type} '${e}' needs an update`, async () => {
          const update = await this.checkForExtensionUpdate(e);

          if (!(update.safeUpdate || update.unsafeUpdate)) {
            throw new NoUpdatesAvailableError();
          }

          return update;
        });

        if (!unsafe && !update.safeUpdate) {
          throw this._createFatalError(`The ${this.type} '${e}' has a major revision update ` + `(${update.current} => ${update.unsafeUpdate}), which could include ` + `breaking changes. If you want to apply this update, re-run with --unsafe`);
        }

        const updateVer = unsafe && update.unsafeUpdate ? update.unsafeUpdate : update.safeUpdate;
        await (0, _utils.spinWith)(this.isJsonOutput, `Updating driver '${e}' from ${update.current} to ${updateVer}`, async () => await this.updateExtension(e, updateVer));
        updates[e] = {
          from: update.current,
          to: updateVer
        };
      } catch (err) {
        errors[e] = err;
      }
    }

    this.log.info('Update report:');

    for (const [e, update] of _lodash.default.toPairs(updates)) {
      this.log.ok(`  - ${this.type} ${e} updated: ${update.from} => ${update.to}`.green);
    }

    for (const [e, err] of _lodash.default.toPairs(errors)) {
      if (err instanceof NotUpdatableError) {
        this.log.warn(`  - '${e}' was not installed via npm, so we could not check ` + `for updates`.yellow);
      } else if (err instanceof NoUpdatesAvailableError) {
        this.log.info(`  - '${e}' had no updates available`.yellow);
      } else {
        this.log.error(`  - '${e}' failed to update: ${err}`.red);
      }
    }

    return {
      updates,
      errors
    };
  }

  async checkForExtensionUpdate(ext) {
    const {
      version,
      pkgName
    } = this.config.installedExtensions[ext];
    let unsafeUpdate = await _support.npm.getLatestVersion(this.config.appiumHome, pkgName);
    let safeUpdate = await _support.npm.getLatestSafeUpgradeVersion(this.config.appiumHome, pkgName, version);

    if (unsafeUpdate !== null && !_support.util.compareVersions(unsafeUpdate, '>', version)) {
      unsafeUpdate = null;
      safeUpdate = null;
    }

    if (unsafeUpdate && unsafeUpdate === safeUpdate) {
      unsafeUpdate = null;
    }

    if (safeUpdate && !_support.util.compareVersions(safeUpdate, '>', version)) {
      safeUpdate = null;
    }

    return {
      current: version,
      safeUpdate,
      unsafeUpdate
    };
  }

  async updateExtension(installSpec, version) {
    const {
      pkgName
    } = this.config.installedExtensions[installSpec];
    const extData = await this.installViaNpm({
      installSpec,
      pkgName,
      pkgVer: version
    });
    delete extData[`${this.type}Name`];
    await this.config.updateExtension(installSpec, extData);
  }

  async _run({
    installSpec,
    scriptName,
    extraArgs = []
  }) {
    if (!this.config.isInstalled(installSpec)) {
      throw this._createFatalError(`The ${this.type} "${installSpec}" is not installed`);
    }

    const extConfig = this.config.installedExtensions[installSpec];

    if (!extConfig.scripts) {
      throw this._createFatalError(`The ${this.type} named '${installSpec}' does not contain the ` + `"scripts" field underneath the "appium" field in its package.json`);
    }

    const extScripts = extConfig.scripts;

    if (!_lodash.default.isPlainObject(extScripts)) {
      throw this._createFatalError(`The ${this.type} named '${installSpec}' "scripts" field must be a plain object`);
    }

    if (!_lodash.default.has(extScripts, scriptName)) {
      throw this._createFatalError(`The ${this.type} named '${installSpec}' does not support the script: '${scriptName}'`);
    }

    const runner = new _teen_process.SubProcess(process.execPath, [extScripts[scriptName], ...extraArgs], {
      cwd: this.config.getInstallPath(installSpec)
    });
    const output = new _utils.RingBuffer(50);
    runner.on('stream-line', line => {
      output.enqueue(line);
      this.log.log(line);
    });
    await runner.start(0);

    try {
      await runner.join();
      this.log.ok(`${scriptName} successfully ran`.green);
      return {
        output: output.getBuff()
      };
    } catch (err) {
      this.log.error(`Encountered an error when running '${scriptName}': ${err.message}`.red);
      return {
        error: err.message,
        output: output.getBuff()
      };
    }
  }

}

exports.ExtensionCommand = ExtensionCommand;
var _default = ExtensionCommand;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJVUERBVEVfQUxMIiwiTm90VXBkYXRhYmxlRXJyb3IiLCJFcnJvciIsIk5vVXBkYXRlc0F2YWlsYWJsZUVycm9yIiwiRXh0ZW5zaW9uQ29tbWFuZCIsImNvbmZpZyIsImtub3duRXh0ZW5zaW9ucyIsImlzSnNvbk91dHB1dCIsImNvbnN0cnVjdG9yIiwianNvbiIsImxvZyIsImNvbnNvbGUiLCJDbGlDb25zb2xlIiwianNvbk1vZGUiLCJCb29sZWFuIiwidHlwZSIsImV4dGVuc2lvblR5cGUiLCJfY3JlYXRlRmF0YWxFcnJvciIsIm1lc3NhZ2UiLCJkZWNvcmF0ZSIsImV4ZWN1dGUiLCJhcmdzIiwiY21kIiwiXyIsImlzRnVuY3Rpb24iLCJleGVjdXRlQ21kIiwiYmluZCIsImxpc3QiLCJzaG93SW5zdGFsbGVkIiwic2hvd1VwZGF0ZXMiLCJsc01zZyIsImluc3RhbGxlZE5hbWVzIiwiT2JqZWN0Iiwia2V5cyIsImluc3RhbGxlZEV4dGVuc2lvbnMiLCJrbm93bk5hbWVzIiwiZXh0cyIsInJlZHVjZSIsImFjYyIsIm5hbWUiLCJpbmNsdWRlcyIsImluc3RhbGxlZCIsInBrZ05hbWUiLCJzcGluV2l0aCIsImV4dCIsImRhdGEiLCJ0b1BhaXJzIiwiaW5zdGFsbFR5cGUiLCJJTlNUQUxMX1RZUEVfTlBNIiwidXBkYXRlcyIsImNoZWNrRm9yRXh0ZW5zaW9uVXBkYXRlIiwidXBkYXRlVmVyc2lvbiIsInNhZmVVcGRhdGUiLCJ1bnNhZmVVcGRhdGVWZXJzaW9uIiwidW5zYWZlVXBkYXRlIiwidXBUb0RhdGUiLCJsaXN0RGF0YSIsImluc3RhbGxUeHQiLCJncmV5IiwidXBkYXRlVHh0IiwidXBUb0RhdGVUeHQiLCJ1bnNhZmVVcGRhdGVUeHQiLCJpbnN0YWxsU3BlYyIsInZlcnNpb24iLCJ0eXBlVHh0IiwiSU5TVEFMTF9UWVBFX0dJVCIsIklOU1RBTExfVFlQRV9HSVRIVUIiLCJ5ZWxsb3ciLCJJTlNUQUxMX1RZUEVfTE9DQUwiLCJtYWdlbnRhIiwiZ3JlZW4iLCJjeWFuIiwiX2luc3RhbGwiLCJwYWNrYWdlTmFtZSIsImV4dERhdGEiLCJpbnN0YWxsT3B0cyIsInByb2JhYmxlRXh0TmFtZSIsInNwbGl0IiwibGVuZ3RoIiwicmVwbGFjZSIsInBrZ1ZlciIsInBhdGgiLCJpc0Fic29sdXRlIiwicmVzb2x2ZSIsInNwbGl0cyIsIm1zZyIsIkpTT04iLCJzdHJpbmdpZnkiLCJpc0luc3RhbGxlZCIsImluc3RhbGxWaWFOcG0iLCJleHROYW1lIiwiZXh0TWFuaWZlc3QiLCJlcnJvcnMiLCJ3YXJuaW5ncyIsIkIiLCJhbGwiLCJnZXRQcm9ibGVtcyIsImdldFdhcm5pbmdzIiwiZXJyb3JNYXAiLCJNYXAiLCJ3YXJuaW5nTWFwIiwiZXJyb3JTdW1tYXJpZXMiLCJ3YXJuaW5nU3VtbWFyaWVzIiwiZ2V0VmFsaWRhdGlvblJlc3VsdFN1bW1hcmllcyIsImlzRW1wdHkiLCJqb2luIiwid2FybiIsImFkZEV4dGVuc2lvbiIsImVudiIsImhhc0FwcGl1bURlcGVuZGVuY3kiLCJhcHBpdW1Ib21lIiwicGFja2FnZURpZENoYW5nZSIsImluZm8iLCJnZXRQb3N0SW5zdGFsbFRleHQiLCJucG1TcGVjIiwic3BlY01zZyIsInBrZ0pzb25EYXRhIiwibnBtIiwiaW5zdGFsbFBhY2thZ2UiLCJ2YWxpZGF0ZVBhY2thZ2VKc29uIiwiZ2V0RXh0ZW5zaW9uRmllbGRzIiwiZXJyIiwicGtnSnNvbiIsImFwcGl1bSIsInBlZXJEZXBlbmRlbmNpZXMiLCJyZXN1bHQiLCJhcHBpdW1WZXJzaW9uIiwiY3JlYXRlTWlzc2luZ0ZpZWxkRXJyb3IiLCJmaWVsZCIsIlJlZmVyZW5jZUVycm9yIiwidmFsaWRhdGVFeHRlbnNpb25GaWVsZHMiLCJleHRNZXRhZGF0YSIsIl91bmluc3RhbGwiLCJ1bmluc3RhbGxQYWNrYWdlIiwicmVtb3ZlRXh0ZW5zaW9uIiwib2siLCJfdXBkYXRlIiwidW5zYWZlIiwic2hvdWxkVXBkYXRlQWxsIiwiZXh0c1RvVXBkYXRlIiwiZSIsInVwZGF0ZSIsImN1cnJlbnQiLCJ1cGRhdGVWZXIiLCJ1cGRhdGVFeHRlbnNpb24iLCJmcm9tIiwidG8iLCJlcnJvciIsInJlZCIsImdldExhdGVzdFZlcnNpb24iLCJnZXRMYXRlc3RTYWZlVXBncmFkZVZlcnNpb24iLCJ1dGlsIiwiY29tcGFyZVZlcnNpb25zIiwiX3J1biIsInNjcmlwdE5hbWUiLCJleHRyYUFyZ3MiLCJleHRDb25maWciLCJzY3JpcHRzIiwiZXh0U2NyaXB0cyIsImlzUGxhaW5PYmplY3QiLCJoYXMiLCJydW5uZXIiLCJTdWJQcm9jZXNzIiwicHJvY2VzcyIsImV4ZWNQYXRoIiwiY3dkIiwiZ2V0SW5zdGFsbFBhdGgiLCJvdXRwdXQiLCJSaW5nQnVmZmVyIiwib24iLCJsaW5lIiwiZW5xdWV1ZSIsInN0YXJ0IiwiZ2V0QnVmZiJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2xpYi9jbGkvZXh0ZW5zaW9uLWNvbW1hbmQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyogZXNsaW50LWRpc2FibGUgbm8tY29uc29sZSAqL1xuaW1wb3J0IEIgZnJvbSAnYmx1ZWJpcmQnO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHtucG0sIHV0aWwsIGVudiwgY29uc29sZX0gZnJvbSAnQGFwcGl1bS9zdXBwb3J0JztcbmltcG9ydCB7c3BpbldpdGgsIFJpbmdCdWZmZXJ9IGZyb20gJy4vdXRpbHMnO1xuaW1wb3J0IHtTdWJQcm9jZXNzfSBmcm9tICd0ZWVuX3Byb2Nlc3MnO1xuaW1wb3J0IHtcbiAgSU5TVEFMTF9UWVBFX05QTSxcbiAgSU5TVEFMTF9UWVBFX0dJVCxcbiAgSU5TVEFMTF9UWVBFX0dJVEhVQixcbiAgSU5TVEFMTF9UWVBFX0xPQ0FMLFxufSBmcm9tICcuLi9leHRlbnNpb24vZXh0ZW5zaW9uLWNvbmZpZyc7XG5pbXBvcnQge3BhY2thZ2VEaWRDaGFuZ2V9IGZyb20gJy4uL2V4dGVuc2lvbi9wYWNrYWdlLWNoYW5nZWQnO1xuXG5jb25zdCBVUERBVEVfQUxMID0gJ2luc3RhbGxlZCc7XG5cbmNsYXNzIE5vdFVwZGF0YWJsZUVycm9yIGV4dGVuZHMgRXJyb3Ige31cbmNsYXNzIE5vVXBkYXRlc0F2YWlsYWJsZUVycm9yIGV4dGVuZHMgRXJyb3Ige31cblxuLyoqXG4gKiBAdGVtcGxhdGUge0V4dGVuc2lvblR5cGV9IEV4dFR5cGVcbiAqL1xuY2xhc3MgRXh0ZW5zaW9uQ29tbWFuZCB7XG4gIC8qKlxuICAgKiBUaGlzIGlzIHRoZSBgRHJpdmVyQ29uZmlnYCBvciBgUGx1Z2luQ29uZmlnYCwgZGVwZW5kaW5nIG9uIGBFeHRUeXBlYC5cbiAgICogQHR5cGUge0V4dGVuc2lvbkNvbmZpZzxFeHRUeXBlPn1cbiAgICovXG4gIGNvbmZpZztcblxuICAvKipcbiAgICoge0BsaW5rY29kZSBSZWNvcmR9IG9mIG9mZmljaWFsIHBsdWdpbnMgb3IgZHJpdmVycy5cbiAgICogQHR5cGUge0tub3duRXh0ZW5zaW9uczxFeHRUeXBlPn1cbiAgICovXG4gIGtub3duRXh0ZW5zaW9ucztcblxuICAvKipcbiAgICogSWYgYHRydWVgLCBjb21tYW5kIG91dHB1dCBoYXMgYmVlbiByZXF1ZXN0ZWQgYXMgSlNPTi5cbiAgICogQHR5cGUge2Jvb2xlYW59XG4gICAqL1xuICBpc0pzb25PdXRwdXQ7XG5cbiAgLyoqXG4gICAqIEJ1aWxkIGFuIEV4dGVuc2lvbkNvbW1hbmRcbiAgICogQHBhcmFtIHtFeHRlbnNpb25Db21tYW5kT3B0aW9uczxFeHRUeXBlPn0gb3B0c1xuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZywganNvbn0pIHtcbiAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgICB0aGlzLmxvZyA9IG5ldyBjb25zb2xlLkNsaUNvbnNvbGUoe2pzb25Nb2RlOiBqc29ufSk7XG4gICAgdGhpcy5pc0pzb25PdXRwdXQgPSBCb29sZWFuKGpzb24pO1xuICB9XG5cbiAgLyoqXG4gICAqIGBkcml2ZXJgIG9yIGBwbHVnaW5gLCBkZXBlbmRpbmcgb24gdGhlIGBFeHRlbnNpb25Db25maWdgLlxuICAgKi9cbiAgZ2V0IHR5cGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmV4dGVuc2lvblR5cGU7XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhIG1lc3NhZ2UgYW5kIHJldHVybnMgYW4ge0BsaW5rY29kZSBFcnJvcn0gdG8gdGhyb3cuXG4gICAqXG4gICAqIEZvciBUUyB0byB1bmRlcnN0YW5kIHRoYXQgYSBmdW5jdGlvbiB0aHJvd3MgYW4gZXhjZXB0aW9uLCBpdCBtdXN0IGFjdHVhbGx5IHRocm93IGFuIGV4Y2VwdGlvbi0tXG4gICAqIGluIG90aGVyIHdvcmRzLCBfY2FsbGluZ18gYSBmdW5jdGlvbiB3aGljaCBpcyBndWFyYW50ZWVkIHRvIHRocm93IGFuIGV4Y2VwdGlvbiBpcyBub3QgZW5vdWdoLS1cbiAgICogbm9yIGlzIHNvbWV0aGluZyBsaWtlIGBAcmV0dXJucyB7bmV2ZXJ9YCB3aGljaCBkb2VzIG5vdCBpbXBseSBhIHRocm93biBleGNlcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlXG4gICAqIEBwcm90ZWN0ZWRcbiAgICogQHJldHVybnMge0Vycm9yfVxuICAgKi9cbiAgX2NyZWF0ZUZhdGFsRXJyb3IobWVzc2FnZSkge1xuICAgIHJldHVybiBuZXcgRXJyb3IodGhpcy5sb2cuZGVjb3JhdGUobWVzc2FnZSwgJ2Vycm9yJykpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRha2UgYSBDTEkgcGFyc2UgYW5kIHJ1biBhbiBleHRlbnNpb24gY29tbWFuZCBiYXNlZCBvbiBpdHMgdHlwZVxuICAgKlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIGEga2V5L3ZhbHVlIG9iamVjdCB3aXRoIENMSSBmbGFncyBhbmQgdmFsdWVzXG4gICAqIEByZXR1cm4ge1Byb21pc2U8b2JqZWN0Pn0gdGhlIHJlc3VsdCBvZiB0aGUgc3BlY2lmaWMgY29tbWFuZCB3aGljaCBpcyBleGVjdXRlZFxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZShhcmdzKSB7XG4gICAgY29uc3QgY21kID0gYXJnc1tgJHt0aGlzLnR5cGV9Q29tbWFuZGBdO1xuICAgIGlmICghXy5pc0Z1bmN0aW9uKHRoaXNbY21kXSkpIHtcbiAgICAgIHRocm93IHRoaXMuX2NyZWF0ZUZhdGFsRXJyb3IoYENhbm5vdCBoYW5kbGUgJHt0aGlzLnR5cGV9IGNvbW1hbmQgJHtjbWR9YCk7XG4gICAgfVxuICAgIGNvbnN0IGV4ZWN1dGVDbWQgPSB0aGlzW2NtZF0uYmluZCh0aGlzKTtcbiAgICByZXR1cm4gYXdhaXQgZXhlY3V0ZUNtZChhcmdzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMaXN0IGV4dGVuc2lvbnNcbiAgICpcbiAgICogQHBhcmFtIHtMaXN0T3B0aW9uc30gb3B0c1xuICAgKiBAcmV0dXJuIHtQcm9taXNlPEV4dGVuc2lvbkxpc3REYXRhPn0gbWFwIG9mIGV4dGVuc2lvbiBuYW1lcyB0byBleHRlbnNpb24gZGF0YVxuICAgKi9cbiAgYXN5bmMgbGlzdCh7c2hvd0luc3RhbGxlZCwgc2hvd1VwZGF0ZXN9KSB7XG4gICAgY29uc3QgbHNNc2cgPSBgTGlzdGluZyAke3Nob3dJbnN0YWxsZWQgPyAnaW5zdGFsbGVkJyA6ICdhdmFpbGFibGUnfSAke3RoaXMudHlwZX1zYDtcbiAgICBjb25zdCBpbnN0YWxsZWROYW1lcyA9IE9iamVjdC5rZXlzKHRoaXMuY29uZmlnLmluc3RhbGxlZEV4dGVuc2lvbnMpO1xuICAgIGNvbnN0IGtub3duTmFtZXMgPSBPYmplY3Qua2V5cyh0aGlzLmtub3duRXh0ZW5zaW9ucyk7XG4gICAgY29uc3QgZXh0cyA9IFsuLi5pbnN0YWxsZWROYW1lcywgLi4ua25vd25OYW1lc10ucmVkdWNlKFxuICAgICAgKGFjYywgbmFtZSkgPT4ge1xuICAgICAgICBpZiAoIWFjY1tuYW1lXSkge1xuICAgICAgICAgIGlmIChpbnN0YWxsZWROYW1lcy5pbmNsdWRlcyhuYW1lKSkge1xuICAgICAgICAgICAgYWNjW25hbWVdID0ge1xuICAgICAgICAgICAgICAuLi50aGlzLmNvbmZpZy5pbnN0YWxsZWRFeHRlbnNpb25zW25hbWVdLFxuICAgICAgICAgICAgICBpbnN0YWxsZWQ6IHRydWUsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0gZWxzZSBpZiAoIXNob3dJbnN0YWxsZWQpIHtcbiAgICAgICAgICAgIGFjY1tuYW1lXSA9IHtwa2dOYW1lOiB0aGlzLmtub3duRXh0ZW5zaW9uc1tuYW1lXSwgaW5zdGFsbGVkOiBmYWxzZX07XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBhY2M7XG4gICAgICB9LFxuICAgICAgLyoqXG4gICAgICAgKiBUaGlzIGFjY3VtdWxhdG9yIGNvbnRhaW5zIGVpdGhlciB7QGxpbmtjb2RlIFVuaW5zdGFsbGVkRXh0ZW5zaW9uTElzdERhdGF9IF9vcl9cbiAgICAgICAqIHtAbGlua2NvZGUgSW5zdGFsbGVkRXh0ZW5zaW9uTGlzdERhdGF9IHdpdGhvdXQgdXBncmFkZSBpbmZvcm1hdGlvbiAod2hpY2ggaXMgYWRkZWQgYnkgdGhlIGJlbG93IGNvZGUgYmxvY2spXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZyxQYXJ0aWFsPEluc3RhbGxlZEV4dGVuc2lvbkxpc3REYXRhPnxVbmluc3RhbGxlZEV4dGVuc2lvbkxpc3REYXRhPn1cbiAgICAgICAqLyAoe30pXG4gICAgKTtcblxuICAgIC8vIGlmIHdlIHdhbnQgdG8gc2hvdyB3aGV0aGVyIHVwZGF0ZXMgYXJlIGF2YWlsYWJsZSwgcHV0IHRoYXQgYmVoaW5kIGEgc3Bpbm5lclxuICAgIGF3YWl0IHNwaW5XaXRoKHRoaXMuaXNKc29uT3V0cHV0LCBsc01zZywgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFzaG93VXBkYXRlcykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IFtleHQsIGRhdGFdIG9mIF8udG9QYWlycyhleHRzKSkge1xuICAgICAgICBpZiAoIWRhdGEuaW5zdGFsbGVkIHx8IGRhdGEuaW5zdGFsbFR5cGUgIT09IElOU1RBTExfVFlQRV9OUE0pIHtcbiAgICAgICAgICAvLyBkb24ndCBuZWVkIHRvIGNoZWNrIGZvciB1cGRhdGVzIG9uIGV4dHMgdGhhdCBhcmVuJ3QgaW5zdGFsbGVkXG4gICAgICAgICAgLy8gYWxzbyBkb24ndCBuZWVkIHRvIGNoZWNrIGZvciB1cGRhdGVzIG9uIG5vbi1ucG0gZXh0c1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHVwZGF0ZXMgPSBhd2FpdCB0aGlzLmNoZWNrRm9yRXh0ZW5zaW9uVXBkYXRlKGV4dCk7XG4gICAgICAgIGRhdGEudXBkYXRlVmVyc2lvbiA9IHVwZGF0ZXMuc2FmZVVwZGF0ZTtcbiAgICAgICAgZGF0YS51bnNhZmVVcGRhdGVWZXJzaW9uID0gdXBkYXRlcy51bnNhZmVVcGRhdGU7XG4gICAgICAgIGRhdGEudXBUb0RhdGUgPSB1cGRhdGVzLnNhZmVVcGRhdGUgPT09IG51bGwgJiYgdXBkYXRlcy51bnNhZmVVcGRhdGUgPT09IG51bGw7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBsaXN0RGF0YSA9IC8qKiBAdHlwZSB7RXh0ZW5zaW9uTGlzdERhdGF9ICovIChleHRzKTtcblxuICAgIC8vIGlmIHdlJ3JlIGp1c3QgZ2V0dGluZyB0aGUgZGF0YSwgc2hvcnQgY2lyY3VpdCByZXR1cm4gaGVyZSBzaW5jZSB3ZSBkb24ndCBuZWVkIHRvIGRvIGFueVxuICAgIC8vIGZvcm1hdHRpbmcgbG9naWNcbiAgICBpZiAodGhpcy5pc0pzb25PdXRwdXQpIHtcbiAgICAgIHJldHVybiBsaXN0RGF0YTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCBkYXRhXSBvZiBfLnRvUGFpcnMobGlzdERhdGEpKSB7XG4gICAgICBsZXQgaW5zdGFsbFR4dCA9ICcgW25vdCBpbnN0YWxsZWRdJy5ncmV5O1xuICAgICAgbGV0IHVwZGF0ZVR4dCA9ICcnO1xuICAgICAgbGV0IHVwVG9EYXRlVHh0ID0gJyc7XG4gICAgICBsZXQgdW5zYWZlVXBkYXRlVHh0ID0gJyc7XG4gICAgICBpZiAoZGF0YS5pbnN0YWxsZWQpIHtcbiAgICAgICAgY29uc3Qge2luc3RhbGxUeXBlLCBpbnN0YWxsU3BlYywgdXBkYXRlVmVyc2lvbiwgdW5zYWZlVXBkYXRlVmVyc2lvbiwgdmVyc2lvbiwgdXBUb0RhdGV9ID1cbiAgICAgICAgICBkYXRhO1xuICAgICAgICBsZXQgdHlwZVR4dDtcbiAgICAgICAgc3dpdGNoIChpbnN0YWxsVHlwZSkge1xuICAgICAgICAgIGNhc2UgSU5TVEFMTF9UWVBFX0dJVDpcbiAgICAgICAgICBjYXNlIElOU1RBTExfVFlQRV9HSVRIVUI6XG4gICAgICAgICAgICB0eXBlVHh0ID0gYChjbG9uZWQgZnJvbSAke2luc3RhbGxTcGVjfSlgLnllbGxvdztcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgSU5TVEFMTF9UWVBFX0xPQ0FMOlxuICAgICAgICAgICAgdHlwZVR4dCA9IGAobGlua2VkIGZyb20gJHtpbnN0YWxsU3BlY30pYC5tYWdlbnRhO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHR5cGVUeHQgPSAnKE5QTSknO1xuICAgICAgICB9XG4gICAgICAgIGluc3RhbGxUeHQgPSBgQCR7dmVyc2lvbi55ZWxsb3d9ICR7KCdbaW5zdGFsbGVkICcgKyB0eXBlVHh0ICsgJ10nKS5ncmVlbn1gO1xuXG4gICAgICAgIGlmIChzaG93VXBkYXRlcykge1xuICAgICAgICAgIGlmICh1cGRhdGVWZXJzaW9uKSB7XG4gICAgICAgICAgICB1cGRhdGVUeHQgPSBgIFske3VwZGF0ZVZlcnNpb259IGF2YWlsYWJsZV1gLm1hZ2VudGE7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh1cFRvRGF0ZSkge1xuICAgICAgICAgICAgdXBUb0RhdGVUeHQgPSBgIFtVcCB0byBkYXRlXWAuZ3JlZW47XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh1bnNhZmVVcGRhdGVWZXJzaW9uKSB7XG4gICAgICAgICAgICB1bnNhZmVVcGRhdGVUeHQgPSBgIFske3Vuc2FmZVVwZGF0ZVZlcnNpb259IGF2YWlsYWJsZSAocG90ZW50aWFsbHkgdW5zYWZlKV1gLmN5YW47XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRoaXMubG9nLmxvZyhgLSAke25hbWUueWVsbG93fSR7aW5zdGFsbFR4dH0ke3VwZGF0ZVR4dH0ke3VwVG9EYXRlVHh0fSR7dW5zYWZlVXBkYXRlVHh0fWApO1xuICAgIH1cblxuICAgIHJldHVybiBsaXN0RGF0YTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxsIGFuIGV4dGVuc2lvblxuICAgKlxuICAgKiBAcGFyYW0ge0luc3RhbGxBcmdzfSBhcmdzXG4gICAqIEByZXR1cm4ge1Byb21pc2U8RXh0UmVjb3JkPEV4dFR5cGU+Pn0gbWFwIG9mIGFsbCBpbnN0YWxsZWQgZXh0ZW5zaW9uIG5hbWVzIHRvIGV4dGVuc2lvbiBkYXRhXG4gICAqL1xuICBhc3luYyBfaW5zdGFsbCh7aW5zdGFsbFNwZWMsIGluc3RhbGxUeXBlLCBwYWNrYWdlTmFtZX0pIHtcbiAgICAvKiogQHR5cGUge0V4dGVuc2lvbkZpZWxkczxFeHRUeXBlPn0gKi9cbiAgICBsZXQgZXh0RGF0YTtcblxuICAgIGlmIChwYWNrYWdlTmFtZSAmJiBbSU5TVEFMTF9UWVBFX0xPQ0FMLCBJTlNUQUxMX1RZUEVfTlBNXS5pbmNsdWRlcyhpbnN0YWxsVHlwZSkpIHtcbiAgICAgIHRocm93IHRoaXMuX2NyZWF0ZUZhdGFsRXJyb3IoYFdoZW4gdXNpbmcgLS1zb3VyY2U9JHtpbnN0YWxsVHlwZX0sIGNhbm5vdCBhbHNvIHVzZSAtLXBhY2thZ2VgKTtcbiAgICB9XG5cbiAgICBpZiAoIXBhY2thZ2VOYW1lICYmIFtJTlNUQUxMX1RZUEVfR0lULCBJTlNUQUxMX1RZUEVfR0lUSFVCXS5pbmNsdWRlcyhpbnN0YWxsVHlwZSkpIHtcbiAgICAgIHRocm93IHRoaXMuX2NyZWF0ZUZhdGFsRXJyb3IoYFdoZW4gdXNpbmcgLS1zb3VyY2U9JHtpbnN0YWxsVHlwZX0sIG11c3QgYWxzbyB1c2UgLS1wYWNrYWdlYCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHR5cGUge0luc3RhbGxWaWFOcG1BcmdzfVxuICAgICAqL1xuICAgIGxldCBpbnN0YWxsT3B0cztcblxuICAgIC8qKlxuICAgICAqIFRoZSBwcm9iYWJsZSAoPykgbmFtZSBvZiB0aGUgZXh0ZW5zaW9uIGRlcml2ZWQgZnJvbSB0aGUgaW5zdGFsbCBzcGVjLlxuICAgICAqXG4gICAgICogSWYgdXNpbmcgYSBsb2NhbCBpbnN0YWxsIHR5cGUsIHRoaXMgd2lsbCByZW1haW4gZW1wdHkuXG4gICAgICogQHR5cGUge3N0cmluZ31cbiAgICAgKi9cbiAgICBsZXQgcHJvYmFibGVFeHROYW1lID0gJyc7XG5cbiAgICAvLyBkZXBlbmRpbmcgb24gYGluc3RhbGxUeXBlYCwgYnVpbGQgdGhlIG9wdGlvbnMgdG8gcGFzcyBpbnRvIGBpbnN0YWxsVmlhTnBtYFxuICAgIGlmIChpbnN0YWxsVHlwZSA9PT0gSU5TVEFMTF9UWVBFX0dJVEhVQikge1xuICAgICAgaWYgKGluc3RhbGxTcGVjLnNwbGl0KCcvJykubGVuZ3RoICE9PSAyKSB7XG4gICAgICAgIHRocm93IHRoaXMuX2NyZWF0ZUZhdGFsRXJyb3IoXG4gICAgICAgICAgYEdpdGh1YiAke3RoaXMudHlwZX0gc3BlYyAke2luc3RhbGxTcGVjfSBhcHBlYXJlZCB0byBiZSBpbnZhbGlkOyBgICtcbiAgICAgICAgICAgICdpdCBzaG91bGQgYmUgb2YgdGhlIGZvcm0gPG9yZz4vPHJlcG8+J1xuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaW5zdGFsbE9wdHMgPSB7XG4gICAgICAgIGluc3RhbGxTcGVjLFxuICAgICAgICBwa2dOYW1lOiAvKiogQHR5cGUge3N0cmluZ30gKi8gKHBhY2thZ2VOYW1lKSxcbiAgICAgIH07XG4gICAgICBwcm9iYWJsZUV4dE5hbWUgPSBpbnN0YWxsU3BlYztcbiAgICB9IGVsc2UgaWYgKGluc3RhbGxUeXBlID09PSBJTlNUQUxMX1RZUEVfR0lUKSB7XG4gICAgICAvLyBnaXQgdXJscyBjYW4gaGF2ZSAnLmdpdCcgYXQgdGhlIGVuZCwgYnV0IHRoaXMgaXMgbm90IG5lY2Vzc2FyeSBhbmQgd291bGQgY29tcGxpY2F0ZSB0aGVcbiAgICAgIC8vIHdheSB3ZSBkb3dubG9hZCBhbmQgbmFtZSBkaXJlY3Rvcmllcywgc28gd2UgY2FuIGp1c3QgcmVtb3ZlIGl0XG4gICAgICBpbnN0YWxsU3BlYyA9IGluc3RhbGxTcGVjLnJlcGxhY2UoL1xcLmdpdCQvLCAnJyk7XG4gICAgICBpbnN0YWxsT3B0cyA9IHtcbiAgICAgICAgaW5zdGFsbFNwZWMsXG4gICAgICAgIHBrZ05hbWU6IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAocGFja2FnZU5hbWUpLFxuICAgICAgfTtcbiAgICAgIHByb2JhYmxlRXh0TmFtZSA9IGluc3RhbGxTcGVjO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgcGtnTmFtZSwgcGtnVmVyO1xuICAgICAgaWYgKGluc3RhbGxUeXBlID09PSBJTlNUQUxMX1RZUEVfTE9DQUwpIHtcbiAgICAgICAgcGtnTmFtZSA9IHBhdGguaXNBYnNvbHV0ZShpbnN0YWxsU3BlYykgPyBpbnN0YWxsU3BlYyA6IHBhdGgucmVzb2x2ZShpbnN0YWxsU3BlYyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBhdCB0aGlzIHBvaW50IHdlIGhhdmUgZWl0aGVyIGFuIG5wbSBwYWNrYWdlIG9yIGFuIGFwcGl1bSB2ZXJpZmllZCBleHRlbnNpb25cbiAgICAgICAgLy8gbmFtZSBvciBhIGxvY2FsIHBhdGguIGJvdGggb2Ygd2hpY2ggd2lsbCBiZSBpbnN0YWxsZWQgdmlhIG5wbS5cbiAgICAgICAgLy8gZXh0ZW5zaW9ucyBpbnN0YWxsZWQgdmlhIG5wbSBjYW4gaW5jbHVkZSB2ZXJzaW9ucyBvciB0YWdzIGFmdGVyIHRoZSAnQCdcbiAgICAgICAgLy8gc2lnbiwgc28gY2hlY2sgZm9yIHRoYXQuIFdlIGFsc28gbmVlZCB0byBiZSBjYXJlZnVsIHRoYXQgcGFja2FnZSBuYW1lcyB0aGVtc2VsdmVzIGNhblxuICAgICAgICAvLyBjb250YWluIHRoZSAnQCcgc3ltYm9sLCBhcyBpbiBgbnBtIGluc3RhbGwgQGFwcGl1bS9mYWtlLWRyaXZlckAxLjIuMGBcbiAgICAgICAgbGV0IG5hbWU7XG4gICAgICAgIGNvbnN0IHNwbGl0cyA9IGluc3RhbGxTcGVjLnNwbGl0KCdAJyk7XG4gICAgICAgIGlmIChpbnN0YWxsU3BlY1swXSA9PT0gJ0AnKSB7XG4gICAgICAgICAgLy8gdGhpcyBpcyB0aGUgY2FzZSB3aGVyZSB3ZSBoYXZlIGFuIG5wbSBvcmcgaW5jbHVkZWQgaW4gdGhlIHBhY2thZ2UgbmFtZVxuICAgICAgICAgIFtuYW1lLCBwa2dWZXJdID0gW2BAJHtzcGxpdHNbMV19YCwgc3BsaXRzWzJdXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB0aGlzIGlzIHRoZSBjYXNlIHdpdGhvdXQgYW4gbnBtIG9yZ1xuICAgICAgICAgIFtuYW1lLCBwa2dWZXJdID0gc3BsaXRzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGluc3RhbGxUeXBlID09PSBJTlNUQUxMX1RZUEVfTlBNKSB7XG4gICAgICAgICAgLy8gaWYgd2UncmUgaW5zdGFsbGluZyBhIG5hbWVkIHBhY2thZ2UgZnJvbSBucG0sIHdlIGRvbid0IG5lZWQgdG8gY2hlY2tcbiAgICAgICAgICAvLyBhZ2FpbnN0IHRoZSBhcHBpdW0gZXh0ZW5zaW9uIGxpc3Q7IGp1c3QgdXNlIHRoZSBpbnN0YWxsU3BlYyBhcyBpc1xuICAgICAgICAgIHBrZ05hbWUgPSBuYW1lO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIGlmIHdlJ3JlIGluc3RhbGxpbmcgYSBuYW1lZCBhcHBpdW0gZHJpdmVyIChsaWtlICd4Y3VpdGVzdCcpIHdlIG5lZWQgdG9cbiAgICAgICAgICAvLyBkZXJlZmVyZW5jZSB0aGUgYWN0dWFsIG5wbSBwYWNrYWdlICgnYXBwaXVwbS14Y3VpdGVzdC1kcml2ZXInKSwgc29cbiAgICAgICAgICAvLyBjaGVjayBpdCBleGlzdHMgYW5kIGdldCB0aGUgY29ycmVjdCBwYWNrYWdlXG4gICAgICAgICAgY29uc3Qga25vd25OYW1lcyA9IE9iamVjdC5rZXlzKHRoaXMua25vd25FeHRlbnNpb25zKTtcbiAgICAgICAgICBpZiAoIV8uaW5jbHVkZXMoa25vd25OYW1lcywgbmFtZSkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9XG4gICAgICAgICAgICAgIGBDb3VsZCBub3QgcmVzb2x2ZSAke3RoaXMudHlwZX07IGFyZSB5b3Ugc3VyZSBpdCdzIGluIHRoZSBsaXN0IGAgK1xuICAgICAgICAgICAgICBgb2Ygc3VwcG9ydGVkICR7dGhpcy50eXBlfXM/ICR7SlNPTi5zdHJpbmdpZnkoa25vd25OYW1lcyl9YDtcbiAgICAgICAgICAgIHRocm93IHRoaXMuX2NyZWF0ZUZhdGFsRXJyb3IobXNnKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcHJvYmFibGVFeHROYW1lID0gbmFtZTtcbiAgICAgICAgICBwa2dOYW1lID0gdGhpcy5rbm93bkV4dGVuc2lvbnNbbmFtZV07XG4gICAgICAgICAgLy8gZ2l2ZW4gdGhhdCB3ZSdsbCB1c2UgdGhlIGluc3RhbGwgdHlwZSBpbiB0aGUgZHJpdmVyIGpzb24sIHN0b3JlIGl0IGFzXG4gICAgICAgICAgLy8gJ25wbScgbm93XG4gICAgICAgICAgaW5zdGFsbFR5cGUgPSBJTlNUQUxMX1RZUEVfTlBNO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpbnN0YWxsT3B0cyA9IHtpbnN0YWxsU3BlYywgcGtnTmFtZSwgcGtnVmVyfTtcbiAgICB9XG5cbiAgICAvLyBmYWlsIGZhc3QgaGVyZSBpZiB3ZSBjYW5cbiAgICBpZiAocHJvYmFibGVFeHROYW1lICYmIHRoaXMuY29uZmlnLmlzSW5zdGFsbGVkKHByb2JhYmxlRXh0TmFtZSkpIHtcbiAgICAgIHRocm93IHRoaXMuX2NyZWF0ZUZhdGFsRXJyb3IoXG4gICAgICAgIGBBICR7dGhpcy50eXBlfSBuYW1lZCBcIiR7cHJvYmFibGVFeHROYW1lfVwiIGlzIGFscmVhZHkgaW5zdGFsbGVkLiBgICtcbiAgICAgICAgICBgRGlkIHlvdSBtZWFuIHRvIHVwZGF0ZT8gUnVuIFwiYXBwaXVtICR7dGhpcy50eXBlfSB1cGRhdGVcIi4gU2VlIGAgK1xuICAgICAgICAgIGBpbnN0YWxsZWQgJHt0aGlzLnR5cGV9cyB3aXRoIFwiYXBwaXVtICR7dGhpcy50eXBlfSBsaXN0IC0taW5zdGFsbGVkXCIuYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBleHREYXRhID0gYXdhaXQgdGhpcy5pbnN0YWxsVmlhTnBtKGluc3RhbGxPcHRzKTtcblxuICAgIC8vIHRoaXMgX3Nob3VsZF8gYmUgdGhlIHNhbWUgYXMgYHByb2JhYmx5RXh0TmFtZWAgYXMgdGhlIG9uZSBkZXJpdmVkIGFib3ZlIHVubGVzc1xuICAgIC8vIGluc3RhbGwgdHlwZSBpcyBsb2NhbC5cbiAgICBjb25zdCBleHROYW1lID0gZXh0RGF0YVsvKiogQHR5cGUge3N0cmluZ30gKi8gKGAke3RoaXMudHlwZX1OYW1lYCldO1xuXG4gICAgLy8gY2hlY2sgX2Egc2Vjb25kIHRpbWVfIHdpdGggdGhlIG1vcmUtYWNjdXJhdGUgZXh0TmFtZVxuICAgIGlmICh0aGlzLmNvbmZpZy5pc0luc3RhbGxlZChleHROYW1lKSkge1xuICAgICAgdGhyb3cgdGhpcy5fY3JlYXRlRmF0YWxFcnJvcihcbiAgICAgICAgYEEgJHt0aGlzLnR5cGV9IG5hbWVkIFwiJHtleHROYW1lfVwiIGlzIGFscmVhZHkgaW5zdGFsbGVkLiBgICtcbiAgICAgICAgICBgRGlkIHlvdSBtZWFuIHRvIHVwZGF0ZT8gUnVuIFwiYXBwaXVtICR7dGhpcy50eXBlfSB1cGRhdGVcIi4gU2VlIGAgK1xuICAgICAgICAgIGBpbnN0YWxsZWQgJHt0aGlzLnR5cGV9cyB3aXRoIFwiYXBwaXVtICR7dGhpcy50eXBlfSBsaXN0IC0taW5zdGFsbGVkXCIuYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyB0aGlzIGZpZWxkIGRvZXMgbm90IGV4aXN0IGFzIHN1Y2ggaW4gdGhlIG1hbmlmZXN0IChpdCdzIHVzZWQgYXMgYSBwcm9wZXJ0eSBuYW1lIGluc3RlYWQpXG4gICAgLy8gc28gdGhhdCdzIHdoeSBpdCdzIGJlaW5nIHJlbW92ZWQgaGVyZS5cbiAgICBkZWxldGUgZXh0RGF0YVsvKiogQHR5cGUge3N0cmluZ30gKi8gKGAke3RoaXMudHlwZX1OYW1lYCldO1xuXG4gICAgLyoqIEB0eXBlIHtFeHRNYW5pZmVzdDxFeHRUeXBlPn0gKi9cbiAgICBjb25zdCBleHRNYW5pZmVzdCA9IHsuLi5leHREYXRhLCBpbnN0YWxsVHlwZSwgaW5zdGFsbFNwZWN9O1xuICAgIGNvbnN0IFtlcnJvcnMsIHdhcm5pbmdzXSA9IGF3YWl0IEIuYWxsKFtcbiAgICAgIHRoaXMuY29uZmlnLmdldFByb2JsZW1zKGV4dE5hbWUsIGV4dE1hbmlmZXN0KSxcbiAgICAgIHRoaXMuY29uZmlnLmdldFdhcm5pbmdzKGV4dE5hbWUsIGV4dE1hbmlmZXN0KSxcbiAgICBdKTtcbiAgICBjb25zdCBlcnJvck1hcCA9IG5ldyBNYXAoW1tleHROYW1lLCBlcnJvcnNdXSk7XG4gICAgY29uc3Qgd2FybmluZ01hcCA9IG5ldyBNYXAoW1tleHROYW1lLCB3YXJuaW5nc11dKTtcbiAgICBjb25zdCB7ZXJyb3JTdW1tYXJpZXMsIHdhcm5pbmdTdW1tYXJpZXN9ID0gdGhpcy5jb25maWcuZ2V0VmFsaWRhdGlvblJlc3VsdFN1bW1hcmllcyhcbiAgICAgIGVycm9yTWFwLFxuICAgICAgd2FybmluZ01hcFxuICAgICk7XG5cbiAgICBpZiAoIV8uaXNFbXB0eShlcnJvclN1bW1hcmllcykpIHtcbiAgICAgIHRocm93IHRoaXMuX2NyZWF0ZUZhdGFsRXJyb3IoZXJyb3JTdW1tYXJpZXMuam9pbignXFxuJykpO1xuICAgIH1cblxuICAgIC8vIG5vdGUgdGhhdCB3ZSB3b24ndCBzaG93IGFueSB3YXJuaW5ncyBpZiB0aGVyZSB3ZXJlIGVycm9ycy5cbiAgICBpZiAoIV8uaXNFbXB0eSh3YXJuaW5nU3VtbWFyaWVzKSkge1xuICAgICAgdGhpcy5sb2cud2Fybih3YXJuaW5nU3VtbWFyaWVzLmpvaW4oJ1xcbicpKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmNvbmZpZy5hZGRFeHRlbnNpb24oZXh0TmFtZSwgZXh0TWFuaWZlc3QpO1xuXG4gICAgLy8gdXBkYXRlIHRoZSBpZiB3ZSd2ZSBjaGFuZ2VkIHRoZSBsb2NhbCBgcGFja2FnZS5qc29uYFxuICAgIGlmIChhd2FpdCBlbnYuaGFzQXBwaXVtRGVwZW5kZW5jeSh0aGlzLmNvbmZpZy5hcHBpdW1Ib21lKSkge1xuICAgICAgYXdhaXQgcGFja2FnZURpZENoYW5nZSh0aGlzLmNvbmZpZy5hcHBpdW1Ib21lKTtcbiAgICB9XG5cbiAgICAvLyBsb2cgaW5mbyBmb3IgdGhlIHVzZXJcbiAgICB0aGlzLmxvZy5pbmZvKHRoaXMuZ2V0UG9zdEluc3RhbGxUZXh0KHtleHROYW1lLCBleHREYXRhfSkpO1xuXG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmluc3RhbGxlZEV4dGVuc2lvbnM7XG4gIH1cblxuICAvKipcbiAgICogSW5zdGFsbCBhbiBleHRlbnNpb24gdmlhIE5QTVxuICAgKlxuICAgKiBAcGFyYW0ge0luc3RhbGxWaWFOcG1BcmdzfSBhcmdzXG4gICAqL1xuICBhc3luYyBpbnN0YWxsVmlhTnBtKHtpbnN0YWxsU3BlYywgcGtnTmFtZSwgcGtnVmVyfSkge1xuICAgIGNvbnN0IG5wbVNwZWMgPSBgJHtwa2dOYW1lfSR7cGtnVmVyID8gJ0AnICsgcGtnVmVyIDogJyd9YDtcbiAgICBjb25zdCBzcGVjTXNnID0gbnBtU3BlYyA9PT0gaW5zdGFsbFNwZWMgPyAnJyA6IGAgdXNpbmcgTlBNIGluc3RhbGwgc3BlYyAnJHtucG1TcGVjfSdgO1xuICAgIGNvbnN0IG1zZyA9IGBJbnN0YWxsaW5nICcke2luc3RhbGxTcGVjfScke3NwZWNNc2d9YDtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGtnSnNvbkRhdGEgPSBhd2FpdCBzcGluV2l0aCh0aGlzLmlzSnNvbk91dHB1dCwgbXNnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHBrZ0pzb25EYXRhID0gYXdhaXQgbnBtLmluc3RhbGxQYWNrYWdlKHRoaXMuY29uZmlnLmFwcGl1bUhvbWUsIHBrZ05hbWUsIHtcbiAgICAgICAgICBwa2dWZXIsXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnZhbGlkYXRlUGFja2FnZUpzb24ocGtnSnNvbkRhdGEsIGluc3RhbGxTcGVjKTtcbiAgICAgICAgcmV0dXJuIHBrZ0pzb25EYXRhO1xuICAgICAgfSk7XG5cbiAgICAgIHJldHVybiB0aGlzLmdldEV4dGVuc2lvbkZpZWxkcyhwa2dKc29uRGF0YSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyB0aGlzLl9jcmVhdGVGYXRhbEVycm9yKGBFbmNvdW50ZXJlZCBhbiBlcnJvciB3aGVuIGluc3RhbGxpbmcgcGFja2FnZTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSB0ZXh0IHdoaWNoIHNob3VsZCBiZSBkaXNwbGF5ZWQgdG8gdGhlIHVzZXIgYWZ0ZXIgYW4gZXh0ZW5zaW9uIGhhcyBiZWVuIGluc3RhbGxlZC4gVGhpc1xuICAgKiBpcyBkZXNpZ25lZCB0byBiZSBvdmVycmlkZGVuIGJ5IGRyaXZlcnMvcGx1Z2lucyB3aXRoIHRoZWlyIG93biBwYXJ0aWN1bGFyIHRleHQuXG4gICAqXG4gICAqIEBwYXJhbSB7RXh0ZW5zaW9uQXJnc30gYXJnc1xuICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgKi9cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXVudXNlZC12YXJzXG4gIGdldFBvc3RJbnN0YWxsVGV4dChhcmdzKSB7XG4gICAgdGhyb3cgdGhpcy5fY3JlYXRlRmF0YWxFcnJvcignTXVzdCBiZSBpbXBsZW1lbnRlZCBpbiBmaW5hbCBjbGFzcycpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRha2UgYW4gTlBNIG1vZHVsZSdzIHBhY2thZ2UuanNvbiBhbmQgZXh0cmFjdCBBcHBpdW0gZHJpdmVyIGluZm9ybWF0aW9uIGZyb20gYSBzcGVjaWFsXG4gICAqICdhcHBpdW0nIGZpZWxkIGluIHRoZSBKU09OIGRhdGEuIFdlIG5lZWQgdGhpcyBpbmZvcm1hdGlvbiB0byBlLmcuIGRldGVybWluZSB3aGljaCBjbGFzcyB0b1xuICAgKiBsb2FkIGFzIHRoZSBtYWluIGRyaXZlciBjbGFzcywgb3IgdG8gYmUgYWJsZSB0byBkZXRlY3QgaW5jb21wYXRpYmlsaXRpZXMgYmV0d2VlbiBkcml2ZXIgYW5kXG4gICAqIGFwcGl1bSB2ZXJzaW9ucy5cbiAgICpcbiAgICogQHBhcmFtIHtFeHRQYWNrYWdlSnNvbjxFeHRUeXBlPn0gcGtnSnNvbiAtIHRoZSBwYWNrYWdlLmpzb24gZGF0YSBmb3IgYSBkcml2ZXIgbW9kdWxlLCBhcyBpZiBpdCBoYWQgYmVlbiBzdHJhaWdodGZvcndhcmRseSAncmVxdWlyZSdkXG4gICAqIEByZXR1cm5zIHtFeHRlbnNpb25GaWVsZHM8RXh0VHlwZT59XG4gICAqL1xuICBnZXRFeHRlbnNpb25GaWVsZHMocGtnSnNvbikge1xuICAgIGNvbnN0IHthcHBpdW0sIG5hbWUsIHZlcnNpb24sIHBlZXJEZXBlbmRlbmNpZXN9ID0gcGtnSnNvbjtcblxuICAgIC8qKiBAdHlwZSB7dW5rbm93bn0gKi9cbiAgICBjb25zdCByZXN1bHQgPSB7XG4gICAgICAuLi5hcHBpdW0sXG4gICAgICBwa2dOYW1lOiBuYW1lLFxuICAgICAgdmVyc2lvbixcbiAgICAgIGFwcGl1bVZlcnNpb246IHBlZXJEZXBlbmRlbmNpZXM/LmFwcGl1bSxcbiAgICB9O1xuICAgIHJldHVybiAvKiogQHR5cGUge0V4dGVuc2lvbkZpZWxkczxFeHRUeXBlPn0gKi8gKHJlc3VsdCk7XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSBfcmVxdWlyZWRfIHJvb3QgZmllbGRzIG9mIGFuIGV4dGVuc2lvbidzIGBwYWNrYWdlLmpzb25gIGZpbGUuXG4gICAqXG4gICAqIFRoZXNlIHJlcXVpcmVkIGZpZWxkcyBhcmU6XG4gICAqIC0gYG5hbWVgXG4gICAqIC0gYHZlcnNpb25gXG4gICAqIC0gYGFwcGl1bWBcbiAgICogQHBhcmFtIHtpbXBvcnQoJ3R5cGUtZmVzdCcpLlBhY2thZ2VKc29ufSBwa2dKc29uIC0gYHBhY2thZ2UuanNvbmAgb2YgZXh0ZW5zaW9uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpbnN0YWxsU3BlYyAtIEV4dGVuc2lvbiBuYW1lL3NwZWNcbiAgICogQHRocm93cyB7UmVmZXJlbmNlRXJyb3J9IElmIGBwYWNrYWdlLmpzb25gIGhhcyBhIG1pc3Npbmcgb3IgaW52YWxpZCBmaWVsZFxuICAgKiBAcmV0dXJucyB7cGtnSnNvbiBpcyBFeHRQYWNrYWdlSnNvbjxFeHRUeXBlPn1cbiAgICovXG4gIHZhbGlkYXRlUGFja2FnZUpzb24ocGtnSnNvbiwgaW5zdGFsbFNwZWMpIHtcbiAgICBjb25zdCB7YXBwaXVtLCBuYW1lLCB2ZXJzaW9ufSA9IC8qKiBAdHlwZSB7RXh0UGFja2FnZUpzb248RXh0VHlwZT59ICovIChwa2dKc29uKTtcblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGZpZWxkXG4gICAgICogQHJldHVybnMge1JlZmVyZW5jZUVycm9yfVxuICAgICAqL1xuICAgIGNvbnN0IGNyZWF0ZU1pc3NpbmdGaWVsZEVycm9yID0gKGZpZWxkKSA9PlxuICAgICAgbmV3IFJlZmVyZW5jZUVycm9yKFxuICAgICAgICBgJHt0aGlzLnR5cGV9IFwiJHtpbnN0YWxsU3BlY31cIiBpbnZhbGlkOyBtaXNzaW5nIGEgXFxgJHtmaWVsZH1cXGAgZmllbGQgb2YgaXRzIFxcYHBhY2thZ2UuanNvblxcYGBcbiAgICAgICk7XG5cbiAgICBpZiAoIW5hbWUpIHtcbiAgICAgIHRocm93IGNyZWF0ZU1pc3NpbmdGaWVsZEVycm9yKCduYW1lJyk7XG4gICAgfVxuICAgIGlmICghdmVyc2lvbikge1xuICAgICAgdGhyb3cgY3JlYXRlTWlzc2luZ0ZpZWxkRXJyb3IoJ3ZlcnNpb24nKTtcbiAgICB9XG4gICAgaWYgKCFhcHBpdW0pIHtcbiAgICAgIHRocm93IGNyZWF0ZU1pc3NpbmdGaWVsZEVycm9yKCdhcHBpdW0nKTtcbiAgICB9XG5cbiAgICB0aGlzLnZhbGlkYXRlRXh0ZW5zaW9uRmllbGRzKGFwcGl1bSwgaW5zdGFsbFNwZWMpO1xuXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvKipcbiAgICogRm9yIGFueSBgcGFja2FnZS5qc29uYCBmaWVsZHMgd2hpY2ggYSBwYXJ0aWN1bGFyIHR5cGUgb2YgZXh0ZW5zaW9uIHJlcXVpcmVzLCB2YWxpZGF0ZSB0aGVcbiAgICogcHJlc2VuY2UgYW5kIGZvcm0gb2YgdGhvc2UgZmllbGRzIG9uIHRoZSBgcGFja2FnZS5qc29uYCBkYXRhLCB0aHJvd2luZyBhbiBlcnJvciBpZiBhbnl0aGluZyBpc1xuICAgKiBhbWlzcy5cbiAgICpcbiAgICogQHBhcmFtIHtFeHRNZXRhZGF0YTxFeHRUeXBlPn0gZXh0TWV0YWRhdGEgLSB0aGUgZGF0YSBpbiB0aGUgXCJhcHBpdW1cIiBmaWVsZCBvZiBgcGFja2FnZS5qc29uYCBmb3IgYW4gZXh0ZW5zaW9uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpbnN0YWxsU3BlYyAtIEV4dGVuc2lvbiBuYW1lL3NwZWNcbiAgICovXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnVzZWQtdmFyc1xuICB2YWxpZGF0ZUV4dGVuc2lvbkZpZWxkcyhleHRNZXRhZGF0YSwgaW5zdGFsbFNwZWMpIHtcbiAgICB0aHJvdyB0aGlzLl9jcmVhdGVGYXRhbEVycm9yKCdNdXN0IGJlIGltcGxlbWVudGVkIGluIGZpbmFsIGNsYXNzJyk7XG4gIH1cblxuICAvKipcbiAgICogVW5pbnN0YWxsIGFuIGV4dGVuc2lvbi5cbiAgICpcbiAgICogRmlyc3QgdHJpZXMgdG8gZG8gdGhpcyB2aWEgYG5wbSB1bmluc3RhbGxgLCBidXQgaWYgdGhhdCBmYWlscywganVzdCBgcm0gLXJmYCdzIHRoZSBleHRlbnNpb24gZGlyLlxuICAgKlxuICAgKiBXaWxsIG9ubHkgcmVtb3ZlIHRoZSBleHRlbnNpb24gZnJvbSB0aGUgbWFuaWZlc3QgaWYgaXQgaGFzIGJlZW4gc3VjY2Vzc2Z1bGx5IHJlbW92ZWQuXG4gICAqXG4gICAqIEBwYXJhbSB7VW5pbnN0YWxsT3B0c30gb3B0c1xuICAgKiBAcmV0dXJuIHtQcm9taXNlPEV4dFJlY29yZDxFeHRUeXBlPj59IG1hcCBvZiBhbGwgaW5zdGFsbGVkIGV4dGVuc2lvbiBuYW1lcyB0byBleHRlbnNpb24gZGF0YSAod2l0aG91dCB0aGUgZXh0ZW5zaW9uIGp1c3QgdW5pbnN0YWxsZWQpXG4gICAqL1xuICBhc3luYyBfdW5pbnN0YWxsKHtpbnN0YWxsU3BlY30pIHtcbiAgICBpZiAoIXRoaXMuY29uZmlnLmlzSW5zdGFsbGVkKGluc3RhbGxTcGVjKSkge1xuICAgICAgdGhyb3cgdGhpcy5fY3JlYXRlRmF0YWxFcnJvcihcbiAgICAgICAgYENhbid0IHVuaW5zdGFsbCAke3RoaXMudHlwZX0gJyR7aW5zdGFsbFNwZWN9JzsgaXQgaXMgbm90IGluc3RhbGxlZGBcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IHBrZ05hbWUgPSB0aGlzLmNvbmZpZy5pbnN0YWxsZWRFeHRlbnNpb25zW2luc3RhbGxTcGVjXS5wa2dOYW1lO1xuICAgIGF3YWl0IG5wbS51bmluc3RhbGxQYWNrYWdlKHRoaXMuY29uZmlnLmFwcGl1bUhvbWUsIHBrZ05hbWUpO1xuICAgIGF3YWl0IHRoaXMuY29uZmlnLnJlbW92ZUV4dGVuc2lvbihpbnN0YWxsU3BlYyk7XG4gICAgdGhpcy5sb2cub2soYFN1Y2Nlc3NmdWxseSB1bmluc3RhbGxlZCAke3RoaXMudHlwZX0gJyR7aW5zdGFsbFNwZWN9J2AuZ3JlZW4pO1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5pbnN0YWxsZWRFeHRlbnNpb25zO1xuICB9XG5cbiAgLyoqXG4gICAqIEF0dGVtcHQgdG8gdXBkYXRlIG9uZSBvciBtb3JlIGRyaXZlcnMgdXNpbmcgTlBNXG4gICAqXG4gICAqIEBwYXJhbSB7RXh0ZW5zaW9uVXBkYXRlT3B0c30gdXBkYXRlU3BlY1xuICAgKiBAcmV0dXJuIHtQcm9taXNlPEV4dGVuc2lvblVwZGF0ZVJlc3VsdD59XG4gICAqL1xuICBhc3luYyBfdXBkYXRlKHtpbnN0YWxsU3BlYywgdW5zYWZlfSkge1xuICAgIGNvbnN0IHNob3VsZFVwZGF0ZUFsbCA9IGluc3RhbGxTcGVjID09PSBVUERBVEVfQUxMO1xuICAgIC8vIGlmIHdlJ3JlIHNwZWNpZmljYWxseSByZXF1ZXN0aW5nIGFuIHVwZGF0ZSBmb3IgYW4gZXh0ZW5zaW9uLCBtYWtlIHN1cmUgaXQncyBpbnN0YWxsZWRcbiAgICBpZiAoIXNob3VsZFVwZGF0ZUFsbCAmJiAhdGhpcy5jb25maWcuaXNJbnN0YWxsZWQoaW5zdGFsbFNwZWMpKSB7XG4gICAgICB0aHJvdyB0aGlzLl9jcmVhdGVGYXRhbEVycm9yKFxuICAgICAgICBgVGhlICR7dGhpcy50eXBlfSBcIiR7aW5zdGFsbFNwZWN9XCIgd2FzIG5vdCBpbnN0YWxsZWQsIHNvIGNhbid0IGJlIHVwZGF0ZWRgXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBleHRzVG9VcGRhdGUgPSBzaG91bGRVcGRhdGVBbGxcbiAgICAgID8gT2JqZWN0LmtleXModGhpcy5jb25maWcuaW5zdGFsbGVkRXh0ZW5zaW9ucylcbiAgICAgIDogW2luc3RhbGxTcGVjXTtcblxuICAgIC8vICdlcnJvcnMnIHdpbGwgaGF2ZSBleHQgbmFtZXMgYXMga2V5cyBhbmQgZXJyb3Igb2JqZWN0cyBhcyB2YWx1ZXNcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsRXJyb3I+fSAqL1xuICAgIGNvbnN0IGVycm9ycyA9IHt9O1xuXG4gICAgLy8gJ3VwZGF0ZXMnIHdpbGwgaGF2ZSBleHQgbmFtZXMgYXMga2V5cyBhbmQgdXBkYXRlIG9iamVjdHMgYXMgdmFsdWVzLCB3aGVyZSBhbiB1cGRhdGVcbiAgICAvLyBvYmplY3QgaXMgb2YgdGhlIGZvcm0ge2Zyb206IHZlcnNpb25TdHJpbmcsIHRvOiB2ZXJzaW9uU3RyaW5nfVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZyxVcGRhdGVSZXBvcnQ+fSAqL1xuICAgIGNvbnN0IHVwZGF0ZXMgPSB7fTtcblxuICAgIGZvciAoY29uc3QgZSBvZiBleHRzVG9VcGRhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHNwaW5XaXRoKHRoaXMuaXNKc29uT3V0cHV0LCBgQ2hlY2tpbmcgaWYgJHt0aGlzLnR5cGV9ICcke2V9JyBpcyB1cGRhdGFibGVgLCAoKSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMuY29uZmlnLmluc3RhbGxlZEV4dGVuc2lvbnNbZV0uaW5zdGFsbFR5cGUgIT09IElOU1RBTExfVFlQRV9OUE0pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBOb3RVcGRhdGFibGVFcnJvcigpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHVwZGF0ZSA9IGF3YWl0IHNwaW5XaXRoKFxuICAgICAgICAgIHRoaXMuaXNKc29uT3V0cHV0LFxuICAgICAgICAgIGBDaGVja2luZyBpZiAke3RoaXMudHlwZX0gJyR7ZX0nIG5lZWRzIGFuIHVwZGF0ZWAsXG4gICAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdXBkYXRlID0gYXdhaXQgdGhpcy5jaGVja0ZvckV4dGVuc2lvblVwZGF0ZShlKTtcbiAgICAgICAgICAgIGlmICghKHVwZGF0ZS5zYWZlVXBkYXRlIHx8IHVwZGF0ZS51bnNhZmVVcGRhdGUpKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBOb1VwZGF0ZXNBdmFpbGFibGVFcnJvcigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHVwZGF0ZTtcbiAgICAgICAgICB9XG4gICAgICAgICk7XG4gICAgICAgIGlmICghdW5zYWZlICYmICF1cGRhdGUuc2FmZVVwZGF0ZSkge1xuICAgICAgICAgIHRocm93IHRoaXMuX2NyZWF0ZUZhdGFsRXJyb3IoXG4gICAgICAgICAgICBgVGhlICR7dGhpcy50eXBlfSAnJHtlfScgaGFzIGEgbWFqb3IgcmV2aXNpb24gdXBkYXRlIGAgK1xuICAgICAgICAgICAgICBgKCR7dXBkYXRlLmN1cnJlbnR9ID0+ICR7dXBkYXRlLnVuc2FmZVVwZGF0ZX0pLCB3aGljaCBjb3VsZCBpbmNsdWRlIGAgK1xuICAgICAgICAgICAgICBgYnJlYWtpbmcgY2hhbmdlcy4gSWYgeW91IHdhbnQgdG8gYXBwbHkgdGhpcyB1cGRhdGUsIHJlLXJ1biB3aXRoIC0tdW5zYWZlYFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdXBkYXRlVmVyID0gdW5zYWZlICYmIHVwZGF0ZS51bnNhZmVVcGRhdGUgPyB1cGRhdGUudW5zYWZlVXBkYXRlIDogdXBkYXRlLnNhZmVVcGRhdGU7XG4gICAgICAgIGF3YWl0IHNwaW5XaXRoKFxuICAgICAgICAgIHRoaXMuaXNKc29uT3V0cHV0LFxuICAgICAgICAgIGBVcGRhdGluZyBkcml2ZXIgJyR7ZX0nIGZyb20gJHt1cGRhdGUuY3VycmVudH0gdG8gJHt1cGRhdGVWZXJ9YCxcbiAgICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnVwZGF0ZUV4dGVuc2lvbihlLCB1cGRhdGVWZXIpXG4gICAgICAgICk7XG4gICAgICAgIHVwZGF0ZXNbZV0gPSB7ZnJvbTogdXBkYXRlLmN1cnJlbnQsIHRvOiB1cGRhdGVWZXJ9O1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGVycm9yc1tlXSA9IGVycjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmxvZy5pbmZvKCdVcGRhdGUgcmVwb3J0OicpO1xuXG4gICAgZm9yIChjb25zdCBbZSwgdXBkYXRlXSBvZiBfLnRvUGFpcnModXBkYXRlcykpIHtcbiAgICAgIHRoaXMubG9nLm9rKGAgIC0gJHt0aGlzLnR5cGV9ICR7ZX0gdXBkYXRlZDogJHt1cGRhdGUuZnJvbX0gPT4gJHt1cGRhdGUudG99YC5ncmVlbik7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbZSwgZXJyXSBvZiBfLnRvUGFpcnMoZXJyb3JzKSkge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIE5vdFVwZGF0YWJsZUVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nLndhcm4oXG4gICAgICAgICAgYCAgLSAnJHtlfScgd2FzIG5vdCBpbnN0YWxsZWQgdmlhIG5wbSwgc28gd2UgY291bGQgbm90IGNoZWNrIGAgKyBgZm9yIHVwZGF0ZXNgLnllbGxvd1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChlcnIgaW5zdGFuY2VvZiBOb1VwZGF0ZXNBdmFpbGFibGVFcnJvcikge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKGAgIC0gJyR7ZX0nIGhhZCBubyB1cGRhdGVzIGF2YWlsYWJsZWAueWVsbG93KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIG90aGVyd2lzZSwgbWFrZSBpdCBwb3Agd2l0aCByZWQhXG4gICAgICAgIHRoaXMubG9nLmVycm9yKGAgIC0gJyR7ZX0nIGZhaWxlZCB0byB1cGRhdGU6ICR7ZXJyfWAucmVkKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHt1cGRhdGVzLCBlcnJvcnN9O1xuICB9XG5cbiAgLyoqXG4gICAqIEdpdmVuIGFuIGV4dGVuc2lvbiBuYW1lLCBmaWd1cmUgb3V0IHdoYXQgaXRzIGhpZ2hlc3QgcG9zc2libGUgdmVyc2lvbiB1cGdyYWRlIGlzLCBhbmQgYWxzbyB0aGVcbiAgICogaGlnaGVzdCBwb3NzaWJsZSBzYWZlIHVwZ3JhZGUuXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleHQgLSBuYW1lIG9mIGV4dGVuc2lvblxuICAgKiBAcmV0dXJuIHtQcm9taXNlPFBvc3NpYmxlVXBkYXRlcz59XG4gICAqL1xuICBhc3luYyBjaGVja0ZvckV4dGVuc2lvblVwZGF0ZShleHQpIHtcbiAgICAvLyBUT0RPIGRlY2lkZSBob3cgd2Ugd2FudCB0byBoYW5kbGUgYmV0YSB2ZXJzaW9ucz9cbiAgICAvLyB0aGlzIGlzIGEgaGVscGVyIG1ldGhvZCwgJ2V4dCcgaXMgYXNzdW1lZCB0byBhbHJlYWR5IGJlIGluc3RhbGxlZCBoZXJlLCBhbmQgb2YgdGhlIG5wbVxuICAgIC8vIGluc3RhbGwgdHlwZVxuICAgIGNvbnN0IHt2ZXJzaW9uLCBwa2dOYW1lfSA9IHRoaXMuY29uZmlnLmluc3RhbGxlZEV4dGVuc2lvbnNbZXh0XTtcbiAgICAvKiogQHR5cGUge3N0cmluZz99ICovXG4gICAgbGV0IHVuc2FmZVVwZGF0ZSA9IGF3YWl0IG5wbS5nZXRMYXRlc3RWZXJzaW9uKHRoaXMuY29uZmlnLmFwcGl1bUhvbWUsIHBrZ05hbWUpO1xuICAgIGxldCBzYWZlVXBkYXRlID0gYXdhaXQgbnBtLmdldExhdGVzdFNhZmVVcGdyYWRlVmVyc2lvbihcbiAgICAgIHRoaXMuY29uZmlnLmFwcGl1bUhvbWUsXG4gICAgICBwa2dOYW1lLFxuICAgICAgdmVyc2lvblxuICAgICk7XG4gICAgaWYgKHVuc2FmZVVwZGF0ZSAhPT0gbnVsbCAmJiAhdXRpbC5jb21wYXJlVmVyc2lvbnModW5zYWZlVXBkYXRlLCAnPicsIHZlcnNpb24pKSB7XG4gICAgICAvLyB0aGUgbGF0ZXN0IHZlcnNpb24gaXMgbm90IGdyZWF0ZXIgdGhhbiB0aGUgY3VycmVudCB2ZXJzaW9uLCBzbyB0aGVyZSdzIG5vIHBvc3NpYmxlIHVwZGF0ZVxuICAgICAgdW5zYWZlVXBkYXRlID0gbnVsbDtcbiAgICAgIHNhZmVVcGRhdGUgPSBudWxsO1xuICAgIH1cbiAgICBpZiAodW5zYWZlVXBkYXRlICYmIHVuc2FmZVVwZGF0ZSA9PT0gc2FmZVVwZGF0ZSkge1xuICAgICAgLy8gdGhlIGxhdGVzdCB1cGRhdGUgaXMgdGhlIHNhbWUgYXMgdGhlIHNhZmUgdXBkYXRlLCB3aGljaCBtZWFucyBpdCdzIG5vdCBhY3R1YWxseSB1bnNhZmVcbiAgICAgIHVuc2FmZVVwZGF0ZSA9IG51bGw7XG4gICAgfVxuICAgIGlmIChzYWZlVXBkYXRlICYmICF1dGlsLmNvbXBhcmVWZXJzaW9ucyhzYWZlVXBkYXRlLCAnPicsIHZlcnNpb24pKSB7XG4gICAgICAvLyBldmVuIHRoZSBzYWZlIHVwZGF0ZSBpcyBub3QgbGF0ZXIgdGhhbiB0aGUgY3VycmVudCwgc28gaXQgaXMgbm90IGFjdHVhbGx5IGFuIHVwZGF0ZVxuICAgICAgc2FmZVVwZGF0ZSA9IG51bGw7XG4gICAgfVxuICAgIHJldHVybiB7Y3VycmVudDogdmVyc2lvbiwgc2FmZVVwZGF0ZSwgdW5zYWZlVXBkYXRlfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBY3R1YWxseSB1cGRhdGUgYW4gZXh0ZW5zaW9uIGluc3RhbGxlZCBieSBOUE0sIHVzaW5nIHRoZSBOUE0gY2xpLiBBbmQgdXBkYXRlIHRoZSBpbnN0YWxsYXRpb25cbiAgICogbWFuaWZlc3QuXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpbnN0YWxsU3BlYyAtIG5hbWUgb2YgZXh0ZW5zaW9uIHRvIHVwZGF0ZVxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmVyc2lvbiAtIHZlcnNpb24gc3RyaW5nIGlkZW50aWZpZXIgdG8gdXBkYXRlIGV4dGVuc2lvbiB0b1xuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHVwZGF0ZUV4dGVuc2lvbihpbnN0YWxsU3BlYywgdmVyc2lvbikge1xuICAgIGNvbnN0IHtwa2dOYW1lfSA9IHRoaXMuY29uZmlnLmluc3RhbGxlZEV4dGVuc2lvbnNbaW5zdGFsbFNwZWNdO1xuICAgIGNvbnN0IGV4dERhdGEgPSBhd2FpdCB0aGlzLmluc3RhbGxWaWFOcG0oe1xuICAgICAgaW5zdGFsbFNwZWMsXG4gICAgICBwa2dOYW1lLFxuICAgICAgcGtnVmVyOiB2ZXJzaW9uLFxuICAgIH0pO1xuICAgIGRlbGV0ZSBleHREYXRhWy8qKiBAdHlwZSB7c3RyaW5nfSAqLyAoYCR7dGhpcy50eXBlfU5hbWVgKV07XG4gICAgYXdhaXQgdGhpcy5jb25maWcudXBkYXRlRXh0ZW5zaW9uKGluc3RhbGxTcGVjLCBleHREYXRhKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgc2NyaXB0IGNhY2hlZCBpbnNpZGUgdGhlIFwic2NyaXB0c1wiIGZpZWxkIHVuZGVyIFwiYXBwaXVtXCJcbiAgICogaW5zaWRlIG9mIHRoZSBkcml2ZXIvcGx1Z2lucyBcInBhY2thZ2UuanNvblwiIGZpbGUuIFdpbGwgdGhyb3dcbiAgICogYW4gZXJyb3IgaWYgdGhlIGRyaXZlci9wbHVnaW4gZG9lcyBub3QgY29udGFpbiBhIFwic2NyaXB0c1wiIGZpZWxkXG4gICAqIHVuZGVybmVhdGggdGhlIFwiYXBwaXVtXCIgZmllbGQgaW4gaXRzIHBhY2thZ2UuanNvbiwgaWYgdGhlXG4gICAqIFwic2NyaXB0c1wiIGZpZWxkIGlzIG5vdCBhIHBsYWluIG9iamVjdCwgb3IgaWYgdGhlIHNjcmlwdE5hbWUgaXNcbiAgICogbm90IGZvdW5kIHdpdGhpbiBcInNjcmlwdHNcIiBvYmplY3QuXG4gICAqXG4gICAqIEBwYXJhbSB7UnVuT3B0aW9uc30gb3B0c1xuICAgKiBAcmV0dXJuIHtQcm9taXNlPFJ1bk91dHB1dD59XG4gICAqL1xuICBhc3luYyBfcnVuKHtpbnN0YWxsU3BlYywgc2NyaXB0TmFtZSwgZXh0cmFBcmdzID0gW119KSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy5pc0luc3RhbGxlZChpbnN0YWxsU3BlYykpIHtcbiAgICAgIHRocm93IHRoaXMuX2NyZWF0ZUZhdGFsRXJyb3IoYFRoZSAke3RoaXMudHlwZX0gXCIke2luc3RhbGxTcGVjfVwiIGlzIG5vdCBpbnN0YWxsZWRgKTtcbiAgICB9XG5cbiAgICBjb25zdCBleHRDb25maWcgPSB0aGlzLmNvbmZpZy5pbnN0YWxsZWRFeHRlbnNpb25zW2luc3RhbGxTcGVjXTtcblxuICAgIC8vIG5vdGU6IFRTIGNhbm5vdCB1bmRlcnN0YW5kIHRoYXQgXy5oYXMoKSBpcyBhIHR5cGUgZ3VhcmRcbiAgICBpZiAoIWV4dENvbmZpZy5zY3JpcHRzKSB7XG4gICAgICB0aHJvdyB0aGlzLl9jcmVhdGVGYXRhbEVycm9yKFxuICAgICAgICBgVGhlICR7dGhpcy50eXBlfSBuYW1lZCAnJHtpbnN0YWxsU3BlY30nIGRvZXMgbm90IGNvbnRhaW4gdGhlIGAgK1xuICAgICAgICAgIGBcInNjcmlwdHNcIiBmaWVsZCB1bmRlcm5lYXRoIHRoZSBcImFwcGl1bVwiIGZpZWxkIGluIGl0cyBwYWNrYWdlLmpzb25gXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IGV4dFNjcmlwdHMgPSBleHRDb25maWcuc2NyaXB0cztcblxuICAgIGlmICghXy5pc1BsYWluT2JqZWN0KGV4dFNjcmlwdHMpKSB7XG4gICAgICB0aHJvdyB0aGlzLl9jcmVhdGVGYXRhbEVycm9yKFxuICAgICAgICBgVGhlICR7dGhpcy50eXBlfSBuYW1lZCAnJHtpbnN0YWxsU3BlY30nIFwic2NyaXB0c1wiIGZpZWxkIG11c3QgYmUgYSBwbGFpbiBvYmplY3RgXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmICghXy5oYXMoZXh0U2NyaXB0cywgc2NyaXB0TmFtZSkpIHtcbiAgICAgIHRocm93IHRoaXMuX2NyZWF0ZUZhdGFsRXJyb3IoXG4gICAgICAgIGBUaGUgJHt0aGlzLnR5cGV9IG5hbWVkICcke2luc3RhbGxTcGVjfScgZG9lcyBub3Qgc3VwcG9ydCB0aGUgc2NyaXB0OiAnJHtzY3JpcHROYW1lfSdgXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IHJ1bm5lciA9IG5ldyBTdWJQcm9jZXNzKHByb2Nlc3MuZXhlY1BhdGgsIFtleHRTY3JpcHRzW3NjcmlwdE5hbWVdLCAuLi5leHRyYUFyZ3NdLCB7XG4gICAgICBjd2Q6IHRoaXMuY29uZmlnLmdldEluc3RhbGxQYXRoKGluc3RhbGxTcGVjKSxcbiAgICB9KTtcblxuICAgIGNvbnN0IG91dHB1dCA9IG5ldyBSaW5nQnVmZmVyKDUwKTtcblxuICAgIHJ1bm5lci5vbignc3RyZWFtLWxpbmUnLCAobGluZSkgPT4ge1xuICAgICAgb3V0cHV0LmVucXVldWUobGluZSk7XG4gICAgICB0aGlzLmxvZy5sb2cobGluZSk7XG4gICAgfSk7XG5cbiAgICBhd2FpdCBydW5uZXIuc3RhcnQoMCk7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgcnVubmVyLmpvaW4oKTtcbiAgICAgIHRoaXMubG9nLm9rKGAke3NjcmlwdE5hbWV9IHN1Y2Nlc3NmdWxseSByYW5gLmdyZWVuKTtcbiAgICAgIHJldHVybiB7b3V0cHV0OiBvdXRwdXQuZ2V0QnVmZigpfTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRoaXMubG9nLmVycm9yKGBFbmNvdW50ZXJlZCBhbiBlcnJvciB3aGVuIHJ1bm5pbmcgJyR7c2NyaXB0TmFtZX0nOiAke2Vyci5tZXNzYWdlfWAucmVkKTtcbiAgICAgIHJldHVybiB7ZXJyb3I6IGVyci5tZXNzYWdlLCBvdXRwdXQ6IG91dHB1dC5nZXRCdWZmKCl9O1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBFeHRlbnNpb25Db21tYW5kO1xuZXhwb3J0IHtFeHRlbnNpb25Db21tYW5kfTtcblxuLyoqXG4gKiBPcHRpb25zIGZvciB0aGUge0BsaW5rY29kZSBFeHRlbnNpb25Db21tYW5kfSBjb25zdHJ1Y3RvclxuICogQHRlbXBsYXRlIHtFeHRlbnNpb25UeXBlfSBFeHRUeXBlXG4gKiBAdHlwZWRlZiBFeHRlbnNpb25Db21tYW5kT3B0aW9uc1xuICogQHByb3BlcnR5IHtFeHRlbnNpb25Db25maWc8RXh0VHlwZT59IGNvbmZpZyAtIHRoZSBgRHJpdmVyQ29uZmlnYCBvciBgUGx1Z2luQ29uZmlnYCBpbnN0YW5jZSB1c2VkIGZvciB0aGlzIGNvbW1hbmRcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0ganNvbiAtIHdoZXRoZXIgdGhlIG91dHB1dCBvZiB0aGlzIGNvbW1hbmQgc2hvdWxkIGJlIEpTT04gb3IgdGV4dFxuICovXG5cbi8qKlxuICogRXh0cmEgc3R1ZmYgYWJvdXQgZXh0ZW5zaW9uczsgdXNlZCBpbmRpcmVjdGx5IGJ5IHtAbGlua2NvZGUgRXh0ZW5zaW9uQ29tbWFuZC5saXN0fS5cbiAqXG4gKiBAdHlwZWRlZiBFeHRlbnNpb25NZXRhZGF0YVxuICogQHByb3BlcnR5IHtib29sZWFufSBpbnN0YWxsZWQgLSBJZiBgdHJ1ZWAsIHRoZSBleHRlbnNpb24gaXMgaW5zdGFsbGVkXG4gKiBAcHJvcGVydHkge3N0cmluZz99IHVwZGF0ZVZlcnNpb24gLSBJZiB0aGUgZXh0ZW5zaW9uIGlzIGluc3RhbGxlZCwgdGhlIHZlcnNpb24gaXQgY2FuIGJlIHVwZGF0ZWQgdG9cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nP30gdW5zYWZlVXBkYXRlVmVyc2lvbiAtIFNhbWUgYXMgYWJvdmUsIGJ1dCBhIG1ham9yIHZlcnNpb24gYnVtcFxuICogQHByb3BlcnR5IHtib29sZWFufSB1cFRvRGF0ZSAtIElmIHRoZSBleHRlbnNpb24gaXMgaW5zdGFsbGVkIGFuZCB0aGUgbGF0ZXN0XG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdAYXBwaXVtL3R5cGVzJykuRXh0ZW5zaW9uVHlwZX0gRXh0ZW5zaW9uVHlwZVxuICogQHR5cGVkZWYge2ltcG9ydCgnQGFwcGl1bS90eXBlcycpLkRyaXZlclR5cGV9IERyaXZlclR5cGVcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJ0BhcHBpdW0vdHlwZXMnKS5QbHVnaW5UeXBlfSBQbHVnaW5UeXBlXG4gKi9cblxuLyoqXG4gKiBAdGVtcGxhdGUge0V4dGVuc2lvblR5cGV9IEV4dFR5cGVcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJ2FwcGl1bS90eXBlcycpLkV4dFJlY29yZDxFeHRUeXBlPn0gRXh0UmVjb3JkXG4gKi9cblxuLyoqXG4gKiBAdGVtcGxhdGUge0V4dGVuc2lvblR5cGV9IEV4dFR5cGVcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJy4uL2V4dGVuc2lvbi9leHRlbnNpb24tY29uZmlnJykuRXh0ZW5zaW9uQ29uZmlnPEV4dFR5cGU+fSBFeHRlbnNpb25Db25maWdcbiAqL1xuXG4vKipcbiAqIEB0ZW1wbGF0ZSB7RXh0ZW5zaW9uVHlwZX0gRXh0VHlwZVxuICogQHR5cGVkZWYge2ltcG9ydCgnYXBwaXVtL3R5cGVzJykuRXh0TWV0YWRhdGE8RXh0VHlwZT59IEV4dE1ldGFkYXRhXG4gKi9cblxuLyoqXG4gKiBAdGVtcGxhdGUge0V4dGVuc2lvblR5cGV9IEV4dFR5cGVcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJ2FwcGl1bS90eXBlcycpLkV4dE1hbmlmZXN0PEV4dFR5cGU+fSBFeHRNYW5pZmVzdFxuICovXG5cbi8qKlxuICogQHRlbXBsYXRlIHtFeHRlbnNpb25UeXBlfSBFeHRUeXBlXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdhcHBpdW0vdHlwZXMnKS5FeHRQYWNrYWdlSnNvbjxFeHRUeXBlPn0gRXh0UGFja2FnZUpzb25cbiAqL1xuXG4vKipcbiAqIFBvc3NpYmxlIHJldHVybiB2YWx1ZSBmb3Ige0BsaW5rY29kZSBFeHRlbnNpb25Db21tYW5kLmxpc3R9XG4gKiBAdHlwZWRlZiBVbmluc3RhbGxlZEV4dGVuc2lvbkxpc3REYXRhXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcGtnTmFtZVxuICogQHByb3BlcnR5IHtmYWxzZX0gaW5zdGFsbGVkXG4gKi9cblxuLyoqXG4gKiBQb3NzaWJsZSByZXR1cm4gdmFsdWUgZm9yIHtAbGlua2NvZGUgRXh0ZW5zaW9uQ29tbWFuZC5saXN0fVxuICogQHR5cGVkZWYge2ltcG9ydCgnYXBwaXVtL3R5cGVzJykuSW50ZXJuYWxNZXRhZGF0YSAmIEV4dGVuc2lvbk1ldGFkYXRhfSBJbnN0YWxsZWRFeHRlbnNpb25MaXN0RGF0YVxuICovXG5cbi8qKlxuICogUmV0dXJuIHZhbHVlIG9mIHtAbGlua2NvZGUgRXh0ZW5zaW9uQ29tbWFuZC5saXN0fS5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLEluc3RhbGxlZEV4dGVuc2lvbkxpc3REYXRhfFVuaW5zdGFsbGVkRXh0ZW5zaW9uTGlzdERhdGE+fSBFeHRlbnNpb25MaXN0RGF0YVxuICovXG5cbi8qKlxuICogT3B0aW9ucyBmb3Ige0BsaW5rY29kZSBFeHRlbnNpb25Db21tYW5kLl9ydW59LlxuICogQHR5cGVkZWYgUnVuT3B0aW9uc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGluc3RhbGxTcGVjIC0gbmFtZSBvZiB0aGUgZXh0ZW5zaW9uIHRvIHJ1biBhIHNjcmlwdCBmcm9tXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc2NyaXB0TmFtZSAtIG5hbWUgb2YgdGhlIHNjcmlwdCB0byBydW5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IFtleHRyYUFyZ3NdIC0gYXJndW1lbnRzIHRvIHBhc3MgdG8gdGhlIHNjcmlwdFxuICovXG5cbi8qKlxuICogUmV0dXJuIHZhbHVlIG9mIHtAbGlua2NvZGUgRXh0ZW5zaW9uQ29tbWFuZC5fcnVufVxuICpcbiAqIEB0eXBlZGVmIFJ1bk91dHB1dFxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtlcnJvcl0gLSBlcnJvciBtZXNzYWdlIGlmIHNjcmlwdCByYW4gdW5zdWNjZXNzZnVsbHksIG90aGVyd2lzZSB1bmRlZmluZWRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IG91dHB1dCAtIHNjcmlwdCBvdXRwdXRcbiAqL1xuXG4vKipcbiAqIE9wdGlvbnMgZm9yIHtAbGlua2NvZGUgRXh0ZW5zaW9uQ29tbWFuZC5fdXBkYXRlfS5cbiAqIEB0eXBlZGVmIEV4dGVuc2lvblVwZGF0ZU9wdHNcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpbnN0YWxsU3BlYyAtIHRoZSBuYW1lIG9mIHRoZSBleHRlbnNpb24gdG8gdXBkYXRlXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHVuc2FmZSAtIGlmIHRydWUsIHdpbGwgcGVyZm9ybSB1bnNhZmUgdXBkYXRlcyBwYXN0IG1ham9yIHJldmlzaW9uIGJvdW5kYXJpZXNcbiAqL1xuXG4vKipcbiAqIFJldHVybiB2YWx1ZSBvZiB7QGxpbmtjb2RlIEV4dGVuc2lvbkNvbW1hbmQuX3VwZGF0ZX0uXG4gKiBAdHlwZWRlZiBFeHRlbnNpb25VcGRhdGVSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZyxFcnJvcj59IGVycm9ycyAtIG1hcCBvZiBleHQgbmFtZXMgdG8gZXJyb3Igb2JqZWN0c1xuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLFVwZGF0ZVJlcG9ydD59IHVwZGF0ZXMgLSBtYXAgb2YgZXh0IG5hbWVzIHRvIHtAbGlua2NvZGUgVXBkYXRlUmVwb3J0fXNcbiAqL1xuXG4vKipcbiAqIFBhcnQgb2YgcmVzdWx0IG9mIHtAbGlua2NvZGUgRXh0ZW5zaW9uQ29tbWFuZC5fdXBkYXRlfS5cbiAqIEB0eXBlZGVmIFVwZGF0ZVJlcG9ydFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZyb20gLSB2ZXJzaW9uIHRoZSBleHRlbnNpb24gd2FzIHVwZGF0ZWQgZnJvbVxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRvIC0gdmVyc2lvbiB0aGUgZXh0ZW5zaW9uIHdhcyB1cGRhdGVkIHRvXG4gKi9cblxuLyoqXG4gKiBPcHRpb25zIGZvciB7QGxpbmtjb2RlIEV4dGVuc2lvbkNvbW1hbmQuX3VuaW5zdGFsbH0uXG4gKiBAdHlwZWRlZiBVbmluc3RhbGxPcHRzXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaW5zdGFsbFNwZWMgLSB0aGUgbmFtZSBvciBzcGVjIG9mIGFuIGV4dGVuc2lvbiB0byB1bmluc3RhbGxcbiAqL1xuXG4vKipcbiAqIFVzZWQgYnkge0BsaW5rY29kZSBFeHRlbnNpb25Db21tYW5kLmdldFBvc3RJbnN0YWxsVGV4dH1cbiAqIEB0eXBlZGVmIEV4dGVuc2lvbkFyZ3NcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBleHROYW1lIC0gdGhlIG5hbWUgb2YgYW4gZXh0ZW5zaW9uXG4gKiBAcHJvcGVydHkge29iamVjdH0gZXh0RGF0YSAtIHRoZSBkYXRhIGZvciBhbiBpbnN0YWxsZWQgZXh0ZW5zaW9uXG4gKi9cblxuLyoqXG4gKiBPcHRpb25zIGZvciB7QGxpbmtjb2RlIEV4dGVuc2lvbkNvbW1hbmQuaW5zdGFsbFZpYU5wbX1cbiAqIEB0eXBlZGVmIEluc3RhbGxWaWFOcG1BcmdzXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaW5zdGFsbFNwZWMgLSB0aGUgbmFtZSBvciBzcGVjIG9mIGFuIGV4dGVuc2lvbiB0byBpbnN0YWxsXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcGtnTmFtZSAtIHRoZSBOUE0gcGFja2FnZSBuYW1lIG9mIHRoZSBleHRlbnNpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbcGtnVmVyXSAtIHRoZSBzcGVjaWZpYyB2ZXJzaW9uIG9mIHRoZSBOUE0gcGFja2FnZVxuICovXG5cbi8qKlxuICogT2JqZWN0IHJldHVybmVkIGJ5IHtAbGlua2NvZGUgRXh0ZW5zaW9uQ29tbWFuZC5jaGVja0ZvckV4dGVuc2lvblVwZGF0ZX1cbiAqIEB0eXBlZGVmIFBvc3NpYmxlVXBkYXRlc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGN1cnJlbnQgLSBjdXJyZW50IHZlcnNpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nP30gc2FmZVVwZGF0ZSAtIHZlcnNpb24gd2UgY2FuIHNhZmVseSB1cGRhdGUgdG8gaWYgaXQgZXhpc3RzLCBvciBudWxsXG4gKiBAcHJvcGVydHkge3N0cmluZz99IHVuc2FmZVVwZGF0ZSAtIHZlcnNpb24gd2UgY2FuIHVuc2FmZWx5IHVwZGF0ZSB0byBpZiBpdCBleGlzdHMsIG9yIG51bGxcbiAqL1xuXG4vKipcbiAqIE9wdGlvbnMgZm9yIHtAbGlua2NvZGUgRXh0ZW5zaW9uQ29tbWFuZC5faW5zdGFsbH1cbiAqIEB0eXBlZGVmIEluc3RhbGxBcmdzXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaW5zdGFsbFNwZWMgLSB0aGUgbmFtZSBvciBzcGVjIG9mIGFuIGV4dGVuc2lvbiB0byBpbnN0YWxsXG4gKiBAcHJvcGVydHkge2ltcG9ydCgnYXBwaXVtL3R5cGVzJykuSW5zdGFsbFR5cGV9IGluc3RhbGxUeXBlIC0gaG93IHRvIGluc3RhbGwgdGhpcyBleHRlbnNpb24uIE9uZSBvZiB0aGUgSU5TVEFMTF9UWVBFU1xuICogQHByb3BlcnR5IHtzdHJpbmd9IFtwYWNrYWdlTmFtZV0gLSBmb3IgZ2l0L2dpdGh1YiBpbnN0YWxscywgdGhlIGV4dGVuc2lvbiBub2RlIHBhY2thZ2UgbmFtZVxuICovXG5cbi8qKlxuICogUmV0dXJuZWQgYnkge0BsaW5rY29kZSBFeHRlbnNpb25Db21tYW5kLmdldEV4dGVuc2lvbkZpZWxkc31cbiAqIEB0ZW1wbGF0ZSB7RXh0ZW5zaW9uVHlwZX0gRXh0VHlwZVxuICogQHR5cGVkZWYge0V4dE1ldGFkYXRhPEV4dFR5cGU+ICYgeyBwa2dOYW1lOiBzdHJpbmcsIHZlcnNpb246IHN0cmluZywgYXBwaXVtVmVyc2lvbjogc3RyaW5nIH0gJiBpbXBvcnQoJ2FwcGl1bS90eXBlcycpLkNvbW1vbkV4dE1ldGFkYXRhfSBFeHRlbnNpb25GaWVsZHNcbiAqL1xuXG4vKipcbiAqIEB0ZW1wbGF0ZSB7RXh0ZW5zaW9uVHlwZX0gRXh0VHlwZVxuICogQHR5cGVkZWYge0V4dFR5cGUgZXh0ZW5kcyBEcml2ZXJUeXBlID8gdHlwZW9mIGltcG9ydCgnLi4vY29uc3RhbnRzJykuS05PV05fRFJJVkVSUyA6IEV4dFR5cGUgZXh0ZW5kcyBQbHVnaW5UeXBlID8gdHlwZW9mIGltcG9ydCgnLi4vY29uc3RhbnRzJykuS05PV05fUExVR0lOUyA6IG5ldmVyfSBLbm93bkV4dGVuc2lvbnNcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIExpc3RPcHRpb25zXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHNob3dJbnN0YWxsZWQgLSB3aGV0aGVyIHNob3VsZCBzaG93IG9ubHkgaW5zdGFsbGVkIGV4dGVuc2lvbnNcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gc2hvd1VwZGF0ZXMgLSB3aGV0aGVyIHNob3VsZCBzaG93IGF2YWlsYWJsZSB1cGRhdGVzXG4gKi9cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBTUE7Ozs7QUFFQSxNQUFN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