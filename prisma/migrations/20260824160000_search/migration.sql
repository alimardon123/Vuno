-- Search — a full-text index over what people said.
--
-- Fifty thousand messages with no way to find one is a filing cabinet with the
-- drawers welded shut. `LIKE '%term%'` is not the answer at this size: it is a
-- full scan of every payload, it cannot rank, and it matches inside words.
--
-- SQLite ships FTS5 and the Prisma engine has it (3.46.0, verified before this
-- was written), so the index is a virtual table rather than a dependency.
--
-- Three decisions worth stating, because each one has a wrong version that
-- looks fine until it does not:
--
--   **The rowid is `Event.seq`.** Nothing else is stored — no copy of the org,
--   the author or the conversation, beyond the one column FTS5 needs to filter
--   a tenant out of somebody else's ranking. A hit is a seq, and a seq is the
--   primary key of the row that has the truth. So the index cannot disagree
--   with the spine about who wrote what; the worst it can do is name a row.
--
--   **Triggers, not application code.** Four processes write to this database —
--   the app, the orchestrator, the seed and the migration runner — and an
--   index maintained in one of them is an index that drifts in the other three.
--   In SQL it cannot be forgotten.
--
--   **A deleted message stops being findable.** `MessageRedacted` removes the
--   row. Search is the one surface where "the body stops being served" has to
--   mean the text is gone, because a search result *is* the body: a snippet of
--   a message somebody deleted, served to anyone who guesses a word in it, is
--   the deletion not having happened.
--
-- Note for whoever runs `prisma migrate dev` next: schema.prisma cannot express
-- a virtual table, so Prisma sees these as tables it did not create. `migrate
-- deploy` — what `bun run setup` uses — does not care. If `migrate dev` offers
-- to drop them, that is the gap, and the answer is `--create-only`.

-- unicode61 folds case and strips diacritics, so "Ana" finds "Aná" and
-- "CRASH" finds "crash". `remove_diacritics 2` is the version that handles
-- multi-codepoint sequences rather than only Latin-1.
CREATE VIRTUAL TABLE "EventSearch" USING fts5(
  body,
  orgId UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- ─── Keeping it true ────────────────────────────────────────────────────────

-- A message is said.
CREATE TRIGGER "EventSearch_posted" AFTER INSERT ON "Event"
WHEN new.type IN ('MessagePosted', 'ThreadReplyPosted')
 AND json_extract(new.payload, '$.body') IS NOT NULL
 AND json_extract(new.payload, '$.body') <> ''
BEGIN
  INSERT INTO "EventSearch"(rowid, body, orgId)
  VALUES (new.seq, json_extract(new.payload, '$.body'), new.orgId);
END;

-- A message is edited. The original stays on the spine; the index holds what it
-- says now, because that is what a reader is looking for.
CREATE TRIGGER "EventSearch_edited" AFTER INSERT ON "Event"
WHEN new.type = 'MessageEdited'
BEGIN
  UPDATE "EventSearch"
     SET body = json_extract(new.payload, '$.body')
   WHERE rowid = (SELECT seq FROM "Event" WHERE id = new."targetEventId");
END;

-- A message is deleted.
CREATE TRIGGER "EventSearch_redacted" AFTER INSERT ON "Event"
WHEN new.type = 'MessageRedacted'
BEGIN
  DELETE FROM "EventSearch"
   WHERE rowid = (SELECT seq FROM "Event" WHERE id = new."targetEventId");
END;

-- The spine is append-only, so nothing in the app reaches this. An org being
-- deleted does, and so does a test tearing down after itself — and an index
-- holding seqs that no longer exist would serve results that resolve to
-- nothing.
CREATE TRIGGER "EventSearch_gone" AFTER DELETE ON "Event"
BEGIN
  DELETE FROM "EventSearch" WHERE rowid = old.seq;
END;

-- ─── What is already here ───────────────────────────────────────────────────

INSERT INTO "EventSearch"(rowid, body, orgId)
SELECT seq, json_extract(payload, '$.body'), "orgId"
  FROM "Event"
 WHERE type IN ('MessagePosted', 'ThreadReplyPosted')
   AND json_extract(payload, '$.body') IS NOT NULL
   AND json_extract(payload, '$.body') <> '';

-- Then the same two corrections the triggers make, for the history that
-- predates them: the newest edit is the current text, and a deleted message is
-- not in the index at all.
UPDATE "EventSearch"
   SET body = (
     SELECT json_extract(e.payload, '$.body')
       FROM "Event" e
       JOIN "Event" t ON t.id = e."targetEventId"
      WHERE e.type = 'MessageEdited' AND t.seq = "EventSearch".rowid
      ORDER BY e.seq DESC
      LIMIT 1
   )
 WHERE rowid IN (
   SELECT t.seq FROM "Event" e JOIN "Event" t ON t.id = e."targetEventId"
    WHERE e.type = 'MessageEdited'
 );

DELETE FROM "EventSearch"
 WHERE rowid IN (
   SELECT t.seq FROM "Event" e JOIN "Event" t ON t.id = e."targetEventId"
    WHERE e.type = 'MessageRedacted'
 );
