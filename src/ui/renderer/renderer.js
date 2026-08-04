// Renderer logic. Talks to the main process only through window.airlock (preload).
const api = window.airlock;

// ---- Tab navigation --------------------------------------------------------
const navItems = document.querySelectorAll(".nav-item");
const tabs = document.querySelectorAll(".tab");
navItems.forEach((item) => {
  item.addEventListener("click", () => {
    navItems.forEach((n) => n.classList.remove("active"));
    tabs.forEach((t) => t.classList.remove("active"));
    item.classList.add("active");
    document.getElementById(`tab-${item.dataset.tab}`).classList.add("active");
    if (item.dataset.tab === "logs") loadLogs();
  });
});

// ---- Helpers ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const fmtBool = (b) => (b ? "Yes" : "No");
const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString();
const fmtDateTime = (ts) => new Date(ts * 1000).toLocaleString();

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

// ---- Dashboard rendering ---------------------------------------------------
function renderContext(ctx) {
  if (!ctx) return;
  $("mIdle").textContent = `${ctx.idleTime}s`;
  $("mKeyboard").textContent = fmtBool(ctx.keyboardActive);
  $("mMouse").textContent = fmtBool(ctx.mouseActive);
  $("mSSID").textContent = ctx.wifiSSID || "–";
  $("mRssi").textContent = ctx.rssi;
  $("mMoving").textContent = fmtBool(ctx.phoneMoving);
  $("mBattery").textContent = `${ctx.battery}%`;
  $("mCharging").textContent = fmtBool(ctx.charging);

  const decision = ctx.decision || "WAIT";
  const badge = $("decisionBadge");
  badge.textContent = decision;
  badge.className = `decision-badge ${decision}`;
  $("decisionReason").textContent = ctx.reason || "–";

  const conf = typeof ctx.confidence === "number" ? ctx.confidence : null;
  $("confidenceValue").textContent = conf === null ? "–" : `${conf}%`;
  $("confidenceFill").style.width = conf === null ? "0%" : `${conf}%`;
}

function renderRobot(status) {
  if (!status) return;
  $("rState").textContent = status.state;
  $("rBattery").textContent = `${status.batteryLevel}%`;
  $("rDistance").textContent = `${status.distanceToNearestObject} cm`;
  $("rIntruder").textContent = fmtBool(status.intruderDetected);
  $("intruderAlert").classList.toggle("hidden", !status.intruderDetected);
}

// ---- Status pills ----------------------------------------------------------
function setPill(id, ok, label) {
  const el = $(id);
  el.className = `pill ${ok ? "ok" : "bad"}`;
  el.querySelector("span").textContent = label;
}

// ---- Logs ------------------------------------------------------------------
async function loadLogs() {
  const rows = await api.getHistory(200);
  const dateFilter = $("filterDate").value;
  const decisionFilter = $("filterDecision").value;
  const tbody = document.querySelector("#logsTable tbody");
  tbody.innerHTML = "";

  rows
    .filter((r) => {
      if (decisionFilter && r.decision !== decisionFilter) return false;
      if (dateFilter) {
        const d = new Date(r.timestamp * 1000).toISOString().slice(0, 10);
        if (d !== dateFilter) return false;
      }
      return true;
    })
    .forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fmtDateTime(r.timestamp)}</td>
        <td>${r.idleTime}s</td>
        <td>${fmtBool(r.keyboardActive)}</td>
        <td>${fmtBool(r.mouseActive)}</td>
        <td>${r.wifiSSID || "–"}</td>
        <td>${r.rssi}</td>
        <td>${fmtBool(r.phoneMoving)}</td>
        <td>${r.battery}%</td>
        <td class="${r.decision || ""}">${r.decision || "–"}</td>
        <td>${typeof r.confidence === "number" ? r.confidence + "%" : "–"}</td>
        <td>${r.reason || "–"}</td>`;
      tbody.appendChild(tr);
    });
}

$("btnRefreshLogs").addEventListener("click", loadLogs);
$("filterDate").addEventListener("change", loadLogs);
$("filterDecision").addEventListener("change", loadLogs);

// ---- Settings --------------------------------------------------------------
async function loadSettings() {
  const s = await api.getSettings();
  if (!s) return;
  $("sensitivity").value = s.sensitivityLevel;
  $("sensVal").textContent = s.sensitivityLevel;
  $("idleThreshold").value = s.idleThreshold;
  $("rssiThreshold").value = s.rssiThreshold;
  $("useAiEngine").checked = !!s.useAiEngine;
  $("mqttBrokerUrl").value = s.mqttBrokerUrl || "";
  setPill("aiPill", s.useAiEngine, s.useAiEngine ? "on" : "off");
}

$("sensitivity").addEventListener("input", (e) => {
  $("sensVal").textContent = e.target.value;
});

$("btnSaveSettings").addEventListener("click", async () => {
  const partial = {
    sensitivityLevel: Number($("sensitivity").value),
    idleThreshold: Number($("idleThreshold").value),
    rssiThreshold: Number($("rssiThreshold").value),
    useAiEngine: $("useAiEngine").checked,
    mqttBrokerUrl: $("mqttBrokerUrl").value.trim(),
  };
  const updated = await api.updateSettings(partial);
  $("saveStatus").textContent = "Saved ✓";
  setTimeout(() => ($("saveStatus").textContent = ""), 2000);
  if (updated) {
    $("idleThreshold").value = updated.idleThreshold;
    $("rssiThreshold").value = updated.rssiThreshold;
    setPill("aiPill", updated.useAiEngine, updated.useAiEngine ? "on" : "off");
  }
});

// ---- Manual actions --------------------------------------------------------
$("btnLock").addEventListener("click", async () => {
  await api.manualLock();
  toast("Lock command sent");
});
$("btnUnlock").addEventListener("click", async () => {
  await api.manualUnlock();
  toast("Unlock / reset sent");
});

// ---- Live event wiring -----------------------------------------------------
api.onContext((ctx) => renderContext(ctx));
api.onRobotStatus((status) => renderRobot(status));
api.onLockEvent((e) => toast(`${e.action} (${e.trigger})`));

// ---- Init ------------------------------------------------------------------
(async function init() {
  renderContext(await api.getContext());
  renderRobot(await api.getRobotStatus());
  await loadSettings();
  // Poll pills for MQTT/robot presence.
  setInterval(async () => {
    const status = await api.getRobotStatus();
    setPill("mqttPill", !!status, status ? "linked" : "no data");
  }, 3000);
})();
