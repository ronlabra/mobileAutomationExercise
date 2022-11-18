#!/usr/bin/env node
export { readConfigFile } from "./config-file";
export type DriverType = import('@appium/types').DriverType;
export type PluginType = import('@appium/types').PluginType;
export type DriverClass = import('@appium/types').DriverClass;
export type PluginClass = import('@appium/types').PluginClass;
export type WithServerSubcommand = import('appium/types').WithServerSubcommand;
export type DriverNameMap = import('./extension').DriverNameMap;
export type PluginNameMap = import('./extension').PluginNameMap;
/**
 * Literally an empty object
 */
export type ExtCommandInitResult = {};
export type ServerInitData = {
    /**
     * - The Appium driver
     */
    appiumDriver: import('./appium').AppiumDriver;
    /**
     * - The parsed arguments
     */
    parsedArgs: import('appium/types').ParsedArgs;
};
export type ServerInitResult = ServerInitData & import('./extension').ExtensionConfigs;
export type Args<T = import("appium/types").WithServerSubcommand> = import('appium/types').Args<T>;
export type ParsedArgs<T = import("appium/types").WithServerSubcommand> = import('appium/types').ParsedArgs<T>;
/**
 * Initializes Appium's config.  Starts server if appropriate and resolves the
 * server instance if so; otherwise resolves w/ `undefined`.
 * @template [T=WithServerSubcommand]
 * @param {Args<T>} [args] - Arguments from CLI or otherwise
 * @returns {Promise<import('@appium/types').AppiumServer|undefined>}
 */
export function main<T = import("appium/types").WithServerSubcommand>(args?: Args<T> | undefined): Promise<import('@appium/types').AppiumServer | undefined>;
/**
 * Initializes Appium, but does not start the server.
 *
 * Use this to get at the configuration schema.
 *
 * If `args` contains a non-empty `subcommand` which is not `server`, this function will return an empty object.
 *
 * @template [T=WithServerSubcommand]
 * @param {Args<T>} [args] - Partial args (progammatic usage only)
 * @returns {Promise<ServerInitResult | ExtCommandInitResult>}
 * @example
 * import {init, getSchema} from 'appium';
 * const options = {}; // config object
 * await init(options);
 * const schema = getSchema(); // entire config schema including plugins and drivers
 */
export function init<T = import("appium/types").WithServerSubcommand>(args?: Args<T> | undefined): Promise<ServerInitResult | ExtCommandInitResult>;
export const resolveAppiumHome: ((cwd?: string | undefined) => Promise<string>) & _.MemoizedFunction;
import _ from "lodash";
export { finalizeSchema, getSchema, validate } from "./schema/schema";
//# sourceMappingURL=main.d.ts.map