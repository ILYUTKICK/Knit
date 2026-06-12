const state = {
  template: "range",
  spot: 65_000,
  lower: 60_000,
  upper: 70_000,
  third: 73_000,
  quantity: 10,
  notes: [],
};

const templateCopy = {
  range: {
    title: "В коридоре",
    legs: "1 mint",
    flow: "deposit + mint_range",
    color: "#087f7a",
  },
  breakout: {
    title: "Будет движ",
    legs: "2 mints",
    flow: "deposit + mint + mint",
    color: "#c8475a",
  },
  ladder: {
    title: "Чем выше",
    legs: "3 mints",
    flow: "deposit + mint x3",
    color: "#334c8c",
  },
};

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
  createButton: document.querySelector("#createButton"),
  noteList: document.querySelector("#noteList"),
  noteCount: document.querySelector("#noteCount"),
  faucetButton: document.querySelector("#faucetButton"),
  walletButton: document.querySelector("#walletButton"),
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function legsForState() {
  if (state.template === "range") {
    return [{ kind: "range", lower: state.lower, higher: state.upper, qty: state.quantity }];
  }

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

function maxPayout(legs) {
  const min = Math.floor(state.spot * 0.72);
  const max = Math.ceil(state.spot * 1.28);
  let best = 0;
  for (let i = 0; i <= 320; i += 1) {
    best = Math.max(best, payoffAt(legs, min + ((max - min) * i) / 320));
  }
  return best;
}

function estimatedChance(legs) {
  const min = Math.floor(state.spot * 0.72);
  const max = Math.ceil(state.spot * 1.28);
  let wins = 0;
  const samples = 500;
  for (let i = 0; i < samples; i += 1) {
    const x = min + ((max - min) * i) / (samples - 1);
    if (payoffAt(legs, x) > 0) wins += 1;
  }
  return wins / samples;
}

function estimateCost(legs) {
  const chance = estimatedChance(legs);
  const payout = maxPayout(legs);
  const spread = state.template === "ladder" ? 0.09 : 0.07;
  return Math.max(0.25, payout * Math.min(0.99, chance + spread));
}

function sanitizeStrikes() {
  if (state.lower >= state.upper) state.upper = state.lower + 250;
  if (state.template === "ladder" && state.upper >= state.third) state.third = state.upper + 250;
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
  const legs = legsForState();
  const topPayout = Math.max(maxPayout(legs), state.quantity) * 1.15;
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

  const xFor = (settle) => pad.left + ((settle - minSettle) / (maxSettle - minSettle)) * plotW;
  const yFor = (payout) => pad.top + plotH - (payout / topPayout) * plotH;

  ctx.fillStyle = "rgba(8, 127, 122, 0.1)";
  for (let i = 0; i < 220; i += 1) {
    const a = minSettle + ((maxSettle - minSettle) * i) / 220;
    const b = minSettle + ((maxSettle - minSettle) * (i + 1)) / 220;
    if (payoffAt(legs, (a + b) / 2) > 0) {
      ctx.fillRect(xFor(a), pad.top, Math.max(1, xFor(b) - xFor(a)), plotH);
    }
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
  for (const tick of [minSettle, state.spot, maxSettle]) {
    ctx.fillText(currency.format(tick), xFor(tick), height - 20);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "#6e7470";
  ctx.fillText(money.format(0), pad.left - 10, yFor(0) + 4);
  ctx.fillText(money.format(Math.round(topPayout)), pad.left - 10, yFor(topPayout) + 10);
}

function render() {
  sanitizeStrikes();
  const legs = legsForState();
  const chance = estimatedChance(legs);
  const cost = estimateCost(legs);
  const max = maxPayout(legs);

  elements.templateButtons.forEach((button) => {
    const active = button.dataset.template === state.template;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  elements.title.textContent = templateCopy[state.template].title;
  elements.spot.textContent = currency.format(state.spot);
  elements.costMetric.textContent = money.format(cost);
  elements.maxMetric.textContent = money.format(max);
  elements.chanceMetric.textContent = `${Math.round(chance * 100)}%`;
  elements.legsMetric.textContent = templateCopy[state.template].legs;
  elements.flowStatus.textContent = templateCopy[state.template].flow;

  syncInputs();
  drawChart();
  renderNotes();
}

function renderNotes() {
  elements.noteCount.textContent = state.notes.length;
  elements.noteList.innerHTML = "";

  for (const note of state.notes) {
    const row = document.createElement("article");
    row.className = "note-row";
    row.innerHTML = `
      <header>
        <strong>${note.title}</strong>
        <span class="status-pill ${note.status}">${note.status}</span>
      </header>
      <small>${note.legs} · max ${money.format(note.max)} · cost ${money.format(note.cost)}</small>
    `;
    elements.noteList.append(row);
  }
}

function createNote() {
  const legs = legsForState();
  const note = {
    title: templateCopy[state.template].title,
    status: state.notes.length % 3 === 2 ? "ready" : "open",
    legs: templateCopy[state.template].legs,
    max: maxPayout(legs),
    cost: estimateCost(legs),
  };
  state.notes = [note, ...state.notes].slice(0, 6);
  render();
}

elements.templateButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.template = button.dataset.template;
    render();
  });
});

elements.lowerInput.addEventListener("input", (event) => {
  state.lower = Number(event.target.value);
  render();
});

elements.upperInput.addEventListener("input", (event) => {
  state.upper = Number(event.target.value);
  render();
});

elements.thirdInput.addEventListener("input", (event) => {
  state.third = Number(event.target.value);
  render();
});

elements.quantityInput.addEventListener("input", (event) => {
  state.quantity = Number(event.target.value);
  render();
});

elements.createButton.addEventListener("click", createNote);

elements.faucetButton.addEventListener("click", () => {
  elements.faucetButton.textContent = "OK";
  window.setTimeout(() => {
    elements.faucetButton.textContent = "D";
  }, 900);
});

elements.walletButton.addEventListener("click", () => {
  elements.walletButton.textContent = elements.walletButton.textContent === "Google" ? "0x9f...21" : "Google";
});

window.addEventListener("resize", drawChart);
render();
