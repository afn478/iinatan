function ankiSearchEscape(value) {
  return String(value || "").replace(/"/g, "");
}
function ankiDuplicateFieldValue(fields, firstField) {
  const map = fields && typeof fields === "object" ? fields : {};
  const name = String(firstField || "");
  if (!name) return "";
  if (Object.prototype.hasOwnProperty.call(map, name))
    return String(map[name] || "");
  const target = ankiCompareKey(name);
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i++) {
    if (ankiCompareKey(keys[i]) === target) return String(map[keys[i]] || "");
  }
  return "";
}
function ankiFirstFieldName(fields, fieldNames) {
  if (Array.isArray(fieldNames) && fieldNames.length)
    return String(fieldNames[0] || "");
  return Object.keys(fields || {})[0] || "";
}
function ankiDuplicateFields(fields, fieldNames) {
  const firstField = ankiFirstFieldName(fields, fieldNames);
  const value = firstField ? ankiDuplicateFieldValue(fields, firstField) : "";
  if (!firstField || !value) return {};
  const out = {};
  out[firstField] = value;
  return out;
}
function ankiDuplicateQuery(prefs, fields, fieldNames) {
  const deck = prefs.ankiDeckName;
  const firstField = ankiFirstFieldName(fields, fieldNames);
  const value = firstField ? ankiDuplicateFieldValue(fields, firstField) : "";
  if (!firstField || !value) return "";
  const parts = [
    '"' +
      ankiSearchEscape(firstField).toLowerCase() +
      ":" +
      ankiSearchEscape(value) +
      '"',
  ];
  if (prefs.ankiDuplicateScope === "deck" && deck)
    parts.unshift('"deck:' + ankiSearchEscape(deck) + '"');
  return parts.join(" ");
}
function ankiDuplicateOptions(prefs) {
  return {
    allowDuplicate: prefs.ankiDuplicateMode === "allow",
    duplicateScope:
      prefs.ankiDuplicateScope === "collection" ? "collection" : "deck",
    duplicateScopeOptions: {
      deckName: prefs.ankiDeckName,
      checkChildren: true,
      checkAllModels: false,
    },
  };
}
function ankiDuplicateCheckOptions(prefs, allowDuplicate) {
  const options = ankiDuplicateOptions(prefs);
  options.allowDuplicate = !!allowDuplicate;
  return options;
}
function ankiDuplicateCheckNote(prefs, fields, fieldNames, allowDuplicate) {
  const firstFields = ankiDuplicateFields(fields, fieldNames);
  if (!Object.keys(firstFields).length) return null;
  return {
    deckName: prefs.ankiDeckName,
    modelName: prefs.ankiModelName,
    fields: firstFields,
    options: ankiDuplicateCheckOptions(prefs, allowDuplicate),
    tags: [],
  };
}
