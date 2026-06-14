const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { URL } = require('url');

const root = path.resolve(__dirname, '../..');

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
    this.focused = false;
    this._textContent = '';
    this._innerHTML = '';
    this.id = '';
  }
  focus() { this.focused = true; }
  set textContent(value) {
    this._textContent = String(value || '');
    if (this.tagName !== '#text') this.children = [];
  }
  get textContent() {
    if (this.tagName === '#text') return this._textContent;
    return this._textContent || this.children.map(child => child.textContent).join('');
  }
  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.children = [];
    this._materializePopupShell();
  }
  get innerHTML() { return this._innerHTML; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'data-pos') this.dataset.pos = String(value);
  }
  getAttribute(name) { return this.attributes[name] || ''; }
  appendChild(child) {
    if (child.tagName === '#fragment') {
      child.children.slice().forEach(grandchild => this.appendChild(grandchild));
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  _materializePopupShell() {
    if (this.tagName !== 'popup') return;
    const html = this._innerHTML;
    const headOpen = html.indexOf('<div class="head">');
    const bodyOpen = html.indexOf('<div class="body">');
    if (headOpen < 0 || bodyOpen < 0 || bodyOpen < headOpen) return;
    const headContentStart = headOpen + '<div class="head">'.length;
    const headContentEnd = html.indexOf('</div>', headContentStart);
    if (headContentEnd < 0) return;
    const bodyContentStart = bodyOpen + '<div class="body">'.length;
    const bodyContentEnd = html.lastIndexOf('</div>');
    if (bodyContentEnd < bodyContentStart) return;
    const head = new FakeElement('div');
    head.className = 'head';
    head._innerHTML = html.slice(headContentStart, headContentEnd);
    head.parentNode = this;
    const body = new FakeElement('div');
    body.className = 'body';
    body._innerHTML = html.slice(bodyContentStart, bodyContentEnd);
    body.parentNode = this;
    this.children = [head, body];
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
    if (this._rect) return this._rect;
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

function makeOverlayContext(options) {
  options = options || {};
  const elements = {
    subtitle: new FakeElement('subtitle'),
    popup: new FakeElement('popup'),
    status: new FakeElement('status'),
    task: new FakeElement('task')
  };
  elements.popup.classList.add('hidden');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const rootStyle = {
    setProperty(name, value) { this[name] = String(value); }
  };
  const sent = [];
  const posted = [];
  const handlers = Object.create(null);
  const sockets = [];
  function FakeWebSocket(url) {
    this.url = url;
    this.readyState = options.autoOpenWebSocket === false ? FakeWebSocket.CONNECTING : FakeWebSocket.OPEN;
    sockets.push(this);
  }
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.prototype.send = function send(message) { sent.push(JSON.parse(message)); };
  FakeWebSocket.prototype.close = function close() { this.readyState = 3; };

  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    WebSocket: FakeWebSocket,
    window: { innerWidth: 1280, innerHeight: 720, addEventListener() {} },
    document: {
      body,
      head,
      documentElement: { style: rootStyle },
      addEventListener() {},
      getElementById(id) { return elements[id]; },
      createElement(tag) { return new FakeElement(tag); },
      createTextNode(text) { const node = new FakeElement('#text'); node.textContent = text; return node; },
      createDocumentFragment() { return new FakeElement('#fragment'); }
    },
    iina: {
      onMessage(name, handler) { handlers[name] = handler; },
      postMessage(name, payload) {
        if (options.postMessageThrows) throw new Error('postMessage unavailable');
        posted.push({ name, payload });
      }
    },
    __elements: elements,
    __body: body,
    __head: head,
    __sent: sent,
    __posted: posted,
    __handlers: handlers,
    __sockets: sockets,
    __openSocket(index) {
      const socket = sockets[index == null ? sockets.length - 1 : index];
      if (!socket) throw new Error('No fake WebSocket to open');
      socket.readyState = FakeWebSocket.OPEN;
      if (typeof socket.onopen === 'function') socket.onopen();
      return socket;
    }
  };
  vm.createContext(context);
  return context;
}

function loadOverlayForTest(exportList, options) {
  const context = makeOverlayContext(options);
  const exports = Array.isArray(exportList) ? exportList.join(', ') : String(exportList || '');
  let source = fs.readFileSync(path.join(root, 'src/overlay/overlay.js'), 'utf8');
  source = source.replace(
    '  // Keep the documented ready message',
    '  globalThis.__overlayTest = { ' + exports + ' };' +
      '\n\n  // Keep the documented ready message'
  );
  vm.runInContext(source, context, { filename: 'overlay.js' });
  return { context, overlay: context.__overlayTest };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

module.exports = {
  root,
  assert,
  FakeClassList,
  FakeElement,
  makeOverlayContext,
  loadOverlayForTest
};
