(function () {
  const ROLE_LABELS = {
    "sponsor-family": "Sponsor a family",
    "donate-toys": "Donate toys",
    "donate-money": "Donate money",
    wrap: "Sort & wrap",
    deliver: "Deliver",
    "collection-site": "Collection box",
    other: "Other",
  };

  const GIFT_LABELS = {
    needed: "Needs gift",
    assigned: "Assigned",
    purchased: "Bought",
    wrapped: "Wrapped",
    delivered: "Delivered",
  };
  const giftStatus = (k) => k.gift_status || "needed";

  const state = { tab: "nominations", data: { nominations: null, signups: null }, summaries: null, busy: false, notice: "" };
  const list = document.getElementById("list");
  const stats = document.getElementById("stats");
  const search = document.getElementById("search");
  const statusFilter = document.getElementById("status-filter");
  const exportLink = document.getElementById("export");
  const needsGiftFilter = document.getElementById("needs-gift");

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function kv(label, value) {
    if (!value && value !== 0) return null;
    return h("div", {}, h("span", {}, label + ": "), value);
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString();
  }

  // location.origin never contains user:pass@, which fetch() rejects.
  const api = (p) => `${location.origin}/api/admin/${p}`;
  const send = (p, method, body) =>
    fetch(api(p), {
      method,
      headers: {
        "X-Requested-With": "toydrive-admin",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function load(tab) {
    const res = await fetch(api(tab));
    if (!res.ok) throw new Error("Failed to load " + tab);
    state.data[tab] = await res.json();
  }

  async function update(tab, id, changes, savedEl) {
    const res = await send(`${tab}/${id}`, "PATCH", changes);
    if (!res.ok) {
      alert((await res.json().catch(() => ({}))).error || "Save failed");
      return;
    }
    const row = state.data[tab].rows.find((r) => r.id === id);
    Object.assign(row, changes);
    if (savedEl) {
      savedEl.textContent = "Saved";
      setTimeout(() => (savedEl.textContent = ""), 1500);
    }
    renderStats();
  }

  async function updateChild(row, index, changes, savedEl) {
    const res = await send(`nominations/${row.id}/children/${index}`, "PATCH", changes);
    if (!res.ok) {
      alert((await res.json().catch(() => ({}))).error || "Save failed");
      return false;
    }
    Object.assign(row.children[index], changes);
    savedEl.textContent = "Saved";
    setTimeout(() => (savedEl.textContent = ""), 1500);
    renderStats();
    return true;
  }

  async function remove(tab, id) {
    if (!confirm("Permanently delete this entry?")) return;
    const res = await send(`${tab}/${id}`, "DELETE");
    if (!res.ok) return alert("Delete failed");
    state.data[tab].rows = state.data[tab].rows.filter((r) => r.id !== id);
    render();
  }

  function actions(tab, row, statuses) {
    const saved = h("span", { class: "saved" });
    const select = h(
      "select",
      { onchange: (e) => update(tab, row.id, { status: e.target.value }, saved), "aria-label": "Status" },
      statuses.map((s) => {
        const o = h("option", { value: s }, s[0].toUpperCase() + s.slice(1));
        if (s === row.status) o.selected = true;
        return o;
      })
    );
    const notes = h("textarea", {
      placeholder: "Internal notes (only visible to admins)",
      onchange: (e) => update(tab, row.id, { admin_notes: e.target.value }, saved),
    });
    notes.value = row.admin_notes || "";
    return h(
      "div",
      { class: "entry-actions" },
      select,
      notes,
      saved,
      h("button", { class: "link-btn", onclick: () => remove(tab, row.id) }, "Delete")
    );
  }

  function giftSummaryPill(row) {
    const needed = row.children.filter((k) => giftStatus(k) === "needed").length;
    const delivered = row.children.filter((k) => giftStatus(k) === "delivered").length;
    if (delivered === row.children.length) return h("span", { class: "pill gift-pill-done" }, "All gifts delivered");
    if (needed === 0) return h("span", { class: "pill gift-pill-ok" }, "Every child has a gift");
    return h("span", { class: "pill gift-pill-needed" }, `${needed} of ${row.children.length} still need a gift`);
  }

  function renderNomination(row, statuses) {
    const kids = row.children;
    let pill;
    const el = h(
      "article",
      { class: "entry" },
      h(
        "div",
        { class: "entry-head" },
        h("h3", {}, `#${row.id} · ${row.guardian_name}${row.town ? " (" + row.town + ")" : ""}`),
        h(
          "span",
          { class: "meta" },
          `${kids.length} child${kids.length === 1 ? "" : "ren"}, ages ${kids.map((k) => k.age).join(", ")} · ${formatDate(row.created_at)}`
        )
      ),
      h("span", { class: `pill status-${row.status}` }, row.status),
      h("span", { class: "pill" }, row.submitted_by === "self" ? "Self-submitted" : "Nominated by someone else"),
      giftSummaryPill(row),
      h(
        "div",
        { class: "kv" },
        kv("Phone", row.guardian_phone),
        kv("Email", row.guardian_email),
        kv("Address", row.address),
        row.submitted_by === "other" && kv("Nominated by", row.nominator_name),
        row.submitted_by === "other" && kv("Relationship", row.relationship),
        row.submitted_by === "other" && kv("Nominator contact", [row.nominator_phone, row.nominator_email].filter(Boolean).join(" / "))
      ),
      h(
        "div",
        { class: "scroll-x" },
        h(
          "table",
          { class: "kids" },
          h(
            "thead",
            {},
            h("tr", {}, ["Name", "Age", "Gender", "Clothing", "Shoe", "Wish list", "Gift", "Gift notes"].map((t) => h("th", {}, t)))
          ),
          h(
            "tbody",
            {},
            kids.map((k, i) => {
              const saved = h("span", { class: "saved" });
              const tr = h("tr", { class: `gift-${giftStatus(k)}` });
              const select = h(
                "select",
                {
                  "aria-label": `Gift status for ${k.first_name}`,
                  onchange: async (e) => {
                    if (await updateChild(row, i, { gift_status: e.target.value }, saved)) {
                      tr.className = `gift-${e.target.value}`;
                      pill.replaceWith((pill = giftSummaryPill(row)));
                    } else {
                      e.target.value = giftStatus(k);
                    }
                  },
                },
                state.data.nominations.giftStatuses.map((s) => {
                  const o = h("option", { value: s }, GIFT_LABELS[s] || s);
                  if (s === giftStatus(k)) o.selected = true;
                  return o;
                })
              );
              const notes = h("input", {
                type: "text",
                class: "gift-notes",
                placeholder: "What / who's buying",
                "aria-label": `Gift notes for ${k.first_name}`,
                onchange: (e) => updateChild(row, i, { gift_notes: e.target.value }, saved),
              });
              notes.value = k.gift_notes || "";
              tr.append(
                ...[k.first_name, k.age, k.gender, k.clothing_size, k.shoe_size, k.wishes].map((v) => h("td", {}, v ?? "")),
                h("td", {}, select),
                h("td", {}, notes, saved)
              );
              return tr;
            })
          )
        )
      ),
      row.notes && h("p", {}, h("strong", {}, "Notes: "), row.notes),
      actions("nominations", row, statuses)
    );
    pill = el.querySelector(".gift-pill-done, .gift-pill-ok, .gift-pill-needed");
    return el;
  }

  function renderSignup(row, statuses) {
    return h(
      "article",
      { class: "entry" },
      h(
        "div",
        { class: "entry-head" },
        h("h3", {}, `#${row.id} · ${row.name}${row.organization ? " (" + row.organization + ")" : ""}`),
        h("span", { class: "meta" }, formatDate(row.created_at))
      ),
      h("span", { class: `pill status-${row.status}` }, row.status),
      row.roles.map((r) =>
        h("span", { class: "pill" }, ROLE_LABELS[r] || r, r === "sponsor-family" && row.families_to_sponsor ? ` ×${row.families_to_sponsor}` : "")
      ),
      h("div", { class: "kv" }, kv("Email", row.email), kv("Phone", row.phone), kv("Town", row.town)),
      row.notes && h("p", {}, h("strong", {}, "Notes: "), row.notes),
      actions("signups", row, statuses)
    );
  }

  function renderStats() {
    const data = state.data[state.tab];
    stats.replaceChildren();
    if (!data) return;
    const counts = {};
    data.rows.forEach((r) => (counts[r.status] = (counts[r.status] || 0) + 1));
    stats.append(h("div", { class: "stat" }, h("strong", {}, data.rows.length), "total"));
    if (state.tab === "nominations") {
      const kids = data.rows.filter((r) => r.status !== "declined").flatMap((r) => r.children);
      const byGift = Object.fromEntries(data.giftStatuses.map((s) => [s, 0]));
      kids.forEach((k) => byGift[giftStatus(k)]++);
      stats.append(
        h("div", { class: "stat" }, h("strong", {}, kids.length), "children (excl. declined)"),
        h("div", { class: `stat ${byGift.needed ? "stat-alert" : "stat-good"}` }, h("strong", {}, byGift.needed), "still need a gift"),
        ...data.giftStatuses
          .filter((s) => s !== "needed" && byGift[s])
          .map((s) => h("div", { class: "stat" }, h("strong", {}, byGift[s]), GIFT_LABELS[s].toLowerCase()))
      );
    } else {
      const fams = data.rows.reduce((n, r) => n + (r.families_to_sponsor || 0), 0);
      stats.append(h("div", { class: "stat" }, h("strong", {}, fams), "families pledged"));
    }
    data.statuses.forEach((s) => {
      if (counts[s]) stats.append(h("div", { class: "stat stat-muted" }, h("strong", {}, counts[s]), s));
    });
    if (state.tab === "nominations") stats.append(renderAgeBreakdown(data));
  }

  function renderAgeBreakdown(data) {
    const cols = ["Boy", "Girl", ""];
    const groups = data.ageGroups.map((g) => ({ ...g, counts: { Boy: 0, Girl: 0, "": 0 }, needed: { Boy: 0, Girl: 0, "": 0 } }));
    data.rows
      .filter((r) => r.status !== "declined")
      .flatMap((r) => r.children)
      .forEach((k) => {
        const g = groups.find((g) => k.age >= g.min && k.age <= g.max);
        if (!g) return;
        const col = cols.includes(k.gender) ? k.gender : "";
        g.counts[col]++;
        if (giftStatus(k) === "needed") g.needed[col]++;
      });
    const total = (g) => cols.reduce((n, c) => n + g.counts[c], 0);
    const showUnspecified = groups.some((g) => g.counts[""] > 0);
    const shown = showUnspecified ? cols : ["Boy", "Girl"];
    const headers = [
      "Age group",
      "Boys",
      "Girls",
      ...(showUnspecified ? ["Not specified"] : []),
      "Total",
      "Boys still need",
      "Girls still need",
      ...(showUnspecified ? ["Not specified still need"] : []),
    ];
    const sum = (key, c) => groups.reduce((n, g) => n + g[key][c], 0);
    return h(
      "details",
      { class: "age-breakdown", open: "" },
      h("summary", {}, "Shopping list by age (excludes declined)"),
      h(
        "div",
        { class: "scroll-x" },
        h(
          "table",
          { class: "kids" },
          h("thead", {}, h("tr", {}, headers.map((t) => h("th", {}, t)))),
          h(
            "tbody",
            {},
            groups.map((g) =>
              h(
                "tr",
                {},
                [g.label, ...shown.map((c) => g.counts[c]), total(g)].map((v) => h("td", {}, v)),
                shown.map((c) => h("td", { class: g.needed[c] ? "need" : "" }, g.needed[c]))
              )
            ),
            h(
              "tr",
              { class: "totals" },
              ["All ages", ...shown.map((c) => sum("counts", c)), groups.reduce((n, g) => n + total(g), 0)].map((v) => h("td", {}, v)),
              shown.map((c) => h("td", { class: sum("needed", c) ? "need" : "" }, sum("needed", c)))
            )
          )
        )
      )
    );
  }

  function shareText(summary) {
    const n = summary.nominations;
    const v = summary.signups;
    const giftPhrase = { delivered: "delivered", wrapped: "wrapped", purchased: "purchased", assigned: "assigned", needed: "still needed" };
    const giftLine = ["delivered", "wrapped", "purchased", "assigned", "needed"]
      .filter((s) => n.children_by_gift[s])
      .map((s) => `${n.children_by_gift[s]} ${giftPhrase[s]}`)
      .join(", ");
    const roleLine = Object.entries(v.by_role)
      .filter(([, count]) => count)
      .map(([role, count]) => {
        const label = ROLE_LABELS[role] || role;
        return `${count} ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
      })
      .join(", ");
    const lines = [`${summary.year} toy drive`, "", `${n.families} families and ${n.children} children.`];
    if (n.by_status.declined) {
      const noun = n.by_status.declined === 1 ? "request was" : "requests were";
      const verb = n.by_status.declined === 1 ? "is" : "are";
      lines.push(`${n.by_status.declined} ${noun} declined and ${verb} not included above.`);
    }
    if (giftLine) lines.push(`Gifts: ${giftLine}.`);
    const who = [
      n.submitted_by.self
        ? `${n.submitted_by.self} ${n.submitted_by.self === 1 ? "request" : "requests"} from the family`
        : "",
      n.submitted_by.other ? `${n.submitted_by.other} nominated by someone else` : "",
    ].filter(Boolean);
    if (who.length) lines.push(`${who.join(", ")}.`);
    lines.push("", `${v.active} ${v.active === 1 ? "person" : "people"} signed up to help.`);
    if (v.by_status.inactive) {
      lines.push(`${v.by_status.inactive} inactive sign-up${v.by_status.inactive === 1 ? "" : "s"} not counted above.`);
    }
    lines.push(`${v.families_pledged} ${v.families_pledged === 1 ? "family" : "families"} pledged by sponsors.`);
    if (roleLine) lines.push(`Ways people helped: ${roleLine}.`);
    lines.push("A person can be counted in more than one role.");
    const ageLines = [];
    for (const g of n.age_groups) {
      const total = g.boys + g.girls + g.unspecified;
      if (!total) continue;
      const extra = g.unspecified ? `, ${g.unspecified} not specified` : "";
      ageLines.push(`${g.label}: ${g.boys} boys, ${g.girls} girls${extra} (${total})`);
    }
    if (ageLines.length) lines.push("", "Children by age:", ...ageLines);
    return lines.join("\n");
  }

  function renderSavedAgeTable(groups) {
    const showUnspecified = groups.some((g) => g.unspecified || g.unspecified_still_need);
    const headers = [
      "Age group",
      "Boys",
      "Girls",
      ...(showUnspecified ? ["Not specified"] : []),
      "Total",
      "Boys still need",
      "Girls still need",
      ...(showUnspecified ? ["Not specified still need"] : []),
    ];
    const countCells = (g) => [g.boys, g.girls, ...(showUnspecified ? [g.unspecified] : [])];
    const needCells = (g) => [g.boys_still_need, g.girls_still_need, ...(showUnspecified ? [g.unspecified_still_need] : [])];
    const total = (g) => g.boys + g.girls + g.unspecified;
    const sum = (pick) => groups.reduce((n, g) => n + pick(g), 0);
    return h(
      "details",
      { class: "age-breakdown", open: "" },
      h("summary", {}, "Shopping list by age (excludes declined)"),
      h(
        "div",
        { class: "scroll-x" },
        h(
          "table",
          { class: "kids" },
          h("thead", {}, h("tr", {}, headers.map((t) => h("th", {}, t)))),
          h(
            "tbody",
            {},
            groups.map((g) =>
              h(
                "tr",
                {},
                [g.label, ...countCells(g), total(g)].map((v) => h("td", {}, v)),
                needCells(g).map((v) => h("td", { class: v ? "need" : "" }, v))
              )
            ),
            h(
              "tr",
              { class: "totals" },
              ["All ages", ...countCells({ boys: sum((g) => g.boys), girls: sum((g) => g.girls), unspecified: sum((g) => g.unspecified) }), sum(total)].map((v) => h("td", {}, v)),
              needCells({
                boys_still_need: sum((g) => g.boys_still_need),
                girls_still_need: sum((g) => g.girls_still_need),
                unspecified_still_need: sum((g) => g.unspecified_still_need),
              }).map((v) => h("td", { class: v ? "need" : "" }, v))
            )
          )
        )
      )
    );
  }

  function renderSavedSummary(summary, currentYear) {
    const n = summary.nominations;
    const v = summary.signups;
    const gifts = n.children_by_gift;
    const text = shareText(summary);
    const copy = h("button", { type: "button", class: "btn btn-ghost", style: "padding:0.45rem 0.9rem" }, "Copy summary");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy summary"), 1500);
      } catch {
        alert("Couldn't copy. Select the summary and copy it manually.");
      }
    });
    return h(
      "article",
      { class: "entry" },
      h(
        "div",
        { class: "entry-head" },
        h("h3", {}, summary.year === currentYear ? `${summary.year} (this year)` : summary.year),
        h("span", { class: "meta" }, `Saved ${formatDate(summary.saved_at)}`)
      ),
      h(
        "div",
        { class: "stats" },
        h("div", { class: "stat" }, h("strong", {}, n.families), "families"),
        h("div", { class: "stat" }, h("strong", {}, n.children), "children"),
        h("div", { class: `stat ${gifts.needed ? "stat-alert" : "stat-good"}` }, h("strong", {}, gifts.needed), "still needed a gift"),
        h("div", { class: "stat" }, h("strong", {}, gifts.delivered), "gifts delivered"),
        ...["wrapped", "purchased", "assigned"]
          .filter((s) => gifts[s])
          .map((s) => h("div", { class: "stat" }, h("strong", {}, gifts[s]), GIFT_LABELS[s].toLowerCase())),
        h("div", { class: "stat" }, h("strong", {}, v.active), "people helping"),
        h("div", { class: "stat" }, h("strong", {}, v.families_pledged), "families pledged")
      ),
      renderSavedAgeTable(n.age_groups),
      h("div", { class: "summary-block" }, copy, h("pre", { class: "summary-text" }, text))
    );
  }

  async function loadSummaries() {
    const res = await fetch(api("summaries"));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Failed to load season summary");
    state.summaries = body;
  }

  async function saveSummary() {
    if (state.busy) return;
    const info = state.summaries;
    const replacing = info.summaries.some((s) => s.year === info.year);
    if (replacing && !confirm(`Replace the saved ${info.year} summary with counts from the lists as they are right now?`)) return;
    state.busy = true;
    state.notice = "";
    render();
    try {
      const res = await send("summaries", "POST");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save the summary");
      state.notice = `Saved the anonymous summary for ${info.year}.`;
      await loadSummaries();
    } catch (err) {
      alert(err.message || "Couldn't save the summary");
    } finally {
      state.busy = false;
      render();
    }
  }

  async function clearLists() {
    if (state.busy) return;
    const info = state.summaries;
    const ok = confirm(
      `Permanently delete all ${info.current.nominations} toy requests and ${info.current.signups} sign-ups? The anonymous ${info.year} summary stays. Names, phone numbers, addresses, sizes, and wish lists will be gone.`
    );
    if (!ok) return;
    state.busy = true;
    state.notice = "";
    render();
    try {
      const res = await send("summaries/clear-lists", "POST");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't delete the lists");
      state.data.nominations = null;
      state.data.signups = null;
      state.notice = `Deleted ${body.deleted.nominations} toy requests and ${body.deleted.signups} sign-ups. The ${info.year} summary is still saved.`;
      await loadSummaries();
    } catch (err) {
      alert(err.message || "Couldn't delete the lists");
      await loadSummaries().catch(() => {});
    } finally {
      state.busy = false;
      render();
    }
  }

  function renderSummaries() {
    const info = state.summaries;
    if (!info) {
      list.replaceChildren(h("div", { class: "empty" }, "Loading…"));
      return;
    }
    const currentRows = info.current.nominations + info.current.signups;
    const savedThisYear = info.summaries.some((s) => s.year === info.year);
    let status;
    if (!currentRows && savedThisYear) status = `The lists are empty. The ${info.year} summary is still saved.`;
    else if (!currentRows) status = "The lists are empty, and there is no summary for this year yet.";
    else if (info.current.summary_in_sync) {
      status = `The saved ${info.year} summary matches the lists (${info.current.nominations} toy requests, ${info.current.signups} sign-ups). You can delete the lists and keep the summary.`;
    } else if (savedThisYear) {
      status = `The lists have changed since the ${info.year} summary was saved. They now have ${info.current.nominations} toy requests and ${info.current.signups} sign-ups. Save again before deleting them.`;
    } else {
      status = `Nothing is saved for ${info.year} yet. The lists currently have ${info.current.nominations} toy requests and ${info.current.signups} sign-ups.`;
    }

    const saveBtn = h("button", { type: "button", class: "btn btn-green", onclick: () => saveSummary() }, "Save anonymous summary");
    const deleteBtn = h("button", { type: "button", class: "btn btn-red", onclick: () => clearLists() }, "Delete all personal records");
    saveBtn.disabled = !currentRows || state.busy;
    deleteBtn.disabled = !currentRows || !info.current.summary_in_sync || state.busy;

    const parts = [
      h("h2", {}, "Anonymous season summary"),
      h(
        "p",
        { class: "summary-note" },
        "Save this before you delete the lists. It keeps counts only — families, children, ages, gift progress, and volunteer roles — and leaves out names, contact details, addresses, towns, sizes, and wish lists. Those details can identify a child in a small community, so they are not part of the summary."
      ),
      state.notice ? h("p", { class: "saved" }, state.notice) : null,
      h("p", { class: "summary-status" }, status),
      h("div", { class: "summary-actions" }, saveBtn, deleteBtn),
      ...(info.summaries.length
        ? info.summaries.map((s) => renderSavedSummary(s, info.year))
        : [h("div", { class: "empty" }, "No summary saved yet.")]),
    ];
    list.replaceChildren(...parts.filter(Boolean));
  }

  function render() {
    // .tools { display: flex } overrides the hidden attribute, so hide it directly.
    document.getElementById("tools").style.display = state.tab === "summaries" ? "none" : "";
    if (state.tab === "summaries") {
      stats.replaceChildren();
      renderSummaries();
      return;
    }
    const data = state.data[state.tab];
    if (!data) return;

    const current = statusFilter.value;
    statusFilter.replaceChildren(
      h("option", { value: "" }, "All statuses"),
      ...data.statuses.map((s) => h("option", { value: s }, s[0].toUpperCase() + s.slice(1)))
    );
    statusFilter.value = data.statuses.includes(current) ? current : "";
    exportLink.href = `/api/admin/${state.tab}.csv`;

    const q = search.value.trim().toLowerCase();
    const onlyNeedsGift = state.tab === "nominations" && needsGiftFilter.checked;
    needsGiftFilter.parentElement.hidden = state.tab !== "nominations";
    const rows = data.rows.filter(
      (r) =>
        (!statusFilter.value || r.status === statusFilter.value) &&
        (!q || JSON.stringify(r).toLowerCase().includes(q)) &&
        (!onlyNeedsGift || (r.status !== "declined" && r.children.some((k) => giftStatus(k) === "needed")))
    );

    renderStats();
    list.replaceChildren(
      ...(rows.length
        ? rows.map((r) => (state.tab === "nominations" ? renderNomination(r, data.statuses) : renderSignup(r, data.statuses)))
        : [h("div", { class: "empty" }, data.rows.length ? "No matches." : "Nothing submitted yet.")])
    );
  }

  document.querySelectorAll(".tab").forEach((btn) =>
    btn.addEventListener("click", async () => {
      state.tab = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
      if (state.tab === "summaries") {
        try {
          await loadSummaries();
          render();
        } catch (err) {
          document.getElementById("tools").style.display = "none";
          stats.replaceChildren();
          list.replaceChildren(h("div", { class: "empty" }, err.message));
        }
        return;
      }
      statusFilter.value = "";
      if (!state.data[state.tab]) await load(state.tab);
      render();
    })
  );
  search.addEventListener("input", render);
  statusFilter.addEventListener("change", render);
  needsGiftFilter.addEventListener("change", render);

  load("nominations")
    .then(render)
    .catch((err) => list.replaceChildren(h("div", { class: "empty" }, err.message)));
})();
