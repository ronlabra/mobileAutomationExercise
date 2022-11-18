export type StringRecord = import('@appium/types').StringRecord;
export type BaseDriverCapConstraints = import('@appium/types').BaseDriverCapConstraints;
export type ParsedDriverCaps<C extends Readonly<Record<string, import("@appium/types").Constraint>> = {
    readonly platformName: {
        readonly presence: true;
        readonly isString: true;
    };
    readonly app: {
        readonly isString: true;
    };
    readonly deviceName: {
        readonly isString: true;
    };
    readonly platformVersion: {
        readonly isString: true;
    };
    readonly newCommandTimeout: {
        readonly isNumber: true;
    };
    readonly automationName: {
        readonly isString: true;
    };
    readonly autoLaunch: {
        readonly isBoolean: true;
    };
    readonly udid: {
        readonly isString: true;
    };
    readonly orientation: {
        readonly inclusion: readonly ["LANDSCAPE", "PORTRAIT"];
    };
    readonly autoWebview: {
        readonly isBoolean: true;
    };
    readonly noReset: {
        readonly isBoolean: true;
    };
    readonly fullReset: {
        readonly isBoolean: true;
    };
    readonly language: {
        readonly isString: true;
    };
    readonly locale: {
        readonly isString: true;
    };
    readonly eventTimings: {
        readonly isBoolean: true;
    };
    readonly printPageSourceOnFindFailure: {
        readonly isBoolean: true;
    };
}, J = any> = {
    desiredCaps: Capabilities<C>;
    protocol: string;
    processedJsonwpCapabilities?: J | undefined;
    processedW3CCapabilities?: W3CCapabilities<C, void> | undefined;
};
export type InvalidCaps<C extends Readonly<Record<string, import("@appium/types").Constraint>> = {
    readonly platformName: {
        readonly presence: true;
        readonly isString: true;
    };
    readonly app: {
        readonly isString: true;
    };
    readonly deviceName: {
        readonly isString: true;
    };
    readonly platformVersion: {
        readonly isString: true;
    };
    readonly newCommandTimeout: {
        readonly isNumber: true;
    };
    readonly automationName: {
        readonly isString: true;
    };
    readonly autoLaunch: {
        readonly isBoolean: true;
    };
    readonly udid: {
        readonly isString: true;
    };
    readonly orientation: {
        readonly inclusion: readonly ["LANDSCAPE", "PORTRAIT"];
    };
    readonly autoWebview: {
        readonly isBoolean: true;
    };
    readonly noReset: {
        readonly isBoolean: true;
    };
    readonly fullReset: {
        readonly isBoolean: true;
    };
    readonly language: {
        readonly isString: true;
    };
    readonly locale: {
        readonly isString: true;
    };
    readonly eventTimings: {
        readonly isBoolean: true;
    };
    readonly printPageSourceOnFindFailure: {
        readonly isBoolean: true;
    };
}, J = any> = {
    error: Error;
    protocol: string;
    desiredCaps?: Partial<import("@appium/types").ConstraintsToCaps<C> & void> | undefined;
    processedJsonwpCapabilities?: J | undefined;
    processedW3CCapabilities?: W3CCapabilities<C, void> | undefined;
};
export type Capabilities<C extends Readonly<Record<string, import("@appium/types").Constraint>> = {
    readonly platformName: {
        readonly presence: true;
        readonly isString: true;
    };
    readonly app: {
        readonly isString: true;
    };
    readonly deviceName: {
        readonly isString: true;
    };
    readonly platformVersion: {
        readonly isString: true;
    };
    readonly newCommandTimeout: {
        readonly isNumber: true;
    };
    readonly automationName: {
        readonly isString: true;
    };
    readonly autoLaunch: {
        readonly isBoolean: true;
    };
    readonly udid: {
        readonly isString: true;
    };
    readonly orientation: {
        readonly inclusion: readonly ["LANDSCAPE", "PORTRAIT"];
    };
    readonly autoWebview: {
        readonly isBoolean: true;
    };
    readonly noReset: {
        readonly isBoolean: true;
    };
    readonly fullReset: {
        readonly isBoolean: true;
    };
    readonly language: {
        readonly isString: true;
    };
    readonly locale: {
        readonly isString: true;
    };
    readonly eventTimings: {
        readonly isBoolean: true;
    };
    readonly printPageSourceOnFindFailure: {
        readonly isBoolean: true;
    };
}, Extra extends void | import("@appium/types").StringRecord = void> = import('@appium/types').Capabilities<C, Extra>;
export type W3CCapabilities<C extends Readonly<Record<string, import("@appium/types").Constraint>> = {
    readonly platformName: {
        readonly presence: true;
        readonly isString: true;
    };
    readonly app: {
        readonly isString: true;
    };
    readonly deviceName: {
        readonly isString: true;
    };
    readonly platformVersion: {
        readonly isString: true;
    };
    readonly newCommandTimeout: {
        readonly isNumber: true;
    };
    readonly automationName: {
        readonly isString: true;
    };
    readonly autoLaunch: {
        readonly isBoolean: true;
    };
    readonly udid: {
        readonly isString: true;
    };
    readonly orientation: {
        readonly inclusion: readonly ["LANDSCAPE", "PORTRAIT"];
    };
    readonly autoWebview: {
        readonly isBoolean: true;
    };
    readonly noReset: {
        readonly isBoolean: true;
    };
    readonly fullReset: {
        readonly isBoolean: true;
    };
    readonly language: {
        readonly isString: true;
    };
    readonly locale: {
        readonly isString: true;
    };
    readonly eventTimings: {
        readonly isBoolean: true;
    };
    readonly printPageSourceOnFindFailure: {
        readonly isBoolean: true;
    };
}, Extra extends void | import("@appium/types").StringRecord = void> = import('@appium/types').W3CCapabilities<C, Extra>;
export type NSCapabilities<C extends Readonly<Record<string, import("@appium/types").Constraint>> = {
    readonly platformName: {
        readonly presence: true;
        readonly isString: true;
    };
    readonly app: {
        readonly isString: true;
    };
    readonly deviceName: {
        readonly isString: true;
    };
    readonly platformVersion: {
        readonly isString: true;
    };
    readonly newCommandTimeout: {
        readonly isNumber: true;
    };
    readonly automationName: {
        readonly isString: true;
    };
    readonly autoLaunch: {
        readonly isBoolean: true;
    };
    readonly udid: {
        readonly isString: true;
    };
    readonly orientation: {
        readonly inclusion: readonly ["LANDSCAPE", "PORTRAIT"];
    };
    readonly autoWebview: {
        readonly isBoolean: true;
    };
    readonly noReset: {
        readonly isBoolean: true;
    };
    readonly fullReset: {
        readonly isBoolean: true;
    };
    readonly language: {
        readonly isString: true;
    };
    readonly locale: {
        readonly isString: true;
    };
    readonly eventTimings: {
        readonly isBoolean: true;
    };
    readonly printPageSourceOnFindFailure: {
        readonly isBoolean: true;
    };
}, Extra extends void | import("@appium/types").StringRecord = void> = import('@appium/types').NSCapabilities<C, Extra>;
export type ConstraintsToCaps<C extends Readonly<Record<string, import("@appium/types").Constraint>>> = import('@appium/types').ConstraintsToCaps<C>;
export type StringKeyOf<T> = import('type-fest').StringKeyOf<T>;
export type Constraints = import('@appium/types').Constraints;
/**
 * Dumps to value to the console using `info` logger.
 *
 * @todo May want to force color to be `false` if {@link isStdoutTTY} is `false`.
 */
export const inspect: (t1: any) => void;
/**
 * Takes the caps that were provided in the request and translates them
 * into caps that can be used by the inner drivers.
 *
 * @template {Constraints} C
 * @template [J=any]
 * @param {J} jsonwpCapabilities
 * @param {W3CCapabilities<C>} w3cCapabilities
 * @param {C} constraints
 * @param {NSCapabilities<C>} [defaultCapabilities]
 * @returns {ParsedDriverCaps<C,J>|InvalidCaps<C,J>}
 */
export function parseCapsForInnerDriver<C extends Readonly<Record<string, import("@appium/types").Constraint>>, J = any>(jsonwpCapabilities: J, w3cCapabilities: W3CCapabilities<C, void>, constraints?: C, defaultCapabilities?: Partial<import("@appium/types").CapsToNSCaps<import("@appium/types").ConstraintsToCaps<C> & void, "appium">> | undefined): ParsedDriverCaps<C, J> | InvalidCaps<C, J>;
/**
 * Takes a capabilities objects and prefixes capabilities with `appium:`
 * @template {Constraints} [C={}]
 * @param {Capabilities<C>} caps - Desired capabilities object
 * @returns {NSCapabilities<C>}
 */
export function insertAppiumPrefixes<C extends Readonly<Record<string, import("@appium/types").Constraint>> = {}>(caps: Partial<import("@appium/types").ConstraintsToCaps<C> & void>): Partial<import("@appium/types").CapsToNSCaps<import("@appium/types").ConstraintsToCaps<C> & void, "appium">>;
/**
 *
 * @param {string} pkgName
 * @returns {string|undefined}
 */
export function getPackageVersion(pkgName: string): string | undefined;
/**
 * Pulls the initial values of Appium settings from the given capabilities argument.
 * Each setting item must satisfy the following format:
 * `setting[setting_name]: setting_value`
 * The capabilities argument itself gets mutated, so it does not contain parsed
 * settings anymore to avoid further parsing issues.
 * Check
 * https://github.com/appium/appium/blob/master/docs/en/advanced-concepts/settings.md
 * for more details on the available settings.
 *
 * @param {?Object} caps - Capabilities dictionary. It is mutated if
 * one or more settings have been pulled from it
 * @return {Object} - An empty dictionary if the given caps contains no
 * setting items or a dictionary containing parsed Appium setting names along with
 * their values.
 */
export function pullSettings(caps: any | null): any;
/**
 * @template {Constraints} [C={}]
 * @param {NSCapabilities<C>} caps
 * @returns {Capabilities<C>}
 */
export function removeAppiumPrefixes<C extends Readonly<Record<string, import("@appium/types").Constraint>> = {}>(caps: Partial<import("@appium/types").CapsToNSCaps<import("@appium/types").ConstraintsToCaps<C> & void, "appium">>): Partial<import("@appium/types").ConstraintsToCaps<C> & void>;
/**
 * Adjusts NODE_PATH environment variable,
 * so drivers and plugins could load their peer dependencies.
 * Read https://nodejs.org/api/modules.html#loading-from-the-global-folders
 * for more details.
 * @returns {void}
 */
export function adjustNodePath(): void;
//# sourceMappingURL=utils.d.ts.map