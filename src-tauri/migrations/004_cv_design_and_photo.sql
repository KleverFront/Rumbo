-- Design chosen for each tailored CV (JSON, see src/cv/design.ts) and the profile photo
-- (small JPEG data URL, resized in the app before saving).
ALTER TABLE applications ADD COLUMN cv_design TEXT;
ALTER TABLE profile ADD COLUMN photo TEXT;
