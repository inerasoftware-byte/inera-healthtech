# Inera Doctor Hub

Clinical decision support for doctors and medical students, built by INERA GROUP (Inera Software Pvt. Ltd.).
It is a static web app with no backend, no API keys and no paid services. Everything runs in the browser.

## Files (flat, no folders)
- `index.html` – app shell
- `styles.css` – design and print layout (A4 prescription)
- `app.js` – engines: symptom NLP, ranking, safety, Rx builder, report, records, OCR, voice, calculators, case trainer
- `kb.js` – symptoms (English plus Hindi/Kannada colloquial terms), red flags, 48 condition protocols
- `drugs.js` – 64-entry formulary with allergy, pregnancy, renal, hepatic and age rules, plus interaction rules
- `labs.js` – lab report reader (33 parameters plus qualitative tests)
- `vercel.json` – static hosting config

## Deploy (free)
1. Create a new GitHub repository and upload all these files to the repository root.
2. On vercel.com, choose Add New → Project, import the repo, set Framework Preset to **Other**, leave the build command empty, and click Deploy.
3. To test locally, double-click `index.html` or run `python3 -m http.server`.

## Features
- **Smart Consult:** type or dictate the complaint (voice uses the browser, en-IN). The app returns triage alerts, the findings it understood (including negations such as "no cough"), ranked differentials, and an editable prescription that has passed the safety engine.
- **Safety engine:** checks allergies (cross-reactivity included), pregnancy, breastfeeding, CKD/eGFR thresholds, liver disease, heart/QT risk, asthma, peptic ulcer, anticoagulants and age 65+. It swaps in alternatives automatically, blocks a drug when it has no safe alternative, allows a prescriber override, checks drug interactions with the patient's current medicines (brand names recognised) and flags duplicates.
- **Prescription and report:** M-A-N schedule, timing, days and quantity. The printable A4 report includes vitals, labs, investigations, advice, return-if warnings, follow-up and an honest outlook. A patient-friendly copy can be pasted into WhatsApp.
- **Attachments:** reports, X-ray/CT/MRI/USG images, photos and videos are attached to the consult. Lab report photos can be read with OCR (Tesseract.js loads free from a CDN the first time).
- **Lab Report Reader, Drug Library, Interaction Checker, Calculators** (BMI with Asian cut-offs, eGFR CKD-EPI 2021, CURB-65, McIsaac, qSOFA, pregnancy EDD, Alvarado), **Patient Records** (stored on the device, with JSON backup and restore) and a **Student Case Trainer**.

## Limits
- Covers adult first-line management for 48 common conditions. Paediatric doses are not calculated automatically (the dose is marked "weight-based – verify").
- It does not interpret imaging. Images are attached for the clinician or radiologist.
- It is rule-based, not a licensed clinician. Every prescription must be reviewed and signed by a registered medical practitioner.
- Records live in the browser's localStorage on one device. Export backups regularly.
