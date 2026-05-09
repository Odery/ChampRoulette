// ChampRoulette frontend — bracket view with hold-to-confirm gesture,
// optional sequential mode, full-screen champion modal.

const ICON_BASE = "https://ddragon.leagueoflegends.com/cdn";
const ICON_VARIANT = "img/champion";
const HOLD_DURATION_MS = 3000;

// Bracket geometry. The container is a fixed-width virtual canvas;
// the wrapper handles overflow on narrow screens.
const BRACKET_W = 1040;
const BOX_W = 110;
const BOX_H = 64;
const ROUND_H = 124;
const TOP_PAD = 12;
const SIDE_PAD = 16;

const root = document.getElementById("app");
const toastHost = document.getElementById("toast-host");

let state = null;

// ---------- Bootstrap ----------

init();

async function init() {
    try {
        const data = await api("/api/state");
        state = data.state;
    } catch (err) {
        console.error("initial state load failed", err);
        state = null;
    }
    render();
}

// ---------- API ----------

async function api(path, opts = {}) {
    const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        ...opts,
    });
    let data = {};
    try {
        data = await res.json();
    } catch {
        /* allow empty bodies */
    }
    if (!res.ok) {
        throw new Error(data.error || `request failed (${res.status})`);
    }
    return data;
}

// ---------- Render dispatch ----------

function render() {
    if (!state) {
        renderSetup();
    } else {
        renderTournament();
    }
}

// ---------- Setup screen ----------

function renderSetup() {
    // Make sure no leftover modal hangs around.
    closeModal();

    const playersBox = el("div", { id: "players" });

    const toggle = el("label", { class: "toggle" }, [
        el("input", { type: "checkbox", id: "sequential-toggle" }),
        el("span", { class: "toggle-track" }, [el("span", { class: "toggle-thumb" })]),
        el("span", { class: "toggle-label" }, ["One match at a time"]),
    ]);

    const toggleHint = el("div", { class: "toggle-hint" }, [
        "When on, only one match is decidable at a time — winners wait until earlier matches finish.",
    ]);

    root.replaceChildren(
        el("section", { class: "panel" }, [
            el("h2", { class: "panel-title" }, ["Summon the Players"]),
            playersBox,
            el("div", { class: "toggle-row" }, [toggle, toggleHint]),
            el("div", { class: "actions" }, [
                el("button", { class: "btn", id: "add-player", type: "button" }, ["+ Add Player"]),
                el("button", { class: "btn btn-primary", id: "start", type: "button" }, [
                    "Draft",
                    el("span", { class: "go-arrow" }, ["→"]),
                ]),
            ]),
        ]),
    );

    addPlayerRow(playersBox);
    addPlayerRow(playersBox);
    refreshAddButton(playersBox);

    document.getElementById("add-player").addEventListener("click", () => {
        if (countRows(playersBox) < 5) {
            addPlayerRow(playersBox);
            refreshAddButton(playersBox);
            const inputs = playersBox.querySelectorAll("input");
            inputs[inputs.length - 1].focus();
        }
    });

    document.getElementById("start").addEventListener("click", startTournament);

    playersBox.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            startTournament();
        }
    });

    const first = playersBox.querySelector("input");
    if (first) first.focus();
}

function countRows(host) {
    return host.querySelectorAll(".player-row").length;
}

function refreshAddButton(host) {
    const btn = document.getElementById("add-player");
    if (btn) btn.disabled = countRows(host) >= 5;
}

function addPlayerRow(host) {
    const idx = countRows(host) + 1;
    const row = el("div", { class: "player-row" }, [
        el("span", { class: "player-index" }, [String(idx)]),
        el("input", {
            type: "text",
            placeholder: `Summoner ${idx}`,
            maxlength: "32",
            autocomplete: "off",
        }),
        el("button", { class: "btn btn-icon", type: "button", title: "Remove player" }, ["×"]),
    ]);

    row.querySelector("button").addEventListener("click", () => {
        if (countRows(host) > 2) {
            row.remove();
            renumberRows(host);
            refreshAddButton(host);
        }
    });

    host.appendChild(row);
}

function renumberRows(host) {
    const rows = host.querySelectorAll(".player-row");
    rows.forEach((row, i) => {
        row.querySelector(".player-index").textContent = String(i + 1);
        const input = row.querySelector("input");
        input.placeholder = `Summoner ${i + 1}`;
    });
}

async function startTournament() {
    const inputs = document.querySelectorAll("#players input");
    const players = Array.from(inputs)
        .map((i) => i.value.trim())
        .filter(Boolean);

    if (players.length < 2) {
        showError("Need at least 2 players.");
        return;
    }

    const sequential = document.getElementById("sequential-toggle").checked;

    try {
        const data = await api("/api/tournament", {
            method: "POST",
            body: JSON.stringify({ players, sequential }),
        });
        state = data.state;
        render();
    } catch (err) {
        showError(err.message);
    }
}

// ---------- Tournament view ----------

function renderTournament() {
    const meta = el("div", { class: "tournament-meta" }, [renderModeBadge(), renderHoldHint()]);
    const bracket = renderBracket();
    const actions = el("div", { class: "actions center post-bracket" }, [
        el("button", { class: "btn", id: "reset", type: "button" }, ["New Tournament"]),
    ]);

    root.replaceChildren(meta, bracket, actions);

    document.getElementById("reset").addEventListener("click", resetTournament);

    if (state.done) {
        showChampionModal();
    } else {
        closeModal();
    }
}

function renderModeBadge() {
    const mode = state.sequential ? "One match at a time" : "Free play";
    return el("div", { class: "meta-badge" }, [
        el("span", { class: "meta-label" }, ["Mode"]),
        el("span", { class: "meta-value" }, [mode]),
    ]);
}

function renderHoldHint() {
    if (state.done) return null;
    return el("div", { class: "meta-hint" }, ["Hold a player for 3 seconds to mark as winner"]);
}

// ---------- Bracket ----------

function renderBracket() {
    const N = state.bracketSize;
    const totalLevels = Math.log2(N) + 1;

    // Compute slot center positions for every level.
    const positions = [];
    for (let level = 0; level < totalLevels; level++) {
        const slots = N / Math.pow(2, level);
        const row = [];
        for (let i = 0; i < slots; i++) {
            row.push({
                cx: SIDE_PAD + ((i + 0.5) / slots) * (BRACKET_W - 2 * SIDE_PAD),
                cy: TOP_PAD + level * ROUND_H + BOX_H / 2,
            });
        }
        positions.push(row);
    }

    const totalH = TOP_PAD + (totalLevels - 1) * ROUND_H + BOX_H + TOP_PAD;

    // SVG layer for connectors.
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "bracket-svg");
    svg.setAttribute("width", BRACKET_W);
    svg.setAttribute("height", totalH);
    svg.setAttribute("viewBox", `0 0 ${BRACKET_W} ${totalH}`);

    for (let level = 0; level < totalLevels - 1; level++) {
        const childCount = positions[level].length;
        for (let pairI = 0; pairI < childCount / 2; pairI++) {
            const c0 = positions[level][2 * pairI];
            const c1 = positions[level][2 * pairI + 1];
            const p = positions[level + 1][pairI];

            const childBottom = c0.cy + BOX_H / 2;
            const parentTop = p.cy - BOX_H / 2;
            const midY = childBottom + (parentTop - childBottom) * 0.5;

            const match = state.rounds[level] && state.rounds[level].matches[pairI];
            const completed = match && match.completed;
            const cls = completed ? "connector completed" : "connector";

            const path1 = document.createElementNS(NS, "path");
            path1.setAttribute("class", cls);
            path1.setAttribute("d", `M ${c0.cx} ${childBottom} V ${midY} H ${c1.cx} V ${childBottom}`);
            svg.appendChild(path1);

            const path2 = document.createElementNS(NS, "path");
            path2.setAttribute("class", cls);
            path2.setAttribute("d", `M ${p.cx} ${midY} V ${parentTop}`);
            svg.appendChild(path2);
        }
    }

    // Container with absolutely-positioned slot boxes layered over the SVG.
    const container = el("div", {
        class: "bracket-container",
        style: `width: ${BRACKET_W}px; height: ${totalH}px;`,
    });
    container.appendChild(svg);

    const activeMatchId = computeActiveMatchId();

    for (let level = 0; level < totalLevels; level++) {
        for (let i = 0; i < positions[level].length; i++) {
            const pos = positions[level][i];
            const slot = getSlot(level, i);
            const box = renderSlotBox(slot, level, totalLevels, activeMatchId);
            box.style.left = pos.cx - BOX_W / 2 + "px";
            box.style.top = pos.cy - BOX_H / 2 + "px";
            box.style.width = BOX_W + "px";
            box.style.height = BOX_H + "px";
            container.appendChild(box);
        }
    }

    return el("div", { class: "bracket-wrap" }, [container]);
}

function computeActiveMatchId() {
    if (state.done) return null;
    const cur = state.rounds[state.rounds.length - 1];
    if (state.sequential) {
        for (const m of cur.matches) {
            if (!m.completed) return m.id;
        }
        return null;
    }
    // Free play: any incomplete match in current round is active.
    return "*";
}

// getSlot returns an object describing what belongs in a particular
// bracket slot: an actual player, an empty bye placeholder, or an empty
// future-round slot.
function getSlot(level, slotIndex) {
    if (level === 0) {
        const match = state.rounds[0].matches[Math.floor(slotIndex / 2)];
        const isA = slotIndex % 2 === 0;
        if (match.isBye) {
            return isA
                ? {
                    kind: "player",
                    player: match.playerA,
                    champion: null,
                    match,
                    side: "A",
                    autoAdvanced: true,
                }
                : { kind: "byeSlot" };
        }
        return {
            kind: "player",
            player: isA ? match.playerA : match.playerB,
            champion: isA ? match.champA : match.champB,
            match,
            side: isA ? "A" : "B",
            autoAdvanced: false,
        };
    }

    const prevRound = state.rounds[level - 1];
    const prevMatch = prevRound && prevRound.matches[slotIndex];
    if (!prevMatch || !prevMatch.completed) return { kind: "empty" };

    const player = prevMatch.winner;
    const curRound = state.rounds[level];

    // Final-champion display row: no current match, use previous match's
    // champion (the one they played in the final).
    if (!curRound) {
        const isA = prevMatch.playerA === player;
        return {
            kind: "player",
            player,
            champion: isA ? prevMatch.champA : prevMatch.champB,
            match: prevMatch,
            side: isA ? "A" : "B",
            autoAdvanced: false,
            isFinalChampion: true,
        };
    }

    const curMatch = curRound.matches[Math.floor(slotIndex / 2)];
    if (!curMatch) return { kind: "player", player, champion: null };
    const isA = slotIndex % 2 === 0;
    return {
        kind: "player",
        player,
        champion: isA ? curMatch.champA : curMatch.champB,
        match: curMatch,
        side: isA ? "A" : "B",
        autoAdvanced: false,
    };
}

function renderSlotBox(slot, level, totalLevels, activeMatchId) {
    if (slot.kind === "empty") {
        return el("div", { class: "slot empty" }, [el("div", { class: "slot-name" }, ["—"])]);
    }
    if (slot.kind === "byeSlot") {
        return el("div", { class: "slot bye" }, [el("div", { class: "slot-name" }, ["BYE"])]);
    }

    const isLastLevel = level === totalLevels - 1;
    const cls = ["slot"];

    if (isLastLevel && state.done) cls.push("champion-slot");
    if (slot.autoAdvanced) cls.push("bye-winner");

    let isActive = false;
    if (slot.match && !slot.match.completed && !slot.isFinalChampion) {
        if (activeMatchId === "*") isActive = true;
        else if (activeMatchId === slot.match.id) isActive = true;
    }
    if (isActive) cls.push("active");

    if (slot.match && slot.match.completed && !slot.isFinalChampion) {
        if (slot.match.winner === slot.player) cls.push("winner");
        else if (slot.match.winner) cls.push("loser");
    }

    const children = [];
    if (slot.champion) {
        children.push(
            el("img", {
                class: "slot-icon",
                src: iconURL(state.version, slot.champion.id),
                alt: slot.champion.name,
                loading: "lazy",
            }),
        );
    } else {
        children.push(el("div", { class: "slot-icon placeholder" }));
    }

    children.push(
        el("div", { class: "slot-info" }, [
            el("div", { class: "slot-name" }, [slot.player || "—"]),
            slot.champion ? el("div", { class: "slot-champ" }, [slot.champion.name]) : null,
        ]),
    );

    if (isActive) {
        children.push(el("div", { class: "slot-progress" }));
    }

    const box = el("div", { class: cls.join(" "), tabindex: "-1" }, children);

    if (isActive) {
        setupHoldGesture(box, () => {
            reportWinner(slot.match.id, slot.player);
        });
    }

    return box;
}

// ---------- Hold-to-confirm gesture ----------

function setupHoldGesture(node, onComplete) {
    let raf = null;
    let startTime = 0;
    let committed = false;
    const fill = node.querySelector(".slot-progress");
    if (!fill) return;

    function tick() {
        const elapsed = performance.now() - startTime;
        const pct = Math.min(100, (elapsed / HOLD_DURATION_MS) * 100);
        fill.style.width = pct + "%";
        if (pct >= 100) {
            committed = true;
            node.classList.add("committing");
            node.classList.remove("holding");
            onComplete();
            return;
        }
        raf = requestAnimationFrame(tick);
    }

    function start(e) {
        if (committed) return;
        e.preventDefault();
        node.classList.add("holding");
        fill.style.transition = "none";
        fill.style.width = "0%";
        startTime = performance.now();
        raf = requestAnimationFrame(tick);
    }

    function cancel() {
        if (committed) return;
        if (raf) {
            cancelAnimationFrame(raf);
            raf = null;
        }
        node.classList.remove("holding");
        fill.style.transition = "width 0.18s ease-out";
        fill.style.width = "0%";
    }

    node.addEventListener("pointerdown", start);
    node.addEventListener("pointerup", cancel);
    node.addEventListener("pointerleave", cancel);
    node.addEventListener("pointercancel", cancel);
}

// ---------- Champion modal ----------

function showChampionModal() {
    if (document.getElementById("champion-modal")) return;

    const lastRound = state.rounds[state.rounds.length - 1];
    const finalMatch = lastRound.matches[0];
    const champ =
        finalMatch.winner === finalMatch.playerA ? finalMatch.champA : finalMatch.champB;

    const card = el("div", { class: "modal-content champion-modal" }, [
        buildConfetti(),
        el("div", { class: "champion-trophy" }, ["🏆"]),
        el("div", { class: "champion-label" }, ["Champion"]),
        el("div", { class: "champion-name" }, [state.champion]),
        champ
            ? el("img", {
                class: "champion-icon",
                src: iconURL(state.version, champ.id),
                alt: champ.name,
            })
            : null,
        champ ? el("div", { class: "champion-final-champ" }, [`played as ${champ.name}`]) : null,
        el("button", { class: "btn btn-primary", id: "modal-new", type: "button" }, ["New Tournament"]),
    ]);

    const backdrop = el("div", { id: "champion-modal", class: "modal-backdrop" }, [card]);

    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");

    document.getElementById("modal-new").addEventListener("click", async () => {
        closeModal();
        await resetTournament();
    });
}

function closeModal() {
    const m = document.getElementById("champion-modal");
    if (m) m.remove();
    document.body.classList.remove("modal-open");
}

function buildConfetti() {
    const container = el("div", { class: "confetti" });
    const COUNT = 36;
    for (let i = 0; i < COUNT; i++) {
        const piece = el("span", { class: i % 2 === 0 ? "conf gold" : "conf teal" });
        piece.style.left = Math.random() * 100 + "%";
        piece.style.animationDelay = Math.random() * 1.5 + "s";
        piece.style.animationDuration = 3 + Math.random() * 2 + "s";
        container.appendChild(piece);
    }
    return container;
}

// ---------- Actions ----------

async function reportWinner(matchId, winner) {
    try {
        const data = await api("/api/round/result", {
            method: "POST",
            body: JSON.stringify({ matchId, winner }),
        });
        state = data.state;
        render();
    } catch (err) {
        showError(err.message);
        // Re-render with the same state so the holding/committing UI resets.
        render();
    }
}

async function resetTournament() {
    try {
        await api("/api/reset", { method: "POST" });
        state = null;
        closeModal();
        render();
    } catch (err) {
        showError(err.message);
    }
}

// ---------- Helpers ----------

function iconURL(version, champID) {
    return `${ICON_BASE}/${version}/${ICON_VARIANT}/${champID}.png`;
}

function showError(msg) {
    const t = el("div", { class: "toast" }, [msg]);
    toastHost.appendChild(t);
    setTimeout(() => t.remove(), 4000);
}

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v == null) continue;
        if (k === "class") node.className = v;
        else if (k === "style") node.style.cssText = v;
        else if (k.startsWith("data-")) node.setAttribute(k, v);
        else if (k in node) node[k] = v;
        else node.setAttribute(k, v);
    }
    for (const c of children) {
        if (c == null) continue;
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
    }
    return node;
}