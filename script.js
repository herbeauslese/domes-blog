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
let allPosts = []; // merged + sorted feed

let sortDir    = 1; // 1 = oldest first, -1 = newest first
let filterType = "all";
let searchQ    = "";

// Besucher-Passwort (Zugang zur Seite) — SHA-256 Hash
const PW_HASH_SHA256    = "4a4502d754a5f4b056e90be59f0ae45baf97da1886c3de441a1e08c809e9bfb6";

// Admin-Passwort (Bearbeitung, neue Beiträge) — separates Passwort!
const ADMIN_HASH_SHA256 = "b8f4a44e59c998d28f5684e885d5ece7684a28cbe174bdb11a9d949e4a9dc23a"; // mit generate-hash.html erzeugen

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
  setLoadingProgress(70);
  try {
    const h = await (await fetch("hidden.json?_=" + Date.now())).json();
    hiddenPosts = new Set(Array.isArray(h) ? h : []);
  } catch(e) { hiddenPosts = new Set(); }
  setLoadingProgress(90);
  mergePosts();
  applyDark();
  render();
  hideLoadingScreen();
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
    // type filter
    if (filterType === "text"  && p.type !== "text")  return false;
    if (filterType === "photo" && p.type !== "photo") return false;
    if (filterType === "album" && p.type !== "album") return false;
    if (filterType === "reise" && !(p.type === "photo" && p.tag === "reise")) return false;
    // search
    if (q) {
      const hay = [
        p.title || "",
        p.text  || "",
        p.type  === "album" ? (p._albumData.artist + " " + p._albumData.genre + " " + p._albumData.review) : ""
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // hidden posts: skip unless showHidden
  if (!showHidden) {
    filtered = filtered.filter(p => !hiddenPosts.has(stablePid(p)));
  }

  // update count
  document.getElementById("post-count").textContent = filtered.length + " beiträge";

  if (!filtered.length) {
    document.getElementById("feed").innerHTML =
      `<div class="post" style="color:#aaa;font-style:italic;padding:10px 0;border-top:1px solid #000;border-bottom:1px solid #000">keine beiträge.</div>`;
    return;
  }

  document.getElementById("feed").innerHTML = filtered.map((p, i) => renderPost(p, i)).join("");

  // init album covers
  filtered.forEach(p => {
    if (p.type === "album" && p._albumData.cover_url) {
      const a = p._albumData;
      const cid = "cv-" + safeid(a.artist + a.album);
      loadCover(cid, a.cover_url, a.artist + "|" + a.album);
    }
  });

  // init song tickers
  requestAnimationFrame(() => requestAnimationFrame(initTickers));

  // init slideshows
  document.querySelectorAll(".slideshow[data-slides]").forEach(el => {
    initSlideshow(el);
  });

  // apply hidden UI state
  requestAnimationFrame(applyHiddenUI);
}

function safeid(s) { return s.replace(/[^a-zA-Z0-9]/g, ""); }

// ── TEXT PARSER: bold, links, bildverweise ────────────────────────────────────
// **fett** → <strong>
// [Text](url) → <a href>
// [Bild2] → springt zu Bild 2 in der Slideshow des Posts
function parseText(text, pid) {
  return text
    // Zeilenumbrüche erst später (nach inline-parsing)
    .split("\n\n").map(para => {
      let t = para
        // **fett**
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        // [Text](url) — externer Link
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener" class="post-link">$1</a>')
        // [Bild1], [Bild2] etc. — springt zur Slideshow
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
  // Post aufklappen falls zu
  const postEl = document.getElementById(pid);
  if (postEl && !postEl.classList.contains("expanded")) togglePost(pid);
  // kurz warten bis aufgeklappt, dann springen
  setTimeout(() => {
    goSlide(pid, idx);
    const slides = document.getElementById(pid + "-slides");
    if (slides) slides.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 100);
}

// ── RENDER SINGLE POST ───────────────────────────────────────────────────────
function renderPost(p, idx) {
  const pid = stablePid(p);
  const dateStr = formatDate(p.posted_at);

  if (p.type === "text")  return renderTextPost(p, pid, dateStr);
  if (p.type === "photo") return renderPhotoPost(p, pid, dateStr);
  if (p.type === "album") return renderAlbumPost(p, pid, dateStr);
  return "";
}

function renderTextPost(p, pid, dateStr) {
  const rawPreview = (p.text || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/\[Bild\d+\]/gi, "")
    .replace(/\n\n/g, " ")
    .replace(/\n/g, " ")
    .slice(0, 160);
  const preview = rawPreview + ((p.text||"").length > 160 ? "…" : "");
  const fullText = parseText(p.text || "", pid);
  const editBtn = unlocked ? `<button class="edit-btn" onclick="toggleEditPost('${pid}', event)">✎</button>` : "";
  const hideBtn = unlocked ? `<button class="hide-btn" onclick="toggleHidePost('${pid}', event)">◌</button>` : "";

  return `<div class="post" id="${pid}" data-type="text" data-title="${(p.title||'').replace(/"/g,'&quot;')}" data-text="${(p.text||'').replace(/"/g,'&quot;')}" data-date="${p.posted_at||''}">
    <div class="post-date-inline">${dateStr}</div>
    <div class="post-header">
      <span class="post-title-wrap">
        <span class="post-title" onclick="togglePost('${pid}')">${p.title || "(ohne titel)"}</span>
        ${editBtn}${hideBtn}
      </span>
      <span class="post-tag">text</span>
    </div>
    <div class="post-preview">${preview}</div>
    <div class="entry-toggle" onclick="togglePost('${pid}')">
      <span style="flex:1">weiterlesen</span>
      <span class="entry-toggle-arrow">▼</span>
    </div>
    <div class="post-body">
      <div class="post-fulltext">${fullText}</div>
    </div>
    <div class="post-edit-form" id="edit-form-${pid}" style="display:none"></div>
  </div>`;
}

function renderPhotoPost(p, pid, dateStr) {
  const isReise = p.tag === "reise";
  const tagLabel = isReise ? "reise" : "foto";
  const tagClass = isReise ? "reise" : "";
  const imgs = p.images || [];
  const preview = (p.text || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/\[Bild\d+\]/gi, "")
    .replace(/\n/g, " ")
    .slice(0, 140) + ((p.text||"").length > 140 ? "…" : "");
  const editBtn = unlocked ? `<button class="edit-btn" onclick="toggleEditPost('${pid}', event)">✎</button>` : "";
  const hideBtn = unlocked ? `<button class="hide-btn" onclick="toggleHidePost('${pid}', event)">◌</button>` : "";

  // slideshow markup
  let slidesHTML = "";
  if (imgs.length > 0) {
    const slidesData = JSON.stringify(imgs).replace(/"/g, "&quot;");
    const tracks = imgs.map((url, i) =>
      `<img class="slide-img${i===0?' active':''}" src="${url}" alt="" loading="lazy">`
    ).join("");
    const dots = imgs.length > 1
      ? imgs.map((_, i) => `<span class="slide-dot${i===0?' active':''}" onclick="goSlide('${pid}',${i})"></span>`).join("")
      : "";
    const nav = imgs.length > 1
      ? `<div class="slide-nav">
           <button class="slide-btn" onclick="prevSlide('${pid}')">←</button>
           <div class="slide-dots">${dots}</div>
           <span class="slide-counter" id="${pid}-counter">1 / ${imgs.length}</span>
           <button class="slide-btn" onclick="nextSlide('${pid}')">→</button>
         </div>`
      : "";
    slidesHTML = `<div class="slideshow" id="${pid}-slides" data-slides="${slidesData}" data-current="0" style="padding-right:0">
      <div class="slide-track" style="aspect-ratio:4/3;position:relative">${tracks}</div>
      ${nav}
    </div>`;
  }

  return `<div class="post" id="${pid}" data-type="photo" data-title="${(p.title||'').replace(/"/g,'&quot;')}" data-text="${(p.text||'').replace(/"/g,'&quot;')}" data-tag="${p.tag||''}" data-images="${JSON.stringify(p.images||[]).replace(/"/g,'&quot;')}" data-date="${p.posted_at||''}">
    <div class="post-date-inline">${dateStr}</div>
    <div class="post-header">
      <span class="post-title-wrap">
        <span class="post-title" onclick="togglePost('${pid}')">${p.title || "(ohne titel)"}</span>
        ${editBtn}${hideBtn}
      </span>
      <span class="post-tag ${tagClass}">${tagLabel}</span>
    </div>
    ${slidesHTML}
    <div class="post-preview">${preview}</div>
    <div class="entry-toggle" onclick="togglePost('${pid}')">
      <span style="flex:1">weiterlesen</span>
      <span class="entry-toggle-arrow">▼</span>
    </div>
    <div class="post-body">
      <div class="post-fulltext">${parseText(p.text||"", pid)}</div>
    </div>
    <div class="post-edit-form" id="edit-form-${pid}" style="display:none"></div>
  </div>`;
}

function renderAlbumPost(p, pid, dateStr) {
  const a = p._albumData;
  const cid = "cv-" + safeid(a.artist + a.album);
  const genres = (a.genre||"").split(",").map(g=>g.trim()).filter(Boolean).join(" · ");

  // songs: static list, unauffällig, im body
  const songsListHTML = (a.songs||[]).length
    ? `<div class="album-songs-list">${(a.songs||[]).map(s =>
        s === a.favorite_song
          ? `<span class="album-song fav">${s}</span>`
          : `<span class="album-song">${s}</span>`
      ).join("")}</div>`
    : "";

  const reviewHTML = a.review
    ? `<div class="post-fulltext" style="margin-top:10px">${a.review.replace(/\n/g,"<br>")}</div>`
    : "";
  const editBtn = unlocked ? `<button class="edit-btn" onclick="openEditAlbum('${safeid(a.artist+a.album)}', event)">✎</button>` : "";
  const hideBtn = unlocked ? `<button class="hide-btn" title="ausblenden" onclick="toggleHidePost('${pid}', event)">◌</button>` : "";

  return `<div class="post" id="${pid}">
    <div style="position:relative">
      <div class="post-header" style="padding-right:52px">
        <span class="post-title-wrap">
          <span class="post-title" onclick="togglePost('${pid}')">${a.album}</span>
          ${editBtn}${hideBtn}
        </span>
        <span class="post-tag album">album</span>
      </div>
      <span class="album-rating">${Number(a.rating)}<span class="rating-denom">/10</span></span>
      <div class="album-row" style="margin-top:4px">
        <canvas class="album-cover-canvas" id="${cid}" width="4" height="4"></canvas>
        <div class="album-info">
          <div class="post-meta">${a.artist}${a.year ? " · "+a.year : ""}${genres ? " · "+genres : ""}</div>
        </div>
      </div>
      <div class="post-date-inline album-date" style="top:0">${dateStr}</div>
    </div>
    <div class="entry-toggle" onclick="togglePost('${pid}')">
      <span style="flex:1">${a.review ? "rezension lesen" : "details"}</span>
      <span class="entry-toggle-arrow">▼</span>
    </div>
    <div class="post-body">
      ${songsListHTML}
      ${reviewHTML}
      <div class="entry-date-small">${dateStr}</div>
    </div>
    <div id="edit-${safeid(a.artist+a.album)}" style="display:none"></div>
  </div>`;
}

// ── TOGGLE POST EXPAND ────────────────────────────────────────────────────────
function togglePost(pid) {
  const el = document.getElementById(pid);
  if (!el) return;
  el.classList.toggle("expanded");
  // preview ausblenden wenn aufgeklappt
  const preview = el.querySelector(".post-preview");
  if (preview) preview.style.display = el.classList.contains("expanded") ? "none" : "";
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

  const tagField = type === "photo"
    ? `<div style="margin-bottom:5px"><label style="width:80px;font-size:11px;color:#666">typ:</label>
        <select id="ef-tag-${pid}" style="font-family:'Courier New',monospace;font-size:12px;border:1px solid #000;padding:2px 4px">
          <option value="" ${tag===''?'selected':''}>foto</option>
          <option value="reise" ${tag==='reise'?'selected':''}>reise</option>
        </select></div>`
    : "";

  const toolbarHTML = `<div class="editor-toolbar">
    <button type="button" onclick="editorWrap('ef-text-${pid}','**','**')" title="Fett">B</button>
    <button type="button" onclick="editorLink('ef-text-${pid}')" title="Link">🔗</button>
    <button type="button" onclick="editorInsert('ef-text-${pid}','[Bild1]')" title="Bildverweis">📷</button>
    <label class="editor-upload-label" title="Bild hochladen + verlinken">
      ↑ bild
      <input type="file" accept="image/*" multiple style="display:none"
        onchange="editUploadImages(this,'${pid}')">
    </label>
    <span id="ef-upload-status-${pid}" style="font-size:10px;color:#888"></span>
    <span class="editor-hint">**fett** · [Text](url) · [Bild2]</span>
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
    ${tagField}
    <div style="margin-bottom:5px"><label style="width:80px;font-size:11px;color:#666">datum:</label><input type="date" id="ef-date-${pid}" value="${date}" style="width:140px"></div>
    <div class="edit-form-btns">
      <button onclick="saveEditPost('${pid}')">speichern</button>
      <button onclick="document.getElementById('edit-form-${pid}').style.display='none'" style="color:#888;border-color:#888">abbrechen</button>
    </div>
    <div id="ef-status-${pid}" style="font-size:11px;margin-top:4px"></div>
  </div>`;
}

async function saveEditPost(pid) {
  const postEl  = document.getElementById(pid);
  const type    = postEl.dataset.type;
  const st      = document.getElementById("ef-status-" + pid);
  const title   = document.getElementById("ef-title-" + pid).value.trim();
  const text    = document.getElementById("ef-text-"  + pid).value;
  const dateVal = document.getElementById("ef-date-"  + pid).value;
  const tag     = type === "photo" ? (document.getElementById("ef-tag-" + pid)?.value || "") : undefined;

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

  const token  = localStorage.getItem("gh_token");
  const repo   = localStorage.getItem("gh_repo");
  const branch = localStorage.getItem("gh_branch") || "main";
  if (!token || !repo) { st.textContent = "fehler: github einstellungen fehlen."; return; }

  st.textContent = "speichere...";
  try {
    const shaRes = await fetch(`https://api.github.com/repos/${repo}/contents/posts.json?ref=${branch}`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } });
    if (!shaRes.ok) throw new Error(shaRes.status);
    const { sha } = await shaRes.json();
    const newPosts = [...posts];
    newPosts[idx] = updated;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(newPosts, null, 2))));
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
  } catch(err) { st.textContent = "fehler: " + err.message; }
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
  const content = btoa(unescape(encodeURIComponent(data)));

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
    const pid = btn.closest(".post")?.id;
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

// ── SLIDESHOW ─────────────────────────────────────────────────────────────────
function initSlideshow(el) {
  // already initialized
}
function goSlide(pid, idx) {
  const wrap = document.getElementById(pid + "-slides");
  if (!wrap) return;
  const imgs = wrap.querySelectorAll(".slide-img");
  const dots = wrap.querySelectorAll(".slide-dot");
  const counter = document.getElementById(pid + "-counter");
  imgs.forEach((img, i) => img.classList.toggle("active", i === idx));
  dots.forEach((d, i) => d.classList.toggle("active", i === idx));
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

// ── SONG TICKER ───────────────────────────────────────────────────────────────
function initTickers() {
  document.querySelectorAll(".entry-songs").forEach(container => {
    const inner = container.querySelector(".entry-songs-inner");
    if (!inner || inner.dataset.tickerInit) return;
    if (inner.scrollWidth <= container.clientWidth + 2) return;
    inner.dataset.tickerInit = "1";
    const sep = document.createElement("span");
    sep.style.padding = "0 20px";
    sep.style.fontSize = "11px";
    sep.textContent = "·";
    const clone = inner.cloneNode(true);
    inner.appendChild(sep);
    inner.appendChild(clone);
    const halfW = inner.scrollWidth / 2;
    const dur = halfW / 24;
    inner.style.setProperty("--scroll-dist", "-" + halfW + "px");
    inner.style.setProperty("--scroll-dur", dur.toFixed(1) + "s");
    inner.classList.add("scrolling");
    container.addEventListener("mouseenter", () => inner.style.animationPlayState = "paused");
    container.addEventListener("mouseleave", () => inner.style.animationPlayState = "running");
  });
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

// ── CONTROLS ─────────────────────────────────────────────────────────────────
document.getElementById("search").addEventListener("input", e => {
  searchQ = e.target.value;
  render();
});
document.getElementById("sort-dir").addEventListener("change", e => {
  sortDir = parseInt(e.target.value);
  mergePosts();
  render();
});
document.getElementById("filter-type").addEventListener("change", e => {
  filterType = e.target.value;
  render();
});

// ── DATE FORMAT ───────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("de-DE", { day:"2-digit", month:"2-digit", year:"numeric" });
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
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(updatedData, null, 2))));
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
document.getElementById("btn-push-text").addEventListener("click", async () => {
  const ps = document.getElementById("ps-text");
  const title = document.getElementById("f-text-title").value.trim();
  const text  = document.getElementById("f-text-body").value.trim();
  const dateVal = document.getElementById("f-text-date").value;
  if (!title) { ps.textContent = "fehler: titel fehlt."; return; }
  if (!text)  { ps.textContent = "fehler: text fehlt.";  return; }
  const posted_at = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();
  const entry = { type: "text", title, text, posted_at };
  const ok = await pushToGithub(entry, posts, "posts.json", ps);
  if (ok) {
    posts.push(entry);
    mergePosts(); render();
    ["f-text-title","f-text-body","f-text-date"].forEach(id => document.getElementById(id).value = "");
  }
});

// ── SUBMIT PHOTO POST ─────────────────────────────────────────────────────────
function addPhotoUrlRow() {
  const list = document.getElementById("photo-url-list");
  const row = document.createElement("div");
  row.className = "photo-url-row";
  row.innerHTML = `<input type="url" placeholder="https://..."><button onclick="this.parentElement.remove()" style="color:#c00;border-color:#c00">–</button>`;
  list.appendChild(row);
}

document.getElementById("btn-push-photo").addEventListener("click", async () => {
  const ps      = document.getElementById("ps-photo");
  const title   = document.getElementById("f-photo-title").value.trim();
  const text    = document.getElementById("f-photo-text").value.trim();
  const tag     = document.getElementById("f-photo-tag").value;
  const dateVal = document.getElementById("f-photo-date").value;
  const images  = [...document.querySelectorAll("#photo-url-list input")].map(i => i.value.trim()).filter(Boolean);
  if (!title)         { ps.textContent = "fehler: titel fehlt.";  return; }
  if (!images.length) { ps.textContent = "fehler: keine bilder."; return; }
  const posted_at = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();
  const entry = { type: "photo", title, images, text, posted_at };
  if (tag) entry.tag = tag;
  const ok = await pushToGithub(entry, posts, "posts.json", ps);
  if (ok) {
    posts.push(entry);
    mergePosts(); render();
    ["f-photo-title","f-photo-text","f-photo-date"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("photo-url-list").innerHTML = `<div class="photo-url-row"><input type="url" placeholder="https://..."><button onclick="this.parentElement.remove()" style="color:#c00;border-color:#c00">–</button></div>`;
  }
});

// ── SUBMIT ALBUM POST ─────────────────────────────────────────────────────────
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
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(albums, null, 2))));
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

  st.textContent = `0 / ${files.length} hochgeladen...`;
  let uploaded = 0;

  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path     = `img/${safeName}`;

    // base64 lesen
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = () => res(r.result.split(",")[1]);
      r.onerror = () => rej(new Error("Lesefehler"));
      r.readAsDataURL(file);
    });

    // existiert die Datei schon? sha holen
    let sha = null;
    try {
      const check = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
        { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } });
      if (check.ok) sha = (await check.json()).sha;
    } catch(e) {}

    const body = { message: `img: upload ${safeName}`, content: b64, branch };
    if (sha) body.sha = sha;

    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) { st.textContent = `fehler bei ${file.name}`; return; }

    // URL-Zeile ins Formular einfügen
    const url  = `https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/${path}`;
    const list = document.getElementById("photo-url-list");
    // ersten leeren URL-Slot befüllen, sonst neue Zeile
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
  }

  st.textContent = `✓ ${uploaded} bild${uploaded > 1 ? "er" : ""} hochgeladen`;
  this.value = ""; // reset input
});

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

  st.textContent = "lädt...";

  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path     = `img/${safeName}`;

    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = () => res(r.result.split(",")[1]);
      r.onerror = () => rej(new Error("Lesefehler"));
      r.readAsDataURL(file);
    });

    let sha = null;
    try {
      const check = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
        { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } });
      if (check.ok) sha = (await check.json()).sha;
    } catch(e) {}

    const body = { message: `img: upload ${safeName}`, content: b64, branch };
    if (sha) body.sha = sha;

    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) { st.textContent = `fehler bei ${file.name}`; return; }

    // nächste Bildnummer berechnen und [BildN] in textarea einfügen
    const existing = [...(ta.value.matchAll(/\[Bild(\d+)\]/gi))].map(m => parseInt(m[1]));
    const next = existing.length ? Math.max(...existing) + 1 : 1;
    const ref  = `[Bild${next}]`;
    const pos  = ta.selectionStart ?? ta.value.length;
    ta.value   = ta.value.slice(0, pos) + ref + ta.value.slice(pos);
    ta.focus();

    st.textContent = `✓ als ${ref} eingefügt`;
  }
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

function editorInsert(id, text) {
  const ta = document.getElementById(id);
  if (!ta) return;
  const pos = ta.selectionStart;
  // Bildnummer: nächste freie Nummer vorschlagen
  const existing = [...ta.value.matchAll(/\[Bild(\d+)\]/gi)].map(m => parseInt(m[1]));
  const next = existing.length ? Math.max(...existing) + 1 : 1;
  const insert = `[Bild${next}]`;
  ta.value = ta.value.slice(0, pos) + insert + ta.value.slice(pos);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = pos + insert.length;
}

// ── SHOW HIDDEN TOGGLE ────────────────────────────────────────────────────────
document.getElementById("btn-show-hidden").addEventListener("click", () => {
  showHidden = !showHidden;
  render();
});
