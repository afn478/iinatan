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
assert(!/id="dictionaryList"/.test(preferencesHtml), 'Preferences should not own installed dictionary management');
assert(/Manage Dictionaries/.test(preferencesHtml), 'Preferences should point users to the dictionary manager');

const managerHtml = fs.readFileSync(path.join(root, 'dictionary-manager.html'), 'utf8');
assert(/id="dictionaryList"/.test(managerHtml), 'Dictionary manager should include the installed dictionary list');
assert(/dictionary-manager-set-enabled/.test(managerHtml), 'Dictionary manager should toggle dictionary enabled state');
assert(/dictionary-manager-set-order/.test(managerHtml), 'Dictionary manager should save dictionary order');
assert(/dictionary-manager-delete/.test(managerHtml), 'Dictionary manager should expose per-dictionary deletion');
assert(/Delete/.test(managerHtml), 'Dictionary manager rows should include a delete button');
assert(/Download Recommended Dictionaries/.test(managerHtml), 'Dictionary manager should expose recommended dictionary download');
assert(/Import ZIP/.test(managerHtml), 'Dictionary manager should expose ZIP import');
assert(/typeof iina !== 'undefined'/.test(managerHtml), 'Dictionary manager should use the IINA webview message bridge');
assert(/id="profileSelect"/.test(managerHtml), 'Dictionary manager should expose profile selection');
assert(!/Import from Folder/.test(managerHtml), 'Dictionary manager should not expose manual folder import');
assert(!/Reveal Folder/.test(managerHtml), 'Dictionary manager should not expose manual folder reveal');
assert(
  /dictionary-manager-import-zip', \{\}, 'Opening ZIP picker\.\.\.', \{ busy: false, clearAfterMs: 5000 \}/.test(managerHtml),
  'Dictionary manager should not lock the UI while the ZIP picker is open'
);
assert(/clearAfterMs/.test(managerHtml), 'Transient dictionary manager statuses should be able to clear themselves');

const menuSource = fs.readFileSync(path.join(root, 'src/main/70_tests_menu.js'), 'utf8');
const rebuildMenu = menuSource.slice(menuSource.indexOf('function rebuildMenu()'));
assert(/Manage Dictionaries/.test(rebuildMenu), 'Dictionary menu should open the dictionary manager');
assert(/Download Recommended Dictionaries/.test(rebuildMenu), 'Dictionary menu should use the recommended dictionaries label');
assert(/setActiveDictionaryProfile/.test(rebuildMenu), 'Dictionary menu should be prepared to switch profiles');
assert(!/for\s*\(\s*const\s+d\s+of\s+dicts\s*\)/.test(rebuildMenu), 'Dictionary menu should not list every installed dictionary');
assert(!/setDictionaryEnabled\(d\.name/.test(rebuildMenu), 'Dictionary menu should not toggle installed dictionaries directly');
assert(!/Import Yomitan Dictionary ZIP/.test(rebuildMenu), 'Dictionary ZIP import should live in the manager window');
assert(!/Import ZIP from Manual Import Folder/.test(rebuildMenu), 'Manual folder import should not be in the menu');

const managerBridgeSource = fs.readFileSync(path.join(root, 'src/main/65_dictionary_manager_window.js'), 'utf8');
const openDictionaryManagerSource = managerBridgeSource.slice(managerBridgeSource.indexOf('function openDictionaryManager()'));
assert(
  openDictionaryManagerSource.indexOf('standaloneWindow.loadFile("dictionary-manager.html")') < openDictionaryManagerSource.indexOf('registerDictionaryManagerHandlers()'),
  'Dictionary manager should load its webview before registering message handlers'
);
assert(/postDictionaryManagerStatus\("Dictionary selection saved\."/.test(managerBridgeSource), 'Dictionary manager toggles should acknowledge persistence');
assert(/dictionary-manager-delete/.test(managerBridgeSource), 'Dictionary manager should handle delete commands');
assert(/deleteDictionary\(String\(name\)\)/.test(managerBridgeSource), 'Dictionary manager delete commands should remove installed dictionaries');
assert(/function runDictionaryManagerZipImport\(\)/.test(managerBridgeSource), 'Dictionary ZIP import should use a picker-aware action path');
assert(!/postDictionaryManagerStatus\("Opening ZIP picker\.\.\."/.test(managerBridgeSource), 'ZIP picker opening status should be transient webview state only');
assert(/Dictionary import cancelled\./.test(managerBridgeSource), 'Dictionary manager should acknowledge cancelled ZIP imports');
assert(!/runDictionaryManagerAction\("Importing dictionary"/.test(managerBridgeSource), 'ZIP import should not enter busy state before file selection');

console.log('settings and menu layout tests passed');
