# OpPal architecture decks: review notes

What is in the two architecture decks, why each slide is there, and where every
claim comes from, so a reviewer can check them against the code.

| Deck | Link | Slides | Status |
|---|---|---|---|
| OpPal Architecture | https://claude.ai/artifact/Vr48JNgJCvnpZJeGZ8mjgi | 5 | Describes the code as it is (v14.14.0, branch `langchain-chat-agent`) |
| OpPal on Azure | https://claude.ai/artifact/EfgahTMi1jNZuqmJVJpZet | 7 | A deployment **concept**. Nothing in it is built |

Both decks are private. A reviewer can open them only after they are shared
from the deck's Share menu. Each deck exports to PowerPoint or PDF from the
same menu. Every slide has speaker notes that say more than the slide does.

---

## How to review

1. **Facts:** each slide's "Sources" line names the files the claim comes from.
   Check the claim against those files.
2. **Assumptions:** the Azure deck is a proposal, and every assumption in it
   is listed in [Assumptions in the Azure deck](#assumptions-in-the-azure-deck).
   Challenge those.
3. **Simplifications:** the diagrams leave parts out on purpose. They are
   listed under each diagram. Flag any omission that changes a reader's
   understanding.
4. **Open questions:** the questions at the end need an owner's decision.

---

## Visual language (both decks)

Both decks use the **Security Architecture Diagrams** design system: the Inter
typeface, its colour tokens, and its rules for drawing a security diagram. It
was chosen because a reviewer reading an architecture diagram asks three
questions, and this system answers each one visually:

| Question | How the diagrams answer it |
|---|---|
| Where are the trust boundaries? | Nested **zones**. A solid outline is an enforced boundary. A dashed outline is logical (a cloud region) or outside your control (a third party). |
| What enforces each boundary? | **Red tiles are controls** (token middleware, data gate, WAF, firewall, Key Vault). Scanning for red shows every control at once. Muted notes at the foot of a zone say what it enforces. |
| What path does a request take? | **Numbered badges** (1, 2, 3 …) follow one request in order. **Letters** (A, B) mark side paths. Each slide that follows a diagram repeats the numbers as a table. |

Line colour and pattern show the **trust level of the traffic**, not which
service it leaves:

| Line | Meaning |
|---|---|
| Orange-red, solid | Untrusted traffic, before the first control |
| Blue, solid | Inspected traffic inside the platform |
| Green, solid | Application to data store |
| Teal, dashed | Egress to third parties |
| Grey, dotted | Rules or control-plane reads (Context Brain grounding) |

Tile colour shows the **category** of a component: red is a security control,
brick is identity, orange is compute, blue is a database, green is storage,
purple is networking, magenta is integration, teal is observability, and grey
is external.

The design system's `project/api/tokens.md` file was missing. The look is
built from its README and `tokens.json`.

---

## Deck 1: OpPal Architecture

**Purpose:** explain how OpPal is built today on one slide, then follow one
request in detail.
**Audience:** engineers, security reviewers and architects new to the
codebase.
**Order:** overview, then one request end to end, then the write path. The
read path (asking a question) comes before the write path (changing
something), because every write depends on it.

### Slide 1: Cover

- **What:** the title, a one-line summary, and a five-tile strip: Browser →
  Middleware → Chat → Data gate → Warehouse.
- **Why:** the strip is the shortest true version of the request path, so the
  reader has the shape of the system before the detail.
- **Sources:** build number from `backend/app/version.py` (`VERSION =
  "14.14.0"`).

### Slide 2: High-level architecture (the diagram)

- **What:** zones from left to right:
  - **Client:** the browser running the React UI.
  - **OpPal backend · FastAPI,** containing:
    - *API edge:* the token-check middleware and the route guard (RBAC and
      ABAC).
    - *Engines:* Pillars and Swarm, the Simulator, Actions (maker-checker) and
      the Chat orchestrator.
    - The Context Brain (Markdown).
    - The Data gate (the MCP service).
    - *Data tier:* the read-only warehouse.
  - **Third party:** the write-back target (CAPS, webhook) and the optional
    LLM provider.
  - **Shared controls band:** the audit ledger, the trust gate, the PHI guard
    and the FinOps budget.
- **Numbered path:**
  1. Browser → middleware
  2. Middleware → route guard
  3. Route guard → Chat
  4. Chat → Context Brain
  5. Chat → LLM provider
  6. Chat → Data gate
  7. Data gate → warehouse
- **Side paths:** B is Simulator → Actions (promotion). A is Actions →
  write-back target.
- **Why this layout:**
  - Shared controls go in one band instead of a line to every node, because
    they apply to every call.
  - The Data gate is drawn as a red control tile, not a network box, because
    it is "the one gate every query passes through".
  - The Context Brain sits under the engines because every engine reads it.
- **Sources:**
  - `CLAUDE.md` ("Request pipeline", "Deny-by-default, enforced in four
    places")
  - `OpPal_How_It_Works.md` §3
  - `backend/app/main.py` (`security_middleware`, `_user()`, `_require()`)
  - `backend/app/mcp/base.py` (final `execute()`)
  - `backend/app/actions/adapters/` (`dry_run.py`, `caps.py`, `webhook.py`)
  - `backend/app/llm/base.py` (the mock provider is the default)
- **Left out on purpose (high-level view):**
  - The semantic cache and the review queue. Both are covered on slide 4.
  - The notification bus (email, Slack).
  - The Workspace tab.
  - The Vite dev proxy (dev only).
  - The warehouse connectors for BigQuery, Snowflake and Databricks. These are
    mentioned in the notes only.
  - Pillars, Swarm and Cases are merged into one tile.
  - The LangChain SQL agent (`backend/app/chat_agent.py`) is folded into the
    Chat tile. It runs queries through the same governed data service.

### Slide 3: One request, hop by hop

- **What:** a table of steps 1–7, A and B, with the control at each crossing.
- **Why:** the design system requires every numbered diagram to be followed by
  its step list, and the table is where each boundary crossing gets its
  protocol and control.
- **Facts to check:**
  - 120 requests per minute per client, from `OpPal_How_It_Works.md` §3.
  - The principal is re-resolved with no header fallback, from `CLAUDE.md`.
  - `execute()` is final, from `mcp/base.py`.
  - Queries are row-capped to the caller's lines of business, from
    `OpPal_How_It_Works.md` §3.
  - Write-back is dry-run by default, from `README.md`.

### Slide 4: Eight stages behind every chat answer

- **What:** eight numbered stage cards:
  1. Access control
  2. Semantic grounding
  3. Intent routing
  4. Cache probe
  5. SQL generation
  6. Validate and execute
  7. Root cause and trust
  8. Visualize and narrate

  Two callouts follow: the **0.85 hard trust gate**, and the **fallback
  ladder**, which retries refused model-written SQL on a governed template.
- **Why:** this is what happens inside the Chat tile. The two callouts are the
  guarantees a reviewer cares most about: a model can never widen scope, and
  a low-trust answer is withheld.
- **Sources:**
  - `backend/app/agents/orchestrator.py::_handle`
  - `backend/app/trust/scoring.py` (`HARD_GATE`, and the weights 0.35, 0.30,
    0.20 and 0.15)
  - The "Request pipeline" section of `CLAUDE.md`

### Slide 5: Writes need two signatures and leave a hash

- **What:**
  - **Four steps:** Simulate (on a forked Brain), Approve twice (two distinct
    officers), Execute (with a governed adapter), Reverse (with an append-only
    compensating entry).
  - **Ledger band:** one ledger with two chains, and the protected keys.
- **Why:** this shows that nothing writes on one person's say-so, and that
  every write can be traced and reversed without editing history.
- **Sources:**
  - `backend/app/simulation/isolation.py` (deep-copy fork)
  - `backend/app/actions/engine.py`
  - `backend/app/trust/audit_ledger.py` (v1) and `ledger_v2.py` (v2)
  - `backend/app/semantic/brain_governance.py::PROTECTED_KEYS`
  - The two compliance officer accounts, `u-compliance` and `u-compliance2`,
    from `CLAUDE.md`

---

## Deck 2: OpPal on Azure

**Purpose:** imagine OpPal deployed on Azure, and show that the deployment
keeps every control the app already has while Azure adds layers around it.
**Audience:** cloud architects, the security team, and anyone sizing the
migration.
**Order:** the diagram, then the request path on Azure, then where each part
runs, then security, state, and finally the code changes it would take. The
deck ends on the cost of the move.

### Slide 1: Cover

- **What:** "OpPal on Azure", labelled *Deployment concept · not built*, with
  a five-tile strip: Users → Front Door → Container Apps → Private Link →
  Databricks.
- **Why:** the label prevents anyone reading the deck as a description of a
  live system.

### Slide 2: Azure reference deployment (the diagram)

- **What:** zones from left to right:
  - **Users:** the browser, signed in through Entra ID with MFA.
  - **Global edge:** Front Door with a WAF, applying TLS 1.2+, OWASP rules
    and rate limits.
  - **Azure region** (sample: West Europe), containing:
    - *Spoke VNet:* an **Apps subnet** with the Web UI and OpPal API Container
      Apps, and a **Private Link subnet** with Azure OpenAI, the Databricks SQL
      warehouse and Azure Files. No public IPs.
    - *Hub VNet:* Azure Firewall, which handles egress only.
  - **External:** partner systems (CAPS, Slack), reached only through the
    firewall.
  - **Shared services band:** Entra ID, Key Vault, Defender, Monitor,
    Sentinel and Azure Policy.
- **Numbered path:**
  1. Browser → Edge WAF
  2. Edge WAF → Web UI (over Private Link)
  3. Web UI → OpPal API
  4. OpPal API → Azure OpenAI
  5. OpPal API → Databricks
  6. OpPal API → Azure Files
- **Side path:** A is OpPal API → Firewall → Partners.
- **Why this layout:**
  - Hub-and-spoke puts all egress through one inspected point.
  - Private Link removes every public endpoint behind the edge.
  - The two app containers map one-to-one to the two containers that already
    exist.

### Slide 3: One request on Azure, hop by hop

- **What:** steps 1–6 and A, each with its Azure control.
- **Why:** this is the step list for slide 2. It also makes the point that the
  app's own token check still runs at step 3, even on internal ingress.

### Slide 4: Where each part of OpPal runs

- **What:** a mapping table with 11 rows, each pairing an OpPal component with
  an Azure service and saying how it fits.
- **Why:** it shows how much of the move is configuration rather than new
  code.
- **Repo facts behind it:**
  - **Two containers:** `docker-compose.yml` defines `frontend` (nginx) and
    `backend`.
  - **Port and health probe:** the backend listens on port 8080, and the
    health probe path is `/api/auth/users`. Both come from
    `backend/Dockerfile`.
  - **Data folders:** the writable state is the two folders Docker Compose
    mounts, `app/data` and `app/semantic`.
  - **LLM provider:** `AzureOpenAIProvider` in `backend/app/llm/base.py` reads
    `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` and
    `AZURE_OPENAI_DEPLOYMENT`.
  - **Warehouse connector:** `backend/app/mcp/connectors/databricks.py`
    exists. It needs the optional `databricks-sql-connector` package.
  - **Cache:** `backend/app/security/semantic_cache.py` uses Redis when
    `REDIS_URL` is set, and otherwise caches in-process.
  - **Secrets:** they come from environment variables:
    - `OPPAL_AUTH_SECRET` (in `security/auth.py`)
    - `OPPAL_ACTION_WEBHOOK_URL` and `OPPAL_ACTION_WEBHOOK_SECRET`
    - `OPPAL_NOTIFY_SMTP_*`
    - `OPPAL_NOTIFY_SLACK_WEBHOOK`

### Slide 5: Azure adds layers around the app's own checks

- **What:** two columns.
  - **Azure, outside the app:** Front Door WAF, Private Link, Entra ID with
    PIM, managed identity, Azure Policy.
  - **The app's own checks, unchanged:** the middleware, `_user()`,
    `_require()`, `MCP execute()`, and the two-officer rule.
- **Why:** this is defence in depth. Azure decides who can reach the app; the
  app decides what each user may see and do. Neither replaces the other.

### Slide 6: Where OpPal's state lives on Azure

- **What:** a table of the five stores (warehouse, audit ledger, cases and
  actions and history, settings, Context Brain), showing where each lives
  today and where it would live on Azure. Two callouts follow:
  - **Ceiling, one API replica:** SQLite files and a ledger lock file
    (`OPPAL_LEDGER_LOCK`) on an SMB share can't safely take two writers.
  - **Off-box ledger copy:** a proposal to keep a copy of the hash chain in
    immutable Blob storage.
- **Why:** state is the hardest part of moving this app. The single-replica
  limit is the main constraint a reviewer must know about.
- **Sources:** the list of writable stores comes from the `run_all_tests.sh`
  redirections described in `CLAUDE.md` (`OPPAL_DB_PATH`, `OPPAL_*_DB`,
  `OPPAL_AUDIT_LOG`, `OPPAL_LEDGER_HEAD`, `OPPAL_BRAIN_DIR`).

### Slide 7: What the code would need

- **What:** six changes, each with where it lands and a rough size:

  | Change | Where |
  |---|---|
  | Validate Entra ID tokens | `app/security/auth.py` |
  | Let Key Vault environment variables win over `settings.json` | `app/config.py` |
  | Use a managed identity for Azure OpenAI instead of an `api-key` header | `app/llm/base.py` |
  | Port SQLite date functions in Brain SQL to Databricks SQL | `domains/*/policy_rules.md` |
  | Copy each ledger entry to immutable Blob storage | `app/trust/ledger_v2.py` |
  | Run `run_all_tests.sh` in CI before an image is pushed | CI pipeline |

  The slide closes with one rule: don't trust Container Apps' sign-in headers.
- **Why each change is needed:**
  - **Config precedence:** `config.apply_llm_env()` writes values from
    `settings.json` into the environment at startup. It sets `LLM_PROVIDER`
    unconditionally, so a value injected from Key Vault would be overwritten.
  - **Managed identity:** `AzureOpenAIProvider` authenticates with an
    `api-key` header.
  - **SQL port:** `medicare_sales/policy_rules.md` uses SQLite date functions.
  - **Header rule:** `_user()` has no header fallback by design. Trusting
    Container Apps' built-in sign-in headers would undo that.
- **Sizes:** Small and Medium are estimates. Nothing was measured.

### Assumptions in the Azure deck

None of these come from the repository. They are design choices to challenge:

- The region (West Europe) is a sample.
- Front Door Premium with a WAF policy is the edge, reaching Container Apps
  over Private Link. Application Gateway is the alternative.
- The network is hub-and-spoke, with egress through Azure Firewall and an FQDN
  allow-list.
- Users sign in with Entra ID and MFA. Officers elevate through Privileged
  Identity Management, and Entra groups map to OpPal roles and line-of-business
  scopes.
- Managed identity is used for Key Vault, Azure Files and Container Registry.
- Azure Policy denies public endpoints and unencrypted storage.
- Defender for Cloud and Sentinel are in place, and Communication Services
  sends email over SMTP.
- Databricks SQL is the warehouse. Snowflake on Azure would also fit, because
  a Snowflake connector exists.
- The immutable Blob ledger copy and the move to PostgreSQL for scale-out are
  proposals.
- The code-change sizes are estimates.

---

## Open questions for reviewers

1. **Private Link origin:** Front Door Private Link to Container Apps needs a
   workload-profiles environment and Front Door Premium. Is that acceptable on
   cost, or should Application Gateway be the edge instead?
2. **File locking:** SQLite on Azure Files over SMB has file-locking caveats.
   Should the state share use NFS, or should the stores move to PostgreSQL
   before go-live rather than after?
3. **Warehouse:** should the first Azure release keep the bundled SQLite
   warehouse on the share (the demo setup) and add Databricks later?
4. **Identity mapping:** who owns the mapping from Entra groups to OpPal roles
   and line-of-business scopes, and how is "two different people for the two
   officer roles" enforced in Entra?
5. **Ledger copy:** should the immutable Blob copy of the ledger be written by
   the app (a code change) or by a log pipeline reading container output?
6. **Deck 1 omissions:** is it acceptable for the high-level diagram to leave
   out the semantic cache, review queue and notification bus?
