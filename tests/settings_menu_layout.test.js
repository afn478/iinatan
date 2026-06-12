const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const info = JSON.parse(fs.readFileSync(path.join(root, 'Info.json'), 'utf8'));
assert(info.preferenceDefaults.etymologyCollapseDefault === 'collapsed', 'Etymology should default collapsed globally');
assert(info.preferenceDefaults.wiktionaryEtymologyCollapseOverride === 'collapsed', 'Wiktionary/Kaikki override should default collapsed');
assert(Object.prototype.hasOwnProperty.call(info.preferenceDefaults, 'customPopupCss'), 'Custom popup CSS preference should exist');

const preferencesHtml = fs.readFileSync(path.join(root, 'preferences.html'), 'utf8');
assert(/data-pref="etymologyCollapseDefault"/.test(preferencesHtml), 'Preferences should expose global etymology collapse setting');
assert(/data-pref="wiktionaryEtymologyCollapseOverride"/.test(preferencesHtml), 'Preferences should expose Wiktionary/Kaikki collapse override');
assert(/data-pref="customPopupCss"/.test(preferencesHtml), 'Preferences should expose custom CSS setting');
assert(/<option value="zh">Chinese/.test(preferencesHtml), 'Preferences should expose Chinese lookup selection');
assert(/id="dictionaryList"/.test(preferencesHtml), 'Preferences should include installed dictionary management');
assert(/data-dictionary-index/.test(preferencesHtml), 'Preferences should render dictionary enable/disable controls');

const menuSource = fs.readFileSync(path.join(root, 'src/main/70_tests_menu.js'), 'utf8');
const rebuildMenu = menuSource.slice(menuSource.indexOf('function rebuildMenu()'));
assert(/Manage Installed Dictionaries in Settings/.test(rebuildMenu), 'Dictionary menu should point users to settings');
assert(!/for\s*\(\s*const\s+d\s+of\s+dicts\s*\)/.test(rebuildMenu), 'Dictionary menu should not list every installed dictionary');
assert(!/setDictionaryEnabled\(d\.name/.test(rebuildMenu), 'Dictionary menu should not toggle installed dictionaries directly');

console.log('settings and menu layout tests passed');
