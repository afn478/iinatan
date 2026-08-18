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
  ANKI_CONNECT_VERSION: 6,
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
  dataRoot() {
    return "/data";
  },
  execExternalProcess(command, args, cwd) {
    return context.utils.exec(command, args, cwd);
  },
  utils: {
    async exec(command, args) {
      calls.push({ action: "exec", command, args });
      return { status: 0, stdout: "", stderr: "" };
    },
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
    actions.ankiNoteIdQuery(noteIds) === "nid:123,001,9007199254740993",
    "Note ID queries should target every valid normalized ID",
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
    await actions.ankiOpenDuplicateNotes(prefs, ["", null, "x"]);
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
    if (action === "findNotes") return [45678, 34567];
    if (action === "guiBrowse") return null;
    return null;
  };
  const displayed = await actions.ankiOpenDuplicateNotes(prefs, [
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
    calls.length === 3 &&
      calls[0].action === "findNotes" &&
      calls[0].params.query === "nid:34567,45678" &&
      calls[1].action === "guiBrowse" &&
      calls[1].params.query === "nid:34567,45678",
    "Reveal should validate and browse every valid note ID",
  );
  assert(
    calls[2].action === "exec" &&
      calls[2].command === "/usr/bin/open" &&
      calls[2].args.join(" ") === "-a Anki",
    "Reveal should accept a null guiBrowse result and then foreground Anki",
  );
}

async function testGuiBrowsePrunesMissingNotes() {
  resetCalls();
  context.ankiConnectInvoke = (action, params, options) => {
    calls.push({ action, params, options });
    if (action === "findNotes") return [45678];
    if (action === "guiBrowse") return [99999];
    return null;
  };
  const displayed = await actions.ankiOpenDuplicateNotes(prefs, [34567, 45678]);
  assertDeepEqual(
    displayed,
    [45678],
    "Reveal should return only note IDs that still exist",
  );
  assert(
    calls[1].action === "guiBrowse" && calls[1].params.query === "nid:45678",
    "Reveal should remove deleted IDs before opening Anki's browser",
  );
}

async function testForegroundFailureIsReported() {
  resetCalls();
  const previousExec = context.utils.exec;
  context.ankiConnectInvoke = (action, params, options) => {
    calls.push({ action, params, options });
    if (action === "findNotes") return [34567];
    if (action === "guiBrowse") return null;
    return null;
  };
  context.utils.exec = async (command, args) => {
    calls.push({ action: "exec", command, args });
    return { status: 1, stdout: "", stderr: "activation failed" };
  };
  let errorMessage = "";
  try {
    await actions.ankiOpenDuplicateNotes(prefs, [34567]);
  } catch (error) {
    errorMessage = error.message;
  } finally {
    context.utils.exec = previousExec;
  }
  assert(
    /could not be foregrounded/i.test(errorMessage),
    "Reveal should report Launch Services foregrounding failures",
  );
}

async function testDuplicateDetectionWithErrorDetail() {
  resetCalls();
  context.ankiConnectInvoke = (action, params, options) => {
    calls.push({ action, params, options });
    if (action === "multi")
      return [
        {
          result: [
            {
              canAdd: false,
              error: "cannot create note because it is a duplicate",
            },
          ],
          error: null,
        },
        { result: [34567], error: null },
      ];
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
    calls.length === 1 &&
      calls[0].action === "multi" &&
      calls[0].params.actions[0].action === "canAddNotesWithErrorDetail" &&
      calls[0].params.actions[1].action === "findNotes",
    "Duplicate detail detection should batch the probe and note lookup",
  );
}

async function testDuplicateDetectionFallback() {
  resetCalls();
  context.ankiConnectInvoke = (action, params, options) => {
    calls.push({ action, params, options });
    if (action === "multi") throw new Error("unsupported action");
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
  await testGuiBrowsePrunesMissingNotes();
  await testForegroundFailureIsReported();
  await testDuplicateDetectionWithErrorDetail();
  await testDuplicateDetectionFallback();
  await testDuplicateCheckDisabledSkips();
  await testTagsAndAddedNoteIds();
  console.log("anki note action tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
