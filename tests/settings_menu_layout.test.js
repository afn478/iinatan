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
assert(!/data-pref=/.test(preferencesHtml), 'IINA preferences page should not own profile settings');
assert(!/id="dictionaryList"/.test(preferencesHtml), 'Preferences should not own installed dictionary management');
assert(/Plugins -&gt; iinatan -&gt; Settings/.test(preferencesHtml) || /Plugins -> iinatan -> Settings/.test(preferencesHtml), 'Preferences should point users to iinatan Settings');

const managerHtml = fs.readFileSync(path.join(root, 'dictionary-manager.html'), 'utf8');
assert(/iinatan Settings/.test(managerHtml), 'Settings manager should use the plugin settings title');
assert(/data-profile-pref="lookupLanguage"/.test(managerHtml), 'Settings manager should expose per-profile language');
assert(/data-profile-pref="pauseWhilePopupVisible"/.test(managerHtml), 'Settings manager should expose per-profile playback settings');
assert(/data-profile-pref="scanLength"/.test(managerHtml), 'Settings manager should expose per-profile scan length');
assert(/data-profile-pref="customPopupCss"/.test(managerHtml), 'Settings manager should expose per-profile custom popup CSS');
assert(/data-global-setting="lowRamImport"/.test(managerHtml), 'Settings manager should expose global dictionary import settings');
assert(/id="dictionaryList"/.test(managerHtml), 'Dictionary manager should include the installed dictionary list');
assert(/dictionary-manager-set-enabled/.test(managerHtml), 'Dictionary manager should toggle dictionary enabled state');
assert(/dictionary-manager-set-order/.test(managerHtml), 'Dictionary manager should save dictionary order');
assert(/dictionary-manager-delete/.test(managerHtml), 'Dictionary manager should expose per-dictionary deletion');
assert(/dictionary-manager-create-profile/.test(managerHtml), 'Settings manager should create profiles');
assert(/dictionary-manager-rename-profile/.test(managerHtml), 'Settings manager should rename profiles');
assert(/dictionary-manager-delete-profile/.test(managerHtml), 'Settings manager should delete profiles');
assert(/Delete/.test(managerHtml), 'Dictionary manager rows should include a delete button');
assert(/id="recommendedList"/.test(managerHtml), 'Settings manager should expose a recommended downloads list');
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
assert(/Settings/.test(rebuildMenu), 'iinatan menu should open plugin settings');
assert(/setActiveDictionaryProfile/.test(rebuildMenu), 'Dictionary menu should be prepared to switch profiles');
assert(/const rootMenu = menu\.item\("iinatan"\)/.test(rebuildMenu), 'iinatan menu should be a submenu root');
assert(/menu\.item\("profiles", null, \{ enabled: false \}\)/.test(rebuildMenu), 'iinatan submenu should label the profile section with a small lowercase native label');
assert(/const inlineProfileLimit = 5/.test(rebuildMenu), 'iinatan submenu should keep up to five profiles inline');
assert(/profiles\.length > inlineProfileLimit/.test(rebuildMenu), 'iinatan submenu should only add More after the inline profile limit is exceeded');
assert(/const moreMenu = menu\.item\("More"\)/.test(rebuildMenu), 'iinatan submenu should add a More submenu for overflow profiles');
assert(
  rebuildMenu.indexOf('menu.item("profiles", null') < rebuildMenu.indexOf('const debugMenu = menu.item("Debug")'),
  'Debug should appear after the profile section'
);
assert(
  rebuildMenu.indexOf('addSubMenuItemCompat(rootMenu, menu.separator());\n    const debugMenu = menu.item("Debug")') > 0,
  'Debug should be separated from profiles by a native separator'
);
assert(!/menu\.item\("Dictionaries"/.test(rebuildMenu), 'iinatan menu should not nest profile switching under a Dictionaries submenu');
assert(!/Download Recommended Dictionaries/.test(rebuildMenu), 'Recommended downloads should live in settings, not the top menu');
assert(!/Toggle iinatan/.test(rebuildMenu), 'iinatan submenu should not place the toggle between profiles and Debug');
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
assert(/iinatan Settings/.test(openDictionaryManagerSource), 'Settings window should use the plugin settings title');
assert(/postDictionaryManagerStatus\("Dictionary selection saved\."/.test(managerBridgeSource), 'Dictionary manager toggles should acknowledge persistence');
assert(/dictionary-manager-delete/.test(managerBridgeSource), 'Dictionary manager should handle delete commands');
assert(/dictionary-manager-rename-profile/.test(managerBridgeSource), 'Settings manager should handle profile rename commands');
assert(/dictionary-manager-delete-profile/.test(managerBridgeSource), 'Settings manager should handle profile delete commands');
assert(/dictionary-manager-update-global-settings/.test(managerBridgeSource), 'Settings manager should handle global import settings');
assert(/deleteDictionary\(String\(name\)\)/.test(managerBridgeSource), 'Dictionary manager delete commands should remove installed dictionaries');
assert(/function runDictionaryManagerZipImport\(\)/.test(managerBridgeSource), 'Dictionary ZIP import should use a picker-aware action path');
assert(!/postDictionaryManagerStatus\("Opening ZIP picker\.\.\."/.test(managerBridgeSource), 'ZIP picker opening status should be transient webview state only');
assert(/Dictionary import cancelled\./.test(managerBridgeSource), 'Dictionary manager should acknowledge cancelled ZIP imports');
assert(!/runDictionaryManagerAction\("Importing dictionary"/.test(managerBridgeSource), 'ZIP import should not enter busy state before file selection');

const lifecycleSource = fs.readFileSync(path.join(root, 'src/main/60_overlay_lifecycle_toggle.js'), 'utf8');
assert(/function reloadOverlayForProfileChange\(\)/.test(lifecycleSource), 'Profile changes should be able to reload the overlay');
assert(/function videoWindowAvailableForOverlayLoad\(\)/.test(lifecycleSource), 'Profile overlay reload should have a video-window availability guard');
assert(/core\.window\.loaded/.test(lifecycleSource), 'Profile overlay reload should check IINA window availability before overlay.loadFile');
assert(
  lifecycleSource.indexOf('if (!videoWindowAvailableForOverlayLoad())') < lifecycleSource.indexOf('initializeOverlay();'),
  'Profile overlay reload should skip initializeOverlay before iina.window-loaded'
);

console.log('settings and menu layout tests passed');
