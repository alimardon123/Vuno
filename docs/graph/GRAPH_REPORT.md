# Graph Report - Vuno  (2026-08-24)

## Corpus Check
- 253 files · ~257,240 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1813 nodes · 3806 edges · 126 communities (107 shown, 19 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 115 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Dead UI Scaffold — Tables & Drawers
- Dead UI Scaffold — Sidebar & Sheet
- Roster: Hiring & Member Identity
- Export, Backup & Database
- Dead UI Scaffold — Popovers & Badges
- Agent Adapters (Anthropic, Ollama)
- Orchestrator: Leased Queue & Handlers
- Work: Stage Ladder, Board & Activity
- Search: FTS5 Index & Results
- Settings UI: Library, Plugins, Dialog
- Message Actions: React, Edit, Redact, Pin
- Conversation Panes & DM Creation
- Emoji Picker & Hover Actions
- Dead UI Scaffold — Alert Dialog
- Browser Smoke Suite
- Authentication & Sessions
- Event Schema & Agent Output Boundary
- Calls: Ring vs Room
- Docs: Skills, Plugins & Connectors
- Extensions: The App Catalogue
- MCP Connectors
- Posting & Mention Attribution
- Skills Library
- Visibility Rule & Conversation Window
- Attachments & Upload Sniffing
- Primitives, Avatars & Ledger View
- The Composer
- MCP Client Transport
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125

## God Nodes (most connected - your core abstractions)
1. `cn()` - 294 edges
2. `db` - 95 edges
3. `viewerFromRequest()` - 40 edges
4. `useToast()` - 27 edges
5. `getConversation()` - 23 edges
6. `EventSpine` - 23 edges
7. `MemberSummary` - 20 edges
8. `check()` - 20 edges
9. `canRead()` - 19 edges
10. `Avatar()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Holding the Connector Is the Permission (rationale)` --semantically_similar_to--> `visibleTo() — the One Visibility Rule`  [INFERRED] [semantically similar]
  docs/FEATURES.md → docs/ARCHITECTURE.md
- `App Shell Wireframe` --semantically_similar_to--> `The Seven Rail Destinations`  [INFERRED] [semantically similar]
  docs/design/SCREENS.md → docs/IA-NAVIGATION.md
- `The Epistemic Ledger as the Source of Truth` --semantically_similar_to--> `The Epistemic Ledger`  [INFERRED] [semantically similar]
  docs/WHATS_NEW.md → docs/ARCHITECTURE.md
- `The Falsification Arc as Rendered (Claim #42 believed → falsified)` --references--> `ClaimStatusChanged`  [INFERRED]
  docs/design/SCREENS.md → docs/ARCHITECTURE.md
- `AgentThought Events as Shared Cognitive Space` --conceptually_related_to--> `EventType Discriminated Union (ProposalOpened … EscalationResolved)`  [INFERRED]
  docs/adr/0001-tech-stack.md → docs/adr/0004-event-spine.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The Event Spine's Integrity Guarantees** — docs_architecture_event_spine, docs_architecture_append_only_rule, docs_architecture_single_writer, docs_architecture_seq_allocated_by_sqlite, docs_architecture_zod_boundary, docs_architecture_message_redacted [EXTRACTED 1.00]
- **The Seven Rail Destinations** — docs_ia_navigation_activity, docs_ia_navigation_chats, docs_ia_navigation_channels, docs_ia_navigation_work, docs_ia_navigation_members, docs_ia_navigation_extensions, docs_ia_navigation_ledger, docs_ia_navigation_seven_rail_tabs [EXTRACTED 1.00]
- **The Falsification Loop — claim, evidence, transition, blocked gate** — docs_architecture_epistemic_ledger, docs_architecture_claim_status_changed, docs_prd_gate_engine, docs_whats_new_killer_demo_falsification, docs_design_screens_falsification_arc, docs_features_gates [INFERRED 0.85]
- **The Append-Only Auditability Invariant** — docs_adr_0004_event_spine_append_only_event_table, docs_adr_0004_event_spine_no_update_no_delete, docs_adr_0004_event_spine_monotonic_seq, docs_adr_0008_single_writer_event_spine_single_writer_rule, docs_adr_0004_event_spine_replay_endpoint, docs_adr_0008_single_writer_event_spine_seq_autoincrement [INFERRED 0.90]
- **Member Parity Enforced Across the Schema** — docs_adr_0009_member_identity_and_delegation_member_table, docs_adr_0009_member_identity_and_delegation_parity_rule, docs_adr_0009_member_identity_and_delegation_human_profile, docs_adr_0009_member_identity_and_delegation_agent_profile, docs_adr_0009_member_identity_and_delegation_actor_member_id, docs_adr_0009_member_identity_and_delegation_work_session, docs_adr_0009_member_identity_and_delegation_hr_symmetry [EXTRACTED 1.00]
- **The Four Load-Bearing Delegation Rules** — docs_adr_0009_member_identity_and_delegation_own_name_rule, docs_adr_0009_member_identity_and_delegation_visibility_inheritance, docs_adr_0009_member_identity_and_delegation_explicit_scopes, docs_adr_0009_member_identity_and_delegation_approval_scopes_default_off, docs_adr_0009_member_identity_and_delegation_delegation_table [EXTRACTED 1.00]

## Communities (126 total, 19 thin omitted)

### Community 0 - "Dead UI Scaffold — Tables & Drawers"
Cohesion: 0.06
Nodes (44): Row(), AccordionContent(), AccordionItem(), AccordionTrigger(), Avatar(), AvatarFallback(), AvatarImage(), BreadcrumbEllipsis() (+36 more)

### Community 1 - "Dead UI Scaffold — Sidebar & Sheet"
Cohesion: 0.05
Nodes (42): Input(), Separator(), Sheet(), SheetContent(), SheetDescription(), SheetFooter(), SheetHeader(), SheetOverlay() (+34 more)

### Community 2 - "Roster: Hiring & Member Identity"
Cohesion: 0.08
Nodes (35): dynamic, PATCH(), patchSchema, dynamic, GET(), hireSchema, POST(), ADR-0009 (+27 more)

### Community 3 - "Export, Backup & Database"
Cohesion: 0.08
Nodes (18): root, safeHumans, where, dynamic, dynamic, dynamic, db, globalForPrisma (+10 more)

### Community 4 - "Dead UI Scaffold — Popovers & Badges"
Cohesion: 0.07
Nodes (16): Badge(), badgeVariants, Checkbox(), HoverCardContent(), PopoverContent(), Progress(), ResizableHandle(), ResizablePanelGroup() (+8 more)

### Community 5 - "Agent Adapters (Anthropic, Ollama)"
Cohesion: 0.14
Nodes (18): AnthropicAdapter, MessagesResponse, ChatResponse, OllamaAdapter, AgentRun, extractJson(), MODEL_PRICES, priceFor() (+10 more)

### Community 6 - "Orchestrator: Leased Queue & Handlers"
Cohesion: 0.10
Nodes (25): flag, warning, agentTurn(), Handler, handlerFor(), HandlerResult, HANDLERS, nextStage() (+17 more)

### Community 7 - "Work: Stage Ladder, Board & Activity"
Cohesion: 0.14
Nodes (25): dynamic, GET(), ActivityPage(), dynamic, dynamic, VIEWS, WorkPage(), Board() (+17 more)

### Community 8 - "Search: FTS5 Index & Results"
Cohesion: 0.12
Nodes (26): dynamic, GET(), dynamic, SearchPage(), glyph(), hrefFor(), SearchView(), Conversation (+18 more)

### Community 9 - "Settings UI: Library, Plugins, Dialog"
Cohesion: 0.09
Nodes (22): dynamic, SignInPage(), Button(), Dialog(), Field(), FormError(), inputClass, Call (+14 more)

### Community 10 - "Message Actions: React, Edit, Redact, Pin"
Cohesion: 0.11
Nodes (25): anchorCache, anchorsIn(), anchorsOf(), broken, ROOTS, body, dynamic, POST() (+17 more)

### Community 11 - "Conversation Panes & DM Creation"
Cohesion: 0.10
Nodes (24): bodySchema, dynamic, POST(), ADR-0009, ChannelsLayout(), dynamic, ChatsLayout(), dynamic (+16 more)

### Community 12 - "Emoji Picker & Hover Actions"
Cohesion: 0.08
Nodes (17): ALL, EmojiPicker(), Entry, Grid(), GROUPS, Act(), ActOn, ConfirmDelete() (+9 more)

### Community 13 - "Dead UI Scaffold — Alert Dialog"
Cohesion: 0.11
Nodes (19): AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription(), AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay(), AlertDialogTitle() (+11 more)

### Community 14 - "Browser Smoke Suite"
Cohesion: 0.15
Nodes (25): agentEdge(), boardView(), busyConversation(), call(), check(), checks, composer(), crawl() (+17 more)

### Community 15 - "Authentication & Sessions"
Cohesion: 0.18
Nodes (21): body, dynamic, POST(), withSession(), claimOwnerAccount(), ClaimResult, hashPassword(), memberForSession() (+13 more)

### Community 16 - "Event Schema & Agent Output Boundary"
Cohesion: 0.10
Nodes (23): AgentOutputContext, agentOutputSchema, CLAIM_STATUSES, claimStatusSchema, describe(), EVENT_TYPES, eventTypeSchema, isPartiallySalvageable() (+15 more)

### Community 17 - "Calls: Ring vs Room"
Cohesion: 0.12
Nodes (19): dynamic, GET(), CallRow, HEARTBEAT_TIMEOUT_MS, leaveCall(), leaveRoom(), readCall(), ringingFor() (+11 more)

### Community 18 - "Docs: Skills, Plugins & Connectors"
Cohesion: 0.10
Nodes (22): parseAgentOutput — one validation boundary, Buzz-Inspired Warm Cream/Mustard Direction (superseded), Base Colour Palette (oklch tokens), Connector (an MCP server the org has dialled), Holding the Connector Is the Permission (rationale), Plugin (installs skills + connectors, hires whoever uses them), Settings — Skills, Plugins, Connectors, Skill (SKILL.md convention) (+14 more)

### Community 19 - "Extensions: The App Catalogue"
Cohesion: 0.16
Nodes (15): body, dynamic, GET(), POST(), dynamic, ExtensionsPage(), Apps(), AppDefinition (+7 more)

### Community 20 - "MCP Connectors"
Cohesion: 0.19
Nodes (19): createBody, currentOrg(), DELETE(), dynamic, fail(), GET(), PATCH(), patchBody (+11 more)

### Community 21 - "Posting & Mention Attribution"
Cohesion: 0.13
Nodes (16): bodySchema, dynamic, ADR-0009, post(), ADR-0009, fetch(), post(), runOneTurn() (+8 more)

### Community 22 - "Skills Library"
Cohesion: 0.19
Nodes (17): createBody, currentOrg(), DELETE(), dynamic, fail(), GET(), PATCH(), patchBody (+9 more)

### Community 23 - "Visibility Rule & Conversation Window"
Cohesion: 0.21
Nodes (19): dynamic, GET(), latestSeq(), attachmentsForEvents(), attachReplies(), ConversationMessage, KINDS, listMessages() (+11 more)

### Community 24 - "Attachments & Upload Sniffing"
Cohesion: 0.18
Nodes (18): DELETE(), dynamic, fail(), POST(), ALLOWED, AttachmentError, discardUpload(), imageSize() (+10 more)

### Community 25 - "Primitives, Avatars & Ledger View"
Cohesion: 0.12
Nodes (15): dynamic, LedgerPage(), ORDER, Avatar(), ClaimStatus, MemberKind, PRESENCE_COLOR, PRESENCE_LABEL (+7 more)

### Community 26 - "The Composer"
Cohesion: 0.11
Nodes (10): Composer(), submit(), draftKey(), formatBytes(), I, Mentionable, Pending, ReplyTarget (+2 more)

### Community 27 - "MCP Client Transport"
Cohesion: 0.15
Nodes (14): authHeaders(), CALL_TIMEOUT_MS, callTool(), CLIENT_INFO, ConnectionError, Dialable, discoverTools(), once() (+6 more)

### Community 28 - "Community 28"
Cohesion: 0.21
Nodes (19): context(), DELETE(), dynamic, fail(), GET(), leaveBody, POST(), startBody (+11 more)

### Community 29 - "Community 29"
Cohesion: 0.15
Nodes (14): dynamic, MEMBER_VIEWS, MembersPage(), MemberRow(), OrgView(), Split(), roleLabel(), DepartmentNode (+6 more)

### Community 30 - "Community 30"
Cohesion: 0.14
Nodes (17): dynamic, SettingsPage(), Tab, TABS, catalogue(), catalogueEntry, DIR, AgentDecl (+9 more)

### Community 31 - "Community 31"
Cohesion: 0.13
Nodes (17): consoleMono, inter, ledgerSerif, metadata, mono, studioSans, viewport, Toast (+9 more)

### Community 32 - "Community 32"
Cohesion: 0.12
Nodes (15): Command(), CommandDialog(), CommandGroup(), CommandInput(), CommandItem(), CommandList(), CommandSeparator(), CommandShortcut() (+7 more)

### Community 33 - "Community 33"
Cohesion: 0.15
Nodes (15): BudgetExhausted, dailyBudgetCents(), DEFAULT_DAILY_BUDGET_CENTS, money(), Spend, spendToday(), ADR-0007, ADR-0007 (+7 more)

### Community 34 - "Community 34"
Cohesion: 0.17
Nodes (18): availableTools(), Held, heldConnections(), MAX_CALLS_PER_TURN, runToolCalls(), RunToolsResult, NoHarness, runAgentTurn() (+10 more)

### Community 35 - "Community 35"
Cohesion: 0.15
Nodes (13): CallMember, KIND_LABEL, Library(), localValue(), MeetingStrip(), nextSlot(), ScheduleButton(), ScheduleDialog() (+5 more)

### Community 36 - "Community 36"
Cohesion: 0.11
Nodes (14): Attachments(), CODE_STYLE, CodeBlock(), duration(), MessageBody(), Card(), MessageList(), MessageRow() (+6 more)

### Community 37 - "Community 37"
Cohesion: 0.12
Nodes (6): initialsOf(), S, TABS, ThemeMenu(), THEMES, ViewerMenu()

### Community 38 - "Community 38"
Cohesion: 0.14
Nodes (17): PresenceDot(), PresenceState, ColleagueDialog(), HARNESSES, HireDialog(), label(), Open, RetireDialog() (+9 more)

### Community 39 - "Community 39"
Cohesion: 0.11
Nodes (19): Leased Queue (not locked), The Ceiling Is the Live Connection (~3,200 conversations), The Orchestrator, How a Request Flows, Past One Box: SQLite→Postgres, poll→subscription, SSE Stream (poll every 1.5s), The Orchestrator Stage Ladder (15 stages), Ten Unbuilt Stages Declared implemented:false (rationale) (+11 more)

### Community 40 - "Community 40"
Cohesion: 0.17
Nodes (15): dynamic, POST(), buildEventArc(), clearAll(), createConversations(), createSkillLibrary(), createTenantOrgAndAgents(), createWorkGraph() (+7 more)

### Community 41 - "Community 41"
Cohesion: 0.20
Nodes (16): currentOrg(), DELETE(), dynamic, fail(), GET(), installBody, POST(), removeBody (+8 more)

### Community 42 - "Community 42"
Cohesion: 0.13
Nodes (17): The Adapter Seam, Debate Is What Moves a Claim's Status (rationale), The Epistemic Ledger, Fail Loudly Rather Than Fabricate (rationale), Gate Evaluations on Work Cards, Blocked Is Typed and Links to Its Cause, What Moves, and Where (nine destinations become six), The 'Why This Changed' Trace Drawer (+9 more)

### Community 43 - "Community 43"
Cohesion: 0.14
Nodes (17): Append-Only Rule (never update or delete an Event), The Event Spine, MessageEdited, MessageRedacted, Measured Performance on 50,561 Events, Why SQLite Allocates seq (rationale), One Writer Owns the Spine, targetEventId as a Projection (rationale) (+9 more)

### Community 44 - "Community 44"
Cohesion: 0.15
Nodes (14): ALLOWED_TYPES, dynamic, postSchema, ADR-0008, POST(), Bucket, buckets, Limit (+6 more)

### Community 45 - "Community 45"
Cohesion: 0.24
Nodes (14): cancelBody, context(), DELETE(), dynamic, fail(), GET(), POST(), scheduleBody (+6 more)

### Community 46 - "Community 46"
Cohesion: 0.12
Nodes (11): Menubar(), MenubarCheckboxItem(), MenubarContent(), MenubarItem(), MenubarLabel(), MenubarRadioItem(), MenubarSeparator(), MenubarShortcut() (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.16
Nodes (16): AgentAdapter Interface — the Only Way the Substrate Talks to Agents, Consequence: The Adapter Interface Is Load-Bearing (minimal invoke + health mitigates), Consequence: No 'Demo Mode' Branch — v1 and v2 Surfaces Are Identical, Rationale: 'Same design must work for real agents too' — no redesign at v2, Rejected for v1: Real Agent Execution (API keys, sandbox plane, model plurality), SimulatedAgentAdapter Shipped in v1, Constraint: The Substrate Never Imports an Agent Directly, v2 Real Adapters (Zai, OpenAI, LocalOllama) Drop In Unchanged (+8 more)

### Community 48 - "Community 48"
Cohesion: 0.15
Nodes (16): Conversation Membership vs Event Visibility, Redaction Deletes the Index Row, Search over SQLite FTS5, Owner and Assistant Share a Reach, Two-Phase Search: FTS5 Ranks, Prisma Filters (rationale), visibleTo() — the One Visibility Rule, Why a where Fragment and Not a Post-Filter (rationale), Search (⌘K, /search?q=) (+8 more)

### Community 49 - "Community 49"
Cohesion: 0.12
Nodes (9): ContextMenuCheckboxItem(), ContextMenuContent(), ContextMenuItem(), ContextMenuLabel(), ContextMenuRadioItem(), ContextMenuSeparator(), ContextMenuShortcut(), ContextMenuSubContent() (+1 more)

### Community 50 - "Community 50"
Cohesion: 0.12
Nodes (9): DropdownMenuCheckboxItem(), DropdownMenuContent(), DropdownMenuItem(), DropdownMenuLabel(), DropdownMenuRadioItem(), DropdownMenuSeparator(), DropdownMenuShortcut(), DropdownMenuSubContent() (+1 more)

### Community 51 - "Community 51"
Cohesion: 0.12
Nodes (5): CallSurface(), Control(), I, IceConfig, LiveCall

### Community 52 - "Community 52"
Cohesion: 0.19
Nodes (15): countPhrase(), describePolicy(), evaluateGate(), evaluatePolicy(), GateEvaluation, parsePolicy(), Policy, Query (+7 more)

### Community 53 - "Community 53"
Cohesion: 0.17
Nodes (13): ADR-0002, AGENT_EVENT_TYPES, RESPONSIBILITIES, systemPrompt(), toolSection(), TurnRequest, AgentKind, AgentScope (+5 more)

### Community 54 - "Community 54"
Cohesion: 0.16
Nodes (15): Chat Surface Is a Projection of the Event Log, Not the Source of Truth, socket.io Real-time Transport with Room-based Fan-out (port 3003), AgentResponse Is Only Proposed Events and Claims — Adapters Never Mutate, Single Append-Only Event Table, Consequence: Soft State Must Be Derived from the Latest ClaimStatusChanged, EventType Discriminated Union (ProposalOpened … EscalationResolved), Consequence: New Event Types Mean Updating the TS Union, Not Just the DB, Constraint: No UPDATE, No DELETE on Event from Application Code (+7 more)

### Community 55 - "Community 55"
Cohesion: 0.13
Nodes (15): Agent Adapter Registry (harness → adapter), Anthropic Adapter, Ollama Adapter, Agent Registry Screen, Reading Order, The Diversity Problem (single-agent failure shape), One-Sentence Promise, The Build Plan (P0–P5, each with an exit gate) (+7 more)

### Community 56 - "Community 56"
Cohesion: 0.30
Nodes (11): ChannelPage(), dynamic, ChatPage(), dynamic, ConversationView(), isAppOn(), currentViewer(), modeFor() (+3 more)

### Community 57 - "Community 57"
Cohesion: 0.14
Nodes (14): Claim Status Lifecycle (asserted→believed→tested→falsified→uncertain), Accessibility Rules (colour never alone, 44px targets, reduced motion), Animation Principles, Claim-Status Colours — the load-bearing colour system, Gate / Debate State Colours, Status Pills, Teal Edge on a Squircle Avatar (two signals), Channels Are Threaded (+6 more)

### Community 58 - "Community 58"
Cohesion: 0.14
Nodes (14): Continuous Review Metrics, Activity (rail tab), Board Columns Are Member-Neutral (rationale), Channels (rail tab), Ledger (rail tab), Members (rail tab, was HR), 'Needs You' Is a Lens, Not a Column (rationale), If It Needs a New Rail Tab It Probably Belongs Inside One (rationale) (+6 more)

### Community 59 - "Community 59"
Cohesion: 0.19
Nodes (11): GET(), GET(), ChatMessageProjection, LedgerEntry, projectChatMessages(), STATUS_HINTS, TYPE_LABELS, TYPED_MESSAGE_EVENTS (+3 more)

### Community 60 - "Community 60"
Cohesion: 0.16
Nodes (9): bodySchema, dynamic, POST(), body, dynamic, enqueueStageWork(), BoardError, moveObjective() (+1 more)

### Community 61 - "Community 61"
Cohesion: 0.19
Nodes (13): Carousel(), CarouselApi, CarouselContent(), CarouselContext, CarouselContextProps, CarouselItem(), CarouselNext(), CarouselOptions (+5 more)

### Community 62 - "Community 62"
Cohesion: 0.20
Nodes (11): FormControl(), FormDescription(), FormFieldContext, FormFieldContextValue, FormItem(), FormItemContext, FormItemContextValue, FormLabel() (+3 more)

### Community 63 - "Community 63"
Cohesion: 0.20
Nodes (13): Action, ActionType, actionTypes, addToRemoveQueue(), dispatch(), genId(), listeners, memoryState (+5 more)

### Community 64 - "Community 64"
Cohesion: 0.21
Nodes (11): anthropicConfig, ollamaConfig, configuredHarnesses(), Harness, isHarness(), noHarnessConfiguredMessage(), Resolution, resolveAdapter() (+3 more)

### Community 65 - "Community 65"
Cohesion: 0.18
Nodes (11): AgentClaimRecord, NewClaimInput, ClaimStatus, ClaimQuery, AssertInput, CLAIM_STATUSES, IllegalTransition, LEGAL (+3 more)

### Community 66 - "Community 66"
Cohesion: 0.18
Nodes (13): Consequence: Rust and Next.js Share One SQLite File — Contention Risk (mitigated by WAL), Hand-Authored Canned Response Scripts per Role, Consequence: Concurrent Agent Runs Make Single-Writer a Prerequisite, A Durable Orchestrator Process Separate from Next.js, Rejected: Orchestration in API Routes with Background Promises, Superseded: The Request-Scoped 452-Line Nine-Phase Debate Script, Consequence: Running the App Means Two Processes; Setup Must Hide That, Problem: Two Independent Writers Allocate Event.seq Against the Same SQLite File (+5 more)

### Community 67 - "Community 67"
Cohesion: 0.18
Nodes (10): count, LINES, seconds, spine, start, EventSpine, post(), reply() (+2 more)

### Community 68 - "Community 68"
Cohesion: 0.27
Nodes (11): body, dynamic, fail(), GET(), POST(), seatOf(), CallError, heartbeat() (+3 more)

### Community 69 - "Community 69"
Cohesion: 0.20
Nodes (12): Authority Levels Enum on TeamMembership.role (ORG_OWNER…HR_META), Hierarchy: Tenant → Org → Department → Team → Membership → Member, Member as a Polymorphic Concept (Agent | Human), Multi-Tenant in the Schema from Day 1, Polymorphic Membership with memberType Discriminator + memberId String, Rationale: Model Multi-Tenancy Now to Avoid a Painful Migration Later, v1 Simplification: One Tenant, One Org, Stubbed Switchers, Delegation Table (principal, agent, scopes, budgetCap, expiry, revocation) (+4 more)

### Community 70 - "Community 70"
Cohesion: 0.18
Nodes (11): AgentProfile, Delegation (actorMemberId vs onBehalfOfMemberId), HumanProfile, One Member Identity, The Composer, Members — One Roster, @ Mentions Over People and Agents — One List, The Org Chart (org → departments → teams → members) (+3 more)

### Community 71 - "Community 71"
Cohesion: 0.18
Nodes (11): ClaimStatusChanged, Parity Is a Schema Property (rationale), Presence, Not a Runtime Dashboard (rationale), One Presence Vocabulary for Every Member, A User Is a Human or an Agent, Everywhere, The Rules You Cannot Break, Debate Engine State Machine, Traceable, Falsifiable Reasoning (+3 more)

### Community 72 - "Community 72"
Cohesion: 0.20
Nodes (11): Chat Surface Treatment (three-column, typed messages), Decision Page Treatment (the distinctive surface), App Shell Wireframe, Channel View Wireframe, Decision Page Wireframe, The Falsification Arc as Rendered (Claim #42 believed → falsified), Typed Composer Dropdown, Decision Pages (GitHub-PR-style) (+3 more)

### Community 73 - "Community 73"
Cohesion: 0.24
Nodes (9): assertBody, dynamic, POST(), postBody, transitionBody, ADR-0005, assertClaim(), transitionClaim() (+1 more)

### Community 74 - "Community 74"
Cohesion: 0.25
Nodes (9): ChartConfig, ChartContainer(), ChartContext, ChartContextProps, ChartLegendContent(), ChartTooltipContent(), getPayloadConfigFromPayload(), THEMES (+1 more)

### Community 75 - "Community 75"
Cohesion: 0.18
Nodes (7): SelectContent(), SelectItem(), SelectLabel(), SelectScrollDownButton(), SelectScrollUpButton(), SelectSeparator(), SelectTrigger()

### Community 76 - "Community 76"
Cohesion: 0.18
Nodes (10): ActorType, CLAIM_STATUSES, DEBATE_STATES, DebateState, EventPayloadMap, GATE_STATES, GateState, ADR-0004 (+2 more)

### Community 77 - "Community 77"
Cohesion: 0.18
Nodes (6): DESKTOP, failed, files, PHONE, taken, thin

### Community 78 - "Community 78"
Cohesion: 0.27
Nodes (10): actorType/actorId and scopeType/scopeId on Every Event, Claim Model with Status, Scope and Provenance, Claim Status ∈ asserted | believed | tested | falsified | uncertain, Provenance Chain: claim → originating event → actor → evidence → contradictions, Event.actorMemberId and Claim.provenanceMemberId — One Indexed FK Each, Dual Attribution: actorMemberId + onBehalfOfMemberId, Neither Overwritten, An HR Proposal About a Member Is Visible to That Member by Default, HR Symmetry: a Member-Neutral Ledger Means One HR Code Path (+2 more)

### Community 79 - "Community 79"
Cohesion: 0.22
Nodes (10): Ledger View Treatment (dense table), Ledger View Wireframe, Ledger — What the Org Believes, Seven Looks (Studio, Daylight, Ink, Paper, Warm, Ledger, Console), Directions: Ledger and Console (rationale), Directions Are a Skin in globals.css; data-status-pill / data-claim-status hooks, Trap: Tailwind v4 Layering, CSS Custom Properties as Theme Tokens (+2 more)

### Community 80 - "Community 80"
Cohesion: 0.22
Nodes (9): NavigationMenu(), NavigationMenuContent(), NavigationMenuIndicator(), NavigationMenuItem(), NavigationMenuLink(), NavigationMenuList(), NavigationMenuTrigger(), navigationMenuTriggerStyle (+1 more)

### Community 81 - "Community 81"
Cohesion: 0.25
Nodes (9): Constraint: z-ai-web-dev-sdk Stays Backend-Only, Never Imported Client-Side, Hybrid Architecture: Next.js UI + Rust Substrate + socket.io, Next.js 16 App Router as UI and API Layer, Prisma 6 + SQLite Local-First Persistence, Rationale: Rust over Go/C — tokio async, ownership enforces append-only, no GC pauses, Rust Substrate Owns the Event Spine Writer (port 3030), Consequence: evidenceIds and contradictsIds Are JSON Strings (SQLite has no arrays), Prisma Client Log Level Guarded by NODE_ENV (no query logs in production) (+1 more)

### Community 82 - "Community 82"
Cohesion: 0.22
Nodes (9): Calls (WebRTC mesh), Meetings — a scheduled call with a join window, Six-Participant Mesh Cap (rationale), Ring vs Room — the call knows which room it is in, A DM Stays a DM When You Summon an Assistant (rationale), Chats (rail tab), Participant vs Responder, Where Things Are (repo map) (+1 more)

### Community 83 - "Community 83"
Cohesion: 0.25
Nodes (8): Event.visibility ∈ tenant | org | team | private, Agent tools[] and permissions[] as Stored JSON Capability Lists, AgentRun Table — tokens, cost and outcome per run, Budget, Autonomy and Escalation Enforced at Exactly One Place — Before Dispatch, Approval Scopes Are Opt-In and Default Off — human-in-the-loop must not evaporate, Explicit Revocable Scopes (post, object, run_experiment, spend:<cap>, approve_gate:<class>), read:inherit_all as a Scope Rather Than a Hardcoded Rule, Visibility Inherited in Full and Computed at Read Time (DMs included)

### Community 84 - "Community 84"
Cohesion: 0.36
Nodes (4): money(), pct(), Rate(), Review()

### Community 85 - "Community 85"
Cohesion: 0.33
Nodes (7): Rationale: Falsification Is a Real State Transition the Gate Can Query, Not a Chat Message, Debate Is the State-Transition Function over Claim Status, Four Organisation Rules: context handoff, reopen upstream, experiments outrank arguments, deadlock escalates, Leases Make Work Crash-Safe; attempts Bounds Retries into Escalation, Objective.stage — a Twelve-Stage Lifecycle State Machine, Rejected: A General Workflow Engine (Temporal, BullMQ, LangGraph), WorkItem Table (state, priority, runAfter, attempts, lastError)

### Community 86 - "Community 86"
Cohesion: 0.29
Nodes (5): databaseUrl, proc, root, server, standalone

### Community 87 - "Community 87"
Cohesion: 0.29
Nodes (4): AppLayout(), dynamic, Rail(), Ringing()

### Community 88 - "Community 88"
Cohesion: 0.33
Nodes (6): AgentThought Events as Shared Cognitive Space, Agent Kinds: INDEPENDENT vs PERSONAL_ASSISTANT, Four Memory Tiers: agent-private, personal-assistant, team, org-ledger, A Direct Message Stays a Direct Message, An Assistant Always Acts Under Its Own Name, Participant vs Responder — a Summoned Assistant Never Changes a Conversation's Kind

### Community 89 - "Community 89"
Cohesion: 0.33
Nodes (6): Monotonic Event.seq for Replay Ordering, Replay Endpoint GET /api/replay?fromSeq=0, Regression Test: 50 Concurrent Appends Yield 50 Gapless Increasing seq Values, Rejected: A Distributed Sequence Service — there is one database file, Rejected: Order by Timestamp Instead of Gapless seq — replay determinism is non-negotiable, Event.seq Becomes INTEGER PRIMARY KEY AUTOINCREMENT — the DB Is the Only Allocator

### Community 90 - "Community 90"
Cohesion: 0.67
Nodes (3): ListPane(), ListRow(), SectionLabel()

### Community 93 - "Community 93"
Cohesion: 0.50
Nodes (4): Alert(), AlertDescription(), AlertTitle(), alertVariants

### Community 94 - "Community 94"
Cohesion: 0.40
Nodes (3): InputOTP(), InputOTPGroup(), InputOTPSlot()

### Community 95 - "Community 95"
Cohesion: 0.50
Nodes (4): Dense Information, Calm Presentation, Provenance Is Visible (rationale), Spacing and Density, Typography (Inter, JetBrains Mono, hierarchy)

### Community 96 - "Community 96"
Cohesion: 0.50
Nodes (4): Get It Running (setup, dev, check, smoke), Export and Backup (bun run export), M2 — Installation Is Not Simple, Commands (setup, dev, check, smoke, shots, export, mcp:example)

### Community 97 - "Community 97"
Cohesion: 0.67
Nodes (3): build(), fetch(), sessions

### Community 100 - "Community 100"
Cohesion: 0.50
Nodes (3): DB_PUSH_CALLS, PATH, database-runtime-build.sh script

### Community 101 - "Community 101"
Cohesion: 0.50
Nodes (3): dbFile, dir, proc

### Community 102 - "Community 102"
Cohesion: 0.67
Nodes (3): Definition of Done, The Five-Step Loop (research → action → result → information → adjustment), Three Seats: architect, critic, user

### Community 103 - "Community 103"
Cohesion: 1.00
Nodes (3): Screenshots Driven Against the Real App (rationale), Regenerating the Documentation (bun run shots), Playwright — smoke (141 checks) and shots

## Ambiguous Edges - Review These
- `Hand-Authored Canned Response Scripts per Role` → `Superseded: The Request-Scoped 452-Line Nine-Phase Debate Script`  [AMBIGUOUS]
  docs/adr/0007-orchestrator-work-runtime.md · relation: references

## Knowledge Gaps
- **479 isolated node(s):** `dynamic`, `dynamic`, `dynamic`, `dynamic`, `dynamic` (+474 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Hand-Authored Canned Response Scripts per Role` and `Superseded: The Request-Scoped 452-Line Nine-Phase Debate Script`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `cn()` connect `Dead UI Scaffold — Tables & Drawers` to `Dead UI Scaffold — Sidebar & Sheet`, `Dead UI Scaffold — Popovers & Badges`, `Work: Stage Ladder, Board & Activity`, `Search: FTS5 Index & Results`, `Settings UI: Library, Plugins, Dialog`, `Emoji Picker & Hover Actions`, `Dead UI Scaffold — Alert Dialog`, `Extensions: The App Catalogue`, `Primitives, Avatars & Ledger View`, `The Composer`, `Community 29`, `Community 30`, `Community 31`, `Community 32`, `Community 35`, `Community 36`, `Community 37`, `Community 38`, `Community 46`, `Community 49`, `Community 50`, `Community 51`, `Community 56`, `Community 61`, `Community 62`, `Community 74`, `Community 75`, `Community 80`, `Community 87`, `Community 90`, `Community 93`, `Community 94`?**
  _High betweenness centrality (0.226) - this node is a cross-community bridge._
- **Why does `db` connect `Export, Backup & Database` to `Roster: Hiring & Member Identity`, `Orchestrator: Leased Queue & Handlers`, `Work: Stage Ladder, Board & Activity`, `Search: FTS5 Index & Results`, `Settings UI: Library, Plugins, Dialog`, `Message Actions: React, Edit, Redact, Pin`, `Conversation Panes & DM Creation`, `Authentication & Sessions`, `Calls: Ring vs Room`, `Extensions: The App Catalogue`, `MCP Connectors`, `Posting & Mention Attribution`, `Skills Library`, `Visibility Rule & Conversation Window`, `Attachments & Upload Sniffing`, `Primitives, Avatars & Ledger View`, `Community 28`, `Community 29`, `Community 30`, `Community 33`, `Community 34`, `Community 40`, `Community 41`, `Community 44`, `Community 45`, `Community 52`, `Community 56`, `Community 60`, `Community 65`, `Community 67`, `Community 68`, `Community 73`, `Community 77`, `Community 92`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **Why does `useToast()` connect `Community 35` to `Community 38`, `Work: Stage Ladder, Board & Activity`, `Settings UI: Library, Plugins, Dialog`, `Emoji Picker & Hover Actions`, `Community 51`, `Extensions: The App Catalogue`, `Community 56`, `The Composer`, `Community 63`, `Community 31`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `dynamic`, `dynamic`, `dynamic` to the rest of the system?**
  _479 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dead UI Scaffold — Tables & Drawers` be split into smaller, more focused modules?**
  _Cohesion score 0.05786090005844535 - nodes in this community are weakly interconnected._
- **Should `Dead UI Scaffold — Sidebar & Sheet` be split into smaller, more focused modules?**
  _Cohesion score 0.05279034690799397 - nodes in this community are weakly interconnected._