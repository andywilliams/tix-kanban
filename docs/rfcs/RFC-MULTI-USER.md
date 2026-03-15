# RFC: Multi-User Support for Shared Workspaces

**Status:** Draft  
**Author:** Jenna (AI)  
**Created:** 2026-03-15  
**Ticket:** MMN9NXEW5R579S  

## Problem Statement

Forge (tix-kanban) is currently a single-player tool. Each installation runs independently with one human user managing tasks and personas. This creates barriers to adoption by small teams (2-5 people) who want to:

- **Share visibility** on task progress and priorities
- **Collaborate** with shared AI personas (QA, docs, deployment)
- **Attribute activity** to the correct team member
- **Track individual contributions** through personal standup views
- **Avoid duplicate work** by seeing what teammates are working on

The current file-based storage (`~/.tix-kanban/`) is fundamentally single-user and cannot be shared without complex manual synchronization or shared filesystem setups (fragile, not web-friendly).

## Goals

1. **Shared kanban board** — All team members see the same tasks in real-time
2. **GitHub OAuth authentication** — Leverage existing GitHub accounts (all developers have them)
3. **Team-owned personas** — AI assistants work for the whole team, not individuals
4. **Activity attribution** — Track who created, modified, or completed each task
5. **Per-user standup views** — Each team member sees their own daily progress
6. **Simple permissions** — Owner (admin) vs. Member roles, no complex RBAC
7. **Team invitations** — Owner invites teammates via email/GitHub username
8. **Migration path** — Existing single-user installs upgrade to team-of-one seamlessly

## Non-Goals

1. **Large organizations** — Targeting 2-5 person teams, not 50+ engineers
2. **Granular permissions** — No per-task or per-persona ACLs (owner/member is enough)
3. **Multi-team support** — One workspace = one team (no nested teams or cross-team sharing)
4. **Real-time collaborative editing** — Optimistic locking prevents conflicts, but no Figma-style co-editing
5. **Third-party auth** — GitHub OAuth only (no Google, email/password, SSO)
6. **On-premise deployment** — Assumes cloud-hosted Forge instances (SQLite + local files won't scale)

## Detailed Design

### 1. Data Model Changes

#### New Entities

```typescript
interface Team {
  id: string;                   // UUID
  name: string;                 // Team name (editable)
  createdAt: Date;
  updatedAt: Date;
  ownerId: string;              // User who created the team
  githubOrg?: string;           // Optional: link to GitHub org
}

interface User {
  id: string;                   // UUID
  githubId: number;             // GitHub user ID (from OAuth)
  githubUsername: string;       // GitHub login
  email: string;                // Primary GitHub email
  name: string;                 // Display name
  avatarUrl: string;            // GitHub avatar
  createdAt: Date;
  lastLoginAt: Date;
}

interface TeamMember {
  id: string;                   // UUID
  teamId: string;               // FK to Team
  userId: string;               // FK to User
  role: 'owner' | 'member';
  invitedBy: string;            // User ID who sent invite
  joinedAt: Date;
  status: 'active' | 'invited' | 'removed';
}

interface Invitation {
  id: string;                   // UUID
  teamId: string;
  invitedEmail: string;         // Email or GitHub username
  invitedBy: string;            // User ID
  token: string;                // Secret token for invite link
  expiresAt: Date;
  createdAt: Date;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}
```

#### Modified Entities

All existing entities gain team/user fields:

```typescript
interface Task {
  // ... existing fields ...
  teamId: string;               // NEW: Which team owns this task
  createdBy: string;            // NEW: User ID (was implicit single-user)
  assignedTo?: string;          // CHANGED: Now User ID (was email/name string)
  persona?: string;             // UNCHANGED: Persona ID (team-shared)
}

interface Persona {
  // ... existing fields ...
  teamId: string;               // NEW: Which team owns this persona
  createdBy: string;            // NEW: User ID who created it
}

interface ActivityLog {
  // ... existing fields ...
  teamId: string;               // NEW: For scoping queries
  actorId: string;              // CHANGED: User ID or Persona ID
  actorType: 'user' | 'persona'; // NEW: Distinguish human vs AI
}

interface ChatChannel {
  // ... existing fields ...
  teamId: string;               // NEW: Scope channels to team
}

interface Report {
  // ... existing fields ...
  teamId: string;               // NEW: Scope reports to team
  authorId: string;             // NEW: User ID or Persona ID
}

interface KnowledgeDoc {
  // ... existing fields ...
  teamId: string;               // NEW: Scope knowledge to team
  authorId: string;             // NEW: User ID who added it
}
```

### 2. Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. User visits forge.example.com                           │
│     → Redirect to /auth/login if not authenticated          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  2. Click "Sign in with GitHub"                             │
│     → OAuth flow: GitHub → Callback → Exchange code         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  3. Backend receives GitHub token                           │
│     → Fetch user profile (id, username, email, avatar)      │
│     → Check if user exists in DB                            │
│       - Existing user: Update lastLoginAt                   │
│       - New user: Create User record                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Check team membership                                   │
│     → Query TeamMember where userId = user.id               │
│       - Has team: Redirect to /board                        │
│       - No team: Redirect to /onboarding                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  5. Onboarding (first-time users)                           │
│     → Option A: Create new team (becomes owner)             │
│     → Option B: Join via invite link                        │
└─────────────────────────────────────────────────────────────┘
```

**Session Management:**
- JWT tokens stored in HTTP-only cookies
- Payload: `{ userId, teamId, role, exp }`
- Refresh tokens for long-lived sessions (30-day expiry)
- CSRF protection via same-site cookies

### 3. Storage Migration

**Current:** File-based storage in `~/.tix-kanban/`

**Target:** Database-backed storage (PostgreSQL or SQLite with multi-user locking)

**Migration Strategy:**

1. **Backwards compatibility:** File-based mode still works for local dev
2. **Database mode:** Enable via `DATABASE_URL` env var
3. **Migration tool:** `forge migrate-to-team` command:
   - Reads existing `~/.tix-kanban/` files
   - Creates Team (name from git config or hostname)
   - Creates User (from GitHub auth or local git user)
   - Sets user as Owner
   - Imports all tasks, personas, reports with teamId/userId
   - Backs up original files to `~/.tix-kanban.backup/`

**Example migration:**

```bash
# User runs migration
$ forge migrate-to-team --github-token ghp_xxx

→ Found 47 tasks, 3 personas, 12 reports
→ Creating team "Andy's Workspace"
→ Authenticating with GitHub (andywilliams)
→ Importing tasks... ✓
→ Importing personas... ✓
→ Importing reports... ✓
→ Backup saved to ~/.tix-kanban.backup/
→ Database URL: postgresql://localhost/forge_andywilliams
→ Migration complete! Run `forge server` to start.
```

### 4. API Changes

#### New Endpoints

```typescript
// Teams
POST   /api/teams                  // Create new team
GET    /api/teams/:id              // Get team details
PATCH  /api/teams/:id              // Update team name/settings
DELETE /api/teams/:id              // Delete team (owner only)

// Team Members
GET    /api/teams/:id/members      // List team members
DELETE /api/teams/:id/members/:userId // Remove member (owner only)
PATCH  /api/teams/:id/members/:userId // Change role (owner only)

// Invitations
POST   /api/teams/:id/invites      // Create invite (owner only)
GET    /api/teams/:id/invites      // List pending invites
DELETE /api/teams/:id/invites/:id  // Revoke invite (owner only)
POST   /api/invites/:token/accept  // Accept invite (public, no auth)

// Users
GET    /api/users/me               // Current user profile
PATCH  /api/users/me               // Update profile
GET    /api/users/:id              // Get user by ID (team-scoped)

// Auth
GET    /auth/github                // Start GitHub OAuth flow
GET    /auth/github/callback       // OAuth callback
POST   /auth/logout                // Clear session
GET    /auth/status                // Check if authenticated
```

#### Modified Endpoints

All existing endpoints now require:
- **Authentication:** Valid JWT in cookie
- **Team scoping:** All queries filtered by `teamId` from token
- **Permission checks:** Some actions restricted to owners

```typescript
// Before: No auth, reads ~/.tix-kanban/
GET /api/tasks

// After: Requires auth, scoped to user's team
GET /api/tasks
→ WHERE teamId = :teamId

// Before: No permission check
DELETE /api/personas/:id

// After: Owner-only for shared personas
DELETE /api/personas/:id
→ IF persona.teamId = user.teamId AND user.role = 'owner'
```

### 5. Real-Time Sync

**Approach:** WebSocket + polling fallback

**WebSocket Events:**

```typescript
// Client → Server
{
  type: 'subscribe',
  channel: 'team:abc123',  // teamId
}

// Server → Client (broadcast to team)
{
  type: 'task:created',
  data: { taskId: 'xyz', title: '...', createdBy: { name: 'Andy', avatar: '...' } }
}

{
  type: 'task:updated',
  data: { taskId: 'xyz', changes: { status: 'in-progress' }, updatedBy: { name: 'Alice' } }
}

{
  type: 'task:deleted',
  data: { taskId: 'xyz', deletedBy: { name: 'Bob' } }
}

{
  type: 'persona:working',
  data: { taskId: 'xyz', personaId: 'qa', personaName: 'QA Bot', status: 'working' }
}
```

**Polling Fallback:**
- If WebSocket disconnects, poll `GET /api/sync?since=<timestamp>`
- Returns all changes since last sync
- Client merges changes into local state

**Conflict Resolution:**
- **Last-write-wins** with optimistic locking
- Each write includes `If-Match: <version>` header (ETag)
- Server rejects stale writes → client refetches and retries
- UI shows visual feedback: "Alice updated this task. Reload?"

### 6. Per-User Standup Views

**Current:** Single standup file in `~/.tix-kanban/standups/`

**After:** User-scoped standups

```typescript
interface Standup {
  id: string;
  teamId: string;
  userId: string;               // NEW: Which user's standup
  date: string;                 // YYYY-MM-DD
  yesterday: string[];          // Task IDs completed
  today: string[];              // Task IDs in progress
  blockers: string[];
  notes?: string;
  createdAt: Date;
}

// API
GET    /api/standups/me?date=2026-03-15  // My standup for date
POST   /api/standups                     // Create/update my standup
GET    /api/standups?date=2026-03-15     // Team's standups for date
```

**Standup Generation:**
- Each user has their own scheduled standup job
- Personas can generate standups on behalf of users (opt-in setting)
- UI shows "Team Standup" view with all members' updates

### 7. Permissions Model

**Two roles:** Owner, Member

| Action                        | Owner | Member |
|-------------------------------|-------|--------|
| View tasks                    | ✅    | ✅     |
| Create/edit tasks             | ✅    | ✅     |
| Delete tasks                  | ✅    | ❌     |
| Assign tasks                  | ✅    | ✅     |
| Create personas               | ✅    | ✅     |
| Edit own personas             | ✅    | ✅     |
| Edit team personas            | ✅    | ❌     |
| Delete personas               | ✅    | ❌     |
| Invite team members           | ✅    | ❌     |
| Remove team members           | ✅    | ❌     |
| Change member roles           | ✅    | ❌     |
| Edit team settings            | ✅    | ❌     |
| Delete team                   | ✅    | ❌     |
| View reports/knowledge        | ✅    | ✅     |
| Create reports/knowledge      | ✅    | ✅     |
| Delete reports/knowledge      | ✅    | ❌     |

**Persona Ownership:**
- Personas created by a user are "owned" by that user
- Owner can delete/modify any persona
- Members can only modify personas they created
- Team-shared personas (QA, Docs, Deploy) marked as `isShared: true`

### 8. Activity Attribution

**Before:** `actor: string` (freeform name)

**After:** `actorId + actorType`

```typescript
interface ActivityLog {
  id: string;
  taskId: string;
  teamId: string;               // NEW
  type: 'status_change' | 'pr_created' | 'assignment_changed' | ...;
  description: string;
  actorId: string;              // User ID or Persona ID
  actorType: 'user' | 'persona'; // NEW
  timestamp: Date;
  metadata?: Record<string, any>;
}
```

**UI Display:**

```
[Avatar] Andy moved task to In Progress (2 hours ago)
[Bot Icon] QA Persona created PR #47 (1 hour ago)
[Avatar] Alice added comment "LGTM" (30 min ago)
```

**Querying:**
```typescript
// All activity by user Andy
SELECT * FROM activity_log 
WHERE actorId = 'user-andy-123' AND actorType = 'user'

// All activity by QA persona
SELECT * FROM activity_log 
WHERE actorId = 'persona-qa' AND actorType = 'persona'

// Team activity feed
SELECT * FROM activity_log 
WHERE teamId = 'team-abc' 
ORDER BY timestamp DESC 
LIMIT 50
```

## Security Considerations

### 1. Authentication

- **GitHub OAuth only** (no passwords to manage)
- **JWT tokens** stored in HTTP-only, secure, same-site cookies
- **Token expiry:** 24 hours (access), 30 days (refresh)
- **Session invalidation** on logout or role change

### 2. Authorization

- **All API calls** check `user.teamId` matches requested resource
- **Owner-only actions** gated by role check
- **No cross-team data leakage** (all queries scoped by teamId)

### 3. Invite Links

- **Cryptographically random tokens** (32 bytes, base64)
- **Expiry:** 7 days default (configurable)
- **Single use:** Token invalidated on accept
- **Revocable:** Owner can revoke pending invites

### 4. Data Privacy

- **Team isolation:** Teams cannot see each other's data
- **GitHub scope:** Request minimal permissions (`read:user`, `user:email`)
- **No GitHub write access:** Forge doesn't modify user's GitHub repos via OAuth
- **Persona API keys:** Stored encrypted, team-scoped (can't be used across teams)

### 5. Rate Limiting

- **API rate limits:** 100 req/min per user, 500 req/min per team
- **Invite creation:** 10 invites/day per team (prevent spam)
- **WebSocket connections:** Max 5 concurrent connections per user

## Rollout Plan

### Phase 1: Foundation (Week 1-2)

- [ ] Database schema migration (PostgreSQL support)
- [ ] User/Team/TeamMember/Invitation models
- [ ] GitHub OAuth integration
- [ ] JWT session management
- [ ] Migration tool (`forge migrate-to-team`)

### Phase 2: Core Features (Week 3-4)

- [ ] Team-scoped task queries
- [ ] Activity attribution (user/persona tracking)
- [ ] Invitation flow (create, send, accept)
- [ ] Permission checks (owner vs. member)
- [ ] Team settings UI

### Phase 3: Real-Time Sync (Week 5-6)

- [ ] WebSocket server setup
- [ ] Task update broadcasting
- [ ] Optimistic locking (ETag-based)
- [ ] Polling fallback
- [ ] Conflict resolution UI

### Phase 4: Polish & Testing (Week 7-8)

- [ ] Per-user standup views
- [ ] Team activity feed
- [ ] User profile pages
- [ ] Onboarding flow
- [ ] E2E tests for multi-user scenarios
- [ ] Migration testing (single → team)

### Phase 5: Beta (Week 9-10)

- [ ] Deploy to staging
- [ ] Beta testing with 3-5 real teams
- [ ] Performance tuning (DB indexes, query optimization)
- [ ] Security audit
- [ ] Documentation update

### Phase 6: Launch (Week 11+)

- [ ] Production deployment
- [ ] Migration guide for existing users
- [ ] Announcement & changelog
- [ ] Monitor metrics (active teams, invite acceptance rate)

## Open Questions

1. **Database choice:** PostgreSQL (scalable) vs. SQLite (simpler)? 
   - **Recommendation:** Start with PostgreSQL for real-time WebSocket support
   
2. **Invite method:** Email link vs. GitHub username lookup?
   - **Recommendation:** Both (email for external, @username for GitHub users)
   
3. **Persona sharing:** Should personas be team-owned or user-owned by default?
   - **Recommendation:** User-owned by default, with "Share with team" toggle
   
4. **Task assignment:** Auto-assign to creator vs. explicit assignment required?
   - **Recommendation:** Auto-assign to creator, can reassign later
   
5. **Standups:** Auto-generate for all users or opt-in?
   - **Recommendation:** Opt-in per user (privacy-friendly)

## Success Metrics

1. **Adoption:** 50+ teams using multi-user mode within 3 months
2. **Invite acceptance:** >70% of invites accepted within 7 days
3. **Activity:** Average 3+ active users per team
4. **Retention:** 80% of teams still active after 30 days
5. **Performance:** <100ms p95 latency for task queries
6. **Sync reliability:** <1% WebSocket disconnect rate

## Alternatives Considered

### Alternative 1: File-based sync (Git/Dropbox)

**Pros:** No database, simpler architecture  
**Cons:** Merge conflicts, no real-time sync, poor UX  
**Verdict:** Rejected (not web-friendly, unreliable)

### Alternative 2: Firebase/Supabase

**Pros:** Real-time built-in, no backend code  
**Cons:** Vendor lock-in, cost scaling, limited query flexibility  
**Verdict:** Rejected (want to self-host, avoid SaaS dependencies)

### Alternative 3: CRDTs (Conflict-free Replicated Data Types)

**Pros:** Automatic conflict resolution, offline-first  
**Cons:** Complex implementation, large state size, hard to debug  
**Verdict:** Deferred (overkill for 2-5 users, revisit if needed)

## References

- [GitHub OAuth Apps Documentation](https://docs.github.com/en/apps/oauth-apps)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [WebSocket Security](https://owasp.org/www-community/vulnerabilities/WebSocket)
- [Optimistic Locking Patterns](https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html)

---

**Next Steps:**

1. Review and approve this RFC
2. Create epic ticket for Phase 1 work
3. Break down into implementable tasks
4. Assign to engineering team or personas
5. Set target launch date (estimate: 11 weeks from start)
