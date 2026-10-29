// Injected into the job portal windows. It only reads the page and reports the offer
// through a rumbo-import:// navigation that Rust cancels; it never calls Tauri IPC.
(function () {
  if (window.top !== window || window.__rumboImport) return;
  window.__rumboImport = true;

  const MAX_DESCRIPTION = 50000;

  const text = (html) => {
    const div = document.createElement("div");
    div.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div|h\d)>/gi, "\n");
    return (div.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  };

  const isJobPosting = (node) => {
    const type = node && node["@type"];
    return Array.isArray(type) ? type.includes("JobPosting") : type === "JobPosting";
  };

  function findJobPosting(node) {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findJobPosting(item);
        if (found) return found;
      }
      return null;
    }
    if (isJobPosting(node)) return node;
    return findJobPosting(node["@graph"]);
  }

  function locationOf(jobLocation) {
    const first = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
    const address = first && first.address;
    if (!address) return null;
    if (typeof address === "string") return address;
    const country = address.addressCountry && typeof address.addressCountry === "object"
      ? address.addressCountry.name
      : address.addressCountry;
    const parts = [address.addressLocality, address.addressRegion, country].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }

  function fromJsonLd() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch (_) {
        continue;
      }
      const job = findJobPosting(data);
      if (!job) continue;
      const org = job.hiringOrganization;
      return {
        title: text(job.title),
        company: org ? (typeof org === "string" ? org : org.name) || null : null,
        location: locationOf(job.jobLocation),
        url: typeof job.url === "string" ? job.url : location.href,
        description: text(job.description),
        posted_at: job.datePosted || null,
      };
    }
    return null;
  }

  const meta = (property) => {
    const el = document.querySelector('meta[property="' + property + '"]');
    return el ? el.getAttribute("content") : null;
  };

  function longestBlock() {
    const root = document.querySelector("main") || document.querySelector("article") || document.body;
    let best = "";
    for (const el of root.querySelectorAll("article, section, div")) {
      if (!el.offsetParent) continue; // hidden
      const value = (el.innerText || "").trim();
      // shortcut: largest visible container under a cap that skips whole-page wrappers; may include sidebar text.
      if (value.length > best.length && value.length < 30000) best = value;
    }
    return best;
  }

  function fromPage() {
    const h1 = document.querySelector("h1");
    return {
      title: (h1 && h1.innerText.trim()) || meta("og:title") || "",
      company: null,
      location: null,
      url: location.href,
      description: longestBlock() || meta("og:description") || "",
      posted_at: null,
    };
  }

  function showMessage(box, message) {
    const note = box.querySelector("span");
    note.textContent = message;
    note.style.display = "block";
    setTimeout(() => { note.style.display = "none"; }, 4000);
  }

  function importOffer(box) {
    const offer = fromJsonLd() || fromPage();
    if (!offer.title || !offer.description) {
      showMessage(box, "Abra una oferta para importarla");
      return;
    }
    offer.description = offer.description.slice(0, MAX_DESCRIPTION);
    location.href = "rumbo-import://job?data=" + encodeURIComponent(JSON.stringify(offer));
    showMessage(box, "Oferta enviada a Rumbo");
  }

  function mount() {
    if (document.getElementById("rumbo-import")) return;
    const box = document.createElement("div");
    box.id = "rumbo-import";
    box.style.cssText =
      "position:fixed;right:20px;bottom:20px;z-index:2147483647;display:flex;flex-direction:column;" +
      "align-items:flex-end;gap:6px;font:14px -apple-system,BlinkMacSystemFont,sans-serif;";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Importar esta oferta a Rumbo";
    button.style.cssText =
      "background:#1f4e79;color:#fff;border:0;border-radius:8px;padding:10px 16px;" +
      "font:inherit;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);";
    const note = document.createElement("span");
    note.style.cssText =
      "display:none;background:#fff;color:#222;border:1px solid #ccc;border-radius:6px;padding:6px 10px;";
    button.addEventListener("click", () => importOffer(box));
    box.append(note, button);
    document.body.appendChild(box);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
