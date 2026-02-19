# LGTM Integration for AI Personas

## Overview

The tix-kanban system now supports automated code reviews using the `lgtm` tool through AI personas. This feature enables personas to perform thorough pull request reviews with professional code analysis capabilities.

## Supported Personas

### 1. Code-Reviewer (Primary)
- **Emoji**: 🔍
- **Specialties**: code-review, pull-requests, lgtm, code-quality, best-practices
- **Description**: Specialized code reviewer who uses the lgtm tool for comprehensive PR reviews

### 2. QA-Engineer (Secondary)
- **Emoji**: 🧪
- **Specialties**: testing, quality-assurance, code-review, verification
- **Description**: Quality assurance specialist who can also perform code reviews using lgtm

## How It Works

### Automatic Detection

The system automatically detects code review tasks based on:

1. **PR Links**: Tasks with linked pull requests
2. **Keywords**: Tasks containing "review", "code review", "pr review", "lgtm" in title or description
3. **Tags**: Tasks tagged with review-related keywords
4. **Persona Assignment**: Tasks assigned to Code-Reviewer or QA-Engineer personas

### LGTM Command Usage

When a code review task is detected, the persona will execute:

```bash
lgtm review <PR_NUMBER> --full-context --usage-context --dry-run
```

### Review Process

1. **PR Identification**: The persona extracts the PR number from task links or description
2. **Repository Navigation**: Ensures it's in the correct repository directory
3. **LGTM Execution**: Runs the lgtm tool with appropriate flags
4. **Analysis**: Parses the output for various issue types
5. **Feedback Generation**: Creates structured, actionable feedback

## Creating a Code Review Task

### Option 1: Direct Assignment

```yaml
Title: Review PR #123 for security issues
Description: Please review pull request #123 using lgtm tool
Tags: [code-review]
Persona: Code-Reviewer
Links:
  - https://github.com/owner/repo/pull/123
```

### Option 2: Natural Language

```yaml
Title: Code review needed for authentication PR
Description: Can you review the authentication changes in PR #456?
             Focus on security and best practices.
Persona: QA-Engineer
```

## Review Output Structure

The persona will provide feedback in this format:

```markdown
## Code Review Summary

**PR #123**: Brief description of changes

### Critical Issues
- Security vulnerability in auth.js:45
- SQL injection risk in database.js:123

### Improvements Suggested
- Add input validation in user.controller.js
- Improve error handling in api.service.js

### Positive Feedback
- Good test coverage for new features
- Clean code structure

### Action Items
1. Fix security vulnerability before merge
2. Add missing tests for edge cases
```

## Configuration

### Auto-Review Settings

The system can be configured to automatically assign code reviews:

```json
{
  "taskTypeReviewers": {
    "backend": "code-reviewer",
    "security": "security-reviewer",
    "frontend": "qa-engineer"
  }
}
```

## Best Practices

1. **Clear PR Links**: Always include the full GitHub PR URL in task links
2. **Specific Instructions**: Add specific review focus areas in the task description
3. **Repository Context**: Ensure the repository path is configured in user settings
4. **Review Tags**: Use appropriate tags to trigger automatic reviewer assignment

## Limitations

- The `--dry-run` flag is always used to prevent accidental PR modifications
- Reviews are advisory only - human approval is still required
- The lgtm tool must be installed and accessible in the system PATH

## Troubleshooting

### Common Issues

1. **"lgtm command not found"**
   - Ensure lgtm is installed: `npm install -g lgtm`
   - Check PATH configuration

2. **"Cannot find PR"**
   - Verify PR number is correct
   - Ensure you're in the right repository
   - Check GitHub authentication

3. **Timeout Errors**
   - Large PRs may exceed the default timeout
   - Consider breaking into smaller review tasks

## Example Workflow

1. Developer creates PR #789
2. Create task: "Review PR #789 for API changes"
3. Assign to Code-Reviewer persona
4. Add PR link: https://github.com/org/repo/pull/789
5. AI runs lgtm and provides comprehensive feedback
6. Developer addresses feedback
7. Human reviewer gives final approval

## Future Enhancements

- Integration with GitHub Actions
- Automatic PR comments from review findings
- Custom lgtm rulesets per project
- Review history tracking and analytics