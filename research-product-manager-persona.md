# Research Report: Adding Product Manager AI Persona to Tix Kanban

## Executive Summary

This report analyzes the feasibility and implementation approach for adding a Product Manager AI persona to the Tix Kanban project. The Product Manager persona will be designed to understand system architecture through the knowledge base, discuss tickets and solutions with users in chat, create tickets based on conversations, and develop action plans. The implementation will leverage existing persona infrastructure and integrate with the chat system's action capabilities.

## Table of Contents

1. [Current Architecture Overview](#current-architecture-overview)
2. [Product Manager Persona Design](#product-manager-persona-design)
3. [Implementation Plan](#implementation-plan)
4. [Integration Points](#integration-points)
5. [Technical Considerations](#technical-considerations)
6. [Recommendations](#recommendations)

## Current Architecture Overview

### Persona System Architecture

The Tix Kanban persona system is built on several key components:

1. **Persona Storage** (`src/server/persona-storage.ts`):
   - Stores personas in `~/.tix-kanban/personas/`
   - Each persona has:
     - Basic info (name, emoji, description)
     - Specialties array
     - System prompt
     - Performance stats
     - Memory system for learning

2. **Agent Chat System** (`src/server/agent-chat.ts`):
   - Handles @mentions in chat channels
   - Processes "remember" commands
   - Can execute actions via JSON blocks
   - Currently supports `create_task` action

3. **Knowledge Base System** (`src/server/knowledge-storage.ts`):
   - Stores documentation in `~/.tix-kanban/knowledge/`
   - Supports categorization by area and topic
   - Searchable by keywords, repo, and tags
   - Uses markdown with frontmatter

### Current Personas

The system includes these default personas:
- **Bug-Fixer** (🐛): Debugging specialist
- **Developer** (👩‍💻): Full-stack developer
- **Tech-Writer** (📝): Documentation creator
- **QA-Engineer** (🧪): Quality assurance
- **Security-Reviewer** (🔒): Security specialist
- **Code-Reviewer** (🔍): PR review specialist

## Product Manager Persona Design

### Core Characteristics

**Name**: Product-Manager
**Emoji**: 📋
**Description**: Strategic product thinker who understands system architecture, creates tickets from discussions, and develops action plans
**Specialties**: ['product-planning', 'architecture', 'requirements', 'roadmap', 'ticket-creation', 'user-stories']

### Persona Prompt Design

```markdown
You are a Product Manager who bridges technical implementation with business value. Your role involves:

1. **Architecture Understanding**:
   - Deep knowledge of the system's technical architecture
   - Ability to discuss trade-offs and implementation strategies
   - Understanding of existing patterns and conventions

2. **Collaborative Planning**:
   - Engage in discussions about potential features and improvements
   - Ask clarifying questions to understand requirements fully
   - Consider technical feasibility and business impact

3. **Ticket Creation**:
   - Convert discussions into well-structured tickets
   - Write clear acceptance criteria
   - Assign appropriate personas based on task type
   - Set realistic priorities

4. **Action Planning**:
   - Create phased implementation plans
   - Identify dependencies and risks
   - Suggest iterative approaches

## Your Approach
- Be conversational and collaborative
- Ask questions before creating tickets
- Reference existing architecture when relevant
- Think about user impact and technical debt
- Suggest MVPs and iterative improvements

## Creating Tickets
When the user asks you to create tickets based on your discussion:
1. Summarize what you understood
2. Break down into logical, manageable tickets
3. Create tickets with clear titles and descriptions
4. Assign to appropriate team members
5. Set priorities based on impact and effort
```

### Integration with Knowledge Base

The Product Manager persona will need enhanced access to the knowledge base. Key integration points:

1. **Context Enhancement**: Modify `createPersonaContext` to include relevant knowledge docs
2. **Search Integration**: Allow the persona to search knowledge during conversations
3. **Architecture Awareness**: Pre-load system architecture docs into context

## Implementation Plan

### Phase 1: Basic Persona Creation

1. Add Product Manager to default personas in `initializePersonas()`
2. Implement the base prompt and characteristics
3. Test basic chat interactions

### Phase 2: Knowledge Base Integration

1. Create a knowledge search function for chat context
2. Modify `buildChatPrompt` to include relevant knowledge
3. Add architecture documents to knowledge base

### Phase 3: Enhanced Ticket Creation

1. Extend action system to support:
   - Bulk ticket creation
   - Epic/story relationships
   - Dependency tracking
2. Add conversation memory for multi-turn planning

### Phase 4: Planning Capabilities

1. Implement plan generation actions
2. Add roadmap visualization
3. Create templates for common planning scenarios

## Integration Points

### 1. Chat System Integration

The existing chat system already supports actions through JSON blocks:

```javascript
// Current action execution in agent-chat.ts
async function executeAction(
  action: ResponseAction,
  persona: Persona,
  channelId: string
): Promise<string | null>
```

We can extend this to support new actions:
- `create_epic`: Create an epic with child tasks
- `create_plan`: Generate a structured implementation plan
- `search_knowledge`: Query the knowledge base

### 2. Knowledge Context Integration

Modify the context creation to include knowledge:

```javascript
// Enhanced context creation
const relevantKnowledge = await searchKnowledgeDocs({
  keywords: extractKeywords(taskDescription),
  repo: task.repo,
  limit: 3
});

const knowledgeContext = relevantKnowledge
  .map(r => `### ${r.doc.title}\n${r.doc.description}`)
  .join('\n\n');
```

### 3. Memory System Enhancement

The Product Manager should remember:
- Previous architectural decisions
- Common patterns discussed
- User preferences for ticket structure
- Team capacity and specialties

## Technical Considerations

### 1. Token Management

Product Managers will need larger context windows:
- Architecture docs can be lengthy
- Conversation history is important
- Multiple tickets require detailed context

Recommendation: Implement smart truncation and summarization for knowledge docs.

### 2. Action Complexity

Creating multiple related tickets requires:
- Transaction-like behavior (all or nothing)
- Relationship tracking between tickets
- Validation before bulk creation

### 3. Existing Installation Updates

The system already handles adding new personas to existing installations through `initializePersonas()`. The Product Manager will be automatically added when users update.

## Recommendations

### 1. Implementation Approach

Start with a minimal viable Product Manager:
1. Basic persona with planning focus
2. Simple ticket creation from conversations
3. Manual knowledge base reference

Then iterate to add:
1. Automated knowledge search
2. Multi-ticket planning
3. Roadmap generation

### 2. Knowledge Base Preparation

Before launch, populate knowledge base with:
- System architecture overview
- API documentation
- Database schemas
- Common patterns and conventions
- Decision records

### 3. Testing Strategy

1. **Unit Tests**: Test persona creation and storage
2. **Integration Tests**: Test chat interactions and ticket creation
3. **User Testing**: Have real users interact with the PM persona

### 4. Success Metrics

Track:
- Tickets created via PM persona
- User satisfaction with generated tickets
- Accuracy of architectural understanding
- Reduction in clarification rounds

## Code Changes Summary

### Files to Modify:

1. **src/server/persona-storage.ts**:
   - Add Product Manager to default personas

2. **src/server/agent-chat.ts**:
   - Enhance `buildChatPrompt` with knowledge context
   - Add new action types for planning

3. **src/server/worker.ts**:
   - Update `createPersonaContext` calls to include knowledge

4. **New File: src/server/persona-knowledge.ts**:
   - Knowledge search utilities for personas
   - Context building helpers

## Conclusion

Adding a Product Manager AI persona to Tix Kanban is technically feasible and aligns well with the existing architecture. The persona system's flexibility allows for sophisticated behavior through prompts and actions, while the knowledge base provides the architectural context needed for informed product decisions.

The key to success will be:
1. Starting simple and iterating
2. Populating a comprehensive knowledge base
3. Designing clear action patterns for ticket creation
4. Testing with real product planning scenarios

This enhancement will transform Tix Kanban from a task management tool into an intelligent product planning assistant.