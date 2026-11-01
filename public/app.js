/* Imperio Mailer front-end. Talks to the server's /api routes. */
(function () {
  "use strict";

  // ---------- Helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return Number(n || 0).toLocaleString("en-NG"); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function storeGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function duration(seconds) {
    var m = Math.round(seconds / 60);
    if (m < 1) return "under a minute";
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), r = m % 60;
    return h + " h" + (r ? " " + r + " min" : "");
  }

  function when(ts) {
    var d = new Date(ts), now = new Date();
    var time = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return "Today, " + time;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday, " + time;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + time;
  }

  // ---------- API ----------
  function api(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch("/api" + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && path !== "/login") { showLogin(); }
        if (!res.ok) { var err = new Error(data.error || "Request failed (" + res.status + ")."); err.status = res.status; throw err; }
        return data;
      });
    }, function () { throw new Error("Can't reach the server. Check your connection and try again."); });
  }

  // ---------- State ----------
  var me = null;
  var settings = null;
  var queueData = null;
  var check = { ready: 0, duplicate: [], invalid: [], suppressed: [], sample: [] };

  // ---------- Router ----------
  var VIEWS = ["compose", "queue", "history", "config"];
  function currentView() { var h = (location.hash || "").replace("#", ""); return VIEWS.indexOf(h) === -1 ? "compose" : h; }
  function route() {
    if (!me) return;
    var h = currentView();
    document.querySelectorAll("[data-view]").forEach(function (el) { el.hidden = el.getAttribute("data-view") !== h; });
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      if (a.getAttribute("data-nav") === h) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (h === "queue") loadQueue();
    if (h === "history") loadHistory();
    if (h === "config") loadSettings(true);
    schedulePoll();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  // ---------- Sign in ----------
  function showLogin() {
    me = null;
    clearTimeout(pollTimer);
    $("shell").hidden = true;
    document.querySelector('[data-solo="login"]').hidden = false;
    setTimeout(function () { ($("loginEmail").value ? $("loginPass") : $("loginEmail")).focus(); }, 0);
  }

  function applyBrand(info) {
    document.title = info.appName;
    document.querySelectorAll(".js-app-name").forEach(function (el) { el.textContent = info.appName; });
    document.querySelectorAll(".js-brand-mark").forEach(function (el) { el.textContent = (info.brandName || "M").charAt(0).toUpperCase(); });
    document.querySelectorAll(".js-host").forEach(function (el) { el.textContent = location.host; });
  }

  function boot() {
    api("GET", "/me").then(function (info) {
      me = info;
      applyBrand(info);
      $("adminEmail").textContent = info.email || "";
      document.querySelector('[data-solo="login"]').hidden = true;
      $("shell").hidden = false;
      return loadSettings(false);
    }).then(function () {
      if (!me) return;
      fillComposeDefaults();
      runCheck();
      route();
      loadQueue();
    }).catch(function (err) {
      if (err.status !== 401) {
        applyBrand({ appName: "Mailer", brandName: "M" });
        showLogin();
        showLoginError(err.message);
      }
    });
  }

  function showLoginError(msg) { $("loginError").textContent = msg; $("loginError").hidden = !msg; }

  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("loginEmail").value.trim(), pass = $("loginPass").value;
    if (!email || !pass) { showLoginError("Enter your email and password."); return; }
    $("loginBtn").disabled = true;
    api("POST", "/login", { email: email, password: pass }).then(function () {
      $("loginPass").value = ""; showLoginError(""); boot();
    }, function (err) { showLoginError(err.message); }).then(function () { $("loginBtn").disabled = false; });
  });

  $("logoutBtn").addEventListener("click", function () {
    api("POST", "/logout", {}).then(showLogin, showLogin);
  });

  // ---------- Settings ----------
  function loadSettings(fillForm) {
    return api("GET", "/settings").then(function (data) {
      settings = data.settings;
      updateSideMeter();
      if (fillForm) fillSettingsForm(data);
      return data;
    });
  }

  function fillSettingsForm(data) {
    var s = data.settings;
    $("sFromName").value = s.fromName; $("sFromEmail").value = s.fromEmail;
    $("dailyLimit").value = s.dailyLimit; $("delay").value = s.delaySeconds;
    $("batchSize").value = s.batchSize; $("batchPause").value = s.batchPauseMinutes; $("startHour").value = s.startHour;
    $("signature").value = s.signature; $("unsubText").value = s.unsubscribeText; $("footerAddress").value = s.footerAddress;
    var m = data.smtp;
    $("smtpFacts").innerHTML = "<dt>Server</dt><dd>" + esc(m.host) + "</dd><dt>Port</dt><dd>" + esc(m.port) + (m.secure ? " (SSL)" : " (STARTTLS)") + "</dd>" +
      "<dt>Username</dt><dd>" + esc(m.user) + "</dd><dt>Password</dt><dd>" + (m.passwordSet ? "Saved in .env" : '<span style="color:var(--bad)">Missing from .env</span>') + "</dd>";
    $("supUnsub").textContent = fmt(data.suppressions.unsubscribed) + " unsubscribed";
    $("supBounced").textContent = fmt(data.suppressions.bounced) + " bounced";
    $("settingsError").hidden = true;
    updateSpeedCalc();
  }

  function formSettings() {
    return {
      fromName: $("sFromName").value, fromEmail: $("sFromEmail").value,
      dailyLimit: $("dailyLimit").value, delaySeconds: $("delay").value, batchSize: $("batchSize").value,
      batchPauseMinutes: $("batchPause").value, startHour: $("startHour").value,
      signature: $("signature").value, unsubscribeText: $("unsubText").value, footerAddress: $("footerAddress").value
    };
  }

  function sendSeconds(n, s) {
    s = s || settings;
    if (!s || n <= 0) return 0;
    return n * s.delaySeconds + Math.floor(Math.max(0, n - 1) / s.batchSize) * s.batchPauseMinutes * 60;
  }

  function updateSpeedCalc() {
    var f = formSettings();
    var s = { dailyLimit: parseInt(f.dailyLimit, 10) || 1, delaySeconds: parseInt(f.delaySeconds, 10) || 1, batchSize: parseInt(f.batchSize, 10) || 1, batchPauseMinutes: parseInt(f.batchPauseMinutes, 10) || 0 };
    $("speedCalc").innerHTML = "At this speed, a full day of " + fmt(s.dailyLimit) + " emails takes about <b>" + duration(sendSeconds(s.dailyLimit, s)) +
      "</b>, at most " + fmt(Math.round(3600 / s.delaySeconds)) + " an hour.";
  }
  ["dailyLimit", "delay", "batchSize", "batchPause"].forEach(function (id) { $(id).addEventListener("input", updateSpeedCalc); });

  $("saveSettings").addEventListener("click", function () {
    var b = $("saveSettings"); b.disabled = true;
    api("PUT", "/settings", formSettings()).then(function (data) {
      settings = data.settings; updateSideMeter(); $("settingsError").hidden = true; toast("Settings saved");
    }, function (err) { $("settingsError").textContent = err.message; $("settingsError").hidden = false; })
      .then(function () { b.disabled = false; });
  });

  $("testConn").addEventListener("click", function () {
    var b = $("testConn"); b.disabled = true; b.textContent = "Testing…"; $("connOk").hidden = true; $("connError").hidden = true;
    api("POST", "/smtp/test", {}).then(function () { $("connOk").hidden = false; }, function (err) { $("connError").textContent = err.message; $("connError").hidden = false; })
      .then(function () { b.disabled = false; b.textContent = "Test connection"; });
  });

  $("viewSup").addEventListener("click", function () {
    api("GET", "/suppressions?limit=500").then(function (data) {
      var rows = data.suppressions;
      openModal('<div class="modal-head"><h2>Do-not-email list</h2><button class="x" data-close aria-label="Close">×</button></div>' +
        '<div class="modal-body">' + (rows.length ? '<div class="recip-list" id="supList">' + rows.map(function (r) {
          return '<div><span class="addr">' + esc(r.email) + (r.detail && r.reason === "bounced" ? '<span class="why">' + esc(r.detail) + "</span>" : "") + '</span>' +
            '<span class="btn-row" style="gap:6px;align-items:center"><span class="pill ' + (r.reason === "bounced" ? "pill-bad" : "pill-neutral") + '">' + (r.reason === "bounced" ? "Bounced" : "Unsubscribed") + '</span>' +
            '<button class="btn btn-quiet" type="button" data-unsup="' + esc(r.email) + '">Remove</button></span></div>';
        }).join("") + "</div>" : '<p class="hint">Nobody yet.</p>') +
        '<p class="hint">Remove someone only if they asked to be added back.</p></div>' +
        '<div class="modal-foot"><button class="btn" data-close>Close</button></div>', function (m) {
        m.addEventListener("click", function (e) {
          var btn = e.target.closest("[data-unsup]");
          if (!btn) return;
          var email = btn.getAttribute("data-unsup");
          api("DELETE", "/suppressions/" + encodeURIComponent(email)).then(function () {
            btn.closest("div").remove(); toast(email + " removed from the list"); loadSettings(true);
          }, function (err) { toast(err.message); });
        });
      });
    }, function (err) { toast(err.message); });
  });

  // ---------- Compose ----------
  function fillComposeDefaults() {
    if (!$("fromName").value) $("fromName").value = storeGet("imperio-fromName", settings.fromName);
    if (!$("fromAddr").value) $("fromAddr").value = storeGet("imperio-fromAddr", settings.fromEmail);
    if (!$("subject").value) $("subject").value = storeGet("imperio-subject", "");
    if (!$("body").value) $("body").value = storeGet("imperio-body", "");
    if (!$("recips").value) $("recips").value = storeGet("imperio-recips", "");
  }
  [["fromName", "imperio-fromName"], ["fromAddr", "imperio-fromAddr"], ["subject", "imperio-subject"], ["body", "imperio-body"], ["recips", "imperio-recips"]].forEach(function (p) {
    $(p[0]).addEventListener("input", function () { storeSet(p[1], $(p[0]).value); });
  });

  var checkTimer, checkSeq = 0;
  $("recips").addEventListener("input", function () { clearTimeout(checkTimer); checkTimer = setTimeout(runCheck, 350); });

  function runCheck() {
    var seq = ++checkSeq;
    api("POST", "/recipients/check", { text: $("recips").value }).then(function (data) {
      if (seq !== checkSeq) return;
      check = data; renderTally();
    }, function () { /* keep the last result */ });
  }

  function renderTally() {
    var r = check.ready, d = check.duplicate.length, b = check.invalid.length, s = check.suppressed.length;
    var total = r + d + b + s || 1;
    $("readyCount").textContent = fmt(r);
    $("sendLabel").textContent = "Send to " + fmt(r) + (r === 1 ? " person" : " people");
    $("sendBtn").disabled = r === 0;
    $("lgReady").textContent = fmt(r); $("lgDup").textContent = fmt(d); $("lgBad").textContent = fmt(b); $("lgSup").textContent = fmt(s);
    $("barReady").style.width = (r / total * 100) + "%";
    $("barDup").style.width = (d / total * 100) + "%";
    $("barBad").style.width = (b / total * 100) + "%";
    $("barSup").style.width = (s / total * 100) + "%";
    var rows = [];
    check.invalid.slice(0, 100).forEach(function (e) { rows.push('<div class="issue"><span class="dot c-bad"></span><code>' + esc(e.email || "(blank)") + "</code><em>line " + e.line + ", not a valid address</em></div>"); });
    check.duplicate.slice(0, 100).forEach(function (e) { rows.push('<div class="issue"><span class="dot c-dup"></span><code>' + esc(e.email) + "</code><em>line " + e.line + ", already listed</em></div>"); });
    check.suppressed.slice(0, 100).forEach(function (e) { rows.push('<div class="issue"><span class="dot c-sup"></span><code>' + esc(e.email) + "</code><em>line " + e.line + ", on the do-not-email list</em></div>"); });
    $("issues").innerHTML = rows.join("");
    $("issues").hidden = rows.length === 0;
  }

  $("insertName").addEventListener("click", function () {
    var el = document.activeElement === $("subject") ? $("subject") : $("body");
    var s = el.selectionStart != null ? el.selectionStart : el.value.length;
    var e2 = el.selectionEnd != null ? el.selectionEnd : s;
    el.value = el.value.slice(0, s) + "{name}" + el.value.slice(e2);
    el.focus(); el.selectionStart = el.selectionEnd = s + 6;
    el.dispatchEvent(new Event("input"));
  });

  function personalize(text, name) { return String(text).replace(/\{name\}/gi, name && name.trim() ? name.trim() : "there"); }

  function message() {
    return { fromName: $("fromName").value.trim(), fromEmail: $("fromAddr").value.trim(), subject: $("subject").value.trim(), body: $("body").value };
  }

  function messageProblem(m) {
    if (!m.subject) return { field: "subject", text: "Add a subject before sending." };
    if (!m.body.trim()) return { field: "body", text: "Write a message before sending." };
    if (!m.fromEmail) return { field: "fromAddr", text: "Add a from address." };
    return null;
  }

  function emailPreviewHTML(r) {
    var m = message(), s = settings;
    var unsub = (s.unsubscribeText || "Unsubscribe").trim();
    var i = unsub.lastIndexOf(" ");
    var unsubHTML = i > 0 ? esc(unsub.slice(0, i + 1)) + "<u>" + esc(unsub.slice(i + 1)) + "</u>" : "<u>" + esc(unsub) + "</u>";
    return '<div class="mail">' +
      '<div class="mail-meta"><div><span>From </span>' + esc(m.fromName) + " &lt;" + esc(m.fromEmail) + "&gt;</div>" +
      "<div><span>To </span>" + esc(r.name ? r.name + " <" + r.email + ">" : r.email) + "</div>" +
      "<div><span>Subject </span><b>" + esc(personalize(m.subject, r.name)) + "</b></div></div>" +
      '<div class="mail-body">' + esc(personalize(m.body, r.name)) + (s.signature ? "\n\n" + esc(s.signature) : "") + "</div>" +
      '<div class="mail-foot">' + unsubHTML + (s.footerAddress ? "<br>" + esc(s.footerAddress) : "") + "</div></div>";
  }

  $("previewBtn").addEventListener("click", function () {
    var list = check.sample && check.sample.length ? check.sample : [{ email: (me && me.email) || $("fromAddr").value, name: "" }];
    openModal(
      '<div class="modal-head"><h2>Preview</h2><button class="x" data-close aria-label="Close">×</button></div>' +
      '<div class="modal-body"><div class="field"><label for="pvWho">Show it as</label><select class="select" id="pvWho">' +
      list.map(function (r, i) { return '<option value="' + i + '">' + esc(r.name ? r.name + " (" + r.email + ")" : r.email + " (no name)") + "</option>"; }).join("") +
      '</select></div><div id="pvMail"></div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>Close</button></div>',
      function (m) {
        function draw(i) { m.querySelector("#pvMail").innerHTML = emailPreviewHTML(list[i]); }
        m.querySelector("#pvWho").addEventListener("change", function (e) { draw(+e.target.value); });
        draw(0);
      });
  });

  $("testBtn").addEventListener("click", function () {
    var m = message(), p = messageProblem(m);
    if (p) { toast(p.text); $(p.field).focus(); return; }
    var b = $("testBtn"); b.disabled = true; b.textContent = "Sending test…";
    var first = check.sample && check.sample[0];
    m.testName = first ? first.name : "";
    api("POST", "/test-send", m).then(function (data) { toast("Test sent to " + data.to); loadQueue(); }, function (err) { toast(err.message); })
      .then(function () { b.disabled = false; b.textContent = "Send test to myself"; });
  });

  $("sendBtn").addEventListener("click", function () {
    var m = message(), p = messageProblem(m);
    if (p) { toast(p.text); $(p.field).focus(); return; }
    var n = check.ready;
    var w = queueData ? queueData.worker : { usedToday: 0, dailyLimit: settings.dailyLimit };
    var ahead = queueData ? [queueData.current].concat(queueData.queued || []).filter(Boolean).reduce(function (sum, b) { return sum + b.pending; }, 0) : 0;
    var leftToday = Math.max(0, w.dailyLimit - w.usedToday - ahead);
    var today = Math.min(n, leftToday), later = n - today;
    var skipped = check.duplicate.length + check.invalid.length + check.suppressed.length;
    openModal(
      '<div class="modal-head"><h2>Send to ' + fmt(n) + (n === 1 ? " person?" : " people?") + '</h2><button class="x" data-close aria-label="Close">×</button></div>' +
      '<div class="modal-body"><dl class="facts">' +
      "<dt>Subject</dt><dd>" + esc(m.subject) + "</dd>" +
      "<dt>From</dt><dd>" + esc(m.fromEmail) + "</dd>" +
      "<dt>Recipients</dt><dd>" + fmt(n) + (skipped ? ' <span class="hint">(' + fmt(skipped) + " left out)</span>" : "") + "</dd>" +
      "<dt>Sent today</dt><dd>" + fmt(today) + (today ? (sendSeconds(today) < 60 ? ", in under a minute" : ", over about " + duration(sendSeconds(today))) : "") + "</dd>" +
      (later ? "<dt>Sent later</dt><dd>" + fmt(later) + " (daily limit " + fmt(w.dailyLimit) + ")</dd>" : "") +
      "</dl>" +
      (ahead ? '<div class="callout callout-warn">' + fmt(ahead) + " emails from earlier batches go out first.</div>" : "") +
      (later ? '<div class="callout callout-warn">The rest continue automatically from ' + pad(settings.startHour) + ":00 on the following days.</div>" : "") +
      '<p class="hint">You can pause or cancel from the Sending screen at any time. Emails already sent can\'t be recalled.</p></div>' +
      '<div class="modal-foot"><button class="btn" data-close>Go back</button><button class="btn btn-primary" id="confirmSend">Send ' + fmt(n) + (n === 1 ? " email" : " emails") + "</button></div>",
      function (modal) {
        modal.querySelector("#confirmSend").addEventListener("click", function (e) {
          e.target.disabled = true;
          api("POST", "/batches", { subject: m.subject, body: m.body, fromName: m.fromName, fromEmail: m.fromEmail, recipients: $("recips").value })
            .then(function (data) {
              closeModal();
              $("recips").value = ""; storeSet("imperio-recips", ""); runCheck();
              toast("Batch started: " + fmt(data.batch.total) + " emails queued");
              location.hash = "#queue";
            }, function (err) { e.target.disabled = false; toast(err.message); });
        });
      });
  });

  // ---------- Modals ----------
  function openModal(html, onReady) {
    var root = $("modalRoot");
    root.innerHTML = '<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true">' + html + "</div></div>";
    var scrim = $("scrim");
    scrim.addEventListener("click", function (e) { if (e.target === scrim || e.target.closest("[data-close]")) closeModal(); });
    var first = scrim.querySelector("select, input, textarea, .modal-foot .btn-primary, button");
    if (first) first.focus();
    if (onReady) onReady(scrim);
  }
  function closeModal() { $("modalRoot").innerHTML = ""; }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

  // ---------- Queue ----------
  var pollTimer;
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!me) return;
    var fast = currentView() === "queue" && !document.hidden;
    pollTimer = setTimeout(function () { loadQueue().then(schedulePoll, schedulePoll); }, fast ? 3000 : 30000);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && me) { loadQueue(); schedulePoll(); } });

  function loadQueue() {
    if (!me) return Promise.resolve();
    return api("GET", "/queue").then(function (data) { queueData = data; renderQueue(); updateSideMeter(); });
  }

  function updateSideMeter() {
    if (!settings) return;
    var used = queueData ? queueData.worker.usedToday : 0;
    $("usedToday").textContent = fmt(used);
    $("dailyLimitLabel").textContent = fmt(settings.dailyLimit);
    $("usedMeter").style.width = Math.min(100, used / settings.dailyLimit * 100) + "%";
    var active = queueData ? (queueData.current ? 1 : 0) + queueData.queued.length : 0;
    $("navBadge").textContent = active; $("navBadge").hidden = !active;
  }

  function batchState(b, w) {
    if (b.status === "paused") return ["Paused", "pill-warn"];
    if (b.status === "cancelled") return ["Cancelled", "pill-neutral"];
    if (b.status === "done") return ["Finished", "pill-good"];
    if (w.phase === "waiting-limit") return ["Continues tomorrow", "pill-warn"];
    if (w.phase === "waiting-morning") return ["Starts at " + pad(w.startHour) + ":00", "pill-warn"];
    if (w.phase === "backoff") return ["Retrying soon", "pill-bad"];
    if (w.phase === "break") return ["Short break", "pill-accent"];
    return ["Sending", "pill-accent"];
  }

  function renderQueue() {
    var d = queueData, w = d.worker, s = settings;
    $("queueRule").textContent = "One email every " + (s.delaySeconds === 1 ? "second" : s.delaySeconds + " seconds") + ", up to " + fmt(s.dailyLimit) + " a day, from " + pad(s.startHour) + ":00. Anything left over continues the next day.";

    var err = w.lastError;
    if (err && (w.phase === "backoff")) {
      var mins = Math.max(1, Math.ceil((w.nextAt - d.now) / 60000));
      $("workerError").textContent = (err.kind === "auth" ? "The mail server rejected the login. Check SMTP_USER and SMTP_PASS in .env, then restart the app." :
        err.kind === "throttled" ? "The mail server asked us to slow down." : "Couldn't reach the mail server.") +
        " Trying again in " + mins + " min. (" + err.message + ")";
      $("workerError").hidden = false;
    } else $("workerError").hidden = true;

    var b = d.current || d.latest;
    $("queueEmpty").hidden = !!d.current;
    $("queueEmptyText").textContent = d.latest ? "Nothing is sending right now. Your last batch is below." : "Nothing is sending right now.";
    $("queuePanel").hidden = !b;
    if (b) {
      var done = b.sent + b.failed + b.skipped;
      var total = b.total || 1;
      var used = w.usedToday;
      var leftToday = Math.max(0, w.dailyLimit - used);
      var tomorrow = b.status === "sending" || b.status === "paused" ? Math.max(0, b.pending - leftToday) : 0;
      var st = batchState(b, w);
      $("qSubject").textContent = b.subject;
      $("qMeta").textContent = "Started " + when(b.createdAt).replace(/^Today/, "today").replace(/^Yesterday/, "yesterday") + ". " + fmt(b.total) + " recipients" + (b.skippedAtStart ? ", " + fmt(b.skippedAtStart) + " left out" : "") + ".";
      $("qState").textContent = st[0]; $("qState").className = "pill " + st[1];
      $("pSent").style.width = (b.sent / total * 100) + "%";
      $("pFail").style.width = (b.failed / total * 100) + "%";
      $("sSent").textContent = fmt(b.sent); $("sFail").textContent = fmt(b.failed);
      $("sPend").textContent = fmt(b.pending); $("sTomorrow").textContent = fmt(tomorrow);
      var eta;
      if (b.status === "done") eta = "All done. " + fmt(b.sent) + " handed to the mail server, " + fmt(b.failed) + " failed" + (b.skipped ? ", " + fmt(b.skipped) + " skipped because they unsubscribed" : "") + ".";
      else if (b.status === "cancelled") eta = "Cancelled. " + fmt(b.cancelled) + " emails were not sent.";
      else if (b.status === "paused") eta = "Paused at " + fmt(done) + " of " + fmt(b.total) + ". Nothing is sending.";
      else if (w.phase === "waiting-limit") eta = "Today's limit is used up. The remaining " + fmt(b.pending) + " continue tomorrow from " + pad(w.startHour) + ":00.";
      else if (w.phase === "waiting-morning") eta = "Sending starts at " + pad(w.startHour) + ":00.";
      else {
        var today = Math.min(b.pending, leftToday);
        var secs = sendSeconds(today);
        eta = fmt(done) + " of " + fmt(b.total) + " done. " + (secs < 60 ? "Less than a minute" : "About " + duration(secs)) + " left today" + (tomorrow ? ", then " + fmt(tomorrow) + " on the following days." : ".");
      }
      $("qEta").textContent = eta;
      var finished = b.status === "done" || b.status === "cancelled";
      $("pauseBtn").textContent = b.status === "paused" ? "Resume" : "Pause";
      $("pauseBtn").hidden = finished; $("cancelBtn").hidden = finished;
      $("pauseBtn").setAttribute("data-id", b.id); $("cancelBtn").setAttribute("data-id", b.id);
    }

    $("queuedPanel").hidden = !d.queued.length;
    $("queuedList").innerHTML = d.queued.map(function (q) {
      return '<div><span class="addr">' + esc(q.subject) + '<span class="why">' + fmt(q.pending) + " waiting, added " + esc(when(q.createdAt)) + "</span></span>" +
        '<span class="pill ' + (q.status === "paused" ? "pill-warn" : "pill-neutral") + '">' + (q.status === "paused" ? "Paused" : "Queued") + "</span></div>";
    }).join("");

    $("logPanel").hidden = !d.log.length;
    $("log").innerHTML = d.log.map(function (l) {
      var t = new Date(l.attempted_at);
      var pill = l.status === "sent" ? '<span class="pill pill-good">Sent</span>' : l.status === "failed" ? '<span class="pill pill-bad">Failed</span>' : '<span class="pill pill-neutral">Skipped</span>';
      return "<li><time>" + pad(t.getHours()) + ":" + pad(t.getMinutes()) + ":" + pad(t.getSeconds()) + "</time>" +
        '<span class="addr">' + esc(l.email) + (l.error && l.status !== "sent" ? '<span class="why">' + esc(l.error) + "</span>" : "") + "</span>" + pill + "</li>";
    }).join("");
  }

  $("pauseBtn").addEventListener("click", function () {
    var id = this.getAttribute("data-id"), resume = this.textContent === "Resume";
    api("POST", "/batches/" + id + (resume ? "/resume" : "/pause"), {}).then(function () { toast(resume ? "Sending resumed" : "Sending paused"); loadQueue(); }, function (err) { toast(err.message); });
  });

  $("cancelBtn").addEventListener("click", function () {
    var id = this.getAttribute("data-id");
    var b = queueData && queueData.current;
    openModal('<div class="modal-head"><h2>Cancel this batch?</h2><button class="x" data-close aria-label="Close">×</button></div>' +
      '<div class="modal-body"><p>The ' + fmt(b ? b.pending : 0) + " emails that haven't gone out yet won't be sent. The " + fmt(b ? b.sent : 0) + " already sent stay sent.</p></div>" +
      '<div class="modal-foot"><button class="btn" data-close>Keep sending</button><button class="btn btn-primary" id="doCancel">Cancel batch</button></div>',
      function (m) {
        m.querySelector("#doCancel").addEventListener("click", function () {
          api("POST", "/batches/" + id + "/cancel", {}).then(function () { closeModal(); toast("Batch cancelled"); loadQueue(); }, function (err) { toast(err.message); });
        });
      });
  });

  // ---------- History ----------
  var historyRows = [];
  var openBatch = null, batchFilter = "all", openDetail = null;

  var HSTATUS = { sending: ["Sending", "pill-accent"], paused: ["Paused", "pill-warn"], done: ["Finished", "pill-good"], cancelled: ["Cancelled", "pill-neutral"] };
  var RSTATUS = { sent: ["Sent", "pill-good"], failed: ["Failed", "pill-bad"], pending: ["Waiting", "pill-neutral"], skipped: ["Skipped", "pill-neutral"], cancelled: ["Not sent", "pill-neutral"] };

  function loadHistory() {
    return api("GET", "/batches").then(function (data) {
      historyRows = data.batches;
      if (openBatch) return loadDetail(); renderHistory();
    }, function (err) { toast(err.message); });
  }

  function loadDetail() {
    return api("GET", "/batches/" + openBatch + "?status=" + batchFilter + "&limit=500").then(function (data) { openDetail = data; renderHistory(); });
  }

  function renderHistory() {
    $("historyEmpty").hidden = historyRows.length > 0;
    $("historyBody").innerHTML = historyRows.map(function (h) {
      var st = HSTATUS[h.status] || [h.status, "pill-neutral"];
      var open = openBatch === h.id;
      var row = '<tr class="batch" tabindex="0" data-batch="' + h.id + '" aria-expanded="' + open + '">' +
        '<td class="num" style="white-space:nowrap">' + esc(when(h.createdAt)) + "</td>" +
        '<td style="min-width:200px">' + esc(h.subject) + '<div class="hint num">' + fmt(h.total) + " recipients" + (h.retryOf ? ", retry of an earlier batch" : "") + "</div></td>" +
        '<td class="n">' + fmt(h.sent) + "</td>" +
        '<td class="n">' + (h.failed ? '<span style="color:var(--bad)">' + fmt(h.failed) + "</span>" : "0") + "</td>" +
        '<td class="n hide-sm">' + fmt(h.skippedAtStart + h.skipped) + "</td>" +
        '<td class="hide-sm"><span class="pill ' + st[1] + '">' + st[0] + "</span></td></tr>";
      if (!open) return row;
      var recips = openDetail && openDetail.batch.id === h.id ? openDetail.recipients : [];
      return row + '<tr class="detail"><td colspan="6"><div class="detail-inner">' +
        '<div class="btn-row" style="justify-content:space-between;align-items:center">' +
        '<div class="seg" role="group" aria-label="Filter recipients">' +
        [["all", "All"], ["sent", "Sent"], ["failed", "Failed"], ["pending", "Waiting"]].map(function (f) { return '<button type="button" data-filter="' + f[0] + '" aria-pressed="' + (batchFilter === f[0]) + '">' + f[1] + "</button>"; }).join("") +
        "</div><div class=\"btn-row\">" +
        (h.failed ? '<a class="btn" href="/api/batches/' + h.id + '/failed.csv" download>Download failed (CSV)</a>' : "") +
        '<button class="btn" type="button" data-retry="' + h.id + '"' + (h.failed ? "" : " disabled") + ">Retry " + fmt(h.failed) + " failed</button>" +
        "</div></div>" +
        '<div class="recip-list">' + (recips.length ? recips.map(function (r) {
          var s = RSTATUS[r.status] || [r.status, "pill-neutral"];
          return '<div><span class="addr">' + esc(r.name ? r.email + " (" + r.name + ")" : r.email) + (r.error ? '<span class="why">' + esc(r.error) + "</span>" : "") + '</span><span class="pill ' + s[1] + '">' + s[0] + "</span></div>";
        }).join("") : '<div><span class="hint">' + (openDetail ? "No recipients with this status." : "Loading…") + "</span></div>") + "</div>" +
        (recips.length === 500 ? '<p class="hint">Showing the first 500. Download the CSV for the full failed list.</p>' : "") +
        "</div></td></tr>";
    }).join("");
  }

  $("historyBody").addEventListener("click", function (e) {
    var f = e.target.closest("[data-filter]");
    if (f) { batchFilter = f.getAttribute("data-filter"); loadDetail(); return; }
    if (e.target.closest("a[download]")) return;
    var rt = e.target.closest("[data-retry]");
    if (rt) {
      var id = +rt.getAttribute("data-retry");
      var h = historyRows.filter(function (x) { return x.id === id; })[0];
      openModal('<div class="modal-head"><h2>Retry ' + fmt(h.failed) + ' failed emails?</h2><button class="x" data-close aria-label="Close">×</button></div>' +
        '<div class="modal-body"><p>They go out again as a new batch, with the same subject and message. Addresses that bounced are on the do-not-email list and are left out.</p></div>' +
        '<div class="modal-foot"><button class="btn" data-close>Go back</button><button class="btn btn-primary" id="doRetry">Retry failed emails</button></div>',
        function (m) {
          m.querySelector("#doRetry").addEventListener("click", function () {
            api("POST", "/batches/" + id + "/retry", {}).then(function (data) {
              closeModal(); toast("Retry started: " + fmt(data.batch.total) + " emails queued"); location.hash = "#queue";
            }, function (err) { closeModal(); toast(err.message); });
          });
        });
      return;
    }
    var row = e.target.closest("tr.batch");
    if (row) {
      var bid = +row.getAttribute("data-batch");
      if (openBatch === bid) { openBatch = null; openDetail = null; renderHistory(); return; }
      openBatch = bid; batchFilter = "all"; openDetail = null; renderHistory(); loadDetail();
    }
  });
  $("historyBody").addEventListener("keydown", function (e) {
    var row = e.target.closest("tr.batch");
    if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); row.click(); }
  });

  boot();
})();
