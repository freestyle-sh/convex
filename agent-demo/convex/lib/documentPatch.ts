import { z } from "zod";

const tableName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, "Choose an application table.");
const fieldName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/, "System fields cannot be edited.");
const valueState = z
  .object({ exists: z.boolean(), value: z.json().optional() })
  .strict()
  .refine(
    (state) => state.exists === Object.hasOwn(state, "value"),
    "Invalid field value.",
  );
const documentPatch = z
  .object({
    table: tableName,
    id: z.string().regex(/^[a-z0-9]{20,64}$/, "Invalid document ID."),
    changes: z
      .array(
        z
          .object({ field: fieldName, before: valueState, after: valueState })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .refine(
    (patch) =>
      new Set(patch.changes.map((c) => c.field)).size === patch.changes.length,
    "Duplicate fields.",
  );
export type DocumentPatch = z.infer<typeof documentPatch>;
// Convex's dashboard patch operation uses this sentinel for field removal.
// https://github.com/get-convex/convex-backend/blob/main/npm-packages/system-udfs/convex/_system/frontend/lib/values.ts
const removedValue =
  "__CONVEX_PLACEHOLDER_undefined_I23atX0jcndVbFgXoQZffsih7eAqktCyFjgUuAeNBtfr3ySOljPSPSEOPFgprkdBO3zXNiGEJxmJ5ZFPc5C5qKesG80QRPvlJe8vgSxAt9feLTwxTg4PHfVwUaTEJU67FDwldWmTxp1guMPwxQ2jOuhEryTBf3mQ";

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, i) => sameValue(value, b[i]))
    );
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const aa = a as Record<string, unknown>,
      bb = b as Record<string, unknown>;
    return (
      Object.keys(aa).length === Object.keys(bb).length &&
      Object.keys(aa).every(
        (key) => Object.hasOwn(bb, key) && sameValue(aa[key], bb[key]),
      )
    );
  }
  return false;
}
function validateValue(value: unknown): void {
  if (value === removedValue)
    throw new Error("This value is reserved by Convex.");
  if (Array.isArray(value)) value.forEach(validateValue);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("$"))
        throw new Error(
          "Special Convex values must be edited through a project mutation.",
        );
      validateValue(child);
    }
}
export function normalizeDocumentPatch(value: unknown): DocumentPatch {
  const patch = documentPatch.parse(value);
  for (const change of patch.changes) {
    if (change.after.exists) validateValue(change.after.value);
    if (sameValue(change.before, change.after))
      throw new Error("No field changes to save.");
  }
  if (JSON.stringify(patch).length > 16000)
    throw new Error("This edit is too large. Edit fewer fields at once.");
  return patch;
}
export function patchFields(patch: DocumentPatch) {
  return Object.fromEntries(
    patch.changes.map((change) => [
      change.field,
      change.after.exists ? change.after.value : removedValue,
    ]),
  );
}
export function unchangedFields(patch: DocumentPatch, current: unknown) {
  if (
    !current ||
    typeof current !== "object" ||
    (current as Record<string, unknown>)._id !== patch.id
  )
    return false;
  const doc = current as Record<string, unknown>;
  return patch.changes.every(
    ({ field, before }) =>
      before.exists === Object.hasOwn(doc, field) &&
      (!before.exists || sameValue(before.value, doc[field])),
  );
}
