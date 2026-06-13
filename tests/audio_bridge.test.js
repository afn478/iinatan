const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const execCalls = [];

const context = {
  console,
  dataRoot() { return '/data'; },
  compactError(error) { return error && error.message ? error.message : String(error); },
  debugVerbose() {},
  debugWarn() {},
  postToOverlay() {},
  utils: {
    async exec(command, args, cwd) {
      execCalls.push({ command, args, cwd });
      return {
        status: 0,
        stdout: JSON.stringify({
          type: 'audioSourceList',
          audioSources: [
            { name: 'NHK16', url: '/nhk16/audio/reading.opus' },
            { name: 'bad', url: 'ftp://example.invalid/audio.mp3' },
            { url: 'http://127.0.0.1:5050/jpod/audio.mp3' }
          ]
        }),
        stderr: ''
      };
    }
  }
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'src/main/50_overlay_bridge_pause.js'), 'utf8'), context);

(async () => {
  const candidates = await context.fetchAudioSourceCandidates('http://127.0.0.1:5050/?term=%E8%AA%AD%E3%82%80&reading=%E3%82%88%E3%82%80');
  assert(execCalls.length === 1, 'Audio source resolution should use one curl request');
  assert(execCalls[0].command === '/usr/bin/curl', 'Audio source resolution should use curl from the plugin process');
  assert(execCalls[0].args.includes('--location'), 'Audio source resolution should follow redirects');
  assert(execCalls[0].args.includes('--max-time'), 'Audio source resolution should have a network timeout');
  assert(candidates.length === 2, 'Audio source resolution should keep only playable http/https candidates');
  assert(candidates[0].name === 'NHK16', 'Audio source resolution should preserve candidate names');
  assert(candidates[0].url === 'http://127.0.0.1:5050/nhk16/audio/reading.opus', 'Relative audio URLs should resolve against the source URL');
  assert(candidates[1].url === 'http://127.0.0.1:5050/jpod/audio.mp3', 'Absolute audio URLs should pass through');

  console.log('audio bridge tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
