import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import {
  Freestyle as FreestyleSdk,
  FreestyleApiError,
  type CreateSnapshotOptions,
  type CreateVmOptions,
  type ExecOptions,
  type FreestyleOptions,
  type ResizeVmOptions,
  type UpdateVmOptions,
  type VmData,
} from "freestyle";
import type { ComponentApi } from "../component/_generated/component.js";

export const MANAGEMENT_TOKEN_METADATA_KEY = "convex_component_id";

export type ManagedCreateVmOptions = Omit<CreateVmOptions, "slug"> & {
  ownerId: string;
  slug: string;
};

export type ManagedUpdateVmOptions = Omit<
  UpdateVmOptions,
  "reassignSlug" | "slug"
>;

export interface FreestyleComponentOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

type ReadCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type MutationCtx = Pick<
  GenericMutationCtx<GenericDataModel>,
  "runMutation" | "runQuery"
>;
type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runMutation" | "runQuery"
>;

type ManagedRecord = NonNullable<Awaited<ReturnType<Freestyle["get"]>>>;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 4_000);
}

function remoteSummary(vm: VmData) {
  return {
    createdAt: vm.createdAt,
    id: vm.id,
    resources: vm.resources,
    state: vm.state,
    updatedAt: vm.updatedAt,
    ...(vm.displayName !== undefined ? { displayName: vm.displayName } : {}),
    ...(vm.idleTimeoutSeconds !== undefined
      ? { idleTimeoutSeconds: vm.idleTimeoutSeconds }
      : {}),
    ...(vm.slug !== undefined ? { slug: vm.slug } : {}),
    ...(vm.snapshotId !== undefined ? { snapshotId: vm.snapshotId } : {}),
  };
}

/**
 * Convex-side manager for Freestyle VMs.
 *
 * Keep this instance in the consuming app's `convex/` directory and call its
 * mutating methods only from actions. The consuming app owns authentication;
 * pass an authenticated tenant or user id as `ownerId` instead of accepting an
 * owner id directly from a client.
 */
export class Freestyle {
  private sdkInstance: FreestyleSdk | undefined;

  constructor(
    public readonly component: ComponentApi,
    private readonly options: FreestyleComponentOptions = {},
  ) {}

  private sdk(): FreestyleSdk {
    if (this.sdkInstance) return this.sdkInstance;
    const apiKey = this.options.apiKey ?? process.env.FREESTYLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing FREESTYLE_API_KEY. Set it in Convex or pass apiKey to the Freestyle constructor.",
      );
    }
    const sdkOptions: FreestyleOptions = {
      apiKey,
      baseUrl: this.options.baseUrl,
      fetch: this.options.fetch,
    };
    this.sdkInstance = new FreestyleSdk(sdkOptions);
    return this.sdkInstance;
  }

  async get(
    ctx: ReadCtx | MutationCtx | ActionCtx,
    args: { ownerId: string; slug: string },
  ) {
    return await ctx.runQuery(this.component.vms.get, args);
  }

  async list(
    ctx: ReadCtx | MutationCtx | ActionCtx,
    args: { ownerId: string; limit?: number },
  ) {
    return await ctx.runQuery(this.component.vms.list, args);
  }

  async create(ctx: ActionCtx, args: ManagedCreateVmOptions) {
    if (args.slug.trim().length === 0)
      throw new Error("slug must not be empty");
    if (args.ownerId.trim().length === 0) {
      throw new Error("ownerId must not be empty");
    }

    const proposedToken = crypto.randomUUID();
    const record = await ctx.runMutation(this.component.vms.reserve, {
      managementToken: proposedToken,
      ownerId: args.ownerId,
      slug: args.slug,
    });

    if (record.vmId) {
      try {
        const remote = await this.sdk().vms.get(record.vmId);
        const synced = await this.sync(ctx, record, remote);
        return { record: synced, vm: remote };
      } catch (error) {
        await this.recordFailure(ctx, record, error);
        throw error;
      }
    }

    let remote: VmData;
    try {
      const { ownerId: _ownerId, ...createOptions } = args;
      const created = await this.sdk().vms.create({
        ...createOptions,
        metadata: {
          ...createOptions.metadata,
          [MANAGEMENT_TOKEN_METADATA_KEY]: record.managementToken,
        },
      });
      remote = created.data;
    } catch (error) {
      if (error instanceof FreestyleApiError && error.status === 409) {
        let existing: VmData;
        try {
          existing = await this.sdk().vms.get(args.slug);
        } catch {
          await this.recordFailure(ctx, record, error);
          throw error;
        }
        if (
          existing.metadata[MANAGEMENT_TOKEN_METADATA_KEY] ===
          record.managementToken
        ) {
          remote = existing;
        } else {
          await this.recordFailure(ctx, record, error);
          throw new Error(
            `A Freestyle VM already uses slug ${JSON.stringify(args.slug)} and is not managed by this component record.`,
          );
        }
      } else {
        await this.recordFailure(ctx, record, error);
        throw error;
      }
    }

    const linked = await ctx.runMutation(this.component.vms.completeCreate, {
      managementToken: record.managementToken,
      recordId: record._id,
      remote: remoteSummary(remote),
    });
    return { record: linked, vm: remote };
  }

  async refresh(ctx: ActionCtx, args: { ownerId: string; slug: string }) {
    return await this.withVm(ctx, args, async (vm) => await vm.data());
  }

  async start(ctx: ActionCtx, args: { ownerId: string; slug: string }) {
    return await this.withVm(ctx, args, async (vm) => await vm.start());
  }

  async pause(ctx: ActionCtx, args: { ownerId: string; slug: string }) {
    return await this.withVm(ctx, args, async (vm) => await vm.pause());
  }

  async resize(
    ctx: ActionCtx,
    args: { ownerId: string; slug: string; options: ResizeVmOptions },
  ) {
    return await this.withVm(ctx, args, async (vm) => vm.resize(args.options));
  }

  async update(
    ctx: ActionCtx,
    args: { ownerId: string; slug: string; options: ManagedUpdateVmOptions },
  ) {
    return await this.withVm(ctx, args, async (vm, record) => {
      const metadata = args.options.metadata
        ? {
            ...args.options.metadata,
            [MANAGEMENT_TOKEN_METADATA_KEY]: record.managementToken,
          }
        : undefined;
      return await vm.update({ ...args.options, metadata });
    });
  }

  async exec(
    ctx: ActionCtx,
    args: {
      ownerId: string;
      slug: string;
      options: string | ExecOptions;
    },
  ) {
    const record = await this.requireRecord(ctx, args);
    try {
      return await this.sdk().vms.ref(record.vmId).exec(args.options);
    } catch (error) {
      await this.recordFailure(ctx, record, error);
      throw error;
    }
  }

  async snapshot(
    ctx: ActionCtx,
    args: {
      ownerId: string;
      slug: string;
      options?: CreateSnapshotOptions;
    },
  ) {
    const record = await this.requireRecord(ctx, args);
    try {
      return await this.sdk()
        .vms.ref(record.vmId)
        .snapshot(args.options ?? {});
    } catch (error) {
      await this.recordFailure(ctx, record, error);
      throw error;
    }
  }

  async delete(
    ctx: ActionCtx,
    args: { ownerId: string; slug: string },
  ): Promise<void> {
    const record = await this.get(ctx, args);
    if (!record) return;
    if (!record.vmId) {
      throw new Error(
        `Freestyle VM ${JSON.stringify(args.slug)} is still provisioning`,
      );
    }

    try {
      await this.sdk().vms.delete(record.vmId);
    } catch (error) {
      if (!(error instanceof FreestyleApiError && error.status === 404)) {
        await this.recordFailure(ctx, record, error);
        throw error;
      }
    }
    await ctx.runMutation(this.component.vms.remove, {
      recordId: record._id,
      vmId: record.vmId,
    });
  }

  private async requireRecord(
    ctx: ActionCtx,
    args: { ownerId: string; slug: string },
  ): Promise<ManagedRecord & { vmId: string }> {
    const record = await this.get(ctx, args);
    if (!record) {
      throw new Error(
        `No managed Freestyle VM found for ${JSON.stringify(args.slug)}`,
      );
    }
    if (!record.vmId) {
      throw new Error(
        `Freestyle VM ${JSON.stringify(args.slug)} is still provisioning`,
      );
    }
    return record as ManagedRecord & { vmId: string };
  }

  private async withVm(
    ctx: ActionCtx,
    args: { ownerId: string; slug: string },
    operation: (
      vm: ReturnType<FreestyleSdk["vms"]["ref"]>,
      record: ManagedRecord & { vmId: string },
    ) => Promise<VmData>,
  ) {
    const record = await this.requireRecord(ctx, args);
    try {
      const remote = await operation(this.sdk().vms.ref(record.vmId), record);
      const synced = await this.sync(ctx, record, remote);
      return { record: synced, vm: remote };
    } catch (error) {
      await this.recordFailure(ctx, record, error);
      throw error;
    }
  }

  private async sync(ctx: ActionCtx, record: ManagedRecord, remote: VmData) {
    if (!record.vmId) throw new Error("Cannot sync an unlinked VM record");
    return await ctx.runMutation(this.component.vms.sync, {
      recordId: record._id,
      remote: remoteSummary(remote),
      vmId: record.vmId,
    });
  }

  private async recordFailure(
    ctx: ActionCtx,
    record: ManagedRecord,
    error: unknown,
  ): Promise<void> {
    await ctx.runMutation(this.component.vms.recordFailure, {
      error: errorMessage(error),
      recordId: record._id,
      ...(record.vmId !== undefined ? { vmId: record.vmId } : {}),
    });
  }
}

export type {
  CreateSnapshotOptions,
  CreateVmOptions,
  ExecOptions,
  ResizeVmOptions,
  UpdateVmOptions,
  VmData,
} from "freestyle";
