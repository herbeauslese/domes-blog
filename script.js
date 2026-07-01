function escapeHtml(s) {
  return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── LOADING SCREEN ────────────────────────────────────────────────────────────
const loadingScreen = document.getElementById("loading-screen");
const loadingBar    = document.getElementById("loading-bar-inner");

function setLoadingProgress(pct) {
  if (loadingBar) loadingBar.style.width = pct + "%";
}
function hideLoadingScreen() {
  setLoadingProgress(100);
  setTimeout(() => {
    if (!loadingScreen) return;
    loadingScreen.classList.add("fade-out");
    setTimeout(() => { if (loadingScreen) loadingScreen.style.display = "none"; }, 400);
  }, 200);
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let posts   = [];  // from posts.json  (type: text | photo | album)
let albums  = [];  // from albums.json (legacy, injected as album-posts)
let bilderDesMonats = { month: "", photos: [] };
let top100  = [];  // from top100.json
let allPosts = []; // merged + sorted feed

let sortDir    = 1; // 1 = oldest first, -1 = newest first
let filterType = "all";
let searchQ    = "";

// Passwörter kommen aus config.js
const PW_HASH_SHA256    = CONFIG.PW_HASH;
const ADMIN_HASH_SHA256 = CONFIG.ADMIN_HASH;

let siteUnlocked = sessionStorage.getItem("lz_site_ok") === "1"; // Besucher
let unlocked     = sessionStorage.getItem("lz_admin_ok") === "1"; // Admin

// ── INIT ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!siteUnlocked) {
    hideLoadingScreen();
    document.getElementById("pw-overlay").style.display = "flex";
    setTimeout(() => document.getElementById("pw-input").focus(), 100);
    return;
  }
  await loadData();
})();

async function loadData() {
  setLoadingProgress(10);
  try { posts  = await (await fetch("posts.json?_="  + Date.now())).json(); } catch(e) { posts  = []; }
  setLoadingProgress(40);
  try { albums = await (await fetch("albums.json?_=" + Date.now())).json(); } catch(e) { albums = []; }
  try { bilderDesMonats = await (await fetch("bilder_des_monats.json?_=" + Date.now())).json(); } catch(e) { bilderDesMonats = { month: "", photos: [] }; }
  try { top100 = await (await fetch("top100.json?_=" + Date.now())).json(); } catch(e) { top100 = []; }
  setLoadingProgress(70);
  try {
    const h = await (await fetch("hidden.json?_=" + Date.now())).json();
    hiddenPosts = new Set(Array.isArray(h) ? h : []);
  } catch(e) { hiddenPosts = new Set(); }
  setLoadingProgress(90);
  mergePosts();
  applyDark();
  renderFeaturedReise();
  renderBilderDesMonats();
  render();
  hideLoadingScreen();
  // nach dem Laden: Hash-Anker scrollen + highlighten
  handleHashOnLoad();
}

function handleHashOnLoad() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  setTimeout(() => {
    const el = document.getElementById(hash);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("post-highlight");
    setTimeout(() => el.classList.remove("post-highlight"), 2000);
  }, 300);
}

// ── MERGE posts + albums into one feed ───────────────────────────────────────
function mergePosts() {
  // albums.json entries become type:"album" posts
  const albumPosts = albums.map(a => ({
    type: "album",
    _albumData: a,
    title: a.album,
    posted_at: a.reviewed_at || "2020-01-01T00:00:00.000Z"
  }));
  allPosts = [...posts, ...albumPosts].sort((a, b) => {
    const da = new Date(a.posted_at).getTime();
    const db = new Date(b.posted_at).getTime();
    return sortDir * (db - da);
  });
}

// ── RENDER ───────────────────────────────────────────────────────────────────
function stablePid(p) {
  // stable key: type + title + posted_at — survives re-renders and re-sorts
  return "post-" + safeid((p.type||"") + (p.title||"") + (p.posted_at||"")).slice(0, 40);
}

function render() {
  const q = searchQ.toLowerCase();

  let filtered = allPosts.filter(p => {
    if (p.draft && !unlocked) return false;
    if (filterType === "text"  && p.type !== "text")  return false;
    if (filterType === "photo" && p.type !== "photo") return false;
    if (filterType === "album" && p.type !== "album") return false;
    if (filterType === "embed" && p.type !== "embed") return false;
    if (filterType === "reise" && !(p.type === "photo" && p.tag === "reise")) return false;
    if (q) {
      const hay = [p.title || "", p.text || ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!showHidden) filtered = filtered.filter(p => !hiddenPosts.has(stablePid(p)));

  buildFlow(filtered);

  // BDM Archiv als Fliesstext-Eintrag (aktueller + vergangene Monate)
  const bdmAllMonths = bilderDesMonats.photos?.length ? [bilderDesMonats] : [];
  if (bdmAllMonths.length > 0 && filterType === "all" && !q) {
    const flow = document.getElementById("feed-flow");
    if (flow) {
      const allPhotos = [];
      const monthsHTML = bdmAllMonths.map(m =>
        `<div class="bdm-archiv-month">` +
        `<span class="bdm-archiv-month-label">${escapeHtml(m.month)}</span>` +
        `<div class="bdm-archiv-thumbs">${(m.photos || []).map(p => {
          const photoIdx = allPhotos.length;
          allPhotos.push(p);
          return `<img class="bdm-archiv-thumb" src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || "")}" data-photo-idx="${photoIdx}">`;
        }).join("")}</div>` +
        `</div>`
      ).join("");
      const archivEl = document.createElement("article");
      archivEl.className = "flow-post flow-post--bdm-archiv";
      archivEl.id = "flow-bdm-archiv";
      archivEl.innerHTML = `<h2 class="flow-title">📁 Bilder des Monats — Archiv</h2>` + monthsHTML;
      archivEl.querySelectorAll(".bdm-archiv-thumb").forEach(img => {
        const photo = allPhotos[parseInt(img.dataset.photoIdx)];
        if (photo) img.addEventListener("click", () => openBdmPhoto(photo));
      });
      flow.appendChild(archivEl);
    }
  }

  // Top 100 als Fliesstext-Eintrag am Ende
  if (top100.length > 0 && (filterType === "all") && !q) {
    const flow = document.getElementById("feed-flow");
    if (flow) {
      const t100 = document.createElement("article");
      t100.className = "flow-post flow-post--top100";
      t100.id = "flow-top100";
      t100.innerHTML =
        `<h2 class="flow-title">🎵 Meine Top 100 Songs</h2>` +
        `<ol class="flow-top100-list">${top100.map((s, i) =>
          `<li>` +
          `<span class="flow-top100-rank">${i + 1}.</span>` +
          `${s.cover ? `<img class="flow-top100-cover" src="${escapeHtml(s.cover)}" alt="" loading="lazy">` : ''}` +
          `<span class="flow-top100-info"><em>${escapeHtml(s.artist)}</em> — ${escapeHtml(s.title)}</span>` +
          `</li>`
        ).join("")}</ol>`;
      flow.appendChild(t100);
    }
  }

  filtered.forEach(p => {
    if (p.type === "photo" && p.images && p.images.length > 0) {
      initSlideshowRatio(stablePid(p) + "-f", p.images[0]);
    }
  });

  requestAnimationFrame(applyHiddenUI);
  buildSidebarToc(filtered);
}

function buildSidebarToc(filtered) {
  const list = document.getElementById("sidebar-toc-list");
  if (!list) return;
  const nonAlbum = filtered.filter(p => p.type !== "album");
  list.innerHTML = nonAlbum.map(p => {
    const fpid = stablePid(p) + "-f";
    const label = p.title || "(ohne titel)";
    const emoji = postEmoji(p);
    return `<button class="sidebar-toc-item" onclick="document.getElementById('${fpid}')?.scrollIntoView({behavior:'smooth',block:'start'});if(document.getElementById('sidebar')?.classList.contains('open'))toggleSidebar()">${emoji ? emoji + " " : ""}${escapeHtml(label)}</button>`;
  }).join("");
}

function safeid(s) { return s.replace(/[^a-zA-Z0-9]/g, ""); }

function postEmoji(p) {
  if (p.type === "photo" && p.tag === "reise") return "🌍";
  if (p.type === "photo") return "📷";
  if (p.type === "text") return "📝";
  if (p.type === "embed") return "🎬";
  if (p.type === "album") return "💿";
  return "";
}

// ── FLIESSTEXT-FEED ───────────────────────────────────────────────────────────
let albumSortMode = "rating";

function setAlbumSort(mode) {
  albumSortMode = mode;
  document.querySelectorAll(".album-sort-pill").forEach(b => b.classList.toggle("active", b.dataset.sort === mode));
  const carousel = document.getElementById("album-carousel");
  if (!carousel) return;
  const slides = [...carousel.querySelectorAll(".album-slide")];
  const sortFns = {
    rating: (a, b) => Number(b.dataset.rating) - Number(a.dataset.rating),
    az:     (a, b) => a.dataset.artist.localeCompare(b.dataset.artist),
    year:   (a, b) => Number(b.dataset.year || 0) - Number(a.dataset.year || 0),
  };
  const sorted = [...slides].sort(sortFns[mode] || sortFns.rating);
  const cur = parseInt(carousel.dataset.current || 0);
  const activeFpid = slides[cur].dataset.fpid;
  sorted.forEach(s => { s.classList.remove("active"); carousel.appendChild(s); });
  const newCur = sorted.findIndex(s => s.dataset.fpid === activeFpid);
  const newIdx = newCur >= 0 ? newCur : 0;
  sorted[newIdx].classList.add("active");
  carousel.dataset.current = newIdx;
  const counter = document.getElementById("album-carousel-counter");
  if (counter) counter.textContent = (newIdx + 1) + " / " + sorted.length;
  renderAlbumIndex();
}

function jumpToAlbumSlide(idx) {
  const carousel = document.getElementById("album-carousel");
  if (!carousel) return;
  const slides = carousel.querySelectorAll(".album-slide");
  const cur = parseInt(carousel.dataset.current || 0);
  if (slides[cur]) slides[cur].classList.remove("active");
  if (slides[idx]) slides[idx].classList.add("active");
  carousel.dataset.current = idx;
  const counter = document.getElementById("album-carousel-counter");
  if (counter) counter.textContent = (idx + 1) + " / " + slides.length;
  renderAlbumIndex();
}

function renderAlbumIndex() {
  const el = document.getElementById("album-index");
  const carousel = document.getElementById("album-carousel");
  if (!el || !carousel) return;
  const slides = [...carousel.querySelectorAll(".album-slide")];
  const cur = parseInt(carousel.dataset.current || 0);
  el.innerHTML = slides.map((s, i) =>
    `<button class="album-index-item${i === cur ? " active" : ""}" onclick="jumpToAlbumSlide(${i})">` +
    `<span class="album-index-rating">${s.dataset.rating || "—"}</span>` +
    `<span class="album-index-name">${escapeHtml(s.dataset.artist || "")} — ${escapeHtml(s.dataset.album || "")}` +
    (s.dataset.year ? ` <span class="album-index-year">(${s.dataset.year})</span>` : "") +
    `</span></button>`
  ).join("");
}

function buildFlow(filtered) {
  const flow = document.getElementById("feed-flow");
  if (!flow) return;
  flow.innerHTML = "";

  // Alben als einzelnen Karussell-Beitrag ganz oben
  const albums = filtered.filter(p => p.type === "album");
  if (albums.length > 0) {
    const slidesHTML = albums.map((p, i) => {
      const a = p._albumData || {};
      const pid = stablePid(p);
      const fpid = pid + "-f";
      const ratingNum = Number(a.rating) || 0;
      const starsFull = Math.round(ratingNum / 2);
      const starStr = "★".repeat(starsFull) + "☆".repeat(5 - starsFull);
      const genres = (a.genre || "").split(",").map(g => g.trim()).filter(Boolean).join(" · ");
      const slideDate = p.posted_at
        ? new Date(p.posted_at).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })
        : "";
      const coverHTML = a.cover_url
        ? `<img src="${escapeHtml(a.cover_url)}" alt="" class="flow-album-cover" loading="lazy">`
        : `<div class="flow-album-cover flow-album-cover--empty"></div>`;
      const songsHTML = (a.songs || []).length
        ? `<ol class="flow-album-songs">${(a.songs || []).map(s =>
            `<li${s === a.favorite_song ? ' class="fav"' : ""}>${escapeHtml(s)}</li>`
          ).join("")}</ol>`
        : "";
      const reviewHTML = a.review
        ? `<p class="flow-album-review">${escapeHtml(a.review).replace(/\n/g, "<br>")}</p>`
        : "";
      const cid = safeid(a.artist + a.album);
      const editBtn = unlocked ? `<button class="edit-btn" onclick="openEditAlbum('${cid}', event)">✎</button>` : "";
      const hideBtn = unlocked ? `<button class="hide-btn" onclick="toggleHidePost('${pid}', event)">◌</button>` : "";
      const delBtn  = unlocked ? `<button class="del-btn"  onclick="deleteAlbum('${cid}', event)" title="löschen">✕</button>` : "";
      const adminHTML = unlocked ? `<div class="flow-admin">${editBtn}${hideBtn}${delBtn}</div>` : "";
      return `<div class="album-slide${i === 0 ? " active" : ""}" data-fpid="${fpid}" data-rating="${ratingNum}" data-artist="${escapeHtml(a.artist || "")}" data-album="${escapeHtml(a.album || "")}" data-year="${a.year || ""}">` +
        adminHTML +
        `<div class="flow-album-header">` +
        coverHTML +
        `<div class="flow-album-header-info">` +
        `<h2 class="flow-title">💿 ${escapeHtml(a.artist)} — ${escapeHtml(a.album)}</h2>` +
        `<div class="flow-album-meta">${ratingNum}/10 ${starStr}${genres ? ` · ${genres}` : ""}${a.year ? ` · ${a.year}` : ""}${slideDate ? ` · ${slideDate}` : ""}</div>` +
        `</div></div>` +
        songsHTML + reviewHTML +
        `<div class="post-edit-form" id="edit-form-${fpid}" style="display:none"></div>` +
        `</div>`;
    }).join("");

    const sortPills = `<div class="album-sort-pills">` +
      `<button class="album-sort-pill active" data-sort="rating" onclick="setAlbumSort('rating')">★ Bewertung</button>` +
      `<button class="album-sort-pill" data-sort="az" onclick="setAlbumSort('az')">A–Z</button>` +
      `<button class="album-sort-pill" data-sort="year" onclick="setAlbumSort('year')">Jahr</button>` +
      `</div>`;

    const nav = albums.length > 1
      ? `<div class="retro-slide-nav">` +
        `<button onclick="prevAlbumSlide()">←</button>` +
        `<span id="album-carousel-counter">1 / ${albums.length}</span>` +
        `<button onclick="nextAlbumSlide()">→</button>` +
        `</div>`
      : "";

    const carouselEl = document.createElement("article");
    carouselEl.className = "flow-post flow-post--albums";
    carouselEl.id = "flow-albums-carousel";
    carouselEl.innerHTML =
      sortPills +
      `<div class="album-carousel" id="album-carousel" data-current="0">${slidesHTML}</div>` +
      nav +
      `<div class="album-index" id="album-index"></div>`;
    flow.appendChild(carouselEl);
    renderAlbumIndex();
  }

  // Alle anderen Beiträge
  filtered.filter(p => p.type !== "album").forEach(p => {
    const pid  = stablePid(p);
    const fpid = pid + "-f";

    const flowDate = p.posted_at
      ? new Date(p.posted_at).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
      : "";

    let mediaHTML = "";

    if (p.type === "photo") {
      const imgs = p.images || [];
      const refs = [...(p.text || "").matchAll(/\[Bild(\d+)\]/gi)].map(m => parseInt(m[1]) - 1);
      const seen = new Set();
      const ordered = [];
      for (const r of refs) {
        if (r >= 0 && r < imgs.length && !seen.has(r)) { ordered.push(imgs[r]); seen.add(r); }
      }
      imgs.forEach((img, i) => { if (!seen.has(i)) ordered.push(img); });
      const orderedImgs = ordered.length === imgs.length ? ordered : imgs;

      if (orderedImgs.length > 0) {
        const tracks = orderedImgs.map((url, i) =>
          `<img class="slide-img${i === 0 ? " active" : ""}" src="${url}" alt="" loading="lazy"` +
          ` onload="this.style.objectFit=this.naturalHeight>this.naturalWidth?'contain':'cover'">`
        ).join("");
        const retroNav = orderedImgs.length > 1
          ? `<div class="retro-slide-nav">` +
            `<button onclick="prevSlide('${fpid}')">← zurück</button>` +
            `<span id="${fpid}-counter">1 / ${orderedImgs.length}</span>` +
            `<button onclick="nextSlide('${fpid}')">weiter →</button>` +
            `</div>`
          : "";
        mediaHTML = `<div class="slideshow" id="${fpid}-slides" data-current="0">` +
          `<div class="slide-track" id="${fpid}-track">${tracks}</div>` +
          retroNav +
          `</div>`;
      }
    }

    if (p.type === "embed") {
      const safeEmbed = (p.embed || "")
        .replace(/<(?!\/?(iframe|div)[\s>])/gi, "&lt;")
        .replace(/\bon\w+\s*=/gi, "data-blocked=");
      mediaHTML = `<div class="post-embed">${safeEmbed}</div>`;
    }

    const fullText = parseText(p.text || "", fpid);

    const editBtn = unlocked ? `<button class="edit-btn" onclick="toggleEditPost('${fpid}', event)">✎</button>` : "";
    const hideBtn = unlocked ? `<button class="hide-btn" onclick="toggleHidePost('${pid}', event)">◌</button>` : "";
    const delBtn  = unlocked ? `<button class="del-btn"  onclick="deletePost('${fpid}', event)" title="löschen">✕</button>` : "";
    const adminHTML = unlocked ? `<div class="flow-admin">${editBtn}${hideBtn}${delBtn}</div>` : "";

    const article = document.createElement("article");
    article.className = "flow-post flow-post--" + (p.tag === "reise" ? "reise" : p.type);
    article.id = fpid;
    article.dataset.type  = p.type || "";
    article.dataset.title = p.title || "";
    article.dataset.text  = p.text  || "";
    article.dataset.date  = p.posted_at || "";
    article.dataset.tag   = p.tag   || "";
    if (p.type === "photo") article.dataset.images = JSON.stringify(p.images || []);
    article.innerHTML =
      (flowDate ? `<div class="flow-date">${flowDate}</div>` : "") +
      adminHTML +
      `<h2 class="flow-title">${postEmoji(p) ? postEmoji(p) + " " : ""}${escapeHtml(p.title) || "(ohne titel)"}</h2>` +
      mediaHTML +
      (fullText ? `<div class="flow-text">${fullText}</div>` : "") +
      `<div class="post-edit-form" id="edit-form-${fpid}" style="display:none"></div>`;

    flow.appendChild(article);
  });
}

// ── TEXT PARSER: bold, italic, heading, links, bildverweise ──────────────────
// **fett** → <strong>
// *kursiv* → <em>
// ## Überschrift → <h4>
// [Text](url) → <a href>
// [Bild2] → springt zu Bild 2 in der Slideshow des Posts
function parseText(text, pid) {
  return text
    .split("\n\n").map(para => {
      // ## Überschrift → eigener Block
      if (/^##\s+/.test(para.trim())) {
        const heading = para.trim().replace(/^##\s+/, "");
        return `<h4 class="post-heading">${heading}</h4>`;
      }
      let t = para
        // **fett**
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        // *kursiv* (nicht ** treffen)
        .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
        // [Text](url) — externer Link
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener" class="post-link">$1</a>')
        // [Bild1], [Bild2] etc.
        .replace(/\[Bild(\d+)\]/gi, (_, n) => {
          const idx = parseInt(n) - 1;
          return pid
            ? `<a href="#" class="post-img-ref" onclick="jumpToSlide('${pid}',${idx},event)">Bild ${n}</a>`
            : `Bild ${n}`;
        })
        // Zeilenumbrüche innerhalb Absatz
        .replace(/\n/g, "<br>");
      return `<p>${t}</p>`;
    }).join("");
}

// springt zur Slideshow und aktiviert Bild n
function jumpToSlide(pid, idx, e) {
  e.preventDefault();
  const postEl = document.getElementById(pid);
  // Flow-Posts sind immer sichtbar — kein togglePost nötig
  const isFlow = postEl?.classList.contains("flow-post");
  if (!isFlow && postEl && !postEl.classList.contains("expanded")) togglePost(pid);
  setTimeout(() => {
    goSlide(pid, idx);
    const slides = document.getElementById(pid + "-slides");
    if (slides) slides.scrollIntoView({ behavior: "smooth", block: "center" });
  }, isFlow ? 0 : 100);
}
// ── INLINE EDIT: TEXT + FOTO POSTS ───────────────────────────────────────────
function toggleEditPost(pid, e) {
  if (e) e.stopPropagation();
  const formEl = document.getElementById("edit-form-" + pid);
  if (!formEl) return;
  if (formEl.style.display !== "none") { formEl.style.display = "none"; return; }

  const postEl = document.getElementById(pid);
  const type   = postEl.dataset.type;
  const title  = postEl.dataset.title || "";
  const text   = postEl.dataset.text  || "";
  const date   = postEl.dataset.date  ? postEl.dataset.date.slice(0,10) : "";
  const tag    = postEl.dataset.tag   || "";

  // bestehende Bilder aus dem Post holen
  const existingImages = (() => {
    const idx = posts.findIndex(p =>
      p.title === postEl.dataset.title &&
      p.posted_at === postEl.dataset.date
    );
    return (idx >= 0 && posts[idx].images) ? posts[idx].images : [];
  })();

  const imagesField = type === "photo" ? `
    <div style="margin-bottom:8px">
      <label style="width:80px;font-size:11px;color:#666;vertical-align:top;display:inline-block;padding-top:3px">bilder:</label>
      <div style="display:inline-block;width:calc(100% - 88px);vertical-align:top">
        <div id="ef-img-list-${pid}">
          ${existingImages.length
            ? existingImages.map(url => `<div class="photo-url-row">
                <input type="url" value="${url}" style="flex:1">
                <button onclick="this.parentElement.remove()" style="color:#c00;border-color:#c00">–</button>
              </div>`).join("")
            : `<div class="photo-url-row">
                <input type="url" placeholder="https://...">
                <button onclick="this.parentElement.remove()" style="color:#c00;border-color:#c00">–</button>
              </div>`
          }
        </div>
        <button type="button" onclick="addEfImgRow('${pid}')" style="font-size:11px;margin-top:3px;color:#666;border-color:#999">+ url</button>
      </div>
    </div>` : "";

  const tagField = type === "photo"
    ? `<div style="margin-bottom:5px"><label style="width:80px;font-size:11px;color:#666">typ:</label>
        <select id="ef-tag-${pid}" style="font-family:'Courier New',monospace;font-size:12px;border:1px solid #000;padding:2px 4px">
          <option value="" ${tag===''?'selected':''}>foto</option>
          <option value="reise" ${tag==='reise'?'selected':''}>reise</option>
        </select></div>`
    : "";

  const toolbarHTML = `<div class="editor-toolbar">
    <button type="button" onclick="editorWrap('ef-text-${pid}','**','**')" title="Fett">B</button>
    <button type="button" onclick="editorWrap('ef-text-${pid}','*','*')" title="Kursiv" style="font-style:italic">I</button>
    <button type="button" onclick="editorHeading('ef-text-${pid}')" title="Überschrift">H</button>
    <button type="button" onclick="editorLink('ef-text-${pid}')" title="Link">🔗</button>
    <button type="button" onclick="editorInsert('ef-text-${pid}','[Bild1]')" title="Bildverweis">📷</button>
    <label class="editor-upload-label" title="Bild hochladen + verlinken">
      ↑ bild
      <input type="file" accept="image/*" multiple style="display:none"
        onchange="editUploadImages(this,'${pid}')">
    </label>
    <span id="ef-upload-status-${pid}" style="font-size:10px;color:#888"></span>
    <span class="editor-hint">**fett** · *kursiv* · ## titel · [Text](url) · [Bild2]</span>
  </div>`;

  formEl.style.display = "block";
  formEl.innerHTML = `<div class="edit-form">
    <div style="margin-bottom:5px"><label style="width:80px;font-size:11px;color:#666">titel:</label><input type="text" id="ef-title-${pid}" value="${title.replace(/"/g,'&quot;')}" style="width:calc(100% - 88px)"></div>
    <div style="margin-bottom:5px"><label style="width:80px;font-size:11px;color:#666;vertical-align:top">text:</label>
      <div style="display:inline-block;width:calc(100% - 88px);vertical-align:top">
        ${toolbarHTML}
        <textarea id="ef-text-${pid}" rows="6" style="width:100%">${text}</textarea>
      </div>
    </div>
    ${imagesField}
    ${tagField}
    <div style="margin-bottom:5px"><label style="width:80px;font-size:11px;color:#666">datum:</label><input type="date" id="ef-date-${pid}" value="${date}" style="width:140px"></div>
    <div class="edit-form-btns">
      <button onclick="saveEditPost('${pid}')">speichern</button>
      <button onclick="document.getElementById('edit-form-${pid}').style.display='none'" style="color:#888;border-color:#888">abbrechen</button>
    </div>
    <div id="ef-status-${pid}" style="font-size:11px;margin-top:4px"></div>
  </div>`;
}

function addEfImgRow(pid) {
  const list = document.getElementById("ef-img-list-" + pid);
  if (!list) return;
  const row = document.createElement("div");
  row.className = "photo-url-row";
  row.innerHTML = `<input type="url" placeholder="https://..." style="flex:1"><button onclick="this.parentElement.remove()" style="color:#c00;border-color:#c00">–</button>`;
  list.appendChild(row);
}

async function saveEditPost(pid) {
  const postEl  = document.getElementById(pid);
  const type    = postEl.dataset.type;
  const st      = document.getElementById("ef-status-" + pid);
  const saveBtn = document.querySelector(`#edit-form-${pid} button[onclick*="saveEditPost"]`);
  if (saveBtn?.disabled) return;
  const title   = document.getElementById("ef-title-" + pid).value.trim();
  const text    = document.getElementById("ef-text-"  + pid).value;
  const dateVal = document.getElementById("ef-date-"  + pid).value;
  const tag     = type === "photo" ? (document.getElementById("ef-tag-" + pid)?.value || "") : undefined;

  // bilder aus der liste lesen
  const imgList = document.getElementById("ef-img-list-" + pid);
  const images  = imgList
    ? [...imgList.querySelectorAll("input[type=url]")].map(i => i.value.trim()).filter(Boolean)
    : undefined;

  if (!title) { st.textContent = "fehler: titel fehlt."; return; }
  const posted_at = dateVal ? new Date(dateVal).toISOString() : postEl.dataset.date;

  // find + update in posts array
  const idx = posts.findIndex(p =>
    p.title === postEl.dataset.title &&
    p.posted_at === postEl.dataset.date
  );
  if (idx < 0) { st.textContent = "fehler: beitrag nicht gefunden."; return; }

  const updated = { ...posts[idx], title, text, posted_at };
  if (tag !== undefined) updated.tag = tag;
  if (!updated.tag) delete updated.tag;
  if (images !== undefined) updated.images = images;

  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";
  if (!token || !repo) { st.textContent = "fehler: github einstellungen fehlen."; return; }

  st.textContent = "speichere...";
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "..."; }
  try {
    const shaRes = await fetch(`https://api.github.com/repos/${repo}/contents/posts.json?ref=${branch}`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } });
    if (!shaRes.ok) throw new Error(shaRes.status);
    const { sha } = await shaRes.json();
    const newPosts = [...posts];
    newPosts[idx] = updated;
    const content = btoa([...new TextEncoder().encode(JSON.stringify(newPosts, null, 2))].map(b => String.fromCharCode(b)).join(""));
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/posts.json`, {
      method: "PUT",
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ message: `edit: ${title}`, content, sha, branch })
    });
    if (!putRes.ok) { const err = await putRes.json(); throw new Error(err.message || putRes.status); }
    st.textContent = "✓ gespeichert.";
    posts[idx] = updated;
    mergePosts();
    render();
  } catch(err) {
    st.textContent = "fehler: " + err.message;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "speichern"; }
  }
}

// ── DELETE POST (text / photo / embed) ───────────────────────────────────────
async function deletePost(pid, e) {
  if (e) e.stopPropagation();
  const postEl = document.getElementById(pid);
  if (!postEl) return;
  const title = postEl.dataset.title || "(ohne titel)";
  if (!confirm(`"${title}" wirklich löschen?`)) return;

  const idx = posts.findIndex(p =>
    p.title === postEl.dataset.title &&
    p.posted_at === postEl.dataset.date
  );
  if (idx < 0) { alert("Beitrag nicht gefunden."); return; }

  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";
  if (!token || !repo) { alert("GitHub Einstellungen fehlen."); return; }

  try {
    const shaRes = await fetch(`https://api.github.com/repos/${repo}/contents/posts.json?ref=${branch}`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } });
    if (!shaRes.ok) throw new Error(shaRes.status);
    const { sha } = await shaRes.json();
    const newPosts = posts.filter((_, i) => i !== idx);
    const content = btoa([...new TextEncoder().encode(JSON.stringify(newPosts, null, 2))].map(b => String.fromCharCode(b)).join(""));
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/posts.json`, {
      method: "PUT",
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ message: `delete: ${title}`, content, sha, branch })
    });
    if (!putRes.ok) { const err = await putRes.json(); throw new Error(err.message || putRes.status); }
    posts.splice(idx, 1);
    mergePosts();
    render();
  } catch(err) {
    alert("Fehler beim Löschen: " + err.message);
  }
}

// ── DELETE ALBUM ──────────────────────────────────────────────────────────────
async function deleteAlbum(eid, e) {
  if (e) e.stopPropagation();
  const idx = albums.findIndex(a => safeid(a.artist + a.album) === eid);
  if (idx < 0) return;
  const a = albums[idx];
  if (!confirm(`"${a.album}" von ${a.artist} wirklich löschen?`)) return;

  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";
  if (!token || !repo) { alert("GitHub Einstellungen fehlen."); return; }

  try {
    const shaRes = await fetch(`https://api.github.com/repos/${repo}/contents/albums.json?ref=${branch}`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } });
    if (!shaRes.ok) throw new Error(shaRes.status);
    const { sha } = await shaRes.json();
    const newAlbums = albums.filter((_, i) => i !== idx);
    const content = btoa([...new TextEncoder().encode(JSON.stringify(newAlbums, null, 2))].map(b => String.fromCharCode(b)).join(""));
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/albums.json`, {
      method: "PUT",
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ message: `delete: ${a.artist} - ${a.album}`, content, sha, branch })
    });
    if (!putRes.ok) { const err = await putRes.json(); throw new Error(err.message || putRes.status); }
    albums.splice(idx, 1);
    mergePosts();
    render();
  } catch(err) {
    alert("Fehler beim Löschen: " + err.message);
  }
}

// ── HIDE / SHOW POSTS ─────────────────────────────────────────────────────────
let hiddenPosts = new Set(); // wird in loadData aus hidden.json geladen
let showHidden  = false;

async function saveHidden() {
  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";
  if (!token || !repo) return; // kein push wenn keine gh-einstellungen

  const data = JSON.stringify([...hiddenPosts], null, 2);
  const content = btoa([...new TextEncoder().encode(data)].map(b => String.fromCharCode(b)).join(""));

  // SHA holen (Datei existiert evtl. noch nicht)
  let sha = null;
  try {
    const shaRes = await fetch(`https://api.github.com/repos/${repo}/contents/hidden.json?ref=${branch}`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } });
    if (shaRes.ok) sha = (await shaRes.json()).sha;
  } catch(e) {}

  const body = { message: "hidden: update", content, branch };
  if (sha) body.sha = sha;

  await fetch(`https://api.github.com/repos/${repo}/contents/hidden.json`, {
    method: "PUT",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function toggleHidePost(pid, e) {
  if (e) e.stopPropagation();
  if (hiddenPosts.has(pid)) {
    hiddenPosts.delete(pid);
  } else {
    hiddenPosts.add(pid);
  }
  render(); // sofort UI updaten
  await saveHidden(); // dann zu github pushen
}

function applyHiddenUI() {
  // colour hide-btns after render
  document.querySelectorAll(".hide-btn").forEach(btn => {
    const rawId = (btn.closest(".post, .flow-post"))?.id || "";
    const pid   = rawId.endsWith("-f") ? rawId.slice(0, -2) : rawId;
    if (pid && hiddenPosts.has(pid)) {
      btn.textContent = "●";
      btn.title = "einblenden";
      btn.style.color = "var(--accent)";
    } else {
      btn.textContent = "◌";
      btn.title = "ausblenden";
      btn.style.color = "";
    }
  });
  // show/hide toggle button visibility
  const btn = document.getElementById("btn-show-hidden");
  if (!btn) return;
  if (hiddenPosts.size > 0) {
    btn.style.display = "";
    btn.textContent = showHidden ? `◉ ${hiddenPosts.size}` : `◎ ${hiddenPosts.size}`;
    btn.title = showHidden ? "versteckte ausblenden" : "versteckte anzeigen";
  } else {
    btn.style.display = "none";
  }
}

// ── SLIDESHOW ASPECT RATIO ────────────────────────────────────────────────────
function initSlideshowRatio(pid, firstImgUrl) {
  const track = document.getElementById(pid + "-track");
  if (!track) return;
  const img = new Image();
  img.onload = () => {
    const ratio = img.naturalWidth / img.naturalHeight;
    track.style.aspectRatio = ratio.toFixed(4);
  };
  img.onerror = () => { track.style.aspectRatio = "4/3"; };
  img.src = firstImgUrl;
}
function goSlide(pid, idx) {
  const wrap = document.getElementById(pid + "-slides");
  if (!wrap) return;
  const imgs    = wrap.querySelectorAll(".slide-img");
  const dots    = wrap.querySelectorAll(".slide-dot");
  const counter = document.getElementById(pid + "-counter");
  imgs.forEach((img, i) => img.classList.toggle("active", i === idx));
  dots.forEach((d,   i) => d.classList.toggle("active",   i === idx));
  wrap.dataset.current = idx;
  if (counter) counter.textContent = (idx+1) + " / " + imgs.length;
}
function nextSlide(pid) {
  const wrap = document.getElementById(pid + "-slides");
  if (!wrap) return;
  const imgs = wrap.querySelectorAll(".slide-img");
  const cur  = parseInt(wrap.dataset.current || 0);
  goSlide(pid, (cur + 1) % imgs.length);
}
function prevSlide(pid) {
  const wrap = document.getElementById(pid + "-slides");
  if (!wrap) return;
  const imgs = wrap.querySelectorAll(".slide-img");
  const cur  = parseInt(wrap.dataset.current || 0);
  goSlide(pid, (cur - 1 + imgs.length) % imgs.length);
}

function nextAlbumSlide() {
  const carousel = document.getElementById("album-carousel");
  if (!carousel) return;
  const slides = carousel.querySelectorAll(".album-slide");
  const cur  = parseInt(carousel.dataset.current || 0);
  const next = (cur + 1) % slides.length;
  slides[cur].classList.remove("active");
  slides[next].classList.add("active");
  carousel.dataset.current = next;
  const counter = document.getElementById("album-carousel-counter");
  if (counter) counter.textContent = (next + 1) + " / " + slides.length;
}
function prevAlbumSlide() {
  const carousel = document.getElementById("album-carousel");
  if (!carousel) return;
  const slides = carousel.querySelectorAll(".album-slide");
  const cur  = parseInt(carousel.dataset.current || 0);
  const prev = (cur - 1 + slides.length) % slides.length;
  slides[cur].classList.remove("active");
  slides[prev].classList.add("active");
  carousel.dataset.current = prev;
  const counter = document.getElementById("album-carousel-counter");
  if (counter) counter.textContent = (prev + 1) + " / " + slides.length;
}

// ── ALBUM COVER PIXEL CACHE ───────────────────────────────────────────────────
const CACHE_VERSION = "v2";
const CACHE_PREFIX  = "lz_cover_" + CACHE_VERSION + "_";
if (localStorage.getItem("lz_cache_version") !== CACHE_VERSION) {
  Object.keys(localStorage).filter(k => k.startsWith("lz_cover_")).forEach(k => localStorage.removeItem(k));
  localStorage.setItem("lz_cache_version", CACHE_VERSION);
}

function loadCover(canvasId, url, cacheKeyStr) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.dataset.loaded) return;
  const ck = CACHE_PREFIX + cacheKeyStr.replace(/[^a-zA-Z0-9|]/g,"").slice(0,60);
  const cached = localStorage.getItem(ck);
  if (cached && cached !== "data:,") {
    const img = new Image();
    img.onload = () => { const ctx=canvas.getContext("2d"); ctx.imageSmoothingEnabled=false; ctx.drawImage(img,0,0,4,4); };
    img.src = cached;
    canvas.dataset.loaded = "1";
    return;
  }
  const img = new Image();
  img.crossOrigin = !url.startsWith("http") ? undefined : "anonymous";
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, 4, 4);
    try {
      const full = document.createElement("canvas");
      full.width = full.height = 4;
      full.getContext("2d").drawImage(img, 0, 0, 4, 4);
      const data = full.toDataURL();
      if (data && data !== "data:,") localStorage.setItem(ck, data);
    } catch(e) {}
  };
  img.src = url;
  canvas.dataset.loaded = "1";
}

function loadCoverFull(canvasId, url, cacheKeyStr) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.dataset.loaded) return;
  const w = canvas.width;
  const h = canvas.height;
  const ck = CACHE_PREFIX + "full_" + w + "x" + h + "_" + cacheKeyStr.replace(/[^a-zA-Z0-9|]/g,"").slice(0,55);
  const cached = localStorage.getItem(ck);
  if (cached && cached !== "data:,") {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, w, h);
    };
    img.src = cached;
    canvas.dataset.loaded = "1";
    return;
  }
  const img = new Image();
  img.crossOrigin = !url.startsWith("http") ? undefined : "anonymous";
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, w, h);
    try {
      const full = document.createElement("canvas");
      full.width = w; full.height = h;
      full.getContext("2d").drawImage(img, 0, 0, w, h);
      const data = full.toDataURL();
      if (data && data !== "data:,") localStorage.setItem(ck, data);
    } catch(e) {}
  };
  img.src = url;
  canvas.dataset.loaded = "1";
}
document.getElementById("search").addEventListener("input", e => {
  searchQ = e.target.value;
  render();
});
function setSortDir(dir) {
  sortDir = dir;
  document.getElementById("sort-btn-old").classList.toggle("active", dir === 1);
  document.getElementById("sort-btn-new").classList.toggle("active", dir === -1);
  mergePosts();
  render();
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  if (!sidebar) return;
  const isOpen = sidebar.classList.toggle("open");
  overlay.classList.toggle("active", isOpen);
  document.body.classList.toggle("sidebar-open", isOpen);
}

function jumpToSection(id) {
  const searchEl = document.getElementById("search");
  if (searchEl && searchEl.value) { searchEl.value = ""; searchQ = ""; render(); }
  if (document.getElementById("sidebar")?.classList.contains("open")) toggleSidebar();
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
}
// ── DATE FORMAT ───────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

// ── DARK MODE ─────────────────────────────────────────────────────────────────
let darkMode = localStorage.getItem("lz_dark") === "1";
function applyDark() {
  document.body.classList.toggle("dark", darkMode);
  document.getElementById("btn-darkmode").classList.toggle("active", darkMode);
}
applyDark();
document.getElementById("btn-darkmode").addEventListener("click", () => {
  darkMode = !darkMode;
  localStorage.setItem("lz_dark", darkMode ? "1" : "0");
  applyDark();
});

// ── PASSWORD: BESUCHER ────────────────────────────────────────────────────────
async function checkPw() {
  const raw  = document.getElementById("pw-input").value;
  const val  = raw.trim(); // leerzeichen am ende abschneiden
  const errEl = document.getElementById("pw-error");

  if (!val) {
    errEl.textContent = "kein passwort eingegeben.";
    errEl.style.display = "block";
    return;
  }

  const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(val));
  const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");

  if (hash === PW_HASH_SHA256) {
    siteUnlocked = true;
    sessionStorage.setItem("lz_site_ok", "1");
    document.getElementById("pw-overlay").style.display = "none";
    document.getElementById("pw-input").value = "";
    errEl.style.display = "none";
    // iOS zoom reset
    const vp = document.querySelector("meta[name=viewport]");
    if (vp) {
      vp.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
      setTimeout(() => {
        vp.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
      }, 100);
    }
    await loadData();
  } else {
    // hilfreiche fehlermeldung
    let hint = "falsch.";
    if (raw !== val) hint = "falsch. (leerzeichen am ende entfernt — versuch nochmal)";
    else if (raw.length < 3) hint = "falsch. (zu kurz?)";
    errEl.textContent = hint;
    errEl.style.display = "block";
    document.getElementById("pw-input").select();
    document.getElementById("pw-box").style.animation = "none";
    setTimeout(() => {
      document.getElementById("pw-box").style.animation = "shake 0.3s ease";
    }, 10);
  }
}

// click UND touchend — mobil zuverlässiger
let pwBtnBusy = false;
function handlePwBtn(e) {
  e.preventDefault();
  e.stopPropagation();
  if (pwBtnBusy) return;
  pwBtnBusy = true;
  checkPw().finally(() => { pwBtnBusy = false; });
}
document.getElementById("pw-ok").addEventListener("click",    handlePwBtn);
document.getElementById("pw-ok").addEventListener("touchend", handlePwBtn);
document.getElementById("pw-input").addEventListener("keydown", e => { if(e.key==="Enter") checkPw(); });

// ── PASSWORD: ADMIN ───────────────────────────────────────────────────────────
async function checkAdminPw() {
  const val  = document.getElementById("admin-pw-input").value.trim();
  const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(val));
  const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
  if (hash === ADMIN_HASH_SHA256) {
    unlocked = true;
    sessionStorage.setItem("lz_admin_ok", "1");
    document.getElementById("admin-pw-overlay").style.display = "none";
    document.getElementById("admin-pw-input").value = "";
    document.getElementById("admin-pw-error").style.display = "none";
    // Admin-Panel öffnen
    const p = document.getElementById("admin-panel");
    p.style.display = "block";
    document.getElementById("btn-admin").classList.add("active");
    render(); // edit-buttons einblenden
  } else {
    document.getElementById("admin-pw-error").style.display = "block";
    document.getElementById("admin-pw-input").select();
    document.getElementById("admin-pw-box").style.animation = "none";
    setTimeout(() => {
      document.getElementById("admin-pw-box").style.animation = "shake 0.3s ease";
    }, 10);
  }
}
document.getElementById("admin-pw-ok").addEventListener("click", checkAdminPw);
document.getElementById("admin-pw-ok").addEventListener("touchend", e => { e.preventDefault(); checkAdminPw(); });
document.getElementById("admin-pw-input").addEventListener("keydown", e => { if(e.key==="Enter") checkAdminPw(); });
document.getElementById("admin-pw-cancel").addEventListener("click", () => {
  document.getElementById("admin-pw-overlay").style.display = "none";
  document.getElementById("admin-pw-input").value = "";
  document.getElementById("admin-pw-error").style.display = "none";
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────
document.getElementById("btn-admin").addEventListener("click", () => {
  if (!unlocked) {
    document.getElementById("admin-pw-overlay").style.display = "flex";
    document.getElementById("admin-pw-input").focus();
    return;
  }
  const p = document.getElementById("admin-panel");
  p.style.display = p.style.display === "none" ? "block" : "none";
  document.getElementById("btn-admin").classList.toggle("active", p.style.display === "block");
});
document.getElementById("btn-new-post").addEventListener("click", openPopup);

// ── POPUP ─────────────────────────────────────────────────────────────────────
function openPopup() {
  loadGh();
  document.getElementById("popup-overlay").style.display = "block";
  switchTypeTab("text");
}
function closePopup() {
  document.getElementById("popup-overlay").style.display = "none";
}
document.getElementById("popup-close").addEventListener("click", closePopup);
document.getElementById("popup-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("popup-overlay")) closePopup();
});

// type tabs
function switchTypeTab(tab) {
  document.querySelectorAll(".type-tab").forEach(el => el.classList.toggle("active", el.dataset.tab === tab));
  document.querySelectorAll(".form-panel").forEach(el => el.classList.toggle("active", el.id === "form-" + tab));
}
document.querySelectorAll(".type-tab").forEach(el => {
  el.addEventListener("click", () => switchTypeTab(el.dataset.tab));
});

// ── GITHUB ────────────────────────────────────────────────────────────────────
function saveGh() {
  localStorage.setItem("gh_token",  document.getElementById("gh-token").value.trim());
  localStorage.setItem("gh_repo",   document.getElementById("gh-repo").value.trim());
  localStorage.setItem("gh_branch", document.getElementById("gh-branch").value.trim() || "main");
  const s = document.getElementById("gh-saved");
  s.style.display = "inline";
  setTimeout(() => s.style.display = "none", 2000);
}
function loadGh() {
  document.getElementById("gh-token").value  = localStorage.getItem("gh_token")  || "";
  document.getElementById("gh-repo").value   = localStorage.getItem("gh_repo")   || "";
  document.getElementById("gh-branch").value = localStorage.getItem("gh_branch") || "main";
}
document.getElementById("btn-save-gh").addEventListener("click", saveGh);

async function pushToGithub(newEntry, currentData, path, ps) {
  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";
  if (!token || !repo) { ps.textContent = "fehler: github einstellungen fehlen."; return false; }
  ps.textContent = "verbinde...";
  try {
    const shaRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } });
    if (!shaRes.ok) throw new Error(`${shaRes.status} - token/repo falsch?`);
    const { sha } = await shaRes.json();
    const updatedData = [...currentData, newEntry];
    const content = btoa([...new TextEncoder().encode(JSON.stringify(updatedData, null, 2))].map(b => String.fromCharCode(b)).join(""));
    ps.textContent = "schreibe...";
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ message: `add: ${newEntry.title || newEntry.type}`, content, sha, branch })
    });
    if (!putRes.ok) { const err = await putRes.json(); throw new Error(err.message || putRes.status); }
    ps.textContent = "✓ fertig. ~30 sek bis live.";
    return true;
  } catch(e) { ps.textContent = "fehler: " + e.message; return false; }
}

// ── SUBMIT TEXT POST ──────────────────────────────────────────────────────────
async function pushTextPost(isDraft) {
  const ps = document.getElementById("ps-text");
  const title = document.getElementById("f-text-title").value.trim();
  const text  = document.getElementById("f-text-body").value.trim();
  const dateVal = document.getElementById("f-text-date").value;
  if (!title) { ps.textContent = "fehler: titel fehlt."; return; }
  if (!text)  { ps.textContent = "fehler: text fehlt.";  return; }
  const posted_at = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();
  const entry = { type: "text", title, text, posted_at };
  if (isDraft) entry.draft = true;
  const ok = await pushToGithub(entry, posts, "posts.json", ps);
  if (ok) {
    posts.push(entry);
    mergePosts(); render();
    ["f-text-title","f-text-body","f-text-date"].forEach(id => document.getElementById(id).value = "");
  }
}
document.getElementById("btn-push-text").addEventListener("click",  () => pushTextPost(false));
document.getElementById("btn-draft-text").addEventListener("click", () => pushTextPost(true));

// ── SUBMIT PHOTO POST ─────────────────────────────────────────────────────────
function addPhotoUrlRow() {
  const list = document.getElementById("photo-url-list");
  const row = document.createElement("div");
  row.className = "photo-url-row";
  row.innerHTML = `<input type="url" placeholder="https://..."><button onclick="this.parentElement.remove()" style="color:#c00;border-color:#c00">–</button>`;
  list.appendChild(row);
}

async function pushPhotoPost(isDraft) {
  const ps      = document.getElementById("ps-photo");
  const title   = document.getElementById("f-photo-title").value.trim();
  const text    = document.getElementById("f-photo-text").value.trim();
  const tag     = document.getElementById("f-photo-tag").value;
  const dateVal = document.getElementById("f-photo-date").value;
  const images  = [...document.querySelectorAll("#photo-url-list input")].map(i => i.value.trim()).filter(Boolean);
  if (!title)                   { ps.textContent = "fehler: titel fehlt.";  return; }
  if (!isDraft && !images.length) { ps.textContent = "fehler: keine bilder."; return; }
  const posted_at = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();
  const entry = { type: "photo", title, images, text, posted_at };
  if (isDraft) entry.draft = true;
  if (tag) entry.tag = tag;
  const ok = await pushToGithub(entry, posts, "posts.json", ps);
  if (ok) {
    posts.push(entry); mergePosts(); render();
    ["f-photo-title","f-photo-text","f-photo-date"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("photo-url-list").innerHTML = `<div class="photo-url-row"><input type="url" placeholder="https://..."><button onclick="this.parentElement.remove()" style="color:#c00;border-color:#c00">–</button></div>`;
  }
}
document.getElementById("btn-push-photo").addEventListener("click",  () => pushPhotoPost(false));
document.getElementById("btn-draft-photo").addEventListener("click", () => pushPhotoPost(true));

// ── SUBMIT EMBED POST ─────────────────────────────────────────────────────────
async function pushEmbedPost(isDraft) {
  const ps      = document.getElementById("ps-embed");
  const title   = document.getElementById("f-embed-title").value.trim();
  const code    = document.getElementById("f-embed-code").value.trim();
  const text    = document.getElementById("f-embed-text").value.trim();
  const dateVal = document.getElementById("f-embed-date").value;
  if (!title) { ps.textContent = "fehler: titel fehlt."; return; }
  if (!code)  { ps.textContent = "fehler: embed code fehlt."; return; }
  const posted_at = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();
  const entry = { type: "embed", title, embed: code, text, posted_at };
  if (isDraft) entry.draft = true;
  const ok = await pushToGithub(entry, posts, "posts.json", ps);
  if (ok) {
    posts.push(entry); mergePosts(); render();
    ["f-embed-title","f-embed-code","f-embed-text","f-embed-date"].forEach(id => document.getElementById(id).value = "");
  }
}
document.getElementById("btn-push-embed").addEventListener("click",  () => pushEmbedPost(false));
document.getElementById("btn-draft-embed").addEventListener("click", () => pushEmbedPost(true));
let selectedSongs = [];

async function mbSearch() {
  const artist = document.getElementById("q-artist").value.trim();
  const album  = document.getElementById("q-album").value.trim();
  if (!artist && !album) return;
  const st = document.getElementById("status");
  document.getElementById("mb-results").innerHTML = "";
  document.getElementById("form-album-details").style.display = "none";
  st.textContent = "suche...";
  try {
    let query = artist && album ? `artist:"${artist}" AND release:"${album}"` : artist ? `artist:"${artist}"` : `release:"${album}"`;
    const data = await (await fetch(
      `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=20`,
      { headers: { "User-Agent": "leetzschreib/1.0" } }
    )).json();
    if (!data.releases) { st.textContent = "nichts gefunden."; return; }
    st.textContent = data.releases.length ? `${data.releases.length} treffer:` : "nichts gefunden.";
    document.getElementById("mb-results").innerHTML = data.releases.map(r => {
      const a  = (r["artist-credit"]?.[0]?.name || "?").replace(/"/g,"&quot;");
      const t  = r.title.replace(/"/g,"&quot;");
      const y  = (r.date||"").slice(0,4) || "?";
      return `<a data-id="${r.id}" data-artist="${a}" data-album="${t}" data-year="${y}">${a} – ${r.title} (${y})</a>`;
    }).join("");
    document.getElementById("mb-results").querySelectorAll("a").forEach(el =>
      el.addEventListener("click", () => mbSelect(el))
    );
  } catch(e) { st.textContent = "fehler: " + e.message; }
}

async function mbSelect(el) {
  const st = document.getElementById("status");
  st.textContent = "lade tracks...";
  document.getElementById("mb-results").innerHTML = "";
  document.getElementById("fa-artist").value = el.dataset.artist;
  document.getElementById("fa-album").value  = el.dataset.album;
  document.getElementById("fa-year").value   = el.dataset.year;
  try {
    const data = await (await fetch(
      `https://musicbrainz.org/ws/2/release/${el.dataset.id}?inc=recordings+tags&fmt=json`,
      { headers: { "User-Agent": "leetzschreib/1.0" } }
    )).json();
    selectedSongs = [];
    (data.media || []).forEach(m => (m.tracks || []).forEach(t => selectedSongs.push(t.title)));
    const tags = (data.tags || []).sort((a,b) => b.count - a.count);
    if (tags.length) document.getElementById("fa-genre").value = tags[0].name;
    document.getElementById("song-radios").innerHTML = selectedSongs.map(s =>
      `<label><input type="radio" name="fav" value="${s.replace(/"/g,"&quot;")}"> ${s}</label>`
    ).join("");
    document.getElementById("song-manual").style.display = "none";
    document.getElementById("song-section").style.display = "block";
    document.getElementById("form-album-details").style.display = "block";
    st.textContent = `${selectedSongs.length} tracks geladen.`;
  } catch(e) { st.textContent = "fehler: " + e.message; }
}

document.getElementById("btn-mb-search").addEventListener("click", mbSearch);
document.getElementById("btn-mb-manual").addEventListener("click", () => {
  document.getElementById("mb-results").innerHTML = "";
  document.getElementById("status").textContent = "";
  ["fa-artist","fa-album","fa-year","fa-genre","fa-rating","fa-cover","fa-review"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("fa-songs-manual").value = "";
  document.getElementById("fa-fav-manual").value = "";
  document.getElementById("song-section").style.display = "none";
  document.getElementById("song-manual").style.display = "block";
  document.getElementById("form-album-details").style.display = "block";
  document.getElementById("form-album-details").dataset.mode = "manual";
  selectedSongs = [];
});
["q-artist","q-album"].forEach(id =>
  document.getElementById(id).addEventListener("keydown", e => { if(e.key==="Enter") mbSearch(); })
);

document.getElementById("btn-push-album").addEventListener("click", async () => {
  const isManual = document.getElementById("form-album-details").dataset.mode === "manual";
  const fav    = isManual
    ? document.getElementById("fa-fav-manual").value.trim()
    : document.querySelector('input[name="fav"]:checked')?.value;
  const songs  = isManual
    ? document.getElementById("fa-songs-manual").value.split(",").map(s=>s.trim()).filter(Boolean)
    : selectedSongs;
  const rating = parseFloat(document.getElementById("fa-rating").value);
  const ps     = document.getElementById("ps-album");
  if (!fav)                                                             { ps.textContent="fehler: kein lieblingssong."; return; }
  if (isNaN(rating)||rating<1||rating>10||rating*2!==Math.round(rating*2)) { ps.textContent="fehler: wertung 1-10, nur .5."; return; }
  const coverUrl = document.getElementById("fa-cover").value.trim();
  if (!coverUrl) { ps.textContent="fehler: cover url fehlt."; return; }

  const dateVal = document.getElementById("fa-date").value;
  const reviewed_at = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();

  const entry = {
    artist:       document.getElementById("fa-artist").value,
    album:        document.getElementById("fa-album").value,
    year:         parseInt(document.getElementById("fa-year").value) || document.getElementById("fa-year").value,
    genre:        document.getElementById("fa-genre").value,
    rating,
    favorite_song: fav,
    songs,
    review:       document.getElementById("fa-review").value,
    cover_url:    coverUrl,
    reviewed_at,
    sub_ratings: (() => {
      const sr = {};
      const h  = parseInt(document.getElementById("fa-hoerspass").value);
      const eg = parseInt(document.getElementById("fa-edginess").value);
      const ha = parseInt(document.getElementById("fa-harmonie").value);
      if (h>=1&&h<=5)   sr.hoerspass = h;
      if (eg>=1&&eg<=5) sr.edginess  = eg;
      if (ha>=1&&ha<=5) sr.harmonie  = ha;
      return sr;
    })()
  };

  const ok = await pushToGithub(entry, albums, "albums.json", ps);
  if (ok) {
    albums.push(entry);
    mergePosts(); render();
    ["fa-artist","fa-album","fa-year","fa-genre","fa-rating","fa-review","fa-cover","fa-hoerspass","fa-edginess","fa-harmonie","fa-date"].forEach(id => document.getElementById(id).value = "");
    ["fa-songs-manual","fa-fav-manual"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("song-radios").innerHTML = "";
    document.getElementById("song-section").style.display = "none";
    document.getElementById("song-manual").style.display = "none";
    document.getElementById("form-album-details").style.display = "none";
    document.getElementById("q-artist").value = document.getElementById("q-album").value = "";
    selectedSongs = [];
  }
});

// ── EDIT ALBUM (inline, same as plattenregal) ─────────────────────────────────
const SUB_CATS_EDIT = [
  { key:"hoerspass", label:"Hörspaß" },
  { key:"edginess",  label:"Edginess" },
  { key:"harmonie",  label:"Harmonie" }
];

function openEditAlbum(eid, e) {
  e.stopPropagation();
  const container = document.getElementById("edit-" + eid);
  if (!container) return;
  if (container.style.display !== "none") { container.style.display = "none"; return; }
  const idx = albums.findIndex(a => safeid(a.artist+a.album) === eid);
  if (idx < 0) return;
  const a = albums[idx];
  const subs = a.sub_ratings || {};
  const subFields = SUB_CATS_EDIT.map(c =>
    `<div style="margin-bottom:4px"><label style="width:80px">${c.label}:</label><input type="number" id="ea-${eid}-${c.key}" min="1" max="5" step="1" value="${subs[c.key]||''}" style="width:45px" placeholder="1-5"></div>`
  ).join("");
  const dateVal = a.reviewed_at ? a.reviewed_at.slice(0,10) : "";
  container.style.display = "block";
  container.innerHTML = `<div class="edit-form">
    <div style="margin-bottom:5px"><label>wertung:</label><input type="number" id="ea-${eid}-rating" min="1" max="10" step="0.5" value="${a.rating}" style="width:55px"></div>
    ${subFields}
    <div style="margin-bottom:5px"><label>datum:</label><input type="date" id="ea-${eid}-date" value="${dateVal}" style="width:140px"></div>
    <div><label>rezension:</label><textarea id="ea-${eid}-review" rows="4" style="width:98%;margin-top:3px">${a.review||""}</textarea></div>
    <div class="edit-form-btns">
      <button onclick="saveEditAlbum('${eid}',${idx})">speichern</button>
      <button onclick="document.getElementById('edit-${eid}').style.display='none'" style="color:#888;border-color:#888">abbrechen</button>
    </div>
    <div id="ea-${eid}-status" style="font-size:11px;margin-top:4px"></div>
  </div>`;
}

async function saveEditAlbum(eid, idx) {
  const rating = parseFloat(document.getElementById(`ea-${eid}-rating`).value);
  const review = document.getElementById(`ea-${eid}-review`).value;
  const dateVal = document.getElementById(`ea-${eid}-date`).value;
  const reviewed_at = dateVal ? new Date(dateVal).toISOString() : albums[idx].reviewed_at || null;
  const st = document.getElementById(`ea-${eid}-status`);
  if (isNaN(rating)||rating<1||rating>10||rating*2!==Math.round(rating*2)) { st.textContent="fehler: wertung 1-10, nur .5."; return; }
  const sub_ratings = {};
  SUB_CATS_EDIT.forEach(c => {
    const v = parseInt(document.getElementById(`ea-${eid}-${c.key}`)?.value);
    if (v>=1&&v<=5) sub_ratings[c.key] = v;
  });
  albums[idx] = { ...albums[idx], rating, review, reviewed_at, sub_ratings };

  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";
  const path   = "albums.json";
  if (!token||!repo) { st.textContent="fehler: github einstellungen fehlen."; return; }
  st.textContent = "speichere...";
  try {
    const shaRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
      { headers:{ Authorization:`token ${token}`, Accept:"application/vnd.github+json" }});
    if (!shaRes.ok) throw new Error(shaRes.status);
    const { sha } = await shaRes.json();
    const content = btoa([...new TextEncoder().encode(JSON.stringify(albums, null, 2))].map(b => String.fromCharCode(b)).join(""));
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { Authorization:`token ${token}`, Accept:"application/vnd.github+json", "Content-Type":"application/json" },
      body: JSON.stringify({ message:`edit: ${albums[idx].artist} - ${albums[idx].album}`, content, sha, branch })
    });
    if (!putRes.ok) { const err=await putRes.json(); throw new Error(err.message||putRes.status); }
    st.textContent = "✓ gespeichert.";
    mergePosts(); render();
  } catch(e) { st.textContent = "fehler: " + e.message; }
}

// ── TOOLTIP ───────────────────────────────────────────────────────────────────
document.addEventListener("click", e => {
  const tip = e.target.closest(".srf-tooltip");
  if (tip) {
    e.stopPropagation();
    const isOpen = tip.classList.contains("tip-open");
    document.querySelectorAll(".srf-tooltip.tip-open").forEach(t => t.classList.remove("tip-open"));
    if (!isOpen) tip.classList.add("tip-open");
    return;
  }
  document.querySelectorAll(".srf-tooltip.tip-open").forEach(t => t.classList.remove("tip-open"));
});

// ── BACK TO TOP ───────────────────────────────────────────────────────────────
const backTopBtn = document.getElementById("btn-back-top");
window.addEventListener("scroll", () => {
  backTopBtn.classList.toggle("visible", window.scrollY > 300);
}, { passive: true });
backTopBtn.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ── IMAGE UPLOAD ──────────────────────────────────────────────────────────────
document.getElementById("img-upload-input").addEventListener("change", async function() {
  const files  = [...this.files];
  const st     = document.getElementById("upload-status");
  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";

  if (!token || !repo) { st.textContent = "github einstellungen fehlen!"; return; }
  if (!files.length)   return;

  // Speichern-Button sperren während Upload
  const pushBtn = document.getElementById("btn-push-photo");
  if (pushBtn) { pushBtn.disabled = true; pushBtn.textContent = "↑ lädt..."; }

  st.textContent = `0 / ${files.length} hochgeladen...`;
  let uploaded = 0;

  for (const file of files) {
    try {
      st.textContent = `konvertiere ${file.name}...`;
      const { url } = await uploadImageToRepo(file, token, repo, branch);

      const list = document.getElementById("photo-url-list");
      const emptyInput = [...list.querySelectorAll("input[type=url]")].find(i => !i.value);
      if (emptyInput) {
        emptyInput.value = url;
      } else {
        const row = document.createElement("div");
        row.className = "photo-url-row";
        row.innerHTML = `<input type="url" value="${url}"><button onclick="this.parentElement.remove()" style="color:#c00;border-color:#c00">–</button>`;
        list.appendChild(row);
      }
      uploaded++;
      st.textContent = `${uploaded} / ${files.length} hochgeladen...`;
    } catch(err) {
      st.textContent = `fehler: ${err.message}`;
      if (pushBtn) { pushBtn.disabled = false; pushBtn.textContent = "speichern + push"; }
      return;
    }
  }

  st.textContent = `✓ ${uploaded} bild${uploaded > 1 ? "er" : ""} hochgeladen`;
  if (pushBtn) { pushBtn.disabled = false; pushBtn.textContent = "speichern + push"; }
  this.value = "";
});

// ── IMAGE CONVERSION: alles → JPEG, max 1600px, ~800KB ───────────────────────
async function convertToJpeg(file) {
  // Größencheck vorab
  if (file.size > 900 * 1024) {
    console.log(`[upload] ${file.name}: ${(file.size/1024/1024).toFixed(1)}MB — wird skaliert`);
  }

  // HEIC kann Safari/Chrome nicht per Image-Tag dekodieren
  // → prüfen ob es überhaupt ein ladbares Format ist
  const isHeic = /\.(heic|heif)$/i.test(file.name) || file.type === "image/heic" || file.type === "image/heif";
  if (isHeic) {
    throw new Error("HEIC wird vom Browser nicht unterstützt. Bitte das Foto vorher in den Einstellungen als JPEG speichern: Einstellungen → Kamera → Formate → Kompatibel");
  }

  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      let w = img.naturalWidth;
      let h = img.naturalHeight;

      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }

      console.log(`[upload] ${file.name}: ${img.naturalWidth}×${img.naturalHeight} → ${w}×${h}`);

      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      const b64 = dataUrl.split(",")[1];
      const estimatedKb = Math.round(b64.length * 0.75 / 1024);
      console.log(`[upload] komprimiert: ~${estimatedKb}KB`);

      if (estimatedKb > 900) {
        // nochmal mit niedrigerer Qualität
        const dataUrl2 = canvas.toDataURL("image/jpeg", 0.65);
        const b64_2 = dataUrl2.split(",")[1];
        console.log(`[upload] nochmals komprimiert: ~${Math.round(b64_2.length * 0.75 / 1024)}KB`);
        const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
        resolve({ b64: b64_2, filename: baseName + ".jpg" });
        return;
      }

      const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
      resolve({ b64, filename: baseName + ".jpg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`"${file.name}" konnte nicht geladen werden. Bitte als JPEG exportieren.`));
    };
    img.src = url;
  });
}

async function uploadImageToRepo(file, token, repo, branch) {
  const { b64, filename } = await convertToJpeg(file);
  const path = `img/${filename}`;

  let sha = null;
  try {
    const check = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } });
    if (check.ok) sha = (await check.json()).sha;
  } catch(e) {}

  const body = { message: `img: upload ${filename}`, content: b64, branch };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || res.status); }

  const url = `https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/${path}`;
  return { url, filename, path };
}
// ── IMAGE UPLOAD IN EDIT FORM ─────────────────────────────────────────────────
async function editUploadImages(input, pid) {
  const files  = [...input.files];
  const st     = document.getElementById("ef-upload-status-" + pid);
  const ta     = document.getElementById("ef-text-" + pid);
  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";

  if (!token || !repo) { st.textContent = "github einstellungen fehlen!"; return; }
  if (!files.length)   return;

  // Speichern sperren während Upload
  const saveBtn = document.querySelector(`#edit-form-${pid} button[onclick*="saveEditPost"]`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "↑ lädt..."; }

  for (const file of files) {
    try {
      st.textContent = `konvertiere ${file.name}...`;
      const { url } = await uploadImageToRepo(file, token, repo, branch);

      // URL in Bilder-Liste eintragen
      const imgList = document.getElementById("ef-img-list-" + pid);
      if (imgList) {
        const emptyInput = [...imgList.querySelectorAll("input[type=url]")].find(i => !i.value);
        if (emptyInput) {
          emptyInput.value = url;
        } else {
          const row = document.createElement("div");
          row.className = "photo-url-row";
          row.innerHTML = `<input type="url" value="${url}" style="flex:1"><button onclick="this.parentElement.remove()" style="color:#c00;border-color:#c00">–</button>`;
          imgList.appendChild(row);
        }
      }

      // [BildN] in Text einfügen — Cursor-Position nach jedem Insert neu lesen
      const existing = [...(ta.value.matchAll(/\[Bild(\d+)\]/gi))].map(m => parseInt(m[1]));
      const next = existing.length ? Math.max(...existing) + 1 : 1;
      const ref  = `[Bild${next}]`;
      // Cursor-Position jetzt lesen (nach vorherigem Insert aktuell)
      const pos  = (document.activeElement === ta) ? ta.selectionStart : ta.value.length;
      ta.value   = ta.value.slice(0, pos) + ref + ta.value.slice(pos);
      // Cursor hinter den eingefügten Text setzen
      const newPos = pos + ref.length;
      ta.setSelectionRange(newPos, newPos);
      ta.focus();
      st.textContent = `✓ als ${ref} eingefügt`;
    } catch(err) {
      st.textContent = `fehler: ${err.message}`;
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "speichern"; }
      return;
    }
  }
  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "speichern"; }
  input.value = "";
}

// ── EDITOR TOOLBAR HELPERS ────────────────────────────────────────────────────
function editorWrap(id, before, after) {
  const ta    = document.getElementById(id);
  if (!ta) return;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const sel   = ta.value.slice(start, end) || "text";
  ta.value    = ta.value.slice(0, start) + before + sel + after + ta.value.slice(end);
  ta.focus();
  ta.selectionStart = start + before.length;
  ta.selectionEnd   = start + before.length + sel.length;
}

function editorLink(id) {
  const ta  = document.getElementById(id);
  if (!ta) return;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const sel   = ta.value.slice(start, end) || "Linktext";
  const url   = prompt("URL eingeben:", "https://");
  if (!url) return;
  const insert = `[${sel}](${url})`;
  ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
  ta.focus();
}

function editorHeading(id) {
  const ta  = document.getElementById(id);
  if (!ta) return;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const sel   = ta.value.slice(start, end) || "Überschrift";
  const before = ta.value.slice(0, start);
  const prefix = (before.length > 0 && !before.endsWith("\n\n")) ? "\n\n" : "";
  const insert = `${prefix}## ${sel}\n\n`;
  ta.value = before + insert + ta.value.slice(end);
  ta.focus();
  const newPos = before.length + prefix.length + 3 + sel.length;
  ta.setSelectionRange(newPos, newPos);
}

function editorInsert(id) {
  const ta = document.getElementById(id);
  if (!ta) return;
  const pos = (document.activeElement === ta) ? ta.selectionStart : ta.value.length;
  // Bildnummer: nächste freie Nummer vorschlagen
  const existing = [...ta.value.matchAll(/\[Bild(\d+)\]/gi)].map(m => parseInt(m[1]));
  const next = existing.length ? Math.max(...existing) + 1 : 1;
  const insert = `[Bild${next}]`;
  ta.value = ta.value.slice(0, pos) + insert + ta.value.slice(pos);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = pos + insert.length;
}

// ── ALBUM GRID MODE ───────────────────────────────────────────────────────────
let albumMode = false;
let albumGridSearch = "";

function switchToAlbumMode() {
  albumMode = true;
  document.body.classList.add("album-mode");
  document.getElementById("btn-mode-switch").classList.add("active");
  document.getElementById("btn-mode-switch").textContent = "◑ blog";
  document.getElementById("feed-flow").style.display = "none";
  document.getElementById("album-grid").style.display = "block";
  renderAlbumGrid();
}

function switchToBlogMode() {
  albumMode = false;
  document.body.classList.remove("album-mode");
  document.getElementById("btn-mode-switch").classList.remove("active");
  document.getElementById("btn-mode-switch").textContent = "◑ platten";
  document.getElementById("feed-flow").style.display = "";
  document.getElementById("album-grid").style.display = "none";
}

document.getElementById("btn-mode-switch").addEventListener("click", () => {
  if (albumMode) switchToBlogMode(); else switchToAlbumMode();
});

function renderAlbumGrid() {
  const q = albumGridSearch.toLowerCase();
  let list = albums.filter(a => {
    if (!q) return true;
    return (a.artist + a.album + a.genre + a.year).toLowerCase().includes(q);
  });

  // Alphabetisch nach Artist
  list.sort((a, b) => a.artist.localeCompare(b.artist));

  // Gruppieren nach Artist
  const groups = [];
  const groupMap = {};
  for (const a of list) {
    const key = a.artist.toLowerCase();
    if (!groupMap[key]) {
      groupMap[key] = { artist: a.artist, albums: [] };
      groups.push(groupMap[key]);
    }
    groupMap[key].albums.push(a);
  }

  const grid = document.getElementById("album-grid");
  grid.innerHTML = `
    <div class="album-grid-controls">
      <input type="text" id="ag-search" placeholder="suche..." value="${albumGridSearch}"
        oninput="albumGridSearch=this.value;renderAlbumGrid()">
      <span class="album-grid-count">${list.length} alben · ${groups.length} künstler</span>
    </div>
    <div class="album-list">
      ${groups.map((g, gi) => `
        <div class="album-list-artist">${escapeHtml(g.artist)}</div>
        ${g.albums.map((a, ai) => {
          const cid = "agcv-" + safeid(a.artist + a.album);
          const genres = (a.genre||"").split(",").map(x=>x.trim()).filter(Boolean).join(" · ");
        return `<div class="album-list-row" onclick="openAlbumPopup(${gi}, ${ai})">
            <canvas class="album-list-img" id="${cid}" width="76" height="19"></canvas>
            <div class="album-list-overlay">
              <div class="album-list-info">
                <span class="album-list-title">${escapeHtml(a.album)}</span>
                <span class="album-list-meta">${escapeHtml(a.year||"")}${genres ? " · " + escapeHtml(genres) : ""}</span>
              </div>
              <span class="album-list-rating">${Number(a.rating)}<span>/10</span></span>
            </div>
          </div>`;
        }).join("")}
      `).join("")}
    </div>`;

  // Covers laden
  requestAnimationFrame(() => {
    list.forEach(a => {
      const cid = "agcv-" + safeid(a.artist + a.album);
      if (a.cover_url) loadCoverFull(cid, a.cover_url, a.artist + "|" + a.album);
    });
  });

  window._albumListFiltered = list;
}

function openAlbumPopup(groupIdx, albumIdx) {
  const q = albumGridSearch.toLowerCase();
  let list = albums.filter(a => {
    if (!q) return true;
    return (a.artist + a.album + a.genre + a.year).toLowerCase().includes(q);
  });
  list.sort((a, b) => a.artist.localeCompare(b.artist));

  // Gruppe finden
  const groups = [];
  const groupMap = {};
  for (const a of list) {
    const key = a.artist.toLowerCase();
    if (!groupMap[key]) { groupMap[key] = { artist: a.artist, albums: [] }; groups.push(groupMap[key]); }
    groupMap[key].albums.push(a);
  }
  const g = groups[groupIdx];
  const a = g && g.albums[albumIdx];
  if (!a) return;

  const genres = (a.genre||"").split(",").map(g=>g.trim()).filter(Boolean).join(" · ");
  const cid = "ap-cover-canvas";

  // Spotify & Apple Music Suche-Links
  const q2 = encodeURIComponent(a.artist + " " + a.album);
  const spotifyUrl  = `https://open.spotify.com/search/${q2}`;
  const appleUrl    = `https://music.apple.com/search?term=${q2}`;

  // Songs
  const songsHTML = (a.songs||[]).map(s =>
    s === a.favorite_song
      ? `<span class="fav">${escapeHtml(s)}</span>`
      : escapeHtml(s)
  ).join("  ·  ");

  document.getElementById("album-popup-content").innerHTML = `
    <div class="ap-header">
      <canvas class="ap-cover" id="${cid}" width="64" height="64"></canvas>
      <div class="ap-info">
        <div class="ap-album">${escapeHtml(a.album)}</div>
        <div class="ap-artist">${escapeHtml(a.artist)}</div>
        <div class="ap-meta">${escapeHtml(a.year || "")}${genres ? " · " + escapeHtml(genres) : ""}</div>
        <div class="ap-rating">${Number(a.rating)}<span>/10</span></div>
      </div>
    </div>
    <div class="ap-links">
      <a class="ap-link spotify" href="${spotifyUrl}" target="_blank" rel="noopener">↗ spotify</a>
      <a class="ap-link apple"   href="${appleUrl}"   target="_blank" rel="noopener">↗ apple music</a>
    </div>
    ${songsHTML ? `<div class="ap-songs">${songsHTML}</div>` : ""}
    ${a.review ? `<div class="ap-review">${escapeHtml(a.review).replace(/\n/g,"<br>")}</div>` : ""}
    ${a.reviewed_at ? `<div style="font-size:10px;color:#bbb;margin-top:8px;text-align:right">${formatDate(a.reviewed_at)}</div>` : ""}
  `;

  document.getElementById("album-popup-overlay").style.display = "flex";

  // Cover laden
  requestAnimationFrame(() => {
    if (a.cover_url) loadCoverFull(cid, a.cover_url, a.artist + "|" + a.album);
  });
}

document.getElementById("album-popup-close").addEventListener("click", () => {
  document.getElementById("album-popup-overlay").style.display = "none";
});
document.getElementById("album-popup-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("album-popup-overlay")) {
    document.getElementById("album-popup-overlay").style.display = "none";
  }
});

// ── SHOW HIDDEN TOGGLE ────────────────────────────────────────────────────────
document.getElementById("btn-show-hidden").addEventListener("click", () => {
  showHidden = !showHidden;
  render();
});

// ── FEATURED REISE ────────────────────────────────────────────────────────────
function renderFeaturedReise() {
  const reisePosts = posts.filter(p => p.type === "photo" && p.tag === "reise" && !p.draft);
  reisePosts.sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at));

  // Rechte Spalte im angepinnten BDM-Block
  const pinnedRight = document.getElementById("bdm-pinned-right");
  if (pinnedRight) {
    if (!reisePosts.length) {
      pinnedRight.innerHTML = "";
      pinnedRight.style.display = "none";
    } else {
      const p = reisePosts[0];
      const pid  = stablePid(p);
      const fpid = pid + "-f";
      const firstImg = (p.images && p.images.length) ? p.images[0] : "";
      pinnedRight.style.display = "";
      pinnedRight.innerHTML =
        `<div class="bdm-pinned-header">🗺 Aktuelle Reise</div>` +
        (firstImg ? `<img class="bdm-pinned-reise-img" src="${escapeHtml(firstImg)}" alt="">` : "") +
        `<div class="bdm-pinned-reise-title">${escapeHtml(p.title || "")}</div>`;
      pinnedRight.addEventListener("click", () => {
        setTimeout(() => {
          const el = document.getElementById(fpid);
          if (!el) return;
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("post-highlight");
          setTimeout(() => el.classList.remove("post-highlight"), 2000);
        }, 80);
      });
    }
  }
}

// ── TOP 100 ADMIN EDITOR ──────────────────────────────────────────────────────
let top100AdminList = [];
let top100DragIdx   = null;

document.getElementById("btn-top100-toggle").addEventListener("click", () => {
  const ed = document.getElementById("top100-editor");
  if (ed.style.display !== "none") { ed.style.display = "none"; return; }
  top100AdminList = top100.map(s => ({ ...s }));
  renderTop100AdminRows();
  ed.style.display = "";
});

function renderTop100AdminRows() {
  const list = document.getElementById("top100-drag-list");
  if (!list) return;
  list.innerHTML = top100AdminList.length
    ? top100AdminList.map((s, i) => {
        const cid = "t100a-" + i;
        return `<div class="t100-admin-row" draggable="true" data-idx="${i}">
          <span class="t100-admin-handle">⠿</span>
          <span class="t100-admin-rank">${i + 1}</span>
          <canvas class="t100-admin-cover" id="${cid}" width="4" height="4"></canvas>
          <div class="t100-admin-info">${escapeHtml(s.title)} <span style="color:var(--muted)">— ${escapeHtml(s.artist)}</span></div>
          <button class="t100-admin-del" data-idx="${i}" title="löschen">✕</button>
        </div>`;
      }).join("")
    : `<div style="padding:10px 8px;font-size:11px;color:var(--muted)">Noch keine Songs.</div>`;

  requestAnimationFrame(() => {
    top100AdminList.forEach((s, i) => {
      if (s.cover) loadCover("t100a-" + i, s.cover, "t100a|" + s.title + "|" + s.artist);
    });
  });

  list.querySelectorAll(".t100-admin-row").forEach(row => {
    row.addEventListener("dragstart", e => {
      top100DragIdx = +row.dataset.idx;
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => row.classList.add("t100-dragging"), 0);
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("t100-dragging");
      list.querySelectorAll(".t100-drop-above").forEach(el => el.classList.remove("t100-drop-above"));
    });
    row.addEventListener("dragover", e => {
      e.preventDefault();
      list.querySelectorAll(".t100-drop-above").forEach(el => el.classList.remove("t100-drop-above"));
      row.classList.add("t100-drop-above");
    });
    row.addEventListener("drop", e => {
      e.preventDefault();
      row.classList.remove("t100-drop-above");
      const toIdx = +row.dataset.idx;
      if (top100DragIdx === null || top100DragIdx === toIdx) return;
      const [item] = top100AdminList.splice(top100DragIdx, 1);
      const adjusted = top100DragIdx < toIdx ? toIdx - 1 : toIdx;
      top100AdminList.splice(adjusted, 0, item);
      top100DragIdx = null;
      renderTop100AdminRows();
    });
    row.querySelector(".t100-admin-del").addEventListener("click", () => {
      top100AdminList.splice(+row.dataset.idx, 1);
      renderTop100AdminRows();
    });
  });
}

document.getElementById("btn-top100-add").addEventListener("click", () => {
  const title  = document.getElementById("t100-new-title").value.trim();
  const artist = document.getElementById("t100-new-artist").value.trim();
  const cover  = document.getElementById("t100-new-cover").value.trim();
  if (!title || !artist) { document.getElementById("top100-status").textContent = "fehler: titel + artist angeben."; return; }
  document.getElementById("top100-status").textContent = "";
  top100AdminList.push({ title, artist, cover });
  document.getElementById("t100-new-title").value  = "";
  document.getElementById("t100-new-artist").value = "";
  document.getElementById("t100-new-cover").value  = "";
  renderTop100AdminRows();
});

document.getElementById("btn-top100-save").addEventListener("click", async () => {
  const st  = document.getElementById("top100-status");
  const btn = document.getElementById("btn-top100-save");
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = "...";
  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";
  if (!token || !repo) { st.textContent = "fehler: github einstellungen fehlen."; btn.disabled = false; btn.textContent = "speichern + push"; return; }
  st.textContent = "verbinde...";
  try {
    const shaRes = await fetch(`https://api.github.com/repos/${repo}/contents/top100.json?ref=${branch}`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } });
    const sha = shaRes.ok ? (await shaRes.json()).sha : undefined;
    const content = btoa([...new TextEncoder().encode(JSON.stringify(top100AdminList, null, 2))].map(b => String.fromCharCode(b)).join(""));
    st.textContent = "schreibe...";
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/top100.json`, {
      method: "PUT",
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "update: top 100 songs", content, sha, branch })
    });
    if (!putRes.ok) { const err = await putRes.json(); throw new Error(err.message || putRes.status); }
    top100 = top100AdminList.map(s => ({ ...s }));
    renderTop100();
    st.textContent = "✓ fertig. ~30 sek bis live.";
  } catch(e) {
    st.textContent = "fehler: " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "speichern + push";
  }
});

// ── BILDER DES MONATS EDITOR ──────────────────────────────────────────────────

document.getElementById("btn-bdm-toggle").addEventListener("click", () => {
  const ed = document.getElementById("bdm-editor");
  if (ed.style.display !== "none") { ed.style.display = "none"; return; }
  const autoMonth = new Date().toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  document.getElementById("bdm-month").value = bilderDesMonats.month || autoMonth;
  const list = document.getElementById("bdm-photo-list");
  list.innerHTML = "";
  (bilderDesMonats.photos || []).forEach(p => addBdmPhotoSlot(p.url, p.caption || ""));
  if (!list.children.length) addBdmPhotoSlot("", "");
  ed.style.display = "";
});

function addBdmPhotoSlot(url, caption) {
  const list = document.getElementById("bdm-photo-list");
  const slot = document.createElement("div");
  slot.className = "bdm-photo-slot";
  slot.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:5px";
  slot.innerHTML = `
    <img class="bdm-slot-preview" src="${url}" style="width:40px;height:40px;object-fit:cover;border:1px solid #ddd;border-radius:3px;flex-shrink:0${url ? "" : ";display:none"}" onerror="this.style.display='none'">
    <label class="editor-upload-label" style="white-space:nowrap;flex-shrink:0">↑ foto<input type="file" accept="image/*" style="display:none" class="bdm-slot-file"></label>
    <input type="hidden" class="bdm-slot-url" value="${url}">
    <input type="text" class="bdm-slot-caption" placeholder="bildunterschrift..." value="${caption}" style="flex:1;min-width:0">
    <span class="bdm-slot-status" style="font-size:10px;color:#888;white-space:nowrap"></span>
    <button class="bdm-slot-remove" style="color:#c00;border-color:#c00;flex-shrink:0">–</button>
  `;
  slot.querySelector(".bdm-slot-remove").addEventListener("click", () => slot.remove());
  slot.querySelector(".bdm-slot-file").addEventListener("change", async function() {
    const file = this.files[0];
    if (!file) return;
    const st     = slot.querySelector(".bdm-slot-status");
    const token  = localStorage.getItem("gh_token");
    const repo   = localStorage.getItem("gh_repo");
    const branch = localStorage.getItem("gh_branch") || "main";
    if (!token || !repo) { st.textContent = "github fehlt!"; return; }
    st.textContent = "lädt...";
    try {
      const { url: newUrl } = await uploadImageToRepo(file, token, repo, branch);
      slot.querySelector(".bdm-slot-url").value = newUrl;
      const preview = slot.querySelector(".bdm-slot-preview");
      preview.src = newUrl;
      preview.style.display = "";
      st.textContent = "✓";
    } catch(e) { st.textContent = "fehler: " + e.message; }
    this.value = "";
  });
  list.appendChild(slot);
}

document.getElementById("btn-bdm-add-photo").addEventListener("click", () => addBdmPhotoSlot("", ""));

async function saveBdm() {
  const st     = document.getElementById("bdm-status");
  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";
  if (!token || !repo) { st.textContent = "fehler: github einstellungen fehlen."; return; }

  const month  = document.getElementById("bdm-month").value.trim();
  const photos = [...document.querySelectorAll(".bdm-photo-slot")].map(s => {
    const url     = s.querySelector(".bdm-slot-url").value.trim();
    const caption = s.querySelector(".bdm-slot-caption").value.trim();
    return url ? { url, caption } : null;
  }).filter(Boolean);

  const data    = { month, photos };
  const headers = { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };
  const toB64   = obj => btoa([...new TextEncoder().encode(JSON.stringify(obj, null, 2))].map(b => String.fromCharCode(b)).join(""));

  st.textContent = "speichere...";
  try {
    // Neuen Monat speichern
    let sha = null;
    const shaRes = await fetch(`https://api.github.com/repos/${repo}/contents/bilder_des_monats.json?ref=${branch}`,
      { headers });
    if (shaRes.ok) sha = (await shaRes.json()).sha;
    const body = { message: "bdm: update Bilder des Monats", content: toB64(data), branch };
    if (sha) body.sha = sha;
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/bilder_des_monats.json`, {
      method: "PUT", headers, body: JSON.stringify(body)
    });
    if (!putRes.ok) { const e = await putRes.json(); throw new Error(e.message || putRes.status); }
    bilderDesMonats = data;
    render();
    st.textContent = "✓ gespeichert. ~30 sek bis live.";
  } catch(e) { st.textContent = "fehler: " + e.message; }
}

document.getElementById("btn-bdm-save").addEventListener("click", saveBdm);


function renderBilderDesMonats() {
  const photos = bilderDesMonats.photos || [];

  // Angepinnter Beitrag über dem Feed (linke Spalte)
  const pinnedEl   = document.getElementById("bdm-pinned");
  const pinnedLeft = document.getElementById("bdm-pinned-left");
  if (pinnedLeft) {
    if (!photos.length) {
      pinnedLeft.innerHTML = "";
      if (pinnedEl) pinnedEl.style.display = "none";
    } else {
      const monthLabel = bilderDesMonats.month ? ` — ${escapeHtml(bilderDesMonats.month)}` : "";
      const photosHTML = photos.slice(0, 3).map((p, i) =>
        `<div class="bdm-pinned-photo">` +
        `<img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || "")}" data-idx="${i}">` +
        (p.caption ? `<div class="bdm-pinned-caption">${escapeHtml(p.caption)}</div>` : "") +
        `</div>`
      ).join("");
      pinnedLeft.innerHTML =
        `<div class="bdm-pinned-header">📌 Bilder des Monats${monthLabel}</div>` +
        `<div class="bdm-pinned-photos">${photosHTML}</div>`;
      if (pinnedEl) pinnedEl.style.display = "";
      pinnedLeft.querySelectorAll(".bdm-pinned-photo img").forEach((img, i) => {
        img.addEventListener("click", () => { if (photos[i]) openBdmPhoto(photos[i]); });
      });
    }
  }

}

