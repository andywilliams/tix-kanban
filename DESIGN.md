# Forge Architecture Design Document

**Version:** 1.0  
**Date:** 2026-03-28  
**Status:** Living Document

---

## Table of Contents

1. [Mental Model](#mental-model)
2. [Core Principles](#core-principles)
3. [Feature Interaction Map](#feature-interaction-map)
4. [Subsystem Interactions](#subsystem-interactions)
5. [Implementation Recommendations](#implementation-recommendations)
6. [Known Gaps & Integration Opportunities](#known-gaps--integration-opportunities)

---

## Mental Model

### Forge Is a Dev Team, Not a Task Runner

Forge is not just a kanban board with AI automation. It's a **simulated development team** where:

- **Personas** are specialized team members (developer, QA, code reviewer, PM)
- **Tasks** are work assignments given to team members
- **Pipelines** are standardized workflows (like SOPs for a team)
- **Chat** is the team's communication channel (Slack, but for AI)
- **Workspaces** are each persona's private desk/context space
- **Memory** is institutional knowledge (what the team has learned)
- **Budget controls** prevent runaway costs (like a project budget)

When a new feature is built, ask: **"How would a real dev team do this?"** not "How do I make the AI do X?"

---

## Core Principles

### 1. Context Is King
Every persona should have access to:
- **Board state** (what's happening across the project)
- **Workspace repos** (where the code lives)
- **Task history** (what they've done before)
- **Conversation history** (what's been discussed)
- **Knowledge base** (documented learnings)

**Current implementation:** ✅ Workspace context system (`workspace-context.ts`)

### 2. Memory Is Continuity
Personas should remember:
- **Task-specific learnings** (per-ticket decisions)
- **Cross-task patterns** (recurring issues, preferences)
- **User instructions** (how you like things done)
- **Team interactions** (what other personas said)

**Current implementation:** ✅ Session persistence (`PERSONA-SESSIONS.md`, SQLite), agent memory (`agent-memory.ts`), persona MEMORY.md files

### 3. Communication Is Collaboration
Personas should communicate:
- **With users** (chat, comments, status updates)
- **With each other** (@mentions, direct conversations)
- **Through board state** (task assignments, status changes)

**Current implementation:** ✅ Chat system (`chat-storage.ts`, `agent-chat.ts`), @mentions, team overview

### 4. Execution Has Guardrails
All AI work should be:
- **Budgeted** (token/cost limits)
- **Monitored** (status updates, streaming)
- **Recoverable** (session persistence, compaction)
- **Auditable** (activity log, database records)

**Current implementation:** ✅ Budget controls (`collaboration-budget.ts`, `token-budget.ts`), session management, activity tracking

### 5. Workflows Should Scale
As complexity grows:
- **Pipelines** orchestrate multi-stage work
- **Personas** delegate to specialists
- **Direct execution** bypasses overhead for simple tasks
- **Comment detection** auto-resolves PR feedback

**Current implementation:** ✅ Pipeline system (`pipeline-storage.ts`), PR comment resolver (`pr-comment-resolver.ts`), direct execution (`direct-execution.ts`)

---

## Feature Interaction Map

### 1. Personas (Core Identity)
**What they need to know about:**
- ✅ **Workspace context** — discovers repos, reads board state
- ✅ **Memory** — agent memory (per-user), persona MEMORY.md (cross-user)
- ✅ **Chat** — participates in conversations, responds to @mentions
- ✅ **Tasks** — assigned work, reads task context
- ✅ **Session history** — remembers previous interactions (SQLite)
- ✅ **Knowledge base** — accesses documented learnings
- ✅ **Budget** — per-persona and per-task cost limits
- ⚠️ **Pipelines** — personas should check if a task is in a pipeline and report stage progress
- ⚠️ **Direct execution results** — personas should update MEMORY.md after direct executions
- ⚠️ **Comment detection outcomes** — personas should learn from PR comment patterns

**Files:** `persona-storage.ts`, `persona-memory.ts`, `persona-conversation.ts`, `persona-yaml-loader.ts`

---

### 2. Workspaces (Private Context)
**What they interact with:**
- ✅ **Personas** — each persona has a workspace directory for files/context
- ✅ **Repos** — workspace discovers and summarizes repositories
- ✅ **Board** — workspace context includes board summary
- ✅ **Knowledge** — workspace can query knowledge base
- ⚠️ **Pipelines** — workspace should surface active pipeline stages
- ⚠️ **Chat** — workspace context should include recent conversations from persona's channels
- ⚠️ **Direct execution** — workspace should track quick tasks completed outside formal tickets

**Files:** `workspace-context.ts`, `persona-storage.ts` (workspace file management)

---

### 3. Pipelines (Workflow Orchestration)
**What they need to know about:**
- ✅ **Tasks** — pipeline state is attached to tasks
- ✅ **Personas** — pipelines assign stages to personas
- ⚠️ **Chat** — pipeline completion should post summary to relevant chat channel
- ⚠️ **Memory** — pipeline learnings should feed into persona MEMORY.md
- ⚠️ **Budget** — pipeline total cost should aggregate stage costs
- ⚠️ **Workspace** — pipeline stages should see workspace context
- ⚠️ **Direct execution** — pipelines should support "skip to end" for simple cases

**Files:** `pipeline-storage.ts`, `worker.ts` (pipeline execution), `client/types/pipeline.ts`

---

### 4. Full-Page Chat (Team Communication Hub)
**What it interacts with:**
- ✅ **Personas** — personas join channels, respond to @mentions
- ✅ **Users** — humans chat with personas
- ✅ **Memory** — chat messages feed into agent memory
- ✅ **Session history** — chat conversation is part of session thread
- ✅ **Board summary** — chat renders board state widget
- ✅ **Knowledge base** — personas reference knowledge in responses
- ⚠️ **Pipelines** — chat should surface active pipelines and their progress
- ⚠️ **Direct execution** — chat should show "working on it" status for direct tasks
- ⚠️ **Budget** — chat should warn when approaching budget limits
- ⚠️ **Comment detection** — chat should notify when PR comments are auto-resolved
- ⚠️ **Workspace** — chat should allow quick workspace queries ("show me our repos")

**Files:** `chat-storage.ts`, `agent-chat.ts`, `streaming-chat.ts`, `ChatPanel.tsx`

---

### 5. Direct Execution (Fast Track)
**What it interacts with:**
- ✅ **Personas** — persona spawns sub-agent for direct work
- ✅ **Chat** — execution status is posted to chat
- ✅ **Tasks** — offers retrospective ticket creation
- ⚠️ **Memory** — execution outcomes should update persona MEMORY.md
- ⚠️ **Budget** — direct execution cost should count toward daily/persona limits
- ⚠️ **Workspace** — direct execution should update workspace context cache
- ⚠️ **Pipelines** — direct execution should optionally trigger a pipeline for complex work
- ⚠️ **Session history** — direct execution should be recorded in persona session thread

**Files:** `direct-execution.ts`, `agent-chat.ts` (intent detection)

---

### 6. Comment Detection (PR Auto-Resolution)
**What it interacts with:**
- ✅ **GitHub** — fetches unresolved PR comments
- ✅ **Personas** — Code Reviewer and QA personas handle comment resolution
- ✅ **Tasks** — comment resolution can create tasks or update existing ones
- ⚠️ **Chat** — comment resolution should post updates to relevant chat channels
- ⚠️ **Memory** — resolved comments should feed learnings into persona MEMORY.md
- ⚠️ **Budget** — comment resolution runs should count toward daily budget
- ⚠️ **Workspace** — comment resolver should see workspace context
- ⚠️ **Pipelines** — comment resolution could trigger a "fix-and-verify" pipeline

**Files:** `pr-comment-resolver.ts`, `worker.ts` (cron scheduler)

---

### 7. Budget Controls (Cost Management)
**What they enforce across:**
- ✅ **Direct execution** — tracks cost per sub-agent spawn
- ✅ **Worker runs** — tracks cost per task execution
- ✅ **Chat** — tracks cost per persona response
- ✅ **Pipelines** — tracks cost per pipeline stage
- ✅ **Comment detection** — tracks cost per PR comment resolution run
- ✅ **Daily limit** — global $10/day cap
- ✅ **Per-task limit** — $2/task cap
- ✅ **Per-persona limit** — $0.50/persona cap
- ⚠️ **Workspace queries** — budget should account for workspace context building
- ⚠️ **Memory compaction** — budget should track compaction costs
- ⚠️ **Pipeline orchestration** — budget should prevent starting new pipeline stages when near limit

**Files:** `collaboration-budget.ts`, `token-budget.ts`

---

### 8. LGTM Integration (Code Review Tool)
**What it interacts with:**
- ✅ **Personas** — Code Reviewer and QA personas use LGTM
- ✅ **Tasks** — LGTM reviews are triggered by task keywords and PR links
- ✅ **GitHub** — LGTM analyzes PRs via GitHub integration
- ⚠️ **Chat** — LGTM results should be shareable in chat
- ⚠️ **Memory** — LGTM findings should feed into persona learnings
- ⚠️ **Pipelines** — LGTM could be a pipeline stage ("code-review" stage)
- ⚠️ **Budget** — LGTM runs should count toward persona budget

**Files:** `docs/lgtm-integration.md`, persona definitions (Code-Reviewer, QA-Engineer)

---

### 9. Session Persistence (Conversation Continuity)
**What it tracks for:**
- ✅ **Personas** — each persona has one active session thread
- ✅ **Tasks** — task context is added as user messages
- ✅ **Chat** — chat messages are part of session history
- ✅ **Token counting** — session tracks total token usage
- ✅ **Compaction** — auto-summarizes old messages when approaching limit
- ⚠️ **Pipelines** — pipeline stage transitions should be recorded in session
- ⚠️ **Direct execution** — direct execution requests should be in session thread
- ⚠️ **Comment detection** — PR comment resolution should be in session thread
- ⚠️ **Memory sync** — session compaction summaries should feed into MEMORY.md

**Files:** `services/sessionService.ts`, `docs/PERSONA-SESSIONS.md`, SQLite database

---

### 10. Knowledge Base (Documented Learnings)
**What it feeds into:**
- ✅ **Chat** — personas reference knowledge in responses
- ✅ **Workspace context** — knowledge is included in workspace summaries
- ⚠️ **Memory** — knowledge articles should be created from MEMORY.md entries
- ⚠️ **Pipelines** — pipeline templates should reference relevant knowledge articles
- ⚠️ **Direct execution** — knowledge should inform quick task execution
- ⚠️ **Comment detection** — common PR issues should become knowledge articles

**Files:** `knowledge-storage.ts`, `persona-knowledge.ts`

---

## Subsystem Interactions

### High-Priority Integration Paths

#### 1. **Direct Execution → Memory**
**Gap:** Direct execution results are not automatically written to persona MEMORY.md.

**Why it matters:** Personas lose context about work done outside formal tickets.

**Implementation:**
```typescript
// In direct-execution.ts, after executeDirectly() succeeds:
if (result.success && result.prUrl) {
  await updatePersonaMemory(persona.id, {
    category: 'direct-execution',
    content: `Completed: ${intent.extractedTask.title}`,
    context: { prUrl: result.prUrl, taskDescription: intent.extractedTask.description },
    timestamp: new Date()
  });
}
```

**Files to modify:** `direct-execution.ts`, `persona-memory.ts`

---

#### 2. **Pipelines → Chat**
**Gap:** Pipeline completion does not post a summary to chat.

**Why it matters:** Users and other personas don't see pipeline progress without checking the board.

**Implementation:**
```typescript
// In pipeline-storage.ts or worker.ts, after pipeline completes:
if (pipelineState.status === 'completed') {
  await addMessage(
    getRelevantChannelId(task),
    persona.name,
    'persona',
    `✅ Pipeline "${pipeline.name}" completed for task "${task.title}". ${stagesSummary}`
  );
}
```

**Files to modify:** `pipeline-storage.ts`, `worker.ts`, `chat-storage.ts`

---

#### 3. **Comment Detection → Chat**
**Gap:** PR comment auto-resolution does not notify chat channels.

**Why it matters:** Team doesn't know when PR feedback is addressed without checking GitHub.

**Implementation:**
```typescript
// In pr-comment-resolver.ts, after resolving comments:
await addMessage(
  getRelevantChannelId(task),
  'Code-Reviewer',
  'persona',
  `🔧 Auto-resolved ${resolvedCount} comments on PR #${prNumber}`
);
```

**Files to modify:** `pr-comment-resolver.ts`, `chat-storage.ts`

---

#### 4. **Budget → Direct Execution & Comment Detection**
**Gap:** Direct execution and comment detection may not enforce budget checks before spawning sub-agents.

**Why it matters:** These features can silently burn through daily budget.

**Implementation:**
```typescript
// In direct-execution.ts, before spawnSubAgent():
const budgetCheck = await checkAndRecordUsage(
  persona.id,
  selectedModel,
  estimatedInputTokens,
  estimatedOutputTokens,
  undefined, // no taskId for direct execution
  { dryRun: true }
);
if (!budgetCheck.allowed) {
  throw new Error(`Budget exceeded: ${budgetCheck.reason}`);
}
```

**Files to modify:** `direct-execution.ts`, `pr-comment-resolver.ts`, `collaboration-budget.ts`

---

#### 5. **Workspace → Pipelines**
**Gap:** Workspace context does not surface active pipelines.

**Why it matters:** Personas don't know which tasks are in pipelines when making decisions.

**Implementation:**
```typescript
// In workspace-context.ts, add to BoardSummary:
interface BoardSummary {
  // ... existing fields
  activePipelines: Array<{
    taskId: string;
    pipelineName: string;
    currentStage: string;
    progress: string; // e.g., "2/4 stages complete"
  }>;
}
```

**Files to modify:** `workspace-context.ts`, `pipeline-storage.ts`

---

#### 6. **Session History → Memory Sync**
**Gap:** Session compaction summaries are not automatically written to MEMORY.md.

**Why it matters:** When sessions are compacted, learnings are lost if not persisted to long-term memory.

**Implementation:**
```typescript
// In sessionService.ts, after compaction:
await updatePersonaMemory(persona.id, {
  category: 'session-compaction',
  content: compactionSummary,
  context: { messagesCompacted, tokensFreed },
  timestamp: new Date()
});
```

**Files to modify:** `services/sessionService.ts`, `persona-memory.ts`

---

### Medium-Priority Integration Paths

#### 7. **Knowledge Base ← Memory**
Periodic export of high-value MEMORY.md entries to knowledge articles.

#### 8. **Pipelines → LGTM**
LGTM code review as a pipeline stage.

#### 9. **Chat → Budget Warnings**
Proactive chat notifications when approaching budget limits.

#### 10. **Direct Execution → Pipelines**
Optionally convert direct execution into a pipeline for complex work.

---

## Implementation Recommendations

### Phase 1: Critical Integrations (High ROI, Low Effort)
**Goal:** Make existing features aware of each other.

1. **Direct Execution → Memory** (1 hour)
   - Add memory update call after successful execution
   - Test: verify MEMORY.md is updated after direct execution

2. **Budget → Direct Execution** (1 hour)
   - Add budget check before spawning sub-agent
   - Test: verify budget enforcement blocks execution when limit hit

3. **Pipelines → Chat** (2 hours)
   - Add chat notification on pipeline completion
   - Test: verify chat message appears when pipeline finishes

4. **Comment Detection → Chat** (1 hour)
   - Add chat notification after PR comment resolution
   - Test: verify chat message appears after comment resolver runs

**Total time:** ~5 hours  
**Impact:** Major improvement in feature coherence

---

### Phase 2: Context Enrichment (Moderate Effort, High Value)
**Goal:** Give features deeper awareness of system state.

5. **Workspace → Pipelines** (2 hours)
   - Add active pipelines to workspace context
   - Update BoardSummary interface
   - Test: verify personas see pipeline state in workspace context

6. **Session History → Memory Sync** (3 hours)
   - Add memory update after session compaction
   - Test: verify MEMORY.md is updated after compaction runs

7. **Budget → Comment Detection** (1 hour)
   - Add budget check before comment resolver runs
   - Test: verify budget enforcement blocks comment resolution when limit hit

**Total time:** ~6 hours  
**Impact:** Personas have richer context for decision-making

---

### Phase 3: Advanced Workflows (Higher Effort, Transformative)
**Goal:** Enable new collaboration patterns.

8. **Knowledge Base ← Memory** (4 hours)
   - Build automatic knowledge article creation from MEMORY.md
   - Add UI for promoting memories to knowledge
   - Test: verify memories become searchable knowledge articles

9. **Pipelines → LGTM** (3 hours)
   - Add LGTM as a built-in pipeline stage
   - Integrate with existing Code-Reviewer persona
   - Test: verify code review pipeline stage runs LGTM and posts results

10. **Chat → Budget Warnings** (2 hours)
    - Add proactive chat warnings at 50%, 75%, 90% budget thresholds
    - Test: verify warnings appear in chat before hitting limits

**Total time:** ~9 hours  
**Impact:** Forge becomes a cohesive AI team, not just independent features

---

## Known Gaps & Integration Opportunities

### 1. **Personas Don't See Pipeline State**
**Current state:** Personas process tasks without knowing if they're part of a pipeline.

**Desired state:** Personas should:
- Check if task is in a pipeline before starting work
- Report progress to pipeline stages
- Skip stages that don't apply (e.g., direct execution in simple pipelines)

**Implementation:** Add `pipelineState` to task context in `buildTaskContext()`.

---

### 2. **Direct Execution Doesn't Update Memory**
**Current state:** Quick tasks completed via direct execution vanish from persona context.

**Desired state:** Direct execution outcomes are recorded in persona MEMORY.md.

**Implementation:** Add memory update in `executeDirectly()` after success.

---

### 3. **Comment Detection Runs in Silence**
**Current state:** PR comments are auto-resolved without notifying chat channels.

**Desired state:** Comment resolution posts updates to relevant chat channels.

**Implementation:** Add `addMessage()` call in `pr-comment-resolver.ts`.

---

### 4. **Budget Limits Don't Cover All Execution Paths**
**Current state:** Direct execution and comment detection may bypass budget checks.

**Desired state:** All AI work enforces budget limits before execution.

**Implementation:** Add `checkAndRecordUsage()` calls before spawning sub-agents.

---

### 5. **Session Compaction Loses Learnings**
**Current state:** When sessions are compacted, summaries stay in SQLite but don't feed MEMORY.md.

**Desired state:** Compaction summaries are automatically written to MEMORY.md.

**Implementation:** Add memory update in `compactSession()`.

---

### 6. **Workspace Context Is Static**
**Current state:** Workspace context is cached and doesn't include real-time pipeline progress.

**Desired state:** Workspace context includes active pipelines and their stages.

**Implementation:** Add `activePipelines` to BoardSummary in `workspace-context.ts`.

---

### 7. **Knowledge Base Is Manually Curated**
**Current state:** Knowledge articles are created by hand.

**Desired state:** High-value MEMORY.md entries automatically become knowledge articles.

**Implementation:** Add periodic export job to scan MEMORY.md and create knowledge articles.

---

### 8. **Chat Doesn't Show Budget Status**
**Current state:** Users hit budget limits without warning.

**Desired state:** Chat shows proactive warnings at 50%, 75%, 90% thresholds.

**Implementation:** Add budget check in chat response generation with warning messages.

---

### 9. **Pipelines Are Invisible to Chat**
**Current state:** Users must check the board to see pipeline progress.

**Desired state:** Pipelines post updates to chat as they progress.

**Implementation:** Add chat notifications in pipeline stage transitions.

---

### 10. **LGTM Is Persona-Specific, Not Pipeline-Integrated**
**Current state:** LGTM only runs when Code Reviewer persona is assigned to a task.

**Desired state:** LGTM can be a pipeline stage for any task workflow.

**Implementation:** Add LGTM as a built-in pipeline stage in `pipeline-storage.ts`.

---

## Conclusion

Forge is transitioning from a collection of features to a **coherent AI development team**. The recommendations in this document prioritize:

1. **Feature awareness** — making systems know about each other
2. **Context richness** — giving personas full situational awareness
3. **Communication** — ensuring work is visible to users and other personas
4. **Guardrails** — enforcing budgets and preventing runaway costs

As new features are added, always ask: **"How does this fit into the team mental model?"**

---

**Next Steps:**
1. Implement Phase 1 critical integrations (~5 hours)
2. Update affected backlog tickets with cross-references
3. Add new tickets for Phase 2 and Phase 3 work
4. Revisit this document quarterly as Forge evolves

**Last Updated:** 2026-03-28
