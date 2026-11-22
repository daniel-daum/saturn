// one palette per visit: it holds until the browser closes, and the next visit gets
// the next one. without js the css stays moss and the theme button stays hidden.
// a `theme` cookie on danieldaum.net carries the palette to code.danieldaum.net
// and back, so both sites show the same one. elsewhere (localhost, pages.dev)
// the cookie is host-only.
const themes = ["moss", "ink", "wine", "plum", "teal"]; // "flexoki"
const host = location.hostname;
const shared = host === "danieldaum.net" || host.endsWith(".danieldaum.net")
    ? "; domain=danieldaum.net; secure"
    : "";

function after(theme) {
    return themes[(themes.indexOf(theme) + 1) % themes.length];
}

function use(theme) {
    document.documentElement.dataset.theme = theme;
    try {
        document.cookie = `theme=${theme}; path=/; samesite=lax${shared}`;
        sessionStorage.setItem("theme", theme);
        localStorage.setItem("theme", theme);
    } catch {}
}

// the cookie first (it may come from code.danieldaum.net), then this tab's
let current = "moss";
try {
    const cookie = /(?:^|;\s*)theme=([a-z]+)/.exec(document.cookie)?.[1];
    const visit = sessionStorage.getItem("theme");
    current = themes.includes(cookie)
        ? cookie
        : themes.includes(visit)
          ? visit
          : after(localStorage.getItem("theme"));
} catch {}
use(current);

// footer button: next palette, kept for the rest of the visit
document.addEventListener("click", (event) => {
    if (!event.target.closest(".theme-button")) return;
    current = after(current);
    use(current);
});
