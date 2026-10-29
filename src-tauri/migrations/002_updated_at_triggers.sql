-- Keep updated_at current on every UPDATE. The WHEN guard skips rows whose
-- caller already set updated_at, which also prevents the trigger re-firing.

CREATE TRIGGER applications_touch_updated_at
AFTER UPDATE ON applications
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE applications SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER profile_touch_updated_at
AFTER UPDATE ON profile
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE profile SET updated_at = datetime('now') WHERE id = NEW.id;
END;
