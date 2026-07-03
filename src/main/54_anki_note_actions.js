function ankiErrorLooksDuplicate(error) {
  return /cannot create note because it is a duplicate/i.test(
    String(error || ""),
  );
}
async function ankiNoteLooksDuplicate(prefs, fields, fieldNames) {
  const blockedNote = ankiDuplicateCheckNote(prefs, fields, fieldNames, false);
  if (!blockedNote) return false;
  try {
    const result = await ankiConnectInvoke(
      "canAddNotesWithErrorDetail",
      { notes: [blockedNote] },
      { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
    );
    const first = Array.isArray(result) ? result[0] : null;
    if (first && typeof first === "object")
      return ankiErrorLooksDuplicate(first.error);
  } catch (error) {
    if (!/unsupported action/i.test(compactError(error))) throw error;
  }
  const allowedNote = ankiDuplicateCheckNote(prefs, fields, fieldNames, true);
  const results = await Promise.all([
    ankiConnectInvoke(
      "canAddNotes",
      { notes: [allowedNote || blockedNote] },
      { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
    ),
    ankiConnectInvoke(
      "canAddNotes",
      { notes: [blockedNote] },
      { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
    ),
  ]);
  const withDuplicatesAllowed = Array.isArray(results[0])
    ? !!results[0][0]
    : false;
  const noDuplicatesAllowed = Array.isArray(results[1])
    ? !!results[1][0]
    : false;
  return withDuplicatesAllowed !== noDuplicatesAllowed;
}
async function ankiFindNotesByDuplicateQuery(prefs, fields, fieldNames) {
  const query = ankiDuplicateQuery(prefs, fields, fieldNames);
  if (!query) return [];
  const result = await ankiConnectInvoke(
    "findNotes",
    { query },
    { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
  );
  return Array.isArray(result) ? result : [];
}
async function ankiFindDuplicateNotes(prefs, fields, fieldNames) {
  if (!prefs.ankiDuplicateCheck) return [];
  if (!(await ankiNoteLooksDuplicate(prefs, fields, fieldNames))) return [];
  return ankiFindNotesByDuplicateQuery(prefs, fields, fieldNames);
}
function ankiNormalizeNoteIds(noteIds) {
  const seen = Object.create(null);
  const out = [];
  ankiToArray(noteIds).forEach((id) => {
    const text = String(id === undefined || id === null ? "" : id).trim();
    if (!/^\d+$/.test(text) || seen[text]) return;
    seen[text] = true;
    out.push(text);
  });
  return out;
}
function ankiNoteIdQuery(noteIds) {
  const ids = ankiNormalizeNoteIds(noteIds);
  return ids.length ? "nid:" + ids[0] : "";
}
function ankiDisplayNoteIds(noteIds) {
  return ankiNormalizeNoteIds(noteIds).map((id) => {
    const numeric = Number(id);
    return Number.isSafeInteger(numeric) ? numeric : id;
  });
}
function ankiOpenDuplicateNotes(prefs, noteIds) {
  const query = ankiNoteIdQuery(noteIds);
  if (!query) throw new Error("No duplicate note ID is available.");
  try {
    Promise.resolve(
      ankiConnectInvoke(
        "guiBrowse",
        { query },
        { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
      ),
    ).catch((error) => {
      debugWarn(
        "Anki reveal request failed after dispatch: " + compactError(error),
      );
    });
  } catch (error) {
    debugWarn(
      "Anki reveal request failed before dispatch: " + compactError(error),
    );
  }
  return ankiDisplayNoteIds(noteIds);
}
function ankiNoteTags(prefs) {
  const seen = Object.create(null);
  const out = [];
  String(prefs.ankiTags || "")
    .split(/[,\s]+/)
    .forEach((tag) => {
      const clean = tag.trim();
      if (clean && !seen[clean]) {
        seen[clean] = true;
        out.push(clean);
      }
    });
  return out;
}
function ankiValidAddedNoteId(noteId) {
  return !!ankiNoteIdQuery([noteId]);
}
