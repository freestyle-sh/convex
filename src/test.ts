/// <reference types="vite/client" />

import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

export function register(
  test: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name = "freestyle",
) {
  test.registerComponent(name, schema, modules);
}

export default { modules, register, schema };
