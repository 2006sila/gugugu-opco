/**
 * ts-resolve.mjs — a tiny ESM resolver used ONLY to run the upstream
 * check:* scripts inside a sandbox where esbuild cannot spawn (EPERM).
 *
 * The sources use NodeNext-style ".js" specifiers that actually point at ".ts"
 * files; tsx rewrites them, this hook just retries the lookup with ".ts".
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".")) throw error;
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const target = path.resolve(path.dirname(parent), specifier);
    const candidates = [
      target.replace(/\.js$/, ".ts"),
      target + ".ts",
      path.join(target, "index.ts"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    throw error;
  }
}
