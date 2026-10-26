// Affichage seulement : les données sont calculées par le serveur et injectées
// dans la page (#chart-data).
(() => {
  const source = document.getElementById("chart-data");
  const canvas = document.getElementById("chart");
  if (!source || !canvas || !window.Chart) return;

  const data = JSON.parse(source.textContent);
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
  const eurShort = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", notation: "compact" });

  Chart.defaults.color = token("--muted");
  Chart.defaults.borderColor = token("--border");
  Chart.defaults.font.family = token("--font");

  const datasets = data.accounts.map((a) => ({
    type: "bar",
    label: a.name,
    data: a.values,
    backgroundColor: a.color,
    stack: "valeur",
    borderRadius: 2,
    maxBarThickness: 56,
    order: 2,
  }));
  if (data.invested.some((v) => v !== null)) {
    datasets.unshift({
      type: "line",
      label: "Capital investi",
      data: data.invested,
      stack: "investi",
      borderColor: token("--ink"),
      backgroundColor: token("--ink"),
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.2,
      order: 1,
    });
  }

  new Chart(canvas, {
    data: { labels: data.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => eurShort.format(v) } },
      },
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            label: (ctx) => (ctx.parsed.y === null ? null : ` ${ctx.dataset.label} : ${eur.format(ctx.parsed.y)}`),
            footer: (items) => {
              const bars = items.filter((i) => i.dataset.type === "bar");
              return bars.length ? `Total : ${eur.format(bars.reduce((s, i) => s + (i.parsed.y ?? 0), 0))}` : "";
            },
          },
        },
      },
    },
  });
})();
