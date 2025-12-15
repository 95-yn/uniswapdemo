// Polyfill for is-generator-function in Node.js v24+
// This fixes the "getGeneratorFunction is not a function" error
// Must be imported FIRST before any other modules

// Create a generator function to get its constructor
const generatorFunction = function* () {};
const GeneratorFunction = generatorFunction.constructor;

// Patch Module.prototype.require to intercept generator-function module
// This ensures the polyfill is applied before any module loads generator-function
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
Module.prototype.require = function (id: string) {
  if (id === "generator-function") {
    // generator-function module exports a function that returns GeneratorFunction
    // Return our patched version
    return getGeneratorFunctionImpl;
  }
  return originalRequire.apply(this, arguments as any);
};

// Also set as global fallback (some code might access it directly)
if (typeof globalThis !== "undefined") {
  (globalThis as any).getGeneratorFunction = getGeneratorFunctionImpl;
} else if (typeof global !== "undefined") {
  (global as any).getGeneratorFunction = getGeneratorFunctionImpl;
}

// Ensure it's available immediately
(global as any).getGeneratorFunction = getGeneratorFunctionImpl;
