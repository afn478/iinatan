/*
 * Derived from Yomitan ext/js/language/en/english-transforms.js
 * Upstream source: https://github.com/yomidevs/yomitan/blob/master/ext/js/language/en/english-transforms.js
 * Copyright (C) 2024-2026 Yomitan Authors
 * License: GPL-3.0-or-later. See DEINFLECTION_NOTES.md for attribution notes.
 */
const IINATAN_ENGLISH_YOMITAN_SUFFIX_RULES = [
  ["s", "", ["np"], ["ns"], "plural"],
  ["es", "", ["np"], ["ns"], "plural"],
  ["ies", "y", ["np"], ["ns"], "plural"],
  ["ves", "fe", ["np"], ["ns"], "plural"],
  ["ves", "f", ["np"], ["ns"], "plural"],
  ["'s", "", ["n"], ["n"], "possessive"],
  ["s'", "s", ["n"], ["n"], "possessive"],
  ["ed", "", ["v"], ["v"], "past"],
  ["ed", "e", ["v"], ["v"], "past"],
  ["ied", "y", ["v"], ["v"], "past"],
  ["cked", "c", ["v"], ["v"], "past"],
  ["laid", "lay", ["v"], ["v"], "past"],
  ["paid", "pay", ["v"], ["v"], "past"],
  ["said", "say", ["v"], ["v"], "past"],
  ["ing", "", ["v"], ["v"], "ing"],
  ["ing", "e", ["v"], ["v"], "ing"],
  ["ying", "ie", ["v"], ["v"], "ing"],
  ["cking", "c", ["v"], ["v"], "ing"],
  ["s", "", ["v"], ["v"], "3rd pers. sing. pres"],
  ["es", "", ["v"], ["v"], "3rd pers. sing. pres"],
  ["ies", "y", ["v"], ["v"], "3rd pers. sing. pres"],
  ["'d", "ed", ["v"], ["v"], "archaic"],
  ["ly", "", ["adv"], ["adj"], "adverb"],
  ["ily", "y", ["adv"], ["adj"], "adverb"],
  ["ly", "le", ["adv"], ["adj"], "adverb"],
  ["er", "", ["adj"], ["adj"], "comparative"],
  ["er", "e", ["adj"], ["adj"], "comparative"],
  ["ier", "y", ["adj"], ["adj"], "comparative"],
  ["est", "", ["adj"], ["adj"], "superlative"],
  ["est", "e", ["adj"], ["adj"], "superlative"],
  ["iest", "y", ["adj"], ["adj"], "superlative"],
  ["in'", "ing", ["v"], ["v"], "dropped g"],
  ["y", "", ["adj"], ["n", "v"], "-y"],
  ["y", "e", ["adj"], ["n", "v"], "-y"],
  ["able", "", ["v"], ["adj"], "-able"],
  ["able", "e", ["v"], ["adj"], "-able"],
  ["iable", "y", ["v"], ["adj"], "-able"]
];
const IINATAN_ENGLISH_YOMITAN_PREFIX_RULES = [
  ["un", "", ["adj", "adv", "v"], ["adj", "adv", "v"], "un-"],
  ["going to ", "", ["v"], ["v"], "going-to future"],
  ["will ", "", ["v"], ["v"], "will future"],
  ["don't ", "", ["v"], ["v"], "imperative negative"],
  ["do not ", "", ["v"], ["v"], "imperative negative"]
];
const IINATAN_ENGLISH_YOMITAN_DOUBLED_SUFFIX_RULES = [
  ["bdgklmnprstz", "ed", ["v"], ["v"], "past"],
  ["bdgklmnprstz", "ing", ["v"], ["v"], "ing"],
  ["bdgmnt", "er", ["adj"], ["adj"], "comparative"],
  ["bdgmnt", "est", ["adj"], ["adj"], "superlative"],
  ["glmnprst", "y", [], ["n", "v"], "-y"],
  ["bdgklmnprstz", "able", ["v"], ["adj"], "-able"]
];
