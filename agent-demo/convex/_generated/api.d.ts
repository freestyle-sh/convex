/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as approvals from "../approvals.js";
import type * as artifacts from "../artifacts.js";
import type * as connectionChecks from "../connectionChecks.js";
import type * as connectionStore from "../connectionStore.js";
import type * as connections from "../connections.js";
import type * as crons from "../crons.js";
import type * as execute from "../execute.js";
import type * as http from "../http.js";
import type * as investigate from "../investigate.js";
import type * as lib_artifacts from "../lib/artifacts.js";
import type * as lib_command from "../lib/command.js";
import type * as lib_commandSandbox from "../lib/commandSandbox.js";
import type * as lib_credentials from "../lib/credentials.js";
import type * as lib_documentPatch from "../lib/documentPatch.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_gateway from "../lib/gateway.js";
import type * as lib_jupyterKernel from "../lib/jupyterKernel.js";
import type * as lib_languageModel from "../lib/languageModel.js";
import type * as lib_modelWait from "../lib/modelWait.js";
import type * as lib_models from "../lib/models.js";
import type * as lib_networkCleanup from "../lib/networkCleanup.js";
import type * as lib_notebook from "../lib/notebook.js";
import type * as lib_notebookAccess from "../lib/notebookAccess.js";
import type * as lib_notebookImage from "../lib/notebookImage.js";
import type * as lib_notebookLifecycle from "../lib/notebookLifecycle.js";
import type * as lib_notebookNetwork from "../lib/notebookNetwork.js";
import type * as lib_operations from "../lib/operations.js";
import type * as lib_platform from "../lib/platform.js";
import type * as lib_policy from "../lib/policy.js";
import type * as lib_preparedNetwork from "../lib/preparedNetwork.js";
import type * as lib_resultSelection from "../lib/resultSelection.js";
import type * as lib_routeReadiness from "../lib/routeReadiness.js";
import type * as lib_runs from "../lib/runs.js";
import type * as lib_runtimeSettings from "../lib/runtimeSettings.js";
import type * as lib_sandbox from "../lib/sandbox.js";
import type * as lib_suggestions from "../lib/suggestions.js";
import type * as lib_timings from "../lib/timings.js";
import type * as lib_toolCredential from "../lib/toolCredential.js";
import type * as lib_workspaces from "../lib/workspaces.js";
import type * as models from "../models.js";
import type * as networkBundleRuntime from "../networkBundleRuntime.js";
import type * as networkBundles from "../networkBundles.js";
import type * as notebookImages from "../notebookImages.js";
import type * as notebookRuntime from "../notebookRuntime.js";
import type * as notebooks from "../notebooks.js";
import type * as projects from "../projects.js";
import type * as records from "../records.js";
import type * as retention from "../retention.js";
import type * as settings from "../settings.js";
import type * as suggestionGeneration from "../suggestionGeneration.js";
import type * as suggestions from "../suggestions.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  approvals: typeof approvals;
  artifacts: typeof artifacts;
  connectionChecks: typeof connectionChecks;
  connectionStore: typeof connectionStore;
  connections: typeof connections;
  crons: typeof crons;
  execute: typeof execute;
  http: typeof http;
  investigate: typeof investigate;
  "lib/artifacts": typeof lib_artifacts;
  "lib/command": typeof lib_command;
  "lib/commandSandbox": typeof lib_commandSandbox;
  "lib/credentials": typeof lib_credentials;
  "lib/documentPatch": typeof lib_documentPatch;
  "lib/events": typeof lib_events;
  "lib/gateway": typeof lib_gateway;
  "lib/jupyterKernel": typeof lib_jupyterKernel;
  "lib/languageModel": typeof lib_languageModel;
  "lib/modelWait": typeof lib_modelWait;
  "lib/models": typeof lib_models;
  "lib/networkCleanup": typeof lib_networkCleanup;
  "lib/notebook": typeof lib_notebook;
  "lib/notebookAccess": typeof lib_notebookAccess;
  "lib/notebookImage": typeof lib_notebookImage;
  "lib/notebookLifecycle": typeof lib_notebookLifecycle;
  "lib/notebookNetwork": typeof lib_notebookNetwork;
  "lib/operations": typeof lib_operations;
  "lib/platform": typeof lib_platform;
  "lib/policy": typeof lib_policy;
  "lib/preparedNetwork": typeof lib_preparedNetwork;
  "lib/resultSelection": typeof lib_resultSelection;
  "lib/routeReadiness": typeof lib_routeReadiness;
  "lib/runs": typeof lib_runs;
  "lib/runtimeSettings": typeof lib_runtimeSettings;
  "lib/sandbox": typeof lib_sandbox;
  "lib/suggestions": typeof lib_suggestions;
  "lib/timings": typeof lib_timings;
  "lib/toolCredential": typeof lib_toolCredential;
  "lib/workspaces": typeof lib_workspaces;
  models: typeof models;
  networkBundleRuntime: typeof networkBundleRuntime;
  networkBundles: typeof networkBundles;
  notebookImages: typeof notebookImages;
  notebookRuntime: typeof notebookRuntime;
  notebooks: typeof notebooks;
  projects: typeof projects;
  records: typeof records;
  retention: typeof retention;
  settings: typeof settings;
  suggestionGeneration: typeof suggestionGeneration;
  suggestions: typeof suggestions;
  workspaces: typeof workspaces;
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

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  crons: import("@convex-dev/crons/_generated/component.js").ComponentApi<"crons">;
  freestyle: import("@freestyle-sh/convex/_generated/component.js").ComponentApi<"freestyle">;
};
