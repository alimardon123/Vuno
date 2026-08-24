# The codebase as a knowledge graph

Built with [`graphify`](https://github.com/safishamsi/graphify). **1,813 nodes,
3,806 edges, 126 communities**, over 234 source files and 19 documents.

| | |
|---|---|
| [`index.html`](index.html) | The interactive graph. Open it in a browser — no server needed. |
| [`GRAPH_REPORT.md`](GRAPH_REPORT.md) | The audit report: communities, cohesion scores, god nodes, surprising connections. |
| `graph.json` | The raw graph, GraphRAG-ready. |

Every edge is tagged **EXTRACTED** (explicit in the source — an import, a call, a
citation), **INFERRED** (a reasonable inference), or **AMBIGUOUS** (uncertain, not
hidden). That tagging is the point: you can tell what was found from what was
guessed.

---

## What it found

**The core abstractions, by connection count.** These are the things you cannot
change without touching everything:

```
cn()                294 edges   the Tailwind class merger
db                   95 edges   the Prisma client
viewerFromRequest()  40 edges   ← every API route's auth gate
getConversation()    23 edges
EventSpine           23 edges   ← the one writer
MemberSummary        20 edges   ← the one identity
canRead()            19 edges   ← conversation-level access
```

`EventSpine`, `MemberSummary`, `canRead()` and `viewerFromRequest()` being this
central is the architecture showing up in the topology: the single writer, the
single identity and the two access gates really are load-bearing, not just
described that way in a document.

**The dead scaffold shows up as its own island.** Four of the largest
communities — 0, 1, 4 and 13, about 170 nodes between them — are entirely
`src/components/ui/*`, with cohesion scores of 0.05–0.11 (the lowest in the
graph). They connect to the rest of the codebase through exactly one node:
`cn()`. That is the shadcn/ui template scaffold, of which only `toaster.tsx` is
reachable from the app. See [STACK.md](../STACK.md#the-dead-scaffold).

The clustering found this without being told to look for it, which is the best
argument for keeping the graph around.

**Documentation and code cluster together where they should.** The visibility
rule, the connector permission model and the epistemic ledger each pull their
ADR, their prose documentation and their implementation into the same community
— meaning the docs describe the code that exists rather than a code that was
planned.

---

## Rebuilding it

```bash
/graphify                                    # in Claude Code, from the repo root
cp graphify-out/graph.html   docs/graph/index.html
cp graphify-out/GRAPH_REPORT.md docs/graph/
cp graphify-out/graph.json   docs/graph/
```

`graphify-out/` is git-ignored — it is the scratch space and the extraction
cache. Only the three published files above are committed.

Once built, the graph is queryable:

```bash
/graphify query "how does a message get from the composer to the database"
/graphify path "EventSpine" "visibleTo"
/graphify explain "MemberSummary"
```

## Known gaps in this build

- **The 14 SQL migrations contributed nothing.** `tree_sitter_sql` is not
  installed, so the raw-SQL migrations — including the FTS5 index and its
  triggers — are absent from the graph. `pip install 'graphifyy[sql]'` fixes it.
- **The 29 screenshots in `docs/images/` were deliberately excluded.** Vision
  extraction over pictures of the app already described in
  [FEATURES.md](../FEATURES.md) would cost a lot and add little.
- **Semantic extraction covered the 19 documents, not the 234 source files.**
  Code went through AST extraction, which is deterministic and free but only
  finds structural edges — imports, calls, definitions. Semantic edges *between*
  code files (shared assumptions, latent coupling) are not in this build.
