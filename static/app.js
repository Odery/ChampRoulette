// ChampRoulette frontend — vanilla JS, no framework, no build step.
// State lives on the server; this client renders it and posts user actions.

const ICON_BASE = "https://ddragon.leagueoflegends.com/cdn";
const ICON_VARIANT = "img/champion";

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

// ---------- Render ----------

function render() {
    if (!state) {
        renderSetup();
    } else {
        renderTournament();
    }
}

function renderSetup() {
    root.replaceChildren(
        el("section", { class: "panel" }, [
            el("h2", { class: "panel-title" }, ["Summon the Players"]),
            el("div", { id: "players" }),
            el("div", { class: "actions" }, [
                el("button", { class: "btn", id: "add-player", type: "button" }, ["+ Add Player"]),
                el("button", { class: "btn btn-primary", id: "start", type: "button" }, [
                    "Draft",
                    el("span", { class: "go-arrow" }, ["→"]),
                ]),
            ]),
        ]),
    );

    const playersEl = document.getElementById("players");
    addPlayerRow(playersEl);
    addPlayerRow(playersEl);
    refreshAddButton(playersEl);

    document.getElementById("add-player").addEventListener("click", () => {
        if (countRows(playersEl) < 5) {
            addPlayerRow(playersEl);
            refreshAddButton(playersEl);
            const inputs = playersEl.querySelectorAll("input");
            inputs[inputs.length - 1].focus();
        }
    });

    document.getElementById("start").addEventListener("click", startTournament);

    // Submit on Enter from any input
    playersEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            startTournament();
        }
    });

    // Focus first input
    const first = playersEl.querySelector("input");
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
        el(
            "button",
            { class: "btn btn-icon", type: "button", title: "Remove player" },
            ["×"],
        ),
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

    try {
        const data = await api("/api/tournament", {
            method: "POST",
            body: JSON.stringify({ players }),
        });
        state = data.state;
        render();
        scrollToActive();
    } catch (err) {
        showError(err.message);
    }
}

// ---------- Tournament view ----------

function renderTournament() {
    const activeIdx = state.done ? -1 : state.rounds.length - 1;

    const fragments = [];
    if (state.done) fragments.push(renderChampion());
    state.rounds.forEach((r, i) => {
        fragments.push(renderRound(r, i === activeIdx));
    });
    fragments.push(
        el("div", { class: "actions center" }, [
            el("button", { class: "btn", id: "reset", type: "button" }, ["New Tournament"]),
        ]),
    );

    root.replaceChildren(...fragments);

    document.getElementById("reset").addEventListener("click", resetTournament);

    if (!state.done) {
        document.querySelectorAll("[data-match][data-pick]").forEach((card) => {
            card.addEventListener("click", () => {
                const matchId = card.dataset.match;
                const winner = card.dataset.pick;
                reportWinner(matchId, winner);
            });
        });
    }
}

function renderChampion() {
    // Find which champion the winner played in their final match.
    const lastRound = state.rounds[state.rounds.length - 1];
    const finalMatch = lastRound.matches[0];
    const champ =
        finalMatch.winner === finalMatch.playerA
            ? finalMatch.champA
            : finalMatch.champB;

    const children = [
        el("div", { class: "champion-trophy" }, ["🏆"]),
        el("div", { class: "champion-label" }, ["Champion"]),
        el("div", { class: "champion-name" }, [state.champion]),
    ];
    if (champ) {
        children.push(
            el("img", {
                class: "champion-icon",
                src: iconURL(state.version, champ.id),
                alt: champ.name,
            }),
        );
    }
    return el("section", { class: "champion-banner" }, children);
}

function renderRound(round, isActive) {
    const status = isActive ? "In Progress" : "Complete";
    return el("section", { class: `round ${isActive ? "active" : "past"}` }, [
        el("div", { class: "round-header" }, [
            el("div", { class: "round-title" }, [`Round ${round.number}`]),
            el("div", { class: "round-status" }, [status]),
        ]),
        ...round.matches.map((m) => renderMatch(m, isActive)),
    ]);
}

function renderMatch(m, isActiveRound) {
    if (m.isBye) {
        return el("div", { class: "match bye" }, [
            el("div", { class: "bye-label" }, ["Bye — Auto Advance"]),
            el("div", { class: "player-card winner" }, [
                el("div", { class: "player-info" }, [
                    el("div", { class: "player-name" }, [m.playerA]),
                ]),
            ]),
        ]);
    }

    const matchActive = isActiveRound && !m.completed;
    const cls = ["match"];
    if (matchActive) cls.push("active");
    if (m.completed) cls.push("completed");

    return el("div", { class: cls.join(" ") }, [
        renderPlayerCard(m, "A", matchActive),
        el("div", { class: "vs" }, ["VS"]),
        renderPlayerCard(m, "B", matchActive),
    ]);
}

function renderPlayerCard(m, side, matchActive) {
    const isA = side === "A";
    const player = isA ? m.playerA : m.playerB;
    const champ = isA ? m.champA : m.champB;

    const cls = ["player-card"];
    if (!isA) cls.push("right");
    if (m.completed) {
        cls.push(m.winner === player ? "winner" : "loser");
    }

    const attrs = { class: cls.join(" ") };
    if (matchActive) {
        attrs["data-match"] = m.id;
        attrs["data-pick"] = player;
        attrs["role"] = "button";
        attrs["tabindex"] = "0";
        attrs["title"] = `Mark ${player} as winner`;
    }

    const icon = champ
        ? el("img", {
            class: "champ-icon",
            src: iconURL(state.version, champ.id),
            alt: champ.name,
        })
        : el("div", { class: "champ-icon placeholder" });

    const info = el("div", { class: "player-info" }, [
        el("div", { class: "player-name" }, [player]),
        champ ? el("div", { class: "champ-name" }, [champ.name]) : null,
    ]);

    return el("div", attrs, [icon, info]);
}

async function reportWinner(matchId, winner) {
    try {
        const data = await api("/api/round/result", {
            method: "POST",
            body: JSON.stringify({ matchId, winner }),
        });
        state = data.state;
        render();
        scrollToActive();
    } catch (err) {
        showError(err.message);
    }
}

async function resetTournament() {
    try {
        await api("/api/reset", { method: "POST" });
        state = null;
        render();
    } catch (err) {
        showError(err.message);
    }
}

function scrollToActive() {
    requestAnimationFrame(() => {
        const target =
            document.querySelector(".champion-banner") ||
            document.querySelector(".round.active");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

// Tiny DOM helper. Children may be strings, nodes, or null (filtered).
function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v == null) continue;
        if (k === "class") node.className = v;
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