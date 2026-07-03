const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const sources = [
  "src/main/52_anki_card_context.js",
  "src/main/53_anki_duplicates.js",
  "src/main/54_anki_note_actions.js",
]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
const calls = [];
const warnings = [];
const context = {
  console,
  Math,
  Number,
  Object,
  Promise,
  String,
  compactError(error) {
    return error && error.message ? error.message : String(error);
  },
  debugWarn(message) {
    warnings.push(String(message || ""));
  },
  ankiConnectInvoke(action, params, options) {
    calls.push({ action, params, options });
    return null;
  },
};

vm.createContext(context);
vm.runInContext(
  sources +
    `
globalThis.__ankiNoteActions = {
  ankiErrorLooksDuplicate,
  ankiNoteLooksDuplicate,
  ankiFindNotesByDuplicateQuery,
  ankiFindDuplicateNotes,
  ankiNormalizeNoteIds,
  ankiNoteIdQuery,
  ankiDisplayNoteIds,
  ankiOpenDuplicateNotes,
  ankiNoteTags,
  ankiValidAddedNoteId
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

const actions = context.__ankiNoteActions;
const prefs = {
  ankiConnectUrl: "http://127.0.0.1:8765",
  ankiDeckName: "Mining",
  ankiModelName: "Basic",
  ankiDuplicateCheck: true,
  ankiDuplicateMode: "prevent",
  ankiDuplicateScope: "deck",
};

function resetCalls() {
  calls.length = 0;
  warnings.length = 0;
}

async function testNoteIdFormatting() {
  const noteIds = [" 123 ", 123, "001", "abc", "", null, "9007199254740993"];
  assertDeepEqual(
    actions.ankiNormalizeNoteIds(noteIds),
    ["123", "001", "9007199254740993"],
    "Note ID normalization should trim, filter non-IDs, and dedupe by ID text",
  );
  assert(
    actions.ankiNoteIdQuery(noteIds) === "nid:123",
    "Note ID queries should target the first valid normalized ID",
  );
  assertDeepEqual(
    actions.ankiDisplayNoteIds(noteIds),
    [123, 1, "9007199254740993"],
    "Displayed note IDs should use safe numbers while preserving unsafe integer strings",
  );
}

async function testRevealRequiresNoteId() {
  resetCalls();
  let errorMessage = "";
  try {
    actions.ankiOpenDuplicateNotes(prefs, ["", null, "x"]);
  } catch (error) {
    errorMessage = error.message;
  }
  assert(
    /No duplicate note ID/i.test(errorMessage),
    "Missing note IDs should fail reveal",
  );
  assert(calls.length === 0, "Missing note IDs should not dispatch guiBrowse");
}

async function testGuiBrowseDispatch() {
  resetCalls();
  context.ankiConnectInvoke = (action, params, options) => {
    calls.push({ action, params, options });
    if (action === "guiBrowse") return new Promise(() => {});
    return null;
  };
  const displayed = actions.ankiOpenDuplicateNotes(prefs, [
    "bad",
    "34567",
    "45678",
    "34567",
  ]);
  assertDeepEqual(
    displayed,
    [34567, 45678],
    "Reveal should return display IDs after filtering and deduping",
  );
  assert(
    calls.length === 1 &&
      calls[0].action === "guiBrowse" &&
      calls[0].params.query === "nid:34567",
    "Reveal should dispatch guiBrowse for the first valid note ID",
  );
}

async function testDuplicateDetectionWithErrorDetail() {
  resetCalls();
  context.ankiConnectInvoke = (action, params, options) => {
    calls.push({ action, params, options });
    if (action === "canAddNotesWithErrorDetail")
      return [
        {
          canAdd: false,
          error: "cannot create note because it is a duplicate",
        },
      ];
    if (action === "findNotes") return [34567];
    return null;
  };
  const duplicates = await actions.ankiFindDuplicateNotes(
    prefs,
    { Front: "猫", Back: "cat" },
    ["Front", "Back"],
  );
  assertDeepEqual(
    duplicates,
    [34567],
    "Duplicate detail errors should trigger duplicate note lookup",
  );
  assert(
    calls[0].action === "canAddNotesWithErrorDetail" &&
      calls[1].action === "findNotes",
    "Duplicate detail detection should probe before finding notes",
  );
}

async function testDuplicateDetectionFallback() {
  resetCalls();
  context.ankiConnectInvoke = (action, params, options) => {
    calls.push({ action, params, options });
    if (action === "canAddNotesWithErrorDetail")
      throw new Error("unsupported action");
    if (action === "canAddNotes") {
      const note = params.notes[0] || {};
      return [!!(note.options && note.options.allowDuplicate)];
    }
    if (action === "findNotes") return [45678];
    return null;
  };
  const duplicates = await actions.ankiFindDuplicateNotes(
    prefs,
    { Front: "猫", Back: "cat" },
    ["Front", "Back"],
  );
  assertDeepEqual(
    duplicates,
    [45678],
    "Paired canAddNotes fallback should detect duplicates when error detail is unsupported",
  );
  const canAddCalls = calls.filter((call) => call.action === "canAddNotes");
  assert(
    canAddCalls.length === 2,
    "Fallback duplicate detection should run paired canAddNotes probes",
  );
  assert(
    canAddCalls.some(
      (call) => call.params.notes[0].options.allowDuplicate === true,
    ) &&
      canAddCalls.some(
        (call) => call.params.notes[0].options.allowDuplicate === false,
      ),
    "Fallback probes should compare allowed and blocked duplicate options",
  );
}

async function testDuplicateCheckDisabledSkips() {
  resetCalls();
  context.ankiConnectInvoke = (action, params, options) => {
    calls.push({ action, params, options });
    return [12345];
  };
  const duplicates = await actions.ankiFindDuplicateNotes(
    Object.assign({}, prefs, { ankiDuplicateCheck: false }),
    { Front: "猫" },
    ["Front"],
  );
  assertDeepEqual(
    duplicates,
    [],
    "Disabled duplicate checking should return no duplicates",
  );
  assert(
    calls.length === 0,
    "Disabled duplicate checking should not call AnkiConnect",
  );
}

async function testTagsAndAddedNoteIds() {
  assertDeepEqual(
    actions.ankiNoteTags({ ankiTags: " mined, iinatan  mined\nvideo " }),
    ["mined", "iinatan", "video"],
    "Anki tags should split on commas/whitespace and dedupe",
  );
  assert(
    actions.ankiValidAddedNoteId(12345),
    "Numeric added note IDs should be valid",
  );
  assert(
    actions.ankiValidAddedNoteId(" 001 "),
    "Numeric string added note IDs should be valid",
  );
  assert(
    !actions.ankiValidAddedNoteId(""),
    "Empty added note IDs should be invalid",
  );
  assert(
    !actions.ankiValidAddedNoteId(null),
    "Null added note IDs should be invalid",
  );
  assert(
    !actions.ankiValidAddedNoteId("abc"),
    "Non-numeric added note IDs should be invalid",
  );
}

(async () => {
  await testNoteIdFormatting();
  await testRevealRequiresNoteId();
  await testGuiBrowseDispatch();
  await testDuplicateDetectionWithErrorDetail();
  await testDuplicateDetectionFallback();
  await testDuplicateCheckDisabledSkips();
  await testTagsAndAddedNoteIds();
  console.log("anki note action tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
