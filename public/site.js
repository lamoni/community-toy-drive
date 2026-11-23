(function () {
  const current = location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  document.querySelectorAll(".site-nav a").forEach((a) => {
    if (a.getAttribute("href") === current) a.setAttribute("aria-current", "page");
  });

  // Mobile nav toggle
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  // ---------- forms ----------

  async function submit(form, url, payload, thanksType) {
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector(".form-error");
    errorBox.hidden = true;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Sending…";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      window.location.href = "/thanks?type=" + thanksType;
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
      button.disabled = false;
      button.textContent = original;
    }
  }

  // Nomination form
  const nominateForm = document.getElementById("nominate-form");
  if (nominateForm) {
    const childList = document.getElementById("children");
    const template = document.getElementById("child-template");
    const addBtn = document.getElementById("add-child");
    const nominatorFields = document.getElementById("nominator-fields");

    function renumber() {
      const cards = childList.querySelectorAll(".child-card");
      cards.forEach((card, i) => {
        card.querySelector(".child-number").textContent = i + 1;
        card.querySelector(".remove-child").hidden = cards.length === 1;
      });
      addBtn.disabled = cards.length >= 15;
    }

    function addChild() {
      const node = template.content.firstElementChild.cloneNode(true);
      const n = Date.now() + Math.random();
      node.querySelectorAll("[data-field]").forEach((input) => {
        input.id = input.dataset.field + "-" + n;
        const label = input.closest(".field").querySelector("label");
        if (label) label.htmlFor = input.id;
      });
      node.querySelector(".remove-child").addEventListener("click", () => {
        node.remove();
        renumber();
      });
      childList.append(node);
      renumber();
    }

    addBtn.addEventListener("click", () => {
      addChild();
      childList.lastElementChild.querySelector("input").focus();
    });
    addChild();

    function syncSubmitter() {
      const isOther = nominateForm.submitted_by.value === "other";
      nominatorFields.hidden = !isOther;
      // A hidden field the browser autofills (often the email) would otherwise
      // fail validation silently and the submit button would do nothing.
      nominatorFields.disabled = !isOther;
      nominatorFields.querySelector("[name=nominator_name]").required = isOther;
      document.getElementById("guardian-heading").textContent = isOther
        ? "Family's parent or guardian"
        : "Your information";
      document.getElementById("consent-text").textContent = isOther
        ? "The family knows I'm adding them and it's OK for a volunteer to contact them."
        : "It's OK for a volunteer to contact me about Santa's list.";
    }
    nominateForm.querySelectorAll("[name=submitted_by]").forEach((r) => r.addEventListener("change", syncSubmitter));
    syncSubmitter();

    nominateForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const errorBox = nominateForm.querySelector(".form-error");
      if (!nominateForm.checkValidity()) {
        const field = [...nominateForm.querySelectorAll(":invalid")].find((el) => el.willValidate);
        errorBox.textContent = field?.validationMessage || "Please fill in the required fields.";
        errorBox.hidden = false;
        if (field && !field.closest("[hidden]")) field.focus();
        return;
      }
      const f = nominateForm.elements;
      const children = [...childList.querySelectorAll(".child-card")].map((card) => {
        const get = (k) => card.querySelector(`[data-field="${k}"]`).value;
        return {
          first_name: get("first_name"),
          age: get("age"),
          gender: get("gender"),
          clothing_size: get("clothing_size"),
          shoe_size: get("shoe_size"),
          wishes: get("wishes"),
        };
      });
      submit(
        nominateForm,
        "/api/nominations",
        {
          submitted_by: f.submitted_by.value,
          nominator_name: f.nominator_name.value,
          nominator_phone: f.nominator_phone.value,
          nominator_email: f.nominator_email.value,
          relationship: f.relationship.value,
          guardian_name: f.guardian_name.value,
          guardian_phone: f.guardian_phone.value,
          guardian_email: f.guardian_email.value,
          address: f.address.value,
          children,
          notes: f.notes.value,
          consent: f.consent.checked,
          website: f.website.value,
        },
        "nomination"
      );
    });
  }

  // Volunteer / donor form
  const signupForm = document.getElementById("signup-form");
  if (signupForm) {
    const sponsorBox = signupForm.querySelector('[name=roles][value="sponsor-family"]');
    const sponsorCount = document.getElementById("sponsor-count");
    const syncSponsor = () => (sponsorCount.hidden = !sponsorBox.checked);
    sponsorBox.addEventListener("change", syncSponsor);
    syncSponsor();

    signupForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = signupForm.elements;
      const roles = [...signupForm.querySelectorAll("[name=roles]:checked")].map((c) => c.value);
      const errorBox = signupForm.querySelector(".form-error");
      if (!roles.length) {
        errorBox.textContent = "Please choose at least one way you'd like to help.";
        errorBox.hidden = false;
        return;
      }
      submit(
        signupForm,
        "/api/signups",
        {
          name: f.name.value,
          email: f.email.value,
          phone: f.phone.value,
          organization: f.organization.value,
          roles,
          families_to_sponsor: f.families_to_sponsor.value,
          notes: f.notes.value,
          website: f.website.value,
        },
        "signup"
      );
    });
  }

  // Thank-you page message
  const thanks = document.getElementById("thanks-message");
  if (thanks) {
    const type = new URLSearchParams(location.search).get("type");
    const messages = {
      nomination:
        "You're on Santa's list! A volunteer will reach out if we need clarification on a child's suggested gifts or hobbies. Everything you shared stays private and is only seen by the volunteers coordinating gifts.",
      signup:
        "Thank you for signing up to help! A coordinator will reach out soon with next steps. Neighbors like you make Christmas brighter for kids across our valley.",
    };
    if (messages[type]) thanks.textContent = messages[type];
  }
})();
