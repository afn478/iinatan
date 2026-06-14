const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = {};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, "src/main/25_import_validation.js"), "utf8") +
    "\nthis.dictionaryZipValidation = dictionaryZipValidation;\nthis.isPromiseLike = isPromiseLike;",
  context,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validate(value, exists) {
  return context.dictionaryZipValidation(value, () => exists);
}

let result = validate("/tmp/jitendex.zip", true);
assert(result.ok, "valid .zip path should pass");
assert(
  result.path === "/tmp/jitendex.zip",
  "valid .zip path should be preserved",
);

result = validate("", true);
assert(
  !result.ok && result.reason === "empty",
  "empty path should be treated as cancelled/empty",
);

result = validate(null, true);
assert(
  !result.ok && result.reason === "empty",
  "null path should be treated as cancelled/empty",
);

result = validate("/tmp/jitendex.json", true);
assert(
  !result.ok && result.reason === "extension",
  "non-zip path should fail extension validation",
);

result = validate("/tmp/missing.zip", false);
assert(
  !result.ok && result.reason === "missing",
  "missing .zip path should fail existence validation",
);

result = validate("[object Promise]", true);
assert(
  !result.ok && result.reason === "empty",
  "unawaited chooseFile Promise string should not be imported",
);

assert(
  context.isPromiseLike(Promise.resolve("/tmp/jitendex.zip")),
  "Promise values should be detected",
);
assert(
  !context.isPromiseLike("/tmp/jitendex.zip"),
  "plain paths should not be promise-like",
);

console.log("import validation tests passed");
