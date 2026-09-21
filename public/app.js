(function () {
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: opts.body ? { "content-type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || "Něco se nepovedlo");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Kam patří uživatel po přihlášení. */
  function home(u) {
    if (u.isSuperadmin) return "/admin";
    if (u.memberships.some((m) => m.role === "parent")) return "/parent";
    if (u.memberships.length) return "/child";
    return null;
  }

  const MARK =
    '<svg viewBox="0 0 32 36" aria-hidden="true"><path d="M16 1 30 6v11c0 9-6 15-14 18C8 32 2 26 2 17V6z" fill="var(--accent)" stroke="var(--outline)" stroke-width="2.5" stroke-linejoin="round"/><path d="M11 10v16M21 10v16M11 18h10" stroke="var(--accent-ink)" stroke-width="3.5" stroke-linecap="round"/></svg>';

  function header(u, current) {
    const links = [];
    if (u.isSuperadmin) links.push(["admin", "/admin", "Správa"]);
    if (u.memberships.some((m) => m.role === "parent")) links.push(["parent", "/parent", "Rodič"]);
    if (u.memberships.some((m) => m.role === "child")) links.push(["child", "/child", "Dítě"]);
    if (u.isSuperadmin || u.memberships.length) links.push(["game", "/game", "Hra"]);
    return (
      '<header class="top"><div class="mark disp">' + MARK + "Household Hero</div>" +
      '<nav class="nav" aria-label="Menu">' +
      links.map((l) => '<a href="' + l[1] + '"' + (l[0] === current ? ' aria-current="page"' : "") + ">" + l[2] + "</a>").join("") +
      '<span class="who">' + esc(u.displayName) + '</span><a href="/password">Heslo</a>' +
      '<button type="button" data-logout>Odhlásit</button></nav></header>'
    );
  }

  let tt;
  function toast(msg, bad) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.toggle("bad", !!bad);
    t.classList.add("on");
    clearTimeout(tt);
    tt = setTimeout(() => t.classList.remove("on"), 3200);
  }

  /** 12 znaků bez zaměnitelných (0/O, 1/l/I). */
  function genPassword() {
    const A = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const r = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(r, (x) => A[x % A.length]).join("");
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-logout]")) {
      api("/api/auth/logout", { method: "POST" }).then(() => (location.href = "/"), () => (location.href = "/"));
    }
  });

  window.hh = { api, esc, home, header, toast, genPassword, MARK };
})();
