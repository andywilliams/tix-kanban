# Product Manager Persona Usage Guide

## Overview

The Product Manager persona is a strategic AI assistant that helps translate business requirements into technical tasks. It understands system architecture, facilitates planning discussions, and can create multiple related tickets based on conversations.

## How to Use

### 1. Starting a Conversation

In any chat channel, mention the Product Manager:

```
@Product-Manager I want to add a new feature for user authentication with OAuth
```

The Product Manager will engage in a conversation to understand your requirements better.

### 2. Architecture Discussions

The Product Manager has access to the knowledge base and can discuss system architecture:

```
@Product-Manager how does our current authentication system work? What would be the best way to add OAuth support?
```

### 3. Creating Tickets from Discussions

After discussing requirements, you can ask the PM to create tickets:

```
@Product-Manager based on our discussion, can you create the necessary tickets for implementing OAuth?
```

The Product Manager will:
- Summarize the understanding from the conversation
- Break down the work into logical tickets
- Assign appropriate team members
- Set priorities based on dependencies
- Include acceptance criteria

### 4. Multi-Phase Planning

For larger features, the PM can create phased implementation plans:

```
@Product-Manager let's plan a phased approach for the OAuth feature. Start with Google OAuth as MVP.
```

## Example Conversation

**User**: @Product-Manager we need to improve our API rate limiting

**Product-Manager**: I'd be happy to help plan the API rate limiting improvements! Let me ask a few questions to better understand your requirements:

1. What's driving this need? Are you experiencing issues with the current system?
2. What type of rate limiting are you looking for - per user, per IP, or per API key?
3. Do you need different limits for different API endpoints?
4. Should we store rate limit data in memory or use Redis for distributed systems?

**User**: We're getting hammered by some bots. Need per-user and per-IP limits, with different rates for different endpoint types. Redis would be good for scaling.

**Product-Manager**: Great context! Based on our discussion, here's my understanding:

- Implement dual rate limiting (per-user AND per-IP)
- Different rate limits for different endpoint categories
- Use Redis for distributed rate limit tracking
- Focus on bot protection

Shall I create tickets for implementing this? I'm thinking we'd need:
1. Core rate limiting middleware
2. Redis integration
3. Configuration system for different endpoint limits
4. Monitoring and alerting
5. Documentation

**User**: Yes, please create those tickets

**Product-Manager**: I'll create a comprehensive set of tickets for the API rate limiting implementation:

```action
{"action":"create_task","title":"Design API rate limiting architecture","description":"Design the overall rate limiting system architecture\n\nRequirements:\n- Support both per-user and per-IP rate limiting\n- Different limits for endpoint categories\n- Redis-based for distributed systems\n\nDeliverables:\n- Architecture diagram\n- Rate limit strategy document\n- Redis data structure design\n- Configuration schema","assignee":"developer","priority":200,"tags":["api","architecture","rate-limiting"]}
```

```action
{"action":"create_task","title":"Implement core rate limiting middleware","description":"Build the core Express/Node.js middleware for rate limiting\n\nDependencies:\n- Architecture design must be complete\n\nTechnical Requirements:\n- Dual tracking (user + IP)\n- Configurable limits\n- Proper error responses (429 Too Many Requests)\n- Include Retry-After header\n\nAcceptance Criteria:\n- Middleware can track requests per user\n- Middleware can track requests per IP\n- Returns appropriate HTTP status codes\n- Unit tests with >90% coverage","assignee":"developer","priority":200,"tags":["api","backend","rate-limiting"]}
```

```action
{"action":"create_task","title":"Add Redis integration for rate limits","description":"Integrate Redis for distributed rate limit tracking\n\nDependencies:\n- Core middleware implementation\n\nTechnical Notes:\n- Use Redis INCR with TTL for counters\n- Handle Redis connection failures gracefully\n- Implement circuit breaker pattern\n\nAcceptance Criteria:\n- Rate limits persist across server instances\n- Graceful fallback if Redis unavailable\n- Performance tests show <5ms overhead","assignee":"developer","priority":300,"tags":["redis","backend","rate-limiting"]}
```

```action
{"action":"create_task","title":"Create rate limit configuration system","description":"Build configuration system for endpoint-specific limits\n\nRequirements:\n- Group endpoints by category (public, authenticated, admin)\n- Support runtime configuration updates\n- Default sensible limits\n\nExample config structure:\n- Public endpoints: 100 req/min\n- Authenticated: 1000 req/min\n- Admin: unlimited\n\nAcceptance Criteria:\n- Config can be loaded from file or env vars\n- Limits can be updated without restart\n- Validation prevents invalid configurations","assignee":"developer","priority":300,"tags":["configuration","rate-limiting"]}
```

```action
{"action":"create_task","title":"Add rate limit monitoring and alerts","description":"Implement monitoring for rate limit violations\n\nRequirements:\n- Track rate limit hits by endpoint\n- Alert on suspicious patterns\n- Dashboard for visualization\n\nAcceptance Criteria:\n- Metrics exported to monitoring system\n- Alerts for >1000 violations/hour from single IP\n- Dashboard shows top limited IPs/users","assignee":"developer","priority":400,"tags":["monitoring","security","rate-limiting"]}
```

```action
{"action":"create_task","title":"Document rate limiting system","description":"Create comprehensive documentation for the rate limiting system\n\nDocumentation needed:\n- API consumer guide\n- Rate limit headers explanation  \n- Configuration reference\n- Troubleshooting guide\n\nAcceptance Criteria:\n- README updated with rate limit info\n- API docs include rate limit details\n- Runbook for common issues","assignee":"tech-writer","priority":400,"tags":["documentation","api","rate-limiting"]}
```

## Benefits

1. **Structured Planning**: Converts vague requirements into concrete, actionable tasks
2. **Architecture Awareness**: Understands system design and suggests appropriate solutions
3. **Team Coordination**: Assigns tasks to the right personas based on expertise
4. **Dependency Management**: Identifies and documents task dependencies
5. **Comprehensive Coverage**: Thinks about non-functional requirements like monitoring and documentation

## Tips for Best Results

1. **Provide Context**: The more context about your current system and goals, the better the recommendations
2. **Iterate**: Have a conversation before asking for ticket creation
3. **Review and Adjust**: The PM's suggestions are a starting point - feel free to ask for adjustments
4. **Knowledge Base**: Keep your knowledge base updated for better architectural recommendations