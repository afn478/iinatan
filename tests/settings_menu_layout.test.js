const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const info = JSON.parse(fs.readFileSync(path.join(root, 'Info.json'), 'utf8'));
assert(info.preferenceDefaults.etymologyCollapseDefault === 'collapsed', 'Etymology should default collapsed globally');
assert(info.preferenceDefaults.wiktionaryEtymologyCollapseOverride === 'collapsed', 'Wiktionary/Kaikki override should default collapsed');
assert(info.preferenceDefaults.popupTheme === 'inherit', 'Popup theme should default to inheriting IINA appearance');
assert(Object.prototype.hasOwnProperty.call(info.preferenceDefaults, 'customPopupCss'), 'Custom popup CSS preference should exist');
assert(info.preferenceDefaults.audioAutoPlay === false, 'Word audio auto-play should default off');
assert(/127\.0\.0\.1:5050/.test(info.preferenceDefaults.audioSourcesJson), 'Word audio should default to the local Anki audio server');
assert(info.preferenceDefaults.ankiEnabled === false, 'Anki export should default off');
assert(info.preferenceDefaults.ankiConnectUrl === 'http://127.0.0.1:8765', 'AnkiConnect should default to the local AnkiConnect server');
assert(info.preferenceDefaults.ankiAudioFormat === 'mp3', 'Sentence audio should default to MP3');
assert(info.preferenceDefaults.ankiAudioBitrateKbps === 96, 'Sentence audio bitrate should default to 96 kbps');
assert(info.preferenceDefaults.ankiImageQuality === 85, 'Screenshot JPEG quality should default to 85 percent');
assert(info.preferenceDefaults.ankiDuplicateCheck === true, 'Anki duplicate checking should default on');

const preferencesHtml = fs.readFileSync(path.join(root, 'preferences.html'), 'utf8');
assert(!/data-pref=/.test(preferencesHtml), 'IINA preferences page should not own profile settings');
assert(!/id="dictionaryList"/.test(preferencesHtml), 'Preferences should not own installed dictionary management');
assert(/Plugins -&gt; iinatan -&gt; Settings/.test(preferencesHtml) || /Plugins -> iinatan -> Settings/.test(preferencesHtml), 'Preferences should point users to iinatan Settings');

const managerHtml = fs.readFileSync(path.join(root, 'dictionary-manager.html'), 'utf8');
assert(/iinatan Settings/.test(managerHtml), 'Settings manager should use the plugin settings title');
assert(/data-profile-pref="lookupLanguage"/.test(managerHtml), 'Settings manager should expose per-profile language');
assert(/data-profile-pref="pauseWhilePopupVisible"/.test(managerHtml), 'Settings manager should expose per-profile playback settings');
assert(/data-profile-pref="audioAutoPlay"/.test(managerHtml), 'Settings manager should expose per-profile word audio auto-play');
assert(/id="audioSourceList"/.test(managerHtml), 'Settings manager should expose the word audio source list');
assert(/moveAudioSourceBefore/.test(managerHtml), 'Audio source priorities should support drag reordering');
assert(/audioSourcesJson/.test(managerHtml), 'Audio source priorities should be saved with profile preferences');
assert(/data-tab="anki"/.test(managerHtml), 'Settings manager should expose an Anki tab');
assert(/id="ankiModelName" data-profile-pref="ankiModelName"/.test(managerHtml), 'Anki settings should expose the note type dropdown');
assert(/id="ankiDeckName" data-profile-pref="ankiDeckName"/.test(managerHtml), 'Anki settings should expose the deck dropdown');
assert(/id="ankiConnectUrl" data-profile-pref="ankiConnectUrl"/.test(managerHtml), 'Anki settings should expose the AnkiConnect URL');
assert(/id="ankiReachability"/.test(managerHtml), 'Anki settings should show AnkiConnect reachability');
assert(/id="ankiFieldList"/.test(managerHtml), 'Anki settings should render note fields dynamically');
assert(/serializeAnkiFieldTemplates/.test(managerHtml), 'Anki field templates should be saved with profile preferences');
assert(/lapisTemplateForField/.test(managerHtml), 'Anki settings should attempt Lapis autofill');
assert(/language !== 'ja' && language !== 'zh'/.test(managerHtml), 'Lapis autofill should explicitly include Chinese profiles');
assert(/data-profile-pref="ankiDuplicateMode"/.test(managerHtml), 'Anki settings should expose duplicate behavior');
assert(/data-profile-pref="ankiAudioFormat"/.test(managerHtml), 'Anki settings should expose sentence audio format');
assert(/data-profile-pref="ankiAudioBitrateKbps"/.test(managerHtml), 'Anki settings should expose sentence audio bitrate');
assert(/data-profile-pref="ankiImageQuality"/.test(managerHtml), 'Anki settings should expose screenshot JPEG quality');
const addAudioSourceSource = managerHtml.slice(managerHtml.indexOf('function addAudioSource()'), managerHtml.indexOf('function updateAudioSourceUrl'));
assert(/firstSource\s*=\s*state\.audioSources\.length\s*===\s*0/.test(addAudioSourceSource), 'Adding audio sources should distinguish empty lists from custom additions');
assert(/url:\s*firstSource\s*\?\s*DEFAULT_AUDIO_SOURCE_URL\s*:\s*''/.test(addAudioSourceSource), 'The first audio source after deleting all sources should restore the local Anki source');
assert(/if\s*\(firstSource\)\s*saveAudioSources\(\)/.test(addAudioSourceSource), 'Restored local audio sources should be saved immediately');
assert(/data-profile-pref="scanLength"/.test(managerHtml), 'Settings manager should expose per-profile scan length');
assert(/data-profile-pref="popupTheme"/.test(managerHtml), 'Settings manager should expose per-profile popup color mode');
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
assert(/id="openRecommended"/.test(managerHtml), 'Settings manager should open recommended downloads from a foreground panel button');
assert(/id="recommendedDialogBackdrop"/.test(managerHtml), 'Recommended downloads should live in an in-window foreground panel');
assert(/Get recommended dictionaries\.\.\./.test(managerHtml), 'Settings manager should label the recommended downloads opener');
assert(/item\.installed \? 'Update' : 'Download'/.test(managerHtml), 'Installed recommended downloads should be labeled as updates');
assert(/Recommended Dictionaries/.test(managerHtml), 'Recommended downloads panel title should be language-neutral');
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
assert(/menu\.item\("Profiles", null, \{ enabled: false \}\)/.test(rebuildMenu), 'iinatan submenu should label the profile section');
assert(/const inlineProfileLimit = 5/.test(rebuildMenu), 'iinatan submenu should keep up to five profiles inline');
assert(/profiles\.length > inlineProfileLimit/.test(rebuildMenu), 'iinatan submenu should only add More after the inline profile limit is exceeded');
assert(/const moreMenu = menu\.item\("More"\)/.test(rebuildMenu), 'iinatan submenu should add a More submenu for overflow profiles');
assert(
  rebuildMenu.indexOf('menu.item("Profiles", null') < rebuildMenu.indexOf('const debugMenu = menu.item("Debug")'),
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
assert(/function runMenuAction\(label, action\)/.test(menuSource), 'Top menu actions should go through the guarded menu wrapper');
assert(/isPromiseLike\(result\)/.test(menuSource), 'Menu wrapper should catch async action failures');
assert(/addDebugMenuItem\(debugMenu, "Test File Picker API"/.test(rebuildMenu), 'Debug menu entries should use the guarded debug item helper');
assert(/function revealPathInFinder\(path, label\)/.test(menuSource), 'Debug reveal actions should share one reveal helper');
assert(/utils\.open\(p\)/.test(menuSource), 'Debug reveal actions should prefer the documented utils.open path');
assert(!/file\.showInFinder\(dataRoot\(\)\)/.test(rebuildMenu), 'Plugin data folder reveal should not rely on the older direct Finder call');

const managerBridgeSource = fs.readFileSync(path.join(root, 'src/main/65_dictionary_manager_window.js'), 'utf8');
const contextSource = fs.readFileSync(path.join(root, 'src/main/00_context_state_paths.js'), 'utf8');
assert(/JMnedict\.zip/.test(contextSource), 'Japanese recommendations should include JMnedict');
assert(/BCCWJ_SUW_LUW_combined\.zip/.test(contextSource), 'Japanese recommendations should include BCCWJ SUW/LUW Combined');
assert(/JPDB_v2\.2_Frequency_Kana\.zip/.test(contextSource), 'Japanese recommendations should include JPDB v2.2 Kana');
assert(/api\.jiten\.moe\/api\/frequency-list\/download\?downloadType=yomitan/.test(contextSource), 'Japanese recommendations should use Yomitan-compatible Jiten Global download URL');
assert(/wty-en-en\.zip/.test(contextSource), 'English recommendations should include Yomitan Wiktionary terms');
assert(/wty-de-en\.zip/.test(contextSource), 'German recommendations should include Yomitan Wiktionary terms');
assert(/wty-fr-en\.zip/.test(contextSource), 'French recommendations should include Yomitan Wiktionary terms');
assert(/wty-ko-en\.zip/.test(contextSource), 'Korean recommendations should include Yomitan Wiktionary terms');
assert(/CC-CEDICT\.zip/.test(contextSource), 'Chinese recommendations should include CC-CEDICT terms');
assert(/wty-zh-en\.zip/.test(contextSource), 'Chinese recommendations should include Yomitan Wiktionary terms');
assert(!/KANJIDIC_english\.zip/.test(contextSource), 'Recommended downloads should not include Japanese character dictionaries');
assert(!/hanzi/i.test(contextSource), 'Recommended downloads should not include Hanzi character dictionaries');
assert(/recommendedDictionariesForLanguage\(lookupLanguage, dicts\)/.test(managerBridgeSource), 'Recommended dictionaries should follow the active profile language');
assert(/getRecommendedDictionaries\(requestedId\)/.test(managerBridgeSource), 'Recommended downloads should pass the selected dictionary id');
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
assert(/dictionary-manager-anki-refresh/.test(managerBridgeSource), 'Settings manager should refresh AnkiConnect state');
assert(/deleteDictionary\(String\(name\)\)/.test(managerBridgeSource), 'Dictionary manager delete commands should remove installed dictionaries');
assert(/function runDictionaryManagerZipImport\(\)/.test(managerBridgeSource), 'Dictionary ZIP import should use a picker-aware action path');
assert(!/postDictionaryManagerStatus\("Opening ZIP picker\.\.\."/.test(managerBridgeSource), 'ZIP picker opening status should be transient webview state only');
assert(/Dictionary import cancelled\./.test(managerBridgeSource), 'Dictionary manager should acknowledge cancelled ZIP imports');
assert(!/runDictionaryManagerAction\("Importing dictionary"/.test(managerBridgeSource), 'ZIP import should not enter busy state before file selection');

const ankiSource = fs.readFileSync(path.join(root, 'src/main/55_anki_integration.js'), 'utf8');
assert(/function ankiTemplatesNeedMedia/.test(ankiSource), 'Anki integration should check templates before media capture');
assert(/needs\.screenshot/.test(ankiSource), 'Anki integration should gate screenshot capture on mapped screenshot fields');
assert(/needs\.sentenceAudio/.test(ankiSource), 'Anki integration should gate subtitle audio capture on mapped audio fields');
assert(/Promise\.all\(jobs\)/.test(ankiSource), 'Anki integration should capture screenshot and sentence audio in parallel when both are needed');
assert(/mpv\.command\("screenshot-to-file"/.test(ankiSource), 'Anki integration should capture screenshots through mpv');
assert(/screenshot-jpeg-quality/.test(ankiSource), 'Anki screenshots should set JPEG quality for capture');
assert(/"-ss"/.test(ankiSource) && /"-t"/.test(ankiSource) && /"-map"/.test(ankiSource), 'Sentence audio extraction should use fast bounded audio-only ffmpeg arguments');
assert(/normalizeAnkiAudioBitrateKbps/.test(ankiSource) && /"-b:a"/.test(ankiSource), 'Sentence audio extraction should use the configured bitrate');
assert(/"-nostdin"/.test(ankiSource) && /"-loglevel"/.test(ankiSource), 'Sentence audio extraction should suppress unnecessary ffmpeg work and output');
assert(/ankiModelFieldCache/.test(ankiSource), 'Anki integration should cache note field names for repeated popup actions');
assert(/guiBrowse/.test(ankiSource), 'Anki duplicate handling should be able to open existing notes');
assert(/allowDuplicate/.test(ankiSource), 'Anki duplicate settings should be passed to addNote');

const overlayBridgeSource = fs.readFileSync(path.join(root, 'src/main/50_overlay_bridge_pause.js'), 'utf8');
assert(/anki-card-status/.test(overlayBridgeSource), 'Overlay bridge should handle Anki status checks');
assert(/anki-card-add/.test(overlayBridgeSource), 'Overlay bridge should handle Anki add requests');
assert(/anki-card-open/.test(overlayBridgeSource), 'Overlay bridge should handle Anki open-existing requests');

const overlaySource = fs.readFileSync(path.join(root, 'src/overlay/overlay.js'), 'utf8');
assert(/class="anki-button"/.test(overlaySource), 'Overlay should render an Anki action button');
assert(/anki-card-status/.test(overlaySource), 'Overlay should request duplicate status for Anki buttons');
assert(/anki-card-open/.test(overlaySource), 'Overlay should open duplicates from the Anki button');
assert(/duplicateKnown/.test(overlaySource), 'Overlay should reuse duplicate preflight state on add');
assert(/right-click to open existing/.test(overlaySource), 'Anki add-anyway mode should still expose open-existing behavior');

const lifecycleSource = fs.readFileSync(path.join(root, 'src/main/60_overlay_lifecycle_toggle.js'), 'utf8');
assert(/function reloadOverlayForProfileChange\(\)/.test(lifecycleSource), 'Profile changes should be able to reload the overlay');
assert(/function videoWindowAvailableForOverlayLoad\(\)/.test(lifecycleSource), 'Profile overlay reload should have a video-window availability guard');
assert(/core\.window\.loaded/.test(lifecycleSource), 'Profile overlay reload should check IINA window availability before overlay.loadFile');
assert(
  lifecycleSource.indexOf('if (!videoWindowAvailableForOverlayLoad())') < lifecycleSource.indexOf('initializeOverlay();'),
  'Profile overlay reload should skip initializeOverlay before iina.window-loaded'
);

console.log('settings and menu layout tests passed');
