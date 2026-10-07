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
