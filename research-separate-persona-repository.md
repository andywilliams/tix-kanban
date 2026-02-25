# Research Report: Separating AI Persona System into Dedicated Repository

## Executive Summary

This report examines the architectural implications of extracting the AI persona system from tix-kanban into a separate repository. The proposed architecture would transform tix-kanban into a pure kanban board API, while a new dedicated persona repository would manage autonomous AI agents that interact with tix-kanban and other systems. While this separation offers benefits in modularity and flexibility, it also introduces significant complexity in deployment, coordination, and system integration.

**Key Finding**: The current integrated architecture provides a cohesive system with lower operational complexity. A separated architecture would be beneficial primarily for organizations needing multi-system agent orchestration or custom LLM deployments.

## Table of Contents

1. [Current Architecture Analysis](#current-architecture-analysis)
2. [Proposed Separated Architecture](#proposed-separated-architecture)
3. [Pros of Separation](#pros-of-separation)
4. [Cons of Separation](#cons-of-separation)
5. [Implementation Architecture](#implementation-architecture)
6. [Additional Features & Considerations](#additional-features--considerations)
7. [Recommendations](#recommendations)
8. [Conclusion](#conclusion)

## Current Architecture Analysis

### Integrated System Overview

The current tix-kanban system tightly integrates AI personas with the kanban board:

```
tix-kanban/
├── src/server/
│   ├── persona-storage.ts      # Persona management
│   ├── persona-memory.ts       # Learning & memory
│   ├── persona-mood.ts         # Mood system
│   ├── persona-achievements.ts # Gamification
│   ├── worker.ts              # Task execution
│   ├── agent-chat.ts          # Chat interactions
│   └── index.ts               # API endpoints
```

**Key Integration Points:**
1. **Direct Database Access**: Personas directly read/write tasks through storage APIs
2. **Unified Worker**: Single cron system handles all task processing
3. **Embedded Context**: Personas have immediate access to task history, comments, links
4. **Synchronized State**: Task status changes are atomic with persona actions
5. **Single Process**: Everything runs in one Node.js process

### Current Execution Model

```javascript
// Simplified current flow
async function processTask(task) {
  const persona = await getPersona(task.persona);
  const context = await createPersonaContext(persona, task);
  const result = await executeClaudeWithStdin(context.prompt);
  await updateTask(task.id, { status: 'review' });
  await updatePersonaMemory(persona, result);
}
```

## Proposed Separated Architecture

### High-Level Design

```
┌─────────────────────┐     ┌────────────────────┐
│   tix-kanban-api   │     │  persona-orchestra  │
├─────────────────────┤     ├────────────────────┤
│ • Pure REST/WS API │     │ • Agent Manager    │
│ • Task CRUD        │◄────┤ • LLM Coordinator  │
│ • Board Management │     │ • Memory System    │
│ • Webhook Events   │     │ • Multi-System Hub │
└─────────────────────┘     └────────────────────┘
         ▲                           │
         │                           ▼
         │                   ┌────────────────┐
         │                   │ External APIs  │
         └───────────────────┤ • GitHub       │
                            │ • Slack        │
                            │ • Linear       │
                            └────────────────┘
```

### Separated Repositories

1. **tix-kanban** (Kanban Board API)
   - Pure task management API
   - No AI/LLM dependencies
   - Webhook system for events
   - API authentication & rate limiting

2. **persona-orchestra** (AI Agent System)
   - Agent lifecycle management
   - LLM provider abstraction
   - Memory & learning systems
   - Multi-system integration hub

## Pros of Separation

### 1. **Architectural Flexibility**
- **Independent Scaling**: Scale AI processing separately from API
- **Technology Freedom**: Use different languages/frameworks for each system
- **Clean Boundaries**: Clear separation of concerns
- **API-First**: Forces well-defined contracts between systems

### 2. **LLM Provider Independence**
```yaml
# Example persona config
personas:
  bug-fixer:
    provider: anthropic
    model: claude-3-opus
    temperature: 0.3

  creative-writer:
    provider: openai
    model: gpt-4-turbo
    temperature: 0.9

  code-reviewer:
    provider: local
    model: codellama-70b
    endpoint: http://localhost:11434
```

### 3. **Enhanced Agent Capabilities**
- **Multi-System Orchestration**: Agents can work across tools
- **Custom Scheduling**: Per-agent cron expressions and triggers
- **Resource Management**: CPU/memory limits per agent
- **Parallel Processing**: Multiple agents on different tasks

### 4. **Deployment Options**
```bash
# Deploy agents separately
docker run persona-orchestra \
  --tix-kanban-url=https://api.kanban.company.com \
  --github-token=$GITHUB_TOKEN \
  --slack-token=$SLACK_TOKEN
```

### 5. **Development Benefits**
- **Isolated Testing**: Test AI behavior without full system
- **Faster Iteration**: Update agents without API changes
- **Team Specialization**: AI team vs API team
- **Versioning Independence**: Version systems separately

## Cons of Separation

### 1. **Increased Complexity**
- **Distributed System**: Network failures, eventual consistency
- **Deployment Coordination**: Two systems to deploy/monitor
- **Debugging Difficulty**: Traces span multiple services
- **State Synchronization**: Race conditions possible

### 2. **Performance Overhead**
```javascript
// Current: Direct database access
const task = await getTask(taskId);

// Separated: HTTP round trips
const response = await fetch(`${API_URL}/api/tasks/${taskId}`);
const task = await response.json();
```

### 3. **Development Overhead**
- **API Maintenance**: Versioning, backwards compatibility
- **Double Documentation**: API docs + agent docs
- **Integration Testing**: Complex test environments
- **Local Development**: Need both systems running

### 4. **Operational Challenges**
- **Monitoring**: Two systems to monitor
- **Logging**: Distributed log aggregation needed
- **Security**: Additional attack surface
- **Cost**: Potentially higher infrastructure costs

### 5. **Feature Implementation Complexity**
Example: Adding task attachments
- Current: Single PR, atomic change
- Separated: Coordinate API changes, agent updates, compatibility

## Implementation Architecture

### Tix-Kanban API Changes

```typescript
// New webhook system
interface WebhookEvent {
  type: 'task.created' | 'task.updated' | 'task.completed';
  taskId: string;
  changes?: Partial<Task>;
  timestamp: Date;
}

// API authentication for agents
interface AgentCredentials {
  agentId: string;
  apiKey: string;
  permissions: string[];
}
```

### Persona Orchestra Architecture

```typescript
// Core agent manager
class AgentOrchestrator {
  private agents: Map<string, Agent>;
  private llmProviders: Map<string, LLMProvider>;
  private systemConnectors: Map<string, SystemConnector>;

  async spawnAgent(config: AgentConfig): Promise<Agent> {
    const agent = new Agent({
      persona: await this.loadPersona(config.personaId),
      llm: this.llmProviders.get(config.provider),
      systems: this.bindSystems(config.systems),
      schedule: config.schedule
    });

    this.agents.set(agent.id, agent);
    return agent;
  }
}

// Agent definition
class Agent {
  async processTask(taskId: string): Promise<void> {
    const task = await this.systems.tixKanban.getTask(taskId);
    const context = await this.buildContext(task);
    const response = await this.llm.complete(context);
    await this.executeActions(response.actions);
    await this.updateMemory(task, response);
  }

  async checkSystems(): Promise<void> {
    // Poll multiple systems for work
    const tasks = await Promise.all([
      this.systems.tixKanban.getAssignedTasks(this.id),
      this.systems.github.getAssignedIssues(this.id),
      this.systems.slack.getUnreadMentions(this.id)
    ]);
    // Process all work items
  }
}
```

### Communication Patterns

1. **Webhook-Driven** (Push)
```javascript
// Tix-kanban sends webhook
POST https://persona-orchestra.com/webhook
{
  "event": "task.assigned",
  "taskId": "task-123",
  "assignee": "bug-fixer"
}
```

2. **Polling-Based** (Pull)
```javascript
// Agent polls for work
async function agentPollLoop() {
  while (true) {
    const tasks = await tixApi.getTasks({
      status: 'backlog',
      persona: this.personaId
    });
    for (const task of tasks) {
      await this.processTask(task);
    }
    await sleep(this.pollInterval);
  }
}
```

3. **WebSocket** (Real-time)
```javascript
// Real-time connection
const ws = new WebSocket('wss://api.tix-kanban.com/agents');
ws.on('task:assigned', async (data) => {
  await agent.processTask(data.taskId);
});
```

## Additional Features & Considerations

### 1. **Agent Marketplace**
With separated architecture, you could create:
- Shareable agent templates
- Community-contributed personas
- Paid premium agents
- Organization-specific agent libraries

### 2. **Advanced Scheduling**
```yaml
agents:
  daily-reporter:
    schedule:
      - cron: "0 9 * * 1-5"  # Weekday standups
        action: generate_standup
      - cron: "0 17 * * 5"   # Friday retrospective
        action: weekly_summary
      - trigger: "pr_merged"
        action: update_docs
```

### 3. **Resource Management**
```javascript
// Agent resource limits
const agentConfig = {
  resources: {
    maxConcurrentTasks: 3,
    maxMemoryMB: 512,
    maxExecutionTimeMs: 600000,
    rateLimits: {
      github: { requests: 100, window: '1h' },
      openai: { tokens: 1000000, window: '1d' }
    }
  }
};
```

### 4. **Multi-Tenant Support**
```javascript
// Isolated agent environments per organization
class TenantManager {
  async createTenant(org: Organization) {
    const namespace = new AgentNamespace({
      id: org.id,
      isolation: 'strict',
      resources: org.plan.resources,
      allowedLLMs: org.plan.llmProviders
    });
  }
}
```

### 5. **Observability & Debugging**
- Agent execution traces
- LLM token usage tracking
- Performance metrics per agent
- Conversation replay functionality
- Memory introspection tools

### 6. **Security Considerations**
- Agent sandboxing
- Secrets management for API keys
- Audit logs for agent actions
- Rate limiting per agent
- Permission scoping

## Recommendations

### Recommendation 1: **Maintain Integrated Architecture (Recommended)**

For most users, the current integrated architecture provides the best balance of functionality and simplicity.

**When to keep integrated:**
- Single team/organization use
- Primarily focused on task management
- Want minimal operational overhead
- Need tight integration between AI and tasks

### Recommendation 2: **Implement Modular Boundaries Within Monolith**

Create clear internal boundaries without full separation:

```typescript
// Internal modularization
tix-kanban/
├── packages/
│   ├── core/          # Task management
│   ├── api/           # REST API
│   ├── personas/      # AI system (could be extracted later)
│   └── shared/        # Common types
```

### Recommendation 3: **Consider Separation Only If:**

1. **Multi-System Orchestration Required**
   - Agents need to work across Jira, Linear, GitHub, etc.
   - Complex workflows spanning multiple tools

2. **Custom LLM Requirements**
   - Need to use local LLMs for security
   - Want to mix multiple LLM providers
   - Require specialized model fine-tuning

3. **Scale Demands It**
   - Hundreds of concurrent agents
   - Thousands of tasks per hour
   - Multi-region deployment needs

### Recommendation 4: **Incremental Approach**

If separation is needed, approach incrementally:

1. **Phase 1**: Extract persona execution to background jobs
2. **Phase 2**: Create API abstraction layer
3. **Phase 3**: Move agents to separate process
4. **Phase 4**: Full repository separation

## Conclusion

While separating the persona system into a dedicated repository offers architectural benefits and flexibility, it comes with significant complexity costs. The current integrated architecture in tix-kanban provides a cohesive, maintainable system that meets the needs of most users.

**Key Takeaways:**

1. **Separation is a significant architectural decision** with long-term implications
2. **The current architecture is well-designed** for its primary use case
3. **Modular design within the monolith** can provide many benefits without full separation
4. **Full separation is justified only for specific advanced use cases**

For tix-kanban's evolution, I recommend:
- Continue with the integrated architecture
- Improve internal modularity for future flexibility
- Consider a plugin system for custom agents
- Monitor usage patterns to identify if/when separation becomes necessary

The integrated approach keeps the system simple while remaining powerful, which aligns with tix-kanban's goal of being an effective, AI-powered task management system.