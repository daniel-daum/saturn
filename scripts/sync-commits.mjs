// pulls recent commits from my gitea and writes them into the static html.
// run with `mise run sync-commits`. no dependencies, node 18+.
//
// a page opts in with a pair of marker comments naming the repo and how many
// commits to show; everything between them is replaced on every run:
//
//     <!-- commits:holonet:6 -->...<!-- /commits:holonet:6 -->
//
// commits come from the repo's default branch, newest first. if gitea can't
// be reached, the script exits non-zero and touches nothing.

import { readFile, writeFile } from "node:fs/promises";

const GITEA = "https://git.danieldaum.net";
const OWNER = "daniel-daum";
const TZ = "America/Los_Angeles";

const PAGES = ["projects/index.html", "projects/holonet/index.html"];

const MARKER = /^([ \t]*)<!-- commits:([\w.-]+):(\d+) -->[\s\S]*?<!-- \/commits:\2:\3 -->/gm;

// ---------------------------------------------------------------------------
// data

async function fetchCommits(repo, limit) {
    const url = new URL(`/api/v1/repos/${OWNER}/${repo}/commits`, GITEA);
    url.searchParams.set("limit", String(limit));
    // skip diff stats, signature checks and file lists, none of it is shown
    url.searchParams.set("stat", "false");
    url.searchParams.set("verification", "false");
    url.searchParams.set("files", "false");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${repo} commits: ${res.status} ${res.statusText}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// html

function render(commits) {
    if (commits.length === 0) return `<p class="commit-log-row">no commits yet</p>`;
    const rows = commits.map((c) =>
        [
            `    <li class="commit-log-row">`,
            `        <span class="commit-log-hash">${c.sha.slice(0, 7)}</span>`,
            `        <span class="commit-log-msg">${esc(c.commit.message.split("\n")[0])}</span>`,
            `        <time class="commit-log-date" datetime="${esc(c.commit.author.date)}">${formatDate(c.commit.author.date)}</time>`,
            `    </li>`,
        ].join("\n"),
    );
    return [`<ol class="commit-log-list">`, ...rows, `</ol>`].join("\n");
}

// 09 Sep 26, like the writing list. en-US, because en-GB says "Sept"
function formatDate(iso) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "2-digit", month: "short", year: "2-digit" }).formatToParts(new Date(iso));
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get("day")} ${get("month")} ${get("year")}`;
}

function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// writing

const pages = await Promise.all(PAGES.map((page) => readFile(page, "utf8")));

// one request per repo, for the most commits any marker asks for
const wanted = new Map();
for (const html of pages) {
    for (const [, , repo, n] of html.matchAll(MARKER)) {
        wanted.set(repo, Math.max(wanted.get(repo) ?? 0, Number(n)));
    }
}
const commits = new Map();
for (const [repo, n] of wanted) commits.set(repo, await fetchCommits(repo, n));

for (const [i, page] of PAGES.entries()) {
    const before = pages[i];
    const after = before.replace(MARKER, (_, indent, repo, n) => {
        const body = render(commits.get(repo).slice(0, Number(n))).replace(/^(?=.)/gm, indent);
        return `${indent}<!-- commits:${repo}:${n} -->\n${body}\n${indent}<!-- /commits:${repo}:${n} -->`;
    });
    if (after !== before) {
        await writeFile(page, after);
        console.log(`updated ${page}`);
    }
}
for (const [repo, list] of commits) console.log(`${repo}: ${list.length} commit${list.length === 1 ? "" : "s"}`);
