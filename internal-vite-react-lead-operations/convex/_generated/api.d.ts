/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminAnalytics from "../adminAnalytics.js";
import type * as adminIdentity from "../adminIdentity.js";
import type * as adminScouts from "../adminScouts.js";
import type * as auth from "../auth.js";
import type * as codexGateway from "../codexGateway.js";
import type * as hermesUpload from "../hermesUpload.js";
import type * as http from "../http.js";
import type * as leads from "../leads.js";
import type * as lib_cockroach from "../lib/cockroach.js";
import type * as lib_codexGateway from "../lib/codexGateway.js";
import type * as scoutAdmin from "../scoutAdmin.js";
import type * as scoutIdentity from "../scoutIdentity.js";
import type * as scouts from "../scouts.js";
import type * as simulations from "../simulations.js";
import type * as workEmails from "../workEmails.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminAnalytics: typeof adminAnalytics;
  adminIdentity: typeof adminIdentity;
  adminScouts: typeof adminScouts;
  auth: typeof auth;
  codexGateway: typeof codexGateway;
  hermesUpload: typeof hermesUpload;
  http: typeof http;
  leads: typeof leads;
  "lib/cockroach": typeof lib_cockroach;
  "lib/codexGateway": typeof lib_codexGateway;
  scoutAdmin: typeof scoutAdmin;
  scoutIdentity: typeof scoutIdentity;
  scouts: typeof scouts;
  simulations: typeof simulations;
  workEmails: typeof workEmails;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
