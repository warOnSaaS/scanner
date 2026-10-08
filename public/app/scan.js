/* warOnSaaS Scanner, in the browser.
   The console shows every request the scan makes as it happens, then each check as it is scored:
   the wait is the demonstration. Until someone scans, it replays a real recorded scan. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
  var tone = function (n) { return n >= 80 ? 'good' : n >= 50 ? 'warn' : 'bad'; };
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /* The hosted scanner asks for a warOnSaaS account before a scan (account.waronsaas.com/prompt.js is on the page).
     Viewing never needs it. An answer of { error: { code: 'sign_in' } } means: show the sign-in prompt, not an error. */
  var acctTag = document.querySelector('script[data-signin]');
  var signedOut = !!acctTag && acctTag.getAttribute('data-signed-in') !== 'true';
  function msgOf(err) { return typeof err === 'string' ? err : (err && err.message) || 'That did not finish.'; }
  function codeOf(err) { return err && typeof err === 'object' ? err.code : ''; }
  function askSignIn(what) { if (window.wosAccount && !window.wosAccount.signedIn) { window.wosAccount.prompt(what); return true; } return false; }

  /* ---- recently scanned (GET /api/scans, the list_recent_scans tool) ---- */
  function recent() {
    var sec = $('[data-recent]'); if (!sec) return;
    fetch('/api/scans?limit=8').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok || !j.scans || j.scans.length < 3) return;
      var ol = $('[data-recent-list]', sec);
      j.scans.forEach(function (s) {
        var li = el('li'), a = el('a'); a.href = '/report/' + s.slug;
        a.appendChild(el('span', 'r-host', s.host));
        a.appendChild(el('b', 't-' + tone(s.grade), String(s.grade)));
        li.appendChild(a); ol.appendChild(li);
      });
      sec.hidden = false;
    }).catch(function () {});
  }

  /* ---- compare (GET /api/compare, the compare_sites tool) ---- */
  function compare() {
    var f = $('[data-compare-form]'), out = $('[data-compare-out]'); if (!f) return;
    var pre = new URLSearchParams(location.search).get('urls');
    if (pre) pre.split(',').forEach(function (u, i) { var inp = f.querySelectorAll('input[name=urls]')[i]; if (inp) inp.value = u; });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var urls = $$('input[name=urls]', f).map(function (i) { return clean(i.value); }).filter(Boolean);
      var btn = f.querySelector('button'); btn.disabled = true;
      out.hidden = false; out.innerHTML = '';
      var wait1 = el('p', 'cmp-wait', 'Scanning ' + urls.join(', ') + '. Sites scanned in the last day come back at once; new ones take up to half a minute each, side by side.'); out.appendChild(wait1);
      try { history.replaceState(null, '', '/compare?urls=' + encodeURIComponent(urls.join(','))); } catch (x) {}
      var q = '/api/compare?urls=' + encodeURIComponent(urls.join(',')) + (f.pagespeed.checked ? '&include_pagespeed=1' : '');
      fetch(q).then(function (r) { return r.json(); }).then(function (j) {
        btn.disabled = false; out.innerHTML = '';
        if (!j.ok) { if (codeOf(j.error) === 'sign_in' && askSignIn('compare sites')) { out.hidden = true; return; } out.appendChild(el('p', 'con-err', msgOf(j.error))); return; }
        out.appendChild(el('h2', '', 'Side by side'));
        out.appendChild(el('p', 'rp-mean', j.summary));
        var grid = el('div', 'cmp-grid');
        j.sites.forEach(function (s, i) {
          var a = el('a', 'cmp-site' + (i === 0 ? ' is-lead' : '')); a.href = '/report/' + s.slug;
          a.appendChild(el('span', 'cmp-rank', i === 0 ? 'Leads' : '#' + (i + 1)));
          a.appendChild(el('b', 'cmp-host', s.host));
          a.appendChild(el('span', 'cmp-g t-' + tone(s.grade), String(s.grade)));
          a.appendChild(el('span', 'cmp-v', s.verdict));
          var ul = el('ul', 'cmp-areas');
          Object.keys(s.areas).forEach(function (k) { var li = el('li'); li.appendChild(el('span', '', { agents: 'AI assistants', search: 'Search', performance: 'Speed', hygiene: 'Security' }[k])); li.appendChild(el('b', 't-' + tone(s.areas[k]), String(s.areas[k]))); ul.appendChild(li); });
          a.appendChild(ul); grid.appendChild(a);
        });
        out.appendChild(grid);
        if (j.differences.length) {
          out.appendChild(el('h2', 'cmp-h', 'Where they differ'));
          var t = el('div', 'cmp-diff');
          j.differences.forEach(function (d) {
            var row = el('div', 'cmp-row'); row.appendChild(el('b', '', d.check));
            row.appendChild(el('span', 'cmp-pass', d.passes.length ? 'Passes: ' + d.passes.join(', ') : ''));
            row.appendChild(el('span', 'cmp-fail', d.fails.length ? 'Fails: ' + d.fails.join(', ') : ''));
            t.appendChild(row);
          });
          out.appendChild(t);
        }
        (j.errors || []).forEach(function (er) { out.appendChild(el('p', 'small', er.host + ': ' + er.error)); });
      }).catch(function () { btn.disabled = false; out.innerHTML = ''; out.appendChild(el('p', 'con-err', 'The connection dropped. Try again.')); });
    });
  }

  /* ---- copy buttons ---- */
  function copied(btn) { btn.classList.add('is-done'); setTimeout(function () { btn.classList.remove('is-done'); }, 1400); }
  function copy(text, btn) {
    var done = function () { copied(btn); var s = btn.querySelector('span'); if (s) { var was = s.textContent; s.textContent = 'Copied'; setTimeout(function () { s.textContent = was; }, 1400); } };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {}); else done();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy],[data-copy-from]'); if (!b) return;
    copy(b.dataset.copy || ($('#' + b.dataset.copyFrom) || {}).textContent || '', b);
  });

  recent(); compare();

  /* ---- the console ---- */
  var box = $('[data-console]'); if (!box) return;
  var log = $('[data-log]', box), gradeEl = $('[data-grade]', box), verdictEl = $('[data-verdict]', box);
  var foot = $('[data-foot]', box), timeEl = $('[data-time]', box), chip = $('[data-chip]', box), hostEl = $('[data-host]', box);
  var rows = {}, run = 0, t0 = 0, ticker = 0;

  function scrollLog() { log.scrollTop = log.scrollHeight; }
  function line(cls, label, note) {
    var li = document.createElement('li'); li.className = cls;
    var b = document.createElement('b'); b.textContent = label;
    var s = document.createElement('span'); s.textContent = note || '';
    li.appendChild(b); li.appendChild(s); log.appendChild(li); scrollLog(); return li;
  }
  function step(s) {
    var li = rows[s.k];
    if (!li) { li = rows[s.k] = line('', s.label, s.note); }
    li.className = 's-' + s.state;
    li.firstChild.textContent = s.label; li.lastChild.textContent = s.note || (s.state === 'run' ? '...' : '');
    if (s.k === 'home' && s.state === 'ok') verdictEl.innerHTML = '<span>Reading what came back</span>';
  }
  /* Areas render one after another, each with its checks, so the log never interleaves. */
  var chain = Promise.resolve();
  function area(a, id) {
    chain = chain.then(function () {
      if (id !== run) return;
      var li = $('[data-area="' + a.key + '"]', box);
      if (li) { li.classList.add('is-set'); var bar = $('s', li); bar.className = 't-' + a.tone; bar.style.width = a.score + '%'; $('b', li).textContent = a.score; }
      var head = line('is-head', a.name, a.score + '/100');
      head.lastChild.className = 't-' + a.tone;
      return a.checks.reduce(function (p, c) {
        return p.then(function () {
          if (id !== run) return;
          var r = line(c.pass ? 'c-y' : 'c-n', c.label, c.pass ? c.note : '');
          if (!c.pass) { r.lastChild.className = 'pts'; r.lastChild.textContent = '+' + c.points + ' pts'; }
          return wait(reduced ? 0 : 28);
        });
      }, Promise.resolve());
    });
  }
  function count(to, id) {
    var from = 0, start = performance.now(), dur = reduced ? 1 : 900;
    gradeEl.className = 't-' + tone(to);
    (function f(now) {
      if (id !== run) return;
      var k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 3);
      gradeEl.textContent = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(f);
    })(start);
  }
  function done(p, id, example) { chain = chain.then(function () { if (id === run) finish(p, id, example); }); }
  function finish(p, id, example) {
    var r = p.report || {};
    stopClock(); box.classList.remove('is-running'); box.dataset.state = 'done';
    if (!example) chip.textContent = p.cached ? 'From cache' : 'Done';
    count(r.grade || 0, id);
    verdictEl.innerHTML = '';
    var v = document.createElement('span'); v.className = 'verdict t-' + ((r.verdict && r.verdict.tone) || 'bad'); v.textContent = (r.verdict && r.verdict.label) || '';
    verdictEl.appendChild(v);
    $('[data-summary]', foot).textContent = r.summary || '';
    var open = $('[data-open]', foot); open.href = '/report/' + p.slug;
    $('[data-share]', foot).onclick = function () { copy(location.origin + '/report/' + p.slug, this); };
    foot.hidden = false;
  }
  function fail(msg) {
    stopClock(); box.classList.remove('is-running'); box.dataset.state = 'failed'; chip.textContent = 'Stopped';
    verdictEl.innerHTML = '<span>The scan stopped</span>';
    var e = document.createElement('p'); e.className = 'con-err'; e.setAttribute('role', 'alert'); e.textContent = msg; box.appendChild(e);
    setBusy(false);
  }
  function startClock() { t0 = performance.now(); clearInterval(ticker); ticker = setInterval(function () { timeEl.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's'; }, 100); }
  function stopClock() { clearInterval(ticker); }
  function reset(host, label) {
    run++; rows = {}; log.innerHTML = ''; foot.hidden = true; chain = Promise.resolve();
    var err = $('.con-err', box); if (err) err.remove();
    hostEl.textContent = host; chip.textContent = label; timeEl.textContent = '0.0s';
    gradeEl.textContent = '00'; gradeEl.className = '';
    verdictEl.innerHTML = '<span>Waiting for the home page</span>';
    $$('[data-area]', box).forEach(function (li) { li.classList.remove('is-set'); $('s', li).style.width = '0'; $('b', li).textContent = '--'; });
    box.classList.add('is-running'); box.dataset.state = 'running';
    startClock();
    return run;
  }

  /* ---- a live scan ---- */
  var forms = $$('[data-scan-form]');
  function setBusy(on) { forms.forEach(function (f) { f.querySelector('button').disabled = on; }); }
  function clean(v) { return String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''); }
  var es = null;
  function live(input, rescan) {
    var host = clean(input); if (!host) return;
    if (es) es.close();
    var id = reset(host, 'Live'); box.dataset.state = 'live';
    box.removeAttribute('data-example');
    setBusy(true);
    try { history.replaceState(null, '', '/?url=' + encodeURIComponent(host)); } catch (e) {}
    if (innerWidth < 760) box.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    var settled = false;
    es = new EventSource('/api/scan/stream?url=' + encodeURIComponent(host) + (rescan ? '&rescan=1' : ''));
    es.addEventListener('step', function (ev) { if (id === run) step(JSON.parse(ev.data)); });
    es.addEventListener('cached', function (ev) { var d = JSON.parse(ev.data); chip.textContent = 'From cache'; line('con-cached is-head', 'Scanned ' + d.minutes + ' min ago', 'replaying'); });
    es.addEventListener('area', function (ev) { if (id === run) area(JSON.parse(ev.data), id); });
    es.addEventListener('done', function (ev) { settled = true; es.close(); if (id === run) { setTimeout(function () { done(JSON.parse(ev.data), id, false); setBusy(false); }, 500); } });
    es.addEventListener('fail', function (ev) {
      settled = true; es.close(); if (id !== run) return;
      var d = JSON.parse(ev.data);
      fail(msgOf(d.error));
      if (d.code === 'sign_in') askSignIn('run a scan');
    });
    es.onerror = function () { if (settled) return; settled = true; es.close(); if (id === run) fail('The connection dropped. Try again.'); };
  }
  forms.forEach(function (f) {
    f.addEventListener('submit', function (e) {
      var v = f.querySelector('input').value;
      if (!box || !clean(v)) return;
      e.preventDefault(); forms.forEach(function (o) { o.querySelector('input').value = clean(v); }); live(v);
    });
  });
  $$('[data-try]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); var h = new URL(a.href).searchParams.get('url'); forms.forEach(function (o) { o.querySelector('input').value = h; }); live(h); }); });

  /* ---- the example, replayed from a real recorded scan ---- */
  function example() {
    return fetch('/app/example.json').then(function (r) { return r.json(); }).then(function (ex) {
      var loop = box.hasAttribute('data-loop');
      (function play() {
        if (!box.hasAttribute('data-example')) return;
        var id = reset(ex.host, 'Example'); var last = 0;
        var go = Promise.resolve();
        ex.events.forEach(function (ev) {
          go = go.then(function () {
            if (id !== run) throw 0;
            var gap = Math.max(ev.e === "step" ? 70 : 0, Math.min(ev.t - last, 1600)); last = ev.t;   // the long PageSpeed wait is shortened
            return wait(reduced ? 0 : gap).then(function () {
              if (id !== run) throw 0;
              if (ev.e === 'step') step(ev.d); else if (ev.e === 'area') area(ev.d, id); else if (ev.e === 'done') done(ev.d, id, true);
            });
          });
        });
        go.then(function () { return wait(loop ? 5200 : 9000); }).then(function () { if (id === run && box.hasAttribute('data-example')) play(); }, function () {});
      })();
    }).catch(function () {});
  }

  /* Signed out, the address typed into the hero form rides in the URL, so after signing in the person
     comes back to /?url=theirsite and the scan starts on its own. */
  var hero = $('.hero [data-scan-form] input');
  if (hero && signedOut) hero.addEventListener('input', function () { try { history.replaceState(null, '', clean(hero.value) ? '/?url=' + encodeURIComponent(clean(hero.value)) : '/'); } catch (e) {} });

  var qs = new URLSearchParams(location.search), start = qs.get('url');
  if (start && forms.length) {
    forms.forEach(function (o) { o.querySelector('input').value = clean(start); });
    // Signed out on the hosted scanner: ask for the account first (the example keeps playing meanwhile).
    if (signedOut) { if (box.hasAttribute('data-example')) example(); askSignIn('scan ' + clean(start)); }
    else live(start, qs.get('rescan') === '1');
  }
  else if (box.hasAttribute('data-example')) example();
})();
