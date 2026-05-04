import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const CARDS_PATH = path.join(DATA_DIR, "cards.json");
const DEFAULT_CARDS_PATH = path.join(DATA_DIR, "defaultCards.json");
const SEARCH_LOG_PATH = path.join(DATA_DIR, "searchLog.json");
const TTS_CACHE_DIR = path.join(DATA_DIR, "tts");

const PORT = Number(process.env.API_PORT, 10) || 8787;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || "tts-1";
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || "nova";

const MAX_JSON_BODY = 96 * 1024;
const TTS_INPUT_MAX = 4096;

/**
 * 디스크 캐시 파일명으로 쓸 수 있는 카드 id (UUID 또는 default-seed-01 등 안전한 문자열)
 * 경로 이탈·확장자 조작 방지
 */
function ttsCacheFileBase(cardId) {
  const id = String(cardId ?? "").trim();
  if (!id) return null;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    return id;
  }
  if (/^[a-zA-Z0-9_-]{1,96}$/.test(id)) {
    return id;
  }
  return null;
}

async function readCachedTtsMp3(cardId) {
  const base = ttsCacheFileBase(cardId);
  if (!base) return null;
  const filePath = path.join(TTS_CACHE_DIR, `${base}.mp3`);
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile() || st.size < 32) return null;
    return fs.readFile(filePath);
  } catch {
    return null;
  }
}

async function writeCachedTtsMp3(cardId, buf) {
  const base = ttsCacheFileBase(cardId);
  if (!base || !Buffer.isBuffer(buf) || buf.length < 32) return;
  await fs.mkdir(TTS_CACHE_DIR, { recursive: true });
  const filePath = path.join(TTS_CACHE_DIR, `${base}.mp3`);
  await fs.writeFile(filePath, buf);
}

const WIKI_API = "https://ko.wikipedia.org/w/api.php";
const WIKI_UA =
  "KoreanQuoteCard/1.0 (educational; https://github.com/) — ko.wikipedia.org image lookup";

const SYSTEM = `You output a single JSON object only, no markdown.
Requirements:
- The quoted person must be **born in Korea** (South or North Korea, or historically Joseon/Korean peninsula). Choose a real, widely recognized figure when possible.
- **Do not default** to the same few famous names across generations. Actively **vary era and field** (literature, science, art, religion, sports, business, politics, etc.). **Do NOT** pick 이순신, 세종대왕, or 김구 unless the user's theme line explicitly names that person or role.
- Provide a famous or well-attributed quote in **Korean** (quoteKo) and a natural **English translation** (quoteEn).
- personNameKo: Korean name as commonly shown in Korea.
- achievementsKo: one short Korean line on their main achievements or role.
- birthYear / deathYear: integers; use negative years for BCE; use null if unknown; if still living, set deathYear to null.
- usageKo: one short Korean sentence — context where/how this quote is known.
- imagePromptEn: ONE concise English phrase (max ~220 characters) for an **atmospheric background image**: mood, light, landscape or abstract scene that **reflects the quote's tone and context**. No text, no letters, no logos, no recognizable living person's face. Cinematic, subtle, suitable as a soft blurred hero background.
- moodHue: integer 0–360 only, a single hue angle suggesting the overall mood (for loading placeholder gradient), must match the quote atmosphere.`;

const THEME_POOL = [
  "삼국·통일신라·발해 쪽 인물(군사 말고도 가능)",
  "고려: 학문·불교·과학·외교",
  "조선 전기: 성리학·문학·과학기술",
  "조선 후기: 실학·개화·저항·여성 인물",
  "일제강점기: 문학·언론·독립운동(너무 흔한 한 명만 반복 금지)",
  "현대 한국: 과학·공학·의학",
  "현대 한국: 문학·영화·음악·미술",
  "현대 한국: 스포츠",
  "현대 한국: 기업·경제·사회운동",
  "한국계 종교·철학·교육 인물",
];

function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function readRequestBody(req, maxBytes = MAX_JSON_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function wikiFetch(params) {
  const u = new URL(WIKI_API);
  Object.entries(params).forEach(([k, v]) => {
    u.searchParams.set(k, String(v));
  });
  const r = await fetch(u.toString(), {
    headers: {
      "User-Agent": WIKI_UA,
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`wiki ${r.status}`);
  return r.json();
}

async function wikiSearchTitles(query, limit) {
  if (!query || !String(query).trim()) return [];
  const j = await wikiFetch({
    action: "query",
    list: "search",
    format: "json",
    srsearch: String(query).trim().slice(0, 100),
    srlimit: String(limit),
  });
  const list = j?.query?.search;
  if (!Array.isArray(list)) return [];
  return list.map((x) => x.title).filter(Boolean);
}

function wikiPageUrlFromTitle(title) {
  const seg = encodeURIComponent(title.replace(/ /g, "_"));
  return `https://ko.wikipedia.org/wiki/${seg}`;
}

async function wikiTitleToThumbnail(title) {
  const j = await wikiFetch({
    action: "query",
    format: "json",
    titles: title,
    prop: "pageimages|info",
    piprop: "thumbnail",
    pithumbsize: "900",
    inprop: "url",
  });
  const pages = j?.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || page.missing) return null;
  const imageUrl = page.thumbnail?.source;
  const pageUrl =
    page.fullurl ||
    page.canonicalurl ||
    wikiPageUrlFromTitle(title);
  if (!imageUrl) return null;
  let fixed = String(imageUrl).trim();
  if (fixed.startsWith("//")) fixed = `https:${fixed}`;
  else if (fixed.startsWith("http://")) fixed = `https://${fixed.slice("http://".length)}`;
  return { imageUrl: fixed, pageUrl };
}

/**
 * @returns {{ outcome: { heroImageUrl: string, heroImageSource: string, heroImagePageUrl: string } | null, lookupLog: { queries: string[], steps: { query: string, titles: string[] }[] } }}
 */
async function resolveWikipediaHeroImage(parsed) {
  const lookupLog = { queries: [], steps: [] };
  const name = (parsed.personNameKo || "").trim();
  const quoteSnippet = (parsed.quoteKo || "").trim().slice(0, 40);
  const queries = [];
  if (name) queries.push(name);
  if (quoteSnippet) queries.push(quoteSnippet);

  for (const q of queries) {
    lookupLog.queries.push(q);
    const titles = await wikiSearchTitles(q, 5);
    lookupLog.steps.push({ query: q, titles: titles.slice() });
    for (const title of titles) {
      try {
        const row = await wikiTitleToThumbnail(title);
        if (row?.imageUrl) {
          return {
            outcome: {
              heroImageUrl: row.imageUrl,
              heroImageSource: "wikipedia",
              heroImagePageUrl: row.pageUrl,
            },
            lookupLog,
          };
        }
      } catch {
        /* try next title */
      }
    }
  }
  return { outcome: null, lookupLog };
}

function pickQuoteUserPrompt() {
  const theme = THEME_POOL[Math.floor(Math.random() * THEME_POOL.length)];
  const salt = Math.floor(Math.random() * 1_000_000);
  return [
    "Generate one new quote card JSON.",
    `This request id: ${salt} — obey the theme below; do not reuse the same person as your previous reply in this session.`,
    `**Theme (required):** ${theme}`,
    "Pick someone whose fame mainly matches the theme. Avoid 이순신 / 세종대왕 / 김구 unless the theme explicitly names them.",
  ].join("\n");
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readCardsFromDisk() {
  try {
    const raw = await fs.readFile(CARDS_PATH, "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j.cards) ? j.cards : [];
  } catch {
    return [];
  }
}

async function appendCardToDisk(card) {
  await ensureDataDir();
  const cards = await readCardsFromDisk();
  cards.push(card);
  await fs.writeFile(CARDS_PATH, JSON.stringify({ cards }, null, 2), "utf8");
}

async function readDefaultCardsFromDisk() {
  try {
    const raw = await fs.readFile(DEFAULT_CARDS_PATH, "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j.cards) ? j.cards : [];
  } catch (e) {
    console.error("[defaultCards.json]", e.message || e);
    return [];
  }
}

const SEARCH_LOG_MAX = 800;

async function appendSearchLog(entry) {
  await ensureDataDir();
  let entries = [];
  try {
    const raw = await fs.readFile(SEARCH_LOG_PATH, "utf8");
    const j = JSON.parse(raw);
    entries = Array.isArray(j.entries) ? j.entries : [];
  } catch {
    /* no file yet */
  }
  entries.push(entry);
  if (entries.length > SEARCH_LOG_MAX) {
    entries = entries.slice(-SEARCH_LOG_MAX);
  }
  await fs.writeFile(
    SEARCH_LOG_PATH,
    JSON.stringify({ entries }, null, 2),
    "utf8",
  );
}

async function callOpenAI() {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.92,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: pickQuoteUserPrompt(),
        },
      ],
    }),
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(text || r.statusText);
    err.status = r.status;
    throw err;
  }
  const data = JSON.parse(text);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty model response");
  return JSON.parse(content);
}

function apiPathname(req) {
  try {
    return new URL(req.url || "/", "http://127.0.0.1").pathname;
  } catch {
    return req.url || "/";
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = apiPathname(req);

  if (req.method === "OPTIONS" && req.url.startsWith("/api")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/api/cards") {
    try {
      let cards = await readCardsFromDisk();
      if (cards.length === 0) {
        cards = await readDefaultCardsFromDisk();
      }
      const sorted = cards
        .slice()
        .sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );
      sendJson(res, 200, { ok: true, cards: sorted });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message || "Failed to read cards" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/tts") {
    let rawText;
    try {
      rawText = await readRequestBody(req);
    } catch (e) {
      sendJson(res, 413, { ok: false, error: e.message || "Body too large" });
      return;
    }
    let body;
    try {
      body = JSON.parse(rawText || "{}");
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      return;
    }
    const cardId =
      body.cardId != null && String(body.cardId).trim()
        ? String(body.cardId).trim()
        : "";
    const text = String(body.text ?? "").trim();
    const input = text.slice(0, TTS_INPUT_MAX);

    if (ttsCacheFileBase(cardId)) {
      const cached = await readCachedTtsMp3(cardId);
      if (cached) {
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": cached.length,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "private, max-age=604800",
          "X-TTS-Source": "cache",
        });
        res.end(cached);
        return;
      }
    }

    if (!input) {
      sendJson(res, 400, { ok: false, error: "text is required" });
      return;
    }
    if (!OPENAI_API_KEY) {
      sendJson(res, 500, { ok: false, error: "OPENAI_API_KEY is not set in .env" });
      return;
    }
    try {
      const r = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENAI_TTS_MODEL,
          voice: OPENAI_TTS_VOICE,
          input,
          response_format: "mp3",
        }),
      });
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok) {
        const msg = buf.length ? buf.toString("utf8").slice(0, 2000) : r.statusText;
        sendJson(res, r.status >= 400 && r.status < 600 ? r.status : 500, {
          ok: false,
          error: msg || "OpenAI speech request failed",
        });
        return;
      }
      if (ttsCacheFileBase(cardId)) {
        try {
          await writeCachedTtsMp3(cardId, buf);
        } catch (e) {
          console.error("[tts cache write]", e.message || e);
        }
      }
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": buf.length,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "private, max-age=86400",
        "X-TTS-Source": ttsCacheFileBase(cardId) ? "openai-cached-next" : "openai",
      });
      res.end(buf);
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        error: e.message || "TTS request failed",
      });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/quote") {
    if (!OPENAI_API_KEY) {
      sendJson(res, 500, { ok: false, error: "OPENAI_API_KEY is not set in .env" });
      return;
    }
    try {
      const data = await callOpenAI();
      let lookupLog = { queries: [], steps: [] };
      try {
        const resolved = await resolveWikipediaHeroImage(data);
        lookupLog = resolved.lookupLog || lookupLog;
        if (resolved.outcome?.heroImageUrl) {
          Object.assign(data, resolved.outcome);
        } else {
          data.heroImageSource = "pollinations";
        }
      } catch (e) {
        console.error("[wiki image]", e);
        data.heroImageSource = "pollinations";
        lookupLog.error = e.message || String(e);
      }
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const card = { id, createdAt, ...data };
      try {
        await appendCardToDisk(card);
      } catch (e) {
        console.error("[cards save]", e);
        sendJson(res, 500, {
          ok: false,
          error: e.message || "Failed to save card",
        });
        return;
      }
      try {
        await appendSearchLog({
          at: createdAt,
          cardId: id,
          personNameKo: card.personNameKo,
          quoteKoPreview: String(card.quoteKo || "").slice(0, 160),
          imageSource: card.heroImageSource || "pollinations",
          heroImageUrl: card.heroImageUrl || null,
          heroImagePageUrl: card.heroImagePageUrl || null,
          wikiLookup: lookupLog,
        });
      } catch (e) {
        console.error("[searchLog]", e);
      }
      sendJson(res, 200, { ok: true, card });
    } catch (e) {
      const st = typeof e.status === "number" ? e.status : 0;
      sendJson(res, st >= 400 && st < 600 ? st : 500, {
        ok: false,
        error: e.message || "OpenAI request failed",
      });
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(
    `[api] http://127.0.0.1:${PORT}  GET /api/cards  POST /api/quote  POST /api/tts`,
  );
});
