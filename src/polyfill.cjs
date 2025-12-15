// Polyfill for is-generator-function in Node.js v24+
// CommonJS version for --require flag
// This fixes the "getGeneratorFunction is not a function" error

// Create a generator function to get its constructor
const generatorFunction = function* () {};
const GeneratorFunction = generatorFunction.constructor;

// Patch Module.prototype.require to intercept generator-function module
const Module = require("module");
const originalRequire = Module.prototype.require;

// Create a reliable getGeneratorFunction implementation
const getGeneratorFunctionImpl = function getGeneratorFunction() {
  if (GeneratorFunction) {
    return GeneratorFunction;
  }
  // Fallback: try to get it from the generator function
  const gen = function* () {};
  return gen.constructor;
};

// Override require to patch generator-function module
Module.prototype.require = function (id) {
  if (id === "generator-function") {
    // generator-function module exports a function that returns GeneratorFunction
    // Return our patched version
    return getGeneratorFunctionImpl;
  }
  return originalRequire.apply(this, arguments);
};

// Also set as global fallback
if (typeof globalThis !== "undefined") {
  globalThis.getGeneratorFunction = getGeneratorFunctionImpl;
} else if (typeof global !== "undefined") {
  global.getGeneratorFunction = getGeneratorFunctionImpl;
}

// Ensure it's available immediately
global.getGeneratorFunction = getGeneratorFunctionImpl;
