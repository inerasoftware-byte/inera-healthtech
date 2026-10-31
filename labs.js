/* Inera Doctor Hub — Lab report reader. Parses typed / pasted / OCR text, normalises units, flags against adult reference ranges. */
"use strict";
var LABS = [
  { k: "hba1c", n: "HbA1c", al: ["hba1c", "hb a1c", "glycated haemoglobin", "glycated hemoglobin", "glycosylated haemoglobin", "glycosylated hemoglobin", "a1c"], u: "%", r: [4, 5.6],
    fn: function (v) { if (v >= 6.5) return ["High", "Diabetes range (confirm with repeat test / FPG)", "lab_dm"]; if (v >= 5.7) return ["High", "Prediabetes range", "lab_predm"]; return null; } },
  { k: "hb", n: "Haemoglobin", al: ["haemoglobin", "hemoglobin", "hb", "hgb"], u: "g/dL", r: [13, 17], rf: [12, 15.5], crit: [7, 20],
    lo: ["Anaemia - correlate with MCV, ferritin, smear; below 7 g/dL needs urgent evaluation", "lab_low_hb"], hi: ["Raised Hb - dehydration, smoking, polycythaemia"] },
  { k: "pcv", n: "Haematocrit (PCV)", al: ["packed cell volume", "haematocrit", "hematocrit", "pcv", "hct"], u: "%", r: [40, 50], rf: [36, 46],
    lo: ["Low - anaemia"], hi: ["Haemoconcentration - in dengue, rising HCT with falling platelets = plasma leakage", "lab_high_hct"] },
  { k: "wbc", n: "Total leucocyte count", al: ["total leucocyte count", "total leukocyte count", "total wbc count", "white blood cells", "white blood cell count", "wbc count", "wbc", "tlc", "total count"], u: "x10^3/uL", r: [4, 11], crit: [1, 30], norm: "k",
    lo: ["Leucopenia - viral infection (dengue), typhoid, drugs, marrow disorder", "lab_low_wbc"], hi: ["Leucocytosis - bacterial infection, inflammation, steroids", "lab_high_wbc"] },
  { k: "plt", n: "Platelet count", al: ["platelet count", "platelets", "platelet", "plt"], u: "x10^3/uL", r: [150, 410], crit: [20, 1000], norm: "plt",
    lo: ["Thrombocytopenia - dengue, malaria, sepsis, ITP; below 20 or any bleeding = urgent", "lab_low_plt"], hi: ["Thrombocytosis - reactive (infection, iron deficiency) or myeloproliferative"] },
  { k: "mcv", n: "MCV", al: ["mean corpuscular volume", "mcv"], u: "fL", r: [80, 100],
    lo: ["Microcytosis - iron deficiency or thalassaemia trait (check ferritin, Mentzer index)", "lab_low_mcv"], hi: ["Macrocytosis - B12/folate deficiency, alcohol, hypothyroidism, liver disease", "lab_high_mcv"] },
  { k: "ferritin", n: "Ferritin", al: ["serum ferritin", "ferritin"], u: "ng/mL", r: [30, 300],
    lo: ["Iron deficiency (ferritin below 30 is strongly suggestive)", "lab_low_ferritin"], hi: ["Raised - inflammation, liver disease, iron overload"] },
  { k: "fbs", n: "Fasting glucose", al: ["fasting blood sugar", "fasting blood glucose", "fasting plasma glucose", "glucose fasting", "blood sugar fasting", "fasting sugar", "fbs", "fpg"], u: "mg/dL", r: [70, 99], crit: [54, 400],
    fn: function (v) { if (v >= 126) return ["High", "Diabetes range (confirm on repeat / HbA1c)", "lab_dm"]; if (v >= 100) return ["High", "Impaired fasting glucose (prediabetes)", "lab_predm"]; if (v < 70) return ["Low", "Hypoglycaemia"]; return null; } },
  { k: "ppbs", n: "Post-prandial glucose", al: ["post prandial blood sugar", "post prandial blood glucose", "postprandial blood sugar", "post-prandial", "postprandial", "ppbs", "pp blood sugar", "2 hr glucose"], u: "mg/dL", r: [70, 139],
    fn: function (v) { if (v >= 200) return ["High", "Diabetes range (confirm)", "lab_dm"]; if (v >= 140) return ["High", "Impaired glucose tolerance", "lab_predm"]; return null; } },
  { k: "rbs", n: "Random glucose", al: ["random blood sugar", "random blood glucose", "random glucose", "rbs", "grbs", "cbg"], u: "mg/dL", r: [70, 139], crit: [54, 400],
    fn: function (v) { if (v >= 200) return ["High", "Diabetes likely if symptomatic (confirm with HbA1c/FPG)", "lab_dm"]; if (v < 70) return ["Low", "Hypoglycaemia - treat immediately"]; return null; } },
  { k: "bun", n: "Blood urea nitrogen", al: ["blood urea nitrogen", "bun"], u: "mg/dL", r: [7, 20], lo: ["Low"], hi: ["Raised - dehydration, renal impairment, GI bleed"] },
  { k: "urea", n: "Blood urea", al: ["blood urea", "serum urea", "urea"], u: "mg/dL", r: [15, 45], lo: ["Low"], hi: ["Raised - dehydration, renal impairment, GI bleed"] },
  { k: "creat", n: "Serum creatinine", al: ["serum creatinine", "s. creatinine", "s.creatinine", "creatinine"], u: "mg/dL", r: [0.7, 1.3], rf: [0.6, 1.1],
    lo: ["Low - low muscle mass"], hi: ["Reduced kidney function - check eGFR, avoid nephrotoxic drugs, adjust doses", "lab_high_creat"] },
  { k: "na", n: "Sodium", al: ["serum sodium", "s. sodium", "sodium", "na+"], u: "mmol/L", r: [135, 145], crit: [125, 155], lo: ["Hyponatraemia"], hi: ["Hypernatraemia"] },
  { k: "k", n: "Potassium", al: ["serum potassium", "s. potassium", "potassium", "k+"], u: "mmol/L", r: [3.5, 5.1], crit: [2.5, 6], lo: ["Hypokalaemia"], hi: ["Hyperkalaemia - ECG; check ARB/ACEi, renal function"] },
  { k: "tsh", n: "TSH", al: ["thyroid stimulating hormone", "s. tsh", "tsh"], u: "uIU/mL", r: [0.4, 4.5],
    lo: ["Low - hyperthyroidism or over-replacement (check FT4/FT3)", "lab_low_tsh"], hi: ["Raised - hypothyroidism (check FT4; subclinical if FT4 normal)", "lab_high_tsh"] },
  { k: "ft4", n: "Free T4", al: ["free t4", "ft4", "free thyroxine"], u: "ng/dL", r: [0.8, 1.8], lo: ["Low - hypothyroidism"], hi: ["High - hyperthyroidism"] },
  { k: "vitd", n: "25-OH Vitamin D", al: ["25 hydroxy vitamin d", "25-hydroxy vitamin d", "25-oh vitamin d", "vitamin d 25-oh", "vitamin d 25 oh", "vitamin d3", "vitamin d", "vit d"], u: "ng/mL", r: [30, 100],
    fn: function (v) { if (v < 20) return ["Low", "Vitamin D deficiency", "lab_low_vitd"]; if (v < 30) return ["Low", "Vitamin D insufficiency"]; if (v > 100) return ["High", "Possible toxicity"]; return null; } },
  { k: "b12", n: "Vitamin B12", al: ["vitamin b12", "vit b12", "cobalamin", "b12"], u: "pg/mL", r: [200, 900], lo: ["B12 deficiency", "lab_low_b12"], hi: ["High - supplementation or liver disease"] },
  { k: "dbil", n: "Direct bilirubin", al: ["direct bilirubin", "conjugated bilirubin", "bilirubin direct"], u: "mg/dL", r: [0, 0.3], hi: ["Raised conjugated bilirubin - hepatocellular / obstructive"] },
  { k: "ibil", n: "Indirect bilirubin", al: ["indirect bilirubin", "unconjugated bilirubin", "bilirubin indirect"], u: "mg/dL", r: [0.1, 1], hi: ["Raised unconjugated - haemolysis, Gilbert syndrome"] },
  { k: "tbil", n: "Total bilirubin", al: ["total bilirubin", "bilirubin total", "s. bilirubin", "serum bilirubin", "bilirubin"], u: "mg/dL", r: [0.1, 1.2], hi: ["Hyperbilirubinaemia / jaundice", "lab_high_bili"] },
  { k: "alt", n: "ALT (SGPT)", al: ["alanine aminotransferase", "sgpt", "alt"], u: "U/L", r: [7, 56], hi: ["Raised - hepatocellular injury (over 10x ULN: acute hepatitis)", "lab_high_alt"] },
  { k: "ast", n: "AST (SGOT)", al: ["aspartate aminotransferase", "sgot", "ast"], u: "U/L", r: [8, 48], hi: ["Raised - liver / muscle injury"] },
  { k: "alp", n: "Alkaline phosphatase", al: ["alkaline phosphatase", "alp"], u: "U/L", r: [44, 147], hi: ["Raised - cholestasis or bone disease"] },
  { k: "ua", n: "Uric acid", al: ["serum uric acid", "s. uric acid", "uric acid"], u: "mg/dL", r: [3.4, 7], rf: [2.4, 6], hi: ["Hyperuricaemia", "lab_high_ua"] },
  { k: "crp", n: "CRP", al: ["c-reactive protein", "c reactive protein", "crp"], u: "mg/L", r: [0, 6], hi: ["Inflammation / infection (above 100 suggests bacterial)", "lab_high_crp"] },
  { k: "esr", n: "ESR", al: ["erythrocyte sedimentation rate", "esr"], u: "mm/hr", r: [0, 15], rf: [0, 20], hi: ["Raised - inflammation, infection (TB), anaemia, myeloma"] },
  { k: "ldl", n: "LDL cholesterol", al: ["ldl cholesterol", "ldl-c", "ldl"], u: "mg/dL", r: [0, 100], hi: ["Raised LDL - cardiovascular risk", "lab_high_ldl"] },
  { k: "hdl", n: "HDL cholesterol", al: ["hdl cholesterol", "hdl-c", "hdl"], u: "mg/dL", r: [40, 200], rf: [50, 200], lo: ["Low HDL - cardiovascular risk"] },
  { k: "tg", n: "Triglycerides", al: ["triglycerides", "triglyceride", "tg"], u: "mg/dL", r: [0, 150], hi: ["Raised TG (above 500: pancreatitis risk)", "lab_high_tg"] },
  { k: "chol", n: "Total cholesterol", al: ["total cholesterol", "serum cholesterol", "cholesterol"], u: "mg/dL", r: [0, 200], hi: ["Raised total cholesterol", "lab_high_chol"] },
  { k: "pus", n: "Urine pus cells", al: ["pus cells", "urine pus cells", "wbc/hpf"], u: "/hpf", r: [0, 5], hi: ["Pyuria - suggests UTI; send urine culture", "lab_uti"] }
];

var QUAL = [
  { re: /(ns1|dengue)[^\n.]{0,40}(positive|reactive|detected)/i, t: "Dengue test POSITIVE", tag: "lab_dengue" },
  { re: /(malaria|mp|plasmodium|vivax|falciparum|rdt)[^\n.]{0,40}(positive|detected|seen)/i, t: "Malaria test POSITIVE - identify species", tag: "lab_malaria" },
  { re: /hbsag[^\n.]{0,30}(positive|reactive)/i, t: "HBsAg REACTIVE - hepatitis B", tag: "lab_hbsag" },
  { re: /(urine pregnancy|upt|beta hcg|b-hcg)[^\n.]{0,30}(positive|reactive)/i, t: "Pregnancy test POSITIVE - review all drugs for pregnancy safety", tag: "lab_preg" },
  { re: /widal/i, t: "Widal test present - low sensitivity/specificity in India; do not diagnose typhoid on Widal alone" },
  { re: /(nitrite)[^\n.]{0,20}(positive|present)/i, t: "Urine nitrite POSITIVE - supports bacterial UTI", tag: "lab_uti" },
  { re: /(hiv)[^\n.]{0,30}(reactive|positive)/i, t: "HIV screen REACTIVE - confirm per NACO protocol and counsel" }
];

function _labEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function analyzeLabs(text, sex) {
  var out = { findings: [], tags: [], notes: [] };
  if (!text || !text.trim()) return out;
  var t = text.toLowerCase().replace(/,(?=\d{3}\b)/g, "");  /* 2,50,000 / 250,000 -> digits */
  t = t.replace(/(\d),(\d)/g, "$1$2");
  var pairs = [];
  LABS.forEach(function (L) { L.al.forEach(function (a) { pairs.push([a, L]); }); });
  pairs.sort(function (x, y) { return y[0].length - x[0].length; });
  var done = {};
  pairs.forEach(function (p) {
    var L = p[1];
    if (done[L.k]) return;
    var re = new RegExp("([^a-z0-9]|^)" + _labEsc(p[0]) + "(?![a-z0-9])[^0-9\\n]{0,30}?(\\d+(?:\\.\\d+)?)(\\s*(?:lakhs?|lacs?))?", "i");
    var m = re.exec(t);
    if (!m) return;
    var v = parseFloat(m[2]);
    if (isNaN(v)) return;
    if (L.norm === "plt") { if (m[3]) v = v * 100; else if (v < 10) v = v * 100; else if (v > 1000) v = v / 1000; }
    if (L.norm === "k") { if (v > 200) v = v / 1000; }
    v = Math.round(v * 100) / 100;
    done[L.k] = true;
    var span = m.index + m[1].length; var len = m[0].length - m[1].length;
    t = t.substring(0, span) + new Array(len + 1).join(" ") + t.substring(span + len);
    var r = (sex === "F" && L.rf) ? L.rf : L.r;
    if (!sex && L.rf) r = [Math.min(L.r[0], L.rf[0]), Math.max(L.r[1], L.rf[1])];
    var status = "Normal", note = "Within reference range", tag = null, res = null;
    if (L.fn) res = L.fn(v);
    if (res) { status = res[0]; note = res[1]; tag = res[2] || null; }
    else if (v < r[0]) { status = "Low"; note = L.lo ? L.lo[0] : "Below range"; tag = L.lo ? L.lo[1] : null; }
    else if (v > r[1]) { status = "High"; note = L.hi ? L.hi[0] : "Above range"; tag = L.hi ? L.hi[1] : null; }
    if (L.crit && (v < L.crit[0] || v > L.crit[1])) { status = "Critical"; note = "CRITICAL VALUE - act today. " + note; }
    if (tag) out.tags.push(tag);
    out.findings.push({ k: L.k, name: L.n, value: v, unit: L.u, ref: r[0] + " - " + r[1], status: status, note: note });
  });
  QUAL.forEach(function (q) { if (q.re.test(text)) { out.notes.push(q.t); if (q.tag) out.tags.push(q.tag); } });
  var tagSet = {}; out.tags.forEach(function (x) { tagSet[x] = 1; });
  if (tagSet.lab_low_plt && tagSet.lab_high_hct) out.notes.push("Falling platelets with high haematocrit - plasma leakage pattern (dengue warning sign).");
  if (tagSet.lab_low_hb && tagSet.lab_low_mcv && !tagSet.lab_low_ferritin) out.notes.push("Microcytic anaemia - order ferritin; if ferritin normal consider thalassaemia trait (Hb electrophoresis).");
  return out;
}
