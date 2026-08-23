-- TASK-963: dismissed fired alerts are archived, not destroyed.
-- dismissed_at marks a fired alert (active=0, fired_at set) as seen/dismissed
-- by the consumer; the row is retained so the alert journal (and the future
-- TASK-845 export) keeps full history.
ALTER TABLE alerts ADD COLUMN dismissed_at INTEGER;
