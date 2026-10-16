// 녹화 중 모든 페이지에 주입되는 연출 레이어: 장면 전환 커튼, 가짜 커서·클릭 물결, 오른쪽 설명 패널(휴대폰 장면),
// 하단 자막(PC 장면), 스포트라이트 강조. 앱 코드는 건드리지 않고 화면 위에만 얹는다.
(() => {
  if (window.__ov) return;
  const FONT = "'Noto Sans KR','Pretendard','Malgun Gothic',sans-serif";
  const css = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap');
  html::before { content:''; position:fixed; inset:0; background:#E8F0FA; z-index:2147483646; pointer-events:none; transition:opacity .6s ease; }
  html.ov-open::before { opacity:0; }
  html[data-ov-stage=phone] body { background: radial-gradient(1100px 900px at 28% 50%, #F6FAFF 0%, #E8F0FA 60%) !important; }
  html[data-ov-stage=phone] .phone { transform: translateX(-360px) scale(1.18); box-shadow: 0 30px 90px rgba(10,37,69,.20) !important; }
  html[data-ov-stage=phone] .mode-pill { display:none !important; }
  html[data-ov-stage=admin] body { zoom: 1.25; }
  html[data-ov-stage=admin] .c-modal { max-height: 72vh; }
  html[data-ov-stage] ::-webkit-scrollbar { width:0 !important; height:0 !important; }
  #__ov { position:fixed; inset:0; pointer-events:none; z-index:2147483647; font-family:${FONT}; }
  #__cursor { position:absolute; left:0; top:0; width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:50%;
    background:rgba(255,255,255,.95); border:3px solid #1B5ED0; box-shadow:0 4px 14px rgba(10,37,69,.35); opacity:0;
    transition: left .55s cubic-bezier(.3,.7,.2,1), top .55s cubic-bezier(.3,.7,.2,1), opacity .3s; }
  #__cursor.on { opacity:1; }
  .__ripple { position:absolute; width:20px; height:20px; margin:-10px 0 0 -10px; border-radius:50%; border:3px solid #1B5ED0;
    animation: __rip .6s ease-out forwards; }
  @keyframes __rip { from { transform:scale(.4); opacity:1 } to { transform:scale(3.2); opacity:0 } }
  #__panel { position:absolute; left:1010px; top:50%; width:860px; transform:translateY(-50%); color:#0A2545; opacity:0; transition:opacity .4s; }
  #__panel.on { opacity:1; }
  #__panel .k { display:inline-block; font-size:28px; font-weight:800; color:#1B5ED0; letter-spacing:.5px; margin-bottom:22px; }
  #__panel .t, #__panel .b { width:fit-content; max-width:100%; }
  #__panel .t { font-size:62px; font-weight:900; line-height:1.2; letter-spacing:-1.5px; margin-bottom:26px; color:#0A2545; }
  #__panel .b { font-size:30px; line-height:1.6; color:#41536C; font-weight:500; }
  #__panel .b b { color:#0A2545; font-weight:800; }
  #__panel.anim .k { animation:__up .5s both; } #__panel.anim .t { animation:__up .55s .08s both; } #__panel.anim .b { animation:__up .55s .18s both; }
  @keyframes __up { from { transform:translateY(26px); opacity:0 } to { transform:none; opacity:1 } }
  #__steps { position:absolute; left:1010px; top:120px; display:flex; gap:10px; opacity:0; transition:opacity .4s; }
  #__steps.on { opacity:1; }
  #__steps span { font-size:20px; font-weight:700; padding:8px 18px; border-radius:8px; color:#586B84; background:#fff; border:2px solid #C3CEE1; }
  #__steps span.on { background:#1B5ED0; border-color:#1B5ED0; color:#fff; }
  #__cap { position:absolute; left:50%; bottom:54px; transform:translateX(-50%); display:flex; align-items:center; gap:18px; padding:20px 34px;
    background:rgba(10,37,69,.95); border-radius:12px; box-shadow:0 18px 50px rgba(10,37,69,.30); opacity:0; transition:opacity .35s; max-width:1500px; }
  #__cap.on { opacity:1; }
  #__cap.anim { animation:__up .45s both; }
  #__cap .k { font-size:22px; font-weight:800; color:#fff; background:#1B5ED0; padding:6px 14px; border-radius:8px; white-space:nowrap; }
  #__cap .t { font-size:32px; font-weight:800; color:#fff; letter-spacing:-.5px; }
  #__cap .t b { color:#9CC0FF; }
  #__dim { position:absolute; inset:0; width:100%; height:100%; opacity:0; transition:opacity .45s; }
  #__dim.on { opacity:1; }
  .__ring { position:absolute; border-radius:14px; border:4px solid #1B5ED0; box-shadow:0 0 28px rgba(27,94,208,.45); opacity:0; transition:opacity .45s; }
  .__ring.on { opacity:1; }
  .__lbl { position:absolute; padding:10px 18px; border-radius:8px; background:#1B5ED0; color:#fff; font-size:24px; font-weight:800; white-space:nowrap; opacity:0; transition:opacity .4s .15s; }
  .__lbl.on { opacity:1; }
  #__panel.__lift { z-index:3; }
  `;
  // 주입 시점에는 <html>이 아직 없을 수 있어, 생기는 즉시 스타일을 붙인다(커튼이 첫 화면부터 덮이도록).
  const addStyle = () => {
    if (document.getElementById("__ovstyle") || !document.documentElement) return !!document.getElementById("__ovstyle");
    const style = document.createElement("style");
    style.id = "__ovstyle";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return true;
  };
  if (!addStyle()) {
    const mo = new MutationObserver(() => { if (addStyle()) mo.disconnect(); });
    mo.observe(document, { childList: true, subtree: true });
  }

  const el = (id) => document.getElementById(id);
  const mount = () => {
    addStyle();
    if (el("__ov") || !document.body) return; // 관리자 화면은 body를 확대하므로 연출 레이어는 <html> 바로 아래에 둔다
    const root = document.createElement("div");
    root.id = "__ov";
    root.innerHTML = `<div id="__steps"></div><div id="__panel"><div class="k"></div><div class="t"></div><div class="b"></div></div>
      <svg id="__dim"><defs><mask id="__mask"><rect width="100%" height="100%" fill="#fff"/><g id="__holes"></g></mask></defs><rect width="100%" height="100%" fill="rgba(10,37,69,.42)" mask="url(#__mask)"/></svg><div id="__rings"></div><div id="__cap"><span class="k"></span><span class="t"></span></div><div id="__cursor"></div>`;
    document.documentElement.appendChild(root);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  const replay = (node) => { node.classList.remove("anim"); void node.offsetWidth; node.classList.add("anim"); };

  window.__ov = {
    open() { document.documentElement.classList.add("ov-open"); },
    close() { document.documentElement.classList.remove("ov-open"); },
    stage(mode) { if (mode) document.documentElement.dataset.ovStage = mode; else delete document.documentElement.dataset.ovStage; },
    steps(labels, active) {
      mount();
      const s = el("__steps");
      s.innerHTML = labels.map((l, i) => `<span class="${i === active ? "on" : ""}">${l}</span>`).join("");
      s.classList.add("on");
    },
    panel(k, t, b, size) {
      mount();
      const p = el("__panel");
      p.querySelector(".t").style.fontSize = size ? size + "px" : "";
      p.querySelector(".k").innerHTML = k; p.querySelector(".t").innerHTML = t; p.querySelector(".b").innerHTML = b || "";
      p.classList.add("on"); replay(p);
    },
    cap(k, t) {
      mount();
      const c = el("__cap");
      c.querySelector(".k").innerHTML = k; c.querySelector(".t").innerHTML = t;
      c.classList.add("on"); replay(c);
    },
    capHide() { el("__cap")?.classList.remove("on"); },
    cursor(x, y) { mount(); const c = el("__cursor"); c.classList.add("on"); c.style.left = x + "px"; c.style.top = y + "px"; },
    ripple(x, y) {
      const r = document.createElement("div"); r.className = "__ripple"; r.style.left = x + "px"; r.style.top = y + "px";
      el("__ov").appendChild(r); setTimeout(() => r.remove(), 700);
    },
    /** 여러 영역을 한 번에 강조한다. 각 항목은 {x,y,w,h} 좌표 또는 {sel}(연출 레이어 안 요소, 예: 오른쪽 패널 문구)와 선택 label. */
    spots(items) {
      mount();
      const pad = 10, holes = el("__holes"), rings = el("__rings");
      holes.innerHTML = ""; rings.innerHTML = "";
      for (const it of items) {
        if (it.plain) { document.querySelector(it.sel)?.classList.add("__lift"); continue; }
        let { x, y, w, h } = it;
        if (it.sel) {
          // 안쪽 글자가 상자 밖으로 넘쳐도 다 감싸도록 자손 요소까지 합친 범위를 쓴다
          const node = document.querySelector(it.sel);
          const rs = [node, ...node.querySelectorAll("*")].map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.height);
          x = Math.min(...rs.map((r) => r.left)); y = Math.min(...rs.map((r) => r.top));
          w = Math.max(...rs.map((r) => r.right)) - x; h = Math.max(...rs.map((r) => r.bottom)) - y;
          y -= 4; h += 8;
        }
        const X = x - pad, Y = y - pad, W = w + pad * 2, H = h + pad * 2;
        holes.insertAdjacentHTML("beforeend", `<rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="16" fill="#000"/>`);
        if (it.plain) { document.querySelector(it.sel)?.classList.add("__lift"); continue; } // 강조 없이 어두운 막 위로 올려 보여만 준다
        const ring = document.createElement("div");
        ring.className = "__ring"; Object.assign(ring.style, { left: X + "px", top: Y + "px", width: W + "px", height: H + "px" });
        rings.appendChild(ring);
        if (it.label) {
          const l = document.createElement("div");
          l.className = "__lbl"; l.textContent = it.label; rings.appendChild(l);
          const below = Y + H + 64 < innerHeight;
          const left = Math.max(16, Math.min(X, innerWidth - l.offsetWidth - 24)); // 화면 오른쪽 끝에 걸리면 안쪽으로
          Object.assign(l.style, { left: left + "px", top: (below ? Y + H + 14 : Y - 60) + "px" });
        }
      }
      el("__dim").classList.add("on");
      requestAnimationFrame(() => rings.querySelectorAll(".__ring, .__lbl").forEach((n) => n.classList.add("on")));
    },
    spot(x, y, w, h, label) { this.spots([{ x, y, w, h, label }]); },
    spotHide() { document.querySelectorAll(".__lift").forEach((n) => n.classList.remove("__lift")); el("__dim")?.classList.remove("on"); el("__rings") && (el("__rings").innerHTML = ""); setTimeout(() => { if (!el("__dim")?.classList.contains("on")) el("__holes").innerHTML = ""; }, 500); },
  };
})();
