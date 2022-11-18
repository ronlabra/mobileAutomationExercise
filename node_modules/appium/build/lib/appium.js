"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NoDriverProxyCommandError = exports.AppiumDriver = void 0;

require("source-map-support/register");

var _lodash = _interopRequireDefault(require("lodash"));

var _config = require("./config");

var _baseDriver = require("@appium/base-driver");

var _asyncLock = _interopRequireDefault(require("async-lock"));

var _utils = require("./utils");

var _support = require("@appium/support");

var _schema = require("./schema");

var _constants = require("./constants");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const desiredCapabilityConstraints = {
  automationName: {
    presence: true,
    isString: true
  },
  platformName: {
    presence: true,
    isString: true
  }
};
const sessionsListGuard = new _asyncLock.default();
const pendingDriversGuard = new _asyncLock.default();

class AppiumDriver extends _baseDriver.DriverCore {
  sessions = {};
  pendingDrivers = {};
  newCommandTimeoutMs = 0;
  pluginClasses;
  sessionPlugins = {};
  sessionlessPlugins = [];
  driverConfig;
  server;
  desiredCapConstraints = desiredCapabilityConstraints;
  args;

  constructor(opts) {
    if (opts.tmpDir) {
      process.env.APPIUM_TMP_DIR = opts.tmpDir;
    }

    super(opts);
    this.args = { ...opts
    };

    (async () => {
      try {
        await (0, _config.updateBuildInfo)();
      } catch (e) {
        this.log.debug(`Cannot fetch Appium build info: ${e.message}`);
      }
    })();
  }

  get log() {
    if (!this._log) {
      const instanceName = `${this.constructor.name}@${_support.node.getObjectId(this).substring(0, 4)}`;
      this._log = _support.logger.getLogger(instanceName);
    }

    return this._log;
  }

  get isCommandsQueueEnabled() {
    return false;
  }

  sessionExists(sessionId) {
    const dstSession = this.sessions[sessionId];
    return dstSession && dstSession.sessionId !== null;
  }

  driverForSession(sessionId) {
    return this.sessions[sessionId];
  }

  async getStatus() {
    return {
      build: _lodash.default.clone((0, _config.getBuildInfo)())
    };
  }

  async getSessions() {
    return _lodash.default.toPairs(this.sessions).map(([id, driver]) => ({
      id,
      capabilities: driver.caps
    }));
  }

  printNewSessionAnnouncement(driverName, driverVersion, driverBaseVersion) {
    this.log.info(driverVersion ? `Appium v${_config.APPIUM_VER} creating new ${driverName} (v${driverVersion}) session` : `Appium v${_config.APPIUM_VER} creating new ${driverName} session`);
    this.log.info(`Checking BaseDriver versions for Appium and ${driverName}`);
    this.log.info(AppiumDriver.baseVersion ? `Appium's BaseDriver version is ${AppiumDriver.baseVersion}` : `Could not determine Appium's BaseDriver version`);
    this.log.info(driverBaseVersion ? `${driverName}'s BaseDriver version is ${driverBaseVersion}` : `Could not determine ${driverName}'s BaseDriver version`);
  }

  getCliArgsForPlugin(extName) {
    var _this$args$plugin;

    return ((_this$args$plugin = this.args.plugin) === null || _this$args$plugin === void 0 ? void 0 : _this$args$plugin[extName]) ?? {};
  }

  getCliArgsForDriver(extName) {
    var _this$args$driver;

    const allCliArgsForExt = (_this$args$driver = this.args.driver) === null || _this$args$driver === void 0 ? void 0 : _this$args$driver[extName];

    if (!_lodash.default.isEmpty(allCliArgsForExt)) {
      const defaults = (0, _schema.getDefaultsForExtension)(_constants.DRIVER_TYPE, extName);
      const cliArgs = _lodash.default.isEmpty(defaults) ? allCliArgsForExt : _lodash.default.omitBy(allCliArgsForExt, (value, key) => _lodash.default.isEqual(defaults[key], value));

      if (!_lodash.default.isEmpty(cliArgs)) {
        return cliArgs;
      }
    }
  }

  async createSession(jsonwpCaps, reqCaps, w3cCapabilities, driverData) {
    const defaultCapabilities = _lodash.default.cloneDeep(this.args.defaultCapabilities);

    const defaultSettings = (0, _utils.pullSettings)(defaultCapabilities);
    jsonwpCaps = _lodash.default.cloneDeep(jsonwpCaps);
    const jwpSettings = { ...defaultSettings,
      ...(0, _utils.pullSettings)(jsonwpCaps)
    };
    w3cCapabilities = _lodash.default.cloneDeep(w3cCapabilities);
    const w3cSettings = { ...jwpSettings,
      ...(0, _utils.pullSettings)((w3cCapabilities ?? {}).alwaysMatch ?? {})
    };

    for (const firstMatchEntry of (w3cCapabilities ?? {}).firstMatch ?? []) {
      Object.assign(w3cSettings, (0, _utils.pullSettings)(firstMatchEntry));
    }

    let protocol;
    let innerSessionId, dCaps;

    try {
      const parsedCaps = (0, _utils.parseCapsForInnerDriver)(jsonwpCaps, w3cCapabilities, this.desiredCapConstraints, defaultCapabilities);
      const {
        desiredCaps,
        processedJsonwpCapabilities,
        processedW3CCapabilities
      } = parsedCaps;
      protocol = parsedCaps.protocol;
      const error = parsedCaps.error;

      if (error) {
        throw error;
      }

      const {
        driver: InnerDriver,
        version: driverVersion,
        driverName
      } = this.driverConfig.findMatchingDriver(desiredCaps);
      this.printNewSessionAnnouncement(InnerDriver.name, driverVersion, InnerDriver.baseVersion);

      if (this.args.sessionOverride) {
        await this.deleteAllSessions();
      }

      let runningDriversData = [];
      let otherPendingDriversData = [];
      const driverInstance = new InnerDriver(this.args, true);

      if (this.args.relaxedSecurityEnabled) {
        this.log.info(`Applying relaxed security to '${InnerDriver.name}' as per ` + `server command line argument. All insecure features will be ` + `enabled unless explicitly disabled by --deny-insecure`);
        driverInstance.relaxedSecurityEnabled = true;
      }

      if (!_lodash.default.isEmpty(this.args.denyInsecure)) {
        this.log.info('Explicitly preventing use of insecure features:');
        this.args.denyInsecure.map(a => this.log.info(`    ${a}`));
        driverInstance.denyInsecure = this.args.denyInsecure;
      }

      if (!_lodash.default.isEmpty(this.args.allowInsecure)) {
        this.log.info('Explicitly enabling use of insecure features:');
        this.args.allowInsecure.map(a => this.log.info(`    ${a}`));
        driverInstance.allowInsecure = this.args.allowInsecure;
      }

      const cliArgs = this.getCliArgsForDriver(driverName);

      if (!_lodash.default.isEmpty(cliArgs)) {
        driverInstance.cliArgs = cliArgs;
      }

      driverInstance.server = this.server;
      driverInstance.serverHost = this.args.address;
      driverInstance.serverPort = this.args.port;
      driverInstance.serverPath = this.args.basePath;

      try {
        runningDriversData = (await this.curSessionDataForDriver(InnerDriver)) ?? [];
      } catch (e) {
        throw new _baseDriver.errors.SessionNotCreatedError(e.message);
      }

      await pendingDriversGuard.acquire(AppiumDriver.name, () => {
        this.pendingDrivers[InnerDriver.name] = this.pendingDrivers[InnerDriver.name] || [];
        otherPendingDriversData = _lodash.default.compact(this.pendingDrivers[InnerDriver.name].map(drv => drv.driverData));
        this.pendingDrivers[InnerDriver.name].push(driverInstance);
      });

      try {
        [innerSessionId, dCaps] = await driverInstance.createSession(processedJsonwpCapabilities, reqCaps, processedW3CCapabilities, [...runningDriversData, ...otherPendingDriversData]);
        protocol = driverInstance.protocol;
        this.sessions[innerSessionId] = driverInstance;
      } finally {
        await pendingDriversGuard.acquire(AppiumDriver.name, () => {
          _lodash.default.pull(this.pendingDrivers[InnerDriver.name], driverInstance);
        });
      }

      this.attachUnexpectedShutdownHandler(driverInstance, innerSessionId);
      this.log.info(`New ${InnerDriver.name} session created successfully, session ` + `${innerSessionId} added to master session list`);
      driverInstance.startNewCommandTimeout();

      if (driverInstance.isW3CProtocol() && !_lodash.default.isEmpty(w3cSettings)) {
        this.log.info(`Applying the initial values to Appium settings parsed from W3C caps: ` + JSON.stringify(w3cSettings));
        await driverInstance.updateSettings(w3cSettings);
      } else if (driverInstance.isMjsonwpProtocol() && !_lodash.default.isEmpty(jwpSettings)) {
        this.log.info(`Applying the initial values to Appium settings parsed from MJSONWP caps: ` + JSON.stringify(jwpSettings));
        await driverInstance.updateSettings(jwpSettings);
      }
    } catch (error) {
      return {
        protocol,
        error
      };
    }

    return {
      protocol,
      value: [innerSessionId, dCaps, protocol]
    };
  }

  attachUnexpectedShutdownHandler(driver, innerSessionId) {
    const onShutdown = (cause = new Error('Unknown error')) => {
      this.log.warn(`Ending session, cause was '${cause.message}'`);

      if (this.sessionPlugins[innerSessionId]) {
        for (const plugin of this.sessionPlugins[innerSessionId]) {
          if (_lodash.default.isFunction(plugin.onUnexpectedShutdown)) {
            this.log.debug(`Plugin ${plugin.name} defines an unexpected shutdown handler; calling it now`);

            try {
              plugin.onUnexpectedShutdown(driver, cause);
            } catch (e) {
              this.log.warn(`Got an error when running plugin ${plugin.name} shutdown handler: ${e}`);
            }
          } else {
            this.log.debug(`Plugin ${plugin.name} does not define an unexpected shutdown handler`);
          }
        }
      }

      this.log.info(`Removing session '${innerSessionId}' from our master session list`);
      delete this.sessions[innerSessionId];
      delete this.sessionPlugins[innerSessionId];
    };

    if (_lodash.default.isFunction(driver.onUnexpectedShutdown)) {
      driver.onUnexpectedShutdown(onShutdown);
    } else {
      this.log.warn(`Failed to attach the unexpected shutdown listener. ` + `Is 'onUnexpectedShutdown' method available for '${driver.constructor.name}'?`);
    }
  }

  async curSessionDataForDriver(InnerDriver) {
    const data = _lodash.default.compact(_lodash.default.values(this.sessions).filter(s => s.constructor.name === InnerDriver.name).map(s => s.driverData));

    for (const datum of data) {
      if (!datum) {
        throw new Error(`Problem getting session data for driver type ` + `${InnerDriver.name}; does it implement 'get driverData'?`);
      }
    }

    return data;
  }

  async deleteSession(sessionId) {
    let protocol;

    try {
      let otherSessionsData;
      const dstSession = await sessionsListGuard.acquire(AppiumDriver.name, () => {
        if (!this.sessions[sessionId]) {
          return;
        }

        const curConstructorName = this.sessions[sessionId].constructor.name;
        otherSessionsData = _lodash.default.toPairs(this.sessions).filter(([key, value]) => value.constructor.name === curConstructorName && key !== sessionId).map(([, value]) => value.driverData);
        const dstSession = this.sessions[sessionId];
        protocol = dstSession.protocol;
        this.log.info(`Removing session ${sessionId} from our master session list`);
        delete this.sessions[sessionId];
        delete this.sessionPlugins[sessionId];
        return dstSession;
      });

      if (!dstSession) {
        throw new Error('Session not found');
      }

      return {
        protocol,
        value: await dstSession.deleteSession(sessionId, otherSessionsData)
      };
    } catch (e) {
      this.log.error(`Had trouble ending session ${sessionId}: ${e.message}`);
      return {
        protocol,
        error: e
      };
    }
  }

  async deleteAllSessions(opts = {}) {
    const sessionsCount = _lodash.default.size(this.sessions);

    if (0 === sessionsCount) {
      this.log.debug('There are no active sessions for cleanup');
      return;
    }

    const {
      force = false,
      reason
    } = opts;
    this.log.debug(`Cleaning up ${_support.util.pluralize('active session', sessionsCount, true)}`);
    const cleanupPromises = force ? _lodash.default.values(this.sessions).map(drv => drv.startUnexpectedShutdown(reason && new Error(reason))) : _lodash.default.keys(this.sessions).map(id => this.deleteSession(id));

    for (const cleanupPromise of cleanupPromises) {
      try {
        await cleanupPromise;
      } catch (e) {
        this.log.debug(e);
      }
    }
  }

  pluginsForSession(sessionId = null) {
    if (sessionId) {
      if (!this.sessionPlugins[sessionId]) {
        this.sessionPlugins[sessionId] = this.createPluginInstances();
      }

      return this.sessionPlugins[sessionId];
    }

    if (_lodash.default.isEmpty(this.sessionlessPlugins)) {
      this.sessionlessPlugins = this.createPluginInstances();
    }

    return this.sessionlessPlugins;
  }

  pluginsToHandleCmd(cmd, sessionId = null) {
    return this.pluginsForSession(sessionId).filter(p => _lodash.default.isFunction(p[cmd]) || _lodash.default.isFunction(p.handle));
  }

  createPluginInstances() {
    const pluginInstances = [];

    for (const [PluginClass, name] of this.pluginClasses.entries()) {
      const cliArgs = this.getCliArgsForPlugin(name);
      const plugin = new PluginClass(name, cliArgs);
      pluginInstances.push(plugin);
    }

    return pluginInstances;
  }

  async executeCommand(cmd, ...args) {
    var _$last;

    const isGetStatus = cmd === _baseDriver.GET_STATUS_COMMAND;
    const isUmbrellaCmd = isAppiumDriverCommand(cmd);
    const isSessionCmd = (0, _baseDriver.isSessionCommand)(cmd);
    const reqForProxy = (_$last = _lodash.default.last(args)) === null || _$last === void 0 ? void 0 : _$last.reqForProxy;

    if (reqForProxy) {
      args.pop();
    }

    let sessionId = null;
    let dstSession = null;
    let protocol = null;
    let driver = this;

    if (isSessionCmd) {
      sessionId = _lodash.default.last(args);
      dstSession = this.sessions[sessionId];

      if (!dstSession) {
        throw new Error(`The session with id '${sessionId}' does not exist`);
      }

      protocol = dstSession.protocol;

      if (!isUmbrellaCmd) {
        driver = dstSession;
      }
    }

    const plugins = this.pluginsToHandleCmd(cmd, sessionId);
    const cmdHandledBy = {
      default: false
    };

    const defaultBehavior = async () => {
      plugins.length && this.log.info(`Executing default handling behavior for command '${cmd}'`);
      cmdHandledBy.default = true;

      if (reqForProxy) {
        if (!dstSession.proxyCommand) {
          throw new NoDriverProxyCommandError();
        }

        return await dstSession.proxyCommand(reqForProxy.originalUrl, reqForProxy.method, reqForProxy.body);
      }

      if (isGetStatus) {
        return await this.getStatus();
      }

      if (isUmbrellaCmd) {
        return await _baseDriver.BaseDriver.prototype.executeCommand.call(this, cmd, ...args);
      }

      return await dstSession.executeCommand(cmd, ...args);
    };

    const wrappedCmd = this.wrapCommandWithPlugins({
      driver,
      cmd,
      args,
      plugins,
      cmdHandledBy,
      next: defaultBehavior
    });
    const res = await this.executeWrappedCommand({
      wrappedCmd,
      protocol
    });
    this.logPluginHandlerReport(plugins, {
      cmd,
      cmdHandledBy
    });

    if (cmd === _baseDriver.CREATE_SESSION_COMMAND && this.sessionlessPlugins.length && !res.error) {
      const sessionId = _lodash.default.first(res.value);

      this.log.info(`Promoting ${this.sessionlessPlugins.length} sessionless plugins to be attached ` + `to session ID ${sessionId}`);
      this.sessionPlugins[sessionId] = this.sessionlessPlugins;
      this.sessionlessPlugins = [];
    }

    return res;
  }

  wrapCommandWithPlugins({
    driver,
    cmd,
    args,
    next,
    cmdHandledBy,
    plugins
  }) {
    plugins.length && this.log.info(`Plugins which can handle cmd '${cmd}': ${plugins.map(p => p.name)}`);

    for (const plugin of plugins) {
      cmdHandledBy[plugin.name] = false;

      next = (_next => async () => {
        this.log.info(`Plugin ${plugin.name} is now handling cmd '${cmd}'`);
        cmdHandledBy[plugin.name] = true;

        if (plugin[cmd]) {
          return await plugin[cmd](_next, driver, ...args);
        }

        return await plugin.handle(_next, driver, cmd, ...args);
      })(next);
    }

    return next;
  }

  logPluginHandlerReport(plugins, {
    cmd,
    cmdHandledBy
  }) {
    if (!plugins.length) {
      return;
    }

    const didHandle = Object.keys(cmdHandledBy).filter(k => cmdHandledBy[k]);
    const didntHandle = Object.keys(cmdHandledBy).filter(k => !cmdHandledBy[k]);

    if (didntHandle.length > 0) {
      this.log.info(`Command '${cmd}' was *not* handled by the following behaviours or plugins, even ` + `though they were registered to handle it: ${JSON.stringify(didntHandle)}. The ` + `command *was* handled by these: ${JSON.stringify(didHandle)}.`);
    }
  }

  async executeWrappedCommand({
    wrappedCmd,
    protocol
  }) {
    let cmdRes,
        cmdErr,
        res = {};

    try {
      cmdRes = await wrappedCmd();
    } catch (e) {
      cmdErr = e;
    }

    if (_lodash.default.isPlainObject(cmdRes) && _lodash.default.has(cmdRes, 'protocol')) {
      res = cmdRes;
    } else {
      res.value = cmdRes;
      res.error = cmdErr;
      res.protocol = protocol;
    }

    return res;
  }

  proxyActive(sessionId) {
    const dstSession = this.sessions[sessionId];
    return dstSession && _lodash.default.isFunction(dstSession.proxyActive) && dstSession.proxyActive(sessionId);
  }

  getProxyAvoidList(sessionId) {
    const dstSession = this.sessions[sessionId];
    return dstSession ? dstSession.getProxyAvoidList() : [];
  }

  canProxy(sessionId) {
    const dstSession = this.sessions[sessionId];
    return dstSession && dstSession.canProxy(sessionId);
  }

}

exports.AppiumDriver = AppiumDriver;

function isAppiumDriverCommand(cmd) {
  return !(0, _baseDriver.isSessionCommand)(cmd) || cmd === _baseDriver.DELETE_SESSION_COMMAND;
}

class NoDriverProxyCommandError extends Error {
  code = 'APPIUMERR_NO_DRIVER_PROXYCOMMAND';

  constructor() {
    super(`The default behavior for this command was to proxy, but the driver ` + `did not have the 'proxyCommand' method defined. To fully support ` + `plugins, drivers should have 'proxyCommand' set to a jwpProxy object's ` + `'command()' method, in addition to the normal 'proxyReqRes'`);
  }

}

exports.NoDriverProxyCommandError = NoDriverProxyCommandError;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJkZXNpcmVkQ2FwYWJpbGl0eUNvbnN0cmFpbnRzIiwiYXV0b21hdGlvbk5hbWUiLCJwcmVzZW5jZSIsImlzU3RyaW5nIiwicGxhdGZvcm1OYW1lIiwic2Vzc2lvbnNMaXN0R3VhcmQiLCJBc3luY0xvY2siLCJwZW5kaW5nRHJpdmVyc0d1YXJkIiwiQXBwaXVtRHJpdmVyIiwiRHJpdmVyQ29yZSIsInNlc3Npb25zIiwicGVuZGluZ0RyaXZlcnMiLCJuZXdDb21tYW5kVGltZW91dE1zIiwicGx1Z2luQ2xhc3NlcyIsInNlc3Npb25QbHVnaW5zIiwic2Vzc2lvbmxlc3NQbHVnaW5zIiwiZHJpdmVyQ29uZmlnIiwic2VydmVyIiwiZGVzaXJlZENhcENvbnN0cmFpbnRzIiwiYXJncyIsImNvbnN0cnVjdG9yIiwib3B0cyIsInRtcERpciIsInByb2Nlc3MiLCJlbnYiLCJBUFBJVU1fVE1QX0RJUiIsInVwZGF0ZUJ1aWxkSW5mbyIsImUiLCJsb2ciLCJkZWJ1ZyIsIm1lc3NhZ2UiLCJfbG9nIiwiaW5zdGFuY2VOYW1lIiwibmFtZSIsIm5vZGUiLCJnZXRPYmplY3RJZCIsInN1YnN0cmluZyIsImxvZ2dlciIsImdldExvZ2dlciIsImlzQ29tbWFuZHNRdWV1ZUVuYWJsZWQiLCJzZXNzaW9uRXhpc3RzIiwic2Vzc2lvbklkIiwiZHN0U2Vzc2lvbiIsImRyaXZlckZvclNlc3Npb24iLCJnZXRTdGF0dXMiLCJidWlsZCIsIl8iLCJjbG9uZSIsImdldEJ1aWxkSW5mbyIsImdldFNlc3Npb25zIiwidG9QYWlycyIsIm1hcCIsImlkIiwiZHJpdmVyIiwiY2FwYWJpbGl0aWVzIiwiY2FwcyIsInByaW50TmV3U2Vzc2lvbkFubm91bmNlbWVudCIsImRyaXZlck5hbWUiLCJkcml2ZXJWZXJzaW9uIiwiZHJpdmVyQmFzZVZlcnNpb24iLCJpbmZvIiwiQVBQSVVNX1ZFUiIsImJhc2VWZXJzaW9uIiwiZ2V0Q2xpQXJnc0ZvclBsdWdpbiIsImV4dE5hbWUiLCJwbHVnaW4iLCJnZXRDbGlBcmdzRm9yRHJpdmVyIiwiYWxsQ2xpQXJnc0ZvckV4dCIsImlzRW1wdHkiLCJkZWZhdWx0cyIsImdldERlZmF1bHRzRm9yRXh0ZW5zaW9uIiwiRFJJVkVSX1RZUEUiLCJjbGlBcmdzIiwib21pdEJ5IiwidmFsdWUiLCJrZXkiLCJpc0VxdWFsIiwiY3JlYXRlU2Vzc2lvbiIsImpzb253cENhcHMiLCJyZXFDYXBzIiwidzNjQ2FwYWJpbGl0aWVzIiwiZHJpdmVyRGF0YSIsImRlZmF1bHRDYXBhYmlsaXRpZXMiLCJjbG9uZURlZXAiLCJkZWZhdWx0U2V0dGluZ3MiLCJwdWxsU2V0dGluZ3MiLCJqd3BTZXR0aW5ncyIsInczY1NldHRpbmdzIiwiYWx3YXlzTWF0Y2giLCJmaXJzdE1hdGNoRW50cnkiLCJmaXJzdE1hdGNoIiwiT2JqZWN0IiwiYXNzaWduIiwicHJvdG9jb2wiLCJpbm5lclNlc3Npb25JZCIsImRDYXBzIiwicGFyc2VkQ2FwcyIsInBhcnNlQ2Fwc0ZvcklubmVyRHJpdmVyIiwiZGVzaXJlZENhcHMiLCJwcm9jZXNzZWRKc29ud3BDYXBhYmlsaXRpZXMiLCJwcm9jZXNzZWRXM0NDYXBhYmlsaXRpZXMiLCJlcnJvciIsIklubmVyRHJpdmVyIiwidmVyc2lvbiIsImZpbmRNYXRjaGluZ0RyaXZlciIsInNlc3Npb25PdmVycmlkZSIsImRlbGV0ZUFsbFNlc3Npb25zIiwicnVubmluZ0RyaXZlcnNEYXRhIiwib3RoZXJQZW5kaW5nRHJpdmVyc0RhdGEiLCJkcml2ZXJJbnN0YW5jZSIsInJlbGF4ZWRTZWN1cml0eUVuYWJsZWQiLCJkZW55SW5zZWN1cmUiLCJhIiwiYWxsb3dJbnNlY3VyZSIsInNlcnZlckhvc3QiLCJhZGRyZXNzIiwic2VydmVyUG9ydCIsInBvcnQiLCJzZXJ2ZXJQYXRoIiwiYmFzZVBhdGgiLCJjdXJTZXNzaW9uRGF0YUZvckRyaXZlciIsImVycm9ycyIsIlNlc3Npb25Ob3RDcmVhdGVkRXJyb3IiLCJhY3F1aXJlIiwiY29tcGFjdCIsImRydiIsInB1c2giLCJwdWxsIiwiYXR0YWNoVW5leHBlY3RlZFNodXRkb3duSGFuZGxlciIsInN0YXJ0TmV3Q29tbWFuZFRpbWVvdXQiLCJpc1czQ1Byb3RvY29sIiwiSlNPTiIsInN0cmluZ2lmeSIsInVwZGF0ZVNldHRpbmdzIiwiaXNNanNvbndwUHJvdG9jb2wiLCJvblNodXRkb3duIiwiY2F1c2UiLCJFcnJvciIsIndhcm4iLCJpc0Z1bmN0aW9uIiwib25VbmV4cGVjdGVkU2h1dGRvd24iLCJkYXRhIiwidmFsdWVzIiwiZmlsdGVyIiwicyIsImRhdHVtIiwiZGVsZXRlU2Vzc2lvbiIsIm90aGVyU2Vzc2lvbnNEYXRhIiwiY3VyQ29uc3RydWN0b3JOYW1lIiwic2Vzc2lvbnNDb3VudCIsInNpemUiLCJmb3JjZSIsInJlYXNvbiIsInV0aWwiLCJwbHVyYWxpemUiLCJjbGVhbnVwUHJvbWlzZXMiLCJzdGFydFVuZXhwZWN0ZWRTaHV0ZG93biIsImtleXMiLCJjbGVhbnVwUHJvbWlzZSIsInBsdWdpbnNGb3JTZXNzaW9uIiwiY3JlYXRlUGx1Z2luSW5zdGFuY2VzIiwicGx1Z2luc1RvSGFuZGxlQ21kIiwiY21kIiwicCIsImhhbmRsZSIsInBsdWdpbkluc3RhbmNlcyIsIlBsdWdpbkNsYXNzIiwiZW50cmllcyIsImV4ZWN1dGVDb21tYW5kIiwiaXNHZXRTdGF0dXMiLCJHRVRfU1RBVFVTX0NPTU1BTkQiLCJpc1VtYnJlbGxhQ21kIiwiaXNBcHBpdW1Ecml2ZXJDb21tYW5kIiwiaXNTZXNzaW9uQ21kIiwiaXNTZXNzaW9uQ29tbWFuZCIsInJlcUZvclByb3h5IiwibGFzdCIsInBvcCIsInBsdWdpbnMiLCJjbWRIYW5kbGVkQnkiLCJkZWZhdWx0IiwiZGVmYXVsdEJlaGF2aW9yIiwibGVuZ3RoIiwicHJveHlDb21tYW5kIiwiTm9Ecml2ZXJQcm94eUNvbW1hbmRFcnJvciIsIm9yaWdpbmFsVXJsIiwibWV0aG9kIiwiYm9keSIsIkJhc2VEcml2ZXIiLCJwcm90b3R5cGUiLCJjYWxsIiwid3JhcHBlZENtZCIsIndyYXBDb21tYW5kV2l0aFBsdWdpbnMiLCJuZXh0IiwicmVzIiwiZXhlY3V0ZVdyYXBwZWRDb21tYW5kIiwibG9nUGx1Z2luSGFuZGxlclJlcG9ydCIsIkNSRUFURV9TRVNTSU9OX0NPTU1BTkQiLCJmaXJzdCIsIl9uZXh0IiwiZGlkSGFuZGxlIiwiayIsImRpZG50SGFuZGxlIiwiY21kUmVzIiwiY21kRXJyIiwiaXNQbGFpbk9iamVjdCIsImhhcyIsInByb3h5QWN0aXZlIiwiZ2V0UHJveHlBdm9pZExpc3QiLCJjYW5Qcm94eSIsIkRFTEVURV9TRVNTSU9OX0NPTU1BTkQiLCJjb2RlIl0sInNvdXJjZXMiOlsiLi4vLi4vbGliL2FwcGl1bS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKiBlc2xpbnQtZGlzYWJsZSBuby11bnVzZWQtdmFycyAqL1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCB7Z2V0QnVpbGRJbmZvLCB1cGRhdGVCdWlsZEluZm8sIEFQUElVTV9WRVJ9IGZyb20gJy4vY29uZmlnJztcbmltcG9ydCB7XG4gIEJhc2VEcml2ZXIsXG4gIERyaXZlckNvcmUsXG4gIGVycm9ycyxcbiAgaXNTZXNzaW9uQ29tbWFuZCxcbiAgQ1JFQVRFX1NFU1NJT05fQ09NTUFORCxcbiAgREVMRVRFX1NFU1NJT05fQ09NTUFORCxcbiAgR0VUX1NUQVRVU19DT01NQU5ELFxufSBmcm9tICdAYXBwaXVtL2Jhc2UtZHJpdmVyJztcbmltcG9ydCBBc3luY0xvY2sgZnJvbSAnYXN5bmMtbG9jayc7XG5pbXBvcnQge3BhcnNlQ2Fwc0ZvcklubmVyRHJpdmVyLCBwdWxsU2V0dGluZ3N9IGZyb20gJy4vdXRpbHMnO1xuaW1wb3J0IHt1dGlsLCBub2RlLCBsb2dnZXJ9IGZyb20gJ0BhcHBpdW0vc3VwcG9ydCc7XG5pbXBvcnQge2dldERlZmF1bHRzRm9yRXh0ZW5zaW9ufSBmcm9tICcuL3NjaGVtYSc7XG5pbXBvcnQge0RSSVZFUl9UWVBFfSBmcm9tICcuL2NvbnN0YW50cyc7XG5cbmNvbnN0IGRlc2lyZWRDYXBhYmlsaXR5Q29uc3RyYWludHMgPSAvKiogQHR5cGUge2NvbnN0fSAqLyAoe1xuICBhdXRvbWF0aW9uTmFtZToge1xuICAgIHByZXNlbmNlOiB0cnVlLFxuICAgIGlzU3RyaW5nOiB0cnVlLFxuICB9LFxuICBwbGF0Zm9ybU5hbWU6IHtcbiAgICBwcmVzZW5jZTogdHJ1ZSxcbiAgICBpc1N0cmluZzogdHJ1ZSxcbiAgfSxcbn0pO1xuLyoqXG4gKiBAdHlwZWRlZiB7dHlwZW9mIGRlc2lyZWRDYXBhYmlsaXR5Q29uc3RyYWludHN9IEFwcGl1bURyaXZlckNvbnN0cmFpbnRzXG4gKi9cblxuY29uc3Qgc2Vzc2lvbnNMaXN0R3VhcmQgPSBuZXcgQXN5bmNMb2NrKCk7XG5jb25zdCBwZW5kaW5nRHJpdmVyc0d1YXJkID0gbmV3IEFzeW5jTG9jaygpO1xuXG4vKipcbiAqIEBpbXBsZW1lbnRzIHtTZXNzaW9uSGFuZGxlcn1cbiAqL1xuY2xhc3MgQXBwaXVtRHJpdmVyIGV4dGVuZHMgRHJpdmVyQ29yZSB7XG4gIC8qKlxuICAgKiBBY2Nlc3MgdG8gc2Vzc2lvbnMgbGlzdCBtdXN0IGJlIGd1YXJkZWQgd2l0aCBhIFNlbWFwaG9yZSwgYmVjYXVzZVxuICAgKiBpdCBtaWdodCBiZSBjaGFuZ2VkIGJ5IG90aGVyIGFzeW5jIGNhbGxzIGF0IGFueSB0aW1lXG4gICAqIEl0IGlzIG5vdCByZWNvbW1lbmRlZCB0byBhY2Nlc3MgdGhpcyBwcm9wZXJ0eSBkaXJlY3RseSBmcm9tIHRoZSBvdXRzaWRlXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLEV4dGVybmFsRHJpdmVyPn1cbiAgICovXG4gIHNlc3Npb25zID0ge307XG5cbiAgLyoqXG4gICAqIEFjY2VzcyB0byBwZW5kaW5nIGRyaXZlcnMgbGlzdCBtdXN0IGJlIGd1YXJkZWQgd2l0aCBhIFNlbWFwaG9yZSwgYmVjYXVzZVxuICAgKiBpdCBtaWdodCBiZSBjaGFuZ2VkIGJ5IG90aGVyIGFzeW5jIGNhbGxzIGF0IGFueSB0aW1lXG4gICAqIEl0IGlzIG5vdCByZWNvbW1lbmRlZCB0byBhY2Nlc3MgdGhpcyBwcm9wZXJ0eSBkaXJlY3RseSBmcm9tIHRoZSBvdXRzaWRlXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLEV4dGVybmFsRHJpdmVyW10+fVxuICAgKi9cbiAgcGVuZGluZ0RyaXZlcnMgPSB7fTtcblxuICAvKipcbiAgICogTm90ZSB0aGF0IHtAbGlua2NvZGUgQXBwaXVtRHJpdmVyfSBoYXMgbm8gYG5ld0NvbW1hbmRUaW1lb3V0YCBtZXRob2QuXG4gICAqIGBBcHBpdW1Ecml2ZXJgIGRvZXMgbm90IHNldCBhbmQgb2JzZXJ2ZSBpdHMgb3duIHRpbWVvdXRzOyBpbmRpdmlkdWFsXG4gICAqIHNlc3Npb25zIChtYW5hZ2VkIGRyaXZlcnMpIGRvIGluc3RlYWQuXG4gICAqL1xuICBuZXdDb21tYW5kVGltZW91dE1zID0gMDtcblxuICAvKipcbiAgICogTGlzdCBvZiBhY3RpdmUgcGx1Z2luc1xuICAgKiBAdHlwZSB7TWFwPFBsdWdpbkNsYXNzLHN0cmluZz59XG4gICAqL1xuICBwbHVnaW5DbGFzc2VzO1xuXG4gIC8qKlxuICAgKiBtYXAgb2Ygc2Vzc2lvbnMgdG8gYWN0dWFsIHBsdWdpbiBpbnN0YW5jZXMgcGVyIHNlc3Npb25cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsSW5zdGFuY2VUeXBlPFBsdWdpbkNsYXNzPltdPn1cbiAgICovXG4gIHNlc3Npb25QbHVnaW5zID0ge307XG5cbiAgLyoqXG4gICAqIHNvbWUgY29tbWFuZHMgYXJlIHNlc3Npb25sZXNzLCBzbyB3ZSBuZWVkIGEgc2V0IG9mIHBsdWdpbnMgZm9yIHRoZW1cbiAgICogQHR5cGUge0luc3RhbmNlVHlwZTxQbHVnaW5DbGFzcz5bXX1cbiAgICovXG4gIHNlc3Npb25sZXNzUGx1Z2lucyA9IFtdO1xuXG4gIC8qKiBAdHlwZSB7RHJpdmVyQ29uZmlnfSAqL1xuICBkcml2ZXJDb25maWc7XG5cbiAgLyoqIEB0eXBlIHtBcHBpdW1TZXJ2ZXJ9ICovXG4gIHNlcnZlcjtcblxuICBkZXNpcmVkQ2FwQ29uc3RyYWludHMgPSBkZXNpcmVkQ2FwYWJpbGl0eUNvbnN0cmFpbnRzO1xuXG4gIC8qKiBAdHlwZSB7RHJpdmVyT3B0c30gKi9cbiAgYXJncztcblxuICAvKipcbiAgICogQHBhcmFtIHtEcml2ZXJPcHRzfSBvcHRzXG4gICAqL1xuICBjb25zdHJ1Y3RvcihvcHRzKSB7XG4gICAgLy8gSXQgaXMgbmVjZXNzYXJ5IHRvIHNldCBgLS10bXBgIGhlcmUgc2luY2UgaXQgc2hvdWxkIGJlIHNldCB0b1xuICAgIC8vIHByb2Nlc3MuZW52LkFQUElVTV9UTVBfRElSIG9uY2UgYXQgYW4gaW5pdGlhbCBwb2ludCBpbiB0aGUgQXBwaXVtIGxpZmVjeWNsZS5cbiAgICAvLyBUaGUgcHJvY2VzcyBhcmd1bWVudCB3aWxsIGJlIHJlZmVyZW5jZWQgYnkgQmFzZURyaXZlci5cbiAgICAvLyBQbGVhc2UgY2FsbCBAYXBwaXVtL3N1cHBvcnQudGVtcERpciBtb2R1bGUgdG8gYXBwbHkgdGhpcyBiZW5lZml0LlxuICAgIGlmIChvcHRzLnRtcERpcikge1xuICAgICAgcHJvY2Vzcy5lbnYuQVBQSVVNX1RNUF9ESVIgPSBvcHRzLnRtcERpcjtcbiAgICB9XG5cbiAgICBzdXBlcihvcHRzKTtcblxuICAgIHRoaXMuYXJncyA9IHsuLi5vcHRzfTtcblxuICAgIC8vIGFsbG93IHRoaXMgdG8gaGFwcGVuIGluIHRoZSBiYWNrZ3JvdW5kLCBzbyBubyBgYXdhaXRgXG4gICAgKGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHVwZGF0ZUJ1aWxkSW5mbygpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBtYWtlIHN1cmUgd2UgY2F0Y2ggYW55IHBvc3NpYmxlIGVycm9ycyB0byBhdm9pZCB1bmhhbmRsZWQgcmVqZWN0aW9uc1xuICAgICAgICB0aGlzLmxvZy5kZWJ1ZyhgQ2Fubm90IGZldGNoIEFwcGl1bSBidWlsZCBpbmZvOiAke2UubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9KSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyBsb2dnZXIgaW5zdGFuY2UgZm9yIHRoZSBjdXJyZW50IHVtYnJlbGxhIGRyaXZlciBpbnN0YW5jZVxuICAgKi9cbiAgZ2V0IGxvZygpIHtcbiAgICBpZiAoIXRoaXMuX2xvZykge1xuICAgICAgY29uc3QgaW5zdGFuY2VOYW1lID0gYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfUAke25vZGUuZ2V0T2JqZWN0SWQodGhpcykuc3Vic3RyaW5nKDAsIDQpfWA7XG4gICAgICB0aGlzLl9sb2cgPSBsb2dnZXIuZ2V0TG9nZ2VyKGluc3RhbmNlTmFtZSk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9sb2c7XG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VsIGNvbW1hbmRzIHF1ZXVlaW5nIGZvciB0aGUgdW1icmVsbGEgQXBwaXVtIGRyaXZlclxuICAgKi9cbiAgZ2V0IGlzQ29tbWFuZHNRdWV1ZUVuYWJsZWQoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgc2Vzc2lvbkV4aXN0cyhzZXNzaW9uSWQpIHtcbiAgICBjb25zdCBkc3RTZXNzaW9uID0gdGhpcy5zZXNzaW9uc1tzZXNzaW9uSWRdO1xuICAgIHJldHVybiBkc3RTZXNzaW9uICYmIGRzdFNlc3Npb24uc2Vzc2lvbklkICE9PSBudWxsO1xuICB9XG5cbiAgZHJpdmVyRm9yU2Vzc2lvbihzZXNzaW9uSWQpIHtcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9uc1tzZXNzaW9uSWRdO1xuICB9XG5cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlcXVpcmUtYXdhaXRcbiAgYXN5bmMgZ2V0U3RhdHVzKCkge1xuICAgIHJldHVybiB7XG4gICAgICBidWlsZDogXy5jbG9uZShnZXRCdWlsZEluZm8oKSksXG4gICAgfTtcbiAgfVxuXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWF3YWl0XG4gIGFzeW5jIGdldFNlc3Npb25zKCkge1xuICAgIHJldHVybiBfLnRvUGFpcnModGhpcy5zZXNzaW9ucykubWFwKChbaWQsIGRyaXZlcl0pID0+ICh7XG4gICAgICBpZCxcbiAgICAgIGNhcGFiaWxpdGllczogZHJpdmVyLmNhcHMsXG4gICAgfSkpO1xuICB9XG5cbiAgcHJpbnROZXdTZXNzaW9uQW5ub3VuY2VtZW50KGRyaXZlck5hbWUsIGRyaXZlclZlcnNpb24sIGRyaXZlckJhc2VWZXJzaW9uKSB7XG4gICAgdGhpcy5sb2cuaW5mbyhcbiAgICAgIGRyaXZlclZlcnNpb25cbiAgICAgICAgPyBgQXBwaXVtIHYke0FQUElVTV9WRVJ9IGNyZWF0aW5nIG5ldyAke2RyaXZlck5hbWV9ICh2JHtkcml2ZXJWZXJzaW9ufSkgc2Vzc2lvbmBcbiAgICAgICAgOiBgQXBwaXVtIHYke0FQUElVTV9WRVJ9IGNyZWF0aW5nIG5ldyAke2RyaXZlck5hbWV9IHNlc3Npb25gXG4gICAgKTtcbiAgICB0aGlzLmxvZy5pbmZvKGBDaGVja2luZyBCYXNlRHJpdmVyIHZlcnNpb25zIGZvciBBcHBpdW0gYW5kICR7ZHJpdmVyTmFtZX1gKTtcbiAgICB0aGlzLmxvZy5pbmZvKFxuICAgICAgQXBwaXVtRHJpdmVyLmJhc2VWZXJzaW9uXG4gICAgICAgID8gYEFwcGl1bSdzIEJhc2VEcml2ZXIgdmVyc2lvbiBpcyAke0FwcGl1bURyaXZlci5iYXNlVmVyc2lvbn1gXG4gICAgICAgIDogYENvdWxkIG5vdCBkZXRlcm1pbmUgQXBwaXVtJ3MgQmFzZURyaXZlciB2ZXJzaW9uYFxuICAgICk7XG4gICAgdGhpcy5sb2cuaW5mbyhcbiAgICAgIGRyaXZlckJhc2VWZXJzaW9uXG4gICAgICAgID8gYCR7ZHJpdmVyTmFtZX0ncyBCYXNlRHJpdmVyIHZlcnNpb24gaXMgJHtkcml2ZXJCYXNlVmVyc2lvbn1gXG4gICAgICAgIDogYENvdWxkIG5vdCBkZXRlcm1pbmUgJHtkcml2ZXJOYW1lfSdzIEJhc2VEcml2ZXIgdmVyc2lvbmBcbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyBhbGwgQ0xJIGFyZ3VtZW50cyBmb3IgYSBzcGVjaWZpYyBwbHVnaW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleHROYW1lIC0gUGx1Z2luIG5hbWVcbiAgICogQHJldHVybnMge1N0cmluZ1JlY29yZH0gQXJndW1lbnRzIG9iamVjdC4gSWYgbm9uZSwgYW4gZW1wdHkgb2JqZWN0LlxuICAgKi9cbiAgZ2V0Q2xpQXJnc0ZvclBsdWdpbihleHROYW1lKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7U3RyaW5nUmVjb3JkfSAqLyAodGhpcy5hcmdzLnBsdWdpbj8uW2V4dE5hbWVdID8/IHt9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgQ0xJIGFyZ3MgZm9yIGEgc3BlY2lmaWMgZHJpdmVyLlxuICAgKlxuICAgKiBfQW55IGFyZyB3aGljaCBpcyBlcXVhbCB0byBpdHMgZGVmYXVsdCB2YWx1ZSB3aWxsIG5vdCBiZSBwcmVzZW50IGluIHRoZSByZXR1cm5lZCBvYmplY3QuX1xuICAgKlxuICAgKiBfTm90ZSB0aGF0IHRoaXMgYmVoYXZpb3IgY3VycmVudGx5IChNYXkgMTggMjAyMikgZGlmZmVycyBmcm9tIGhvdyBwbHVnaW5zIGFyZSBoYW5kbGVkXyAoc2VlIHtAbGlua2NvZGUgQXBwaXVtRHJpdmVyLmdldENsaUFyZ3NGb3JQbHVnaW59KS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4dE5hbWUgLSBEcml2ZXIgbmFtZVxuICAgKiBAcmV0dXJucyB7U3RyaW5nUmVjb3JkfHVuZGVmaW5lZH0gQXJndW1lbnRzIG9iamVjdC4gSWYgbm9uZSwgYHVuZGVmaW5lZGBcbiAgICovXG4gIGdldENsaUFyZ3NGb3JEcml2ZXIoZXh0TmFtZSkge1xuICAgIGNvbnN0IGFsbENsaUFyZ3NGb3JFeHQgPSAvKiogQHR5cGUge1N0cmluZ1JlY29yZHx1bmRlZmluZWR9ICovICh0aGlzLmFyZ3MuZHJpdmVyPy5bZXh0TmFtZV0pO1xuXG4gICAgaWYgKCFfLmlzRW1wdHkoYWxsQ2xpQXJnc0ZvckV4dCkpIHtcbiAgICAgIGNvbnN0IGRlZmF1bHRzID0gZ2V0RGVmYXVsdHNGb3JFeHRlbnNpb24oRFJJVkVSX1RZUEUsIGV4dE5hbWUpO1xuICAgICAgY29uc3QgY2xpQXJncyA9IF8uaXNFbXB0eShkZWZhdWx0cylcbiAgICAgICAgPyBhbGxDbGlBcmdzRm9yRXh0XG4gICAgICAgIDogXy5vbWl0QnkoYWxsQ2xpQXJnc0ZvckV4dCwgKHZhbHVlLCBrZXkpID0+IF8uaXNFcXVhbChkZWZhdWx0c1trZXldLCB2YWx1ZSkpO1xuICAgICAgaWYgKCFfLmlzRW1wdHkoY2xpQXJncykpIHtcbiAgICAgICAgcmV0dXJuIGNsaUFyZ3M7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIG5ldyBzZXNzaW9uXG4gICAqIEBwYXJhbSB7VzNDQ2FwYWJpbGl0aWVzPEFwcGl1bURyaXZlckNvbnN0cmFpbnRzPn0ganNvbndwQ2FwcyBKU09OV1AgZm9ybWF0dGVkIGRlc2lyZWQgY2FwYWJpbGl0aWVzXG4gICAqIEBwYXJhbSB7VzNDQ2FwYWJpbGl0aWVzPEFwcGl1bURyaXZlckNvbnN0cmFpbnRzPn0gcmVxQ2FwcyBSZXF1aXJlZCBjYXBhYmlsaXRpZXMgKEpTT05XUCBzdGFuZGFyZClcbiAgICogQHBhcmFtIHtXM0NDYXBhYmlsaXRpZXM8QXBwaXVtRHJpdmVyQ29uc3RyYWludHM+fSB3M2NDYXBhYmlsaXRpZXMgVzNDIGNhcGFiaWxpdGllc1xuICAgKiBAcGFyYW0ge0RyaXZlckRhdGFbXX0gW2RyaXZlckRhdGFdXG4gICAqL1xuICBhc3luYyBjcmVhdGVTZXNzaW9uKGpzb253cENhcHMsIHJlcUNhcHMsIHczY0NhcGFiaWxpdGllcywgZHJpdmVyRGF0YSkge1xuICAgIGNvbnN0IGRlZmF1bHRDYXBhYmlsaXRpZXMgPSBfLmNsb25lRGVlcCh0aGlzLmFyZ3MuZGVmYXVsdENhcGFiaWxpdGllcyk7XG4gICAgY29uc3QgZGVmYXVsdFNldHRpbmdzID0gcHVsbFNldHRpbmdzKGRlZmF1bHRDYXBhYmlsaXRpZXMpO1xuICAgIGpzb253cENhcHMgPSBfLmNsb25lRGVlcChqc29ud3BDYXBzKTtcbiAgICBjb25zdCBqd3BTZXR0aW5ncyA9IHsuLi5kZWZhdWx0U2V0dGluZ3MsIC4uLnB1bGxTZXR0aW5ncyhqc29ud3BDYXBzKX07XG4gICAgdzNjQ2FwYWJpbGl0aWVzID0gXy5jbG9uZURlZXAodzNjQ2FwYWJpbGl0aWVzKTtcbiAgICAvLyBJdCBpcyBwb3NzaWJsZSB0aGF0IHRoZSBjbGllbnQgb25seSBwcm92aWRlcyBjYXBzIHVzaW5nIEpTT05XUCBzdGFuZGFyZCxcbiAgICAvLyBhbHRob3VnaCBmaXJzdE1hdGNoL2Fsd2F5c01hdGNoIHByb3BlcnRpZXMgYXJlIHN0aWxsIHByZXNlbnQuXG4gICAgLy8gSW4gc3VjaCBjYXNlIHdlIGFzc3VtZSB0aGUgY2xpZW50IHVuZGVyc3RhbmRzIFczQyBwcm90b2NvbCBhbmQgbWVyZ2UgdGhlIGdpdmVuXG4gICAgLy8gSlNPTldQIGNhcHMgdG8gVzNDIGNhcHNcbiAgICBjb25zdCB3M2NTZXR0aW5ncyA9IHtcbiAgICAgIC4uLmp3cFNldHRpbmdzLFxuICAgICAgLi4ucHVsbFNldHRpbmdzKCh3M2NDYXBhYmlsaXRpZXMgPz8ge30pLmFsd2F5c01hdGNoID8/IHt9KSxcbiAgICB9O1xuICAgIGZvciAoY29uc3QgZmlyc3RNYXRjaEVudHJ5IG9mICh3M2NDYXBhYmlsaXRpZXMgPz8ge30pLmZpcnN0TWF0Y2ggPz8gW10pIHtcbiAgICAgIE9iamVjdC5hc3NpZ24odzNjU2V0dGluZ3MsIHB1bGxTZXR0aW5ncyhmaXJzdE1hdGNoRW50cnkpKTtcbiAgICB9XG5cbiAgICBsZXQgcHJvdG9jb2w7XG4gICAgbGV0IGlubmVyU2Vzc2lvbklkLCBkQ2FwcztcbiAgICB0cnkge1xuICAgICAgLy8gUGFyc2UgdGhlIGNhcHMgaW50byBhIGZvcm1hdCB0aGF0IHRoZSBJbm5lckRyaXZlciB3aWxsIGFjY2VwdFxuICAgICAgY29uc3QgcGFyc2VkQ2FwcyA9IHBhcnNlQ2Fwc0ZvcklubmVyRHJpdmVyKFxuICAgICAgICBqc29ud3BDYXBzLFxuICAgICAgICB3M2NDYXBhYmlsaXRpZXMsXG4gICAgICAgIHRoaXMuZGVzaXJlZENhcENvbnN0cmFpbnRzLFxuICAgICAgICBkZWZhdWx0Q2FwYWJpbGl0aWVzXG4gICAgICApO1xuXG4gICAgICBjb25zdCB7ZGVzaXJlZENhcHMsIHByb2Nlc3NlZEpzb253cENhcGFiaWxpdGllcywgcHJvY2Vzc2VkVzNDQ2FwYWJpbGl0aWVzfSA9XG4gICAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KCcuL3V0aWxzJykuUGFyc2VkRHJpdmVyQ2FwczxBcHBpdW1Ecml2ZXJDb25zdHJhaW50cz59ICovIChwYXJzZWRDYXBzKTtcbiAgICAgIHByb3RvY29sID0gcGFyc2VkQ2Fwcy5wcm90b2NvbDtcbiAgICAgIGNvbnN0IGVycm9yID0gLyoqIEB0eXBlIHtpbXBvcnQoJy4vdXRpbHMnKS5JbnZhbGlkQ2FwczxBcHBpdW1Ecml2ZXJDb25zdHJhaW50cz59ICovIChcbiAgICAgICAgcGFyc2VkQ2Fwc1xuICAgICAgKS5lcnJvcjtcbiAgICAgIC8vIElmIHRoZSBwYXJzaW5nIG9mIHRoZSBjYXBzIHByb2R1Y2VkIGFuIGVycm9yLCB0aHJvdyBpdCBpbiBoZXJlXG4gICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHtcbiAgICAgICAgZHJpdmVyOiBJbm5lckRyaXZlcixcbiAgICAgICAgdmVyc2lvbjogZHJpdmVyVmVyc2lvbixcbiAgICAgICAgZHJpdmVyTmFtZSxcbiAgICAgIH0gPSB0aGlzLmRyaXZlckNvbmZpZy5maW5kTWF0Y2hpbmdEcml2ZXIoZGVzaXJlZENhcHMpO1xuICAgICAgdGhpcy5wcmludE5ld1Nlc3Npb25Bbm5vdW5jZW1lbnQoSW5uZXJEcml2ZXIubmFtZSwgZHJpdmVyVmVyc2lvbiwgSW5uZXJEcml2ZXIuYmFzZVZlcnNpb24pO1xuXG4gICAgICBpZiAodGhpcy5hcmdzLnNlc3Npb25PdmVycmlkZSkge1xuICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZUFsbFNlc3Npb25zKCk7XG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogQHR5cGUge0RyaXZlckRhdGFbXX1cbiAgICAgICAqL1xuICAgICAgbGV0IHJ1bm5pbmdEcml2ZXJzRGF0YSA9IFtdO1xuICAgICAgLyoqXG4gICAgICAgKiBAdHlwZSB7RHJpdmVyRGF0YVtdfVxuICAgICAgICovXG4gICAgICBsZXQgb3RoZXJQZW5kaW5nRHJpdmVyc0RhdGEgPSBbXTtcblxuICAgICAgY29uc3QgZHJpdmVySW5zdGFuY2UgPSBuZXcgSW5uZXJEcml2ZXIodGhpcy5hcmdzLCB0cnVlKTtcblxuICAgICAgLy8gV2Ugd2FudCB0byBhc3NpZ24gc2VjdXJpdHkgdmFsdWVzIGRpcmVjdGx5IG9uIHRoZSBkcml2ZXIuIFRoZSBkcml2ZXJcbiAgICAgIC8vIHNob3VsZCBub3QgcmVhZCBzZWN1cml0eSB2YWx1ZXMgZnJvbSBgdGhpcy5vcHRzYCBiZWNhdXNlIHRob3NlIHZhbHVlc1xuICAgICAgLy8gY291bGQgaGF2ZSBiZWVuIHNldCBieSBhIG1hbGljaW91cyB1c2VyIHZpYSBjYXBhYmlsaXRpZXMsIHdoZXJlYXMgd2VcbiAgICAgIC8vIHdhbnQgYSBndWFyYW50ZWUgdGhlIHZhbHVlcyB3ZXJlIHNldCBieSB0aGUgYXBwaXVtIHNlcnZlciBhZG1pblxuICAgICAgaWYgKHRoaXMuYXJncy5yZWxheGVkU2VjdXJpdHlFbmFibGVkKSB7XG4gICAgICAgIHRoaXMubG9nLmluZm8oXG4gICAgICAgICAgYEFwcGx5aW5nIHJlbGF4ZWQgc2VjdXJpdHkgdG8gJyR7SW5uZXJEcml2ZXIubmFtZX0nIGFzIHBlciBgICtcbiAgICAgICAgICAgIGBzZXJ2ZXIgY29tbWFuZCBsaW5lIGFyZ3VtZW50LiBBbGwgaW5zZWN1cmUgZmVhdHVyZXMgd2lsbCBiZSBgICtcbiAgICAgICAgICAgIGBlbmFibGVkIHVubGVzcyBleHBsaWNpdGx5IGRpc2FibGVkIGJ5IC0tZGVueS1pbnNlY3VyZWBcbiAgICAgICAgKTtcbiAgICAgICAgZHJpdmVySW5zdGFuY2UucmVsYXhlZFNlY3VyaXR5RW5hYmxlZCA9IHRydWU7XG4gICAgICB9XG5cbiAgICAgIGlmICghXy5pc0VtcHR5KHRoaXMuYXJncy5kZW55SW5zZWN1cmUpKSB7XG4gICAgICAgIHRoaXMubG9nLmluZm8oJ0V4cGxpY2l0bHkgcHJldmVudGluZyB1c2Ugb2YgaW5zZWN1cmUgZmVhdHVyZXM6Jyk7XG4gICAgICAgIHRoaXMuYXJncy5kZW55SW5zZWN1cmUubWFwKChhKSA9PiB0aGlzLmxvZy5pbmZvKGAgICAgJHthfWApKTtcbiAgICAgICAgZHJpdmVySW5zdGFuY2UuZGVueUluc2VjdXJlID0gdGhpcy5hcmdzLmRlbnlJbnNlY3VyZTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFfLmlzRW1wdHkodGhpcy5hcmdzLmFsbG93SW5zZWN1cmUpKSB7XG4gICAgICAgIHRoaXMubG9nLmluZm8oJ0V4cGxpY2l0bHkgZW5hYmxpbmcgdXNlIG9mIGluc2VjdXJlIGZlYXR1cmVzOicpO1xuICAgICAgICB0aGlzLmFyZ3MuYWxsb3dJbnNlY3VyZS5tYXAoKGEpID0+IHRoaXMubG9nLmluZm8oYCAgICAke2F9YCkpO1xuICAgICAgICBkcml2ZXJJbnN0YW5jZS5hbGxvd0luc2VjdXJlID0gdGhpcy5hcmdzLmFsbG93SW5zZWN1cmU7XG4gICAgICB9XG5cbiAgICAgIC8vIExpa2V3aXNlLCBhbnkgZHJpdmVyLXNwZWNpZmljIENMSSBhcmdzIHRoYXQgd2VyZSBwYXNzZWQgaW4gc2hvdWxkIGJlIGFzc2lnbmVkIGRpcmVjdGx5IHRvXG4gICAgICAvLyB0aGUgZHJpdmVyIHNvIHRoYXQgdGhleSBjYW5ub3QgYmUgbWltaWNrZWQgYnkgYSBtYWxpY2lvdXMgdXNlciBzZW5kaW5nIGluIGNhcGFiaWxpdGllc1xuICAgICAgY29uc3QgY2xpQXJncyA9IHRoaXMuZ2V0Q2xpQXJnc0ZvckRyaXZlcihkcml2ZXJOYW1lKTtcbiAgICAgIGlmICghXy5pc0VtcHR5KGNsaUFyZ3MpKSB7XG4gICAgICAgIGRyaXZlckluc3RhbmNlLmNsaUFyZ3MgPSBjbGlBcmdzO1xuICAgICAgfVxuXG4gICAgICAvLyBUaGlzIGFzc2lnbm1lbnQgaXMgcmVxdWlyZWQgZm9yIGNvcnJlY3Qgd2ViIHNvY2tldHMgZnVuY3Rpb25hbGl0eSBpbnNpZGUgdGhlIGRyaXZlclxuICAgICAgLy8gRHJpdmVycy9wbHVnaW5zIG1pZ2h0IGFsc28gd2FudCB0byBrbm93IHdoZXJlIHRoZXkgYXJlIGhvc3RlZFxuXG4gICAgICAvLyBYWFg6IHRlbXBvcmFyeSBoYWNrIHRvIHdvcmsgYXJvdW5kICMxNjc0N1xuICAgICAgZHJpdmVySW5zdGFuY2Uuc2VydmVyID0gdGhpcy5zZXJ2ZXI7XG4gICAgICBkcml2ZXJJbnN0YW5jZS5zZXJ2ZXJIb3N0ID0gdGhpcy5hcmdzLmFkZHJlc3M7XG4gICAgICBkcml2ZXJJbnN0YW5jZS5zZXJ2ZXJQb3J0ID0gdGhpcy5hcmdzLnBvcnQ7XG4gICAgICBkcml2ZXJJbnN0YW5jZS5zZXJ2ZXJQYXRoID0gdGhpcy5hcmdzLmJhc2VQYXRoO1xuXG4gICAgICB0cnkge1xuICAgICAgICBydW5uaW5nRHJpdmVyc0RhdGEgPSAoYXdhaXQgdGhpcy5jdXJTZXNzaW9uRGF0YUZvckRyaXZlcihJbm5lckRyaXZlcikpID8/IFtdO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLlNlc3Npb25Ob3RDcmVhdGVkRXJyb3IoZS5tZXNzYWdlKTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHBlbmRpbmdEcml2ZXJzR3VhcmQuYWNxdWlyZShBcHBpdW1Ecml2ZXIubmFtZSwgKCkgPT4ge1xuICAgICAgICB0aGlzLnBlbmRpbmdEcml2ZXJzW0lubmVyRHJpdmVyLm5hbWVdID0gdGhpcy5wZW5kaW5nRHJpdmVyc1tJbm5lckRyaXZlci5uYW1lXSB8fCBbXTtcbiAgICAgICAgb3RoZXJQZW5kaW5nRHJpdmVyc0RhdGEgPSBfLmNvbXBhY3QoXG4gICAgICAgICAgdGhpcy5wZW5kaW5nRHJpdmVyc1tJbm5lckRyaXZlci5uYW1lXS5tYXAoKGRydikgPT4gZHJ2LmRyaXZlckRhdGEpXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMucGVuZGluZ0RyaXZlcnNbSW5uZXJEcml2ZXIubmFtZV0ucHVzaChkcml2ZXJJbnN0YW5jZSk7XG4gICAgICB9KTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgW2lubmVyU2Vzc2lvbklkLCBkQ2Fwc10gPSBhd2FpdCBkcml2ZXJJbnN0YW5jZS5jcmVhdGVTZXNzaW9uKFxuICAgICAgICAgIHByb2Nlc3NlZEpzb253cENhcGFiaWxpdGllcyxcbiAgICAgICAgICByZXFDYXBzLFxuICAgICAgICAgIHByb2Nlc3NlZFczQ0NhcGFiaWxpdGllcyxcbiAgICAgICAgICBbLi4ucnVubmluZ0RyaXZlcnNEYXRhLCAuLi5vdGhlclBlbmRpbmdEcml2ZXJzRGF0YV1cbiAgICAgICAgKTtcbiAgICAgICAgcHJvdG9jb2wgPSBkcml2ZXJJbnN0YW5jZS5wcm90b2NvbDtcbiAgICAgICAgdGhpcy5zZXNzaW9uc1tpbm5lclNlc3Npb25JZF0gPSBkcml2ZXJJbnN0YW5jZTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IHBlbmRpbmdEcml2ZXJzR3VhcmQuYWNxdWlyZShBcHBpdW1Ecml2ZXIubmFtZSwgKCkgPT4ge1xuICAgICAgICAgIF8ucHVsbCh0aGlzLnBlbmRpbmdEcml2ZXJzW0lubmVyRHJpdmVyLm5hbWVdLCBkcml2ZXJJbnN0YW5jZSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmF0dGFjaFVuZXhwZWN0ZWRTaHV0ZG93bkhhbmRsZXIoZHJpdmVySW5zdGFuY2UsIGlubmVyU2Vzc2lvbklkKTtcblxuICAgICAgdGhpcy5sb2cuaW5mbyhcbiAgICAgICAgYE5ldyAke0lubmVyRHJpdmVyLm5hbWV9IHNlc3Npb24gY3JlYXRlZCBzdWNjZXNzZnVsbHksIHNlc3Npb24gYCArXG4gICAgICAgICAgYCR7aW5uZXJTZXNzaW9uSWR9IGFkZGVkIHRvIG1hc3RlciBzZXNzaW9uIGxpc3RgXG4gICAgICApO1xuXG4gICAgICAvLyBzZXQgdGhlIE5ldyBDb21tYW5kIFRpbWVvdXQgZm9yIHRoZSBpbm5lciBkcml2ZXJcbiAgICAgIGRyaXZlckluc3RhbmNlLnN0YXJ0TmV3Q29tbWFuZFRpbWVvdXQoKTtcblxuICAgICAgLy8gYXBwbHkgaW5pdGlhbCB2YWx1ZXMgdG8gQXBwaXVtIHNldHRpbmdzIChpZiBwcm92aWRlZClcbiAgICAgIGlmIChkcml2ZXJJbnN0YW5jZS5pc1czQ1Byb3RvY29sKCkgJiYgIV8uaXNFbXB0eSh3M2NTZXR0aW5ncykpIHtcbiAgICAgICAgdGhpcy5sb2cuaW5mbyhcbiAgICAgICAgICBgQXBwbHlpbmcgdGhlIGluaXRpYWwgdmFsdWVzIHRvIEFwcGl1bSBzZXR0aW5ncyBwYXJzZWQgZnJvbSBXM0MgY2FwczogYCArXG4gICAgICAgICAgICBKU09OLnN0cmluZ2lmeSh3M2NTZXR0aW5ncylcbiAgICAgICAgKTtcbiAgICAgICAgYXdhaXQgZHJpdmVySW5zdGFuY2UudXBkYXRlU2V0dGluZ3ModzNjU2V0dGluZ3MpO1xuICAgICAgfSBlbHNlIGlmIChkcml2ZXJJbnN0YW5jZS5pc01qc29ud3BQcm90b2NvbCgpICYmICFfLmlzRW1wdHkoandwU2V0dGluZ3MpKSB7XG4gICAgICAgIHRoaXMubG9nLmluZm8oXG4gICAgICAgICAgYEFwcGx5aW5nIHRoZSBpbml0aWFsIHZhbHVlcyB0byBBcHBpdW0gc2V0dGluZ3MgcGFyc2VkIGZyb20gTUpTT05XUCBjYXBzOiBgICtcbiAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGp3cFNldHRpbmdzKVxuICAgICAgICApO1xuICAgICAgICBhd2FpdCBkcml2ZXJJbnN0YW5jZS51cGRhdGVTZXR0aW5ncyhqd3BTZXR0aW5ncyk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHByb3RvY29sLFxuICAgICAgICBlcnJvcixcbiAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHByb3RvY29sLFxuICAgICAgdmFsdWU6IFtpbm5lclNlc3Npb25JZCwgZENhcHMsIHByb3RvY29sXSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSB7RHJpdmVyfSBkcml2ZXJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGlubmVyU2Vzc2lvbklkXG4gICAqL1xuICBhdHRhY2hVbmV4cGVjdGVkU2h1dGRvd25IYW5kbGVyKGRyaXZlciwgaW5uZXJTZXNzaW9uSWQpIHtcbiAgICBjb25zdCBvblNodXRkb3duID0gKGNhdXNlID0gbmV3IEVycm9yKCdVbmtub3duIGVycm9yJykpID0+IHtcbiAgICAgIHRoaXMubG9nLndhcm4oYEVuZGluZyBzZXNzaW9uLCBjYXVzZSB3YXMgJyR7Y2F1c2UubWVzc2FnZX0nYCk7XG5cbiAgICAgIGlmICh0aGlzLnNlc3Npb25QbHVnaW5zW2lubmVyU2Vzc2lvbklkXSkge1xuICAgICAgICBmb3IgKGNvbnN0IHBsdWdpbiBvZiB0aGlzLnNlc3Npb25QbHVnaW5zW2lubmVyU2Vzc2lvbklkXSkge1xuICAgICAgICAgIGlmIChfLmlzRnVuY3Rpb24ocGx1Z2luLm9uVW5leHBlY3RlZFNodXRkb3duKSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoXG4gICAgICAgICAgICAgIGBQbHVnaW4gJHtwbHVnaW4ubmFtZX0gZGVmaW5lcyBhbiB1bmV4cGVjdGVkIHNodXRkb3duIGhhbmRsZXI7IGNhbGxpbmcgaXQgbm93YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIHBsdWdpbi5vblVuZXhwZWN0ZWRTaHV0ZG93bihkcml2ZXIsIGNhdXNlKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgdGhpcy5sb2cud2FybihcbiAgICAgICAgICAgICAgICBgR290IGFuIGVycm9yIHdoZW4gcnVubmluZyBwbHVnaW4gJHtwbHVnaW4ubmFtZX0gc2h1dGRvd24gaGFuZGxlcjogJHtlfWBcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoYFBsdWdpbiAke3BsdWdpbi5uYW1lfSBkb2VzIG5vdCBkZWZpbmUgYW4gdW5leHBlY3RlZCBzaHV0ZG93biBoYW5kbGVyYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRoaXMubG9nLmluZm8oYFJlbW92aW5nIHNlc3Npb24gJyR7aW5uZXJTZXNzaW9uSWR9JyBmcm9tIG91ciBtYXN0ZXIgc2Vzc2lvbiBsaXN0YCk7XG4gICAgICBkZWxldGUgdGhpcy5zZXNzaW9uc1tpbm5lclNlc3Npb25JZF07XG4gICAgICBkZWxldGUgdGhpcy5zZXNzaW9uUGx1Z2luc1tpbm5lclNlc3Npb25JZF07XG4gICAgfTtcblxuICAgIGlmIChfLmlzRnVuY3Rpb24oZHJpdmVyLm9uVW5leHBlY3RlZFNodXRkb3duKSkge1xuICAgICAgZHJpdmVyLm9uVW5leHBlY3RlZFNodXRkb3duKG9uU2h1dGRvd24pO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmxvZy53YXJuKFxuICAgICAgICBgRmFpbGVkIHRvIGF0dGFjaCB0aGUgdW5leHBlY3RlZCBzaHV0ZG93biBsaXN0ZW5lci4gYCArXG4gICAgICAgICAgYElzICdvblVuZXhwZWN0ZWRTaHV0ZG93bicgbWV0aG9kIGF2YWlsYWJsZSBmb3IgJyR7ZHJpdmVyLmNvbnN0cnVjdG9yLm5hbWV9Jz9gXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge0RyaXZlckNsYXNzfSBJbm5lckRyaXZlclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxEcml2ZXJEYXRhW10+fX1cbiAgICovXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSByZXF1aXJlLWF3YWl0XG4gIGFzeW5jIGN1clNlc3Npb25EYXRhRm9yRHJpdmVyKElubmVyRHJpdmVyKSB7XG4gICAgY29uc3QgZGF0YSA9IF8uY29tcGFjdChcbiAgICAgIF8udmFsdWVzKHRoaXMuc2Vzc2lvbnMpXG4gICAgICAgIC5maWx0ZXIoKHMpID0+IHMuY29uc3RydWN0b3IubmFtZSA9PT0gSW5uZXJEcml2ZXIubmFtZSlcbiAgICAgICAgLm1hcCgocykgPT4gcy5kcml2ZXJEYXRhKVxuICAgICk7XG4gICAgZm9yIChjb25zdCBkYXR1bSBvZiBkYXRhKSB7XG4gICAgICBpZiAoIWRhdHVtKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgUHJvYmxlbSBnZXR0aW5nIHNlc3Npb24gZGF0YSBmb3IgZHJpdmVyIHR5cGUgYCArXG4gICAgICAgICAgICBgJHtJbm5lckRyaXZlci5uYW1lfTsgZG9lcyBpdCBpbXBsZW1lbnQgJ2dldCBkcml2ZXJEYXRhJz9gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9XG5cbiAgLyoqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWRcbiAgICovXG4gIGFzeW5jIGRlbGV0ZVNlc3Npb24oc2Vzc2lvbklkKSB7XG4gICAgbGV0IHByb3RvY29sO1xuICAgIHRyeSB7XG4gICAgICBsZXQgb3RoZXJTZXNzaW9uc0RhdGE7XG4gICAgICBjb25zdCBkc3RTZXNzaW9uID0gYXdhaXQgc2Vzc2lvbnNMaXN0R3VhcmQuYWNxdWlyZShBcHBpdW1Ecml2ZXIubmFtZSwgKCkgPT4ge1xuICAgICAgICBpZiAoIXRoaXMuc2Vzc2lvbnNbc2Vzc2lvbklkXSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBjdXJDb25zdHJ1Y3Rvck5hbWUgPSB0aGlzLnNlc3Npb25zW3Nlc3Npb25JZF0uY29uc3RydWN0b3IubmFtZTtcbiAgICAgICAgb3RoZXJTZXNzaW9uc0RhdGEgPSBfLnRvUGFpcnModGhpcy5zZXNzaW9ucylcbiAgICAgICAgICAuZmlsdGVyKFxuICAgICAgICAgICAgKFtrZXksIHZhbHVlXSkgPT4gdmFsdWUuY29uc3RydWN0b3IubmFtZSA9PT0gY3VyQ29uc3RydWN0b3JOYW1lICYmIGtleSAhPT0gc2Vzc2lvbklkXG4gICAgICAgICAgKVxuICAgICAgICAgIC5tYXAoKFssIHZhbHVlXSkgPT4gdmFsdWUuZHJpdmVyRGF0YSk7XG4gICAgICAgIGNvbnN0IGRzdFNlc3Npb24gPSB0aGlzLnNlc3Npb25zW3Nlc3Npb25JZF07XG4gICAgICAgIHByb3RvY29sID0gZHN0U2Vzc2lvbi5wcm90b2NvbDtcbiAgICAgICAgdGhpcy5sb2cuaW5mbyhgUmVtb3Zpbmcgc2Vzc2lvbiAke3Nlc3Npb25JZH0gZnJvbSBvdXIgbWFzdGVyIHNlc3Npb24gbGlzdGApO1xuICAgICAgICAvLyByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhlIGRlbGV0ZVNlc3Npb24gY29tcGxldGVzIHN1Y2Nlc3NmdWxseSBvciBub3RcbiAgICAgICAgLy8gbWFrZSB0aGUgc2Vzc2lvbiB1bmF2YWlsYWJsZSwgYmVjYXVzZSB3aG8ga25vd3Mgd2hhdCBzdGF0ZSBpdCBtaWdodFxuICAgICAgICAvLyBiZSBpbiBvdGhlcndpc2VcbiAgICAgICAgZGVsZXRlIHRoaXMuc2Vzc2lvbnNbc2Vzc2lvbklkXTtcbiAgICAgICAgZGVsZXRlIHRoaXMuc2Vzc2lvblBsdWdpbnNbc2Vzc2lvbklkXTtcbiAgICAgICAgcmV0dXJuIGRzdFNlc3Npb247XG4gICAgICB9KTtcbiAgICAgIC8vIHRoaXMgbWF5IG5vdCBiZSBjb3JyZWN0LCBidXQgaWYgYGRzdFNlc3Npb25gIHdhcyBmYWxzeSwgdGhlIGNhbGwgdG8gYGRlbGV0ZVNlc3Npb24oKWAgd291bGRcbiAgICAgIC8vIHRocm93IGFueXdheS5cbiAgICAgIGlmICghZHN0U2Vzc2lvbikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Nlc3Npb24gbm90IGZvdW5kJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4ge1xuICAgICAgICBwcm90b2NvbCxcbiAgICAgICAgdmFsdWU6IGF3YWl0IGRzdFNlc3Npb24uZGVsZXRlU2Vzc2lvbihzZXNzaW9uSWQsIG90aGVyU2Vzc2lvbnNEYXRhKSxcbiAgICAgIH07XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5sb2cuZXJyb3IoYEhhZCB0cm91YmxlIGVuZGluZyBzZXNzaW9uICR7c2Vzc2lvbklkfTogJHtlLm1lc3NhZ2V9YCk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBwcm90b2NvbCxcbiAgICAgICAgZXJyb3I6IGUsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZUFsbFNlc3Npb25zKG9wdHMgPSB7fSkge1xuICAgIGNvbnN0IHNlc3Npb25zQ291bnQgPSBfLnNpemUodGhpcy5zZXNzaW9ucyk7XG4gICAgaWYgKDAgPT09IHNlc3Npb25zQ291bnQpIHtcbiAgICAgIHRoaXMubG9nLmRlYnVnKCdUaGVyZSBhcmUgbm8gYWN0aXZlIHNlc3Npb25zIGZvciBjbGVhbnVwJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qge2ZvcmNlID0gZmFsc2UsIHJlYXNvbn0gPSBvcHRzO1xuICAgIHRoaXMubG9nLmRlYnVnKGBDbGVhbmluZyB1cCAke3V0aWwucGx1cmFsaXplKCdhY3RpdmUgc2Vzc2lvbicsIHNlc3Npb25zQ291bnQsIHRydWUpfWApO1xuICAgIGNvbnN0IGNsZWFudXBQcm9taXNlcyA9IGZvcmNlXG4gICAgICA/IF8udmFsdWVzKHRoaXMuc2Vzc2lvbnMpLm1hcCgoZHJ2KSA9PlxuICAgICAgICAgIGRydi5zdGFydFVuZXhwZWN0ZWRTaHV0ZG93bihyZWFzb24gJiYgbmV3IEVycm9yKHJlYXNvbikpXG4gICAgICAgIClcbiAgICAgIDogXy5rZXlzKHRoaXMuc2Vzc2lvbnMpLm1hcCgoaWQpID0+IHRoaXMuZGVsZXRlU2Vzc2lvbihpZCkpO1xuICAgIGZvciAoY29uc3QgY2xlYW51cFByb21pc2Ugb2YgY2xlYW51cFByb21pc2VzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBjbGVhbnVwUHJvbWlzZTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgdGhpcy5sb2cuZGVidWcoZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgYXBwcm9wcmlhdGUgcGx1Z2lucyBmb3IgYSBzZXNzaW9uIChvciBzZXNzaW9ubGVzcyBwbHVnaW5zKVxuICAgKlxuICAgKiBAcGFyYW0gez9zdHJpbmd9IHNlc3Npb25JZCAtIHRoZSBzZXNzaW9uSWQgKG9yIG51bGwpIHRvIHVzZSB0byBmaW5kIHBsdWdpbnNcbiAgICogQHJldHVybnMge0FycmF5fSAtIGFycmF5IG9mIHBsdWdpbiBpbnN0YW5jZXNcbiAgICovXG4gIHBsdWdpbnNGb3JTZXNzaW9uKHNlc3Npb25JZCA9IG51bGwpIHtcbiAgICBpZiAoc2Vzc2lvbklkKSB7XG4gICAgICBpZiAoIXRoaXMuc2Vzc2lvblBsdWdpbnNbc2Vzc2lvbklkXSkge1xuICAgICAgICB0aGlzLnNlc3Npb25QbHVnaW5zW3Nlc3Npb25JZF0gPSB0aGlzLmNyZWF0ZVBsdWdpbkluc3RhbmNlcygpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuc2Vzc2lvblBsdWdpbnNbc2Vzc2lvbklkXTtcbiAgICB9XG5cbiAgICBpZiAoXy5pc0VtcHR5KHRoaXMuc2Vzc2lvbmxlc3NQbHVnaW5zKSkge1xuICAgICAgdGhpcy5zZXNzaW9ubGVzc1BsdWdpbnMgPSB0aGlzLmNyZWF0ZVBsdWdpbkluc3RhbmNlcygpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ubGVzc1BsdWdpbnM7XG4gIH1cblxuICAvKipcbiAgICogVG8gZ2V0IHBsdWdpbnMgZm9yIGEgY29tbWFuZCwgd2UgZWl0aGVyIGdldCB0aGUgcGx1Z2luIGluc3RhbmNlcyBhc3NvY2lhdGVkIHdpdGggdGhlXG4gICAqIHBhcnRpY3VsYXIgY29tbWFuZCdzIHNlc3Npb24sIG9yIGluIHRoZSBjYXNlIG9mIHNlc3Npb25sZXNzIHBsdWdpbnMsIHB1bGwgZnJvbSB0aGUgc2V0IG9mXG4gICAqIHBsdWdpbiBpbnN0YW5jZXMgcmVzZXJ2ZWQgZm9yIHNlc3Npb25sZXNzIGNvbW1hbmRzIChhbmQgd2UgbGF6aWx5IGNyZWF0ZSBwbHVnaW4gaW5zdGFuY2VzIG9uXG4gICAqIGZpcnN0IHVzZSlcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IGNtZCAtIHRoZSBuYW1lIG9mIHRoZSBjb21tYW5kIHRvIGZpbmQgYSBwbHVnaW4gdG8gaGFuZGxlXG4gICAqIEBwYXJhbSB7P3N0cmluZ30gc2Vzc2lvbklkIC0gdGhlIHBhcnRpY3VsYXIgc2Vzc2lvbiBmb3Igd2hpY2ggdG8gZmluZCBhIHBsdWdpbiwgb3IgbnVsbCBpZlxuICAgKiBzZXNzaW9ubGVzc1xuICAgKi9cbiAgcGx1Z2luc1RvSGFuZGxlQ21kKGNtZCwgc2Vzc2lvbklkID0gbnVsbCkge1xuICAgIC8vIHRvIGhhbmRsZSBhIGdpdmVuIGNvbW1hbmQsIGEgcGx1Z2luIHNob3VsZCBlaXRoZXIgaW1wbGVtZW50IHRoYXQgY29tbWFuZCBhcyBhIHBsdWdpblxuICAgIC8vIGluc3RhbmNlIG1ldGhvZCBvciBpdCBzaG91bGQgaW1wbGVtZW50IGEgZ2VuZXJpYyAnaGFuZGxlJyBtZXRob2RcbiAgICByZXR1cm4gdGhpcy5wbHVnaW5zRm9yU2Vzc2lvbihzZXNzaW9uSWQpLmZpbHRlcihcbiAgICAgIChwKSA9PiBfLmlzRnVuY3Rpb24ocFtjbWRdKSB8fCBfLmlzRnVuY3Rpb24ocC5oYW5kbGUpXG4gICAgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGluc3RhbmNlcyBvZiBhbGwgb2YgdGhlIGVuYWJsZWQgUGx1Z2luIGNsYXNzZXNcbiAgICogQHJldHVybnMge1BsdWdpbltdfVxuICAgKi9cbiAgY3JlYXRlUGx1Z2luSW5zdGFuY2VzKCkge1xuICAgIC8qKiBAdHlwZSB7UGx1Z2luW119ICovXG4gICAgY29uc3QgcGx1Z2luSW5zdGFuY2VzID0gW107XG4gICAgZm9yIChjb25zdCBbUGx1Z2luQ2xhc3MsIG5hbWVdIG9mIHRoaXMucGx1Z2luQ2xhc3Nlcy5lbnRyaWVzKCkpIHtcbiAgICAgIGNvbnN0IGNsaUFyZ3MgPSB0aGlzLmdldENsaUFyZ3NGb3JQbHVnaW4obmFtZSk7XG4gICAgICBjb25zdCBwbHVnaW4gPSBuZXcgUGx1Z2luQ2xhc3MobmFtZSwgY2xpQXJncyk7XG4gICAgICBwbHVnaW5JbnN0YW5jZXMucHVzaChwbHVnaW4pO1xuICAgIH1cbiAgICByZXR1cm4gcGx1Z2luSW5zdGFuY2VzO1xuICB9XG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjbWRcbiAgICogQHBhcmFtICB7Li4uYW55fSBhcmdzXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHt2YWx1ZTogYW55LCBlcnJvcj86IEVycm9yLCBwcm90b2NvbDogc3RyaW5nfSB8IGltcG9ydCgndHlwZS1mZXN0JykuQXN5bmNSZXR1cm5UeXBlPERyaXZlclsnZXhlY3V0ZUNvbW1hbmQnXT4+fVxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZUNvbW1hbmQoY21kLCAuLi5hcmdzKSB7XG4gICAgLy8gV2UgaGF2ZSBiYXNpY2FsbHkgdGhyZWUgY2FzZXMgZm9yIGhvdyB0byBoYW5kbGUgY29tbWFuZHM6XG4gICAgLy8gMS4gaGFuZGxlIGdldFN0YXR1cyAod2UgZG8gdGhpcyBhcyBhIHNwZWNpYWwgb3V0IG9mIGJhbmQgY2FzZSBzbyBpdCBkb2Vzbid0IGdldCBhZGRlZCB0byBhblxuICAgIC8vICAgIGV4ZWN1dGlvbiBxdWV1ZSwgYW5kIGNhbiBiZSBjYWxsZWQgd2hpbGUgZS5nLiBjcmVhdGVTZXNzaW9uIGlzIGluIHByb2dyZXNzKVxuICAgIC8vIDIuIGhhbmRsZSBjb21tYW5kcyB0aGF0IHRoaXMgdW1icmVsbGEgZHJpdmVyIHNob3VsZCBoYW5kbGUsIHJhdGhlciB0aGFuIHRoZSBhY3R1YWwgc2Vzc2lvblxuICAgIC8vICAgIGRyaXZlciAoZm9yIGV4YW1wbGUsIGRlbGV0ZVNlc3Npb24sIG9yIG90aGVyIG5vbi1zZXNzaW9uIGNvbW1hbmRzKVxuICAgIC8vIDMuIGhhbmRsZSBzZXNzaW9uIGRyaXZlciBjb21tYW5kcy5cbiAgICAvLyBUaGUgdHJpY2t5IHBhcnQgaXMgdGhhdCBiZWNhdXNlIHdlIHN1cHBvcnQgY29tbWFuZCBwbHVnaW5zLCB3ZSBuZWVkIHRvIHdyYXAgYW55IG9mIHRoZXNlXG4gICAgLy8gY2FzZXMgd2l0aCBwbHVnaW4gaGFuZGxpbmcuXG5cbiAgICBjb25zdCBpc0dldFN0YXR1cyA9IGNtZCA9PT0gR0VUX1NUQVRVU19DT01NQU5EO1xuICAgIGNvbnN0IGlzVW1icmVsbGFDbWQgPSBpc0FwcGl1bURyaXZlckNvbW1hbmQoY21kKTtcbiAgICBjb25zdCBpc1Nlc3Npb25DbWQgPSBpc1Nlc3Npb25Db21tYW5kKGNtZCk7XG5cbiAgICAvLyBpZiBhIHBsdWdpbiBvdmVycmlkZSBwcm94eWluZyBmb3IgdGhpcyBjb21tYW5kIGFuZCB0aGF0IGlzIHdoeSB3ZSBhcmUgaGVyZSBpbnN0ZWFkIG9mIGp1c3RcbiAgICAvLyBsZXR0aW5nIHRoZSBwcm90b2NvbCBwcm94eSB0aGUgY29tbWFuZCBlbnRpcmVseSwgZGV0ZXJtaW5lIHRoYXQsIGdldCB0aGUgcmVxdWVzdCBvYmplY3QgZm9yXG4gICAgLy8gdXNlIGxhdGVyIG9uLCB0aGVuIGNsZWFuIHVwIHRoZSBhcmdzXG4gICAgY29uc3QgcmVxRm9yUHJveHkgPSBfLmxhc3QoYXJncyk/LnJlcUZvclByb3h5O1xuICAgIGlmIChyZXFGb3JQcm94eSkge1xuICAgICAgYXJncy5wb3AoKTtcbiAgICB9XG5cbiAgICAvLyBmaXJzdCBkbyBzb21lIGVycm9yIGNoZWNraW5nLiBJZiB3ZSdyZSByZXF1ZXN0aW5nIGEgc2Vzc2lvbiBjb21tYW5kIGV4ZWN1dGlvbiwgdGhlbiBtYWtlXG4gICAgLy8gc3VyZSB0aGF0IHNlc3Npb24gYWN0dWFsbHkgZXhpc3RzIG9uIHRoZSBzZXNzaW9uIGRyaXZlciwgYW5kIHNldCB0aGUgc2Vzc2lvbiBkcml2ZXIgaXRzZWxmXG4gICAgbGV0IHNlc3Npb25JZCA9IG51bGw7XG4gICAgbGV0IGRzdFNlc3Npb24gPSBudWxsO1xuICAgIGxldCBwcm90b2NvbCA9IG51bGw7XG4gICAgLyoqIEB0eXBlIHt0aGlzIHwgRXh0ZXJuYWxEcml2ZXJ9ICovXG4gICAgbGV0IGRyaXZlciA9IHRoaXM7XG4gICAgaWYgKGlzU2Vzc2lvbkNtZCkge1xuICAgICAgc2Vzc2lvbklkID0gXy5sYXN0KGFyZ3MpO1xuICAgICAgZHN0U2Vzc2lvbiA9IHRoaXMuc2Vzc2lvbnNbc2Vzc2lvbklkXTtcbiAgICAgIGlmICghZHN0U2Vzc2lvbikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSBzZXNzaW9uIHdpdGggaWQgJyR7c2Vzc2lvbklkfScgZG9lcyBub3QgZXhpc3RgKTtcbiAgICAgIH1cbiAgICAgIC8vIG5vdyBzYXZlIHRoZSByZXNwb25zZSBwcm90b2NvbCBnaXZlbiB0aGF0IHRoZSBzZXNzaW9uIGRyaXZlcidzIHByb3RvY29sIG1pZ2h0IGRpZmZlclxuICAgICAgcHJvdG9jb2wgPSBkc3RTZXNzaW9uLnByb3RvY29sO1xuICAgICAgaWYgKCFpc1VtYnJlbGxhQ21kKSB7XG4gICAgICAgIGRyaXZlciA9IGRzdFNlc3Npb247XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gZ2V0IGFueSBwbHVnaW5zIHdoaWNoIGFyZSByZWdpc3RlcmVkIGFzIGhhbmRsaW5nIHRoaXMgY29tbWFuZFxuICAgIGNvbnN0IHBsdWdpbnMgPSB0aGlzLnBsdWdpbnNUb0hhbmRsZUNtZChjbWQsIHNlc3Npb25JZCk7XG5cbiAgICAvLyBub3cgd2UgZGVmaW5lIGEgJ2NtZEhhbmRsZWRCeScgb2JqZWN0IHdoaWNoIHdpbGwga2VlcCB0cmFjayBvZiB3aGljaCBwbHVnaW5zIGhhdmUgaGFuZGxlZCB0aGlzXG4gICAgLy8gY29tbWFuZC4gd2UgY2FyZSBhYm91dCB0aGlzIGJlY2F1c2UgKGEpIG11bHRpcGxlIHBsdWdpbnMgY2FuIGhhbmRsZSB0aGUgc2FtZSBjb21tYW5kLCBhbmRcbiAgICAvLyAoYikgdGhlcmUncyBubyBndWFyYW50ZWUgdGhhdCBhIHBsdWdpbiB3aWxsIGFjdHVhbGx5IGNhbGwgdGhlIG5leHQoKSBtZXRob2Qgd2hpY2ggcnVucyB0aGVcbiAgICAvLyBvcmlnaW5hbCBjb21tYW5kIGV4ZWN1dGlvbi4gVGhpcyByZXN1bHRzIGluIGEgc2l0dWF0aW9uIHdoZXJlIHRoZSBjb21tYW5kIG1pZ2h0IGJlIGhhbmRsZWRcbiAgICAvLyBieSBzb21lIGJ1dCBub3QgYWxsIHBsdWdpbnMsIG9yIGJ5IHBsdWdpbihzKSBidXQgbm90IGJ5IHRoZSBkZWZhdWx0IGJlaGF2aW9yLiBTbyBzdGFydCBvdXRcbiAgICAvLyB0aGlzIG9iamVjdCBkZWNsYXJpbmcgdGhhdCB0aGUgZGVmYXVsdCBoYW5kbGVyIGhhcyBub3QgYmVlbiBleGVjdXRlZC5cbiAgICBjb25zdCBjbWRIYW5kbGVkQnkgPSB7ZGVmYXVsdDogZmFsc2V9O1xuXG4gICAgLy8gbm93IHdlIGRlZmluZSBhbiBhc3luYyBmdW5jdGlvbiB3aGljaCB3aWxsIGJlIHBhc3NlZCB0byBwbHVnaW5zLCBhbmQgc3VjY2Vzc2l2ZWx5IHdyYXBwZWRcbiAgICAvLyBpZiB0aGVyZSBpcyBtb3JlIHRoYW4gb25lIHBsdWdpbiB0aGF0IGNhbiBoYW5kbGUgdGhlIGNvbW1hbmQuIFRvIHN0YXJ0IG9mZiB3aXRoLCB0aGUgYXN5bmNcbiAgICAvLyBmdW5jdGlvbiBpcyBkZWZpbmVkIGFzIGNhbGxpbmcgdGhlIGRlZmF1bHQgYmVoYXZpb3IsIGkuZS4sIHdoaWNoZXZlciBvZiB0aGUgMyBjYXNlcyBhYm92ZSBpc1xuICAgIC8vIHRoZSBhcHByb3ByaWF0ZSBvbmVcbiAgICBjb25zdCBkZWZhdWx0QmVoYXZpb3IgPSBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBpZiB3ZSdyZSBydW5uaW5nIHdpdGggcGx1Z2lucywgbWFrZSBzdXJlIHdlIGxvZyB0aGF0IHRoZSBkZWZhdWx0IGJlaGF2aW9yIGlzIGFjdHVhbGx5XG4gICAgICAvLyBoYXBwZW5pbmcgc28gd2UgY2FuIHRlbGwgd2hlbiB0aGUgcGx1Z2luIGNhbGwgY2hhaW4gaXMgdW53cmFwcGluZyB0byB0aGUgZGVmYXVsdCBiZWhhdmlvclxuICAgICAgLy8gaWYgdGhhdCdzIHdoYXQgaGFwcGVuc1xuICAgICAgcGx1Z2lucy5sZW5ndGggJiYgdGhpcy5sb2cuaW5mbyhgRXhlY3V0aW5nIGRlZmF1bHQgaGFuZGxpbmcgYmVoYXZpb3IgZm9yIGNvbW1hbmQgJyR7Y21kfSdgKTtcblxuICAgICAgLy8gaWYgd2UgbWFrZSBpdCBoZXJlLCB3ZSBrbm93IHRoYXQgdGhlIGRlZmF1bHQgYmVoYXZpb3IgaXMgaGFuZGxlZFxuICAgICAgY21kSGFuZGxlZEJ5LmRlZmF1bHQgPSB0cnVlO1xuXG4gICAgICBpZiAocmVxRm9yUHJveHkpIHtcbiAgICAgICAgLy8gd2Ugd291bGQgaGF2ZSBwcm94aWVkIHRoaXMgY29tbWFuZCBoYWQgYSBwbHVnaW4gbm90IGhhbmRsZWQgaXQsIHNvIHRoZSBkZWZhdWx0IGJlaGF2aW9yXG4gICAgICAgIC8vIGlzIHRvIGRvIHRoZSBwcm94eSBhbmQgcmV0cmlldmUgdGhlIHJlc3VsdCBpbnRlcm5hbGx5IHNvIGl0IGNhbiBiZSBwYXNzZWQgdG8gdGhlIHBsdWdpblxuICAgICAgICAvLyBpbiBjYXNlIGl0IGNhbGxzICdhd2FpdCBuZXh0KCknLiBUaGlzIHJlcXVpcmVzIHRoYXQgdGhlIGRyaXZlciBoYXZlIGRlZmluZWRcbiAgICAgICAgLy8gJ3Byb3h5Q29tbWFuZCcgYW5kIG5vdCBqdXN0ICdwcm94eVJlcVJlcycuXG4gICAgICAgIGlmICghZHN0U2Vzc2lvbi5wcm94eUNvbW1hbmQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgTm9Ecml2ZXJQcm94eUNvbW1hbmRFcnJvcigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBhd2FpdCBkc3RTZXNzaW9uLnByb3h5Q29tbWFuZChcbiAgICAgICAgICByZXFGb3JQcm94eS5vcmlnaW5hbFVybCxcbiAgICAgICAgICByZXFGb3JQcm94eS5tZXRob2QsXG4gICAgICAgICAgcmVxRm9yUHJveHkuYm9keVxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBpZiAoaXNHZXRTdGF0dXMpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0U3RhdHVzKCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChpc1VtYnJlbGxhQ21kKSB7XG4gICAgICAgIC8vIHNvbWUgY29tbWFuZHMsIGxpa2UgZGVsZXRlU2Vzc2lvbiwgd2Ugd2FudCB0byBtYWtlIHN1cmUgdG8gaGFuZGxlIG9uICp0aGlzKiBkcml2ZXIsXG4gICAgICAgIC8vIG5vdCB0aGUgcGxhdGZvcm0gZHJpdmVyXG4gICAgICAgIHJldHVybiBhd2FpdCBCYXNlRHJpdmVyLnByb3RvdHlwZS5leGVjdXRlQ29tbWFuZC5jYWxsKHRoaXMsIGNtZCwgLi4uYXJncyk7XG4gICAgICB9XG5cbiAgICAgIC8vIGhlcmUgd2Uga25vdyB0aGF0IHdlIGFyZSBleGVjdXRpbmcgYSBzZXNzaW9uIGNvbW1hbmQsIGFuZCBoYXZlIGEgdmFsaWQgc2Vzc2lvbiBkcml2ZXJcbiAgICAgIHJldHVybiBhd2FpdCBkc3RTZXNzaW9uLmV4ZWN1dGVDb21tYW5kKGNtZCwgLi4uYXJncyk7XG4gICAgfTtcblxuICAgIC8vIG5vdyB0YWtlIG91ciBkZWZhdWx0IGJlaGF2aW9yLCB3cmFwIGl0IHdpdGggYW55IG51bWJlciBvZiBwbHVnaW4gYmVoYXZpb3JzLCBhbmQgcnVuIGl0XG4gICAgY29uc3Qgd3JhcHBlZENtZCA9IHRoaXMud3JhcENvbW1hbmRXaXRoUGx1Z2lucyh7XG4gICAgICBkcml2ZXIsXG4gICAgICBjbWQsXG4gICAgICBhcmdzLFxuICAgICAgcGx1Z2lucyxcbiAgICAgIGNtZEhhbmRsZWRCeSxcbiAgICAgIG5leHQ6IGRlZmF1bHRCZWhhdmlvcixcbiAgICB9KTtcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLmV4ZWN1dGVXcmFwcGVkQ29tbWFuZCh7d3JhcHBlZENtZCwgcHJvdG9jb2x9KTtcblxuICAgIC8vIGlmIHdlIGhhZCBwbHVnaW5zLCBtYWtlIHN1cmUgdG8gbG9nIG91dCB0aGUgaGVscGZ1bCByZXBvcnQgYWJvdXQgd2hpY2ggcGx1Z2lucyBlbmRlZCB1cFxuICAgIC8vIGhhbmRsaW5nIHRoZSBjb21tYW5kIGFuZCB3aGljaCBkaWRuJ3RcbiAgICB0aGlzLmxvZ1BsdWdpbkhhbmRsZXJSZXBvcnQocGx1Z2lucywge2NtZCwgY21kSGFuZGxlZEJ5fSk7XG5cbiAgICAvLyBBbmQgZmluYWxseSwgaWYgdGhlIGNvbW1hbmQgd2FzIGNyZWF0ZVNlc3Npb24sIHdlIHdhbnQgdG8gbWlncmF0ZSBhbnkgcGx1Z2lucyB3aGljaCB3ZXJlXG4gICAgLy8gcHJldmlvdXNseSBzZXNzaW9ubGVzcyB0byB1c2UgdGhlIG5ldyBzZXNzaW9uSWQsIHNvIHRoYXQgcGx1Z2lucyBjYW4gc2hhcmUgc3RhdGUgYmV0d2VlblxuICAgIC8vIHRoZWlyIGNyZWF0ZVNlc3Npb24gbWV0aG9kIGFuZCBvdGhlciBpbnN0YW5jZSBtZXRob2RzXG4gICAgaWYgKGNtZCA9PT0gQ1JFQVRFX1NFU1NJT05fQ09NTUFORCAmJiB0aGlzLnNlc3Npb25sZXNzUGx1Z2lucy5sZW5ndGggJiYgIXJlcy5lcnJvcikge1xuICAgICAgY29uc3Qgc2Vzc2lvbklkID0gXy5maXJzdChyZXMudmFsdWUpO1xuICAgICAgdGhpcy5sb2cuaW5mbyhcbiAgICAgICAgYFByb21vdGluZyAke3RoaXMuc2Vzc2lvbmxlc3NQbHVnaW5zLmxlbmd0aH0gc2Vzc2lvbmxlc3MgcGx1Z2lucyB0byBiZSBhdHRhY2hlZCBgICtcbiAgICAgICAgICBgdG8gc2Vzc2lvbiBJRCAke3Nlc3Npb25JZH1gXG4gICAgICApO1xuICAgICAgdGhpcy5zZXNzaW9uUGx1Z2luc1tzZXNzaW9uSWRdID0gdGhpcy5zZXNzaW9ubGVzc1BsdWdpbnM7XG4gICAgICB0aGlzLnNlc3Npb25sZXNzUGx1Z2lucyA9IFtdO1xuICAgIH1cblxuICAgIHJldHVybiByZXM7XG4gIH1cblxuICB3cmFwQ29tbWFuZFdpdGhQbHVnaW5zKHtkcml2ZXIsIGNtZCwgYXJncywgbmV4dCwgY21kSGFuZGxlZEJ5LCBwbHVnaW5zfSkge1xuICAgIHBsdWdpbnMubGVuZ3RoICYmXG4gICAgICB0aGlzLmxvZy5pbmZvKGBQbHVnaW5zIHdoaWNoIGNhbiBoYW5kbGUgY21kICcke2NtZH0nOiAke3BsdWdpbnMubWFwKChwKSA9PiBwLm5hbWUpfWApO1xuXG4gICAgLy8gbm93IHdlIGNhbiBnbyB0aHJvdWdoIGVhY2ggcGx1Z2luIGFuZCB3cmFwIGBuZXh0YCBhcm91bmQgaXRzIG93biBoYW5kbGVyLCBwYXNzaW5nIHRoZSAqb2xkKlxuICAgIC8vIG5leHQgaW4gc28gdGhhdCBpdCBjYW4gY2FsbCBpdCBpZiBpdCB3YW50cyB0b1xuICAgIGZvciAoY29uc3QgcGx1Z2luIG9mIHBsdWdpbnMpIHtcbiAgICAgIC8vIG5lZWQgYW4gSUlGRSBoZXJlIGJlY2F1c2Ugd2Ugd2FudCB0aGUgdmFsdWUgb2YgbmV4dCB0aGF0J3MgcGFzc2VkIHRvIHBsdWdpbi5oYW5kbGUgdG8gYmVcbiAgICAgIC8vIGV4YWN0bHkgdGhlIHZhbHVlIG9mIG5leHQgaGVyZSBiZWZvcmUgcmVhc3NpZ25tZW50OyB3ZSBkb24ndCB3YW50IGl0IHRvIGJlIGxhemlseVxuICAgICAgLy8gZXZhbHVhdGVkLCBvdGhlcndpc2Ugd2UgZW5kIHVwIHdpdGggaW5maW5pdGUgcmVjdXJzaW9uIG9mIHRoZSBsYXN0IGBuZXh0YCB0byBiZSBkZWZpbmVkLlxuICAgICAgY21kSGFuZGxlZEJ5W3BsdWdpbi5uYW1lXSA9IGZhbHNlOyAvLyB3ZSBzZWUgYSBuZXcgcGx1Z2luLCBzbyBhZGQgaXQgdG8gdGhlICdjbWRIYW5kbGVkQnknIG9iamVjdFxuICAgICAgbmV4dCA9ICgoX25leHQpID0+IGFzeW5jICgpID0+IHtcbiAgICAgICAgdGhpcy5sb2cuaW5mbyhgUGx1Z2luICR7cGx1Z2luLm5hbWV9IGlzIG5vdyBoYW5kbGluZyBjbWQgJyR7Y21kfSdgKTtcbiAgICAgICAgY21kSGFuZGxlZEJ5W3BsdWdpbi5uYW1lXSA9IHRydWU7IC8vIGlmIHdlIG1ha2UgaXQgaGVyZSwgdGhpcyBwbHVnaW4gaGFzIGF0dGVtcHRlZCB0byBoYW5kbGUgY21kXG4gICAgICAgIC8vIGZpcnN0IGF0dGVtcHQgdG8gaGFuZGxlIHRoZSBjb21tYW5kIHZpYSBhIGNvbW1hbmQtc3BlY2lmaWMgaGFuZGxlciBvbiB0aGUgcGx1Z2luXG4gICAgICAgIGlmIChwbHVnaW5bY21kXSkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBwbHVnaW5bY21kXShfbmV4dCwgZHJpdmVyLCAuLi5hcmdzKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBvdGhlcndpc2UsIGNhbGwgdGhlIGdlbmVyaWMgJ2hhbmRsZScgbWV0aG9kXG4gICAgICAgIHJldHVybiBhd2FpdCBwbHVnaW4uaGFuZGxlKF9uZXh0LCBkcml2ZXIsIGNtZCwgLi4uYXJncyk7XG4gICAgICB9KShuZXh0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV4dDtcbiAgfVxuXG4gIGxvZ1BsdWdpbkhhbmRsZXJSZXBvcnQocGx1Z2lucywge2NtZCwgY21kSGFuZGxlZEJ5fSkge1xuICAgIGlmICghcGx1Z2lucy5sZW5ndGgpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBhdCB0aGUgZW5kIG9mIHRoZSBkYXksIHdlIGhhdmUgYW4gb2JqZWN0IHJlcHJlc2VudGluZyB3aGljaCBwbHVnaW5zIGVuZGVkIHVwIGdldHRpbmdcbiAgICAvLyB0aGVpciBjb2RlIHJ1biBhcyBwYXJ0IG9mIGhhbmRsaW5nIHRoaXMgY29tbWFuZC4gQmVjYXVzZSBwbHVnaW5zIGNhbiBjaG9vc2UgKm5vdCogdG9cbiAgICAvLyBwYXNzIGNvbnRyb2wgdG8gb3RoZXIgcGx1Z2lucyBvciB0byB0aGUgZGVmYXVsdCBkcml2ZXIgYmVoYXZpb3IsIHRoaXMgaXMgaW5mb3JtYXRpb25cbiAgICAvLyB3aGljaCBpcyBwcm9iYWJseSB1c2VmdWwgdG8gdGhlIHVzZXIgKGVzcGVjaWFsbHkgaW4gc2l0dWF0aW9ucyB3aGVyZSBwbHVnaW5zIG1pZ2h0IG5vdFxuICAgIC8vIGludGVyYWN0IHdlbGwgdG9nZXRoZXIsIGFuZCBpdCB3b3VsZCBiZSBoYXJkIHRvIGRlYnVnIG90aGVyd2lzZSB3aXRob3V0IHRoaXMga2luZCBvZlxuICAgIC8vIG1lc3NhZ2UpLlxuICAgIGNvbnN0IGRpZEhhbmRsZSA9IE9iamVjdC5rZXlzKGNtZEhhbmRsZWRCeSkuZmlsdGVyKChrKSA9PiBjbWRIYW5kbGVkQnlba10pO1xuICAgIGNvbnN0IGRpZG50SGFuZGxlID0gT2JqZWN0LmtleXMoY21kSGFuZGxlZEJ5KS5maWx0ZXIoKGspID0+ICFjbWRIYW5kbGVkQnlba10pO1xuICAgIGlmIChkaWRudEhhbmRsZS5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmxvZy5pbmZvKFxuICAgICAgICBgQ29tbWFuZCAnJHtjbWR9JyB3YXMgKm5vdCogaGFuZGxlZCBieSB0aGUgZm9sbG93aW5nIGJlaGF2aW91cnMgb3IgcGx1Z2lucywgZXZlbiBgICtcbiAgICAgICAgICBgdGhvdWdoIHRoZXkgd2VyZSByZWdpc3RlcmVkIHRvIGhhbmRsZSBpdDogJHtKU09OLnN0cmluZ2lmeShkaWRudEhhbmRsZSl9LiBUaGUgYCArXG4gICAgICAgICAgYGNvbW1hbmQgKndhcyogaGFuZGxlZCBieSB0aGVzZTogJHtKU09OLnN0cmluZ2lmeShkaWRIYW5kbGUpfS5gXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGV4ZWN1dGVXcmFwcGVkQ29tbWFuZCh7d3JhcHBlZENtZCwgcHJvdG9jb2x9KSB7XG4gICAgbGV0IGNtZFJlcyxcbiAgICAgIGNtZEVycixcbiAgICAgIHJlcyA9IHt9O1xuICAgIHRyeSB7XG4gICAgICAvLyBBdCB0aGlzIHBvaW50LCBgd3JhcHBlZENtZGAgZGVmaW5lcyBhIHdob2xlIHNlcXVlbmNlIG9mIHBsdWdpbiBoYW5kbGVycywgY3VsbWluYXRpbmcgaW5cbiAgICAgIC8vIG91ciBkZWZhdWx0IGhhbmRsZXIuIFdoYXRldmVyIGl0IHJldHVybnMgaXMgd2hhdCB3ZSdyZSBnb2luZyB0byB3YW50IHRvIHNlbmQgYmFjayB0byB0aGVcbiAgICAgIC8vIHVzZXIuXG4gICAgICBjbWRSZXMgPSBhd2FpdCB3cmFwcGVkQ21kKCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY21kRXJyID0gZTtcbiAgICB9XG5cbiAgICAvLyBTYWRseSwgd2UgZG9uJ3Qga25vdyBleGFjdGx5IHdoYXQga2luZCBvZiBvYmplY3Qgd2lsbCBiZSByZXR1cm5lZC4gSXQgd2lsbCBlaXRoZXIgYmUgYSBiYXJlXG4gICAgLy8gb2JqZWN0LCBvciBhIHByb3RvY29sLWF3YXJlIG9iamVjdCB3aXRoIHByb3RvY29sIGFuZCBlcnJvci92YWx1ZSBrZXlzLiBTbyB3ZSBuZWVkIHRvIHNuaWZmXG4gICAgLy8gaXQgYW5kIG1ha2Ugc3VyZSB3ZSBkb24ndCBkb3VibGUtd3JhcCBpdCBpZiBpdCdzIHRoZSBsYXR0ZXIga2luZC5cbiAgICBpZiAoXy5pc1BsYWluT2JqZWN0KGNtZFJlcykgJiYgXy5oYXMoY21kUmVzLCAncHJvdG9jb2wnKSkge1xuICAgICAgcmVzID0gY21kUmVzO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXMudmFsdWUgPSBjbWRSZXM7XG4gICAgICByZXMuZXJyb3IgPSBjbWRFcnI7XG4gICAgICByZXMucHJvdG9jb2wgPSBwcm90b2NvbDtcbiAgICB9XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIHByb3h5QWN0aXZlKHNlc3Npb25JZCkge1xuICAgIGNvbnN0IGRzdFNlc3Npb24gPSB0aGlzLnNlc3Npb25zW3Nlc3Npb25JZF07XG4gICAgcmV0dXJuIGRzdFNlc3Npb24gJiYgXy5pc0Z1bmN0aW9uKGRzdFNlc3Npb24ucHJveHlBY3RpdmUpICYmIGRzdFNlc3Npb24ucHJveHlBY3RpdmUoc2Vzc2lvbklkKTtcbiAgfVxuXG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoJ0BhcHBpdW0vdHlwZXMnKS5Sb3V0ZU1hdGNoZXJbXX1cbiAgICovXG4gIGdldFByb3h5QXZvaWRMaXN0KHNlc3Npb25JZCkge1xuICAgIGNvbnN0IGRzdFNlc3Npb24gPSB0aGlzLnNlc3Npb25zW3Nlc3Npb25JZF07XG4gICAgcmV0dXJuIGRzdFNlc3Npb24gPyBkc3RTZXNzaW9uLmdldFByb3h5QXZvaWRMaXN0KCkgOiBbXTtcbiAgfVxuXG4gIGNhblByb3h5KHNlc3Npb25JZCkge1xuICAgIGNvbnN0IGRzdFNlc3Npb24gPSB0aGlzLnNlc3Npb25zW3Nlc3Npb25JZF07XG4gICAgcmV0dXJuIGRzdFNlc3Npb24gJiYgZHN0U2Vzc2lvbi5jYW5Qcm94eShzZXNzaW9uSWQpO1xuICB9XG59XG5cbi8vIGhlbHAgZGVjaWRlIHdoaWNoIGNvbW1hbmRzIHNob3VsZCBiZSBwcm94aWVkIHRvIHN1Yi1kcml2ZXJzIGFuZCB3aGljaFxuLy8gc2hvdWxkIGJlIGhhbmRsZWQgYnkgdGhpcywgb3VyIHVtYnJlbGxhIGRyaXZlclxuZnVuY3Rpb24gaXNBcHBpdW1Ecml2ZXJDb21tYW5kKGNtZCkge1xuICByZXR1cm4gIWlzU2Vzc2lvbkNvbW1hbmQoY21kKSB8fCBjbWQgPT09IERFTEVURV9TRVNTSU9OX0NPTU1BTkQ7XG59XG5cbi8qKlxuICogVGhyb3duIHdoZW4gQXBwaXVtIHRyaWVkIHRvIHByb3h5IGEgY29tbWFuZCB1c2luZyBhIGRyaXZlcidzIGBwcm94eUNvbW1hbmRgIG1ldGhvZCBidXQgdGhlXG4gKiBtZXRob2QgZGlkIG5vdCBleGlzdFxuICovXG5leHBvcnQgY2xhc3MgTm9Ecml2ZXJQcm94eUNvbW1hbmRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIEB0eXBlIHtSZWFkb25seTxzdHJpbmc+fVxuICAgKi9cbiAgY29kZSA9ICdBUFBJVU1FUlJfTk9fRFJJVkVSX1BST1hZQ09NTUFORCc7XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoXG4gICAgICBgVGhlIGRlZmF1bHQgYmVoYXZpb3IgZm9yIHRoaXMgY29tbWFuZCB3YXMgdG8gcHJveHksIGJ1dCB0aGUgZHJpdmVyIGAgK1xuICAgICAgICBgZGlkIG5vdCBoYXZlIHRoZSAncHJveHlDb21tYW5kJyBtZXRob2QgZGVmaW5lZC4gVG8gZnVsbHkgc3VwcG9ydCBgICtcbiAgICAgICAgYHBsdWdpbnMsIGRyaXZlcnMgc2hvdWxkIGhhdmUgJ3Byb3h5Q29tbWFuZCcgc2V0IHRvIGEgandwUHJveHkgb2JqZWN0J3MgYCArXG4gICAgICAgIGAnY29tbWFuZCgpJyBtZXRob2QsIGluIGFkZGl0aW9uIHRvIHRoZSBub3JtYWwgJ3Byb3h5UmVxUmVzJ2BcbiAgICApO1xuICB9XG59XG5cbmV4cG9ydCB7QXBwaXVtRHJpdmVyfTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdAYXBwaXVtL3R5cGVzJykuRXh0ZXJuYWxEcml2ZXJ9IEV4dGVybmFsRHJpdmVyXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdAYXBwaXVtL3R5cGVzJykuRHJpdmVyfSBEcml2ZXJcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJ0BhcHBpdW0vdHlwZXMnKS5Ecml2ZXJDbGFzc30gRHJpdmVyQ2xhc3NcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJ0BhcHBpdW0vdHlwZXMnKS5Ecml2ZXJEYXRhfSBEcml2ZXJEYXRhXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdAYXBwaXVtL3R5cGVzJykuU2VydmVyQXJnc30gRHJpdmVyT3B0c1xuICogQHR5cGVkZWYge2ltcG9ydCgnQGFwcGl1bS90eXBlcycpLkNvbnN0cmFpbnRzfSBDb25zdHJhaW50c1xuICogQHR5cGVkZWYge2ltcG9ydCgnQGFwcGl1bS90eXBlcycpLkFwcGl1bVNlcnZlcn0gQXBwaXVtU2VydmVyXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdAYXBwaXVtL3R5cGVzJykuRXh0ZW5zaW9uVHlwZX0gRXh0ZW5zaW9uVHlwZVxuICogQHR5cGVkZWYge2ltcG9ydCgnLi9leHRlbnNpb24vZHJpdmVyLWNvbmZpZycpLkRyaXZlckNvbmZpZ30gRHJpdmVyQ29uZmlnXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdAYXBwaXVtL3R5cGVzJykuUGx1Z2lufSBQbHVnaW5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoJ0BhcHBpdW0vdHlwZXMnKS5QbHVnaW5DbGFzc30gUGx1Z2luQ2xhc3NcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJ0BhcHBpdW0vdHlwZXMnKS5QbHVnaW5UeXBlfSBQbHVnaW5UeXBlXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdAYXBwaXVtL3R5cGVzJykuRHJpdmVyVHlwZX0gRHJpdmVyVHlwZVxuICogQHR5cGVkZWYge2ltcG9ydCgnQGFwcGl1bS90eXBlcycpLlN0cmluZ1JlY29yZH0gU3RyaW5nUmVjb3JkXG4gKiBAdHlwZWRlZiB7aW1wb3J0KCdAYXBwaXVtL3R5cGVzJykuU2Vzc2lvbkhhbmRsZXI8U2Vzc2lvbkhhbmRsZXJSZXN1bHQ8YW55W10+LFNlc3Npb25IYW5kbGVyUmVzdWx0PHZvaWQ+Pn0gU2Vzc2lvbkhhbmRsZXJcbiAqL1xuXG4vKipcbiAqIFVzZWQgYnkge0BsaW5rY29kZSBBcHBpdW1Ecml2ZXIuY3JlYXRlU2Vzc2lvbn0gYW5kIHtAbGlua2NvZGUgQXBwaXVtRHJpdmVyLmRlbGV0ZVNlc3Npb259IHRvIGRlc2NyaWJlXG4gKiByZXN1bHQuXG4gKiBAdGVtcGxhdGUgVlxuICogQHR5cGVkZWYgU2Vzc2lvbkhhbmRsZXJSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7Vn0gW3ZhbHVlXVxuICogQHByb3BlcnR5IHtFcnJvcn0gW2Vycm9yXVxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtwcm90b2NvbF1cbiAqL1xuXG4vKipcbiAqIEB0ZW1wbGF0ZSB7Q29uc3RyYWludHN9IENcbiAqIEB0eXBlZGVmIHtpbXBvcnQoJ0BhcHBpdW0vdHlwZXMnKS5XM0NDYXBhYmlsaXRpZXM8Qz59IFczQ0NhcGFiaWxpdGllc1xuICovXG5cbi8qKlxuICogQHRlbXBsYXRlIHtDb25zdHJhaW50c30gQ1xuICogQHR5cGVkZWYge2ltcG9ydCgnQGFwcGl1bS90eXBlcycpLkNhcGFiaWxpdGllczxDPn0gQ2FwYWJpbGl0aWVzXG4gKi9cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBU0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7QUFFQSxNQUFNQSw0QkFBNEIsR0FBeUI7RUFDekRDLGNBQWMsRUFBRTtJQUNkQyxRQUFRLEVBQUUsSUFESTtJQUVkQyxRQUFRLEVBQUU7RUFGSSxDQUR5QztFQUt6REMsWUFBWSxFQUFFO0lBQ1pGLFFBQVEsRUFBRSxJQURFO0lBRVpDLFFBQVEsRUFBRTtFQUZFO0FBTDJDLENBQTNEO0FBY0EsTUFBTUUsaUJBQWlCLEdBQUcsSUFBSUMsa0JBQUosRUFBMUI7QUFDQSxNQUFNQyxtQkFBbUIsR0FBRyxJQUFJRCxrQkFBSixFQUE1Qjs7QUFLQSxNQUFNRSxZQUFOLFNBQTJCQyxzQkFBM0IsQ0FBc0M7RUFPcENDLFFBQVEsR0FBRyxFQUFIO0VBUVJDLGNBQWMsR0FBRyxFQUFIO0VBT2RDLG1CQUFtQixHQUFHLENBQUg7RUFNbkJDLGFBQWE7RUFNYkMsY0FBYyxHQUFHLEVBQUg7RUFNZEMsa0JBQWtCLEdBQUcsRUFBSDtFQUdsQkMsWUFBWTtFQUdaQyxNQUFNO0VBRU5DLHFCQUFxQixHQUFHbEIsNEJBQUg7RUFHckJtQixJQUFJOztFQUtKQyxXQUFXLENBQUNDLElBQUQsRUFBTztJQUtoQixJQUFJQSxJQUFJLENBQUNDLE1BQVQsRUFBaUI7TUFDZkMsT0FBTyxDQUFDQyxHQUFSLENBQVlDLGNBQVosR0FBNkJKLElBQUksQ0FBQ0MsTUFBbEM7SUFDRDs7SUFFRCxNQUFNRCxJQUFOO0lBRUEsS0FBS0YsSUFBTCxHQUFZLEVBQUMsR0FBR0U7SUFBSixDQUFaOztJQUdBLENBQUMsWUFB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