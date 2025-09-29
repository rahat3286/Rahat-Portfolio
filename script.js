"use strict";

/* =========================
   Small utilities
========================= */
const $ = (s, sc = document) => sc.querySelector(s);
const $$ = (s, sc = document) => Array.from(sc.querySelectorAll(s));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const isDesktop = () => window.innerWidth >= 992;
const reducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const FOCUSABLE = `
a[href]:not([tabindex="-1"]):not([inert]),
area[href]:not([tabindex="-1"]):not([inert]),
button:not([disabled]):not([tabindex="-1"]):not([inert]),
input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]):not([inert]),
select:not([disabled]):not([tabindex="-1"]):not([inert]),
textarea:not([disabled]):not([tabindex="-1"]):not([inert]),
[contenteditable="true"]:not([tabindex="-1"]):not([inert]),
[tabindex]:not([tabindex="-1"]):not([inert])
`.trim();

const getTargetFrom = (el) => {
    if (!el) return "";
    const ds = el.dataset?.target || el.getAttribute?.("data-scroll-to");
    if (ds) return ds;
    const href = el.getAttribute?.("href") || "";
    if (href.startsWith("#")) return href.slice(1);
    try {
        const u = new URL(href, location.href);
        return u.hash ? u.hash.slice(1) : "";
    } catch {
        return "";
    }
};

/* =========================
   Google Drive: force download
========================= */
function normalizeDriveDownload(url) {
    try {
        const u = new URL(url, location.href);
        if (!/drive\.google\.com$/.test(u.hostname)) return url;
        // Extract file id from .../d/{id}/... or ?id={id}
        let id = "";
        const dMatch = u.pathname.match(/\/d\/([^/]+)\//);
        if (dMatch) id = dMatch[1];
        else if (u.searchParams.get("id")) id = u.searchParams.get("id");
        if (!id) return url;
        // Direct download endpoint
        return `https://drive.google.com/uc?export=download&id=${id}`;
    } catch {
        return url;
    }
}
function openDownload(url) {
    const dl = normalizeDriveDownload(url);
    // Use a hidden iframe to trigger download without page navigation
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = dl;
    document.body.appendChild(iframe);
    // Clean up later
    setTimeout(() => iframe.remove(), 15000);
}

/* Delegate clicks for any anchor with a download attribute linking to Drive */
document.addEventListener(
    "click",
    (e) => {
        const a = e.target.closest("a[download]");
        if (!a) return;
        const href = a.getAttribute("href") || "";
        if (!href.includes("drive.google.com")) return;
        e.preventDefault();
        openDownload(href);
    },
    { passive: false }
);

/* =========================
   DOM references
========================= */
const sidebar = $("#sidebar");
const sidebarLinks = $$("#sidebar .nav-link");
const mainContent = $("#main-content");
const sections = $$("#main-content .section");
const topNavbar = $("#topNavbar");
const rightSlider = $("#rightSlider");
const sliderItemsBox = $("#sliderItems");
const sliderItems = $$("#rightSlider .slider-item");
const hamburger = $("#hamburger");
const backToTopBtn = $("#backToTop");
const skipLink = $("#skipLink");
const brandTop = $("#brandTop");
const typewriterEl = $("#typewriter");
const toastStack = $("#toast-stack");
const indicatorEl = $("#reload-indicator");
const skeletonEl = $("#page-skeleton");
const heroImg = $(".hero-img");

/* =========================
   State
========================= */
let currentId = null;
let wasDesktop = null;
let visualsReady = false;
let navLock = false;
let ioSections = null;
let releaseTrap = null;
let lastFocusBeforeMenu = null;
const sectionScroll = new Map();

const STORAGE_MENU = "rightSliderOpenV2";
const STORAGE_SCROLL = "scrollStateV8";

/* =========================
   Inert toggle (with fallback)
========================= */
const inertSupported = "inert" in HTMLElement.prototype;
function setInert(root, flag) {
    if (!root) return;
    if (inertSupported) {
        flag ? root.setAttribute("inert", "") : root.removeAttribute("inert");
        return;
    }
    if (flag) {
        root.setAttribute("inert", "");
        $$(FOCUSABLE, root).forEach((el) => {
            if (!el.hasAttribute("data-prev-tabindex")) {
                el.setAttribute(
                    "data-prev-tabindex",
                    el.hasAttribute("tabindex") ? el.getAttribute("tabindex") : "none"
                );
            }
            el.setAttribute("tabindex", "-1");
            el.setAttribute("aria-hidden", "true");
        });
    } else {
        $$(FOCUSABLE, root).forEach((el) => {
            const prev = el.getAttribute("data-prev-tabindex");
            if (prev !== null) {
                prev === "none"
                    ? el.removeAttribute("tabindex")
                    : el.setAttribute("tabindex", prev);
                el.removeAttribute("data-prev-tabindex");
            }
            if (el.getAttribute("aria-hidden") === "true")
                el.removeAttribute("aria-hidden");
        });
        root.removeAttribute("inert");
    }
}

/* =========================
   Top progress + skeleton
========================= */
function setIndicatorProgress(pct) {
    indicatorEl?.style.setProperty("--progress", String(pct));
}
function playIndicator(to = 1, dur = 900) {
    if (!indicatorEl) return;
    indicatorEl.classList.add("visible");
    indicatorEl.style.setProperty(
        "--ri-duration",
        reducedMotion() ? "1ms" : `${dur}ms`
    );
    const fill = indicatorEl.querySelector(".fill");
    fill?.classList.remove("animate");
    requestAnimationFrame(() => {
        fill?.classList.add("animate");
        setIndicatorProgress(to);
    });
}
function holdIndicator() {
    if (!indicatorEl) return;
    playIndicator(0.7, 700);
    indicatorEl.classList.add("waiting");
}
function completeIndicator() {
    if (!indicatorEl) return;
    indicatorEl.classList.remove("waiting");
    playIndicator(1, 600);
    const hide = () => indicatorEl.classList.remove("visible");
    reducedMotion() ? hide() : setTimeout(hide, 620);
}

let skelTimer = 0,
    skelVisible = false;
function showSkeleton() {
    if (!skeletonEl) return;
    skeletonEl.hidden = false;
    skeletonEl.dataset.visible = "true";
    document.body.setAttribute("aria-busy", "true");
    skelVisible = true;
    holdIndicator();
}
function markUiReady() {
    document.documentElement.classList.add("ui-ready");
    visualsReady = true;
}
function hideSkeleton() {
    if (!skeletonEl) return;
    skeletonEl.dataset.visible = "false";
    document.body.removeAttribute("aria-busy");
    skelVisible = false;
    completeIndicator();
    setTimeout(() => {
        skeletonEl.hidden = true;
        markUiReady();
        applyHeadingClearance();
        restoreSavedScroll();
        maybeStartTypewriter();
        initSkills();
        maybeAnimateSkills();
        applyResearchCardPatches();
    }, reducedMotion() ? 0 : 120);
}

/* =========================
   Sections router
========================= */
function withNavLock(ms = 450) {
    navLock = true;
    setTimeout(() => (navLock = false), reducedMotion() ? 0 : ms);
}
function activeSectionEl() {
    return sections.find((s) => s.dataset.active === "true") || null;
}

function saveActiveSectionScroll() {
    if (!isDesktop()) return;
    const a = activeSectionEl();
    if (a) sectionScroll.set(a.id, a.scrollTop);
}
function restoreSectionScroll(target) {
    if (!isDesktop() || !target) return;
    target.scrollTop = sectionScroll.get(target.id) ?? 0;
}
function syncBrandTop() {
    if (brandTop) brandTop.textContent = "Rahat";
}

function applyHeadingClearance() {
    sections.forEach((sec) => {
        const hd = $(".section-heading", sec);
        const h = hd?.getBoundingClientRect?.().height || hd?.offsetHeight || 0;
        sec.style.setProperty("--dynamic-clear", `${Math.ceil(h + 24)}px`);
    });
}

function syncNavUI(id) {
    sidebarLinks.forEach((a) => {
        const active = getTargetFrom(a) === id;
        a.dataset.active = active ? "true" : "false";
        active ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
    });
    sliderItems.forEach((b) => {
        const active = getTargetFrom(b) === id;
        b.dataset.active = active ? "true" : "false";
        active ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current");
    });
}

function focusSection(sec) {
    sec?.focus?.({ preventScroll: true });
}

/* butter-smooth slide transitions on desktop, native smooth scroll on mobile */
function showSection(id, pushHash = true, { preserveScroll = false } = {}) {
    const target = document.getElementById(id);
    if (!target) return;

    if (currentId === id) {
        if (isDesktop()) {
            if (!preserveScroll) restoreSectionScroll(target);
            focusSection(target);
            applyHeadingClearance();
        } else if (!preserveScroll) {
            target.scrollIntoView({
                behavior: reducedMotion() ? "auto" : "smooth",
                block: "start",
            });
            requestAnimationFrame(() => focusSection(target));
        }
        syncNavUI(id);
        pushHash && history.replaceState(null, "", `#${id}`);
        return;
    }

    withNavLock(isDesktop() ? 480 : 720);
    if (isDesktop()) {
        saveActiveSectionScroll();
        sections.forEach((s) => (s.dataset.active = s === target ? "true" : "false"));
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        requestAnimationFrame(() => {
            if (!preserveScroll) restoreSectionScroll(target);
            focusSection(target);
            applyHeadingClearance();
        });
    } else if (!preserveScroll) {
        target.scrollIntoView({
            behavior: reducedMotion() ? "auto" : "smooth",
            block: "start",
        });
        requestAnimationFrame(() => focusSection(target));
    }

    currentId = id;
    syncNavUI(id);
    pushHash && history.replaceState(null, "", `#${id}`);
    if (id === "skills") setTimeout(maybeAnimateSkills, 40);
}

/* Mobile: observe which section is visible to sync nav */
function setupSectionObserver() {
    ioSections?.disconnect?.();
    ioSections = null;
    if (isDesktop()) return;
    if (!("IntersectionObserver" in window)) return;

    ioSections = new IntersectionObserver(
        (entries) => {
            if (navLock) return;
            const vis = entries.filter((e) => e.isIntersecting);
            if (!vis.length) return;
            vis.sort((a, b) => {
                const ta = a.boundingClientRect.top,
                    tb = b.boundingClientRect.top;
                if (Math.abs(ta - tb) > 8) return ta - tb;
                return b.intersectionRatio - a.intersectionRatio;
            });
            const id = vis[0].target.id;
            if (id && id !== currentId) {
                currentId = id;
                syncNavUI(id);
                history.replaceState(null, "", `#${id}`);
                saveScrollState();
                if (id === "skills") maybeAnimateSkills();
            }
        },
        { root: null, rootMargin: "0px 0px -40% 0px", threshold: [0.2, 0.5, 0.75] }
    );

    sections.forEach((s) => ioSections.observe(s));
}

/* =========================
   Right slider (mobile)
========================= */
function trapFocus(container) {
    const onKeydown = (e) => {
        if (e.key === "Escape") {
            setMenuOpen(false);
            return;
        }
        if (e.key !== "Tab") return;
        const items = $$(FOCUSABLE, container).filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        if (!items.length) return;
        const first = items[0],
            last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };
    container.addEventListener("keydown", onKeydown);
    return () => container.removeEventListener("keydown", onKeydown);
}

function setMenuOpen(open, { animate = true, focus = true, persist = true } = {}) {
    if (!rightSlider || !hamburger || !mainContent) return;
    const already = rightSlider.dataset.open === "true";
    if (!!open === already) return;

    if (!animate) rightSlider.classList.add("no-anim");

    rightSlider.dataset.open = open ? "true" : "false";
    rightSlider.setAttribute("aria-hidden", open ? "false" : "true");

    setInert(rightSlider, !open);
    setInert(mainContent, open);

    hamburger.dataset.active = open ? "true" : "false";
    hamburger.setAttribute("aria-expanded", open ? "true" : "false");
    mainContent.classList.toggle("blur", open);

    if (open) {
        releaseTrap = trapFocus(rightSlider);
        focus && ($(".slider-item", rightSlider) || rightSlider).focus?.({ preventScroll: true });
        if (persist) try { sessionStorage.setItem(STORAGE_MENU, "1"); } catch { }
    } else {
        if (typeof releaseTrap === "function") releaseTrap();
        releaseTrap = null;
        if (persist) try { sessionStorage.setItem(STORAGE_MENU, "0"); } catch { }
        (lastFocusBeforeMenu || hamburger).focus?.({ preventScroll: true });
    }

    if (!animate)
        requestAnimationFrame(() => rightSlider.classList.remove("no-anim"));
}

/* =========================
   Toasts
========================= */
function toast({ type = "success", title = "", message = "" } = {}) {
    if (!toastStack) return;
    const t = document.createElement("div");
    t.className = `toast-msg ${type}`;
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    const icon =
        type === "success"
            ? "✅"
            : type === "danger"
                ? "❗"
                : type === "warning"
                    ? "⚠️"
                    : "ℹ️";
    t.innerHTML = `
    <div class="icon">${icon}</div>
    <div class="content"><strong>${title || "Notice"}:</strong> ${message}</div>
    <button class="close" type="button" aria-label="Close">&times;</button>
  `.trim();
    const remove = () => {
        t.classList.add("hide");
        setTimeout(() => t.remove(), reducedMotion() ? 0 : 240);
    };
    t.querySelector(".close")?.addEventListener("click", remove);
    const ttl = type === "danger" ? 7000 : 5200;
    const timer = setTimeout(remove, ttl);
    t.addEventListener("mouseenter", () => clearTimeout(timer), { passive: true });
    toastStack.appendChild(t);
    return t;
}

/* =========================
   Research cards (UX fix)
========================= */
function setExpanderVisible(expander, open) {
    if (!expander) return;
    if (open) {
        expander.hidden = false;
        expander.setAttribute("aria-hidden", "false");
        setInert(expander, false);
        void expander.offsetWidth;
    } else {
        expander.setAttribute("aria-hidden", "true");
        setInert(expander, true);
        const done = () => {
            expander.hidden = true;
            expander.removeEventListener("animationend", done);
        };
        expander.addEventListener("animationend", done, { once: true });
        setTimeout(done, reducedMotion() ? 0 : 480);
    }
}
function closeOpenResearch(except = null) {
    $$(".research-card[data-open='true']").forEach((art) => {
        if (except && art === except) return;
        art.dataset.open = "false";
        $(".rc-toggle[aria-expanded]", art)?.setAttribute("aria-expanded", "false");
        setExpanderVisible($(".rc-expander", art), false);
    });
}
function setupResearchCards() {
    document.addEventListener(
        "click",
        (e) => {
            const btn = e.target.closest?.(".rc-toggle");
            if (btn) {
                e.preventDefault();
                const id = btn.dataset.target;
                const exp = id ? document.getElementById(id) : null;
                if (!exp) return;
                const card = exp.closest(".research-card");
                const isOpen = card?.dataset.open === "true";
                if (isOpen) {
                    card.dataset.open = "false";
                    btn.setAttribute("aria-expanded", "false");
                    setExpanderVisible(exp, false);
                } else {
                    closeOpenResearch(card);
                    card.dataset.open = "true";
                    btn.setAttribute("aria-expanded", "true");
                    setExpanderVisible(exp, true);
                    setTimeout(() => $(".rc-close", exp)?.focus({ preventScroll: true }), 10);
                }
                return;
            }
            // Close only when click is completely outside any open card
            const open = $(".research-card[data-open='true']");
            if (open && !open.contains(e.target)) closeOpenResearch();
        },
        { passive: false }
    );

    document.addEventListener(
        "click",
        (e) => {
            const x = e.target.closest?.(".research-card .rc-close");
            if (!x) return;
            e.preventDefault();
            const card = x.closest(".research-card");
            const exp = $(".rc-expander", card);
            card.dataset.open = "false";
            $(".rc-toggle", card)?.setAttribute("aria-expanded", "false");
            setExpanderVisible(exp, false);
            $(".rc-toggle", card)?.focus?.({ preventScroll: true });
        },
        { passive: false }
    );

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeOpenResearch();
    });
}

/* ensure chips row and badges are stable / centered */
function applyResearchCardPatches() {
    ["rc1", "rc2"].forEach((id) => {
        const card = document.getElementById(id);
        if (!card) return;
        const points = $(".rc-points", card);
        if (points) points.classList.add("d-flex", "flex-wrap", "justify-content-center", "gap-2");
        const exp = $(`#${id}-details`);
        const body = exp ? $(".rc-expander-body", exp) : null;
        if (body) $$(".d-flex.flex-wrap.gap-2", body).forEach((r) => {
            if ($$(".chip", r).length) r.remove();
        });
    });

    // Normalize RC2 wording + timeframe once
    const rc2 = $("#rc2");
    if (rc2) {
        const badge = $(".badge-soft-success", rc2);
        if (badge) badge.textContent = "2025–Present";
        const h = $("#rc2-title", rc2) || $(".rc-title-wrap h3", rc2);
        if (h)
            h.textContent =
                "Machine Learning and Geospatial Analysis for Sustainable Agriculture through Groundwater Quality Management in Sylhet, Bangladesh";
    }
}

/* =========================
   Skills progress
========================= */
const skillsState = { inited: false, animated: false, bars: [], section: null, io: null };
function initSkills() {
    if (skillsState.inited || reducedMotion()) return;
    const sec = (skillsState.section = $("#skills"));
    if (!sec) return;
    const containers = $$(".progress[role='progressbar']", sec);
    if (!containers.length) return;

    skillsState.bars = containers.map((p) => {
        const bar = $(".progress-bar", p);
        const cssVal = getComputedStyle(p).getPropertyValue("--val").trim();
        const target =
            cssVal ||
            (p.getAttribute("aria-valuenow")
                ? `${clamp(+p.getAttribute("aria-valuenow") || 0, 0, 100)}%`
                : "0%");
        bar.style.width = "0%";
        bar.style.transition = "none";
        p.setAttribute("aria-valuenow", "0");
        return { bar, parent: p, value: parseFloat(target) || 0, target };
    });
    skillsState.inited = true;

    if ("IntersectionObserver" in window) {
        skillsState.io?.disconnect?.();
        skillsState.io = new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    if (e.isIntersecting && e.intersectionRatio > 0.22) {
                        maybeAnimateSkills();
                        skillsState.io?.disconnect?.();
                    }
                });
            },
            { threshold: [0.15, 0.22, 0.5] }
        );
        skillsState.io.observe(sec);
    }
}
function animateBars() {
    const dur = reducedMotion() ? 1 : 900;
    skillsState.bars.forEach(({ bar, parent, value, target }) => {
        bar.style.transition = `width ${dur}ms cubic-bezier(.22,1,.36,1)`;
        requestAnimationFrame(() => (bar.style.width = target));
        const start = performance.now();
        const tick = (ts) => {
            const t = Math.min(1, (ts - start) / dur);
            const eased = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
            parent.setAttribute("aria-valuenow", String(Math.round(value * eased)));
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}
function elemVisible(el, thr = 0.22) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    const ratio = visible / Math.max(r.height, 1);
    return ratio >= thr;
}
function maybeAnimateSkills() {
    if (!skillsState.inited || skillsState.animated || !visualsReady) return;
    const activeDesk =
        isDesktop() && (activeSectionEl()?.id === "skills" || currentId === "skills");
    if (elemVisible(skillsState.section, 0.22) || activeDesk) {
        skillsState.animated = true;
        animateBars();
    }
}

/* =========================
   Contact form (EmailJS + mailto fallback)
========================= */
const EMAILJS = {
    PUBLIC_KEY: "G5fgtKtfm0tx0NWHU",
    SERVICE_ID: "service_w4wxv6x",
    TEMPLATE_ID: "template_i56317p",
};

function emailjsInit() {
    try {
        window.emailjs?.init?.({ publicKey: EMAILJS.PUBLIC_KEY });
    } catch { }
}
function setupContactForm() {
    const form = $("#contactForm");
    const submitBtn = $("#contactSubmit");
    if (!form || !submitBtn) return;

    let iconEl = null,
        spinEl = null;
    const labelEl = submitBtn.querySelector("span");
    const baseLabel = labelEl?.textContent || "Send Message";

    const busy = (on) => {
        submitBtn.disabled = on;
        submitBtn.setAttribute("aria-busy", on ? "true" : "false");
        if (!iconEl) iconEl = submitBtn.querySelector("i");
        if (on) {
            if (!spinEl) {
                spinEl = document.createElement("span");
                spinEl.className = "spinner-border spinner-border-sm";
                spinEl.setAttribute("role", "status");
                spinEl.setAttribute("aria-hidden", "true");
            }
            iconEl?.replaceWith(spinEl);
            labelEl && (labelEl.textContent = "Sending...");
        } else {
            spinEl && iconEl && spinEl.replaceWith(iconEl);
            labelEl && (labelEl.textContent = baseLabel);
        }
    };

    const serialize = (f) => {
        const fd = new FormData(f);
        const o = {};
        fd.forEach((v, k) => (o[k] = String(v).trim()));
        return o;
    };
    const isEmail = (v) => /^\S+@\S+\.\S+$/.test(v);

    form.addEventListener(
        "invalid",
        (e) => {
            const t = e.target;
            t.classList.add("is-invalid");
            form.classList.add("was-validated");
        },
        true
    );

    form.addEventListener(
        "input",
        (e) => {
            const t = e.target;
            if (
                (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) &&
                t.checkValidity()
            ) {
                t.classList.remove("is-invalid");
            }
        },
        { passive: true }
    );

    const tryEmailJS = async (payload) => {
        try {
            emailjsInit();
            if (!window.emailjs?.send) throw new Error("EmailJS not available");
            const params = {
                from_name: payload.name,
                from_email: payload.email,
                message: payload.message,
                sentAt: payload.sentAt,
            };
            const res = await emailjs.send(
                EMAILJS.SERVICE_ID,
                EMAILJS.TEMPLATE_ID,
                params
            );
            return { ok: true, status: res?.status || 200 };
        } catch (err) {
            return { ok: false, error: err };
        }
    };

    const mailtoFallback = (p) => {
        const to = form.dataset.mailto?.trim() || "rahat3286@gmail.com";
        const subject = encodeURIComponent(`Portfolio message from ${p.name}`);
        const body = encodeURIComponent(`${p.message}\n\n— ${p.name} <${p.email}>`);
        location.href = `mailto:${to}?subject=${subject}&body=${body}`;
        return { ok: true, fallback: "mailto" };
    };

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const hp = form.querySelector(".hp-field");
        if (hp && hp.value) {
            // Honey-pot: silently accept
            toast({ type: "success", title: "Message received", message: "Thanks! (bot trap passed)" });
            form.reset();
            form.classList.remove("was-validated");
            $$(".is-invalid", form).forEach((el) => el.classList.remove("is-invalid"));
            return;
        }

        form.classList.add("was-validated");
        if (!form.checkValidity()) {
            const inv = form.querySelector(":invalid");
            inv?.classList.add("is-invalid");
            inv?.focus({ preventScroll: true });
            return;
        }

        const data = serialize(form);
        if (!isEmail(data.email)) {
            toast({
                type: "danger",
                title: "Invalid email",
                message: "Please provide a valid email address.",
            });
            const el = $("#email");
            el?.classList.add("is-invalid");
            el?.focus({ preventScroll: true });
            return;
        }

        busy(true);
        const payload = {
            name: data.name,
            email: data.email,
            message: data.message,
            sentAt: new Date().toISOString(),
        };
        let result = await tryEmailJS(payload);
        if (!result.ok) result = mailtoFallback(payload);
        busy(false);

        if (result.ok) {
            toast({
                type: "success",
                title: "Sent",
                message:
                    result.fallback === "mailto"
                        ? "Opening your mail client… If it doesn’t open, email me directly."
                        : "Your message was sent successfully. I’ll get back to you soon.",
            });
            form.reset();
            form.classList.remove("was-validated");
            $$(".is-invalid", form).forEach((el) => el.classList.remove("is-invalid"));
        } else {
            toast({
                type: "danger",
                title: "Couldn’t send",
                message: "Please try again or email me directly at rahat3286@gmail.com.",
            });
        }
    });
}

/* =========================
   Phone + Email convenience
========================= */
function setupTelCopy() {
    document.addEventListener(
        "click",
        async (e) => {
            const tel = e.target.closest?.('a[href^="tel:"]');
            if (!tel) return;
            const num = (tel.getAttribute("href") || "").replace("tel:", "").trim();
            if (!num) return;
            try {
                await navigator.clipboard?.writeText?.(num);
                toast({ type: "info", title: "Number copied", message: "Opening dialer…" });
            } catch {
                /* ignore */
            }
        },
        { passive: false }
    );
}
function setupEmailLinks() {
    const isMobile = () =>
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent
        );

    function openGmail({ to, subject = "", body = "" }) {
        const enc = encodeURIComponent;
        const web = `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(
            to
        )}&su=${enc(subject)}&body=${enc(body)}`;
        try {
            navigator.clipboard?.writeText?.(to);
        } catch { }

        if (!isMobile()) {
            window.open(web, "_blank", "noopener,noreferrer");
            toast({
                type: "info",
                title: "Compose email",
                message: "Opening Gmail on the web. Address copied.",
            });
            return;
        }

        const isiOS = /iPad|iPhone|iPod/i.test(navigator.userAgent);
        const appUrl = isiOS
            ? `googlegmail://co?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`
            : `intent://co?to=${enc(to)}&subject=${enc(subject)}&body=${enc(
                body
            )}#Intent;scheme=googlegmail;package=com.google.android.gm;end`;

        let hidden = false;
        const onHide = () => {
            if (document.hidden) {
                hidden = true;
                document.removeEventListener("visibilitychange", onHide);
            }
        };
        document.addEventListener("visibilitychange", onHide, { passive: true });

        setTimeout(() => {
            document.removeEventListener("visibilitychange", onHide);
            if (!hidden) window.location.href = web;
        }, 850);

        try {
            window.location.href = appUrl;
            toast({
                type: "info",
                title: "Compose email",
                message: "Trying Gmail app… Address copied.",
            });
        } catch {
            window.location.href = web;
        }
    }

    document.addEventListener(
        "click",
        (e) => {
            const mail =
                e.target.closest?.('a[href^="mailto:"]') ||
                e.target.closest?.('a[data-kind="email"]');
            if (!mail) return;
            e.preventDefault();
            const data = mail.getAttribute("data-email")?.trim();
            const href = mail.getAttribute("href") || "";
            const to =
                data || href.replace(/^mailto:/i, "").split("?")[0] || "rahat3286@gmail.com";
            let subject = "",
                body = "";
            if (href.includes("?")) {
                const qs = new URLSearchParams(href.split("?")[1]);
                subject = qs.get("subject") || qs.get("su") || "";
                body = qs.get("body") || "";
            }
            openGmail({ to, subject, body });
        },
        { passive: false }
    );
}

/* =========================
   Typewriter (polite)
========================= */
const typeState = { started: false, paused: false, tid: 0 };
function startTypewriter(el, list) {
    if (!el || !list?.length) return;
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    if (reducedMotion()) {
        el.textContent = list[0];
        return;
    }

    const TYPE = 46,
        DEL = 30,
        HOLD = 1000;
    let pi = 0,
        ci = 0,
        typing = true;
    function step() {
        if (typeState.paused) return;
        const p = list[pi];
        if (typing) {
            if (ci < p.length) {
                ci++;
                el.textContent = p.slice(0, ci);
                typeState.tid = setTimeout(step, TYPE);
            } else {
                typing = false;
                typeState.tid = setTimeout(step, HOLD);
            }
        } else {
            if (ci > 0) {
                ci--;
                el.textContent = p.slice(0, ci);
                typeState.tid = setTimeout(step, DEL);
            } else {
                typing = true;
                pi = (pi + 1) % list.length;
                typeState.tid = setTimeout(step, 240);
            }
        }
    }
    typeState.started = true;
    typeState.paused = false;
    step();

    document.addEventListener("visibilitychange", () => {
        clearTimeout(typeState.tid);
        if (document.visibilityState === "hidden") {
            typeState.paused = true;
        } else if (typeState.paused) {
            typeState.paused = false;
            typeState.tid = setTimeout(step, 140);
        }
    });
}
function maybeStartTypewriter() {
    if (typeState.started || !visualsReady || !typewriterEl) return;
    const phrases =
        typewriterEl.dataset.phrases
            ?.split("|")
            .map((s) => s.trim())
            .filter(Boolean) || [
            "An Environmental Expert",
            "A GIS Enthusiast",
            "A Research Aspirant",
            "A Data Analyst",
        ];
    startTypewriter(typewriterEl, phrases);
}

/* =========================
   Hero image fallback
========================= */
function installHeroFallback() {
    if (!heroImg) return;
    const tried = new Set();
    const candidates = [];
    const cur = heroImg.getAttribute("src");
    if (cur) candidates.push(cur);
    ["hero-image.png", "hero-figure.png"].forEach((p) => {
        if (p && p !== cur) candidates.push(p);
    });
    const tryNext = () => {
        const next = candidates.find((c) => !tried.has(c));
        if (!next) return;
        tried.add(next);
        heroImg.src = next;
    };
    heroImg.addEventListener("error", tryNext);
    if (!cur) tryNext();
}

/* =========================
   Fit contact text
========================= */
let fitRAF = 0,
    fitRO = null;
function wrapFit(scope) {
    if (!scope) return null;
    scope.setAttribute("data-fit-scope", "");
    let inner = scope.querySelector("[data-fit]");
    if (inner) return inner;
    inner = document.createElement("span");
    inner.setAttribute("data-fit", "");
    while (scope.firstChild) inner.appendChild(scope.firstChild);
    scope.appendChild(inner);
    return inner;
}
function measureFit(scope) {
    const inner = wrapFit(scope);
    if (!inner) return;
    inner.style.setProperty("--fit", "1");
    const avail = Math.max(1, scope.clientWidth || scope.getBoundingClientRect().width || 1);
    const natural = Math.max(inner.scrollWidth, inner.getBoundingClientRect().width || 1);
    const scale = natural <= 1 ? 1 : clamp(avail / natural, 0.6, 1.05);
    inner.style.setProperty("--fit", String(scale));
}
function fitContactText() {
    cancelAnimationFrame(fitRAF);
    fitRAF = requestAnimationFrame(() => {
        $$(".ci-content .ci-label, .ci-content .ci-value").forEach(measureFit);
    });
}
function initContactFit() {
    fitContactText();
    try {
        if (!fitRO && "ResizeObserver" in window) {
            fitRO = new ResizeObserver(() => fitContactText());
            $$(".ci-item").forEach((it) => fitRO.observe(it));
        }
    } catch { }
    window.addEventListener("resize", fitContactText, { passive: true });
    window.addEventListener("orientationchange", fitContactText, { passive: true });
    if (document.fonts?.ready) document.fonts.ready.then(() => fitContactText());
    else setTimeout(fitContactText, 300);
}

/* =========================
   Scroll persistence
========================= */
function readScrollState() {
    try {
        const raw = sessionStorage.getItem(STORAGE_SCROLL);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}
let saveQueued = false,
    saveRAF = 0;
function saveScrollState() {
    if (saveQueued) return;
    saveQueued = true;
    cancelAnimationFrame(saveRAF);
    saveRAF = requestAnimationFrame(() => {
        saveQueued = false;
        const state = {
            ts: Date.now(),
            mode: isDesktop() ? "desktop" : "mobile",
            id: currentId || sections[0]?.id || "home",
            scrollTop: 0,
            version: 8,
        };
        if (isDesktop()) {
            state.scrollTop = activeSectionEl()?.scrollTop || 0;
        } else {
            state.scrollTop =
                window.scrollY || document.documentElement.scrollTop || 0;
            let best = { id: state.id, top: Infinity };
            sections.forEach((sec) => {
                const t = Math.abs(sec.getBoundingClientRect().top);
                if (t < best.top) best = { id: sec.id, top: t };
            });
            state.id = best.id || state.id;
        }
        try {
            sessionStorage.setItem(STORAGE_SCROLL, JSON.stringify(state));
        } catch { }
    });
}
function restoreSavedScroll() {
    const saved = readScrollState();
    const startId =
        (location.hash &&
            document.getElementById(location.hash.slice(1)) &&
            location.hash.slice(1)) ||
        saved?.id ||
        sections[0]?.id ||
        "home";

    showSection(startId, true, { preserveScroll: true });
    if (isDesktop()) {
        const a = activeSectionEl();
        if (a) a.scrollTop = Math.max(0, Number(saved?.scrollTop) || 0);
    } else {
        window.scrollTo({
            top: Math.max(0, Number(saved?.scrollTop) || 0),
            behavior: "auto",
        });
    }
}

/* =========================
   Back to Top
========================= */
(function backToTopInit() {
    if (!backToTopBtn) return;
    const SHOW_AT = 250,
        MAX_W = 992;
    let ticking = false;

    const compute = () => {
        const doc = document.documentElement;
        const st = window.scrollY || doc.scrollTop || 0;
        const max = Math.max(1, doc.scrollHeight - doc.clientHeight);
        return { st, pct: Math.min(100, Math.max(0, (st / max) * 100)) };
    };
    const update = () => {
        const { st, pct } = compute();
        const show = window.innerWidth < MAX_W && st > SHOW_AT;
        backToTopBtn.classList.toggle("show", show);
        backToTopBtn.style.setProperty("--p", pct.toFixed(2) + "%");
    };
    const queue = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            update();
            ticking = false;
        });
    };

    backToTopBtn.addEventListener("click", () =>
        window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" })
    );
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue, { passive: true });
    window.addEventListener("load", update, { once: true });
})();

/* =========================
   Navigation wiring
========================= */
// Desktop: sidebar clicks
sidebar?.addEventListener(
    "click",
    (e) => {
        const link = e.target.closest(".nav-link");
        if (!link) return;
        const id = getTargetFrom(link);
        if (!id) return;
        e.preventDefault();
        showSection(id, true);
    },
    { passive: false }
);

// Desktop: focus a sidebar link -> show section (keyboard friendly)
sidebarLinks.forEach((a) => {
    a.addEventListener("focus", () => {
        if (!isDesktop()) return;
        const id = getTargetFrom(a);
        if (!id) return;
        showSection(id, true, { preserveScroll: true });
    });
});

// Mobile slider nav
sliderItemsBox?.addEventListener(
    "click",
    (e) => {
        const btn = e.target.closest(".slider-item");
        if (!btn) return;
        const id = getTargetFrom(btn);
        if (!id) return;
        e.stopPropagation();
        showSection(id, true);
        if (!isDesktop() && rightSlider?.dataset.open === "true") setMenuOpen(false);
    },
    { passive: false }
);

// Keyboard activation on slider items
sliderItems.forEach((it) => {
    it.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const id = getTargetFrom(it);
            if (!id) return;
            showSection(id, true);
            if (!isDesktop() && rightSlider?.dataset.open === "true")
                setMenuOpen(false);
        }
    });
});

// Hamburger toggle
hamburger?.addEventListener(
    "click",
    (e) => {
        e.stopPropagation();
        lastFocusBeforeMenu = document.activeElement;
        setMenuOpen(!(rightSlider?.dataset.open === "true"));
    },
    { passive: false }
);

// Outside click closes menu
document.addEventListener(
    "click",
    (e) => {
        if (
            rightSlider?.dataset.open === "true" &&
            !rightSlider.contains(e.target) &&
            !hamburger.contains(e.target)
        ) {
            setMenuOpen(false);
        }
    },
    { passive: true }
);

// Escape closes menu
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && rightSlider?.dataset.open === "true") setMenuOpen(false);
});

// Skip link: on desktop, route to section
skipLink?.addEventListener(
    "click",
    (e) => {
        const href = skipLink.getAttribute("href") || "";
        const id = href.startsWith("#") ? href.slice(1) : "";
        if (!id) return;
        if (isDesktop() && document.getElementById(id)?.classList.contains("section")) {
            e.preventDefault();
            showSection(id, true);
        }
    },
    { passive: false }
);

/* Global in-page section routing:
   - Fixes “Get In Touch” buttons (and any anchor with data-scroll-to / hash)
   - Works in both desktop slide-mode and mobile scroll mode */
document.addEventListener(
    "click",
    (e) => {
        const a = e.target.closest('a[data-scroll-to], a[href^="#"]');
        if (!a) return;
        // ignore if it's meant to download or toggle research card
        if (a.hasAttribute("download") || a.classList.contains("rc-toggle")) return;

        const id = getTargetFrom(a);
        if (!id) return;
        const sec = document.getElementById(id);
        if (!sec || !sec.classList.contains("section")) return;

        e.preventDefault();
        showSection(id, true);
    },
    { passive: false }
);

/* Hash navigation */
window.addEventListener("hashchange", () => {
    const id = location.hash?.slice(1);
    if (id && document.getElementById(id)) showSection(id, false);
});

/* =========================
   Resize / Mode init
========================= */
let resizeRAF = 0;
function onResize() {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => {
        const now = isDesktop();
        if (now !== wasDesktop) {
            const saved = readScrollState();
            // re-init layout without losing scrolls
            initMode({ initialId: saved?.id, preserveScroll: true });
            restoreSavedScroll();
        } else {
            applyHeadingClearance();
        }
        maybeAnimateSkills();
        wasDesktop = now;
        syncBrandTop();
        fitContactText();
    });
}
function initMode({ initialId = null, preserveScroll = false } = {}) {
    const startId =
        (location.hash &&
            document.getElementById(location.hash.slice(1)) &&
            location.hash.slice(1)) ||
        initialId ||
        sections[0]?.id ||
        "home";

    if (isDesktop()) {
        sections.forEach((s) => (s.dataset.active = "false"));
        const t = document.getElementById(startId);
        if (t) {
            t.dataset.active = "true";
            if (!preserveScroll) restoreSectionScroll(t);
        }
        window.scrollTo(0, 0);
    } else if (!preserveScroll) {
        document.getElementById(startId)?.scrollIntoView({ block: "start" });
    }

    currentId = startId;
    syncNavUI(startId);
    setupSectionObserver();
    applyHeadingClearance();

    if (isDesktop() && rightSlider?.dataset.open === "true") {
        setMenuOpen(false, { animate: false, focus: false, persist: false });
    }
    syncBrandTop();
}

/* =========================
   Boot
========================= */
window.addEventListener("DOMContentLoaded", () => {
    // top indicator + skeleton
    playIndicator(0.35, 600);
    emailjsInit();

    // avoid skeleton flash on super-fast loads
    skelTimer = setTimeout(showSkeleton, 140);

    const saved = readScrollState();
    initMode({ initialId: saved?.id, preserveScroll: true });

    try {
        const shouldOpen = sessionStorage.getItem(STORAGE_MENU) === "1";
        if (shouldOpen && !isDesktop()) setMenuOpen(true, { animate: false, focus: false, persist: false });
    } catch { }

    setupResearchCards();
    initSkills();
    setupContactForm();
    setupTelCopy();
    setupEmailLinks();
    installHeroFallback();
    initContactFit();

    if (isDesktop()) {
        sections.forEach((sec) => sec.addEventListener("scroll", saveScrollState, { passive: true }));
    } else {
        window.addEventListener("scroll", saveScrollState, { passive: true });
    }

    // Safety: ensure UI-ready even on extremely quick loads
    setTimeout(() => {
        if (!document.documentElement.classList.contains("ui-ready")) {
            markUiReady();
            applyHeadingClearance();
            maybeStartTypewriter();
            initSkills();
            maybeAnimateSkills();
            applyResearchCardPatches();
        }
    }, 3000);
});

window.addEventListener("load", () => {
    clearTimeout(skelTimer);
    if (!skelVisible) {
        indicatorEl?.classList.remove("waiting");
        playIndicator(1, 600);
        setTimeout(() => indicatorEl?.classList.remove("visible"), reducedMotion() ? 0 : 620);
        markUiReady();
        applyHeadingClearance();
        restoreSavedScroll();
        maybeStartTypewriter();
        initSkills();
        maybeAnimateSkills();
        applyResearchCardPatches();
    } else {
        hideSkeleton();
    }
    setTimeout(maybeAnimateSkills, 160);
    setTimeout(fitContactText, 100);
});

window.addEventListener("beforeunload", saveScrollState);
window.addEventListener("pagehide", saveScrollState);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveScrollState();
});

window.addEventListener("resize", onResize, { passive: true });
window.addEventListener("orientationchange", onResize, { passive: true });
