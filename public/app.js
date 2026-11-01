/* Imperio Mailer front-end mockup.
   Everything here runs on sample data. In step 2 the SAMPLE blocks are replaced by calls to the server API. */
(function () {
  "use strict";

  // ---------- Sample data (replaced by the API later) ----------
  var SUPPRESSED = ["kemi.lawal@gmail.com", "info@oldsupplier.com.ng", "seun.ojo@yahoo.com"];
  var SAMPLE_RECIPIENTS = [
    "adaeze.okafor@gmail.com, Adaeze",
    "tunde@bakerandsons.ng, Tunde",
    "chioma.eze@yahoo.com, Chioma",
    "ifeanyi.nwosu@outlook.com",
    "musa.bello@hotmail.com, Musa",
    "Adaeze.Okafor@gmail.com, Adaeze",
    "bola.adeyemi@gmail, Bola",
    "kemi.lawal@gmail.com, Kemi",
    "procurement@lekkiresorts.com, Lekki Resorts",
    "ngozi.obi@gmail.com, Ngozi",
    "yusuf.danjuma@yahoo.com, Yusuf",
    "femi.akande@gmail.com, Femi",
    "orders@ikejamart.ng",
    "tunde@bakerandsons.ng",
    "halima.sani@gmail.com, Halima"
  ].join("\n");

  var HISTORY = [
    { id: "b5", date: "Today, 13:12", subject: "{name}, our October price list is here", sent: 0, failed: 0, skipped: 3, total: 214, status: "sending" },
    { id: "b4", date: "24 Oct, 09:40", subject: "Closed on Friday for the public holiday", sent: 186, failed: 4, skipped: 2, total: 192, status: "done" },
    { id: "b3", date: "10 Oct, 10:05", subject: "{name}, new delivery areas in Lekki and Ajah", sent: 179, failed: 1, skipped: 1, total: 181, status: "done" },
    { id: "b2", date: "26 Sep, 16:30", subject: "September price list", sent: 120, failed: 0, skipped: 0, total: 160, status: "cancelled" }
  ];
  var FAIL_REASONS = [
    "Mailbox does not exist (550)",
    "Recipient's mailbox is full (452)",
    "Domain has no mail server",
    "Rejected by recipient's server (554)"
  ];
  var FIRST = ["Adaeze", "Tunde", "Chioma", "Musa", "Ngozi", "Yusuf", "Femi", "Halima", "Ibrahim", "Kelechi", "Zainab", "Obinna", "Funke", "Emeka", "Aisha", "Segun"];
  var LAST = ["okafor", "bello", "eze", "obi", "danjuma", "akande", "sani", "nwosu", "adeyemi", "lawal", "ojo", "uche"];
  var DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"];

  function fakeRecipient(i) {
    var f = FIRST[i % FIRST.length], l = LAST[(i * 7) % LAST.length];
    return { email: f.toLowerCase() + "." + l + (i > 40 ? i : "") + "@" + DOMAINS[i % DOMAINS.length], name: f };
  }

  // ---------- Helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return Number(n).toLocaleString("en-NG"); }
  function storeGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function duration(seconds) {
    var m = Math.round(seconds / 60);
    if (m < 1) return "under a minute";
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), r = m % 60;
    return h + " h" + (r ? " " + r + " min" : "");
  }

  // ---------- Router ----------
  var VIEWS = ["compose", "queue", "history", "config"];
  var SOLO = ["login", "unsubscribe"];
  function route() {
    var h = (location.hash || "").replace("#", "") || "compose";
    var solo = SOLO.indexOf(h) !== -1;
    if (!solo && VIEWS.indexOf(h) === -1) h = "compose";
    document.querySelectorAll("[data-solo]").forEach(function (el) { el.hidden = el.getAttribute("data-solo") !== h; });
    $("shell").hidden = solo;
    document.querySelectorAll("[data-view]").forEach(function (el) { el.hidden = el.getAttribute("data-view") !== h; });
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      if (a.getAttribute("data-nav") === h) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  // ---------- Settings values ----------
  function settings() {
    return {
      daily: Math.max(1, parseInt($("dailyLimit").value, 10) || 200),
      delay: Math.max(1, parseInt($("delay").value, 10) || 4),
      batch: Math.max(1, parseInt($("batchSize").value, 10) || 50),
      pause: Math.max(0, parseInt($("batchPause").value, 10) || 0),
      signature: $("signature").value,
      unsub: $("unsubText").value
    };
  }
  function sendSeconds(n) {
    var s = settings();
    return n * s.delay + Math.floor(Math.max(0, n - 1) / s.batch) * s.pause * 60;
  }
  function updateSpeedCalc() {
    var s = settings();
    var day = s.daily;
    $("speedCalc").innerHTML = "At this speed, " + fmt(day) + " emails take about <b>" + duration(sendSeconds(day)) + "</b>. A list of 1,000 would take <b>" + Math.ceil(1000 / s.daily) + " day" + (Math.ceil(1000 / s.daily) > 1 ? "s" : "") + "</b>.";
  }

  // ---------- Compose: recipient parsing ----------
  var EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;
  var parsed = { ready: [], dup: [], bad: [], sup: [] };

  function parseRecipients(text) {
    var out = { ready: [], dup: [], bad: [], sup: [] };
    var seen = {};
    var sup = {};
    SUPPRESSED.forEach(function (e) { sup[e] = true; });
    text.split(/\r?\n/).forEach(function (raw, i) {
      var line = raw.trim();
      if (!line) return;
      var parts = line.split(/[,;\t]/);
      var email = parts[0].trim().replace(/^<|>$/g, "");
      var name = parts.slice(1).join(" ").trim();
      var key = email.toLowerCase();
      var entry = { email: email, name: name, line: i + 1 };
      if (!EMAIL_RE.test(email)) out.bad.push(entry);
      else if (seen[key]) out.dup.push(entry);
      else if (sup[key]) { seen[key] = true; out.sup.push(entry); }
      else { seen[key] = true; out.ready.push(entry); }
    });
    return out;
  }

  function renderTally() {
    parsed = parseRecipients($("recips").value);
    var r = parsed.ready.length, d = parsed.dup.length, b = parsed.bad.length, s = parsed.sup.length;
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
    parsed.bad.forEach(function (e) { rows.push('<div class="issue"><span class="dot c-bad"></span><code>' + esc(e.email || "(blank)") + '</code><em>line ' + e.line + ', not a valid address</em></div>'); });
    parsed.dup.forEach(function (e) { rows.push('<div class="issue"><span class="dot c-dup"></span><code>' + esc(e.email) + '</code><em>line ' + e.line + ', already listed</em></div>'); });
    parsed.sup.forEach(function (e) { rows.push('<div class="issue"><span class="dot c-sup"></span><code>' + esc(e.email) + '</code><em>line ' + e.line + ', unsubscribed</em></div>'); });
    $("issues").innerHTML = rows.join("");
    $("issues").hidden = rows.length === 0;
  }

  function personalize(text, name) { return text.replace(/\{name\}/gi, name || "there"); }

  function emailPreviewHTML(r) {
    var s = settings();
    var unsub = s.unsub.trim();
    var lastSpace = unsub.lastIndexOf(" ");
    var unsubHTML = lastSpace > 0 ? esc(unsub.slice(0, lastSpace + 1)) + "<u>" + esc(unsub.slice(lastSpace + 1)) + "</u>" : "<u>" + esc(unsub) + "</u>";
    return '<div class="mail">' +
      '<div class="mail-meta"><div><span>From </span>' + esc($("fromName").value) + " &lt;" + esc($("fromAddr").value) + "&gt;</div>" +
      "<div><span>To </span>" + esc(r.name ? r.name + " <" + r.email + ">" : r.email) + "</div>" +
      "<div><span>Subject </span><b>" + esc(personalize($("subject").value, r.name)) + "</b></div></div>" +
      '<div class="mail-body">' + esc(personalize($("body").value, r.name)) + "\n\n" + esc(s.signature) + "</div>" +
      '<div class="mail-foot">' + unsubHTML + "</div></div>";
  }

  // ---------- Modals ----------
  function openModal(html, onReady) {
    var root = $("modalRoot");
    root.innerHTML = '<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true">' + html + "</div></div>";
    var scrim = $("scrim");
    scrim.addEventListener("click", function (e) { if (e.target === scrim || e.target.closest("[data-close]")) closeModal(); });
    var first = scrim.querySelector("button, input, select, textarea");
    if (first) first.focus();
    if (onReady) onReady(scrim);
  }
  function closeModal() { $("modalRoot").innerHTML = ""; }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

  function openPreview() {
    var list = parsed.ready.length ? parsed.ready : [{ email: $("fromAddr").value, name: "" }];
    var idx = 0;
    openModal(
      '<div class="modal-head"><h2>Preview</h2><button class="x" data-close aria-label="Close">×</button></div>' +
      '<div class="modal-body"><div class="field"><label for="pvWho">Show it as</label><select class="select" id="pvWho">' +
      list.map(function (r, i) { return '<option value="' + i + '">' + esc(r.name ? r.name + " (" + r.email + ")" : r.email + " (no name)") + "</option>"; }).join("") +
      '</select></div><div id="pvMail"></div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>Close</button></div>',
      function (m) {
        function draw() { m.querySelector("#pvMail").innerHTML = emailPreviewHTML(list[idx]); }
        m.querySelector("#pvWho").addEventListener("change", function (e) { idx = +e.target.value; draw(); });
        draw();
      }
    );
  }

  function openConfirm() {
    var s = settings();
    var n = parsed.ready.length;
    var leftToday = Math.max(0, s.daily - queue.usedToday);
    var today = Math.min(n, leftToday), later = n - today;
    var skipped = parsed.dup.length + parsed.bad.length + parsed.sup.length;
    openModal(
      '<div class="modal-head"><h2>Send to ' + fmt(n) + " people?</h2>" + '<button class="x" data-close aria-label="Close">×</button></div>' +
      '<div class="modal-body">' +
      '<dl class="facts">' +
      "<dt>Subject</dt><dd>" + esc($("subject").value) + "</dd>" +
      "<dt>From</dt><dd>" + esc($("fromAddr").value) + "</dd>" +
      "<dt>Recipients</dt><dd>" + fmt(n) + (skipped ? ' <span class="hint">(' + fmt(skipped) + " left out)</span>" : "") + "</dd>" +
      "<dt>Sent today</dt><dd>" + fmt(today) + " of them, about " + duration(sendSeconds(today)) + "</dd>" +
      (later ? "<dt>Sent tomorrow</dt><dd>" + fmt(later) + " (your daily limit is " + fmt(s.daily) + ")</dd>" : "") +
      "</dl>" +
      (later ? '<div class="callout callout-warn">' + fmt(queue.usedToday) + " emails have already gone out today, so the rest of this batch waits until tomorrow at 8:00.</div>" : "") +
      '<p class="hint">You can pause or cancel from the Sending screen at any time. Emails already sent can\'t be recalled.</p>' +
      "</div>" +
      '<div class="modal-foot"><button class="btn" data-close>Go back</button><button class="btn btn-primary" id="confirmSend">Send ' + fmt(n) + " emails</button></div>",
      function (m) {
        m.querySelector("#confirmSend").addEventListener("click", function () {
          closeModal();
          startBatch($("subject").value, parsed.ready.slice(), skipped);
          location.hash = "#queue";
          toast("Batch started: " + fmt(n) + " emails queued");
        });
      }
    );
  }

  // ---------- Queue simulation ----------
  var queue = {
    subject: HISTORY[0].subject,
    recipients: [],
    sent: 132, failed: 3, total: 214, skipped: 3,
    usedToday: 132,
    state: "sending",
    log: [],
    started: "today at 13:12",
    timer: null
  };
  for (var i = 0; i < 214; i++) queue.recipients.push(fakeRecipient(i));

  // seed log with recent results
  (function seedLog() {
    var t = new Date(Date.now() - 4000);
    for (var j = 0; j < 8; j++) {
      var r = queue.recipients[queue.sent - 1 - j];
      var fail = j === 3;
      queue.log.push({ time: new Date(t.getTime() - j * 4000), email: r.email, ok: !fail, why: fail ? FAIL_REASONS[0] : "" });
    }
  })();

  function startBatch(subject, recips, skipped) {
    clearInterval(queue.timer);
    HISTORY.forEach(function (h) { if (h.status === "sending" || h.status === "paused" || h.status === "waiting") { h.status = "cancelled"; h.sent = queue.sent; h.failed = queue.failed; } });
    queue.subject = subject;
    queue.recipients = recips.length ? recips : [fakeRecipient(0)];
    queue.total = queue.recipients.length;
    queue.sent = 0; queue.failed = 0; queue.skipped = skipped;
    queue.state = "sending";
    queue.log = [];
    var now = new Date();
    queue.started = "today at " + pad(now.getHours()) + ":" + pad(now.getMinutes());
    HISTORY.unshift({ id: "b" + Date.now(), date: "Today, " + pad(now.getHours()) + ":" + pad(now.getMinutes()), subject: subject, sent: 0, failed: 0, skipped: skipped, total: queue.total, status: "sending" });
    tick(); run();
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function run() {
    clearInterval(queue.timer);
    queue.timer = setInterval(tick, 900);
  }

  function tick() {
    if (queue.state !== "sending") { renderQueue(); return; }
    var done = queue.sent + queue.failed;
    var s = settings();
    if (done >= queue.total) { queue.state = "done"; clearInterval(queue.timer); syncHistory(); renderQueue(); return; }
    if (queue.usedToday >= s.daily) { queue.state = "waiting"; clearInterval(queue.timer); syncHistory(); renderQueue(); return; }
    var r = queue.recipients[done];
    var fail = (done * 37) % 61 === 5;
    if (fail) queue.failed++; else queue.sent++;
    queue.usedToday++;
    queue.log.unshift({ time: new Date(), email: r.email, ok: !fail, why: fail ? FAIL_REASONS[done % FAIL_REASONS.length] : "" });
    if (queue.log.length > 60) queue.log.pop();
    syncHistory();
    renderQueue();
  }

  function syncHistory() {
    var h = HISTORY[0];
    h.sent = queue.sent; h.failed = queue.failed;
    h.status = queue.state === "done" ? "done" : queue.state === "cancelled" ? "cancelled" : queue.state === "waiting" ? "waiting" : queue.state === "paused" ? "paused" : "sending";
    if (!$("historyBody").closest("[hidden]")) renderHistory();
  }

  var STATE_LABEL = {
    sending: ["Sending", "pill-accent"],
    paused: ["Paused", "pill-warn"],
    waiting: ["Continues tomorrow", "pill-warn"],
    done: ["Finished", "pill-good"],
    cancelled: ["Cancelled", "pill-neutral"]
  };

  function renderQueue() {
    var s = settings();
    var done = queue.sent + queue.failed;
    var pending = Math.max(0, queue.total - done);
    var leftToday = Math.max(0, s.daily - queue.usedToday);
    var tomorrow = queue.state === "cancelled" ? 0 : Math.max(0, pending - leftToday);
    $("qSubject").textContent = queue.subject;
    $("qMeta").textContent = "Started " + queue.started + ". " + fmt(queue.total) + " recipients, " + fmt(queue.skipped) + " left out.";
    var lbl = STATE_LABEL[queue.state];
    $("qState").textContent = lbl[0]; $("qState").className = "pill " + lbl[1];
    $("pSent").style.width = (queue.sent / queue.total * 100) + "%";
    $("pFail").style.width = (queue.failed / queue.total * 100) + "%";
    $("sSent").textContent = fmt(queue.sent);
    $("sFail").textContent = fmt(queue.failed);
    $("sPend").textContent = fmt(queue.state === "cancelled" ? 0 : pending);
    $("sTomorrow").textContent = fmt(tomorrow);

    var eta;
    if (queue.state === "done") eta = "All done. " + fmt(queue.sent) + " delivered to the mail server, " + fmt(queue.failed) + " failed.";
    else if (queue.state === "cancelled") eta = "Cancelled. " + fmt(pending) + " emails were not sent.";
    else if (queue.state === "waiting") eta = "Daily limit reached. The remaining " + fmt(pending) + " go out tomorrow from 8:00.";
    else if (queue.state === "paused") eta = "Paused at " + fmt(done) + " of " + fmt(queue.total) + ". Nothing is sending.";
    else eta = fmt(done) + " of " + fmt(queue.total) + " done. About " + duration(sendSeconds(Math.min(pending, leftToday))) + " left today" + (tomorrow ? ", then " + fmt(tomorrow) + " tomorrow." : ".");
    $("qEta").textContent = eta;

    var finished = queue.state === "done" || queue.state === "cancelled";
    $("pauseBtn").textContent = queue.state === "paused" ? "Resume" : "Pause";
    $("pauseBtn").disabled = finished || queue.state === "waiting";
    $("cancelBtn").disabled = finished;

    var active = queue.state === "sending" || queue.state === "paused" || queue.state === "waiting";
    $("navBadge").hidden = !active;
    $("usedToday").textContent = fmt(queue.usedToday);
    $("usedMeter").style.width = Math.min(100, queue.usedToday / s.daily * 100) + "%";

    $("log").innerHTML = queue.log.length ? queue.log.map(function (l) {
      return "<li><time>" + pad(l.time.getHours()) + ":" + pad(l.time.getMinutes()) + ":" + pad(l.time.getSeconds()) + "</time>" +
        '<span class="addr">' + esc(l.email) + (l.why ? '<span class="why">' + esc(l.why) + "</span>" : "") + "</span>" +
        (l.ok ? '<span class="pill pill-good">Sent</span>' : '<span class="pill pill-bad">Failed</span>') + "</li>";
    }).join("") : '<li style="display:block"><div class="empty">Results show up here as each email goes out.</div></li>';
  }

  // ---------- History ----------
  var openBatch = null;
  var batchFilter = "all";

  function batchRecipients(h) {
    var list = [];
    for (var i = 0; i < h.total; i++) {
      var r = (h.id === HISTORY[0].id ? queue.recipients[i] : null) || fakeRecipient(i + h.id.length * 13);
      var status, why = "";
      if (i < h.failed) { status = "failed"; why = FAIL_REASONS[i % FAIL_REASONS.length]; }
      else if (i < h.failed + h.sent) status = "sent";
      else status = h.status === "cancelled" ? "cancelled" : "waiting";
      list.push({ email: r.email, status: status, why: why });
    }
    return list;
  }

  var HSTATUS = {
    sending: ["Sending", "pill-accent"], paused: ["Paused", "pill-warn"], waiting: ["Continues tomorrow", "pill-warn"],
    done: ["Finished", "pill-good"], cancelled: ["Cancelled", "pill-neutral"]
  };
  var RSTATUS = { sent: ["Sent", "pill-good"], failed: ["Failed", "pill-bad"], waiting: ["Waiting", "pill-neutral"], cancelled: ["Not sent", "pill-neutral"] };

  function renderHistory() {
    var body = $("historyBody");
    body.innerHTML = HISTORY.map(function (h) {
      var st = HSTATUS[h.status];
      var open = openBatch === h.id;
      var row = '<tr class="batch" tabindex="0" data-batch="' + h.id + '" aria-expanded="' + open + '">' +
        '<td class="num" style="white-space:nowrap">' + esc(h.date) + "</td>" +
        '<td style="min-width:200px">' + esc(h.subject) + '<div class="hint num">' + fmt(h.total) + " recipients</div></td>" +
        '<td class="n">' + fmt(h.sent) + "</td>" +
        '<td class="n">' + (h.failed ? '<span style="color:var(--bad)">' + fmt(h.failed) + "</span>" : "0") + "</td>" +
        '<td class="n hide-sm">' + fmt(h.skipped) + "</td>" +
        '<td class="hide-sm"><span class="pill ' + st[1] + '">' + st[0] + "</span></td></tr>";
      if (!open) return row;
      var recips = batchRecipients(h);
      var shown = recips.filter(function (r) { return batchFilter === "all" || r.status === batchFilter; });
      var failedCount = recips.filter(function (r) { return r.status === "failed"; }).length;
      return row + '<tr class="detail"><td colspan="6"><div class="detail-inner">' +
        '<div class="btn-row" style="justify-content:space-between;align-items:center">' +
        '<div class="seg" role="group" aria-label="Filter recipients">' +
        ["all", "sent", "failed"].map(function (f) { return '<button type="button" data-filter="' + f + '" aria-pressed="' + (batchFilter === f) + '">' + (f === "all" ? "All" : f === "sent" ? "Sent" : "Failed") + "</button>"; }).join("") +
        "</div>" +
        '<div class="btn-row">' +
        '<button class="btn" type="button" data-copy-failed="' + h.id + '"' + (failedCount ? "" : " disabled") + ">Copy failed addresses</button>" +
        '<button class="btn" type="button" data-retry="' + h.id + '"' + (failedCount ? "" : " disabled") + ">Retry " + fmt(failedCount) + " failed</button>" +
        "</div></div>" +
        '<div class="recip-list">' + (shown.length ? shown.slice(0, 200).map(function (r) {
          var s = RSTATUS[r.status];
          return '<div><span class="addr">' + esc(r.email) + (r.why ? '<span class="why">' + esc(r.why) + "</span>" : "") + '</span><span class="pill ' + s[1] + '">' + s[0] + "</span></div>";
        }).join("") : '<div><span class="hint">No recipients with this status.</span></div>') + "</div>" +
        "</div></td></tr>";
    }).join("");
  }

  $("historyBody").addEventListener("click", function (e) {
    var f = e.target.closest("[data-filter]");
    if (f) { batchFilter = f.getAttribute("data-filter"); renderHistory(); return; }
    var c = e.target.closest("[data-copy-failed]");
    if (c) {
      var h = HISTORY.filter(function (x) { return x.id === c.getAttribute("data-copy-failed"); })[0];
      var text = batchRecipients(h).filter(function (r) { return r.status === "failed"; }).map(function (r) { return r.email; }).join("\n");
      copyText(text, "Failed addresses copied");
      return;
    }
    var rt = e.target.closest("[data-retry]");
    if (rt) {
      var hb = HISTORY.filter(function (x) { return x.id === rt.getAttribute("data-retry"); })[0];
      var failed = batchRecipients(hb).filter(function (r) { return r.status === "failed"; }).map(function (r) { return { email: r.email, name: "" }; });
      openModal(
        '<div class="modal-head"><h2>Retry ' + fmt(failed.length) + " failed emails?</h2><button class=\"x\" data-close aria-label=\"Close\">×</button></div>" +
        '<div class="modal-body"><p>They\'ll be sent again with the same subject and message. Addresses that don\'t exist will fail again and be added to the do-not-email list.</p></div>' +
        '<div class="modal-foot"><button class="btn" data-close>Go back</button><button class="btn btn-primary" id="doRetry">Retry ' + fmt(failed.length) + " emails</button></div>",
        function (m) {
          m.querySelector("#doRetry").addEventListener("click", function () {
            closeModal();
            startBatch(hb.subject, failed, 0);
            location.hash = "#queue";
            toast("Retry started: " + fmt(failed.length) + " emails queued");
          });
        });
      return;
    }
    var row = e.target.closest("tr.batch");
    if (row) { var id = row.getAttribute("data-batch"); openBatch = openBatch === id ? null : id; batchFilter = "all"; renderHistory(); }
  });
  $("historyBody").addEventListener("keydown", function (e) {
    var row = e.target.closest("tr.batch");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); row.click(); }
  });

  function copyText(text, msg) {
    try {
      navigator.clipboard.writeText(text).then(function () { toast(msg); }, function () { showCopyFallback(text); });
    } catch (err) { showCopyFallback(text); }
  }
  function showCopyFallback(text) {
    openModal('<div class="modal-head"><h2>Copy these addresses</h2><button class="x" data-close aria-label="Close">×</button></div>' +
      '<div class="modal-body"><textarea class="textarea mono-ish" id="copyBox" rows="8" readonly>' + esc(text) + "</textarea></div>" +
      '<div class="modal-foot"><button class="btn" data-close>Done</button></div>', function (m) { var t = m.querySelector("#copyBox"); t.focus(); t.select(); });
  }

  // ---------- Wiring ----------
  function wire() {
    // Login
    $("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!$("loginPass").value) { $("loginError").hidden = false; $("loginPass").focus(); return; }
      $("loginError").hidden = true;
      location.hash = "#compose";
    });

    // Unsubscribe
    $("unsubBtn").addEventListener("click", function () { $("unsubAsk").hidden = true; $("unsubDone").hidden = false; });
    $("resubBtn").addEventListener("click", function () { $("unsubAsk").hidden = false; $("unsubDone").hidden = true; toast("You're still on the list"); });

    // Compose
    var draft = storeGet("imperio-recips", null);
    $("recips").value = draft !== null ? draft : SAMPLE_RECIPIENTS;
    $("recips").addEventListener("input", function () { renderTally(); storeSet("imperio-recips", $("recips").value); });
    $("insertName").addEventListener("click", function () {
      var el = document.activeElement === $("subject") ? $("subject") : $("body");
      var s = el.selectionStart != null ? el.selectionStart : el.value.length;
      var e2 = el.selectionEnd != null ? el.selectionEnd : s;
      el.value = el.value.slice(0, s) + "{name}" + el.value.slice(e2);
      el.focus(); el.selectionStart = el.selectionEnd = s + 6;
    });
    $("previewBtn").addEventListener("click", openPreview);
    $("testBtn").addEventListener("click", function () { toast("Test sent to admin@placornat.com"); });
    $("sendBtn").addEventListener("click", function () {
      if (!$("subject").value.trim()) { toast("Add a subject before sending"); $("subject").focus(); return; }
      openConfirm();
    });

    // Queue
    $("pauseBtn").addEventListener("click", function () {
      if (queue.state === "paused") { queue.state = "sending"; run(); toast("Sending resumed"); }
      else { queue.state = "paused"; toast("Sending paused"); }
      syncHistory(); renderQueue();
    });
    $("cancelBtn").addEventListener("click", function () {
      var pending = queue.total - queue.sent - queue.failed;
      openModal('<div class="modal-head"><h2>Cancel this batch?</h2><button class="x" data-close aria-label="Close">×</button></div>' +
        '<div class="modal-body"><p>The ' + fmt(pending) + " emails that haven't gone out yet won't be sent. The " + fmt(queue.sent) + " already sent stay sent.</p></div>" +
        '<div class="modal-foot"><button class="btn" data-close>Keep sending</button><button class="btn btn-primary" id="doCancel">Cancel batch</button></div>',
        function (m) {
          m.querySelector("#doCancel").addEventListener("click", function () {
            closeModal(); queue.state = "cancelled"; clearInterval(queue.timer); syncHistory(); renderQueue(); toast("Batch cancelled");
          });
        });
    });

    // Settings
    var PRESETS = {
      // [server, port, suggested daily limit, suggested seconds between emails]
      zoho: ["smtppro.zoho.com", "465", "200", "30"],
      godaddy: ["smtpout.secureserver.net", "465", "450", "10"],
      brevo: ["smtp-relay.brevo.com", "587", "500", "4"],
      ses: ["email-smtp.eu-west-1.amazonaws.com", "587", "500", "4"],
      custom: ["", "587", "200", "10"]
    };
    $("smtpPreset").addEventListener("change", function (e) {
      var p = PRESETS[e.target.value];
      $("smtpHost").value = p[0]; $("smtpPort").value = p[1];
      $("dailyLimit").value = p[2]; $("delay").value = p[3];
      $("connOk").hidden = true;
      updateSpeedCalc(); renderQueue();
      toast("Daily limit and speed set for " + e.target.selectedOptions[0].textContent);
    });
    $("testConn").addEventListener("click", function () {
      var b = $("testConn"); b.disabled = true; b.textContent = "Testing…";
      setTimeout(function () { b.disabled = false; b.textContent = "Test connection"; $("connOk").hidden = false; }, 900);
    });
    ["dailyLimit", "delay", "batchSize", "batchPause"].forEach(function (id) { $(id).addEventListener("input", function () { updateSpeedCalc(); renderQueue(); }); });
    $("saveSettings").addEventListener("click", function () { toast("Settings saved"); });
    $("viewSup").addEventListener("click", function () {
      openModal('<div class="modal-head"><h2>Do-not-email list</h2><button class="x" data-close aria-label="Close">×</button></div>' +
        '<div class="modal-body"><div class="recip-list">' +
        SUPPRESSED.map(function (e) { return '<div><span class="addr">' + esc(e) + '</span><span class="pill pill-neutral">Unsubscribed</span></div>'; }).join("") +
        '<div><span class="addr">dayo@closedbiz.ng<span class="why">Mailbox does not exist (550)</span></span><span class="pill pill-bad">Bounced</span></div>' +
        '</div><p class="hint">Showing 4 of 36. Remove someone only if they asked to be added back.</p></div>' +
        '<div class="modal-foot"><button class="btn" data-close>Close</button></div>');
    });
  }

  wire();
  renderTally();
  updateSpeedCalc();
  renderQueue();
  renderHistory();
  run();
  route();
})();
