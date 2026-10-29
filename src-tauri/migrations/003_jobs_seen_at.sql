-- When the user first opened an offer; lets the search hide offers already seen.
ALTER TABLE jobs ADD COLUMN seen_at TEXT;
