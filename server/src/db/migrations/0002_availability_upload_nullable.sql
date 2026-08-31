-- The brand and the weight are now read off the screenshot rather than picked by
-- the admin beforehand (spec §4), so at the moment an upload is recorded neither
-- is guaranteed: a cropped screenshot may not show them, and the admin resolves
-- them afterwards on the review screen. The audit row must still be written.

CREATE TABLE availability_uploads_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  brand_id INTEGER REFERENCES brands(id),
  weight_id INTEGER REFERENCES weights(id),
  image_ref TEXT NOT NULL,
  raw_ai_response TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO availability_uploads_new (id, vendor_id, brand_id, weight_id, image_ref, raw_ai_response, created_at)
SELECT id, vendor_id, brand_id, weight_id, image_ref, raw_ai_response, created_at FROM availability_uploads;

DROP TABLE availability_uploads;
ALTER TABLE availability_uploads_new RENAME TO availability_uploads;
