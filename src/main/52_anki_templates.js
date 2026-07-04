function ankiMarkerDefinitions(language) {
  const lang = String(language || "ja");
  const markers = [
    { marker: "{expression}", label: "Headword" },
    { marker: "{word}", label: "Headword alias" },
    { marker: "{reading}", label: "Reading" },
    { marker: "{furigana}", label: "Headword ruby" },
    { marker: "{furigana-plain}", label: "Furigana text" },
    { marker: "{popup-selection-text}", label: "Popup selection" },
    { marker: "{sentence}", label: "Subtitle sentence" },
    { marker: "{cloze-prefix}", label: "Cloze before word" },
    { marker: "{cloze-body}", label: "Cloze word" },
    { marker: "{cloze-suffix}", label: "Cloze after word" },
    { marker: "{glossary-first}", label: "First definition" },
    { marker: "{selected-glossary}", label: "Selected definition" },
    { marker: "{glossary}", label: "All definitions" },
    { marker: "{glossary-plain}", label: "Plain definitions" },
    { marker: "{dictionary}", label: "Dictionary" },
    { marker: "{part-of-speech}", label: "Part of speech" },
    { marker: "{tags}", label: "Dictionary tags" },
    { marker: "{frequencies}", label: "Frequency tags" },
    { marker: "{frequency-harmonic-rank}", label: "Frequency rank" },
    { marker: "{phonetic-transcriptions}", label: "Phonetics" },
    { marker: "{document-title}", label: "Video title" },
    { marker: "{source-path}", label: "File path" },
    { marker: "{timestamp}", label: "Timestamp" },
    { marker: "{screenshot}", label: "Video screenshot" },
    { marker: "{image}", label: "Video screenshot alias" },
    { marker: "{sentence-audio}", label: "Subtitle audio" },
    { marker: "{subtitle-audio}", label: "Subtitle audio alias" },
    { marker: "{audio}", label: "Word audio or subtitle audio" },
  ];
  if (lang === "ja") {
    markers.push(
      { marker: "{single-glossary-jitendex}", label: "Jitendex definition" },
      { marker: "{pitch-accent-positions}", label: "Pitch positions" },
      { marker: "{pitch-accent-categories}", label: "Pitch categories" },
    );
  }
  return markers;
}
function extractAnkiMarkersFromTemplates(templates) {
  const out = Object.create(null);
  Object.keys(templates || {}).forEach((field) => {
    const text = String(templates[field] || "");
    text.replace(/\{([^{}]+)\}/g, (_match, key) => {
      out[
        String(key || "")
          .trim()
          .toLowerCase()
      ] = true;
      return "";
    });
  });
  return out;
}
function ankiTemplatesNeedMedia(templates) {
  const markers = extractAnkiMarkersFromTemplates(templates || {});
  return {
    screenshot: !!(markers.screenshot || markers.image),
    sentenceAudio: !!(markers["sentence-audio"] || markers["subtitle-audio"]),
    wordAudio: !!markers.audio,
  };
}
function ankiMarkerValue(marker, context, media) {
  const key = String(marker || "")
    .trim()
    .toLowerCase();
  if (key === "expression" || key === "word")
    return ankiEscapeHtml(context.expression);
  if (key === "reading") return ankiEscapeHtml(context.reading);
  if (key === "furigana-plain")
    return ankiEscapeHtml(
      ankiFuriganaPlain(context.expression, context.reading),
    );
  if (key === "furigana")
    return ankiFuriganaHtml(context.expression, context.reading);
  if (key === "popup-selection-text")
    return ankiEscapeHtml(context.popupSelectionText);
  if (key === "sentence") return ankiEscapeHtml(context.sentence);
  if (key === "cloze-prefix") return ankiEscapeHtml(context.clozePrefix);
  if (key === "cloze-body") return ankiEscapeHtml(context.clozeBody);
  if (key === "cloze-suffix") return ankiEscapeHtml(context.clozeSuffix);
  if (key === "glossary") return context.glossary;
  if (key === "glossary-plain") return ankiEscapeHtml(context.glossaryPlain);
  if (key === "glossary-first")
    return context.glossaryFirstHtml || ankiEscapeHtml(context.glossaryFirst);
  if (key === "selected-glossary")
    return (
      context.selectedGlossaryHtml ||
      ankiEscapeHtml(context.selectedGlossary || context.glossaryFirst)
    );
  if (key.indexOf("single-glossary-") === 0) {
    const dictionary = key.slice("single-glossary-".length);
    return ankiGlossaryHtmlForDictionary(context.entry, dictionary);
  }
  if (key === "dictionary" || key === "dictionary-alias")
    return ankiEscapeHtml(context.dictionary);
  if (key === "part-of-speech") return ankiEscapeHtml(context.partOfSpeech);
  if (key === "tags") return ankiEscapeHtml(context.tags);
  if (key === "frequencies") return ankiEscapeHtml(context.frequencies);
  if (key === "frequency-harmonic-rank")
    return ankiEscapeHtml(context.frequencyHarmonicRank);
  if (key === "pitch-accent-positions")
    return ankiEscapeHtml(context.pitchAccentPositions);
  if (key === "pitch-accent-categories")
    return ankiEscapeHtml(context.pitchAccentCategories);
  if (key === "phonetic-transcriptions")
    return ankiEscapeHtml(context.phoneticTranscriptions);
  if (key === "document-title") return ankiEscapeHtml(context.documentTitle);
  if (key === "source-path") return ankiEscapeHtml(context.sourcePath);
  if (key === "timestamp") return ankiEscapeHtml(context.timestamp);
  if (key === "screenshot" || key === "image")
    return media && media.screenshot
      ? '<img src="' + ankiEscapeHtml(media.screenshot) + '">'
      : "";
  if (key === "sentence-audio" || key === "subtitle-audio")
    return media && media.sentenceAudio
      ? "[sound:" + media.sentenceAudio + "]"
      : "";
  if (key === "audio")
    return media && media.wordAudio ? "[sound:" + media.wordAudio + "]" : "";
  return "";
}
function renderAnkiTemplate(template, context, media) {
  return String(template || "").replace(/\{([^{}]+)\}/g, (_match, marker) =>
    ankiMarkerValue(marker, context, media || {}),
  );
}
function renderAnkiFields(templates, context, media) {
  const fields = {};
  Object.keys(templates || {}).forEach((field) => {
    fields[field] = renderAnkiTemplate(templates[field], context, media || {});
  });
  return fields;
}
