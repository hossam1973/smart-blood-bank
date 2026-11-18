import { readFileSync, writeFileSync } from "node:fs";
const base = "/home/user/smart-blood-bank/mobile/locales/";
const extras = (await import("./demo-extras.mjs")).default;
const out = {};
for (const l of ["ar", "en", "fr", "ur", "hi", "tr"]) {
  const mod = await import(base + l + ".ts");
  out[l] = { ...mod.default, ...extras[l] };
}
const missing = Object.keys(out.ar).filter((k) => !(k in out.en));
if (missing.length) throw new Error("missing keys in en: " + missing);
const json = JSON.stringify(out).replace(/</g, "\\u003c");
const html = readFileSync(new URL("./demo-template.html", import.meta.url), "utf8").replace("__I18N__", () => json);
writeFileSync(new URL("./blood-bank-demo.html", import.meta.url), html);
console.log("built", (html.length / 1024).toFixed(0) + " KB", Object.keys(out.ar).length + " keys");
