const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/extract_release_notes.py');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinatan-release-notes-'));
const changelogPath = path.join(tempDir, 'CHANGELOG.md');

fs.writeFileSync(changelogPath, [
  '# Changelog',
  '',
  '## Unreleased',
  '',
  '### Changed',
  '',
  '- Work in progress.',
  '',
  '## 2.0.0 - 2026-06-14',
  '',
  '### Added',
  '',
  '- Added a release-note fixture.',
  '',
  '### Fixed',
  '',
  '- Fixed a release-note fixture.',
  '',
  '## 1.9.0 - 2026-06-13',
  '',
  '### Changed',
  '',
  '- Previous release.',
  '',
].join('\n'));

const output = execFileSync('python3', [script, 'v2.0.0', '--changelog', changelogPath], {
  encoding: 'utf8',
});
assert(output.includes('### Added'), 'release notes should include subsections');
assert(output.includes('- Added a release-note fixture.'), 'release notes should include matching entries');
assert(output.includes('### Fixed'), 'release notes should include the full matching version body');
assert(!output.includes('## 2.0.0'), 'release notes should omit the version heading');
assert(!output.includes('Unreleased'), 'release notes should omit unreleased notes');
assert(!output.includes('Previous release'), 'release notes should stop at the next version');

const missing = spawnSync('python3', [script, 'v9.9.9', '--changelog', changelogPath], {
  encoding: 'utf8',
});
assert(missing.status !== 0, 'missing changelog sections should fail');
assert(/No CHANGELOG\.md section/.test(missing.stderr), 'missing section failure should explain the problem');

console.log('release notes extraction tests passed');
