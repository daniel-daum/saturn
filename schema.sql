-- likes: one row per post
CREATE TABLE IF NOT EXISTS Likes (
    page TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
);

-- who liked what today: a daily-rotating hash, never an ip or email
CREATE TABLE IF NOT EXISTS LikeVoters (
    page TEXT NOT NULL,
    voter TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (page, voter)
);

-- comments: arrive by email. ones with links are hidden until approved.
-- nothing about the sender is kept, not even a hash of their address
CREATE TABLE IF NOT EXISTS Comments (
    id TEXT PRIMARY KEY,
    page TEXT NOT NULL,
    parent TEXT,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    is_author INTEGER NOT NULL DEFAULT 0,
    approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_page ON Comments (page, approved, created_at);
