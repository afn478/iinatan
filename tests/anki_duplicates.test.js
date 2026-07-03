const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const sources = [
  "src/main/52_anki_card_context.js",
  "src/main/53_anki_duplicates.js",
]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
const context = { console, Object, String };

vm.createContext(context);
vm.runInContext(
  sources +
    `
globalThis.__ankiDuplicates = {
  ankiSearchEscape,
  ankiDuplicateFieldValue,
  ankiFirstFieldName,
  ankiDuplicateFields,
  ankiDuplicateQuery,
  ankiDuplicateOptions,
  ankiDuplicateCheckOptions,
  ankiDuplicateCheckNote
};`,
  context,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, message + "\n" + actualJson);
}

const duplicates = context.__ankiDuplicates;
const prefs = {
  ankiDeckName: 'Mining "Deck"',
  ankiModelName: "Basic",
  ankiDuplicateMode: "prevent",
  ankiDuplicateScope: "deck",
};

assert(
  duplicates.ankiDuplicateFieldValue({ front: "猫" }, "Front") === "猫",
  "Duplicate field lookup should match model fields case-insensitively",
);
assert(
  duplicates.ankiDuplicateFieldValue({ Front: "猫" }, "Front") === "猫",
  "Duplicate field lookup should prefer exact keys when present",
);
assert(
  duplicates.ankiFirstFieldName({ Front: "猫" }, ["Expression", "Back"]) ===
    "Expression",
  "Configured model field order should decide the duplicate field",
);
assert(
  duplicates.ankiFirstFieldName({ Front: "猫" }, []) === "Front",
  "Rendered field order should be the fallback duplicate field order",
);
assertDeepEqual(
  duplicates.ankiDuplicateFields({ front: "猫", Back: "cat" }, ["Front"]),
  { Front: "猫" },
  "Duplicate check fields should contain only the resolved first field",
);
assertDeepEqual(
  duplicates.ankiDuplicateFields({ Front: "" }, ["Front"]),
  {},
  "Empty first-field values should not create duplicate check fields",
);

assert(
  duplicates.ankiSearchEscape('"quoted" value') === "quoted value",
  "Anki search escaping should strip quotes",
);
assert(
  duplicates.ankiDuplicateQuery(prefs, { front: '猫 "cat"' }, ["Front"]) ===
    '"deck:Mining Deck" "front:猫 cat"',
  "Deck-scoped duplicate queries should include deck and first-field clauses",
);
assert(
  duplicates.ankiDuplicateQuery(
    Object.assign({}, prefs, { ankiDuplicateScope: "collection" }),
    { Front: "猫" },
    ["Front"],
  ) === '"front:猫"',
  "Collection-scoped duplicate queries should omit deck clauses",
);
assert(
  duplicates.ankiDuplicateQuery(prefs, { Front: "" }, ["Front"]) === "",
  "Duplicate queries should be empty without a first-field value",
);

assertDeepEqual(
  duplicates.ankiDuplicateOptions(
    Object.assign({}, prefs, {
      ankiDuplicateMode: "allow",
      ankiDuplicateScope: "collection",
    }),
  ),
  {
    allowDuplicate: true,
    duplicateScope: "collection",
    duplicateScopeOptions: {
      deckName: 'Mining "Deck"',
      checkChildren: true,
      checkAllModels: false,
    },
  },
  "Duplicate options should preserve add-anyway and collection scope",
);
assert(
  duplicates.ankiDuplicateCheckOptions(prefs, true).allowDuplicate === true,
  "Duplicate check options should allow probing with duplicate allowance",
);
assert(
  duplicates.ankiDuplicateCheckOptions(prefs, false).allowDuplicate === false,
  "Duplicate check options should support blocked duplicate probes",
);

const checkNote = duplicates.ankiDuplicateCheckNote(
  prefs,
  { front: "猫", Back: "cat" },
  ["Front", "Back"],
  false,
);
assertDeepEqual(
  checkNote,
  {
    deckName: 'Mining "Deck"',
    modelName: "Basic",
    fields: { Front: "猫" },
    options: {
      allowDuplicate: false,
      duplicateScope: "deck",
      duplicateScopeOptions: {
        deckName: 'Mining "Deck"',
        checkChildren: true,
        checkAllModels: false,
      },
    },
    tags: [],
  },
  "Duplicate check notes should use only the first field and configured options",
);
assert(
  duplicates.ankiDuplicateCheckNote(prefs, { Front: "" }, ["Front"], false) ===
    null,
  "Duplicate check notes should be omitted without first-field content",
);

console.log("anki duplicate tests passed");
