const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function checkScript(label, source) {
  try {
    new vm.Script(source, { filename: label });
  } catch (error) {
    error.message = label + ': ' + error.message;
    throw error;
  }
}

checkScript('main.js', fs.readFileSync(path.join(root, 'main.js'), 'utf8'));
checkScript('global.js', fs.readFileSync(path.join(root, 'global.js'), 'utf8'));

const overlayHtml = fs.readFileSync(path.join(root, 'overlay.html'), 'utf8');
const scripts = Array.from(overlayHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)).map(match => match[1]);
if (!scripts.length) throw new Error('overlay.html: no script tag found');
scripts.forEach((script, index) => checkScript('overlay.html script #' + (index + 1), script));

const preferencesHtml = fs.readFileSync(path.join(root, 'preferences.html'), 'utf8');
const preferenceScripts = Array.from(preferencesHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)).map(match => match[1]);
if (!preferenceScripts.length) throw new Error('preferences.html: no script tag found');
preferenceScripts.forEach((script, index) => checkScript('preferences.html script #' + (index + 1), script));

const managerHtml = fs.readFileSync(path.join(root, 'dictionary-manager.html'), 'utf8');
const managerScripts = Array.from(managerHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)).map(match => match[1]);
if (!managerScripts.length) throw new Error('dictionary-manager.html: no script tag found');
managerScripts.forEach((script, index) => checkScript('dictionary-manager.html script #' + (index + 1), script));

console.log('generated syntax checks passed');
