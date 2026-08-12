/* eslint-disable @typescript-eslint/no-require-imports -- Webpack loads test loaders through CommonJS. */
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { webpack } = require("next/dist/compiled/webpack/webpack");

const outputPath = mkdtempSync(join(tmpdir(), "place-frontier-client-bundle-"));
const compiler = webpack({
  mode: "production",
  target: "web",
  entry: resolve(__dirname, "entry.ts"),
  output: { filename: "bundle.js", path: outputPath },
  resolve: { extensions: [".ts", ".tsx", ".js"] },
  module: {
    rules: [{
      test: /\.tsx?$/,
      use: [{ loader: resolve(__dirname, "typescript-loader.cjs") }],
    }],
  },
  optimization: { minimize: false },
});

compiler.run((error, stats) => {
  compiler.close(() => {
    try {
      if (error) throw error;
      if (stats?.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }));
    } catch (failure) {
      console.error(failure instanceof Error ? failure.message : failure);
      process.exitCode = 1;
    } finally {
      rmSync(outputPath, { recursive: true, force: true });
    }
  });
});
