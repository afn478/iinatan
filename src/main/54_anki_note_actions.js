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
      {
        url: prefs.ankiConnectUrl,
        timeoutSeconds: 8,
        preferences: prefs,
        retry: false,
      },
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
      {
        url: prefs.ankiConnectUrl,
        timeoutSeconds: 8,
        preferences: prefs,
        retry: false,
      },
    ),
    ankiConnectInvoke(
      "canAddNotes",
      { notes: [blockedNote] },
      {
        url: prefs.ankiConnectUrl,
        timeoutSeconds: 8,
        preferences: prefs,
        retry: false,
      },
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
    {
      url: prefs.ankiConnectUrl,
      timeoutSeconds: 8,
      preferences: prefs,
      retry: false,
    },
  );
  return Array.isArray(result) ? result : [];
}
function ankiMultiActionEnvelope(value) {
  return value && typeof value === "object" ? value : null;
}
function ankiUnsupportedAction(error) {
  return /unsupported action/i.test(compactError(error));
}
async function ankiFindDuplicateNotesSequential(prefs, fields, fieldNames) {
  if (!(await ankiNoteLooksDuplicate(prefs, fields, fieldNames))) return [];
  return ankiFindNotesByDuplicateQuery(prefs, fields, fieldNames);
}
async function ankiFindDuplicateNotes(prefs, fields, fieldNames) {
  if (!prefs.ankiDuplicateCheck) return [];
  const note = ankiDuplicateCheckNote(prefs, fields, fieldNames, false);
  const query = ankiDuplicateQuery(prefs, fields, fieldNames);
  if (!note || !query) return [];
  let results = null;
  try {
    results = await ankiConnectInvoke(
      "multi",
      {
        actions: [
          {
            action: "canAddNotesWithErrorDetail",
            version: ANKI_CONNECT_VERSION,
            params: { notes: [note] },
          },
          {
            action: "findNotes",
            version: ANKI_CONNECT_VERSION,
            params: { query },
          },
        ],
      },
      {
        url: prefs.ankiConnectUrl,
        timeoutSeconds: 8,
        preferences: prefs,
        retry: false,
      },
    );
  } catch (error) {
    if (ankiUnsupportedAction(error))
      return ankiFindDuplicateNotesSequential(prefs, fields, fieldNames);
    throw error;
  }
  if (!Array.isArray(results) || results.length < 2)
    return ankiFindDuplicateNotesSequential(prefs, fields, fieldNames);
  const detailEnvelope = ankiMultiActionEnvelope(results[0]);
  const notesEnvelope = ankiMultiActionEnvelope(results[1]);
  if (!detailEnvelope || !notesEnvelope)
    return ankiFindDuplicateNotesSequential(prefs, fields, fieldNames);
  if (detailEnvelope.error) {
    if (ankiUnsupportedAction(detailEnvelope.error))
      return ankiFindDuplicateNotesSequential(prefs, fields, fieldNames);
    throw new Error(String(detailEnvelope.error));
  }
  if (notesEnvelope.error) throw new Error(String(notesEnvelope.error));
  const detail = Array.isArray(detailEnvelope.result)
    ? detailEnvelope.result[0]
    : null;
  if (!detail || typeof detail !== "object")
    return ankiFindDuplicateNotesSequential(prefs, fields, fieldNames);
  if (!ankiErrorLooksDuplicate(detail.error)) return [];
  return Array.isArray(notesEnvelope.result) ? notesEnvelope.result : [];
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
  return ids.length ? "nid:" + ids.join(",") : "";
}
function ankiDisplayNoteIds(noteIds) {
  return ankiNormalizeNoteIds(noteIds).map((id) => {
    const numeric = Number(id);
    return Number.isSafeInteger(numeric) ? numeric : id;
  });
}
async function ankiOpenDuplicateNotes(prefs, noteIds) {
  const requestedIds = ankiNormalizeNoteIds(noteIds);
  const query = ankiNoteIdQuery(requestedIds);
  if (!query) throw new Error("No duplicate note ID is available.");
  const existing = await ankiConnectInvoke(
    "findNotes",
    { query },
    {
      url: prefs.ankiConnectUrl,
      timeoutSeconds: 8,
      preferences: prefs,
      retry: false,
    },
  );
  const existingIds = Object.create(null);
  ankiNormalizeNoteIds(existing).forEach((id) => {
    existingIds[id] = true;
  });
  const survivingIds = requestedIds.filter((id) => existingIds[id]);
  const survivingQuery = ankiNoteIdQuery(survivingIds);
  if (!survivingQuery) throw new Error("No matching Anki cards are available.");
  await ankiConnectInvoke(
    "guiBrowse",
    { query: survivingQuery },
    {
      url: prefs.ankiConnectUrl,
      timeoutSeconds: 8,
      preferences: prefs,
      retry: false,
    },
  );
  const activated = await utils.exec(
    "/usr/bin/open",
    ["-a", "Anki"],
    dataRoot(),
  );
  if (!activated || activated.status !== 0)
    throw new Error(
      "Anki's Browser opened, but Anki could not be foregrounded.",
    );
  return ankiDisplayNoteIds(survivingIds);
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
