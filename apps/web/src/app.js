import * as chain from "./chain.js";

const state = {
  template: "range",
  oracle: null, // { oracleId, expiry, spotUsd, ... }
  spot: 65_000,
  lower: 63_000,
  upper: 67_000,
  third: 69_000,
  quantity: 5, // dollars of notional (payout units)
  address: null,
  costUnits: null, // real mint cost (quote base units) from devInspect
  quoting: false,
  notes: [],
};

const TEMPLATE_IDS = { range: 0, breakout: 1, ladder: 2 };
const templateCopy = {
  range: { title: "Stay in range", legs: "1 mint", flow: "deposit + mint_range", color: "#087f7a" },
  breakout: { title: "Big move", legs: "2 mints", flow: "deposit + mint + mint", color: "#c8475a" },
  ladder: { title: "Higher = more", legs: "3 mints", flow: "deposit + mint x3", color: "#334c8c" },
};
const templateByName = (id) => Object.keys(TEMPLATE_IDS).find((k) => TEMPLATE_IDS[k] === id) ?? "range";

const elements = {
  templateButtons: [...document.querySelectorAll(".template-card")],
  canvas: document.querySelector("#payoffCanvas"),
  title: document.querySelector("#templateTitle"),
  spot: document.querySelector("#spotLabel"),
  lowerInput: document.querySelector("#lowerInput"),
  upperInput: document.querySelector("#upperInput"),
  thirdInput: document.querySelector("#thirdInput"),
  quantityInput: document.querySelector("#quantityInput"),
  lowerValue: document.querySelector("#lowerValue"),
  upperValue: document.querySelector("#upperValue"),
  thirdValue: document.querySelector("#thirdValue"),
  quantityValue: document.querySelector("#quantityValue"),
  lowerLabel: document.querySelector("#lowerLabel"),
  upperLabel: document.querySelector("#upperLabel"),
  thirdControl: document.querySelector("#thirdControl"),
  costMetric: document.querySelector("#costMetric"),
  maxMetric: document.querySelector("#maxMetric"),
  chanceMetric: document.querySelector("#chanceMetric"),
  legsMetric: document.querySelector("#legsMetric"),
  flowStatus: document.querySelector("#flowStatus"),
  managerStatus: document.querySelector("#managerStatus"),
  createButton: document.querySelector("#createButton"),
  noteList: document.querySelector("#noteList"),
  noteCount: document.querySelector("#noteCount"),
  faucetButton: document.querySelector("#faucetButton"),
  walletButton: document.querySelector("#walletButton"),
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- model ----------

function strikesUsd() {
  if (state.template === "ladder") return [state.lower, state.upper, state.third];
  return [state.lower, state.upper];
}

function maxPayoutUnits() {
  const qty = chain.toQuoteUnits(state.quantity);
  return state.template === "ladder" ? qty * 3n : qty;
}

// dollar legs purely for the chart shape
function chartLegs() {
  if (state.template === "range") return [{ kind: "range", lower: state.lower, higher: state.upper, qty: state.quantity }];
  if (state.template === "breakout") {
    return [
      { kind: "binary", isUp: false, strike: state.lower, qty: state.quantity },
      { kind: "binary", isUp: true, strike: state.upper, qty: state.quantity },
    ];
  }
  return [
    { kind: "binary", isUp: true, strike: state.lower, qty: state.quantity },
    { kind: "binary", isUp: true, strike: state.upper, qty: state.quantity },
    { kind: "binary", isUp: true, strike: state.third, qty: state.quantity },
  ];
}

function payoffAt(legs, settle) {
  return legs.reduce((sum, leg) => {
    if (leg.kind === "range") return settle > leg.lower && settle <= leg.higher ? sum + leg.qty : sum;
    return leg.isUp ? (settle > leg.strike ? sum + leg.qty : sum) : settle <= leg.strike ? sum + leg.qty : sum;
  }, 0);
}

function chartMaxPayout(legs) {
  const min = Math.floor(state.spot * 0.72);
  const max = Math.ceil(state.spot * 1.28);
  let best = 0;
  for (let i = 0; i <= 320; i += 1) best = Math.max(best, payoffAt(legs, min + ((max - min) * i) / 320));
  return best;
}

function sanitizeStrikes() {
  const step = 50;
  if (state.lower >= state.upper) state.upper = state.lower + step;
  if (state.template === "ladder" && state.upper >= state.third) state.third = state.upper + step;
}

// ---------- real quote (debounced) ----------

let quoteTimer = null;
function scheduleQuote() {
  if (!state.oracle) return;
  state.quoting = true;
  elements.costMetric.textContent = "…";
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(runQuote, 350);
}

async function runQuote() {
  if (!state.oracle) return;
  const seq = ++quoteSeq;
  try {
    const legs = chain.buildLegs(state.template, strikesUsd(), chain.toQuoteUnits(state.quantity), state.oracle);
    const { costUnits } = await chain.quote(state.oracle, legs, state.address);
    if (seq !== quoteSeq) return; // stale
    state.costUnits = costUnits;
    state.quoting = false;
    renderMetrics();
  } catch (err) {
    if (seq !== quoteSeq) return;
    state.costUnits = null;
    state.quoting = false;
    elements.costMetric.textContent = "n/a";
    console.warn("quote failed", err);
  }
}
let quoteSeq = 0;

// ---------- render ----------

function renderMetrics() {
  const maxUnits = maxPayoutUnits();
  elements.maxMetric.textContent = money.format(chain.fromQuoteUnits(maxUnits));
  if (state.costUnits == null) {
    elements.costMetric.textContent = state.quoting ? "…" : "n/a";
    elements.chanceMetric.textContent = "—";
  } else {
    elements.costMetric.textContent = money.format(chain.fromQuoteUnits(state.costUnits));
    const chance = Number(state.costUnits) / Number(maxUnits);
    elements.chanceMetric.textContent = `${Math.round(Math.min(0.99, chance) * 100)}%`;
  }
  elements.legsMetric.textContent = templateCopy[state.template].legs;
  elements.flowStatus.textContent = templateCopy[state.template].flow;
}

function syncInputs() {
  elements.lowerInput.value = state.lower;
  elements.upperInput.value = state.upper;
  elements.thirdInput.value = state.third;
  elements.quantityInput.value = state.quantity;
  elements.lowerValue.value = currency.format(state.lower);
  elements.upperValue.value = currency.format(state.upper);
  elements.thirdValue.value = currency.format(state.third);
  elements.quantityValue.value = money.format(state.quantity);
  elements.thirdControl.style.display = state.template === "ladder" ? "grid" : "none";
  elements.lowerLabel.textContent = state.template === "ladder" ? "Strike 1" : "Lower strike";
  elements.upperLabel.textContent = state.template === "ladder" ? "Strike 2" : "Higher strike";
}

function render() {
  sanitizeStrikes();
  elements.templateButtons.forEach((b) => {
    const active = b.dataset.template === state.template;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", String(active));
  });
  elements.title.textContent = templateCopy[state.template].title;
  elements.spot.textContent = currency.format(state.spot);
  syncInputs();
  renderMetrics();
  drawChart();
  renderNotes();
}

function drawChart() {
  const canvas = elements.canvas;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(700, Math.floor(rect.width * ratio));
  canvas.height = Math.floor(430 * ratio);
  ctx.scale(ratio, ratio);
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const pad = { left: 62, right: 28, top: 28, bottom: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const minSettle = Math.floor(state.spot * 0.78);
  const maxSettle = Math.ceil(state.spot * 1.22);
  const legs = chartLegs();
  const topPayout = Math.max(chartMaxPayout(legs), state.quantity) * 1.15;
  const accent = templateCopy[state.template].color;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffaf2";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#e2dbcf";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }
  const xFor = (s) => pad.left + ((s - minSettle) / (maxSettle - minSettle)) * plotW;
  const yFor = (p) => pad.top + plotH - (p / topPayout) * plotH;

  ctx.fillStyle = "rgba(8, 127, 122, 0.1)";
  for (let i = 0; i < 220; i += 1) {
    const a = minSettle + ((maxSettle - minSettle) * i) / 220;
    const b = minSettle + ((maxSettle - minSettle) * (i + 1)) / 220;
    if (payoffAt(legs, (a + b) / 2) > 0) ctx.fillRect(xFor(a), pad.top, Math.max(1, xFor(b) - xFor(a)), plotH);
  }
  const spotX = xFor(state.spot);
  ctx.strokeStyle = "#191a1b";
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(spotX, pad.top);
  ctx.lineTo(spotX, pad.top + plotH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= 300; i += 1) {
    const settle = minSettle + ((maxSettle - minSettle) * i) / 300;
    const x = xFor(settle);
    const y = yFor(payoffAt(legs, settle));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = "#191a1b";
  ctx.font = "700 12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const tick of [minSettle, state.spot, maxSettle]) ctx.fillText(currency.format(tick), xFor(tick), height - 20);
  ctx.textAlign = "right";
  ctx.fillStyle = "#6e7470";
  ctx.fillText(money.format(0), pad.left - 10, yFor(0) + 4);
  ctx.fillText(money.format(Math.round(topPayout)), pad.left - 10, yFor(topPayout) + 10);
}

function renderNotes() {
  elements.noteCount.textContent = state.notes.length;
  elements.noteList.innerHTML = "";
  for (const note of state.notes) {
    const row = document.createElement("article");
    row.className = "note-row";
    row.innerHTML = `
      <header>
        <strong>${templateCopy[templateByName(note.template)].title}</strong>
        <span class="status-pill ${note.status === 0 ? "open" : "ready"}">${note.status === 0 ? "open" : "redeemed"}</span>
      </header>
      <small>${note.id.slice(0, 10)}… · max ${money.format(chain.fromQuoteUnits(note.maxPayout))} · cost ${money.format(chain.fromQuoteUnits(note.costPaid))}</small>
    `;
    elements.noteList.append(row);
  }
}

// ---------- actions ----------

async function refreshNotes() {
  if (!state.address) return;
  try {
    state.notes = await chain.listNotes(state.address);
    renderNotes();
  } catch (err) {
    console.warn("listNotes failed", err);
  }
}

async function onConnect() {
  try {
    elements.walletButton.textContent = "…";
    const addr = await chain.connect();
    state.address = addr;
    elements.walletButton.textContent = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    elements.createButton.disabled = false;
    await refreshNotes();
    scheduleQuote();
  } catch (err) {
    elements.walletButton.textContent = "Connect";
    alert(err.message);
  }
}

async function onCreate() {
  if (!state.address) return onConnect();
  if (!state.oracle) return;
  const setStatus = (t) => (elements.managerStatus.textContent = t);
  try {
    elements.createButton.disabled = true;
    elements.createButton.textContent = "Creating…";
    const maxPaymentUnits = chain.toQuoteUnits(state.quantity) * 3n;
    const digest = await chain.createNote({
      template: state.template,
      strikesUsd: strikesUsd(),
      qtyUnits: chain.toQuoteUnits(state.quantity),
      maxPaymentUnits,
      oracle: state.oracle,
      onStatus: setStatus,
    });
    setStatus(`minted · ${digest.slice(0, 10)}…`);
    elements.createButton.textContent = "Done ✓";
    await refreshNotes();
  } catch (err) {
    setStatus("error");
    alert(err.message);
  } finally {
    setTimeout(() => {
      elements.createButton.textContent = "Create";
      elements.createButton.disabled = false;
    }, 1500);
  }
}

// ---------- init ----------

function rebaseStrikes(spot) {
  const round = (v) => Math.round(v / 50) * 50;
  state.spot = spot;
  state.lower = round(spot * 0.985);
  state.upper = round(spot * 1.015);
  state.third = round(spot * 1.03);
  const lo = round(spot * 0.9);
  const hi = round(spot * 1.1);
  for (const input of [elements.lowerInput, elements.upperInput, elements.thirdInput]) {
    input.min = lo;
    input.max = hi;
    input.step = 50;
  }
}

async function init() {
  render();
  elements.createButton.disabled = true;
  elements.managerStatus.textContent = "connect wallet";
  try {
    elements.spot.textContent = "loading…";
    const oracle = await chain.loadActiveOracle();
    state.oracle = oracle;
    rebaseStrikes(Math.round(oracle.spotUsd));
    render();
    scheduleQuote();
  } catch (err) {
    elements.spot.textContent = "oracle offline";
    console.warn("oracle load failed", err);
  }
}

elements.templateButtons.forEach((b) =>
  b.addEventListener("click", () => {
    state.template = b.dataset.template;
    render();
    scheduleQuote();
  }),
);
elements.lowerInput.addEventListener("input", (e) => { state.lower = Number(e.target.value); render(); scheduleQuote(); });
elements.upperInput.addEventListener("input", (e) => { state.upper = Number(e.target.value); render(); scheduleQuote(); });
elements.thirdInput.addEventListener("input", (e) => { state.third = Number(e.target.value); render(); scheduleQuote(); });
elements.quantityInput.addEventListener("input", (e) => { state.quantity = Number(e.target.value); render(); scheduleQuote(); });
elements.createButton.addEventListener("click", onCreate);
elements.walletButton.addEventListener("click", onConnect);
elements.faucetButton.addEventListener("click", () => window.open("https://tally.so/r/Xx102L", "_blank"));
window.addEventListener("resize", drawChart);

init();
