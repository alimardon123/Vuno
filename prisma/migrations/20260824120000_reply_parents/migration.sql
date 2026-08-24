-- Thread replies written before `targetEventId` existed carry their parent only
-- inside the JSON payload, where SQLite cannot index it. A channel asks for its
-- root posts with `targetEventId IS NULL`, so without this every old reply
-- would render as a post of its own.
UPDATE "Event"
SET "targetEventId" = json_extract("payload", '$.parentId')
WHERE "type" = 'ThreadReplyPosted'
  AND "targetEventId" IS NULL
  AND json_extract("payload", '$.parentId') IS NOT NULL;
