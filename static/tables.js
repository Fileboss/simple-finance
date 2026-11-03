// Barre de défilement sous les seules colonnes qui défilent : la barre native du
// tableau passerait sous la colonne figée. Elle est masquée et remplacée par une
// barre synchronisée, décalée de la largeur de cette colonne. Sans JS, la barre
// native reste.
(() => {
  for (const wrap of document.querySelectorAll(".table-wrap")) {
    const label = wrap.querySelector("tbody th");
    if (!label) continue;
    const bar = document.createElement("div");
    bar.className = "hscroll";
    bar.setAttribute("aria-hidden", "true");
    const track = document.createElement("div");
    bar.append(track);
    wrap.after(bar);
    wrap.classList.add("has-hscroll");

    const fit = () => {
      const w = label.offsetWidth;
      bar.style.marginLeft = `calc(var(--card-pad) * -1 + ${w}px)`;
      // Même course que le tableau : la barre est plus étroite de w, sa piste aussi.
      track.style.width = `${wrap.scrollWidth - w}px`;
      bar.hidden = wrap.scrollWidth <= wrap.clientWidth;
      bar.scrollLeft = wrap.scrollLeft;
    };
    wrap.addEventListener("scroll", () => (bar.scrollLeft = wrap.scrollLeft), { passive: true });
    bar.addEventListener("scroll", () => (wrap.scrollLeft = bar.scrollLeft), { passive: true });
    new ResizeObserver(fit).observe(wrap);
    fit();
  }
})();
