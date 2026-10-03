/* TeamLag game connector v1 — reglas en /g/README.md */
(function (root) {
  'use strict';

  var PARENTS = ['https://www.tlag.online', 'http://localhost:4321'];
  var READY_TIMEOUT = 8000; // la pantalla de carga del juego cubre la espera (arranque en frío de la API)
  var HELLO_EVERY = 500;
  var REQUEST_TIMEOUT = 8000;
  var FLUSH_DELAY = 2000;
  var LEGACY_AT = 1; // guardados previos al conector: más viejos que cualquier guardado en la nube

  function createConnector(o) {
    var storage = o.storage, proto = o.proto, parent = o.parent;
    var game = o.game, prefix = o.prefix, parents = o.parents || PARENTS;
    var now = o.now || Date.now;
    var setT = o.setTimeout || root.setTimeout, clearT = o.clearTimeout || root.clearTimeout;
    var META = '__tl_meta:' + game;
    var origSet = proto.setItem, origGet = proto.getItem;
    var parentOrigin = null, queue = {}, flushTimer = null, resolveReady, bootedLocal = false, reqSeq = 0, pendingReq = {};

    var api = {
      ready: new Promise(function (r) { resolveReady = r; }),
      user: null,
      event: function (name, data) { post({ type: 'event', name: String(name), data: data == null ? null : data }); },
      exit: function () { post({ type: 'exit' }); },
      request: function (name, params) {
        return api.ready.then(function () {
          if (!parentOrigin) throw new Error('offline');
          return new Promise(function (resolve, reject) {
            var id = ++reqSeq;
            var timer = setT(function () { delete pendingReq[id]; reject(new Error('timeout')); }, REQUEST_TIMEOUT);
            pendingReq[id] = { resolve: resolve, reject: reject, timer: timer };
            post({ type: 'request', id: id, name: String(name), params: params == null ? null : params });
          });
        });
      },
      _onMessage: onMessage,
      _flush: flush,
    };

    function tracked(k) { return typeof k === 'string' && k.indexOf(prefix) === 0; }
    function readMeta() {
      try { return JSON.parse(origGet.call(storage, META) || '{}') || {}; } catch (e) { return {}; }
    }
    function writeMeta(m) { try { origSet.call(storage, META, JSON.stringify(m)); } catch (e) { /* lleno */ } }
    function post(msg) {
      if (!parentOrigin) return;
      msg.tl = 1; msg.game = game;
      try { parent.postMessage(msg, parentOrigin); } catch (e) { /* ventana cerrada */ }
    }
    function enqueue(key, value, at) {
      queue[key] = { key: key, value: value, at: at };
      if (flushTimer) clearT(flushTimer);
      flushTimer = setT(flush, FLUSH_DELAY);
    }
    function flush() {
      flushTimer = null;
      if (!parentOrigin) return;
      var items = [];
      for (var k in queue) items.push(queue[k]);
      if (!items.length) return;
      queue = {};
      post({ type: 'save', items: items });
    }

    // Guardados locales sin meta (anteriores al conector): fecha mínima
    (function seedMeta() {
      var m = readMeta(), changed = false;
      for (var i = 0; i < storage.length; i++) {
        var k = storage.key(i);
        if (tracked(k) && m[k] == null) { m[k] = LEGACY_AT; changed = true; }
      }
      if (changed) writeMeta(m);
    })();

    proto.setItem = function (k, v) {
      origSet.call(this, k, v);
      if (this === storage && tracked(String(k))) {
        var at = now(), m = readMeta();
        m[k] = at; writeMeta(m);
        enqueue(String(k), String(v), at);
      }
    };

    function onMessage(e) {
      if (!e || e.source !== parent || parents.indexOf(e.origin) < 0) return;
      var d = e.data;
      if (!d || d.tl !== 1) return;
      if (d.type === 'flush') { if (e.origin === parentOrigin) flush(); return; }
      if (d.type === 'response') {
        if (e.origin !== parentOrigin) return;
        var pr = pendingReq[d.id];
        if (!pr) return;
        delete pendingReq[d.id];
        clearT(pr.timer);
        if (d.ok) pr.resolve(d.data); else pr.reject(new Error(String(d.error || 'error')));
        return;
      }
      if (d.type !== 'init' || parentOrigin) return;
      parentOrigin = e.origin;
      api.user = d.user || null;

      var saves = d.saves || {}, m = readMeta(), k;
      for (k in saves) {
        var s = saves[k];
        if (!tracked(k) || !s || typeof s.value !== 'string' || typeof s.at !== 'number') continue;
        if (!bootedLocal && !(m[k] >= s.at)) {
          origSet.call(storage, k, s.value); // original: no se reencola
          m[k] = s.at;                       // fecha de la nube, no la actual
        }
      }
      if (!bootedLocal) writeMeta(m);

      for (k in m) {
        if (!tracked(k)) continue;
        var cloud = saves[k];
        if (!cloud || m[k] > cloud.at) {
          var v = origGet.call(storage, k);
          if (v != null) queue[k] = { key: k, value: v, at: m[k] };
        }
      }
      resolveReady();
      flush();
    }

    // hello se repite hasta recibir init (por si la web aún no escucha) y deja de intentarlo al vencer el plazo
    var started = now();
    function sendHello() {
      if (parentOrigin || now() - started >= READY_TIMEOUT) return;
      var hello = { tl: 1, type: 'hello', game: game, local: readMeta() };
      for (var i = 0; i < parents.length; i++) {
        try { parent.postMessage(hello, parents[i]); } catch (e) { /* origen distinto */ }
      }
      setT(sendHello, HELLO_EVERY);
    }
    sendHello();
    setT(function () { if (!parentOrigin) bootedLocal = true; resolveReady(); }, READY_TIMEOUT);
    return api;
  }

  root.__tlCreateConnector = createConnector;
  if (!root.document) return; // tests en Node

  var noop = { ready: Promise.resolve(), user: null, event: function () {}, exit: function () {}, request: function () { return Promise.reject(new Error('offline')); } };
  var script = root.document.currentScript;
  var game = script && script.getAttribute('data-game');
  var prefix = script && script.getAttribute('data-prefix');
  var embedded = false;
  try { embedded = root.parent && root.parent !== root; } catch (e) { embedded = true; }
  var ls = null;
  try { ls = root.localStorage; } catch (e) { ls = null; }

  if (!embedded || !ls || !game || !prefix) { root.TL = noop; return; }

  var c = createConnector({ storage: ls, proto: root.Storage.prototype, parent: root.parent, game: game, prefix: prefix });
  root.addEventListener('message', c._onMessage);
  root.addEventListener('pagehide', c._flush);
  root.TL = c;
})(typeof window !== 'undefined' ? window : globalThis);
