import { defineConfig } from "tsdown";
import { typertPlugin } from "./packages/typert/generator/lib/types/tsdown-plugin.js";

export default defineConfig({
  workspace: ["packages/util/brand"],
  entry: ["lib/types/{index,invariant,startup}.js"],
  outDir: "lib",
  format: ["esm"],
  platform: "node",
  target: "es2024",
  fixedExtension: false,
  dts: false,
  clean: false,
  plugins: [typertPlugin({ mode: "workspace", faces: ["host"] })],
});
