// one palette per visit: it holds while the tab is open, and the next visit gets the
// next one. without js the css stays moss and the theme button stays hidden.
const themes = ["moss", "ink", "wine", "plum", "teal"]; // "flexoki"

function after(theme) {
    return themes[(themes.indexOf(theme) + 1) % themes.length];
}

function use(theme) {
    document.documentElement.dataset.theme = theme;
    try {
        sessionStorage.setItem("theme", theme);
        localStorage.setItem("theme", theme);
    } catch {}
}

let current = "moss";
try {
    const visit = sessionStorage.getItem("theme");
    current = themes.includes(visit)
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
