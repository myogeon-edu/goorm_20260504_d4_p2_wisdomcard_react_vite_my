import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./App.css";

function toYear(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatYearKo(y) {
  if (y === null) return null;
  if (y < 0) return `기원전 ${Math.abs(y)}년`;
  return `${y}년`;
}

function formatLifeSpan(birthYear, deathYear) {
  const b = toYear(birthYear);
  const d = toYear(deathYear);
  const bStr = formatYearKo(b);
  const dStr = formatYearKo(d);
  if (b === null && d === null) return "생몰년 미상";
  if (b !== null && d !== null) return `${bStr} ~ ${dStr}`;
  if (b !== null && d === null) return `${bStr} ~ 현재`;
  if (b === null && d !== null) return `출생 미상 ~ ${dStr}`;
  return "생몰년 미상";
}

function buildPollinationsUrl(imagePromptEn) {
  const base =
    typeof imagePromptEn === "string" && imagePromptEn.trim()
      ? imagePromptEn.trim().slice(0, 280)
      : "soft warm Korean landscape at golden hour, gentle mist, calm mood, no text";
  const q = encodeURIComponent(base);
  return `https://image.pollinations.ai/prompt/${q}?width=960&height=540&nologo=true`;
}

function formatPlaybackTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatRemainingTime(current, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return "−0:00";
  const left = Math.max(0, duration - current);
  const m = Math.floor(left / 60);
  const s = Math.floor(left % 60);
  return `−${m}:${String(s).padStart(2, "0")}`;
}

function ttsTextFromRecord(record) {
  if (!record?.quoteKo) return "";
  return String(record.quoteKo).trim().slice(0, 4096);
}

function truncateLine(s, max = 52) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function fallbackGradientHue(text) {
  let h = 0;
  const s = String(text || "x");
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * 13) % 360;
  return h;
}

function imageCreditFromData(data) {
  if (!data) {
    return { href: "https://pollinations.ai/", label: "Pollinations" };
  }
  if (data.heroImageSource === "wikipedia" && data.heroImagePageUrl) {
    return { href: data.heroImagePageUrl, label: "위키백과" };
  }
  if (data.heroImageSource === "preset" && data.heroImagePageUrl) {
    return { href: data.heroImagePageUrl, label: "Picsum" };
  }
  return { href: "https://pollinations.ai/", label: "Pollinations" };
}

function primaryBgUrlForRecord(record) {
  if (!record) return "";
  if (typeof record.heroImageUrl === "string" && record.heroImageUrl.trim()) {
    return record.heroImageUrl.trim();
  }
  return buildPollinationsUrl(record.imagePromptEn);
}

function cardKey(record) {
  if (!record?.id) return "";
  return String(record.id);
}

function QuoteCardSlide({
  record,
  isCenter,
  loadingCenter,
  empty,
  onPlayTts,
  ttsBusy,
}) {
  const data = record;
  const [wikiImageFallback, setWikiImageFallback] = useState(false);
  const [heroImgVisible, setHeroImgVisible] = useState(false);

  const primaryBgUrl = useMemo(
    () => primaryBgUrlForRecord(data),
    [data],
  );

  const displayBgUrl = useMemo(() => {
    if (!data) return "";
    if (wikiImageFallback) return buildPollinationsUrl(data.imagePromptEn);
    return primaryBgUrl;
  }, [data, primaryBgUrl, wikiImageFallback]);

  const imageCredit = useMemo(() => {
    if (wikiImageFallback) {
      return { href: "https://pollinations.ai/", label: "Pollinations" };
    }
    return imageCreditFromData(data);
  }, [data, wikiImageFallback]);

  const hue = useMemo(() => {
    const mh = data?.moodHue;
    if (typeof mh === "number" && mh >= 0 && mh <= 360) return mh;
    return fallbackGradientHue(data?.quoteKo);
  }, [data]);

  useEffect(() => {
    setWikiImageFallback(false);
  }, [cardKey(data)]);

  useEffect(() => {
    setHeroImgVisible(false);
  }, [displayBgUrl]);

  const heroHueStyle =
    data && !heroImgVisible
      ? {
          background: `linear-gradient(145deg, hsl(${hue}, 42%, 92%) 0%, hsl(${(hue + 35) % 360}, 35%, 86%) 100%)`,
        }
      : !data
        ? { background: "linear-gradient(180deg, #f5f0e8 0%, #ebe6df 100%)" }
        : undefined;

  const handleHeroImgError = useCallback(() => {
    setWikiImageFallback((prevFb) => {
      if (prevFb) return prevFb;
      const hadWiki =
        data &&
        typeof data.heroImageUrl === "string" &&
        data.heroImageUrl.trim();
      return hadWiki ? true : prevFb;
    });
  }, [data]);

  const bodyBgStyle = useMemo(() => {
    if (!displayBgUrl) {
      return {
        "--quote-bg-image": "none",
        "--quote-bg-opacity": "0",
      };
    }
    return {
      "--quote-bg-image": `url(${JSON.stringify(displayBgUrl)})`,
      "--quote-bg-opacity": "0.48",
    };
  }, [displayBgUrl]);

  const shellClass =
    `card-shell${isCenter && loadingCenter ? " card-shell--busy" : ""}${empty ? " card-shell--empty" : ""}`;

  return (
    <article className={shellClass}>
      <div className="card-hero" style={heroHueStyle}>
        {data && displayBgUrl ? (
          <>
            <div
              className="card-hero-placeholder"
              aria-hidden={heroImgVisible}
            />
            <img
              className={
                heroImgVisible
                  ? "card-hero-img card-hero-img--visible"
                  : "card-hero-img"
              }
              src={displayBgUrl}
              alt=""
              width={415}
              height={600}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setHeroImgVisible(true)}
              onError={handleHeroImgError}
            />
            {heroImgVisible ? (
              <a
                className="card-hero-source"
                href={imageCredit.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {imageCredit.label}
              </a>
            ) : null}
          </>
        ) : (
          <div className="card-hero-placeholder card-hero-placeholder--empty" />
        )}
      </div>

      <div
        className={`card-body ${!data ? "" : displayBgUrl ? "card-body--bg" : ""} ${loadingCenter && data ? "skeleton" : ""}`}
        style={bodyBgStyle}
      >
        <div className="card-body-content">
          {data ? (
            <>
              <p className="quote-ko">{data.quoteKo}</p>
              {isCenter && onPlayTts ? (
                <div className="card-tts-row">
                  <button
                    type="button"
                    className="card-tts-btn"
                    onClick={onPlayTts}
                    disabled={Boolean(ttsBusy) || Boolean(loadingCenter)}
                    aria-busy={ttsBusy ? "true" : "false"}
                  >
                    {ttsBusy ? "음성 준비 중…" : "명언 듣기 · 음성 재생"}
                  </button>
                </div>
              ) : null}
              <div className="divider" />
              <p className="quote-en">{data.quoteEn}</p>
              <div className="divider" />
              <p className="name-row">
                <span className="name">
                  {(data.personNameKo || "—").trim()}
                </span>
                <span className="lifespan">
                  ({formatLifeSpan(data.birthYear, data.deathYear)})
                </span>
              </p>
              <p className="achievements">{data.achievementsKo || "—"}</p>
              <div className="divider" />
              <p className="context">{data.usageKo || "—"}</p>
            </>
          ) : (
            <>
              <p className="quote-ko">
                {loadingCenter
                  ? "명언을 준비하고 있어요…"
                  : "버튼을 눌러 카드를 만들어 보세요."}
              </p>
              <div className="divider" />
              <p className="quote-en">
                Press the button to generate a quote card via GPT.
              </p>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export default function App() {
  const [cards, setCards] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState("");
  const viewportRef = useRef(null);
  const [layout, setLayout] = useState({ vw: 0, slide: 0 });
  const dragRef = useRef({ active: false, startX: 0 });
  const audioRef = useRef(null);
  const ttsUrlRef = useRef(null);
  const ttsGenRef = useRef(0);
  const [audioPhase, setAudioPhase] = useState("idle");
  const [audioError, setAudioError] = useState("");
  const [nowPlaying, setNowPlaying] = useState(null);
  const [ttsBusyId, setTtsBusyId] = useState(null);
  const [playhead, setPlayhead] = useState({ cur: 0, dur: 0 });

  const slides = useMemo(() => {
    if (cards.length === 0) {
      return [{ type: "placeholder", key: "placeholder" }];
    }
    return cards.map((c) => ({ type: "card", key: c.id, record: c }));
  }, [cards]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cards");
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          throw new Error(json.error || res.statusText || "목록 불러오기 실패");
        }
        if (!cancelled) {
          const list = Array.isArray(json.cards) ? json.cards : [];
          setCards(list);
          setActiveIndex(0);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const measure = () => {
      const slide = vp.querySelector(".carousel-slide");
      setLayout({
        vw: vp.clientWidth,
        slide: slide ? slide.getBoundingClientRect().width : 0,
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    measure();
    return () => ro.disconnect();
  }, [slides.length]);

  useEffect(() => {
    setActiveIndex((i) => {
      const max = Math.max(0, cards.length - 1);
      if (cards.length === 0) return 0;
      return Math.min(Math.max(0, i), max);
    });
  }, [cards.length]);

  const trackTx =
    layout.slide > 0 && layout.vw > 0
      ? layout.vw / 2 - layout.slide / 2 - activeIndex * layout.slide
      : 0;

  const goPrev = useCallback(() => {
    setActiveIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setActiveIndex((i) => Math.min(Math.max(0, cards.length - 1), i + 1));
  }, [cards.length]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    const t = e.target;
    if (t instanceof Element && t.closest(".carousel-nav")) {
      return;
    }
    dragRef.current = { active: true, startX: e.clientX };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerUp = useCallback(
    (e) => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      const dx = e.clientX - dragRef.current.startX;
      const t = 56;
      if (dx < -t) goNext();
      else if (dx > t) goPrev();
    },
    [goNext, goPrev],
  );

  const revokeTtsUrl = useCallback(() => {
    const u = ttsUrlRef.current;
    if (u) {
      URL.revokeObjectURL(u);
      ttsUrlRef.current = null;
    }
  }, []);

  const stopTtsPlayback = useCallback(() => {
    ttsGenRef.current += 1;
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    revokeTtsUrl();
    setAudioPhase("idle");
    setAudioError("");
    setPlayhead({ cur: 0, dur: 0 });
    setNowPlaying(null);
  }, [revokeTtsUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const syncTime = () => {
      setPlayhead({ cur: a.currentTime, dur: a.duration || 0 });
    };
    const onEnded = () => {
      stopTtsPlayback();
    };
    const onPause = () => {
      if (a.ended) return;
      setAudioPhase((ph) => (ph === "playing" ? "paused" : ph));
    };
    const onPlay = () => {
      setAudioPhase("playing");
    };
    a.addEventListener("timeupdate", syncTime);
    a.addEventListener("loadedmetadata", syncTime);
    a.addEventListener("durationchange", syncTime);
    a.addEventListener("ended", onEnded);
    a.addEventListener("pause", onPause);
    a.addEventListener("play", onPlay);
    return () => {
      a.removeEventListener("timeupdate", syncTime);
      a.removeEventListener("loadedmetadata", syncTime);
      a.removeEventListener("durationchange", syncTime);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("play", onPlay);
    };
  }, [stopTtsPlayback]);

  useEffect(() => {
    stopTtsPlayback();
  }, [activeIndex, stopTtsPlayback]);

  useEffect(
    () => () => {
      stopTtsPlayback();
    },
    [stopTtsPlayback],
  );

  const playTts = useCallback(
    async (record) => {
      const text = ttsTextFromRecord(record);
      if (!text) return;
      stopTtsPlayback();
      const myGen = ttsGenRef.current;
      setNowPlaying({
        quoteLine: truncateLine(record.quoteKo, 72),
        author: (record.personNameKo || "").trim() || "한국 인물",
      });
      setAudioPhase("loading");
      setAudioError("");
      setTtsBusyId(record.id);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            cardId: record.id,
          }),
        });
        if (myGen !== ttsGenRef.current) return;
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || res.statusText || "음성 합성 실패");
        }
        const blob = await res.blob();
        if (myGen !== ttsGenRef.current) return;
        if (!blob.size) throw new Error("빈 음성 응답");
        revokeTtsUrl();
        const url = URL.createObjectURL(blob);
        if (myGen !== ttsGenRef.current) {
          URL.revokeObjectURL(url);
          return;
        }
        ttsUrlRef.current = url;
        const a = audioRef.current;
        if (!a) throw new Error("오디오를 초기화할 수 없습니다.");
        a.src = url;
        await a.play();
        if (myGen !== ttsGenRef.current) {
          a.pause();
          a.removeAttribute("src");
          a.load();
          revokeTtsUrl();
        }
      } catch (e) {
        if (myGen !== ttsGenRef.current) return;
        setAudioPhase("error");
        setAudioError(e.message || String(e));
        setNowPlaying(null);
        revokeTtsUrl();
      } finally {
        setTtsBusyId(null);
      }
    },
    [revokeTtsUrl, stopTtsPlayback],
  );

  const seekTts = useCallback((ratio) => {
    const a = audioRef.current;
    if (!a?.src || !Number.isFinite(a.duration) || a.duration <= 0) return;
    const t = Math.min(
      Math.max(0, ratio * a.duration),
      Math.max(0, a.duration - 0.05),
    );
    a.currentTime = t;
    setPlayhead({ cur: t, dur: a.duration });
  }, []);

  const fetchQuote = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || res.statusText || "요청 실패");
      }
      const card = json.card;
      if (!card?.quoteKo || !card?.quoteEn) {
        throw new Error("응답 형식이 올바르지 않습니다.");
      }
      setCards((prev) => {
        const next = [card, ...prev.filter((c) => c.id !== card.id)];
        return next;
      });
      setActiveIndex(0);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const showNav = cards.length > 1;

  const centerRecord = useMemo(() => {
    if (!cards.length) return null;
    const i = Math.min(Math.max(0, activeIndex), cards.length - 1);
    return cards[i] ?? null;
  }, [cards, activeIndex]);

  const canToggleTts = audioPhase === "playing" || audioPhase === "paused";
  const ttsCanStartFromTransport = Boolean(
    centerRecord && ttsTextFromRecord(centerRecord),
  );
  const transportBtnDisabled =
    audioPhase === "loading" ||
    (!canToggleTts && !ttsCanStartFromTransport);

  const onTtsTransportClick = useCallback(() => {
    const a = audioRef.current;
    if (audioPhase === "playing") {
      a?.pause();
      return;
    }
    if (audioPhase === "paused" && a?.src) {
      void a.play().catch((err) => {
        setAudioPhase("error");
        setAudioError(err?.message || "재생을 시작할 수 없습니다.");
      });
      return;
    }
    if (audioPhase === "loading") return;
    if (centerRecord && ttsTextFromRecord(centerRecord)) {
      void playTts(centerRecord);
    }
  }, [audioPhase, centerRecord, playTts]);

  const lcdTitle =
    audioPhase === "loading"
      ? "음성 합성 중…"
      : audioPhase === "error"
        ? truncateLine(audioError, 56)
        : nowPlaying?.quoteLine
          ? nowPlaying.quoteLine
          : centerRecord
            ? truncateLine(centerRecord.quoteKo, 56)
            : "명언 음성";

  const lcdSubtitle =
    audioPhase === "error"
      ? "OpenAI 음성 API · 다시 시도해 주세요"
      : nowPlaying?.author
        ? nowPlaying.author
        : centerRecord?.personNameKo?.trim() ||
          "상단 재생 또는 카드의 「명언 듣기」를 눌러 주세요";

  return (
    <div className="app">
      <div className="toolbar">
        <button
          type="button"
          className="btn"
          onClick={fetchQuote}
          disabled={loading || listLoading}
        >
          {loading ? "불러오는 중…" : "새 명언 카드 만들기"}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="tts-player-wrap">
        <audio ref={audioRef} preload="metadata" playsInline />
        <div className="tts-player">
          <div className="tts-transport">
            <button
              type="button"
              className="tts-transport-btn"
              onClick={onTtsTransportClick}
              disabled={transportBtnDisabled}
              aria-label={
                audioPhase === "playing"
                  ? "일시정지"
                  : audioPhase === "paused"
                    ? "이어서 재생"
                    : "명언 음성 재생 (OpenAI TTS)"
              }
            >
              {audioPhase === "playing" ? "❚❚" : "▶"}
            </button>
            <div className="tts-volume-slot" aria-hidden="true" />
          </div>
          <div className="tts-lcd">
            <div className="tts-lcd-screen">
              <p className="tts-lcd-title">{lcdTitle}</p>
              <p className="tts-lcd-sub">{lcdSubtitle}</p>
              <div className="tts-lcd-progress-row">
                <span className="tts-lcd-time">
                  {formatPlaybackTime(playhead.cur)}
                </span>
                <input
                  type="range"
                  className="tts-progress-range"
                  min={0}
                  max={Math.max(playhead.dur, 0.001)}
                  step={0.05}
                  value={Math.min(playhead.cur, playhead.dur || 0)}
                  disabled={!canToggleTts || playhead.dur <= 0}
                  aria-label="재생 위치"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    const d = playhead.dur;
                    if (d > 0) seekTts(v / d);
                  }}
                />
                <span className="tts-lcd-time tts-lcd-time--remain">
                  {formatRemainingTime(playhead.cur, playhead.dur)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="carousel"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="carousel-track"
          style={{
            transform: `translate3d(${trackTx}px, 0, 0)`,
          }}
        >
          {slides.map((s, index) => {
            const isCenter = index === activeIndex;
            const offset = index - activeIndex;
            const dist = Math.abs(offset);
            const rotY =
              offset === 0
                ? 0
                : (offset < 0 ? 1 : -1) *
                  Math.min(56, 38 + Math.min(dist, 4) * 4.5);
            const translateZ = offset === 0 ? 72 : -52 * dist;
            const scale =
              offset === 0 ? 1 : Math.max(0.6, 0.82 - dist * 0.085);
            /* 3D에서 z-index 차이가 너무 작으면 옆 카드가 메인 위로 올라옴 → 메인만 크게 */
            const zIndex = isCenter ? 1000 : Math.max(5, 140 - dist * 45);
            const coverStyle = {
              transform: `translateZ(${translateZ}px) rotateY(${rotY}deg) scale(${scale})`,
              zIndex,
            };
            return (
              <div
                key={s.key}
                className={`carousel-slide${s.type === "placeholder" ? " carousel-slide--placeholder" : ""}`}
              >
                <div
                  className={
                    "carousel-slide-inner cover-flow-inner" +
                    (isCenter ? " cover-flow-inner--center" : "")
                  }
                  style={coverStyle}
                >
                  <QuoteCardSlide
                    record={s.type === "card" ? s.record : null}
                    isCenter={isCenter}
                    loadingCenter={loading && isCenter}
                    empty={s.type === "placeholder"}
                    onPlayTts={
                      isCenter && s.type === "card"
                        ? () => playTts(s.record)
                        : undefined
                    }
                    ttsBusy={
                      s.type === "card" ? ttsBusyId === s.record.id : false
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
        {showNav ? (
          <>
            <button
              type="button"
              className="carousel-nav carousel-nav--prev"
              aria-label="이전 카드"
              onClick={() => goPrev()}
              disabled={activeIndex <= 0}
            >
              ‹
            </button>
            <button
              type="button"
              className="carousel-nav carousel-nav--next"
              aria-label="다음 카드"
              onClick={() => goNext()}
              disabled={activeIndex >= cards.length - 1}
            >
              ›
            </button>
          </>
        ) : null}
      </div>

      {showNav ? (
        <div className="carousel-scrubber">
          <button
            type="button"
            className="carousel-scrub-arrow"
            aria-label="이전 카드"
            onClick={() => goPrev()}
            disabled={activeIndex <= 0}
          >
            ◀
          </button>
          <input
            type="range"
            className="carousel-scrub-range"
            min={0}
            max={cards.length - 1}
            step={1}
            value={activeIndex}
            aria-label="카드 위치"
            onChange={(e) => setActiveIndex(Number(e.target.value))}
          />
          <button
            type="button"
            className="carousel-scrub-arrow"
            aria-label="다음 카드"
            onClick={() => goNext()}
            disabled={activeIndex >= cards.length - 1}
          >
            ▶
          </button>
        </div>
      ) : null}

      {listLoading ? (
        <p className="carousel-hint">저장된 카드를 불러오는 중…</p>
      ) : cards.length > 1 ? (
        <p className="carousel-hint">
          좌우로 드래그하거나 화살표로 다른 명언 카드를 볼 수 있어요.
        </p>
      ) : null}
    </div>
  );
}
