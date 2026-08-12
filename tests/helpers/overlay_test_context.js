const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { URL } = require("url");

const root = path.resolve(__dirname, "../..");
const policyContext = {};
vm.createContext(policyContext);
vm.runInContext(
  fs.readFileSync(
    path.join(root, "src/languages/lookup_character_policy.js"),
    "utf8",
  ) +
    "\nglobalThis.__lookupCharacterPolicies = " +
    "IINATAN_LOOKUP_CHARACTER_POLICY.policies;",
  policyContext,
);
const lookupCharacterPolicies = JSON.parse(
  JSON.stringify(policyContext.__lookupCharacterPolicies),
);

class FakeClassList {
  constructor(el) {
    this.el = el;
  }
  _set() {
    return new Set(
      String(this.el.className || "")
        .split(/\s+/)
        .filter(Boolean),
    );
  }
  _write(set) {
    this.el.className = Array.from(set).join(" ");
  }
  add(...names) {
    const set = this._set();
    names.forEach((name) => set.add(name));
    this._write(set);
  }
  remove(...names) {
    const set = this._set();
    names.forEach((name) => set.delete(name));
    this._write(set);
  }
  contains(name) {
    return this._set().has(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.style = {
      setProperty(name, value) {
        this[name] = String(value);
      },
    };
    this.className = "";
    this.classList = new FakeClassList(this);
    this.focused = false;
    this._textContent = "";
    this._innerHTML = "";
    this.id = "";
  }
  focus() {
    this.focused = true;
  }
  set textContent(value) {
    this._textContent = String(value || "");
    if (this.tagName !== "#text") {
      this.children = [];
      if (this._textContent) {
        const child = new FakeElement("#text");
        child._textContent = this._textContent;
        child.parentNode = this;
        this.children.push(child);
      }
    }
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get childNodes() {
    return this.children;
  }
  get textContent() {
    if (this.tagName === "#text") return this._textContent;
    return (
      this._textContent ||
      this.children.map((child) => child.textContent).join("")
    );
  }
  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.children = [];
    this._materializePopupShell();
  }
  get innerHTML() {
    return this._innerHTML;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "data-pos") this.dataset.pos = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] || "";
  }
  appendChild(child) {
    if (child.tagName === "#fragment") {
      child.children
        .slice()
        .forEach((grandchild) => this.appendChild(grandchild));
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  _materializePopupShell() {
    if (
      this.tagName !== "popup" &&
      !(this.classList && this.classList.contains("lookup-popup"))
    )
      return;
    const html = this._innerHTML;
    const headOpen = html.indexOf('<div class="head">');
    const bodyOpen = html.indexOf('<div class="body">');
    if (headOpen < 0 || bodyOpen < 0 || bodyOpen < headOpen) return;
    const headContentStart = headOpen + '<div class="head">'.length;
    const headContentEnd = html.indexOf("</div>", headContentStart);
    if (headContentEnd < 0) return;
    const bodyContentStart = bodyOpen + '<div class="body">'.length;
    const bodyContentEnd = html.lastIndexOf("</div>");
    if (bodyContentEnd < bodyContentStart) return;
    const head = new FakeElement("div");
    head.className = "head";
    head._innerHTML = html.slice(headContentStart, headContentEnd);
    head.parentNode = this;
    const body = new FakeElement("div");
    body.className = "body";
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
    this.parentNode.children = this.parentNode.children.filter(
      (child) => child !== this,
    );
    this.parentNode = null;
  }
  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
  attachShadow(init) {
    const shadow = new FakeElement("#shadow-root");
    shadow.host = this;
    shadow.mode = (init && init.mode) || "open";
    this.shadowRoot = shadow;
    return shadow;
  }
  getElementById(id) {
    if (this.id === id) return this;
    for (const child of this.children) {
      const found = child.getElementById(id);
      if (found) return found;
    }
    return null;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (matchesSelector(child, selector)) out.push(child);
        visit(child);
      });
    };
    visit(this);
    return out;
  }
  getBoundingClientRect() {
    if (this._rect) return this._rect;
    if (
      this.tagName === "html" ||
      this.tagName === "body" ||
      this.tagName === "root"
    )
      return {
        left: 0,
        top: 0,
        right: 1280,
        bottom: 720,
        width: 1280,
        height: 720,
      };
    const pos = Number(this.dataset.pos || 0);
    if (this.tagName === "subtitle")
      return {
        left: 100,
        top: 500,
        right: 500,
        bottom: 540,
        width: 400,
        height: 40,
      };
    if (
      this.tagName === "popup" ||
      (this.classList && this.classList.contains("lookup-popup"))
    )
      return {
        left: 0,
        top: 0,
        right: 260,
        bottom: 120,
        width: 260,
        height: 120,
      };
    return {
      left: 100 + pos * 10,
      top: 500,
      right: 108 + pos * 10,
      bottom: 526,
      width: 8,
      height: 26,
    };
  }
}

function matchesSelector(el, selector) {
  if (selector === "*") return true;
  if (selector === ".match-bg") return el.classList.contains("match-bg");
  if (selector === ".char.active-match")
    return (
      el.classList.contains("char") && el.classList.contains("active-match")
    );
  const posMatch = selector.match(/^\.char\.lookupable\[data-pos="(\d+)"\]$/);
  if (posMatch)
    return (
      el.classList.contains("char") &&
      el.classList.contains("lookupable") &&
      el.dataset.pos === posMatch[1]
    );
  if (selector[0] === ".") return el.classList.contains(selector.slice(1));
  return false;
}

function makeOverlayContext(options) {
  options = options || {};
  const elements = {
    subtitle: new FakeElement("subtitle"),
    popup: new FakeElement("popup"),
    "nested-popup-layer": new FakeElement("nested-popup-layer"),
    "popup-safety-zone": new FakeElement("popup-safety-zone"),
    "popup-row-safety-zone": new FakeElement("popup-row-safety-zone"),
    status: new FakeElement("status"),
    "bitmap-ocr-status": new FakeElement("bitmap-ocr-status"),
    task: new FakeElement("task"),
  };
  elements.popup.classList.add("hidden");
  elements.popup.classList.add("lookup-popup");
  elements.popup.dataset.popupDepth = "0";
  elements["popup-safety-zone"].classList.add("hidden");
  elements["popup-safety-zone"].setAttribute("data-clickable", "true");
  elements["popup-row-safety-zone"].classList.add("hidden");
  elements["popup-row-safety-zone"].setAttribute("data-clickable", "true");
  const overlayRoot = new FakeElement("root");
  overlayRoot.id = "root";
  elements.root = overlayRoot;
  Object.keys(elements).forEach((key) => {
    if (elements[key] !== overlayRoot) overlayRoot.appendChild(elements[key]);
  });
  const head = new FakeElement("head");
  const body = new FakeElement("body");
  body.appendChild(overlayRoot);
  const rootStyle = {
    setProperty(name, value) {
      this[name] = String(value);
    },
  };
  const documentElement = new FakeElement("html");
  documentElement.style = rootStyle;
  documentElement.clientWidth = 1280;
  documentElement.clientHeight = 720;
  documentElement.appendChild(body);
  const sent = [];
  const posted = [];
  const handlers = Object.create(null);
  const sockets = [];
  function FakeWebSocket(url) {
    this.url = url;
    this.readyState =
      options.autoOpenWebSocket === false
        ? FakeWebSocket.CONNECTING
        : FakeWebSocket.OPEN;
    sockets.push(this);
  }
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.prototype.send = function send(message) {
    sent.push(JSON.parse(message));
  };
  FakeWebSocket.prototype.close = function close() {
    this.readyState = 3;
  };
  function FakeFontFace(family, source, descriptors) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors || {};
  }
  FakeFontFace.prototype.load = function load() {
    const quotedMatch = String(this.source || "").match(/^local\("(.*)"\)$/);
    const family = (quotedMatch || [])[1] || "";
    if (typeof options.localFontLoad === "function")
      return options.localFontLoad(family, this);
    return (options.localFonts || []).includes(family)
      ? Promise.resolve(this)
      : Promise.reject(new Error("missing local font: " + family));
  };
  function fakeComputedStyle(element) {
    const inline = (element && element.style) || {};
    const inlineValue = (camelName, cssName, fallback) => {
      const direct =
        inline[camelName] !== undefined ? inline[camelName] : inline[cssName];
      return direct === undefined || direct === null || String(direct) === ""
        ? fallback
        : String(direct);
    };
    const computed = {
      transform: inlineValue("transform", "transform", "none"),
      filter: inlineValue("filter", "filter", "none"),
      perspective: inlineValue("perspective", "perspective", "none"),
      zoom: inlineValue("zoom", "zoom", "1"),
      writingMode: inlineValue("writingMode", "writing-mode", "horizontal-tb"),
      direction: inlineValue("direction", "direction", "ltr"),
      contain: inlineValue("contain", "contain", "none"),
      clip: inlineValue("clip", "clip", "auto"),
      clipPath: inlineValue("clipPath", "clip-path", "none"),
      willChange: inlineValue("willChange", "will-change", "auto"),
      transformStyle: inlineValue("transformStyle", "transform-style", "flat"),
      contentVisibility: inlineValue(
        "contentVisibility",
        "content-visibility",
        "visible",
      ),
      translate: inlineValue("translate", "translate", "none"),
      rotate: inlineValue("rotate", "rotate", "none"),
      scale: inlineValue("scale", "scale", "none"),
      backdropFilter: inlineValue("backdropFilter", "backdrop-filter", "none"),
      webkitBackdropFilter: inlineValue(
        "webkitBackdropFilter",
        "-webkit-backdrop-filter",
        "none",
      ),
      maskImage: inlineValue("maskImage", "mask-image", "none"),
      webkitMaskImage: inlineValue(
        "webkitMaskImage",
        "-webkit-mask-image",
        "none",
      ),
      position: inlineValue(
        "position",
        "position",
        element && element.id === "root" ? "fixed" : "static",
      ),
      zIndex: inlineValue(
        "zIndex",
        "z-index",
        element && element.id === "root" ? "10" : "auto",
      ),
      pointerEvents: inlineValue(
        "pointerEvents",
        "pointer-events",
        element && element.id === "root" ? "none" : "auto",
      ),
      getPropertyValue(name) {
        return inlineValue(name, name, "");
      },
    };
    return typeof options.computedStyle === "function"
      ? options.computedStyle(element, computed) || computed
      : computed;
  }

  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    WebSocket: FakeWebSocket,
    window: {
      innerWidth: 1280,
      innerHeight: 720,
      devicePixelRatio: options.devicePixelRatio || 1,
      FontFace: options.localFonts ? FakeFontFace : undefined,
      CSS: {
        supports(property, value) {
          if (
            value === "balance" &&
            (property === "text-wrap" || property === "text-wrap-style")
          )
            return options.balanceWrapSupported !== false;
          return false;
        },
      },
      addEventListener(type, handler) {
        handlers["window:" + type] = handler;
      },
      getComputedStyle: fakeComputedStyle,
      requestAnimationFrame(handler) {
        if (typeof options.requestAnimationFrame === "function")
          return options.requestAnimationFrame(handler);
        return setTimeout(handler, 0);
      },
    },
    document: {
      body,
      head,
      documentElement,
      fonts: options.fontsUnavailable
        ? undefined
        : {
            ready: options.fontsReady || Promise.resolve(),
            load(fontSpec, text) {
              return typeof options.fontLoad === "function"
                ? options.fontLoad(fontSpec, text)
                : options.fontLoad || Promise.resolve([{}]);
            },
            check() {
              return options.fontCheck !== undefined
                ? !!options.fontCheck
                : options.fontAvailable !== false;
            },
            add() {
              return this;
            },
            delete() {
              return true;
            },
          },
      addEventListener() {},
      getElementById(id) {
        if (/^native-subtitle-/.test(id)) {
          let found = null;
          const visit = (node) => {
            if (!node || found) return;
            if (node.id === id) {
              found = node;
              return;
            }
            (node.children || []).forEach(visit);
          };
          visit(documentElement);
          if (found) elements[id] = found;
          else delete elements[id];
          return found;
        }
        return elements[id];
      },
      elementFromPoint(x, y) {
        const contains = (rect) =>
          rect &&
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom;
        const popup = elements.popup;
        if (
          popup &&
          !popup.classList.contains("hidden") &&
          contains(popup.getBoundingClientRect())
        )
          return popup;
        const hitRoot = this.getElementById("native-subtitle-hit-boxes");
        if (hitRoot) {
          for (let index = hitRoot.children.length - 1; index >= 0; index--) {
            const hit = hitRoot.children[index];
            const left = Number.parseFloat(hit.style.left);
            const top = Number.parseFloat(hit.style.top);
            const width = Number.parseFloat(hit.style.width);
            const height = Number.parseFloat(hit.style.height);
            if (
              [left, top, width, height].every(Number.isFinite) &&
              contains({
                left,
                top,
                right: left + width,
                bottom: top + height,
              })
            )
              return hit;
          }
        }
        return null;
      },
      createElement(tag) {
        const element = new FakeElement(tag);
        if (tag === "canvas") {
          element.getContext = () => {
            const drawing = {
              font: "",
              measureText() {
                const font = String(drawing.font || "");
                const fallback = /monospace\s*$/.test(font)
                  ? 100
                  : /serif\s*$/.test(font) && !/sans-serif\s*$/.test(font)
                    ? 110
                    : 105;
                const custom = /"[^"]+"\s*,/.test(font);
                const detected =
                  options.fontDetect !== false &&
                  options.fontAvailable !== false;
                return { width: custom && detected ? 140 : fallback };
              },
            };
            return drawing;
          };
        }
        return element;
      },
      createTextNode(text) {
        const node = new FakeElement("#text");
        node.textContent = text;
        return node;
      },
      createDocumentFragment() {
        return new FakeElement("#fragment");
      },
      createRange() {
        let start = 0;
        let end = 0;
        return {
          setStart(_node, value) {
            start = value;
          },
          setEnd(_node, value) {
            end = value;
          },
          getClientRects() {
            if (typeof options.rangeRects === "function")
              return options.rangeRects(start, end);
            return [
              {
                left: 100 + start * 10,
                top: 500,
                right: 100 + end * 10,
                bottom: 526,
                width: Math.max(1, (end - start) * 10),
                height: 26,
              },
            ];
          },
        };
      },
    },
    iina: {
      onMessage(name, handler) {
        handlers[name] = handler;
      },
      postMessage(name, payload) {
        if (options.postMessageThrows)
          throw new Error("postMessage unavailable");
        posted.push({ name, payload });
      },
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
      if (!socket) throw new Error("No fake WebSocket to open");
      socket.readyState = FakeWebSocket.OPEN;
      if (typeof socket.onopen === "function") socket.onopen();
      return socket;
    },
  };
  vm.createContext(context);
  return context;
}

function loadOverlayForTest(exportList, options) {
  const context = makeOverlayContext(options);
  const readSource =
    options && typeof options.readSource === "function"
      ? options.readSource
      : (relativePath) =>
          fs.readFileSync(path.join(root, relativePath), "utf8");
  const exports = Array.isArray(exportList)
    ? exportList.join(", ")
    : String(exportList || "");
  let source = readSource("src/overlay/overlay.js");
  source =
    readSource("src/languages/lookup_character_policy.js") +
    "\n" +
    readSource("src/overlay/native_subtitle_hit_layer.js") +
    "\n" +
    source;
  source = source.replace(
    "  // Keep the documented ready message",
    "  globalThis.__overlayTest = { " +
      exports +
      " };" +
      "\n\n  // Keep the documented ready message",
  );
  vm.runInContext(source, context, { filename: "overlay.js" });
  return { context, overlay: context.__overlayTest };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

module.exports = {
  root,
  lookupCharacterPolicies,
  assert,
  FakeClassList,
  FakeElement,
  makeOverlayContext,
  loadOverlayForTest,
};
