CREATE TABLE IF NOT EXISTS Likes (
    page TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS LikeVoters (
    page TEXT NOT NULL,
    voter TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (page, voter)
);

CREATE TABLE IF NOT EXISTS Replies (
    guid TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    parent TEXT,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    sender TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_replies_url ON Replies (url, deleted_at, created_at);
CREATE INDEX IF NOT EXISTS idx_replies_sender ON Replies (sender, created_at);
