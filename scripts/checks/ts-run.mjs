// Registers the resolver above, then runs a .ts entrypoint in-process.
import { register } from "node:module";
register("./ts-resolve.mjs", import.meta.url);
