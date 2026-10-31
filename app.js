/* Inera Doctor Hub — application logic (no frameworks, no servers, no API keys). */
(function () {
  "use strict";

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function num(id) { var v = parseFloat($(id).value); return isNaN(v) ? null : v; }
  function uid() { return "IDH-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(); }
  var toastTimer = null;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast("Device storage is full - export and delete old records."); return false; } }
  };
  function uniq(a) { var o = {}, r = []; a.forEach(function (x) { if (!o[x]) { o[x] = 1; r.push(x); } }); return r; }
  var LAB_TAG = { lab_low_hb: "Low haemoglobin", lab_high_hct: "High haematocrit", lab_low_wbc: "Low WBC", lab_high_wbc: "High WBC", lab_low_plt: "Low platelets",
    lab_low_mcv: "Low MCV (microcytosis)", lab_high_mcv: "High MCV (macrocytosis)", lab_low_ferritin: "Low ferritin", lab_dm: "Glucose / HbA1c in diabetic range",
    lab_predm: "Prediabetic glucose", lab_high_creat: "Raised creatinine", lab_low_tsh: "Low TSH", lab_high_tsh: "Raised TSH", lab_low_vitd: "Low vitamin D",
    lab_low_b12: "Low vitamin B12", lab_high_bili: "Raised bilirubin", lab_high_alt: "Raised ALT", lab_high_ua: "Raised uric acid", lab_high_crp: "Raised CRP",
    lab_high_ldl: "Raised LDL", lab_high_tg: "Raised triglycerides", lab_high_chol: "Raised cholesterol", lab_uti: "Urine: pyuria / nitrite",
    lab_dengue: "Dengue NS1/IgM positive", lab_malaria: "Malaria test positive", lab_hbsag: "HBsAg reactive", lab_preg: "Pregnancy test positive" };
  function symLabel(k) { return SYMPTOMS[k] ? SYMPTOMS[k][0] : LAB_TAG[k] || k.replace(/_/g, " "); }
  function fmtDate(d) { return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }

  /* ---------- state ---------- */
  var S = { cond: null, ddx: [], ext: null, flags: [], rx: [], attachments: [], labs: { findings: [], tags: [], notes: [] }, current: null, ix: [], learn: { score: 0, total: 0, answered: false } };

  /* ---------- drug name resolution ---------- */
  var DRUG_NAMES = [];
  Object.keys(DRUGS).forEach(function (k) {
    var d = DRUGS[k];
    var names = (d.al || []).slice();
    names.push(d.n.split("(")[0].trim().toLowerCase());
    names.push(k.replace(/_/g, " "));
    names.push(k.split("_")[0]);
    uniq(names).forEach(function (n) { if (n && n.length > 1) DRUG_NAMES.push([n.toLowerCase(), k]); });
  });
  DRUG_NAMES.sort(function (a, b) { return b[0].length - a[0].length; });

  function matchDrugText(text) {
    var t = " " + String(text || "").toLowerCase() + " ", out = [];
    DRUG_NAMES.forEach(function (p) {
      var re = new RegExp("(?:^|[^a-z0-9])" + escRe(p[0]) + "(?![a-z])", "i");
      if (re.test(t)) out.push(p[1]);
    });
    return uniq(out);
  }
  function resolveDrug(name) {
    var n = String(name || "").trim().toLowerCase();
    if (!n) return null;
    var keys = Object.keys(DRUGS);
    for (var i = 0; i < keys.length; i++) if (DRUGS[keys[i]].n.toLowerCase() === n) return keys[i];
    var m = matchDrugText(n);
    return m.length ? m[0] : null;
  }

  /* ---------- symptom extraction ---------- */
  var SYM_PAIRS = [];
  Object.keys(SYMPTOMS).forEach(function (k) { SYMPTOMS[k].slice(1).forEach(function (a) { SYM_PAIRS.push([a.toLowerCase(), k]); }); });
  SYM_PAIRS.sort(function (a, b) { return b[0].length - a[0].length; });
  var NEG_RE = /(?:^|\s)(no|not|without|denies|denied|nil|absent|never|negative for|free of)(?=\s|$)/;

  function extract(text) {
    var raw = String(text || "").toLowerCase();
    var t = " " + raw.replace(/[.;!?\n,]+/g, " | ").replace(/[^a-z0-9|+\- ]/g, " ").replace(/\s+/g, " ") + " ";
    var present = {}, negated = {};
    SYM_PAIRS.forEach(function (p) {
      var re = new RegExp("([^a-z0-9]|^)(" + escRe(p[0]) + ")(?![a-z0-9])", "g"), m;
      while ((m = re.exec(t)) !== null) {
        var start = m.index + m[1].length, len = m[2].length;
        var before = t.substring(Math.max(0, start - 34), start);
        var clause = before.split("|").pop().split(/\s(?:but|however|although|except)\s/).pop();
        if (NEG_RE.test(clause)) negated[p[1]] = 1; else present[p[1]] = 1;
        t = t.substring(0, start) + new Array(len + 1).join(" ") + t.substring(start + len);
        re.lastIndex = start + len;
      }
    });
    Object.keys(present).forEach(function (k) { (IMPLIES[k] || []).forEach(function (x) { present[x] = 1; }); });
    Object.keys(present).forEach(function (k) { delete negated[k]; });
    var days = null, dm = raw.match(/(\d+)\s*(day|days|din|week|weeks|wk|wks|month|months)\b/);
    if (dm) { var n = parseInt(dm[1], 10); days = /week|wk/.test(dm[2]) ? n * 7 : /month/.test(dm[2]) ? n * 30 : n; }
    else if (/since yesterday/.test(raw)) days = 1;
    var tempF = null, tm = raw.match(/(\d{2,3}(?:\.\d)?)\s*(?:°|deg(?:ree)?s?)?\s*f\b/);
    if (tm) { var tv = parseFloat(tm[1]); if (tv >= 95 && tv <= 110) tempF = tv; }
    var tc = raw.match(/(\d{2}(?:\.\d)?)\s*(?:°|deg(?:ree)?s?)\s*c\b/);
    if (!tempF && tc) { var cv = parseFloat(tc[1]); if (cv >= 35 && cv <= 43) tempF = Math.round((cv * 9 / 5 + 32) * 10) / 10; }
    if (tempF && tempF >= 100.4) present.fever = 1;
    if (present.cough && days !== null && days >= 14) present.chronic_cough = 1;
    return { present: present, negated: negated, days: days, tempF: tempF };
  }

  /* ---------- ranking ---------- */
  function rank(present, labTags) {
    var all = {};
    Object.keys(present).forEach(function (k) { all[k] = 1; });
    labTags.forEach(function (k) { all[k] = 1; });
    return CONDITIONS.map(function (c) {
      var score = 0, total = 0, matched = [], against = [];
      Object.keys(c.s).forEach(function (k) {
        var w = c.s[k];
        if (w > 0) total += w;
        if (all[k]) { score += w; if (w > 0) matched.push(k); else against.push(k); }
      });
      var cov = total ? Math.max(0, score) / total : 0;
      return { c: c, score: score, cov: cov, matched: matched, against: against };
    }).filter(function (r) { return r.score >= 3 && r.matched.length > 0 && (r.c.req || []).every(function (k) { return all[k]; }); })
      .sort(function (a, b) { return (b.score + b.cov * 6) - (a.score + a.cov * 6); })
      .slice(0, 6);
  }

  /* ---------- patient ---------- */
  function getPatient() {
    var flags = {}, allergies = [];
    qsa("#flagBox input:checked").forEach(function (i) { flags[i.value] = true; });
    qsa("#allergyBox input:checked").forEach(function (i) { allergies.push(i.value); });
    var age = num("pAge"), egfr = num("pEgfr");
    if (age !== null && age >= 65) flags.elderly = true;
    if (egfr !== null && egfr < 60) flags.ckd = true;
    var medsText = $("pMeds").value.trim();
    var medKeys = matchDrugText(medsText);
    medKeys.forEach(function (k) { if ((DRUGS[k].tags || []).indexOf("anticoag") >= 0) flags.anticoag = true; });
    return {
      name: $("pName").value.trim(), age: age, sex: $("pSex").value, wt: num("pWt"), phone: $("pPhone").value.trim(), egfr: egfr,
      flags: flags, allergies: allergies, medsText: medsText, medKeys: medKeys,
      vitals: { temp: num("vTemp"), sbp: num("vSbp"), dbp: num("vDbp"), pulse: num("vPulse"), spo2: num("vSpo2"), rr: num("vRr") }
    };
  }
  var FLAG_LABEL = { pregnant: "Pregnant", breastfeeding: "Breastfeeding", diabetes: "Diabetes", htn: "Hypertension", ckd: "CKD", liver: "Liver disease", heart: "Heart disease", asthma: "Asthma/COPD", pud: "Peptic ulcer", anticoag: "On anticoagulant", elderly: "Age 65+" };

  /* ---------- safety engine ---------- */
  function checkDrug(key, P) {
    var d = DRUGS[key], res = { st: "ok", msgs: [] };
    if (!d) return { st: "warn", msgs: ["Not in formulary - verify manually"] };
    (d.allergy || []).forEach(function (g) {
      if (P.allergies.indexOf(g) >= 0) { res.st = "block"; res.msgs.push("ALLERGY: patient is allergic to " + g + " group"); }
    });
    if ((d.allergy || []).indexOf("cephalosporin") >= 0 && P.allergies.indexOf("penicillin") >= 0 && res.st !== "block") {
      res.st = "warn"; res.msgs.push("Penicillin allergy: cephalosporin cross-reactivity is low (~1-2%); avoid if previous anaphylaxis");
    }
    if (d.block) Object.keys(d.block).forEach(function (f) {
      if (f === "ckd" && d.renalBelow && P.egfr !== null) {
        if (P.egfr < d.renalBelow) { res.st = "block"; res.msgs.push("eGFR " + P.egfr + " is below " + d.renalBelow + ": " + d.block[f]); }
        return;
      }
      if (P.flags[f]) { res.st = "block"; res.msgs.push(d.block[f]); }
    });
    if (d.warn) Object.keys(d.warn).forEach(function (f) {
      if (P.flags[f]) { if (res.st === "ok") res.st = "warn"; res.msgs.push(d.warn[f]); }
    });
    if (P.medKeys.indexOf(key) >= 0) { if (res.st === "ok") res.st = "warn"; res.msgs.push("Patient already takes this medicine - avoid duplication"); }
    return res;
  }
  function mkLine(item, chk) {
    var d = DRUGS[item.d];
    return { d: item.d, name: d.n, form: d.st, u: d.u, dose: item.dose, s: item.s, t: item.t, days: item.days, prn: !!item.prn,
      note: item.note || "", cond: item.cond || "", st: chk.st, msgs: chk.msgs, replaced: [], override: false };
  }
  function resolveItem(item, P) {
    var chk = checkDrug(item.d, P);
    if (chk.st === "block" && item.alt) {
      var r = resolveItem(item.alt, P);
      r.replaced = ["Replaced " + DRUGS[item.d].n + " (" + chk.msgs.join("; ") + ")"].concat(r.replaced);
      return r;
    }
    return mkLine(item, chk);
  }
  var PAED = "Paediatric patient: weight-based dose required - calculate from paediatric formulary (IAP / BNFc) and verify";
  function applyPaed(line, P) {
    if (P.age !== null && P.age < 16) {
      if (line.dose.indexOf("Weight-based") !== 0) line.dose = "Weight-based (" + (P.wt ? P.wt + " kg" : "enter weight") + ") - verify";
      if (line.st === "ok") line.st = "warn";
      if (line.msgs.indexOf(PAED) < 0) line.msgs.push(PAED);
    }
    return line;
  }
  function buildRx(cond, P) {
    return (cond.rx || []).map(function (it) { return applyPaed(resolveItem(it, P), P); });
  }
  function recheckRx() {
    if (!S.cond) return;
    var P = getPatient();
    S.rx.forEach(function (l) {
      var c = checkDrug(l.d, P); l.st = c.st; l.msgs = c.msgs; applyPaed(l, P);
    });
    renderRx();
  }

  function interactions(keys) {
    var res = [], seen = {}, u = uniq(keys.filter(function (k) { return DRUGS[k]; }));
    for (var i = 0; i < u.length; i++) for (var j = i + 1; j < u.length; j++) {
      var a = u[i], b = u[j];
      var ta = [a].concat(DRUGS[a].tags || []), tb = [b].concat(DRUGS[b].tags || []);
      INTERACTIONS.forEach(function (r) {
        if ((ta.indexOf(r[0]) >= 0 && tb.indexOf(r[1]) >= 0) || (ta.indexOf(r[1]) >= 0 && tb.indexOf(r[0]) >= 0)) {
          var id = a + b + r[3];
          if (!seen[id]) { seen[id] = 1; res.push({ a: a, b: b, sev: r[2], t: r[3] }); }
        }
      });
    }
    var order = { major: 0, moderate: 1, minor: 2 };
    return res.sort(function (x, y) { return order[x.sev] - order[y.sev]; });
  }
  function ixHtml(list) {
    if (!list.length) return '<div class="alert ok">No known interactions between these medicines in the Inera rule set.</div>';
    return list.map(function (x) {
      var cls = x.sev === "major" ? "emergency" : x.sev === "moderate" ? "urgent" : "info";
      return '<div class="alert ' + cls + '"><b>' + x.sev.toUpperCase() + ":</b> " + esc(DRUGS[x.a].n) + " + " + esc(DRUGS[x.b].n) + " - " + esc(x.t) + "</div>";
    }).join("");
  }

  /* ---------- red flags ---------- */
  function redFlags(ext, P, labs) {
    var out = [], pr = ext.present;
    RED_FLAGS.forEach(function (r) {
      var hit = r.all ? r.all.every(function (k) { return pr[k]; }) : r.any.some(function (k) { return pr[k]; });
      if (hit) out.push({ lvl: r.lvl, t: r.t });
    });
    var v = P.vitals, temp = v.temp || ext.tempF;
    if (v.spo2 !== null && v.spo2 < 92) out.push({ lvl: "emergency", t: "SpO2 " + v.spo2 + "% - hypoxia: oxygen and emergency evaluation." });
    else if (v.spo2 !== null && v.spo2 < 95) out.push({ lvl: "urgent", t: "SpO2 " + v.spo2 + "% - borderline; reassess and consider chest X-ray." });
    if (v.sbp !== null && (v.sbp >= 180 || (v.dbp !== null && v.dbp >= 120))) out.push({ lvl: "emergency", t: "BP " + v.sbp + "/" + (v.dbp || "-") + " - severe hypertension: check for end-organ damage (chest pain, breathlessness, neuro deficit, vision)." });
    if (v.sbp !== null && v.sbp < 90) out.push({ lvl: "emergency", t: "Systolic BP " + v.sbp + " - hypotension / shock: IV access, fluids, find the cause." });
    if (v.pulse !== null && v.pulse > 120) out.push({ lvl: "urgent", t: "Pulse " + v.pulse + "/min - tachycardia: assess for sepsis, dehydration, arrhythmia." });
    if (v.rr !== null && v.rr >= 22 && (temp || pr.fever)) out.push({ lvl: "urgent", t: "RR " + v.rr + " with fever - apply qSOFA; consider sepsis." });
    if (temp && temp >= 104) out.push({ lvl: "urgent", t: "Temperature " + temp + " F - hyperpyrexia: active cooling, look for serious infection." });
    if (pr.fever && ext.days !== null && ext.days > 7) out.push({ lvl: "caution", t: "Fever beyond 7 days (pyrexia of unknown origin work-up): CBC, blood culture, malaria test, urine culture, chest X-ray; consider typhoid, TB, UTI, endocarditis." });
    if (pr.cough && ext.days !== null && ext.days >= 14) out.push({ lvl: "urgent", t: "Cough for 2 weeks or more - presumptive TB: sputum NAAT (CBNAAT/Truenat) and chest X-ray as per NTEP." });
    if (pr.mouth_ulcer && ext.days !== null && ext.days >= 21) out.push({ lvl: "urgent", t: "Mouth ulcer for 3 weeks or more - biopsy to exclude oral cancer." });
    if (pr.diarrhea && ext.days !== null && ext.days >= 14) out.push({ lvl: "caution", t: "Diarrhoea for 2 weeks or more - persistent diarrhoea work-up (stool studies, HIV, coeliac, IBD)." });
    if (pr.chest_pain && P.age !== null && P.age < 30) out.push({ lvl: "info", t: "Young age does not exclude cardiac or pulmonary embolic causes of chest pain - ECG regardless." });
    (labs.findings || []).forEach(function (f) { if (f.status === "Critical") out.push({ lvl: "emergency", t: "Critical lab value: " + f.name + " " + f.value + " " + f.unit + " - " + f.note }); });
    if (P.age !== null && P.age < 16) out.push({ lvl: "info", t: "Paediatric patient (under 16) - doses are not auto-calculated. Use weight-based paediatric dosing and IMNCI danger signs." });
    if (P.flags.pregnant) out.push({ lvl: "info", t: "Pregnancy - every medicine has been screened; teratogenic drugs are blocked. Confirm gestational age." });
    var lv = { emergency: 0, urgent: 1, caution: 2, info: 3 };
    return out.sort(function (a, b) { return lv[a.lvl] - lv[b.lvl]; });
  }

  /* ---------- labs in consult ---------- */
  function runConsultLabs() {
    var P = getPatient();
    S.labs = analyzeLabs($("labText").value, P.sex === "M" || P.sex === "F" ? P.sex : "");
    if (S.labs.tags.indexOf("lab_preg") >= 0 && P.sex !== "M") {
      var cb = qsa('#flagBox input[value="pregnant"]')[0];
      if (cb && !cb.checked) { cb.checked = true; toast("Pregnancy test positive - 'Pregnant' ticked"); }
    }
    var cr = S.labs.findings.filter(function (f) { return f.k === "creat"; })[0];
    if (cr && $("pEgfr").value === "" && P.age && (P.sex === "M" || P.sex === "F")) {
      $("pEgfr").value = Math.round(egfrCalc(cr.value, P.age, P.sex));
      toast("eGFR auto-calculated from creatinine (CKD-EPI 2021)");
    }
    $("labOut").innerHTML = labTable(S.labs);
  }
  function labTable(L) {
    if (!L.findings.length && !L.notes.length) return "";
    var h = "";
    if (L.findings.length) {
      h += '<div class="tbl-wrap"><table><tr><th>Test</th><th>Result</th><th>Reference</th><th>Status</th><th>Interpretation</th></tr>';
      L.findings.forEach(function (f) {
        var cls = f.status === "Critical" ? "lab-crit" : f.status === "Low" ? "lab-low" : f.status === "High" ? "lab-high" : "lab-norm";
        h += "<tr><td>" + esc(f.name) + "</td><td><b>" + esc(f.value) + "</b> " + esc(f.unit) + "</td><td>" + esc(f.ref) + "</td><td class='" + cls + "'>" + esc(f.status) + "</td><td>" + esc(f.note) + "</td></tr>";
      });
      h += "</table></div>";
    }
    L.notes.forEach(function (n) { h += '<div class="alert info" style="margin-top:8px">' + esc(n) + "</div>"; });
    return h;
  }

  /* ---------- analyse ---------- */
  function analyze() {
    var text = $("complaint").value;
    runConsultLabs();
    if (!text.trim() && !S.labs.tags.length) { toast("Type, dictate or paste lab values first"); return; }
    var P = getPatient();
    S.ext = extract(text);
    S.flags = redFlags(S.ext, P, S.labs);
    S.ddx = rank(S.ext.present, S.labs.tags);
    S.cond = null; S.rx = [];
    renderResults();
    if (S.ddx.length) selectCondition(S.ddx[0].c.id, true);
    var r = $("results"); if (r.scrollIntoView) r.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderResults() {
    var h = "", ext = S.ext;
    h += '<div class="card"><h2>Triage &amp; safety alerts</h2>';
    if (!S.flags.length) h += '<div class="alert ok">No red-flag pattern detected in the information given. Clinical examination still decides.</div>';
    S.flags.forEach(function (f) { h += '<div class="alert ' + f.lvl + '">' + (f.lvl === "emergency" ? "🚨 " : f.lvl === "urgent" ? "⚠️ " : "") + esc(f.t) + "</div>"; });
    h += "</div>";

    h += '<div class="card"><h2>Findings understood</h2><div class="chips">';
    var pk = Object.keys(ext.present);
    if (!pk.length) h += '<span class="hint">No recognisable symptom terms. Try plain clinical words (e.g. "fever", "burning urination", "loose motions").</span>';
    pk.forEach(function (k) { h += '<span class="chip sym">' + esc(symLabel(k)) + "</span>"; });
    Object.keys(ext.negated).forEach(function (k) { h += '<span class="chip neg">' + esc(symLabel(k)) + "</span>"; });
    S.labs.tags.forEach(function (k) { h += '<span class="chip">' + esc(symLabel(k)) + "</span>"; });
    h += "</div>";
    var meta = [];
    if (ext.days !== null) meta.push("Duration: " + ext.days + " day(s)");
    if (ext.tempF) meta.push("Temperature mentioned: " + ext.tempF + " F");
    if (meta.length) h += '<p class="hint">' + esc(meta.join(" · ")) + "</p>";
    h += "</div>";

    h += '<div class="card"><div class="section-title"><h2>Differential diagnosis</h2><button class="btn sm ghost" id="customRxBtn">Write own prescription instead</button></div>';
    if (!S.ddx.length) {
      h += '<div class="alert caution">No confident match in the knowledge base (' + CONDITIONS.length + ' conditions). Do not force a diagnosis - examine, investigate, or refer. You can still write a prescription manually.</div>';
    } else {
      h += '<p class="hint">Ranked by weighted symptom and lab match. Click to switch. "Match" = share of the condition\'s key features present - it is not a probability.</p><div class="ddx">';
      S.ddx.forEach(function (r) {
        var pct = Math.round(r.cov * 100);
        var str = r.score >= 8 && pct >= 50 ? "Strong" : r.score >= 5 ? "Moderate" : "Weak";
        h += '<button class="ddx-card" data-cond="' + esc(r.c.id) + '"><div class="t">' + esc(r.c.name) + '</div><div class="m">' + esc(r.c.icd) + " · " + esc(r.c.sys) + " · " + str + " (" + pct + "% match)</div>" +
          '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="m">Supports: ' + esc(r.matched.map(symLabel).join(", ")) + "</div>" +
          (r.against.length ? '<div class="m">Against: ' + esc(r.against.map(symLabel).join(", ")) + "</div>" : "") + "</button>";
      });
      h += "</div>";
    }
    h += "</div><div id=\"plan\"></div>";
    $("results").innerHTML = h;
    qsa(".ddx-card").forEach(function (b) { b.addEventListener("click", function () { selectCondition(b.getAttribute("data-cond")); }); });
    $("customRxBtn").addEventListener("click", function () { selectCondition("custom"); });
  }

  var CUSTOM = { id: "custom", name: "", icd: "", sys: "Prescriber-defined", s: {}, inv: [], rx: [], adv: [], rf: [], fu: "", prog: "" };

  function selectCondition(id, silent) {
    var c = id === "custom" ? CUSTOM : CONDITIONS.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    S.cond = c;
    var P = getPatient();
    S.rx = buildRx(c, P);
    qsa(".ddx-card").forEach(function (b) { b.classList.toggle("sel", b.getAttribute("data-cond") === id); });
    renderPlan();
    if (!silent) { var p = $("plan"); if (p && p.scrollIntoView) p.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }

  function ensurePlanContainer() {
    if (!$("plan")) {
      S.ext = S.ext || { present: {}, negated: {}, days: null, tempF: null };
      $("results").innerHTML = '<div id="plan"></div>';
    }
  }

  function renderPlan() {
    ensurePlanContainer();
    var c = S.cond, h = '<div class="card">';
    h += '<div class="section-title"><h2>Management plan' + (c.id !== "custom" ? ": " + esc(c.name) : " (custom)") + '</h2>' +
      (c.id !== "custom" ? '<button class="btn sm ghost" id="rebuildBtn">Rebuild from protocol</button>' : "") + "</div>";
    if (c.emergency) h += '<div class="alert emergency">🚨 EMERGENCY CONDITION - stabilise and transfer. Do not manage as outpatient.</div>';
    if (c.rxNote) h += '<div class="alert urgent">' + esc(c.rxNote) + "</div>";
    h += '<div class="form-grid"><label style="grid-column:span 2">Final / provisional diagnosis<input id="fDx" value="' + esc(c.name) + '" placeholder="Enter diagnosis"></label><label>ICD-10<input id="fIcd" value="' + esc(c.icd) + '"></label></div>';
    h += '<h3>Prescription (℞)</h3><div id="rxBox"></div>';
    h += '<div class="row-btns"><input id="addDrugIn" list="drugNames" placeholder="Add medicine (generic or brand)"><button class="btn" id="addDrugBtn">+ Add to prescription</button></div>';
    h += '<h3>Interaction check</h3><div id="rxIx"></div>';
    h += '<div class="grid2" style="margin-top:12px"><label>Investigations advised (one per line)<textarea id="fInv" rows="5">' + esc((c.inv || []).join("\n")) + '</textarea></label>' +
      '<label>Advice for patient (one per line)<textarea id="fAdv" rows="5">' + esc((c.adv || []).join("\n")) + "</textarea></label></div>";
    h += '<div class="grid2"><label>Come back immediately if (one per line)<textarea id="fRf" rows="4">' + esc((c.rf || []).join("\n")) + '</textarea></label>' +
      '<label>Doctor\'s clinical notes / examination findings<textarea id="fNotes" rows="4" placeholder="e.g. Throat congested, no exudate. Chest clear."></textarea></label></div>';
    h += '<div class="form-grid"><label style="grid-column:span 2">Follow-up<input id="fFu" value="' + esc(c.fu || "") + '"></label><label>Referral<input id="fRef" placeholder="e.g. Physician / ENT / none"></label></div>';
    if (c.prog) h += '<div class="alert info" style="margin-top:10px"><b>Honest outlook:</b> ' + esc(c.prog) + "</div>";
    if (c.teach) h += '<div class="alert ok"><b>Teaching point:</b> ' + esc(c.teach) + "</div>";
    h += '<div class="row-btns"><button class="btn primary" id="reportBtn">📄 Prepare prescription &amp; report</button></div></div>';
    $("plan").innerHTML = h;
    renderRx();
    $("addDrugBtn").addEventListener("click", addDrugFromInput);
    $("addDrugIn").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addDrugFromInput(); } });
    $("reportBtn").addEventListener("click", prepareReport);
    if ($("rebuildBtn")) $("rebuildBtn").addEventListener("click", function () { S.rx = buildRx(S.cond, getPatient()); renderRx(); toast("Plan rebuilt with current patient details"); });
  }

  function qty(l) {
    var s = String(l.s || "").trim();
    if (l.u === "tab" || l.u === "cap" || l.u === "pessary") {
      var days = parseFloat(l.days) || 0;
      if (/^\d+(\s*-\s*\d+){2,3}$/.test(s)) {
        var per = s.split("-").reduce(function (a, b) { return a + (parseFloat(b) || 0); }, 0);
        return per * days ? String(per * days) : "-";
      }
      if (/^(stat|once)$/i.test(s)) { var m = String(l.dose).match(/(\d+)\s*x\s*\d/); return m ? m[1] : "1"; }
      if (/^weekly$/i.test(s)) return String(Math.max(1, Math.ceil(days / 7)));
      return "As needed";
    }
    var pack = { cream: "1 tube", gel: "1 tube", syrup: "1 bottle", spray: "1 bottle", drops: "1 vial", inhaler: "1 inhaler", mouthwash: "1 bottle", powder: "1 pack", sachet: "1 box", lotion: "1 bottle" };
    return pack[l.u] || "1";
  }

  function renderRx() {
    var box = $("rxBox"); if (!box) return;
    if (!S.rx.length) {
      box.innerHTML = '<div class="alert info">' + (S.cond && S.cond.id !== "custom" ? "No medicine is recommended by protocol for this diagnosis. Add one only if clinically justified." : "Add medicines below.") + "</div>";
    } else {
      var h = '<div class="tbl-wrap"><table class="rx-table"><tr><th>#</th><th class="w-s">Medicine &amp; safety</th><th>Dose</th><th>Schedule (M-A-N)</th><th>When</th><th>Days</th><th>Qty</th><th>Notes</th><th></th></tr>';
      S.rx.forEach(function (l, i) {
        var chip = l.st === "block" ? '<span class="status block">BLOCKED</span>' : l.st === "warn" ? '<span class="status warn">CAUTION</span>' : '<span class="status ok">SAFE CHECK PASSED</span>';
        if (l.cond) chip += ' <span class="status cond">CONDITIONAL</span>';
        var msgs = "";
        l.replaced.forEach(function (m) { msgs += '<div class="msgs">↻ ' + esc(m) + "</div>"; });
        l.msgs.forEach(function (m) { msgs += '<div class="msgs">• ' + esc(m) + "</div>"; });
        if (l.cond) msgs += '<div class="msgs"><b>Condition:</b> ' + esc(l.cond) + "</div>";
        if (l.st === "block") msgs += '<label class="msgs" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" data-ov="' + i + '" ' + (l.override ? "checked" : "") + ' style="width:auto"> Prescriber override (include anyway)</label>';
        h += '<tr class="' + (l.st === "block" && !l.override ? "blocked" : "") + '"><td>' + (i + 1) + '</td><td><div class="rx-name"><b>' + esc(l.name) + '</b> <span class="hint">' + esc(l.form) + "</span></div>" + chip + msgs + "</td>" +
          '<td><input data-i="' + i + '" data-f="dose" value="' + esc(l.dose) + '"></td>' +
          '<td><input data-i="' + i + '" data-f="s" list="schedList" value="' + esc(l.s) + '">' + (l.prn ? '<div class="msgs">SOS / as needed</div>' : "") + "</td>" +
          '<td><input data-i="' + i + '" data-f="t" list="timeList" value="' + esc(l.t) + '"></td>' +
          '<td><input data-i="' + i + '" data-f="days" type="number" min="1" value="' + esc(l.days) + '" style="width:64px"></td>' +
          '<td id="q' + i + '">' + esc(qty(l)) + "</td>" +
          '<td><input data-i="' + i + '" data-f="note" value="' + esc(l.note) + '"></td>' +
          '<td><button class="btn sm danger" data-del="' + i + '" title="Remove">✕</button></td></tr>';
      });
      box.innerHTML = h + "</table></div>";
      qsa("input[data-f]", box).forEach(function (inp) {
        inp.addEventListener("input", function () {
          var i = +inp.getAttribute("data-i"), f = inp.getAttribute("data-f");
          S.rx[i][f] = f === "days" ? (parseFloat(inp.value) || "") : inp.value;
          var q = $("q" + i); if (q) q.textContent = qty(S.rx[i]);
        });
      });
      qsa("button[data-del]", box).forEach(function (b) {
        b.addEventListener("click", function () { S.rx.splice(+b.getAttribute("data-del"), 1); renderRx(); });
      });
      qsa("input[data-ov]", box).forEach(function (cb) {
        cb.addEventListener("change", function () { S.rx[+cb.getAttribute("data-ov")].override = cb.checked; renderRx(); });
      });
    }
    renderRxIx();
  }
  function activeRx() { return S.rx.filter(function (l) { return l.st !== "block" || l.override; }); }
  function renderRxIx() {
    var box = $("rxIx"); if (!box) return;
    var P = getPatient();
    var keys = activeRx().map(function (l) { return l.d; }).concat(P.medKeys);
    var dupes = [], cnt = {};
    activeRx().forEach(function (l) { cnt[l.d] = (cnt[l.d] || 0) + 1; if (cnt[l.d] === 2) dupes.push(l.name); });
    var h = dupes.length ? '<div class="alert urgent">Duplicate medicine in prescription: ' + esc(dupes.join(", ")) + "</div>" : "";
    if (keys.length < 2) h += '<div class="hint">Add 2 or more medicines (including the patient\'s current medicines) to check interactions.</div>';
    else h += ixHtml(interactions(keys));
    if (P.medKeys.length) h += '<div class="hint">Current medicines recognised: ' + esc(P.medKeys.map(function (k) { return DRUGS[k].n; }).join(", ")) + "</div>";
    box.innerHTML = h;
  }

  function addDrugKey(key) {
    var d = DRUGS[key];
    if (!d) return false;
    if (!d.def) { toast(d.n + " is reference-only (specialist medicine) - not added"); return false; }
    if (!S.cond) { S.ext = S.ext || { present: {}, negated: {}, days: null, tempF: null }; ensurePlanContainer(); S.cond = CUSTOM; S.rx = []; renderPlan(); }
    if (S.rx.some(function (l) { return l.d === key; })) { toast(d.n + " is already in this prescription"); return false; }
    var P = getPatient();
    var item = { d: key, dose: d.def.dose, s: d.def.s, t: d.def.t, days: d.def.days, prn: d.def.prn, note: d.def.note };
    S.rx.push(applyPaed(mkLine(item, checkDrug(key, P)), P));
    renderRx();
    return true;
  }
  function addDrugFromInput() {
    var v = $("addDrugIn").value, k = resolveDrug(v);
    if (!k) { toast("Medicine not found in formulary"); return; }
    if (addDrugKey(k)) { $("addDrugIn").value = ""; toast(DRUGS[k].n + " added"); }
  }

  /* ---------- report ---------- */
  function lines(id) { var el = $(id); return el ? el.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean) : []; }
  function getDoc() { return store.get("idh_doc", {}); }

  function prepareReport() {
    var P = getPatient();
    var rx = activeRx();
    var D = {
      id: uid(), date: Date.now(), doc: getDoc(),
      patient: { name: P.name, age: P.age, sex: P.sex, wt: P.wt, phone: P.phone, egfr: P.egfr, allergies: P.allergies,
        flags: Object.keys(P.flags).map(function (f) { return FLAG_LABEL[f] || f; }), meds: P.medsText },
      vitals: P.vitals, complaint: $("complaint").value.trim(),
      symptoms: Object.keys((S.ext || {}).present || {}).map(symLabel), negatives: Object.keys((S.ext || {}).negated || {}).map(symLabel),
      flags: S.flags.filter(function (f) { return f.lvl !== "info"; }),
      dx: $("fDx").value.trim(), icd: $("fIcd").value.trim(),
      ddx: S.ddx.filter(function (r) { return !S.cond || r.c.id !== S.cond.id; }).slice(0, 3).map(function (r) { return r.c.name; }),
      rxNote: S.cond.rxNote || "", emergency: !!S.cond.emergency,
      rx: rx.map(function (l) { return { name: l.name, form: l.form, u: l.u, dose: l.dose, s: l.s, t: l.t, days: l.days, prn: l.prn, note: l.note, cond: l.cond, qty: qty(l), warn: l.st !== "ok" ? l.msgs.slice() : [], override: l.override }; }),
      removed: S.rx.filter(function (l) { return l.st === "block" && !l.override; }).map(function (l) { return l.name + ": " + l.msgs.join("; "); })
        .concat([].concat.apply([], rx.map(function (l) { return l.replaced; }))),
      ix: interactions(rx.map(function (l) { return l.d; }).concat(P.medKeys)).map(function (x) { return x.sev.toUpperCase() + ": " + DRUGS[x.a].n + " + " + DRUGS[x.b].n + " - " + x.t; }),
      inv: lines("fInv"), adv: lines("fAdv"), rf: lines("fRf"), notes: $("fNotes").value.trim(), fu: $("fFu").value.trim(), ref: $("fRef").value.trim(),
      prog: S.cond.prog || "",
      labs: { findings: S.labs.findings.filter(function (f) { return f.status !== "Normal"; }), normal: S.labs.findings.filter(function (f) { return f.status === "Normal"; }).map(function (f) { return f.name + " " + f.value; }), notes: S.labs.notes.slice() },
      att: S.attachments.map(function (a) { return { name: a.name, kind: a.kind, thumb: a.thumb || null }; })
    };
    if (!D.dx) { toast("Enter a diagnosis first"); $("fDx").focus(); return; }
    S.current = D;
    openReport(D);
  }

  function schedCells(s) {
    var m = String(s || "").match(/^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return null;
    return m[4] !== undefined ? [m[1], m[2] + "+" + m[3], m[4]] : [m[1], m[2], m[3]];
  }
  function unitWord(u, n) {
    var w = { tab: "tablet", cap: "capsule", pessary: "pessary" }[u];
    return w ? (n === 1 ? w : w + "s") : "application";
  }
  function schedText(r) {
    var s = String(r.s || "").trim(), m = s.match(/^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?$/);
    if (m) {
      var slots = m[4] !== undefined ? ["morning", "afternoon", "evening", "night"] : ["morning", "afternoon", "night"];
      var parts = [];
      slots.forEach(function (sl, i) { var n = parseInt(m[i + 1], 10); if (n > 0) parts.push(n + " " + (r.u === "tab" || r.u === "cap" || r.u === "pessary" ? unitWord(r.u, n) : "time") + (sl === "night" ? " at night" : " in the " + sl)); });
      return parts.join(", ").replace(/, ([^,]*)$/, " and $1");
    }
    if (/^stat$/i.test(s)) return "once, immediately";
    if (/^once$/i.test(s)) return "once";
    if (/^weekly$/i.test(s)) return "once every week";
    if (/^sos$/i.test(s)) return "only when needed";
    return s;
  }
  function patientText(D) {
    var p = D.patient, out = [];
    out.push("Dear " + (p.name || "patient") + ",");
    out.push("Here is your treatment plan from " + (D.doc.name || "your doctor") + ". Please follow it exactly. Wishing you a quick recovery!");
    out.push("");
    out.push("Diagnosis: " + D.dx);
    if (D.rx.length) {
      out.push(""); out.push("YOUR MEDICINES:");
      D.rx.forEach(function (r, i) {
        var line = (i + 1) + ". " + r.name + " " + r.dose + " - " + schedText(r);
        if (r.t && r.t !== "-") line += ", " + r.t.toLowerCase();
        if (r.days) line += ", for " + r.days + " day" + (r.days > 1 ? "s" : "");
        if (r.prn) line += " (only if needed)";
        if (r.note) line += ". " + r.note;
        out.push(line);
      });
    }
    if (D.inv.length) { out.push(""); out.push("TESTS TO DO: " + D.inv.join("; ")); }
    if (D.adv.length) { out.push(""); out.push("HELPFUL TIPS:"); D.adv.forEach(function (a) { out.push("- " + a); }); }
    if (D.rf.length) { out.push(""); out.push("COME BACK IMMEDIATELY IF:"); D.rf.forEach(function (a) { out.push("- " + a); }); }
    if (D.fu) { out.push(""); out.push("Follow-up: " + D.fu); }
    return out.join("\n");
  }

  function renderReport(D) {
    var d = D.doc || {}, p = D.patient, v = D.vitals || {}, h = "";
    h += '<div class="rp-head"><div><div class="rp-doc">' + esc(d.name || "Dr. ______________") + '</div><div class="rp-sub">' + esc(d.qual || "MBBS") + (d.reg ? " · Reg. No. " + esc(d.reg) : "") + "</div>" +
      '<div class="rp-sub">' + esc([d.clinic, d.addr, d.phone].filter(Boolean).join(" · ")) + "</div></div>" +
      '<div class="rp-right"><b>Inera Doctor Hub</b><br>' + esc(fmtDate(D.date)) + "<br>Ref: " + esc(D.id) + "</div></div>";
    h += '<div class="rp-pt"><div><b>Patient:</b> ' + esc(p.name || "-") + "</div><div><b>Age/Sex:</b> " + esc((p.age !== null && p.age !== undefined ? p.age + " y" : "-") + " / " + (p.sex || "-")) + "</div>" +
      "<div><b>Weight:</b> " + esc(p.wt ? p.wt + " kg" : "-") + "</div><div><b>Phone:</b> " + esc(p.phone || "-") + "</div>" +
      '<div style="grid-column:span 2"><b>Allergies:</b> ' + esc(p.allergies.length ? p.allergies.join(", ") : "None declared") + '</div><div style="grid-column:span 2"><b>Conditions:</b> ' + esc(p.flags.length ? p.flags.join(", ") : "None declared") + "</div>" +
      (p.meds ? '<div style="grid-column:1/-1"><b>Current medicines:</b> ' + esc(p.meds) + "</div>" : "") + "</div>";
    var vit = [];
    if (v.temp) vit.push("Temp " + v.temp + " F"); if (v.sbp) vit.push("BP " + v.sbp + "/" + (v.dbp || "-")); if (v.pulse) vit.push("Pulse " + v.pulse + "/min");
    if (v.spo2) vit.push("SpO2 " + v.spo2 + "%"); if (v.rr) vit.push("RR " + v.rr + "/min"); if (p.egfr) vit.push("eGFR " + p.egfr);
    if (vit.length) h += '<div class="rp-sec"><h4>Vitals</h4>' + esc(vit.join(" · ")) + "</div>";
    if (D.complaint) h += '<div class="rp-sec"><h4>Presenting complaints</h4>' + esc(D.complaint) + "</div>";
    if (D.symptoms.length || D.negatives.length) h += '<div class="rp-sec"><h4>Clinical features</h4>' + esc(D.symptoms.join(", ")) + (D.negatives.length ? '<br><span class="hint">Negatives: ' + esc(D.negatives.join(", ")) + "</span>" : "") + "</div>";
    if (D.notes) h += '<div class="rp-sec"><h4>Examination / doctor\'s notes</h4>' + esc(D.notes).replace(/\n/g, "<br>") + "</div>";
    if (D.flags.length) { h += '<div class="rp-sec"><h4>Alerts</h4>'; D.flags.forEach(function (f) { h += '<div class="alert ' + f.lvl + '">' + esc(f.t) + "</div>"; }); h += "</div>"; }
    if (D.labs.findings.length || D.labs.notes.length || D.labs.normal.length) {
      h += '<div class="rp-sec"><h4>Laboratory findings</h4>';
      if (D.labs.findings.length) {
        h += "<table><tr><th>Test</th><th>Result</th><th>Ref.</th><th>Interpretation</th></tr>";
        D.labs.findings.forEach(function (f) { h += "<tr><td>" + esc(f.name) + "</td><td><b>" + esc(f.value + " " + f.unit) + "</b> (" + esc(f.status) + ")</td><td>" + esc(f.ref) + "</td><td>" + esc(f.note) + "</td></tr>"; });
        h += "</table>";
      }
      if (D.labs.normal.length) h += '<div class="hint">Within range: ' + esc(D.labs.normal.join(", ")) + "</div>";
      D.labs.notes.forEach(function (n) { h += "<div>• " + esc(n) + "</div>"; });
      h += "</div>";
    }
    h += '<div class="rp-sec"><h4>Diagnosis</h4><b>' + esc(D.dx) + "</b>" + (D.icd ? " (ICD-10: " + esc(D.icd) + ")" : "") + (D.ddx.length ? '<br><span class="hint">Differentials considered: ' + esc(D.ddx.join("; ")) + "</span>" : "") + "</div>";
    h += '<div class="rp-sec"><div class="rx-sym">℞</div>';
    if (D.emergency) h += '<div class="alert emergency">EMERGENCY - immediate transfer to hospital.</div>';
    if (D.rxNote) h += '<div class="alert urgent">' + esc(D.rxNote) + "</div>";
    if (D.rx.length) {
      h += '<table><tr><th>#</th><th>Medicine</th><th>Dose</th><th>Morning</th><th>Afternoon</th><th>Night</th><th>When</th><th>Days</th><th>Qty</th></tr>';
      D.rx.forEach(function (r, i) {
        var c = schedCells(r.s);
        var sc = c ? "<td>" + esc(c[0]) + "</td><td>" + esc(c[1]) + "</td><td>" + esc(c[2]) + "</td>" : '<td colspan="3" style="text-align:center">' + esc(r.s) + "</td>";
        var sub = [];
        if (r.prn) sub.push("SOS - only if needed"); if (r.note) sub.push(r.note); if (r.cond) sub.push("Condition: " + r.cond);
        if (r.override) sub.push("Prescriber override of safety block");
        h += "<tr><td>" + (i + 1) + "</td><td><b>" + esc(r.name) + '</b><br><span class="hint">' + esc(r.form) + "</span>" + (sub.length ? '<div class="msgs">' + esc(sub.join(" · ")) + "</div>" : "") +
          "</td><td>" + esc(r.dose) + "</td>" + sc + "<td>" + esc(r.t) + "</td><td>" + esc(r.days) + "</td><td>" + esc(r.qty) + "</td></tr>";
      });
      h += "</table>";
      var w = []; D.rx.forEach(function (r) { r.warn.forEach(function (m) { w.push(r.name + ": " + m); }); });
      if (w.length) h += '<div class="msgs"><b>Prescriber cautions:</b> ' + esc(w.join(" | ")) + "</div>";
    } else h += "<div>No medicines prescribed.</div>";
    if (D.removed.length) h += '<div class="msgs"><b>Safety engine withheld / replaced:</b> ' + esc(D.removed.join(" | ")) + "</div>";
    if (D.ix.length) h += '<div class="msgs"><b>Interactions:</b> ' + esc(D.ix.join(" | ")) + "</div>";
    h += "</div>";
    if (D.inv.length) h += '<div class="rp-sec"><h4>Investigations advised</h4><ul class="list-plain">' + D.inv.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>";
    if (D.adv.length) h += '<div class="rp-sec"><h4>Advice</h4><ul class="list-plain">' + D.adv.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>";
    if (D.rf.length) h += '<div class="rp-sec"><h4>Return immediately if</h4><ul class="list-plain">' + D.rf.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>";
    var fu = [];
    if (D.fu) fu.push("<b>Follow-up:</b> " + esc(D.fu)); if (D.ref) fu.push("<b>Referral:</b> " + esc(D.ref)); if (D.prog) fu.push("<b>Expected course:</b> " + esc(D.prog));
    if (fu.length) h += '<div class="rp-sec"><h4>Follow-up &amp; outlook</h4>' + fu.join("<br>") + "</div>";
    if (D.att.length) {
      h += '<div class="rp-sec"><h4>Attachments reviewed</h4><div class="rp-att">';
      D.att.forEach(function (a) { h += a.thumb ? '<div><img src="' + a.thumb + '" alt=""><div class="hint">' + esc(a.kind + ": " + a.name) + "</div></div>" : '<div class="hint">📎 ' + esc(a.kind + ": " + a.name) + "</div>"; });
      h += "</div></div>";
    }
    h += '<div class="rp-sign"><div class="hint">Patient copy · ' + esc(D.id) + '</div><div class="line">' + esc(d.name || "Signature of registered medical practitioner") + (d.reg ? "<br>Reg. No. " + esc(d.reg) : "") + "</div></div>";
    h += '<div class="rp-foot">Prepared with Inera Doctor Hub (INERA GROUP, Inera Software Pvt. Ltd.) - a clinical decision-support tool. Valid only when reviewed and signed by a registered medical practitioner. Doses shown are standard adult doses and must be verified for the individual patient.</div>';
    return h;
  }
  function openReport(D) {
    $("report").innerHTML = renderReport(D);
    $("overlay").classList.add("show"); $("overlay").setAttribute("aria-hidden", "false");
    $("overlay").scrollTop = 0;
  }
  function closeReport() { $("overlay").classList.remove("show"); $("overlay").setAttribute("aria-hidden", "true"); }

  /* ---------- records ---------- */
  function getRecs() { return store.get("idh_records", []); }
  function saveCurrent() {
    if (!S.current) return;
    var recs = getRecs().filter(function (r) { return r.id !== S.current.id; });
    recs.unshift(S.current);
    if (store.set("idh_records", recs)) { toast("Saved to patient records"); renderRecords(); }
  }
  function renderRecords() {
    var q = ($("recSearch").value || "").toLowerCase(), recs = getRecs();
    var list = recs.filter(function (r) { return !q || [r.patient.name, r.patient.phone, r.dx].join(" ").toLowerCase().indexOf(q) >= 0; });
    if (!list.length) { $("recList").innerHTML = '<p class="hint">' + (recs.length ? "No match." : "No saved records yet. Prepare a report and click 'Save to records'.") + "</p>"; return; }
    $("recList").innerHTML = list.map(function (r) {
      return '<div class="rec"><div><div class="rn">' + esc(r.patient.name || "Unnamed patient") + " · " + esc(r.dx) + '</div><div class="rd">' + esc(fmtDate(r.date)) + " · " + esc(r.patient.phone || "") + " · " + r.rx.length + ' medicine(s)</div></div><div class="row-btns" style="margin:0"><button class="btn sm" data-open="' + esc(r.id) + '">Open</button><button class="btn sm danger" data-rm="' + esc(r.id) + '">Delete</button></div></div>';
    }).join("");
    qsa("[data-open]", $("recList")).forEach(function (b) { b.addEventListener("click", function () { var r = getRecs().filter(function (x) { return x.id === b.getAttribute("data-open"); })[0]; if (r) { S.current = r; openReport(r); } }); });
    qsa("[data-rm]", $("recList")).forEach(function (b) { b.addEventListener("click", function () { if (!confirm("Delete this record permanently?")) return; store.set("idh_records", getRecs().filter(function (x) { return x.id !== b.getAttribute("data-rm"); })); renderRecords(); }); });
  }
  function exportRecs() {
    var blob = new Blob([JSON.stringify({ app: "Inera Doctor Hub", exported: new Date().toISOString(), doc: getDoc(), records: getRecs() }, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "inera-doctor-hub-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function importRecs(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var data = JSON.parse(fr.result), incoming = Array.isArray(data) ? data : data.records;
        if (!Array.isArray(incoming)) throw new Error("bad");
        var cur = getRecs(), ids = {}; cur.forEach(function (r) { ids[r.id] = 1; });
        var added = incoming.filter(function (r) { return r && r.id && r.patient && !ids[r.id]; });
        store.set("idh_records", added.concat(cur)); renderRecords(); toast(added.length + " record(s) imported");
      } catch (e) { toast("Not a valid Inera Doctor Hub backup file"); }
    };
    fr.readAsText(file);
  }

  /* ---------- attachments + OCR ---------- */
  var KINDS = ["Lab report", "Prescription", "X-ray", "CT", "MRI", "Ultrasound", "ECG", "Clinical photo", "Video", "Other"];
  function makeThumb(file) {
    return new Promise(function (resolve) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 240, sc = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        var data = null; try { data = c.toDataURL("image/jpeg", 0.7); } catch (e) { data = null; }
        resolve({ url: url, thumb: data });
      };
      img.onerror = function () { resolve({ url: url, thumb: null }); };
      img.src = url;
    });
  }
  function addFiles(files) {
    Array.prototype.slice.call(files).forEach(function (f) {
      var a = { id: uid(), name: f.name, type: f.type, file: f, kind: /^video/.test(f.type) ? "Video" : /pdf/.test(f.type) ? "Lab report" : /report|lab|cbc|test/i.test(f.name) ? "Lab report" : "Clinical photo", url: null, thumb: null };
      S.attachments.push(a);
      if (/^image/.test(f.type)) makeThumb(f).then(function (r) { a.url = r.url; a.thumb = r.thumb; renderThumbs(); });
      else { a.url = URL.createObjectURL(f); }
    });
    renderThumbs();
  }
  function renderThumbs() {
    $("thumbs").innerHTML = S.attachments.map(function (a, i) {
      var media = /^image/.test(a.type) ? (a.url ? '<img src="' + a.url + '" alt="">' : '<div style="height:95px"></div>') : /^video/.test(a.type) ? '<video src="' + (a.url || "") + '" controls muted></video>' : '<div style="height:95px;display:flex;align-items:center;justify-content:center;background:#eee;border-radius:6px">📄 PDF</div>';
      var sel = '<select data-kind="' + i + '" style="padding:3px;font-size:11px">' + KINDS.map(function (k) { return "<option" + (k === a.kind ? " selected" : "") + ">" + k + "</option>"; }).join("") + "</select>";
      var acts = '<div class="acts">' + (/^image/.test(a.type) ? '<button class="btn sm" data-ocr="' + i + '">Read text</button>' : "") + (a.url ? '<a class="btn sm" href="' + a.url + '" target="_blank" rel="noopener">View</a>' : "") + '<button class="btn sm danger" data-rma="' + i + '">✕</button></div>';
      return '<div class="thumb">' + media + '<div class="fn" title="' + esc(a.name) + '">' + esc(a.name) + "</div>" + sel + acts + "</div>";
    }).join("");
    qsa("[data-kind]", $("thumbs")).forEach(function (s) { s.addEventListener("change", function () { S.attachments[+s.getAttribute("data-kind")].kind = s.value; }); });
    qsa("[data-rma]", $("thumbs")).forEach(function (b) { b.addEventListener("click", function () { S.attachments.splice(+b.getAttribute("data-rma"), 1); renderThumbs(); }); });
    qsa("[data-ocr]", $("thumbs")).forEach(function (b) { b.addEventListener("click", function () { ocrInto(S.attachments[+b.getAttribute("data-ocr")].file, $("labText"), b, runConsultLabs); }); });
  }
  var tessPromise = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (tessPromise) return tessPromise;
    tessPromise = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = function () { res(); };
      s.onerror = function () { tessPromise = null; rej(new Error("load")); };
      document.head.appendChild(s);
    });
    return tessPromise;
  }
  function ocrInto(file, target, btn, after) {
    var old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Loading OCR..."; }
    loadTesseract().then(function () {
      return window.Tesseract.recognize(file, "eng", { logger: function (m) { if (btn && m.status === "recognizing text") btn.textContent = "Reading " + Math.round(m.progress * 100) + "%"; } });
    }).then(function (r) {
      var txt = (r && r.data && r.data.text || "").trim();
      if (!txt) { toast("No readable text found - type values manually"); return; }
      target.value = (target.value ? target.value + "\n" : "") + txt;
      toast("Report text extracted - please verify the numbers");
      if (after) after();
    }).catch(function () {
      toast("OCR needs an internet connection the first time it loads. Type the values instead.");
    }).then(function () { if (btn) { btn.disabled = false; btn.textContent = old; } });
  }

  /* ---------- voice ---------- */
  function setupVoice() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition, btn = $("micBtn");
    if (!SR) { btn.disabled = true; $("micHint").textContent = "Voice dictation is not supported in this browser - use Chrome or Edge. Typing works everywhere."; return; }
    var rec = new SR(), on = false;
    rec.lang = "en-IN"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = function (e) {
      var fin = "", interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) fin += e.results[i][0].transcript + " "; else interim += e.results[i][0].transcript; }
      if (fin) $("complaint").value = ($("complaint").value + " " + fin).replace(/\s+/g, " ").trim();
      $("micHint").textContent = interim ? "… " + interim : "Listening… speak the complaint, then tap Stop.";
    };
    rec.onerror = function (e) {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { toast("Microphone permission denied"); on = false; ui(); }
    };
    rec.onend = function () { if (on) { try { rec.start(); } catch (x) { on = false; ui(); } } };
    function ui() { btn.classList.toggle("on", on); $("micLbl").textContent = on ? "Stop" : "Dictate"; if (!on) $("micHint").textContent = "Speak in English (Indian accent supported). Chrome / Edge recommended."; }
    btn.addEventListener("click", function () {
      if (on) { on = false; try { rec.stop(); } catch (x) { /* ignore */ } ui(); if ($("complaint").value.trim()) analyze(); }
      else { try { rec.start(); on = true; } catch (x) { on = false; toast("Could not start microphone"); } ui(); }
    });
  }

  /* ---------- drug library ---------- */
  function renderDrugs() {
    var q = ($("drugSearch").value || "").toLowerCase().trim();
    var keys = Object.keys(DRUGS).filter(function (k) {
      var d = DRUGS[k]; return !q || [d.n, d.cls, (d.al || []).join(" "), k].join(" ").toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return DRUGS[a].n.localeCompare(DRUGS[b].n); });
    $("drugList").innerHTML = keys.length ? keys.map(function (k) {
      var d = DRUGS[k], ci = d.block ? Object.keys(d.block).map(function (f) { return d.block[f]; }) : [], ca = d.warn ? Object.keys(d.warn).map(function (f) { return (FLAG_LABEL[f] || f) + ": " + d.warn[f]; }) : [];
      return '<div class="drug"><div class="dn">' + esc(d.n) + '</div><div class="dc">' + esc(d.cls) + " · " + esc(d.st) + "</div>" +
        (d.al && d.al.length ? "<p><b>Also known as:</b> " + esc(d.al.join(", ")) + "</p>" : "") +
        "<p><b>Adult dose:</b> " + esc(d.adult) + "</p><p><b>Pregnancy:</b> " + esc(d.preg || "-") + "</p><p><b>Side effects:</b> " + esc(d.se || "-") + "</p>" +
        (d.allergy ? "<p><b>Allergy group:</b> " + esc(d.allergy.join(", ")) + "</p>" : "") +
        (ci.length ? "<p><b>Blocked in:</b> " + esc(ci.join("; ")) + "</p>" : "") + (ca.length ? "<p><b>Cautions:</b> " + esc(ca.join("; ")) + "</p>" : "") +
        (d.def ? '<button class="btn sm" data-add="' + k + '">+ Add to prescription</button>' : '<span class="hint">Reference / interaction checking only</span>') + "</div>";
    }).join("") : '<p class="hint">No medicine found.</p>';
    qsa("[data-add]", $("drugList")).forEach(function (b) { b.addEventListener("click", function () { if (addDrugKey(b.getAttribute("data-add"))) { toast(DRUGS[b.getAttribute("data-add")].n + " added - open Smart Consult"); } }); });
  }

  /* ---------- interaction tab ---------- */
  function renderIx() {
    $("ixChips").innerHTML = S.ix.map(function (k, i) { return '<button class="chip x" data-ixrm="' + i + '">' + esc(DRUGS[k].n) + " ✕</button>"; }).join("");
    qsa("[data-ixrm]", $("ixChips")).forEach(function (b) { b.addEventListener("click", function () { S.ix.splice(+b.getAttribute("data-ixrm"), 1); renderIx(); }); });
    $("ixOut").innerHTML = S.ix.length < 2 ? '<p class="hint">Add at least two medicines.</p>' : ixHtml(interactions(S.ix));
  }
  function ixAdd() {
    var txt = $("ixInput").value, ks = matchDrugText(txt), k = resolveDrug(txt);
    if (k && ks.indexOf(k) < 0) ks.unshift(k);
    if (!ks.length) { toast("Medicine not recognised"); return; }
    ks.forEach(function (x) { if (S.ix.indexOf(x) < 0) S.ix.push(x); });
    $("ixInput").value = ""; renderIx();
  }

  /* ---------- calculators ---------- */
  function egfrCalc(scr, age, sex) {
    var f = sex === "F", k = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302;
    return 142 * Math.pow(Math.min(scr / k, 1), a) * Math.pow(Math.max(scr / k, 1), -1.2) * Math.pow(0.9938, age) * (f ? 1.012 : 1);
  }
  function chk(label, pts, id) { return '<label style="flex-direction:row;gap:8px;align-items:center;font-weight:500;color:var(--ink)"><input type="checkbox" id="' + id + '" data-pts="' + pts + '" style="width:auto">' + label + "</label>"; }
  function renderCalcs() {
    var h = "";
    h += '<div class="card"><h2>BMI (Asian cut-offs)</h2><div class="form-grid"><label>Weight kg<input id="cWt" type="number"></label><label>Height cm<input id="cHt" type="number"></label></div><button class="btn primary mt" data-calc="bmi">Calculate</button><div class="calc-out" id="oBmi"></div></div>';
    h += '<div class="card"><h2>eGFR (CKD-EPI 2021)</h2><div class="form-grid"><label>Creatinine mg/dL<input id="cCr" type="number" step="0.01"></label><label>Age<input id="cAge" type="number"></label><label>Sex<select id="cSex"><option value="M">Male</option><option value="F">Female</option></select></label></div><button class="btn primary mt" data-calc="egfr">Calculate</button><div class="calc-out" id="oEgfr"></div></div>';
    h += '<div class="card"><h2>CURB-65 (pneumonia severity)</h2>' + chk("Confusion (new)", 1, "cu1") + chk("Urea > 42 mg/dL (BUN > 19)", 1, "cu2") + chk("Respiratory rate 30 or more", 1, "cu3") + chk("SBP < 90 or DBP 60 or less", 1, "cu4") + chk("Age 65 or more", 1, "cu5") + '<button class="btn primary mt" data-calc="curb">Score</button><div class="calc-out" id="oCurb"></div></div>';
    h += '<div class="card"><h2>McIsaac / Centor (sore throat)</h2>' + chk("Temperature > 38 C (100.4 F)", 1, "mc1") + chk("Absence of cough", 1, "mc2") + chk("Tender anterior cervical nodes", 1, "mc3") + chk("Tonsillar swelling / exudate", 1, "mc4") + '<div class="form-grid"><label>Age<input id="mcAge" type="number"></label></div><button class="btn primary mt" data-calc="mcisaac">Score</button><div class="calc-out" id="oMc"></div></div>';
    h += '<div class="card"><h2>qSOFA (sepsis screen)</h2>' + chk("Respiratory rate 22 or more", 1, "qs1") + chk("Altered mentation", 1, "qs2") + chk("Systolic BP 100 or less", 1, "qs3") + '<button class="btn primary mt" data-calc="qsofa">Score</button><div class="calc-out" id="oQs"></div></div>';
    h += '<div class="card"><h2>Pregnancy dates (Naegele)</h2><div class="form-grid"><label>LMP date<input id="cLmp" type="date"></label></div><button class="btn primary mt" data-calc="edd">Calculate</button><div class="calc-out" id="oEdd"></div></div>';
    h += '<div class="card"><h2>Alvarado score (appendicitis)</h2>' + chk("Migratory RIF pain", 1, "al1") + chk("Anorexia", 1, "al2") + chk("Nausea / vomiting", 1, "al3") + chk("RIF tenderness", 2, "al4") + chk("Rebound tenderness", 1, "al5") + chk("Fever > 37.3 C", 1, "al6") + chk("Leucocytosis > 10,000", 2, "al7") + chk("Neutrophil shift to left", 1, "al8") + '<button class="btn primary mt" data-calc="alvarado">Score</button><div class="calc-out" id="oAl"></div></div>';
    $("calcGrid").innerHTML = h;
    qsa("[data-calc]", $("calcGrid")).forEach(function (b) { b.addEventListener("click", function () { calc(b.getAttribute("data-calc")); }); });
  }
  function sumPts(prefix, n) { var s = 0; for (var i = 1; i <= n; i++) { var el = $(prefix + i); if (el && el.checked) s += +el.getAttribute("data-pts"); } return s; }
  function calc(which) {
    if (which === "bmi") {
      var w = num("cWt"), ht = num("cHt"); if (!w || !ht) return toast("Enter weight and height");
      var b = w / Math.pow(ht / 100, 2), cat = b < 18.5 ? "Underweight" : b < 23 ? "Normal" : b < 25 ? "Overweight" : "Obese";
      $("oBmi").textContent = "BMI " + b.toFixed(1) + " kg/m² - " + cat + " (Asian-Indian cut-offs: 23 overweight, 25 obese)";
    } else if (which === "egfr") {
      var cr = num("cCr"), ag = num("cAge"); if (!cr || !ag) return toast("Enter creatinine and age");
      var e = egfrCalc(cr, ag, $("cSex").value), st = e >= 90 ? "G1 (normal)" : e >= 60 ? "G2" : e >= 45 ? "G3a" : e >= 30 ? "G3b" : e >= 15 ? "G4" : "G5 (kidney failure)";
      $("oEgfr").textContent = "eGFR " + Math.round(e) + " mL/min/1.73m² - CKD stage " + st + ". Use this value in Smart Consult for dose safety.";
    } else if (which === "curb") {
      var c = sumPts("cu", 5);
      $("oCurb").textContent = "CURB-65 = " + c + " - " + (c <= 1 ? "low severity: outpatient treatment" : c === 2 ? "moderate: consider short admission / close supervision" : "severe: hospital admission, consider ICU (4-5)");
    } else if (which === "mcisaac") {
      var m = sumPts("mc", 4), a = num("mcAge"); if (a !== null) { if (a >= 3 && a <= 14) m += 1; else if (a >= 45) m -= 1; }
      $("oMc").textContent = "McIsaac score = " + m + " - " + (m <= 1 ? "no test, no antibiotic (strep risk low)" : m <= 3 ? "test (rapid strep / culture); treat only if positive" : "high risk: test, or treat empirically if testing unavailable");
    } else if (which === "qsofa") {
      var q = sumPts("qs", 3);
      $("oQs").textContent = "qSOFA = " + q + " - " + (q >= 2 ? "HIGH risk of poor outcome: assess for sepsis, lactate, urgent escalation" : "lower risk - still reassess if clinical concern");
    } else if (which === "edd") {
      var v = $("cLmp").value; if (!v) return toast("Enter LMP");
      var l = new Date(v + "T00:00:00"), edd = new Date(l.getTime() + 280 * 864e5), ga = Math.floor((Date.now() - l.getTime()) / 864e5);
      if (ga < 0) return toast("LMP is in the future");
      $("oEdd").textContent = "EDD: " + edd.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) + " · Gestational age: " + Math.floor(ga / 7) + " weeks " + (ga % 7) + " days";
    } else if (which === "alvarado") {
      var al = sumPts("al", 8);
      $("oAl").textContent = "Alvarado = " + al + " - " + (al <= 4 ? "appendicitis unlikely" : al <= 6 ? "possible: observe, USG / CT" : "probable: surgical referral");
    }
  }

  /* ---------- learn ---------- */
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function nextCase() {
    var pool = CONDITIONS.filter(function (c) { return Object.keys(c.s).filter(function (k) { return c.s[k] > 0 && SYMPTOMS[k]; }).length >= 2; });
    var c = pool[Math.floor(Math.random() * pool.length)];
    var feats = Object.keys(c.s).filter(function (k) { return c.s[k] > 0 && SYMPTOMS[k]; }).sort(function (a, b) { return c.s[b] - c.s[a]; }).slice(0, 4);
    var labs = Object.keys(c.s).filter(function (k) { return c.s[k] > 0 && /^lab_/.test(k); }).slice(0, 2);
    var female = /Gynaecology/.test(c.sys) || Math.random() < 0.5, age = 18 + Math.floor(Math.random() * 45);
    var others = shuffle(CONDITIONS.filter(function (x) { return x.id !== c.id; })).slice(0, 3);
    var opts = shuffle([c].concat(others));
    var h = '<div class="alert info"><b>Case:</b> A ' + age + "-year-old " + (female ? "woman" : "man") + " presents with " + esc(shuffle(feats.slice()).map(function (k) { return symLabel(k).toLowerCase(); }).join(", ")) + "." +
      (labs.length ? " Labs show: " + esc(labs.map(symLabel).join(", ")) + "." : "") + "</div><p><b>Most likely diagnosis?</b></p>";
    opts.forEach(function (o) { h += '<button class="opt" data-ans="' + o.id + '">' + esc(o.name) + "</button>"; });
    h += '<div id="learnExp"></div>';
    $("learnBox").innerHTML = h; S.learn.answered = false;
    qsa("[data-ans]", $("learnBox")).forEach(function (b) {
      b.addEventListener("click", function () {
        if (S.learn.answered) return; S.learn.answered = true; S.learn.total++;
        var ok = b.getAttribute("data-ans") === c.id; if (ok) S.learn.score++;
        qsa("[data-ans]", $("learnBox")).forEach(function (x) { if (x.getAttribute("data-ans") === c.id) x.classList.add("right"); else if (x === b) x.classList.add("wrong"); });
        $("learnScore").textContent = "Score: " + S.learn.score + " / " + S.learn.total;
        var rx = (c.rx || []).map(function (it) { var d = DRUGS[it.d]; return d.n + " " + it.dose + " (" + it.s + ", " + it.days + " d)" + (it.cond ? " - conditional" : ""); });
        $("learnExp").innerHTML = '<div class="alert ' + (ok ? "ok" : "urgent") + '" style="margin-top:10px"><b>' + (ok ? "Correct." : "Not quite.") + "</b> " + esc(c.name) + " (" + esc(c.icd) + ")</div>" +
          "<p><b>Teaching point:</b> " + esc(c.teach || "-") + "</p><p><b>Investigations:</b> " + esc((c.inv || []).join("; ")) + "</p>" +
          (c.rxNote ? "<p><b>Note:</b> " + esc(c.rxNote) + "</p>" : "") + "<p><b>First-line management:</b> " + esc(rx.length ? rx.join("; ") : "Non-drug / supportive") + "</p><p><b>Red flags:</b> " + esc((c.rf || []).join("; ")) + "</p>";
      });
    });
  }

  /* ---------- settings ---------- */
  function loadDoc() {
    var d = getDoc();
    $("dName").value = d.name || ""; $("dQual").value = d.qual || ""; $("dReg").value = d.reg || ""; $("dClinic").value = d.clinic || ""; $("dAddr").value = d.addr || ""; $("dPhone").value = d.phone || "";
    $("docChip").textContent = d.name || "Set doctor profile ➜";
  }
  function saveDoc() {
    var d = { name: $("dName").value.trim(), qual: $("dQual").value.trim(), reg: $("dReg").value.trim(), clinic: $("dClinic").value.trim(), addr: $("dAddr").value.trim(), phone: $("dPhone").value.trim() };
    if (d.name && !/^dr\.?\s/i.test(d.name)) d.name = "Dr. " + d.name;
    store.set("idh_doc", d); loadDoc(); toast("Doctor profile saved");
  }

  /* ---------- reset ---------- */
  function resetConsult() {
    ["pName", "pAge", "pWt", "pPhone", "pEgfr", "pMeds", "vTemp", "vSbp", "vDbp", "vPulse", "vSpo2", "vRr", "complaint", "labText"].forEach(function (id) { $(id).value = ""; });
    $("pSex").value = "";
    qsa("#flagBox input, #allergyBox input").forEach(function (i) { i.checked = false; });
    S.attachments.forEach(function (a) { if (a.url) try { URL.revokeObjectURL(a.url); } catch (e) { /* ignore */ } });
    S.cond = null; S.ddx = []; S.ext = null; S.flags = []; S.rx = []; S.attachments = []; S.labs = { findings: [], tags: [], notes: [] }; S.current = null;
    $("results").innerHTML = ""; $("labOut").innerHTML = ""; renderThumbs(); $("fileIn").value = "";
    window.scrollTo(0, 0); toast("Ready for a new patient");
  }

  /* ---------- demo ---------- */
  var DEMOS = [
    ["Dengue-like fever", "Fever since 4 days with severe body ache, pain behind the eyes and rash. No cough.", "Platelets 1.1 lakh, WBC 3200, PCV 47, NS1 antigen positive"],
    ["Urine infection", "Burning urination and frequent urination since 2 days. No fever, no flank pain.", "Urine pus cells 18-20 /hpf, nitrite positive"],
    ["Allergic rhinitis", "Sneezing, runny nose and itchy watery eyes every morning for 3 weeks. No fever.", ""],
    ["Chest pain (emergency)", "Chest pain with sweating and breathlessness since 30 minutes", ""],
    ["Gastroenteritis", "Loose motions 6 times since morning with vomiting and stomach pain. No blood in stool.", ""],
    ["Scabies", "Itching worse at night, itching between fingers, family members also itching", ""],
    ["Migraine", "One sided throbbing headache with nausea and sensitivity to light", ""],
    ["Anaemia + labs", "Tiredness, weakness and looks pale for 2 months", "Hb 8.9 g/dL, MCV 68 fL, Serum ferritin 9 ng/mL"],
    ["Diabetes labs", "Excessive thirst and excessive urination", "Fasting blood sugar 168 mg/dL, HbA1c 8.1 %, Serum creatinine 0.9"]
  ];

  /* ---------- init ---------- */
  function init() {
    $("kbStats").textContent = CONDITIONS.length + " conditions, " + Object.keys(DRUGS).length + " formulary entries, " + LABS.length + " lab parameters, " + INTERACTIONS.length + " interaction rules, " + Object.keys(SYMPTOMS).length + " symptom concepts, " + RED_FLAGS.length + " red-flag rules";
    var dl = "";
    Object.keys(DRUGS).sort(function (a, b) { return DRUGS[a].n.localeCompare(DRUGS[b].n); }).forEach(function (k) { dl += '<option value="' + esc(DRUGS[k].n) + '">'; });
    $("drugNames").innerHTML = dl;
    var extra = document.createElement("div");
    extra.innerHTML = '<datalist id="schedList"><option value="1-0-0"><option value="0-0-1"><option value="1-0-1"><option value="1-1-1"><option value="1-1-1-1"><option value="0-1-0"><option value="2-0-2"><option value="SOS"><option value="STAT"><option value="Once"><option value="Weekly"></datalist>' +
      '<datalist id="timeList"><option value="After food"><option value="Before food"><option value="30 min before breakfast"><option value="Empty stomach"><option value="At bedtime"><option value="Local application"><option value="With water"><option value="-"></datalist>';
    document.body.appendChild(extra);

    qsa(".nav-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var t = b.getAttribute("data-tab");
        qsa(".nav-btn").forEach(function (x) { x.classList.toggle("active", x === b); });
        qsa(".tab").forEach(function (x) { x.classList.toggle("active", x.id === "tab-" + t); });
        if (t === "records") renderRecords();
        if (t === "drugs") renderDrugs();
        if (t === "learn" && !$("learnBox").innerHTML) nextCase();
        if (t === "interact") renderIx();
        window.scrollTo(0, 0);
      });
    });
    $("docChip").addEventListener("click", function () { qsa('.nav-btn[data-tab="settings"]')[0].click(); });
    $("docChip").style.cursor = "pointer";

    $("demoChips").innerHTML = '<span class="hint" style="align-self:center">Demo cases:</span>' + DEMOS.map(function (d, i) { return '<button class="chip" data-demo="' + i + '">' + esc(d[0]) + "</button>"; }).join("");
    qsa("[data-demo]").forEach(function (b) {
      b.addEventListener("click", function () {
        var d = DEMOS[+b.getAttribute("data-demo")];
        $("complaint").value = d[1]; $("labText").value = d[2];
        if (!$("pAge").value) $("pAge").value = 34;
        if (!$("pSex").value) $("pSex").value = /Urine|Anaemia/.test(d[0]) ? "F" : "M";
        analyze();
      });
    });

    $("analyzeBtn").addEventListener("click", analyze);
    $("complaint").addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); analyze(); } });
    $("resetBtn").addEventListener("click", function () { if (confirm("Clear this consultation and start a new patient?")) resetConsult(); });
    var labTimer = null;
    $("labText").addEventListener("input", function () { clearTimeout(labTimer); labTimer = setTimeout(runConsultLabs, 400); });
    ["#flagBox", "#allergyBox"].forEach(function (sel) { qsa(sel + " input").forEach(function (i) { i.addEventListener("change", recheckRx); }); });
    ["pAge", "pEgfr", "pMeds", "pWt"].forEach(function (id) { $(id).addEventListener("change", recheckRx); });
    $("fileIn").addEventListener("change", function (e) { addFiles(e.target.files); e.target.value = ""; });

    $("labBtn2").addEventListener("click", function () { $("labOut2").innerHTML = labTable(analyzeLabs($("labText2").value, $("labSex").value)) || '<p class="hint">No recognisable lab values found. Use the format "Test name value" (e.g. "Hb 10.2").</p>'; });
    $("labSample").addEventListener("click", function () {
      $("labText2").value = "COMPLETE BLOOD COUNT\nHaemoglobin 10.4 g/dL (13-17)\nTotal leucocyte count 13,800 /cumm\nPlatelet count 1.4 lakhs/cumm\nMCV 72 fL\nPCV 33 %\n\nBIOCHEMISTRY\nFasting blood sugar 132 mg/dL\nHbA1c 7.2 %\nSerum creatinine 1.6 mg/dL\nSGPT 64 U/L\nTotal bilirubin 0.9 mg/dL\nTSH 6.8 uIU/mL\nVitamin D 14 ng/mL\nLDL cholesterol 162 mg/dL\nTriglycerides 210 mg/dL";
      $("labSex").value = "M"; $("labBtn2").click();
    });
    $("labImg").addEventListener("change", function (e) { var f = e.target.files[0]; if (f) ocrInto(f, $("labText2"), $("labBtn2"), function () { $("labBtn2").click(); }); e.target.value = ""; });

    $("drugSearch").addEventListener("input", renderDrugs);
    $("ixAdd").addEventListener("click", ixAdd);
    $("ixInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ixAdd(); } });
    $("ixClear").addEventListener("click", function () { S.ix = []; renderIx(); });
    $("ixFromRx").addEventListener("click", function () { var ks = activeRx().map(function (l) { return l.d; }).concat(getPatient().medKeys); if (!ks.length) return toast("No current prescription"); S.ix = uniq(ks); renderIx(); });

    $("recSearch").addEventListener("input", renderRecords);
    $("recExport").addEventListener("click", exportRecs);
    $("recImport").addEventListener("change", function (e) { if (e.target.files[0]) importRecs(e.target.files[0]); e.target.value = ""; });

    $("learnNext").addEventListener("click", nextCase);
    $("saveDoc").addEventListener("click", saveDoc);
    $("wipeAll").addEventListener("click", function () {
      if (!confirm("Delete ALL records and the doctor profile from this device? This cannot be undone.")) return;
      try { localStorage.removeItem("idh_records"); localStorage.removeItem("idh_doc"); } catch (e) { /* ignore */ }
      loadDoc(); renderRecords(); toast("All local data deleted");
    });

    $("printBtn").addEventListener("click", function () { window.print(); });
    $("saveRecBtn").addEventListener("click", saveCurrent);
    $("closeOverlay").addEventListener("click", closeReport);
    $("overlay").addEventListener("click", function (e) { if (e.target === $("overlay")) closeReport(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeReport(); });
    $("patientCopyBtn").addEventListener("click", function () {
      if (!S.current) return;
      var txt = patientText(S.current);
      function fallback() { var ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("Patient instructions copied"); } catch (e) { toast("Copy failed"); } ta.remove(); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { toast("Patient instructions copied - paste into WhatsApp/SMS"); }, fallback);
      else fallback();
    });

    renderCalcs();
    loadDoc();
    setupVoice();
  }

  window.IDH = { extract: extract, rank: rank, checkDrug: checkDrug, interactions: interactions, analyzeLabs: analyzeLabs, qty: qty, egfr: egfrCalc, S: S, patientText: patientText };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
