const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

class FakeClassList {
  constructor(el) { this.el = el; }
  _set() { return new Set(String(this.el.className || '').split(/\s+/).filter(Boolean)); }
  _write(set) { this.el.className = Array.from(set).join(' '); }
  add(...names) { const set = this._set(); names.forEach(name => set.add(name)); this._write(set); }
  remove(...names) { const set = this._set(); names.forEach(name => set.delete(name)); this._write(set); }
  contains(name) { return this._set().has(name); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.className = '';
    this.classList = new FakeClassList(this);
    this._textContent = '';
    this._innerHTML = '';
  }
  set textContent(value) {
    this._textContent = String(value || '');
    if (this.tagName !== '#text') this.children = [];
  }
  get textContent() {
    if (this.tagName === '#text') return this._textContent;
    return this._textContent || this.children.map(child => child.textContent).join('');
  }
  set innerHTML(value) { this._innerHTML = String(value || ''); this.children = []; }
  get innerHTML() { return this._innerHTML; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'data-pos') this.dataset.pos = String(value);
  }
  appendChild(child) {
    if (child.tagName === '#fragment') {
      child.children.slice().forEach(grandchild => this.appendChild(grandchild));
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, before) {
    child.parentNode = this;
    const index = this.children.indexOf(before);
    if (index >= 0) this.children.splice(index, 0, child);
    else this.children.unshift(child);
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    const visit = node => {
      node.children.forEach(child => {
        if (matchesSelector(child, selector)) out.push(child);
        visit(child);
      });
    };
    visit(this);
    return out;
  }
  getBoundingClientRect() {
    const pos = Number(this.dataset.pos || 0);
    if (this.tagName === 'subtitle') return { left: 100, top: 500, right: 500, bottom: 540, width: 400, height: 40 };
    if (this.tagName === 'popup') return { left: 0, top: 0, right: 260, bottom: 120, width: 260, height: 120 };
    return { left: 100 + pos * 10, top: 500, right: 108 + pos * 10, bottom: 526, width: 8, height: 26 };
  }
}

function matchesSelector(el, selector) {
  if (selector === '*') return true;
  if (selector === '.match-bg') return el.classList.contains('match-bg');
  if (selector === '.char.active-match') return el.classList.contains('char') && el.classList.contains('active-match');
  const posMatch = selector.match(/^\.char\.lookupable\[data-pos="(\d+)"\]$/);
  if (posMatch) return el.classList.contains('char') && el.classList.contains('lookupable') && el.dataset.pos === posMatch[1];
  if (selector[0] === '.') return el.classList.contains(selector.slice(1));
  return false;
}

function makeContext() {
  const elements = {
    subtitle: new FakeElement('subtitle'),
    popup: new FakeElement('popup'),
    status: new FakeElement('status'),
    task: new FakeElement('task')
  };
  elements.popup.classList.add('hidden');
  const sent = [];
  function FakeWebSocket() { this.readyState = FakeWebSocket.OPEN; }
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.prototype.send = function send(message) { sent.push(JSON.parse(message)); };
  FakeWebSocket.prototype.close = function close() { this.readyState = 3; };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    WebSocket: FakeWebSocket,
    window: { innerWidth: 1280, innerHeight: 720, addEventListener() {} },
    document: {
      documentElement: { style: { setProperty() {} } },
      addEventListener() {},
      getElementById(id) { return elements[id]; },
      createElement(tag) { return new FakeElement(tag); },
      createTextNode(text) { const node = new FakeElement('#text'); node.textContent = text; return node; },
      createDocumentFragment() { return new FakeElement('#fragment'); }
    },
    iina: {
      onMessage() {},
      postMessage() {}
    },
    __sent: sent
  };
  vm.createContext(context);
  return context;
}

let source = fs.readFileSync(path.join(root, 'src/overlay/overlay.js'), 'utf8');
source = source.replace(
  '  // Keep the documented ready message',
  '  globalThis.__overlayTest = { state, applyConfig, renderSubtitle, lookupPreviewForPosition, lookupUnitForPosition, subtitleEl, popupEl };' +
    '\n\n  // Keep the documented ready message'
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const context = makeContext();
vm.runInContext(source, context, { filename: 'overlay.js' });
const overlay = context.__overlayTest;
overlay.state.enabled = true;

function enter(pos) {
  const el = overlay.subtitleEl.querySelector('.char.lookupable[data-pos="' + String(pos) + '"]');
  assert(el, 'Expected hoverable element at ' + pos);
  el.listeners.mouseenter({ currentTarget: el });
  return el;
}

function lookupMessages() {
  return context.__sent.filter(message => message.type === 'lookup');
}

overlay.applyConfig({
  language: { id: 'en', label: 'English', lookupUnit: 'word', wordMode: 'latin-word' },
  overlayBridgePort: 19741,
  scanLength: 24,
  hoverRequestTimeoutMs: 5000
});
overlay.renderSubtitle('I was running quickly', 1);

const runningStart = 'I was '.length;
const runningEnd = runningStart + 'running'.length;
const quicklyStart = 'I was running '.length;

for (let i = runningStart; i < runningEnd; i++) {
  const unit = overlay.lookupUnitForPosition(i);
  assert(unit.pos === runningStart, 'Every running character should resolve to the word start');
  assert(unit.preview.start === runningStart && unit.preview.end === runningEnd, 'Every running character should resolve to the full word span');
}

const firstAnchor = enter(runningStart);
assert(lookupMessages().length === 1, 'First hover inside running should dispatch one lookup');
assert(lookupMessages()[0].position === runningStart, 'Running lookup should be anchored at the word start');
assert(overlay.state.currentAnchor === firstAnchor, 'Popup anchor should be the first character of running');

enter(runningStart + 1);
enter(runningStart + 4);
enter(runningEnd - 1);
assert(lookupMessages().length === 1, 'Moving within running should not dispatch another lookup');
assert(overlay.state.currentAnchor === firstAnchor, 'Moving within running should keep the same popup anchor');

const quicklyAnchor = enter(quicklyStart);
assert(lookupMessages().length === 2, 'Moving to a different word should dispatch a new lookup');
assert(lookupMessages()[1].position === quicklyStart, 'Quickly lookup should be anchored at its word start');
assert(overlay.state.currentAnchor === quicklyAnchor, 'Popup anchor should move for a different word');

overlay.applyConfig({
  language: { id: 'ja', label: 'Japanese', lookupUnit: 'character', wordMode: 'rightward-prefix' },
  overlayBridgePort: 19741,
  scanLength: 24
});
overlay.renderSubtitle('魔法使い', 2);
const beforeJapanese = lookupMessages().length;
enter(0);
enter(1);
const japaneseMessages = lookupMessages().slice(beforeJapanese);
assert(japaneseMessages.length === 2, 'Japanese adjacent characters should remain separate lookup targets');
assert(japaneseMessages[0].position === 0 && japaneseMessages[1].position === 1, 'Japanese should send exact character positions');

Object.keys(overlay.state.pendingLookupRequests || {}).forEach(key => {
  const req = overlay.state.pendingLookupRequests[key];
  if (req.retryTimer) clearInterval(req.retryTimer);
  if (req.timeoutTimer) clearTimeout(req.timeoutTimer);
});

console.log('overlay word unit tests passed');
