(function () {
  const chips = document.getElementById("chips");
  const q = document.getElementById("q");
  const empty = document.getElementById("empty");
  const rules = Array.from(document.querySelectorAll(".rule"));
  const sections = Array.from(document.querySelectorAll(".section[data-cat]"));
  let filter = "all";

  function apply() {
    const kw = (q.value || "").trim().toLowerCase();
    let visibleRules = 0;

    rules.forEach((el) => {
      const text = el.textContent.toLowerCase();
      const tags = (el.dataset.tags || "").toLowerCase();
      const section = el.closest("[data-cat]");
      const cat = section ? section.dataset.cat : "";
      const catOk = filter === "all" || cat === filter || tags.includes(filter);
      const kwOk = !kw || text.includes(kw) || tags.includes(kw);
      const show = catOk && kwOk;
      el.classList.toggle("hidden", !show);
      if (show) visibleRules += 1;
    });

    sections.forEach((sec) => {
      const any = sec.querySelector(".rule:not(.hidden)");
      sec.style.display = any ? "" : "none";
    });

    empty.classList.toggle("show", visibleRules === 0);
  }

  chips.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    filter = btn.dataset.filter || "all";
    chips.querySelectorAll(".chip").forEach((c) => {
      c.setAttribute("aria-pressed", c === btn ? "true" : "false");
    });
    apply();
  });

  q.addEventListener("input", apply);

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".copy");
    if (!btn) return;
    const card = btn.closest(".rule");
    const cmd = card ? card.querySelector(".cmd") : null;
    const text = cmd ? cmd.textContent.replace(/\s+$/, "") : "";
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const prev = btn.textContent;
    btn.textContent = "已复制";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = prev;
      btn.classList.remove("copied");
    }, 1200);
  });

  apply();
})();
