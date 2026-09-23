/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    vms: {
      completeCreate: FunctionReference<
        "mutation",
        "internal",
        {
          managementToken: string;
          recordId: string;
          remote: {
            createdAt: string;
            displayName?: string | null;
            id: string;
            idleTimeoutSeconds?: number | null;
            resources: { cpu: number; memory: number; storage: number };
            slug?: string | null;
            snapshotId?: string | null;
            state: "starting" | "running" | "pausing" | "paused" | "stopped";
            updatedAt: string;
          };
        },
        {
          _creationTime: number;
          _id: string;
          lastError?: string;
          managementToken: string;
          ownerId: string;
          phase: "provisioning" | "ready";
          remote?: {
            createdAt: string;
            displayName?: string | null;
            id: string;
            idleTimeoutSeconds?: number | null;
            resources: { cpu: number; memory: number; storage: number };
            slug?: string | null;
            snapshotId?: string | null;
            state: "starting" | "running" | "pausing" | "paused" | "stopped";
            updatedAt: string;
          };
          slug: string;
          updatedAt: number;
          vmId?: string;
        },
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { ownerId: string; slug: string },
        {
          _creationTime: number;
          _id: string;
          lastError?: string;
          managementToken: string;
          ownerId: string;
          phase: "provisioning" | "ready";
          remote?: {
            createdAt: string;
            displayName?: string | null;
            id: string;
            idleTimeoutSeconds?: number | null;
            resources: { cpu: number; memory: number; storage: number };
            slug?: string | null;
            snapshotId?: string | null;
            state: "starting" | "running" | "pausing" | "paused" | "stopped";
            updatedAt: string;
          };
          slug: string;
          updatedAt: number;
          vmId?: string;
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { limit?: number; ownerId: string },
        Array<{
          _creationTime: number;
          _id: string;
          lastError?: string;
          managementToken: string;
          ownerId: string;
          phase: "provisioning" | "ready";
          remote?: {
            createdAt: string;
            displayName?: string | null;
            id: string;
            idleTimeoutSeconds?: number | null;
            resources: { cpu: number; memory: number; storage: number };
            slug?: string | null;
            snapshotId?: string | null;
            state: "starting" | "running" | "pausing" | "paused" | "stopped";
            updatedAt: string;
          };
          slug: string;
          updatedAt: number;
          vmId?: string;
        }>,
        Name
      >;
      recordFailure: FunctionReference<
        "mutation",
        "internal",
        { error: string; recordId: string; vmId?: string },
        null,
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { recordId: string; vmId: string },
        null,
        Name
      >;
      reserve: FunctionReference<
        "mutation",
        "internal",
        { managementToken: string; ownerId: string; slug: string },
        {
          _creationTime: number;
          _id: string;
          lastError?: string;
          managementToken: string;
          ownerId: string;
          phase: "provisioning" | "ready";
          remote?: {
            createdAt: string;
            displayName?: string | null;
            id: string;
            idleTimeoutSeconds?: number | null;
            resources: { cpu: number; memory: number; storage: number };
            slug?: string | null;
            snapshotId?: string | null;
            state: "starting" | "running" | "pausing" | "paused" | "stopped";
            updatedAt: string;
          };
          slug: string;
          updatedAt: number;
          vmId?: string;
        },
        Name
      >;
      sync: FunctionReference<
        "mutation",
        "internal",
        {
          recordId: string;
          remote: {
            createdAt: string;
            displayName?: string | null;
            id: string;
            idleTimeoutSeconds?: number | null;
            resources: { cpu: number; memory: number; storage: number };
            slug?: string | null;
            snapshotId?: string | null;
            state: "starting" | "running" | "pausing" | "paused" | "stopped";
            updatedAt: string;
          };
          vmId: string;
        },
        {
          _creationTime: number;
          _id: string;
          lastError?: string;
          managementToken: string;
          ownerId: string;
          phase: "provisioning" | "ready";
          remote?: {
            createdAt: string;
            displayName?: string | null;
            id: string;
            idleTimeoutSeconds?: number | null;
            resources: { cpu: number; memory: number; storage: number };
            slug?: string | null;
            snapshotId?: string | null;
            state: "starting" | "running" | "pausing" | "paused" | "stopped";
            updatedAt: string;
          };
          slug: string;
          updatedAt: number;
          vmId?: string;
        },
        Name
      >;
    };
  };
