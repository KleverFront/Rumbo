-- v1 schema. Profile is stored as typed fields (not free text) so the v2
-- browser extension can map them onto application forms.

CREATE TABLE profile (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    full_name          TEXT,
    email              TEXT,
    phone              TEXT,
    city               TEXT,
    country            TEXT,
    headline           TEXT,
    summary            TEXT,
    target_role        TEXT,
    salary_expectation TEXT,
    availability       TEXT,
    linkedin_url       TEXT,
    portfolio_url      TEXT,
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO profile (id) VALUES (1);

CREATE TABLE profile_experience (
    id          INTEGER PRIMARY KEY,
    company     TEXT NOT NULL,
    role        TEXT NOT NULL,
    start_date  TEXT,
    end_date    TEXT,
    description TEXT,
    sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE profile_education (
    id          INTEGER PRIMARY KEY,
    institution TEXT NOT NULL,
    degree      TEXT NOT NULL,
    start_date  TEXT,
    end_date    TEXT,
    sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE profile_skills (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    level TEXT
);

CREATE TABLE profile_languages (
    id       INTEGER PRIMARY KEY,
    language TEXT NOT NULL UNIQUE,
    level    TEXT
);

-- Imported CV files; structured_json is the AI-parsed version of raw_text.
CREATE TABLE cvs (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    source_file     TEXT,
    raw_text        TEXT,
    structured_json TEXT,
    is_base         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jobs (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL,
    external_id TEXT NOT NULL,
    url         TEXT,
    title       TEXT NOT NULL,
    company     TEXT,
    location    TEXT,
    remote      INTEGER NOT NULL DEFAULT 0,
    salary_text TEXT,
    description TEXT,
    -- company+title+city, normalized: groups the same offer across portals
    dedupe_key  TEXT,
    posted_at   TEXT,
    fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source, external_id)
);
CREATE INDEX jobs_dedupe_key ON jobs (dedupe_key);

CREATE TABLE applications (
    id            INTEGER PRIMARY KEY,
    job_id        INTEGER NOT NULL UNIQUE REFERENCES jobs (id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'saved'
                  CHECK (status IN ('saved', 'applied', 'interview', 'offer', 'discarded')),
    match_score   INTEGER,
    ats_score     INTEGER,
    cv_json       TEXT,
    cv_pdf_path   TEXT,
    cover_letter  TEXT,
    applied_at    TEXT,
    follow_up_at  TEXT,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX applications_status ON applications (status);

-- Answer bank for open questions in application forms (UI comes in v2).
CREATE TABLE answers (
    id         INTEGER PRIMARY KEY,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    job_id     INTEGER REFERENCES jobs (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ai_usage (
    id            INTEGER PRIMARY KEY,
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    task          TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Non-secret settings only; API keys live in the macOS Keychain.
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
