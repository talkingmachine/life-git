/* eslint-disable @typescript-eslint/no-require-imports -- Webpack executes custom loaders as CommonJS. */
const ts = require("typescript");

module.exports = function compileTypeScript(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: this.resourcePath,
  }).outputText;
};
