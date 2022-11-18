export const commandClasses: Readonly<{
    readonly driver: typeof DriverCommand;
    readonly plugin: typeof PluginCommand;
}>;
export type ExtCommand<ExtType extends import("@appium/types").ExtensionType> = ExtType extends DriverType ? Class<DriverCommand> : ExtType extends PluginType ? Class<PluginCommand> : never;
export type ExtensionType = import('@appium/types').ExtensionType;
export type DriverType = import('@appium/types').DriverType;
export type PluginType = import('@appium/types').PluginType;
export type Class<T> = import('@appium/types').Class<T>;
/**
 * Run a subcommand of the 'appium driver' type. Each subcommand has its own set of arguments which
 * can be represented as a JS object.
 *
 * @param {import('appium/types').Args<import('appium/types').WithExtSubcommand>} args - JS object where the key is the parameter name (as defined in
 * driver-parser.js)
 * @template {ExtensionType} ExtType
 * @param {import('../extension/extension-config').ExtensionConfig<ExtType>} config - Extension config object
 */
export function runExtensionCommand<ExtType extends import("@appium/types").ExtensionType>(args: import('appium/types').Args<import('appium/types').WithExtSubcommand>, config: import("../extension/extension-config").ExtensionConfig<ExtType>): Promise<any>;
import DriverCommand from "./driver-command";
import PluginCommand from "./plugin-command";
//# sourceMappingURL=extension.d.ts.map