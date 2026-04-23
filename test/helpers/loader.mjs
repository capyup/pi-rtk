// Shared jiti loader. Used by all tests to import the TypeScript source
// modules at `../../extensions/rtk/*.ts` without a build step. The reason we
// use jiti rather than Node's built-in --experimental-strip-types is that the
// source uses ESM-style `./foo.js` specifiers (matching pi's convention),
// which Node's type-stripping mode does not rewrite to the on-disk `.ts`
// file.

import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = resolve(here, "..", "..", "extensions", "rtk");

export const jiti = createJiti(import.meta.url, { interopDefault: true });

/**
 * Import one of the pi-rtk extension modules. `moduleName` is the filename
 * without extension, e.g. `"rewrite"`, `"version"`, `"config"`, `"awareness"`,
 * `"index"`.
 */
export async function loadExt(moduleName) {
	return jiti.import(`${EXT_DIR}/${moduleName}.ts`);
}
