// product-sync Edge Function（單檔版，由 npm run bundle:sync 產生；請勿手動修改）
// 部署：Supabase → Edge Functions → Deploy a new function → Via Editor → 名稱 product-sync → 全部貼上 → Deploy
// 部署後務必關閉 Enforce JWT verification（來源驗證改用 HMAC 簽章，一般使用者 JWT 不被接受）

// supabase/functions/_shared/catalog/installText.ts
var SPEC_FIELDS = [
  "width_cm",
  "height_cm",
  "depth_cm",
  "door_open_90_depth_cm",
  "full_open_depth_cm",
  "full_open_height_cm",
  "door_clearance_cm",
  "power_cable_cm",
  "water_inlet_hose_cm",
  "drain_hose_cm",
  "inlet_drain_hose_cm",
  "package_width_cm",
  "package_height_cm",
  "package_depth_cm"
];
var SPEC_LABELS = {
  width_cm: "\u5BEC",
  height_cm: "\u9AD8",
  depth_cm: "\u6DF1",
  door_open_90_depth_cm: "\u9580\u958B 90 \u5EA6\u7E3D\u6DF1",
  full_open_depth_cm: "\u5168\u958B\u7E3D\u6DF1",
  full_open_height_cm: "\u5168\u958B\u7E3D\u9AD8",
  door_clearance_cm: "\u958B\u9580\u6240\u9700\u7A7A\u9593",
  power_cable_cm: "\u96FB\u6E90\u7DDA\u9577\u5EA6",
  water_inlet_hose_cm: "\u9032\u6C34\u7BA1\u9577\u5EA6",
  drain_hose_cm: "\u6392\u6C34\u7BA1\u9577\u5EA6",
  inlet_drain_hose_cm: "\u9032\u6392\u6C34\u7BA1\u9577\u5EA6\uFF08\u539F\u6587\u672A\u5340\u5206\u9032\u6C34\uFF0F\u6392\u6C34\uFF09",
  package_width_cm: "\u5916\u7BB1\u5BEC",
  package_height_cm: "\u5916\u7BB1\u9AD8",
  package_depth_cm: "\u5916\u7BB1\u6DF1"
};
function emptySpecs() {
  return Object.fromEntries(SPEC_FIELDS.map((f) => [f, null]));
}
function toHalfWidth(s) {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/　/g, " ").replace(/\r\n?/g, "\n");
}
var NUM = String.raw`(\d+(?:\.\d+)?)`;
var UNIT = String.raw`\s*(cm|mm|m|公分|公釐|毫米|釐米|厘米|米)?`;
function toCm(num, unit) {
  const v = Number(num);
  if (!Number.isFinite(v) || v < 0) return null;
  const u = (unit ?? "").toLowerCase();
  if (u === "") return [round(v), true];
  if (u === "cm" || u === "\u516C\u5206" || u === "\u91D0\u7C73" || u === "\u5398\u7C73") return [round(v), false];
  if (u === "mm" || u === "\u516C\u91D0" || u === "\u6BEB\u7C73") return [round(v / 10), false];
  if (u === "m" || u === "\u7C73") return [round(v * 100), false];
  return null;
}
var round = (v) => Math.round(v * 10) / 10;
var LINE_RULES = [
  { field: "door_open_90_depth_cm", re: new RegExp(String.raw`^門開\s*90\s*度?\s*(?:總深|總深度|深度)\s*[:：]?\s*${NUM}${UNIT}$`) },
  { field: "full_open_depth_cm", re: new RegExp(String.raw`^全開\s*(?:總深|總深度)\s*[:：]?\s*${NUM}${UNIT}\s*(?:\(([^)]*)\))?$`), condition: true },
  { field: "full_open_height_cm", re: new RegExp(String.raw`^全開\s*(?:總高|總高度)\s*[:：]?\s*${NUM}${UNIT}\s*(?:\(([^)]*)\))?$`), condition: true },
  { field: "door_clearance_cm", re: new RegExp(String.raw`^開門\s*(?:所需)?\s*空間\s*[:：]?\s*${NUM}${UNIT}$`) },
  { field: "power_cable_cm", re: new RegExp(String.raw`^電源線\s*(?:長度|長)?\s*[:：]?\s*${NUM}${UNIT}$`) },
  {
    field: "inlet_drain_hose_cm",
    re: new RegExp(String.raw`^進排水管\s*(?:長度|長)?\s*[:：]?\s*${NUM}${UNIT}$`),
    note: "\u300C\u9032\u6392\u6C34\u7BA1\u9577\u5EA6\u300D\u539F\u6587\u672A\u5340\u5206\u9032\u6C34\u7BA1\u6216\u6392\u6C34\u7BA1\uFF0C\u672A\u62C6\u5206\u70BA\u5169\u500B\u6578\u503C"
  },
  { field: "water_inlet_hose_cm", re: new RegExp(String.raw`^進水管\s*(?:長度|長)?\s*[:：]?\s*${NUM}${UNIT}$`) },
  { field: "drain_hose_cm", re: new RegExp(String.raw`^排水管\s*(?:長度|長)?\s*[:：]?\s*${NUM}${UNIT}$`) }
];
var DIM_KEY = { \u5BEC: "w", \u5BEC\u5EA6: "w", \u9AD8: "h", \u9AD8\u5EA6: "h", \u6DF1: "d", \u6DF1\u5EA6: "d" };
function parseDimTriple(text) {
  const parts = text.split(/[;,、/*×\s]+/).filter(Boolean);
  if (!parts.length) return null;
  const out = {};
  for (const p of parts) {
    const m = p.match(new RegExp(String.raw`^(寬度|高度|深度|寬|高|深)\s*[:：]?\s*${NUM}${UNIT}$`));
    if (!m) return null;
    const k = DIM_KEY[m[1]];
    const v = toCm(m[2], m[3]);
    if (!v || out[k]) return null;
    out[k] = v;
  }
  return out;
}
function parseInstallText(raw) {
  const specs = emptySpecs();
  const res = { specs, conditions: [], unparsed: [], issues: [], notes: [], unitAssumed: false, quality: "missing" };
  const text = toHalfWidth(raw ?? "").trim();
  if (!text) return res;
  let parsedCount = 0;
  const set = (field, v, line) => {
    if (v[1]) res.unitAssumed = true;
    if (specs[field] !== null && specs[field] !== v[0]) {
      res.issues.push({ code: "conflict", field, line, message: `${SPEC_LABELS[field]}\u51FA\u73FE\u5169\u500B\u4E0D\u540C\u6578\u503C\uFF08${specs[field]}\u3001${v[0]}\uFF09\uFF0C\u9700\u4EBA\u5DE5\u78BA\u8A8D` });
      specs[field] = null;
      return;
    }
    specs[field] = v[0];
    parsedCount++;
  };
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const compact = line.replace(/\s+/g, " ");
    const pkg = compact.match(/^外箱\s*(?:尺寸)?\s*[:：]?\s*(.+)$/);
    if (pkg) {
      const t = parseDimTriple(pkg[1]);
      if (t && (t.w || t.h || t.d)) {
        if (t.w) set("package_width_cm", t.w, line);
        if (t.h) set("package_height_cm", t.h, line);
        if (t.d) set("package_depth_cm", t.d, line);
        continue;
      }
    }
    const body = parseDimTriple(compact);
    if (body && (body.w || body.h || body.d)) {
      if (body.w) set("width_cm", body.w, line);
      if (body.h) set("height_cm", body.h, line);
      if (body.d) set("depth_cm", body.d, line);
      continue;
    }
    let hit = false;
    for (const rule of LINE_RULES) {
      const m = compact.match(rule.re);
      if (!m) continue;
      const v = toCm(m[1], m[2]);
      if (!v) {
        res.issues.push({ code: "bad_number", field: rule.field, line, message: `${SPEC_LABELS[rule.field]}\u6578\u503C\u7121\u6CD5\u8FA8\u8B58` });
      } else {
        set(rule.field, v, line);
        if (rule.condition && m[3]?.trim()) {
          res.conditions.push({ field: rule.field, value_cm: v[0], condition: m[3].trim(), source: line });
        }
        if (rule.note && !res.notes.includes(rule.note)) res.notes.push(rule.note);
      }
      hit = true;
      break;
    }
    if (hit) continue;
    res.unparsed.push(line);
    res.issues.push({ code: "unrecognized", line, message: "\u7121\u6CD5\u8FA8\u8B58\u7684\u5167\u5BB9\uFF08\u539F\u6587\u4FDD\u7559\uFF0C\u9700\u4EBA\u5DE5\u78BA\u8A8D\uFF09" });
  }
  const hasBody = specs.width_cm !== null && specs.height_cm !== null && specs.depth_cm !== null;
  if (parsedCount === 0) res.quality = "invalid";
  else {
    if (!hasBody) res.issues.push({ code: "missing_body_dims", line: "", message: "\u7F3A\u5C11\u5B8C\u6574\u7684\u672C\u9AD4\u5BEC\u3001\u9AD8\u3001\u6DF1" });
    res.quality = res.issues.length ? "needs_review" : "complete";
  }
  if (res.unitAssumed) res.notes.push("\u539F\u6587\u672A\u6A19\u793A\u55AE\u4F4D\uFF0C\u4F9D\u9810\u8A2D\u4EE5 cm \u89E3\u8B80");
  return res;
}

// supabase/functions/_shared/catalog/normalize.ts
function splitModelCell(raw) {
  const s = toHalfWidth(raw ?? "").replace(/\s*\/\s*/g, "/").trim();
  if (!s) return null;
  const m = s.match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return null;
  const modelToken = m[1];
  const modelCode = normalizeModelCode(modelToken);
  if (!/[A-Z]/.test(modelCode) || !/\d/.test(modelCode)) return null;
  return { modelCode, modelToken, description: m[2].replace(/\s+/g, " ").trim() };
}
function normalizeModelCode(s) {
  return toHalfWidth(s).replace(/\s+/g, "").toUpperCase();
}
function displayNameFrom(description) {
  return description.replace(/^[A-Z]\s*\//, "").replace(/\/?\s*(?:網購|集盛|量販|通路)(?:\s*[+＋、]\s*(?:網購|集盛|量販|通路))*\s*禁售/g, "").replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "").replace(/\s+/g, " ").trim();
}
function stripPrices(s) {
  const re = /(?:NT\s*)?\$\s*[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*元/gi;
  const removed = re.test(s);
  return { text: s.replace(re, "").replace(/[ \t]{2,}/g, " ").trim(), removed };
}
function extractUrls(...cells) {
  const out = [];
  for (const c of cells) {
    for (const part of toHalfWidth(c ?? "").split(/[,\s，、;]+/)) {
      const u = part.trim();
      if (!/^https?:\/\/[^\s]+$/i.test(u)) continue;
      try {
        const url = new URL(u);
        if (!out.includes(url.href)) out.push(url.href);
      } catch {
      }
    }
  }
  return out;
}
function cleanText(s) {
  const t = toHalfWidth(s ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t || null;
}

// supabase/functions/_shared/catalog/multiSplit.ts
var CN_NUM = { \u4E00: 1, \u4E8C: 2, \u4E09: 3, \u56DB: 4, \u4E94: 5, \u516D: 6, \u4E03: 7, \u516B: 8, \u4E5D: 9 };
var cnToNum = (s) => CN_NUM[s] ?? (Number(s) || null);
function parseIndoor(raw, position) {
  const { text } = stripPrices(toHalfWidth(raw));
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^([A-Z0-9-]{4,})\s*(.*)$/i);
  if (!m) return null;
  const rest = m[2];
  const cap = rest.match(/(\d+(?:\.\d+)?)\s*KW/i);
  const series = rest.replace(/(\d+(?:\.\d+)?)\s*KW/i, "").trim() || null;
  return { model_code: normalizeModelCode(m[1]), series, capacity_kw: cap ? Number(cap[1]) : null, position, source_text: t };
}
function parseCapacityRules(notes) {
  const rules = [];
  const re = /(?:一對([一二三四五六七八九\d]))?\s*搭配室內機\s*(\d+(?:\.\d+)?)\s*[~～-]\s*(\d+(?:\.\d+)?)\s*(?:KW)?\s*\(([^)]*)\)/gi;
  for (const m of toHalfWidth(notes).matchAll(re)) {
    const inner = m[4];
    const max = inner.match(/不得超過\s*(\d+(?:\.\d+)?)/);
    const min = inner.match(/不得低於\s*(\d+(?:\.\d+)?)/);
    rules.push({
      indoor_count: m[1] ? cnToNum(m[1]) : null,
      unit_min_kw: Number(m[2]),
      unit_max_kw: Number(m[3]),
      total_max_kw: max ? Number(max[1]) : null,
      total_min_kw: min ? Number(min[1]) : null,
      source_text: m[0].trim()
    });
  }
  return rules;
}
function parseMultiSplitRow(values) {
  const outdoorRaw = toHalfWidth(values["\u5BA4\u5916\u6A5F\u578B\u865F"] ?? "").trim();
  if (!outdoorRaw) return null;
  const issues = [];
  const model = outdoorRaw.replace(/\([^)]*\)/g, " ").match(/[A-Z][A-Z0-9-]*\d[A-Z0-9-]*/i);
  if (!model) return null;
  const cap = outdoorRaw.match(/\(\s*(\d+(?:\.\d+)?)\s*KW\s*\)/i);
  const counts = [...outdoorRaw.matchAll(/一對([一二三四五六七八九\d])/g)].map((m) => cnToNum(m[1])).filter((n) => !!n);
  if (!counts.length) issues.push("\u5BA4\u5916\u6A5F\u6B04\u672A\u6A19\u793A\u642D\u914D\u65B9\u5F0F\uFF08\u4E00\u5C0D\u5E7E\uFF09");
  const indoor = [];
  for (let i = 1; i <= 12; i++) {
    const cell = values[`\u5BA4\u5167\u6A5F${i}`];
    if (!cell) continue;
    const u = parseIndoor(cell, i);
    if (u) indoor.push(u);
    else issues.push(`\u5BA4\u5167\u6A5F${i}\u300C${stripPrices(cell).text}\u300D\u7121\u6CD5\u8FA8\u8B58\u578B\u865F`);
  }
  const notesRaw = cleanText(values["\u5099\u8A3B"]);
  const notes = notesRaw ? stripPrices(notesRaw).text : null;
  const rules = notes ? parseCapacityRules(notes) : [];
  if (notes && !rules.length) issues.push("\u5099\u8A3B\u4E2D\u7684\u5BB9\u91CF\u898F\u5247\u7121\u6CD5\u89E3\u6790\uFF08\u539F\u6587\u4FDD\u7559\uFF09");
  return {
    model_code: normalizeModelCode(model[0]),
    outdoor_text: stripPrices(outdoorRaw).text,
    capacity_kw: cap ? Number(cap[1]) : null,
    indoor_counts: [...new Set(counts)].sort(),
    indoor_units: indoor,
    notes,
    rules,
    issues
  };
}

// supabase/functions/_shared/catalog/transform.ts
var PRODUCT_SHEET = "\u5831\u50F9";
var MULTI_SPLIT_SHEET = "\u4E00\u5C0D\u591A\u5831\u50F9";
var PRODUCT_COLUMNS = ["\u7522\u54C1\u578B\u865F", "\u5206\u985E", "\u5716\u7247\u7DB2\u5740", "\u5716\u7247\u7DB2\u57402", "\u5716\u7247\u7DB2\u57403", "\u5716\u7247\u7DB2\u57404", "\u5B89\u88DD\u5C3A\u5BF8", "\u9023\u7D50", "\u5F71\u7247\u7DB2\u5740", "\u4FDD\u990A\u8AAA\u660E"];
var MULTI_SPLIT_COLUMNS = ["\u5BA4\u5916\u6A5F\u578B\u865F", "\u5BA4\u5167\u6A5F1", "\u5BA4\u5167\u6A5F2", "\u5BA4\u5167\u6A5F3", "\u5BA4\u5167\u6A5F4", "\u5BA4\u5167\u6A5F5", "\u5BA4\u5167\u6A5F6", "\u5BA4\u5167\u6A5F7", "\u5099\u8A3B"];
var FORBIDDEN_COLUMN_PATTERNS = [/價/, /低售/, /促銷/, /LINE/i, /user\s*id/i, /業績/, /目標/, /姓名/, /累積/];
var ForbiddenColumnError = class extends Error {
};
function assertAllowedColumns(sheet, columns) {
  const allowed = sheet === PRODUCT_SHEET ? PRODUCT_COLUMNS : MULTI_SPLIT_COLUMNS;
  for (const c of columns) {
    if (!allowed.includes(c)) throw new ForbiddenColumnError(`\u300C${sheet}\u300D\u542B\u6709\u4E0D\u5141\u8A31\u540C\u6B65\u7684\u6B04\u4F4D\u300C${c}\u300D\uFF0C\u5DF2\u62D2\u7D55\u6574\u500B\u8ACB\u6C42`);
    if (FORBIDDEN_COLUMN_PATTERNS.some((re) => re.test(c)) && c !== "\u5099\u8A3B") throw new ForbiddenColumnError(`\u6B04\u4F4D\u300C${c}\u300D\u5C6C\u65BC\u7981\u6B62\u540C\u6B65\u7684\u8CC7\u6599`);
  }
}
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
async function sha256(v) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(typeof v === "string" ? v : canonical(v)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function transformProducts(rows) {
  const products = [];
  const warnings = [];
  const skippedRows = [];
  const seen = /* @__PURE__ */ new Map();
  for (const r of rows) {
    assertAllowedColumns(PRODUCT_SHEET, Object.keys(r.values));
    const v = r.values;
    const cell = splitModelCell(v["\u7522\u54C1\u578B\u865F"]);
    if (!cell) {
      if (Object.values(v).some((x) => (x ?? "").trim())) skippedRows.push(r.row);
      continue;
    }
    const install = parseInstallText(v["\u5B89\u88DD\u5C3A\u5BF8"]);
    const description = cleanText(cell.description);
    const desc = description ? stripPrices(description).text || null : null;
    const rec = {
      source_key: `${PRODUCT_SHEET}:${cell.modelCode}`,
      model_code: cell.modelCode,
      model_raw: stripPrices((v["\u7522\u54C1\u578B\u865F"] ?? "").trim()).text,
      // 原文中萬一含金額也去除
      description: desc,
      display_name: desc ? displayNameFrom(desc) || null : null,
      category_raw: v["\u5206\u985E"] ?? null,
      category: cleanText(v["\u5206\u985E"]),
      image_urls: extractUrls(v["\u5716\u7247\u7DB2\u5740"], v["\u5716\u7247\u7DB2\u57402"], v["\u5716\u7247\u7DB2\u57403"], v["\u5716\u7247\u7DB2\u57404"]),
      link_urls: extractUrls(v["\u9023\u7D50"]),
      video_urls: extractUrls(v["\u5F71\u7247\u7DB2\u5740"]),
      maintenance_notes: (() => {
        const m = cleanText(v["\u4FDD\u990A\u8AAA\u660E"]);
        return m ? stripPrices(m).text || null : null;
      })(),
      install_text_raw: cleanText(v["\u5B89\u88DD\u5C3A\u5BF8"]),
      specs: install.specs,
      install_extra: { conditions: install.conditions, unparsed: install.unparsed, notes: install.notes, unit_assumed: install.unitAssumed },
      parse_issues: install.issues.map((i) => ({ code: i.code, message: i.message, line: i.line || void 0, field: i.field })),
      data_quality: install.quality,
      source_row: r.row,
      content_hash: "",
      spec_hash: ""
    };
    const dup = seen.get(rec.source_key);
    if (dup) {
      warnings.push(`\u578B\u865F ${rec.model_code} \u91CD\u8907\u51FA\u73FE\uFF08\u7B2C ${dup.source_row} \u5217\u8207\u7B2C ${r.row} \u5217\uFF09\uFF0C\u4FDD\u7559\u7B2C ${dup.source_row} \u5217`);
      dup.data_quality = "needs_review";
      if (!dup.parse_issues.some((i) => i.code === "duplicate"))
        dup.parse_issues.push({ code: "duplicate", message: `\u8A66\u7B97\u8868\u4E2D\u6709\u91CD\u8907\u578B\u865F\uFF08\u7B2C ${r.row} \u5217\uFF09\uFF0C\u9700\u4EBA\u5DE5\u78BA\u8A8D` });
      continue;
    }
    seen.set(rec.source_key, rec);
    products.push(rec);
  }
  for (const p of products) {
    p.spec_hash = await sha256({ specs: p.specs, extra: p.install_extra, raw: p.install_text_raw });
    const { content_hash: _c, spec_hash: _s, source_row: _r, ...rest } = p;
    p.content_hash = await sha256(rest);
  }
  return { products, warnings, skippedRows };
}
async function transformSystems(rows) {
  const systems = [];
  const warnings = [];
  const seen = /* @__PURE__ */ new Set();
  for (const r of rows) {
    assertAllowedColumns(MULTI_SPLIT_SHEET, Object.keys(r.values));
    const s = parseMultiSplitRow(r.values);
    if (!s) continue;
    const key = `${MULTI_SPLIT_SHEET}:${s.model_code}`;
    if (seen.has(key)) {
      warnings.push(`\u5BA4\u5916\u6A5F ${s.model_code} \u91CD\u8907\u51FA\u73FE\uFF08\u7B2C ${r.row} \u5217\u5DF2\u7565\u904E\uFF09`);
      continue;
    }
    seen.add(key);
    for (const i of s.issues) warnings.push(`\u5BA4\u5916\u6A5F ${s.model_code}\uFF1A${i}`);
    systems.push({ ...s, source_key: key, source_row: r.row, content_hash: await sha256(s) });
  }
  return { systems, warnings };
}
async function transformSnapshot(input) {
  const p = await transformProducts(input.products);
  const s = await transformSystems(input.multiSplit);
  return { products: p.products, systems: s.systems, warnings: [...p.warnings, ...s.warnings], skippedRows: p.skippedRows };
}

// supabase/functions/product-sync/handler.ts
var MAX_BODY = 2e6;
var MAX_SKEW_MS = 5 * 60 * 1e3;
var TOP_KEYS = /* @__PURE__ */ new Set(["dataset", "mode", "trigger", "force", "spreadsheet_id", "sent_at", "products", "multi_split"]);
var MODES = /* @__PURE__ */ new Set(["sync", "full", "preview"]);
var TRIGGERS = /* @__PURE__ */ new Set(["edit", "schedule", "manual", "full", "preview", "test"]);
var json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function readRows(section, name) {
  if (section === void 0) return [];
  const s = section;
  if (!s || typeof s !== "object" || !Array.isArray(s.rows)) throw new BadRequest(`${name}.rows \u5FC5\u9808\u662F\u9663\u5217`);
  return s.rows.map((r, i) => {
    const row = r;
    if (!row || typeof row.row !== "number" || !row.values || typeof row.values !== "object") throw new BadRequest(`${name}.rows[${i}] \u683C\u5F0F\u932F\u8AA4`);
    const values = {};
    for (const [k, v] of Object.entries(row.values)) {
      if (v !== null && typeof v !== "string" && typeof v !== "number") throw new BadRequest(`${name}.rows[${i}].${k} \u5FC5\u9808\u662F\u6587\u5B57`);
      values[k] = v === null ? null : String(v);
    }
    return { row: row.row, values };
  });
}
var BadRequest = class extends Error {
};
async function handle(req, env, fetchImpl = fetch, now = Date.now()) {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  const secret = env.PRODUCT_SYNC_SECRET;
  if (!secret || secret.length < 32 || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "\u4F3A\u670D\u5668\u5C1A\u672A\u8A2D\u5B9A\u540C\u6B65\u5BC6\u9470" });
  const ts = req.headers.get("x-sync-timestamp") ?? "";
  const requestId = req.headers.get("x-sync-request-id") ?? "";
  const signature = (req.headers.get("x-sync-signature") ?? "").toLowerCase();
  if (!/^\d{13}$/.test(ts) || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId) || !/^[0-9a-f]{64}$/.test(signature)) return json(401, { error: "unauthorized" });
  if (Math.abs(now - Number(ts)) > MAX_SKEW_MS) return json(401, { error: "request expired" });
  const body = await req.text();
  if (body.length > MAX_BODY) return json(413, { error: "payload too large" });
  const expected = await hmacHex(secret, `${ts}.${requestId}.${body}`);
  if (!safeEqual(expected, signature)) return json(401, { error: "unauthorized" });
  let payload;
  let meta = {};
  try {
    payload = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new BadRequest("\u672C\u6587\u5FC5\u9808\u662F JSON \u7269\u4EF6");
    for (const k of Object.keys(payload)) if (!TOP_KEYS.has(k)) throw new BadRequest(`\u4E0D\u5141\u8A31\u7684\u6B04\u4F4D\uFF1A${k}`);
    const dataset = String(payload.dataset ?? "production");
    const mode = String(payload.mode ?? "sync");
    const trigger = String(payload.trigger ?? "manual");
    if (!["production", "staging"].includes(dataset)) throw new BadRequest("dataset \u932F\u8AA4");
    if (!MODES.has(mode)) throw new BadRequest("mode \u932F\u8AA4");
    if (!TRIGGERS.has(trigger)) throw new BadRequest("trigger \u932F\u8AA4");
    meta = { request_id: requestId, dataset, mode, trigger, spreadsheet_id: typeof payload.spreadsheet_id === "string" ? payload.spreadsheet_id.slice(0, 100) : null, started_at: new Date(now).toISOString() };
    const t = await transformSnapshot({ products: readRows(payload.products, "products"), multiSplit: readRows(payload.multi_split, "multi_split") });
    const sourceHash = await sha256({ p: t.products.map((p) => p.content_hash).sort(), s: t.systems.map((s) => s.content_hash).sort() });
    const rpcBody = {
      p: { ...meta, force: payload.force === true, source_hash: sourceHash, products: t.products, systems: t.systems, warnings: t.warnings }
    };
    const res = await rpc(fetchImpl, env, "catalog_apply_snapshot", rpcBody);
    if (!res.ok) {
      const err = await res.text();
      await rpc(fetchImpl, env, "catalog_record_failed_run", { p: { ...meta, source_hash: sourceHash, warnings: t.warnings, error: err } }).catch(() => {
      });
      return json(502, { status: "failed", error: "\u5BEB\u5165\u8CC7\u6599\u5EAB\u5931\u6557\uFF0C\u65E2\u6709\u8CC7\u6599\u672A\u8B8A\u66F4", detail: err.slice(0, 500) });
    }
    const result = await res.json();
    const review = t.products.filter((p) => p.data_quality === "needs_review" || p.data_quality === "invalid").map((p) => ({ row: p.source_row, model: p.model_code, quality: p.data_quality, issues: p.parse_issues.map((i) => i.line ? `${i.message}\uFF1A${i.line}` : i.message) }));
    return json(200, { ...result, warnings: t.warnings, skipped_rows: t.skippedRows, review });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof ForbiddenColumnError || e instanceof BadRequest || e instanceof SyntaxError) {
      if (meta.request_id) await rpc(fetchImpl, env, "catalog_record_failed_run", { p: { ...meta, error: msg } }).catch(() => {
      });
      return json(400, { status: "failed", error: msg });
    }
    if (meta.request_id) await rpc(fetchImpl, env, "catalog_record_failed_run", { p: { ...meta, error: msg } }).catch(() => {
    });
    return json(500, { status: "failed", error: "\u540C\u6B65\u5931\u6557\uFF0C\u65E2\u6709\u8CC7\u6599\u672A\u8B8A\u66F4", detail: msg.slice(0, 500) });
  }
}
function rpc(fetchImpl, env, fn, body) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, "content-type": "application/json" };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  return fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
}

// supabase/functions/product-sync/index.ts
Deno.serve(
  (req) => handle(req, {
    PRODUCT_SYNC_SECRET: Deno.env.get("PRODUCT_SYNC_SECRET"),
    SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  })
);
