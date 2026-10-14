// Проверка сайта перед публикацией: node scripts/check.mjs
// Ищет ошибки в data/*.json и битые локальные ссылки на картинки, стили и страницы.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];

function readJSON(rel) {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  } catch (e) {
    errors.push(`${rel}: файл не читается как JSON — проверьте запятые и кавычки (${e.message})`);
    return null;
  }
}
const isHttps = (u) => /^https:\/\//i.test(u);
const localExists = (p) => existsSync(join(ROOT, p.replace(/^\.?\//, "")));

// --- site.json
const site = readJSON("data/site.json");
if (site) {
  if (!site.venue?.name) warnings.push("site.json: не заполнено venue.name (название площадки)");
  if (!site.venue?.address) warnings.push("site.json: не заполнено venue.address (адрес площадки)");
  if (site.vk?.url && !isHttps(site.vk.url)) errors.push("site.json: vk.url должен начинаться с https://");
  const tc = site.ticketscloud || {};
  if (tc.metaEvent && !tc.token) errors.push("site.json: указан ticketscloud.metaEvent, но нет ticketscloud.token");
  const lf = site.leadForm || {};
  if (lf.endpoint && !isHttps(lf.endpoint)) errors.push("site.json: leadForm.endpoint должен начинаться с https://");
  if (lf.endpoint && !lf.privacyPolicyUrl) warnings.push("site.json: форма заявок не включится, пока не указан leadForm.privacyPolicyUrl");
}

// --- events.json
const ev = readJSON("data/events.json");
if (ev) {
  if (!Array.isArray(ev.events)) errors.push('events.json: нужен список "events": [ ... ]');
  else {
    const ids = new Set();
    ev.events.forEach((e, i) => {
      const where = `events.json, игра №${i + 1}${e && e.title ? ` («${e.title}»)` : ""}`;
      if (!e || typeof e !== "object") return errors.push(`${where}: это не объект { ... }`);
      if (e.id) { if (ids.has(e.id)) errors.push(`${where}: id "${e.id}" повторяется`); ids.add(e.id); }
      else warnings.push(`${where}: нет id`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) errors.push(`${where}: date должна быть в формате ГГГГ-ММ-ДД, например "2026-11-21"`);
      else if (isNaN(Date.parse(e.date))) errors.push(`${where}: такой даты не существует: ${e.date}`);
      if (e.time && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(e.time)) errors.push(`${where}: time должно быть в формате ЧЧ:ММ, например "19:30"`);
      if (e.price != null && typeof e.price !== "number" && typeof e.price !== "string") errors.push(`${where}: price — число (700) или текст ("от 600 ₽")`);
      if (e.published != null && typeof e.published !== "boolean") errors.push(`${where}: published — true или false без кавычек`);
      if (e.ticketUrl && !isHttps(e.ticketUrl)) errors.push(`${where}: ticketUrl должен начинаться с https://`);
      if (e.image && !isHttps(e.image) && !localExists(e.image)) errors.push(`${where}: нет файла афиши ${e.image}`);
      if (e.published !== false && !e.ticketscloudEvent && !e.ticketUrl) warnings.push(`${where}: не указаны ticketscloudEvent или ticketUrl — кнопки покупки не будет`);
    });
  }
}

// --- gallery.json, faq.json
const gal = readJSON("data/gallery.json");
if (gal) {
  if (!Array.isArray(gal.items)) errors.push('gallery.json: нужен список "items": [ ... ]');
  else gal.items.forEach((g, i) => {
    if (g.src && !isHttps(g.src) && !localExists(g.src)) errors.push(`gallery.json, элемент №${i + 1}: нет файла ${g.src}`);
    if (g.video && !isHttps(g.video)) errors.push(`gallery.json, элемент №${i + 1}: video должен начинаться с https://`);
  });
}
const faq = readJSON("data/faq.json");
if (faq && !Array.isArray(faq.items)) errors.push('faq.json: нужен список "items": [ ... ]');

// --- локальные ссылки в HTML и CSS
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
for (const file of walk(ROOT).filter((f) => /\.(html|css)$/.test(f))) {
  const text = readFileSync(file, "utf8");
  const refs = [...text.matchAll(/(?<![-\w])(?:href|src)="([^"]+)"|url\("?([^")]+)"?\)/g)].map((m) => m[1] || m[2]);
  for (let ref of refs) {
    if (/^(https?:|mailto:|tel:|data:|#|\/)/.test(ref)) continue; // "/..." — от корня домена, проверяется в 404.html скриптом
    ref = ref.split("#")[0].split("?")[0];
    if (!ref) continue;
    let target = resolve(dirname(file), ref);
    if (ref.endsWith("/") || (existsSync(target) && statSync(target).isDirectory())) target = join(target, "index.html");
    if (!existsSync(target)) errors.push(`${file.slice(ROOT.length + 1)}: битая ссылка ${ref}`);
  }
}

warnings.forEach((w) => console.warn("⚠️  " + w));
errors.forEach((e) => console.error("❌ " + e));
if (errors.length) { console.error(`\nНайдено ошибок: ${errors.length}. Исправьте их, и публикация пройдёт.`); process.exit(1); }
console.log(`✅ Проверка пройдена${warnings.length ? ` (предупреждений: ${warnings.length})` : ""}`);
