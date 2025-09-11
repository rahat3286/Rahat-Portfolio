"use strict";

/* ============================================================================
   Rahat Portfolio — App JS (refined & patched)
   - Desktop slide-mode with per-section scroll memory
   - Mobile smooth-scroll + active nav sync
   - Right drawer with focus trapping + inert polyfill (a11y)
   - Research card expanders (max-height, safer toggles)
   - Skills progress animation on view (one-shot; respects R.M.)
   - Contact form with EmailJS + mailto fallback with clear feedback
   - Toast system, typewriter (a11y), hero image fallback
   - Skeleton/progress bar wiring and UI-ready safety
   - Misc fixes: skip-link safeguard, robust showSection, CQI fallbacks, etc.
============================================================================ */

/* ========= CONFIG / UTILS ========= */
const BREAKPOINT = 991.98;
const isDesktop = () => window.innerWidth > BREAKPOINT;
const prefersReducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const $ = (s, sc = document) => sc.querySelector(s);
const $$ = (s, sc = document) => Array.from(sc.querySelectorAll(s));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const FOCUSABLE = `
a[href]:not([tabindex="-1"]):not([inert]),
area[href]:not([tabindex="-1"]):not([inert]),
button:not([disabled]):not([tabindex="-1"]):not([inert]),
input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]):not([inert]),
select:not([disabled]):not([tabindex="-1"]):not([inert]),
textarea:not([disabled]):not([tabindex="-1"]):not([inert]),
[tabindex]:not([tabindex="-1"]):not([inert])
`.trim();

/** Get the destination target id from various clickable elements. */
function getTargetFrom(el) {
    if (!el) return "";
    const ds =
        el.dataset?.target ||
        (el.getAttribute ? el.getAttribute("data-scroll-to") : "");
    if (ds) return ds;
    const href = el.getAttribute ? el.getAttribute("href") : "";
    if (!href) return "";
    if (href.startsWith("#")) return href.slice(1);
    try {
        const u = new URL(href, location.href);
        return u.hash ? u.hash.slice(1) : "";
    } catch {
        return "";
    }
}

/* ========= DOM HOOKS ========= */
const sidebar = $("#sidebar");
const sidebarLinks = $$("#sidebar .nav-link");
const sections = $$("#main-content .section");
const mainContent = $("#main-content");
const rightSlider = $("#rightSlider");
const sliderItemsWrap = $("#sliderItems");
const sliderItems = $$("#rightSlider .slider-item");
const hamburger = $("#hamburger");
const skipLink = $("#skipLink");
const indicatorEl = $("#reload-indicator");
const skeletonEl = $("#page-skeleton");
const toastStack = $("#toast-stack");
const heroImg = $(".hero-img");
const brandTop = $("#brandTop");
const typewriterEl = $("#typewriter");
const backToTopBtn = $("#backToTop");

/* ========= STATE ========= */
const MENU_STORAGE_KEY = "rightSliderOpen";
const SCROLL_KEY = "scrollStateV7";

let currentId = null;
let visualsReady = false;
let wasDesktop = null;
let navLock = false;
let releaseFocusTrap = null;
let lastFocusBeforeMenu = null;
let ioSections = null; // mobile section observer
let saveScrollRAF = 0;
const sectionScroll = new Map();

/* ========= INERT POLYFILL (for browsers w/o native inert) ========= */
const inertSupported = "inert" in HTMLElement.prototype;
/** Disable/restore focus + interaction within a subtree. */
function setInert(el, makeInert) {
    if (!el) return;
    if (inertSupported) {
        if (makeInert) el.setAttribute("inert", "");
        else el.removeAttribute("inert");
        return;
    }
    // Fallback: block pointer events (CSS) + remove focusability
    if (makeInert) {
        el.setAttribute("inert", "");
        const focusables = $$(FOCUSABLE, el);
        focusables.forEach((f) => {
            if (!f.hasAttribute("data-prev-tabindex")) {
                if (f.hasAttribute("tabindex")) {
                    f.setAttribute("data-prev-tabindex", f.getAttribute("tabindex"));
                } else {
                    f.setAttribute("data-prev-tabindex", "none");
                }
            }
            f.setAttribute("tabindex", "-1");
        });
    } else {
        const focusables = $$(FOCUSABLE, el);
        focusables.forEach((f) => {
            const prev = f.getAttribute("data-prev-tabindex");
            if (prev !== null) {
                if (prev === "none") f.removeAttribute("tabindex");
                else f.setAttribute("tabindex", prev);
                f.removeAttribute("data-prev-tabindex");
            }
        });
        el.removeAttribute("inert");
    }
}

/* ========= PROGRESS BAR / SKELETON ========= */
function setIndicatorProgress(p) {
    indicatorEl?.style.setProperty("--progress", String(p));
}
function playTo(target, ms = 900) {
    if (!indicatorEl) return;
    indicatorEl.classList.add("visible");
    const fill = indicatorEl.querySelector(".fill");
    fill?.classList.remove("animate");
    indicatorEl.style.setProperty(
        "--ri-duration",
        prefersReducedMotion() ? "1ms" : `${ms}ms`
    );
    requestAnimationFrame(() => {
        fill?.classList.add("animate");
        setIndicatorProgress(target);
    });
}
function startIndicatorHold() {
    if (!indicatorEl) return;
    playTo(0.7, 700);
    indicatorEl.classList.add("waiting");
}
function completeIndicator() {
    if (!indicatorEl) return;
    indicatorEl.classList.remove("waiting");
    playTo(1, 600);
    const done = () => indicatorEl.classList.remove("visible");
    prefersReducedMotion() ? done() : setTimeout(done, 600);
}

let skeletonTimer = 0;
let skeletonVisible = false;

function showSkeleton() {
    if (!skeletonEl) return;
    skeletonEl.hidden = false;
    skeletonEl.dataset.visible = "true";
    document.body.setAttribute("aria-busy", "true"); // CSS hides UI to prevent bleed-through
    skeletonVisible = true;
    startIndicatorHold();
}
function markUiReady() {
    document.documentElement.classList.add("ui-ready");
    visualsReady = true;
}
function hideSkeleton() {
    if (!skeletonEl) return;
    skeletonEl.dataset.visible = "false";
    document.body.removeAttribute("aria-busy");
    skeletonVisible = false;
    completeIndicator();
    setTimeout(() => {
        skeletonEl.hidden = true;
        markUiReady(); // ensure animated brand/hero end state sticks
        applyDynamicHeadingClearance();
        restoreSavedScrollIfAny();
        maybeStartTypewriter();
        initSkillsOnce();
        maybeTriggerSkillsProgress();
    }, prefersReducedMotion() ? 0 : 120);
}

/* ========= NAV / SECTIONS ========= */
function withNavLock(ms = 500) {
    navLock = true;
    setTimeout(() => (navLock = false), prefersReducedMotion() ? 0 : ms);
}
function focusSection(target) {
    target?.focus?.({ preventScroll: true });
}
function getActiveSectionEl() {
    return sections.find((s) => s.dataset.active === "true") || null;
}

function saveActiveSectionScroll() {
    if (!isDesktop()) return;
    const active = getActiveSectionEl();
    if (active) sectionScroll.set(active.id, active.scrollTop);
}
function restoreSectionScroll(target) {
    if (!isDesktop() || !target) return;
    target.scrollTop = sectionScroll.get(target.id) ?? 0;
}

function applyDynamicHeadingClearance() {
    sections.forEach((section) => {
        const heading = $(".section-heading", section);
        const rect = heading?.getBoundingClientRect?.();
        const h = rect?.height || heading?.offsetHeight || 0;
        section.style.setProperty("--dynamic-clear", `${Math.ceil(h + 24)}px`);
    });
}

function syncActiveUI(targetId) {
    // Ignore if unknown id
    if (!document.getElementById(targetId)) return;
    sidebarLinks.forEach((a) => {
        const active = getTargetFrom(a) === targetId;
        a.dataset.active = active ? "true" : "false";
        active
            ? a.setAttribute("aria-current", "page")
            : a.removeAttribute("aria-current");
    });
    sliderItems.forEach((btn) => {
        const active = getTargetFrom(btn) === targetId;
        btn.dataset.active = active ? "true" : "false";
        active
            ? btn.setAttribute("aria-current", "page")
            : btn.removeAttribute("aria-current");
    });
}

/** Safe section router; works for both desktop slide-mode and mobile document flow. */
function showSection(targetId, pushHash = true, { preserveScroll = false } = {}) {
    const target = document.getElementById(targetId);
    if (!target) return;

    // If already active/visible, just ensure focus + sync + optional scroll restore
    if (currentId === targetId) {
        if (isDesktop()) {
            if (!preserveScroll) restoreSectionScroll(target);
            focusSection(target);
            applyDynamicHeadingClearance();
        } else if (!preserveScroll) {
            target.scrollIntoView({
                behavior: prefersReducedMotion() ? "auto" : "smooth",
                block: "start",
            });
            requestAnimationFrame(() => focusSection(target));
        }
        syncActiveUI(targetId);
        if (pushHash) history.replaceState(null, "", `#${targetId}`);
        return;
    }

    const lockMs = prefersReducedMotion() ? 0 : isDesktop() ? 500 : 800;
    withNavLock(lockMs);

    if (isDesktop()) {
        saveActiveSectionScroll();
        sections.forEach((sec) => (sec.dataset.active = sec === target ? "true" : "false"));
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        requestAnimationFrame(() => {
            if (!preserveScroll) restoreSectionScroll(target);
            focusSection(target);
            applyDynamicHeadingClearance();
        });
    } else if (!preserveScroll) {
        target.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "start",
        });
        requestAnimationFrame(() => focusSection(target));
    }

    currentId = targetId;
    syncActiveUI(targetId);
    if (pushHash) history.replaceState(null, "", `#${targetId}`);
    if (targetId === "skills") setTimeout(maybeTriggerSkillsProgress, 60);
}

function setupIntersectionObserver() {
    ioSections?.disconnect?.();
    ioSections = null;
    if (isDesktop()) return;

    if ("IntersectionObserver" in window) {
        ioSections = new IntersectionObserver(
            (entries) => {
                if (navLock) return;
                // Get entries entering viewport
                const visible = entries.filter((e) => e.isIntersecting);
                if (!visible.length) return;

                // Choose section nearest to top; break ties by larger ratio
                visible.sort((a, b) => {
                    const ta = a.boundingClientRect.top;
                    const tb = b.boundingClientRect.top;
                    if (Math.abs(ta - tb) > 8) return ta - tb;
                    return b.intersectionRatio - a.intersectionRatio;
                });
                const id = visible[0].target.id;
                if (!id || id === currentId) return;
                currentId = id;
                syncActiveUI(id);
                history.replaceState(null, "", `#${id}`);
                saveScrollState();
                if (id === "skills") maybeTriggerSkillsProgress();
            },
            { root: null, rootMargin: "0px 0px -40% 0px", threshold: [0.2, 0.5, 0.75] }
        );
        sections.forEach((s) => ioSections.observe(s));
    } else {
        // Lightweight fallback
        const onScroll = () => {
            if (navLock) return;
            let best = { id: null, top: Infinity };
            sections.forEach((sec) => {
                const t = sec.getBoundingClientRect().top;
                if (t >= 0 && t < best.top) best = { id: sec.id, top: t };
            });
            if (best.id && best.id !== currentId) {
                currentId = best.id;
                syncActiveUI(best.id);
                history.replaceState(null, "", `#${best.id}`);
                saveScrollState();
                if (best.id === "skills") maybeTriggerSkillsProgress();
            }
        };
        window.addEventListener("scroll", onScroll, { passive: true });
    }
}

function initMode({ initialId = null, preserveScroll = false } = {}) {
    const startId =
        (location.hash && document.getElementById(location.hash.slice(1)) && location.hash.slice(1)) ||
        initialId ||
        sections[0]?.id ||
        "home";

    if (isDesktop()) {
        sections.forEach((sec) => (sec.dataset.active = "false"));
        const target = document.getElementById(startId);
        if (target) {
            target.dataset.active = "true";
            if (!preserveScroll) restoreSectionScroll(target);
        }
        window.scrollTo(0, 0);
    } else if (!preserveScroll) {
        document.getElementById(startId)?.scrollIntoView({ block: "start" });
    }

    currentId = startId;
    syncActiveUI(startId);
    setupIntersectionObserver();
    applyDynamicHeadingClearance();

    if (isDesktop() && rightSlider?.dataset.open === "true") {
        setMenuOpen(false, { animate: false, focus: false, persist: false });
    }
    syncBrandTop();
}

/* ========= RIGHT SLIDER (Mobile) ========= */
function trapFocus(container) {
    const onKeydown = (e) => {
        if (e.key === "Escape") {
            setMenuOpen(false);
            return;
        }
        if (e.key !== "Tab") return;
        const focusables = $$(FOCUSABLE, container).filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const [first, last] = [focusables[0], focusables[focusables.length - 1]];
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
        releaseFocusTrap = trapFocus(rightSlider);
        if (focus) ($(".slider-item", rightSlider) || rightSlider).focus?.({ preventScroll: true });
        if (persist) try { sessionStorage.setItem(MENU_STORAGE_KEY, "1"); } catch { /* ignore */ }
    } else {
        if (typeof releaseFocusTrap === "function") releaseFocusTrap();
        releaseFocusTrap = null;
        if (persist) try { sessionStorage.setItem(MENU_STORAGE_KEY, "0"); } catch { /* ignore */ }
        (lastFocusBeforeMenu || hamburger).focus?.({ preventScroll: true });
    }

    if (!animate) requestAnimationFrame(() => rightSlider.classList.remove("no-anim"));
}

/* ========= TOASTS ========= */
function showToast({ type = "success", title = "", message = "" } = {}) {
    if (!toastStack) return null;
    const toast = document.createElement("div");
    toast.className = `toast-msg ${type}`;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `
    <div class="icon">${type === "success" ? "✅" : type === "danger" ? "❗" : type === "warning" ? "⚠️" : "ℹ️"}</div>
    <div class="content"><strong>${title || (type === "success" ? "Success" : "Notice")}:</strong> ${message}</div>
    <button class="close" type="button" aria-label="Close">&times;</button>
  `.trim();
    const remove = () => {
        toast.classList.add("hide");
        setTimeout(() => toast.remove(), prefersReducedMotion() ? 0 : 220);
    };
    toast.querySelector(".close")?.addEventListener("click", remove);
    const ttl = type === "danger" ? 7000 : 5200;
    const timer = setTimeout(remove, ttl);
    toast.addEventListener("mouseenter", () => clearTimeout(timer), { passive: true });
    toastStack.appendChild(toast);
    return toast;
}

/* ========= RESEARCH CARDS ========= */
const RC_DUR_OPEN = 520;
const RC_DUR_CLOSE = 400;

function setExpanderVisibility(expander, open) {
    if (!expander) return;
    if (open) {
        expander.hidden = false;
        expander.setAttribute("aria-hidden", "false");
        setInert(expander, false);
        void expander.offsetWidth; // force style recalc to kick animation
        return;
    }
    expander.setAttribute("aria-hidden", "true");
    setInert(expander, true);
    const done = () => {
        expander.hidden = true;
        expander.removeEventListener("animationend", done);
    };
    expander.addEventListener("animationend", done, { once: true });
    setTimeout(done, prefersReducedMotion() ? 0 : RC_DUR_CLOSE + 60); // safety
}

function closeAnyOpenResearch(exceptArticle = null) {
    $$(".research-card[data-open='true']").forEach((art) => {
        if (exceptArticle && art === exceptArticle) return;
        art.dataset.open = "false";
        $(".rc-toggle[aria-expanded]", art)?.setAttribute("aria-expanded", "false");
        setExpanderVisibility($(".rc-expander", art), false);
    });
}

function setExpanderMaxHeight(article) {
    const expander = $(".rc-expander", article);
    if (!expander) return;
    // Clamp to viewport and card size; avoid overflows.
    const maxH = Math.max(
        240,
        Math.floor(Math.min(window.innerHeight * 0.8, article.clientHeight * 0.9))
    );
    expander.style.maxHeight = `${maxH}px`;
}
function adjustOpenResearchExpander() {
    const open = $(".research-card[data-open='true']");
    if (open) setExpanderMaxHeight(open);
}

function setupResearchCards() {
    document.addEventListener(
        "click",
        (e) => {
            const btn = e.target.closest?.(".rc-toggle");
            if (btn) {
                e.preventDefault();
                const targetId = btn.dataset.target;
                const expander = targetId ? document.getElementById(targetId) : null;
                if (!expander) return;
                const article = expander.closest(".research-card");
                const isOpen = article?.dataset.open === "true";
                if (isOpen) {
                    article.dataset.open = "false";
                    btn.setAttribute("aria-expanded", "false");
                    setExpanderVisibility(expander, false);
                } else {
                    closeAnyOpenResearch(article);
                    article.dataset.open = "true";
                    btn.setAttribute("aria-expanded", "true");
                    setExpanderVisibility(expander, true);
                    setExpanderMaxHeight(article);
                    setTimeout(() => $(".rc-close", expander)?.focus({ preventScroll: true }), 10);
                }
                return;
            }
            // click outside closes
            const openArticle = $(".research-card[data-open='true']");
            if (openArticle) {
                const exp = $(".rc-expander", openArticle);
                if (exp && !exp.contains(e.target)) closeAnyOpenResearch();
            }
        },
        { passive: false }
    );

    document.addEventListener(
        "click",
        (e) => {
            const closeBtn = e.target.closest?.(".research-card .rc-close");
            if (!closeBtn) return;
            e.preventDefault();
            const article = closeBtn.closest(".research-card");
            const expander = $(".rc-expander", article);
            article.dataset.open = "false";
            $(".rc-toggle", article)?.setAttribute("aria-expanded", "false");
            setExpanderVisibility(expander, false);
            $(".rc-toggle", article)?.focus?.({ preventScroll: true });
        },
        { passive: false }
    );

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeAnyOpenResearch();
    });
}

/* ========= CORE VALUES (mobile-only popovers) ========= */
function setupCoreValues() {
    const items = $$(".cv-reveal");
    if (!items.length) return;
    const isLgUp = () => isDesktop();
    const enforceSingleOpen = () => {
        if (isLgUp()) return;
        const opened = items.filter((d) => d.open);
        if (opened.length > 1) opened.slice(0, -1).forEach((d) => (d.open = false));
    };
    items.forEach((d) => {
        const summary = $(".cv-info-btn", d);
        if (!summary) return;
        const syncAria = () => summary.setAttribute("aria-expanded", d.open ? "true" : "false");
        d.addEventListener("toggle", () => {
            if (isLgUp()) d.open = false;
            else enforceSingleOpen();
            syncAria();
        });
        summary.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                d.open = false;
                syncAria();
                summary.blur();
            }
        });
        syncAria();
    });
    document.addEventListener(
        "click",
        (e) => {
            if (isDesktop()) return;
            const anyOpen = items.find((d) => d.open);
            if (anyOpen && !anyOpen.contains(e.target)) anyOpen.open = false;
        },
        { passive: true }
    );
}

/* ========= SKILLS PROGRESS ========= */
const skills = { section: null, bars: [], inited: false, animated: false, io: null };

function initSkillsOnce() {
    if (skills.inited || prefersReducedMotion()) return;
    skills.section = document.getElementById("skills");
    if (!skills.section) return;
    const containers = $$(".progress[role='progressbar']", skills.section);
    if (!containers.length) return;
    skills.bars = containers.map((p) => {
        const bar = $(".progress-bar", p);
        const cssVal = getComputedStyle(p).getPropertyValue("--val").trim();
        const targetWidth =
            cssVal ||
            (p.getAttribute("aria-valuenow")
                ? `${clamp(+p.getAttribute("aria-valuenow") || 0, 0, 100)}%`
                : "0%");
        bar.style.width = "0%";
        bar.style.transition = "none";
        const value = parseFloat(targetWidth) || 0;
        p.setAttribute("aria-valuenow", "0");
        return { bar, parent: p, target: targetWidth, value: clamp(value, 0, 100) };
    });
    skills.inited = true;
}

function animateSkillsProgress() {
    if (!skills.inited || skills.animated || !visualsReady) return;
    skills.animated = true;
    const dur = prefersReducedMotion() ? 1 : 900;

    skills.bars.forEach(({ bar, parent, target, value }) => {
        bar.style.transition = `width ${dur}ms cubic-bezier(.22,1,.36,1)`;
        requestAnimationFrame(() => {
            bar.style.width = target;
        });

        const start = performance.now();
        const step = (ts) => {
            const t = Math.min(1, (ts - start) / dur);
            const eased = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
            parent.setAttribute("aria-valuenow", String(Math.round(value * eased)));
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}

function isElemInViewport(el, thr = 0.28) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const visible = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
    const ratio = visible / Math.max(rect.height, 1);
    return ratio >= thr;
}

function maybeTriggerSkillsProgress() {
    initSkillsOnce();
    if (!skills.inited || skills.animated || !visualsReady) return;
    const activeDesktop =
        isDesktop() && (getActiveSectionEl()?.id === "skills" || currentId === "skills");
    if (isElemInViewport(skills.section, 0.22) || activeDesktop) animateSkillsProgress();
}

function setupSkillsObserver() {
    initSkillsOnce();
    if (!skills.inited || skills.animated) return;
    if ("IntersectionObserver" in window) {
        skills.io?.disconnect?.();
        skills.io = new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    if (e.isIntersecting && e.intersectionRatio > 0.22) {
                        if (visualsReady) {
                            animateSkillsProgress();
                            skills.io?.disconnect?.();
                        }
                    }
                });
            },
            { threshold: [0.15, 0.22, 0.5] }
        );
        skills.io.observe(skills.section);
    } else {
        setTimeout(maybeTriggerSkillsProgress, 400);
    }
}

/* ========= CONTACT FORM ========= */
const EMAILJS_CFG = {
    PUBLIC_KEY: "G5fgtKtfm0tx0NWHU",
    SERVICE_ID: "service_w4wxv6x",
    TEMPLATE_ID: "template_i56317p",
};

function initEmailJS() {
    try {
        if (window.emailjs?.init) {
            emailjs.init({ publicKey: EMAILJS_CFG.PUBLIC_KEY });
        }
    } catch {
        /* ignore */
    }
}

function setupContactForm() {
    const form = $("#contactForm");
    const submitBtn = $("#contactSubmit");
    if (!form || !submitBtn) return;

    let originalIconEl = null,
        spinnerEl = null;
    const labelEl = submitBtn.querySelector("span");
    const originalLabel = labelEl?.textContent || "Send Message";

    const busy = (on) => {
        submitBtn.disabled = on;
        submitBtn.setAttribute("aria-busy", on ? "true" : "false");
        if (!originalIconEl) originalIconEl = submitBtn.querySelector("i");
        if (on) {
            if (!spinnerEl) {
                spinnerEl = document.createElement("span");
                spinnerEl.className = "spinner-border spinner-border-sm";
                spinnerEl.setAttribute("role", "status");
                spinnerEl.setAttribute("aria-hidden", "true");
            }
            if (originalIconEl && originalIconEl.isConnected) {
                originalIconEl.replaceWith(spinnerEl);
            } else if (!submitBtn.querySelector(".spinner-border")) {
                submitBtn.prepend(spinnerEl);
            }
            if (labelEl) labelEl.textContent = "Sending...";
        } else {
            if (spinnerEl && spinnerEl.isConnected && originalIconEl) {
                spinnerEl.replaceWith(originalIconEl);
            } else if (spinnerEl && spinnerEl.parentNode) {
                spinnerEl.parentNode.removeChild(spinnerEl);
            }
            if (labelEl) labelEl.textContent = originalLabel;
        }
    };

    const serialize = (formEl) => {
        const fd = new FormData(formEl);
        const obj = {};
        fd.forEach((v, k) => (obj[k] = String(v).trim()));
        return obj;
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
            if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
            if (t.checkValidity()) t.classList.remove("is-invalid");
        },
        { passive: true }
    );

    const tryEndpoint = async (payload) => {
        try {
            initEmailJS();
            if (!window.emailjs?.send) throw new Error("EmailJS not available");
            const params = {
                from_name: payload.name,
                from_email: payload.email,
                message: payload.message,
                sentAt: payload.sentAt,
            };
            const res = await emailjs.send(EMAILJS_CFG.SERVICE_ID, EMAILJS_CFG.TEMPLATE_ID, params);
            return { ok: true, emailjsStatus: res?.status || 200 };
        } catch (err) {
            return { ok: false, reason: "emailjs-error", error: err };
        }
    };

    const fallbackMailto = (payload) => {
        const to = form.dataset.mailto?.trim() || "rahat3286@gmail.com";
        const subject = encodeURIComponent(`Portfolio message from ${payload.name}`);
        const body = encodeURIComponent(`${payload.message}\n\n— ${payload.name} <${payload.email}>`);
        // Opening mailto works best on user gesture; this runs in submit handler.
        location.href = `mailto:${to}?subject=${subject}&body=${body}`;
        return { ok: true, fallback: "mailto" };
    };

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        // Honeypot
        const hp = form.querySelector(".hp-field");
        if (hp && hp.value) {
            showToast({
                type: "success",
                title: "Message received",
                message: "Thanks! (bot trap passed)",
            });
            form.reset();
            form.classList.remove("was-validated");
            $$(".is-invalid", form).forEach((el) => el.classList.remove("is-invalid"));
            return;
        }

        form.classList.add("was-validated");
        if (!form.checkValidity()) {
            const invalid = form.querySelector(":invalid");
            invalid?.classList.add("is-invalid");
            invalid?.focus({ preventScroll: true });
            return;
        }

        const data = serialize(form);
        if (!isEmail(data.email)) {
            showToast({
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

        let result = await tryEndpoint(payload);
        if (!result.ok) result = fallbackMailto(payload);

        busy(false);

        if (result.ok) {
            showToast({
                type: "success",
                title: "Sent",
                message: result.fallback === "mailto"
                    ? "Opening your mail client… If it doesn't open, please email me directly."
                    : "Your message was sent successfully. I’ll get back to you soon.",
            });
            form.reset();
            form.classList.remove("was-validated");
            $$(".is-invalid", form).forEach((el) => el.classList.remove("is-invalid"));
        } else {
            showToast({
                type: "danger",
                title: "Couldn’t send",
                message: "Please try again in a moment or email me directly at rahat3286@gmail.com.",
            });
        }
    });
}

/* ========= PHONE ICON COPY FEEDBACK ========= */
function setupTelToasts() {
    document.addEventListener(
        "click",
        async (e) => {
            const telLink = e.target.closest?.('a[href^="tel:"]');
            if (!telLink) return;
            const num = (telLink.getAttribute("href") || "").replace("tel:", "").trim();
            if (!num) return;
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(num);
                    showToast({
                        type: "info",
                        title: "Number copied",
                        message: "Phone number copied to clipboard. Opening dialer…",
                    });
                }
            } catch {
                /* ignore copy errors */
            }
        },
        { passive: false }
    );
}

/* ========= TYPEWRITER ========= */
let typewriterState = { started: false, paused: false, tid: 0 };
function startTypewriter(el, phrases) {
    if (!el || !phrases?.length) return;
    // Make it accessible: announce changes politely
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");

    if (prefersReducedMotion()) {
        el.textContent = phrases[0];
        return;
    }
    const TYPE_MS = 46,
        DEL_MS = 30,
        HOLD_MS = 1000;
    let pi = 0,
        ci = 0,
        typing = true;

    function step() {
        if (typewriterState.paused) return;
        const p = phrases[pi];
        if (typing) {
            if (ci < p.length) {
                ci++;
                el.textContent = p.slice(0, ci);
                typewriterState.tid = setTimeout(step, TYPE_MS);
            } else {
                typing = false;
                typewriterState.tid = setTimeout(step, HOLD_MS);
            }
        } else {
            if (ci > 0) {
                ci--;
                el.textContent = p.slice(0, ci);
                typewriterState.tid = setTimeout(step, DEL_MS);
            } else {
                typing = true;
                pi = (pi + 1) % phrases.length;
                typewriterState.tid = setTimeout(step, 260);
            }
        }
    }
    typewriterState.started = true;
    typewriterState.paused = false;
    step();

    document.addEventListener("visibilitychange", () => {
        if (!typewriterState.started) return;
        clearTimeout(typewriterState.tid);
        if (document.visibilityState === "hidden") {
            typewriterState.paused = true;
        } else if (typewriterState.paused) {
            typewriterState.paused = false;
            typewriterState.tid = setTimeout(step, 140);
        }
    });
}
function maybeStartTypewriter() {
    if (typewriterState.started || !visualsReady || !typewriterEl) return;
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

/* ========= HERO FALLBACK IMG ========= */
function installHeroFallbacks() {
    if (!heroImg) return;
    const tried = new Set();
    const candidates = [];
    const currentSrc = heroImg.getAttribute("src");
    if (currentSrc) candidates.push(currentSrc);
    ["hero-image.png", "hero-figure.png"].forEach((p) => {
        if (p && p !== currentSrc) candidates.push(p);
    });
    const tryNext = () => {
        const next = candidates.find((c) => !tried.has(c));
        if (!next) return;
        tried.add(next);
        heroImg.src = next;
    };
    heroImg.addEventListener("error", tryNext);
    if (!currentSrc) tryNext();
}

/* ========= BRAND TOP ========= */
let brandTopInitial = brandTop ? brandTop.innerHTML : "";
function syncBrandTop() {
    if (!brandTop) return;
    if (isDesktop()) brandTop.innerHTML = brandTopInitial || "Rahat";
    else brandTop.textContent = "Rahat";
}

/* ========= CONTACT TEXT AUTO-FIT ========= */
let fitRO = null,
    fitRAF = 0;
function wrapForFit(scopeEl) {
    if (!scopeEl) return null;
    scopeEl.setAttribute("data-fit-scope", "");
    let inner = scopeEl.querySelector("[data-fit]");
    if (inner) return inner;
    inner = document.createElement("span");
    inner.setAttribute("data-fit", "");
    while (scopeEl.firstChild) inner.appendChild(scopeEl.firstChild);
    scopeEl.appendChild(inner);
    return inner;
}
function measureFit(scopeEl) {
    const inner = wrapForFit(scopeEl);
    if (!inner) return;
    inner.style.setProperty("--fit", "1");
    const available =
        Math.max(1, scopeEl.clientWidth || scopeEl.getBoundingClientRect().width || 1);
    const natural = Math.max(inner.scrollWidth, inner.getBoundingClientRect().width || 1);
    const scale = natural <= 1 ? 1 : clamp(available / natural, 0.6, 1.05);
    inner.style.setProperty("--fit", String(scale));
}
function fitContactText() {
    cancelAnimationFrame(fitRAF);
    fitRAF = requestAnimationFrame(() => {
        $$(".ci-content .ci-label, .ci-content .ci-value").forEach((el) => measureFit(el));
    });
}
function initContactAutoFit() {
    fitContactText();
    try {
        if (!fitRO && "ResizeObserver" in window) {
            fitRO = new ResizeObserver(() => fitContactText());
            $$(".ci-item").forEach((item) => fitRO.observe(item));
        }
    } catch {
        /* ignore */
    }
    window.addEventListener("resize", fitContactText, { passive: true });
    window.addEventListener("orientationchange", fitContactText, { passive: true });
    if (document.fonts?.ready) document.fonts.ready.then(() => fitContactText());
    else setTimeout(fitContactText, 300);
}

/* ========= SCROLL PERSISTENCE ========= */
function readSavedScroll() {
    try {
        const raw = sessionStorage.getItem(SCROLL_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}
let saveScrollQueued = false;
function saveScrollState() {
    if (saveScrollQueued) return;
    saveScrollQueued = true;
    cancelAnimationFrame(saveScrollRAF);
    saveScrollRAF = requestAnimationFrame(() => {
        saveScrollQueued = false;
        const state = {
            ts: Date.now(),
            mode: isDesktop() ? "desktop" : "mobile",
            id: currentId || sections[0]?.id || "home",
            scrollTop: 0,
            version: 7,
        };
        if (isDesktop()) {
            const active = getActiveSectionEl();
            state.scrollTop = active?.scrollTop || 0;
        } else {
            state.scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
            let best = { id: state.id, top: Infinity };
            sections.forEach((sec) => {
                const t = Math.abs(sec.getBoundingClientRect().top);
                if (t < best.top) best = { id: sec.id, top: t };
            });
            state.id = best.id || state.id;
        }
        try {
            sessionStorage.setItem(SCROLL_KEY, JSON.stringify(state));
        } catch {
            /* ignore */
        }
    });
}
function restoreSavedScrollIfAny() {
    const saved = readSavedScroll();
    if (!saved) return;
    const targetId =
        (saved.id && document.getElementById(saved.id)) ? saved.id : (currentId || sections[0]?.id);
    showSection(targetId, true, { preserveScroll: true });
    if (isDesktop()) {
        const active = getActiveSectionEl();
        if (active) active.scrollTop = Math.max(0, Number(saved.scrollTop) || 0);
    } else {
        window.scrollTo({
            top: Math.max(0, Number(saved.scrollTop) || 0),
            behavior: "auto",
        });
    }
}

/* ========= BACK TO TOP ========= */
(function backToTop() {
    if (!backToTopBtn) return;
    const SHOW_AFTER_PX = 250;
    const MAX_WIDTH_TO_SHOW = 992;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    function computeProgress() {
        const doc = document.documentElement;
        const scrollTop = window.scrollY || doc.scrollTop || 0;
        const maxScroll = Math.max(1, doc.scrollHeight - doc.clientHeight);
        const pct = Math.min(100, Math.max(0, (scrollTop / maxScroll) * 100));
        return { scrollTop, pct };
    }
    let ticking = false;
    function update() {
        const { scrollTop, pct } = computeProgress();
        const shouldShow = window.innerWidth < MAX_WIDTH_TO_SHOW && scrollTop > SHOW_AFTER_PX;
        backToTopBtn.classList.toggle("show", shouldShow);
        backToTopBtn.style.setProperty("--p", pct.toFixed(2) + "%");
    }
    function queueUpdate() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            update();
            ticking = false;
        });
    }

    backToTopBtn.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: prefersReduced.matches ? "auto" : "smooth" });
    });

    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate, { passive: true });
    window.addEventListener("load", update, { once: true });
})();

/* ========= EVENTS (NAV + MENU + HASH) ========= */
// Desktop sidebar nav
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

// Mobile slider nav
sliderItemsWrap?.addEventListener(
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
sliderItems.forEach((item) => {
    item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const id = getTargetFrom(item);
            if (id) {
                showSection(id, true);
                if (!isDesktop() && rightSlider?.dataset.open === "true") setMenuOpen(false);
            }
        }
    });
});

// Hamburger toggle
hamburger?.addEventListener("click", (e) => {
    e.stopPropagation();
    lastFocusBeforeMenu = document.activeElement;
    setMenuOpen(!(rightSlider?.dataset.open === "true"));
});

// Click outside to close mobile menu
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

// Escape to close mobile menu
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && rightSlider?.dataset.open === "true") setMenuOpen(false);
});

// Skip-link safeguard: allow default when target is #main-content; intercept only if it points to a section in slide-mode
if (skipLink) {
    skipLink.addEventListener("click", (e) => {
        const rawHref = skipLink.getAttribute("href") || "";
        const id = rawHref.startsWith("#") ? rawHref.slice(1) : "";
        if (!id) return; // default
        if (id === "main-content") {
            // native skip to main — let browser handle, then focus main
            requestAnimationFrame(() => mainContent?.focus?.({ preventScroll: true }));
            return;
        }
        // If it points to a section and we're in desktop slide-mode, handle via router
        if (isDesktop() && document.getElementById(id)?.classList.contains("section")) {
            e.preventDefault();
            showSection(id, true);
        }
    });
}

// Hash navigation
window.addEventListener("hashchange", () => {
    const id = location.hash?.slice(1);
    if (id && document.getElementById(id)) showSection(id, false);
});

// Any element with [data-scroll-to]
document.addEventListener(
    "click",
    (e) => {
        const go = e.target.closest?.("[data-scroll-to]");
        if (!go) return;
        const id = go.getAttribute("data-scroll-to");
        if (!id) return;
        e.preventDefault();
        showSection(id, true);
    },
    { passive: false }
);

/* ========= RESIZE ========= */
let resizeRAF = 0;
function onResize() {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => {
        const nowDesktop = isDesktop();
        if (nowDesktop !== wasDesktop) {
            const saved = readSavedScroll();
            initMode({
                initialId: saved?.id || currentId || sections[0]?.id || "home",
                preserveScroll: true,
            });
            restoreSavedScrollIfAny();
        } else {
            applyDynamicHeadingClearance();
        }
        maybeTriggerSkillsProgress();
        adjustOpenResearchExpander();
        wasDesktop = nowDesktop;
        syncBrandTop();
        fitContactText();
    });
}
window.addEventListener("resize", onResize, { passive: true });

/* ========= INIT ========= */
window.addEventListener("DOMContentLoaded", () => {
    playTo(0.35, 600);
    initEmailJS();

    // Small delay to avoid skeleton flash on very fast loads
    skeletonTimer = setTimeout(showSkeleton, 160);

    const saved = readSavedScroll();
    initMode({ initialId: saved?.id, preserveScroll: true });

    try {
        const shouldOpen = sessionStorage.getItem(MENU_STORAGE_KEY) === "1";
        if (shouldOpen && !isDesktop()) setMenuOpen(true, { animate: false, focus: false, persist: false });
    } catch {
        /* ignore */
    }

    setupResearchCards();
    setupCoreValues();
    setupSkillsObserver();
    setupContactForm();
    setupTelToasts();
    installHeroFallbacks();
    initContactAutoFit();

    if (isDesktop()) {
        sections.forEach((sec) => sec.addEventListener("scroll", saveScrollState, { passive: true }));
    } else {
        window.addEventListener("scroll", saveScrollState, { passive: true });
    }

    // SAFETY: if something delays 'load', ensure .ui-ready eventually applies
    setTimeout(() => {
        if (!document.documentElement.classList.contains("ui-ready")) {
            markUiReady();
            applyDynamicHeadingClearance();
            maybeStartTypewriter();
            initSkillsOnce();
            maybeTriggerSkillsProgress();
        }
    }, 3500);
});

window.addEventListener("load", () => {
    clearTimeout(skeletonTimer);
    if (!skeletonVisible) {
        indicatorEl?.classList.remove("waiting");
        playTo(1, 600);
        setTimeout(
            () => indicatorEl?.classList.remove("visible"),
            prefersReducedMotion() ? 0 : 600
        );
        markUiReady(); // guarantees animations end-state sticks
        applyDynamicHeadingClearance();
        restoreSavedScrollIfAny();
        maybeStartTypewriter();
        initSkillsOnce();
        maybeTriggerSkillsProgress();
    } else {
        hideSkeleton();
    }
    setTimeout(maybeTriggerSkillsProgress, 200);
    setTimeout(fitContactText, 120);
});

window.addEventListener("beforeunload", saveScrollState);
window.addEventListener("pagehide", saveScrollState);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveScrollState();
});
