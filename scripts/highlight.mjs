// Build-time syntax highlighting for code blocks. No runtime JS and no inline styles, so the
// CSP holds. Colors live in global.css (--syn-* per theme), the same roles as the Zed, Helix
// and Warp themes.
//
//   mise run highlight blog/some-post/index.html   highlight every
//       <pre><code class="language-X"> block in the file(s), in place
//   node scripts/highlight.mjs go < snippet.go     print highlighted HTML for a snippet
//
// Shiki lives in scripts/node_modules (npm ci --prefix scripts); scripts/ is never deployed.
//
// Blocks that already contain hl- spans, or any other tag, are left alone, so it is safe to
// run again. "text" and "plaintext" blocks are skipped.
//
// How it works: a TextMate theme whose colors are role markers (#000001, #000002, ...).
// Shiki tokenizes with VS Code's grammars; each token's marker becomes a class.
import { createHighlighter } from "shiki";
import { readFileSync, writeFileSync } from "node:fs";

// role -> TextMate scopes (the most specific selector wins, as in any TextMate theme)
const ROLES = {
    comment: ["comment", "punctuation.definition.comment"],
    variable: [
        "variable", "variable.other", "variable.parameter", "variable.other.property",
        "variable.other.object.property", "variable.other.member", "meta.object-literal.key",
        "support.type.property-name", "entity.other.attribute-name", "entity.name.tag",
        "punctuation.definition.variable", "meta.definition.variable",
    ],
    self: ["variable.language"],
    string: ["string", "string punctuation.definition.string", "markup.raw", "markup.inline.raw"],
    escape: ["constant.character.escape", "string.regexp", "constant.other.placeholder"],
    constant: [
        "constant.numeric", "constant.language", "constant.other", "support.constant",
        "variable.other.constant", "variable.parameter.option", "entity.name.function.decorator",
        "meta.decorator", "meta.annotation",
    ],
    keyword: [
        "keyword", "storage.type", "storage.modifier", "keyword.control", "keyword.declaration",
        "punctuation.definition.template-expression", "punctuation.section.embedded",
    ],
    type: [
        "entity.name.type", "entity.name.class", "support.type", "support.class",
        "entity.other.inherited-class", "source.go storage.type", "source.go entity.name.type",
    ],
    function: [
        "entity.name.function", "support.function", "meta.function-call entity.name.function",
        "variable.function", "meta.function-call.generic",
    ],
    builtin: ["support.function.builtin", "entity.name.function.support.builtin"],
    punct: ["keyword.operator", "punctuation", "meta.brace", "punctuation.separator"],
    heading: ["markup.heading", "entity.name.section"],
    added: ["markup.inserted"],
    removed: ["markup.deleted"],
    changed: ["markup.changed"],
    link: ["markup.underline.link", "string.other.link"],
};
// word operators (and, in, typeof, new) stay keywords; shell builtins read as commands
const OVERRIDES = [
    ["keyword", ["keyword.operator.word", "keyword.operator.expression", "keyword.operator.new"]],
    ["function", ["source.shell support.function"]],
];

const names = Object.keys(ROLES);
const marker = (i) => "#0000" + (i + 1).toString(16).padStart(2, "0");
const theme = {
    name: "roles",
    type: "dark",
    colors: { "editor.foreground": "#000000", "editor.background": "#ffffff" },
    tokenColors: [
        { settings: { foreground: "#000000" } },
        ...names.map((n, i) => ({ scope: ROLES[n], settings: { foreground: marker(i) } })),
        ...OVERRIDES.map(([n, scope]) => ({ scope, settings: { foreground: marker(names.indexOf(n)) } })),
    ],
};
const roleOf = Object.fromEntries(names.map((n, i) => [marker(i).toUpperCase(), n]));

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescape = (s) =>
    s
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const PLAIN = new Set(["text", "plaintext", "txt", "plain"]);
let highlighter;
async function load(langs) {
    highlighter ??= await createHighlighter({ themes: [theme], langs: [] });
    for (const lang of langs) {
        if (!highlighter.getLoadedLanguages().includes(lang)) await highlighter.loadLanguage(lang);
    }
    return highlighter;
}

export async function highlight(code, lang) {
    const hl = await load([lang]);
    return hl
        .codeToTokensBase(code.replace(/\n$/, ""), { lang, theme: "roles" })
        .map((line) =>
            line
                .map((t) => {
                    const role = roleOf[(t.color || "").toUpperCase()];
                    return role ? `<span class="hl-${role}">${escape(t.content)}</span>` : escape(t.content);
                })
                .join(""),
        )
        .join("\n");
}

const BLOCK = /(<pre[^>]*>\s*<code\b[^>]*\bclass="[^"]*\blanguage-([\w+#-]+)[^"]*"[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/g;

export async function highlightFile(path) {
    const html = readFileSync(path, "utf8");
    const jobs = [];
    for (const m of html.matchAll(BLOCK)) {
        const [whole, open, lang, body, close] = m;
        if (PLAIN.has(lang) || /</.test(body)) continue; // plain, already highlighted, or hand-marked
        jobs.push({ whole, html: open + (await highlight(unescape(body), lang)) + close });
    }
    let out = html;
    for (const j of jobs) out = out.replace(j.whole, () => j.html);
    if (out !== html) writeFileSync(path, out);
    console.error(`${path}: ${jobs.length} block(s) highlighted`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    if (!args.length) {
        console.error("usage: node scripts/highlight.mjs <lang> < file\n       node scripts/highlight.mjs page.html [...]");
        process.exit(1);
    }
    if (args.every((a) => a.endsWith(".html"))) {
        for (const f of args) await highlightFile(f);
    } else {
        process.stdout.write((await highlight(readFileSync(0, "utf8"), args[0])) + "\n");
    }
}
