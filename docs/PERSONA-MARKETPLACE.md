# Persona Marketplace Design Specification

**Status:** Design / RFC  
**Version:** 1.0  
**Last Updated:** 2026-03-16  
**Dependencies:** BYOP (Bring Your Own Persona), Multi-User Support

---

## 1. Overview

### Why a Marketplace Matters

The persona marketplace transforms Forge from a personal productivity tool into an **extensible ecosystem**. Currently, users can define custom personas via YAML files in their `.forge/personas/` directory (BYOP), but there's no way to:

- **Discover** personas created by others
- **Share** custom personas across teams or the community
- **Version** and update personas as best practices evolve
- **Trust** third-party personas before granting them access

A marketplace solves these problems by providing:

1. **Discoverability** - Browse and search available personas by category, rating, or use case
2. **Reusability** - Install battle-tested personas instead of building from scratch
3. **Community Growth** - Enable creators to contribute expertise back to the ecosystem
4. **Quality Signal** - Ratings, reviews, and curation ensure high-quality personas
5. **Ecosystem Velocity** - Accelerate adoption by reducing the barrier to customization

### Success Criteria

A successful marketplace enables:

- **Users** to find and install personas in under 60 seconds
- **Creators** to publish and update personas without platform-specific knowledge
- **Teams** to share private personas within organizations
- **Maintainers** to curate quality and prevent abuse

---

## 2. Package Format

### Structure

A persona package is a **GitHub repository** containing:

```
persona-senior-dev/
├── forge-plugin.yaml          # Package manifest (required)
├── persona.yaml               # Persona definition (required)
├── README.md                  # Usage guide (required)
├── CHANGELOG.md               # Version history (optional)
├── LICENSE                    # License (optional but recommended)
├── examples/                  # Example usage (optional)
│   └── sample-task.md
└── assets/                    # Optional assets
    └── avatar.png
```

### forge-plugin.yaml (Package Manifest)

The manifest describes the package metadata and dependencies:

```yaml
# Package metadata
package:
  name: senior-developer
  displayName: Senior Developer Persona
  version: 1.2.0
  author: jdoe
  authorEmail: jdoe@example.com
  description: Experienced full-stack developer with focus on architecture and scalability
  homepage: https://github.com/jdoe/persona-senior-dev
  repository: https://github.com/jdoe/persona-senior-dev
  license: MIT
  
# Package type (for future extensibility)
type: persona

# Required Forge version (semver)
forgeVersion: ">=0.8.0"

# Provider dependencies
providers:
  required:
    - github        # Must have GitHub provider
  optional:
    - slack         # Useful but not required
    - notion

# Capability grants requested (security boundary)
capabilities:
  - code:write      # Can modify code
  - github:pr       # Can create/update PRs
  - github:comment  # Can comment on issues/PRs
  
# Tags for discovery
tags:
  - development
  - architecture
  - code-review
  - senior-engineer

# Minimum AI model tier required
modelRequirements:
  minTier: standard  # standard | advanced | premium
  recommended: anthropic/claude-sonnet-4
```

### persona.yaml (Persona Definition)

The persona definition follows the existing [Persona YAML Schema](./PERSONA-YAML-SCHEMA.md):

```yaml
id: senior-developer
name: Senior Developer
emoji: 👨‍💻
description: Experienced full-stack developer with focus on architecture

prompt: |
  You are a senior software developer with deep expertise in system architecture.
  
  When given a development task:
  1. Consider architectural implications
  2. Review existing patterns
  3. Propose scalable solutions
  4. Consider testing and documentation
  5. Provide clear implementation guidance

specialties:
  - architecture
  - system-design
  - typescript
  - nodejs
  - api-design

triggers:
  - pr_opened
  - ticket_moved

providers:
  - github
  - slack

model: anthropic/claude-sonnet-4

budgetCap:
  perTask: 500000
  perDay: 2000000

skills:
  - code
  - review
  - comment
  - docs
```

### README.md (Required)

Every package **MUST** include a README with:

- **Overview** - What the persona does and when to use it
- **Installation** - How to install via `forge install`
- **Configuration** - Any required environment variables or settings
- **Usage Examples** - Sample tasks and expected behavior
- **Capabilities** - Clear disclosure of what permissions it requests
- **Changelog** - Link to version history

**Example:**

```markdown
# Senior Developer Persona

Experienced full-stack developer persona for Forge, specialized in architecture and code review.

## Installation

```bash
forge install senior-developer
```

## Usage

Assign to tasks requiring architectural review:

```bash
forge assign senior-developer TASK-123
```

## Capabilities

This persona requests:
- ✅ Code write access (to create branches and commits)
- ✅ GitHub PR access (to create and update pull requests)
- ✅ GitHub comment access (to provide feedback)

## Configuration

Optional Slack integration:
```bash
export SLACK_TOKEN=xoxb-your-token
```

## Examples

See [examples/](./examples/) for sample tasks.
```

---

## 3. Registry Design

### Phase 1: GitHub-Based Registry

The initial registry is **decentralized** and **Git-native**:

- **Each package = 1 GitHub repository**
- **Central index = JSON file in a registry repo**
- **No custom backend required** (use GitHub API)
- **Search powered by GitHub's search API**

### Registry Repository

The official registry is a GitHub repo (`forge-registry/marketplace`) containing:

```
forge-registry/marketplace/
├── index.json              # Master package index
├── personas/               # Category: personas
│   ├── senior-developer.json
│   ├── security-reviewer.json
│   └── qa-specialist.json
├── providers/              # Future: custom providers
└── README.md
```

### index.json Schema

```json
{
  "version": "1.0",
  "lastUpdated": "2026-03-16T00:00:00Z",
  "packages": [
    {
      "name": "senior-developer",
      "type": "persona",
      "displayName": "Senior Developer",
      "description": "Experienced full-stack developer with focus on architecture",
      "author": "jdoe",
      "repository": "https://github.com/jdoe/persona-senior-dev",
      "version": "1.2.0",
      "tags": ["development", "architecture", "code-review"],
      "stars": 342,
      "downloads": 1205,
      "rating": 4.8,
      "verified": true,
      "publishedAt": "2026-01-15T10:00:00Z",
      "updatedAt": "2026-03-10T14:30:00Z"
    }
  ]
}
```

### Package Detail Files

Each package has a detail file (e.g., `personas/senior-developer.json`):

```json
{
  "name": "senior-developer",
  "repository": "https://github.com/jdoe/persona-senior-dev",
  "manifest": {
    "package": {
      "name": "senior-developer",
      "version": "1.2.0",
      "author": "jdoe",
      "description": "Experienced full-stack developer with focus on architecture"
    },
    "forgeVersion": ">=0.8.0",
    "providers": {
      "required": ["github"],
      "optional": ["slack"]
    },
    "capabilities": ["code:write", "github:pr", "github:comment"]
  },
  "versions": [
    {
      "version": "1.2.0",
      "releaseDate": "2026-03-10T14:30:00Z",
      "sha": "abc123def456",
      "changelog": "Added support for monorepo architecture patterns"
    },
    {
      "version": "1.1.0",
      "releaseDate": "2026-02-01T09:00:00Z",
      "sha": "def789abc012",
      "changelog": "Improved test coverage recommendations"
    }
  ],
  "stats": {
    "stars": 342,
    "downloads": 1205,
    "rating": 4.8,
    "reviews": 23
  },
  "verified": true
}
```

### Registry Update Flow

1. **Creator publishes package** → Submits PR to `forge-registry/marketplace`
2. **Maintainers review** → Check manifest, README, security
3. **PR merged** → Package appears in registry
4. **Index updated** → CI regenerates `index.json`
5. **Clients sync** → `forge search` fetches updated index

---

## 4. CLI Commands

### forge search

Search the marketplace for packages.

```bash
# Search all packages
forge search

# Search by keyword
forge search "security"

# Filter by type
forge search --type persona

# Filter by tag
forge search --tag code-review

# Show details
forge search senior-developer --details
```

**Output:**

```
PACKAGE              TYPE      DESCRIPTION                                    RATING  DOWNLOADS
senior-developer     persona   Experienced full-stack developer...            ⭐ 4.8   1,205
security-reviewer    persona   Security-focused code reviewer                 ⭐ 4.9   892
qa-specialist        persona   Quality assurance and testing expert           ⭐ 4.7   743
```

### forge install

Install a package from the marketplace.

```bash
# Install latest version
forge install senior-developer

# Install specific version
forge install senior-developer@1.1.0

# Install from custom registry
forge install senior-developer --registry https://example.com/registry

# Install from local path (for testing)
forge install ./path/to/package

# Install and activate immediately
forge install senior-developer --activate
```

**Installation Flow:**

1. **Fetch package metadata** from registry
2. **Check dependencies** (Forge version, providers)
3. **Display capability grants** and prompt for confirmation
4. **Clone repository** to `~/.forge/packages/senior-developer`
5. **Copy persona.yaml** to `~/.forge/personas/senior-developer.yaml`
6. **Install provider dependencies** (if needed)
7. **Mark as installed** in `~/.forge/installed.json`

**Security Prompt:**

```
📦 Installing: senior-developer v1.2.0 by jdoe

Capabilities requested:
  ✅ code:write      - Can modify code files
  ✅ github:pr       - Can create/update pull requests
  ✅ github:comment  - Can comment on issues/PRs

Providers required:
  ✅ github (installed)
  ⚠️  slack (optional, not installed)

Install? [y/N]
```

### forge uninstall

Remove an installed package.

```bash
# Uninstall package
forge uninstall senior-developer

# Uninstall and remove data
forge uninstall senior-developer --purge
```

### forge publish

Publish a package to the marketplace.

```bash
# Initialize new package
forge init persona senior-developer

# Validate package before publishing
forge validate

# Publish to registry (creates PR)
forge publish

# Publish specific version
forge publish --version 1.2.0

# Publish to custom registry
forge publish --registry https://example.com/registry
```

**Publish Flow:**

1. **Validate manifest** (`forge-plugin.yaml`)
2. **Validate persona definition** (`persona.yaml`)
3. **Check README** (required sections)
4. **Run security scan** (no hardcoded secrets)
5. **Create Git tag** (if versioning)
6. **Fork registry repo**
7. **Add package metadata**
8. **Open PR** to registry

### forge update

Update installed packages.

```bash
# Update all packages
forge update

# Update specific package
forge update senior-developer

# Check for updates without installing
forge update --check
```

### forge list

List installed packages.

```bash
# List installed packages
forge list

# Show versions and status
forge list --verbose
```

**Output:**

```
PACKAGE              VERSION  STATUS    LAST USED
senior-developer     1.2.0    active    2 days ago
security-reviewer    2.0.1    active    1 week ago
qa-specialist        0.9.0    inactive  never
```

---

## 5. Versioning

### Semantic Versioning

All packages **MUST** follow [SemVer](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes (incompatible with previous version)
- **MINOR** (1.0.0 → 1.1.0): New features, backward compatible
- **PATCH** (1.0.0 → 1.0.1): Bug fixes, backward compatible

### Version Constraints

Users can specify version constraints in their Forge config:

```yaml
# .forge/config.yaml
packages:
  senior-developer:
    version: "^1.2.0"    # Allow 1.2.x, 1.3.x, but not 2.x
  security-reviewer:
    version: "~2.0.0"    # Allow 2.0.x only
  qa-specialist:
    version: ">=0.9.0"   # Any version >= 0.9.0
```

### Update Policies

Users can configure automatic update behavior:

```yaml
# .forge/config.yaml
updates:
  policy: prompt        # prompt | auto | manual
  schedule: weekly      # daily | weekly | monthly
  majorVersions: prompt # prompt | auto | ignore
```

### Version Compatibility

Packages declare minimum Forge version:

```yaml
# forge-plugin.yaml
forgeVersion: ">=0.8.0"
```

Forge checks compatibility before installation:

```bash
$ forge install senior-developer
❌ Error: senior-developer requires Forge >=0.8.0 (you have 0.7.2)
   Run: forge upgrade
```

---

## 6. Trust Model

### Phase 1: Curated Registry

**Initial approach** - Conservative and safe:

- **Manual review** of all submissions
- **Verification badge** for approved creators
- **Security scan** for secrets, malicious code
- **Capability limits** enforced by maintainers

### Phase 2: Community Ratings

**Next evolution** - Scale with community feedback:

- **Star ratings** (1-5 stars)
- **Written reviews** with upvotes
- **Usage stats** (downloads, active users)
- **Reputation system** for creators

### Rating System

Users can rate installed packages:

```bash
# Rate a package
forge rate senior-developer 5 "Excellent architectural guidance"

# View ratings
forge info senior-developer --reviews
```

**Review Schema:**

```json
{
  "packageName": "senior-developer",
  "version": "1.2.0",
  "rating": 5,
  "comment": "Excellent architectural guidance, saved hours of design work",
  "author": "alice",
  "createdAt": "2026-03-15T10:00:00Z",
  "helpful": 12
}
```

### Verified Creators

Creators can earn **verified badges** by:

- **Consistent quality** - High average ratings (>4.5)
- **Active maintenance** - Regular updates, responsive to issues
- **Security practices** - Clean security scans, responsible disclosure
- **Community contribution** - Multiple high-quality packages

### Security Indicators

Each package displays trust signals:

```
📦 senior-developer v1.2.0

Trust Indicators:
  ✅ Verified creator
  ✅ Security scan passed
  ✅ 342 stars
  ✅ 1,205 downloads
  ✅ 4.8/5 rating (23 reviews)
  ✅ Updated 6 days ago
  ⚠️  Requests code:write access
```

### Capability Auditing

Forge logs all capability usage:

```bash
# View capability usage
forge audit senior-developer

# Output:
# Capability: code:write
#   Used: 23 times
#   Last: 2026-03-15 10:30:00 (task FORGE-42)
#   
# Capability: github:pr
#   Used: 18 times
#   Last: 2026-03-15 09:15:00 (task FORGE-41)
```

---

## 7. Dependencies

### Provider Dependencies

Packages declare required and optional providers:

```yaml
# forge-plugin.yaml
providers:
  required:
    - github        # Installation fails if missing
  optional:
    - slack         # Installed if available
    - notion
```

**Installation behavior:**

```bash
$ forge install senior-developer

Checking dependencies...
  ✅ github provider (installed)
  ⚠️  slack provider (optional, not installed)
     Install with: forge provider install slack
  ⚠️  notion provider (optional, not installed)

Continue? [y/N]
```

### Provider Version Constraints

Packages can specify provider versions:

```yaml
providers:
  required:
    - name: github
      version: ">=2.0.0"
  optional:
    - name: slack
      version: "^1.5.0"
```

### Persona Dependencies

**Future:** Personas may depend on other personas (orchestrator pattern):

```yaml
# forge-plugin.yaml
dependencies:
  personas:
    - backend-specialist   # Invoked for backend tasks
    - frontend-specialist  # Invoked for frontend tasks
```

Forge ensures all dependencies are installed:

```bash
$ forge install tech-lead

Installing: tech-lead v1.0.0
  Dependencies:
    - backend-specialist v2.1.0 (installing...)
    - frontend-specialist v1.8.0 (installing...)
  
  ✅ All dependencies installed
```

### Dependency Resolution

Forge uses a **dependency resolver** to handle:

- **Version conflicts** - Choose highest compatible version
- **Circular dependencies** - Detect and reject
- **Missing dependencies** - Prompt to install
- **Transitive dependencies** - Flatten dependency tree

---

## 8. Security

### Capability System

Every package **MUST** declare capabilities in `forge-plugin.yaml`:

```yaml
capabilities:
  - code:read        # Read code files
  - code:write       # Modify code files
  - github:pr        # Create/update PRs
  - github:comment   # Comment on issues/PRs
  - github:merge     # Merge PRs (high privilege)
  - file:read        # Read arbitrary files
  - file:write       # Write arbitrary files
  - network:http     # Make HTTP requests
  - secrets:read     # Read environment secrets
```

### Permission Confirmation

Users **MUST** approve capabilities before installation:

```
📦 Installing: senior-developer v1.2.0

⚠️  Security Review Required

This persona requests access to:

  [✓] code:write
      Can create branches, modify files, and commit changes
      
  [✓] github:pr
      Can open pull requests on your behalf
      
  [✓] github:comment
      Can post comments to issues and PRs

  [ ] github:merge   ❌ NOT GRANTED
      User must manually approve merges

Review capabilities: https://github.com/jdoe/persona-senior-dev/blob/main/CAPABILITIES.md

Approve? [y/N]
```

### Sandboxing

Forge enforces capability boundaries:

- **Filesystem access** - Limited to workspace directory (no access to `~/.ssh`, `/etc`)
- **Network access** - Logged and rate-limited
- **Provider access** - Only declared providers available
- **Secret access** - Explicit opt-in required

### Security Scanning

All packages undergo automated security scans before publication:

- **Secret detection** - No hardcoded API keys, tokens, passwords
- **Malicious code** - No obfuscation, suspicious system calls
- **Dependency vulnerabilities** - Check npm/pip dependencies
- **YAML validation** - Ensure valid schema

**Scan Report:**

```
Security Scan: senior-developer v1.2.0

  ✅ No hardcoded secrets detected
  ✅ No malicious patterns found
  ✅ No vulnerable dependencies
  ✅ YAML schema valid
  ⚠️  Requests code:write access (review recommended)

  Risk Level: LOW
```

### Incident Response

If a published package is compromised:

1. **Report to maintainers** via GitHub issue or security@forge.dev
2. **Package flagged** in registry (warning shown to users)
3. **Investigation** - Review code changes, capability usage
4. **Revocation** - Remove from registry if malicious
5. **User notification** - Alert all users who installed affected versions

---

## 9. Future Considerations

### Dedicated Registry Service

**Beyond GitHub:**

- **REST API** for fast package queries
- **CDN** for package distribution
- **Search indexing** (Algolia, Elasticsearch)
- **Analytics dashboard** for creators
- **Webhook triggers** for CI/CD integration

### Monetization

Enable creators to earn from their work:

- **Paid packages** - One-time purchase or subscription
- **Sponsorship** - GitHub Sponsors integration
- **Pro tiers** - Free basic, paid advanced features
- **Enterprise licensing** - Volume licensing for teams

**Pricing Model:**

```yaml
# forge-plugin.yaml
pricing:
  model: subscription      # one-time | subscription | freemium
  tiers:
    - name: free
      price: 0
      limits:
        tasksPerMonth: 50
    - name: pro
      price: 9.99
      currency: USD
      limits:
        tasksPerMonth: unlimited
```

### Private Packages

Support private registries for teams:

```bash
# Configure private registry
forge registry add company-internal https://registry.example.com
forge registry login company-internal

# Install from private registry
forge install internal/custom-reviewer --registry company-internal
```

**Private Registry Schema:**

```yaml
# .forge/registries.yaml
registries:
  - name: company-internal
    url: https://registry.example.com
    auth: token
    token: eyJhbGc...
    priority: 1     # Check private registry first
```

### Package Templates

Starter templates for common persona types:

```bash
# Create from template
forge init persona --template developer
forge init persona --template reviewer
forge init persona --template orchestrator

# List available templates
forge templates
```

### Dependency Analysis

Show dependency trees and size impact:

```bash
forge deps senior-developer

# Output:
# senior-developer@1.2.0
# ├── github provider (28 KB)
# └── slack provider (optional) (15 KB)
#
# Total size: 43 KB
# Total dependencies: 2
```

### Package Collections

Curated collections for common workflows:

```bash
# Install entire collection
forge install @collections/full-stack-team

# Includes:
#   - senior-developer
#   - security-reviewer
#   - qa-specialist
#   - tech-lead
```

### Analytics for Creators

Dashboard showing package performance:

- **Usage metrics** - Downloads, active users, task count
- **Performance** - Average execution time, success rate
- **Feedback** - Ratings, reviews, issues
- **Revenue** - Earnings from paid packages (future)

### Marketplace Web UI

Web interface for browsing packages:

- **Search and filter** - By category, rating, popularity
- **Package pages** - README, reviews, versions
- **Creator profiles** - All packages by author
- **Trending** - Popular and rising packages
- **Collections** - Curated package bundles

### API for Third-Party Integrations

RESTful API for external tools:

```bash
# Fetch package metadata
GET /api/v1/packages/senior-developer

# Search packages
GET /api/v1/packages?q=security&type=persona

# Get package versions
GET /api/v1/packages/senior-developer/versions

# Submit review
POST /api/v1/packages/senior-developer/reviews
```

---

## 10. Implementation Roadmap

### MVP (v0.1)

**Goal:** Prove the concept with minimal viable features

- [x] BYOP (Bring Your Own Persona) via YAML
- [ ] Basic registry (GitHub-based, manual approval)
- [ ] `forge search` - Browse marketplace
- [ ] `forge install` - Install from registry
- [ ] `forge publish` - Submit package (creates PR)
- [ ] Security: Capability declaration and confirmation
- [ ] Documentation: Package format spec, CLI reference

### v0.2 - Trust & Discovery

- [ ] Star ratings (1-5 stars)
- [ ] Download stats
- [ ] Verified creator badges
- [ ] Search filters (tags, rating, popularity)
- [ ] Package updates (`forge update`)

### v0.3 - Dependencies & Versioning

- [ ] Provider version constraints
- [ ] Dependency resolver
- [ ] Automatic updates (configurable)
- [ ] Changelog integration

### v0.4 - Security Hardening

- [ ] Automated security scans
- [ ] Capability auditing
- [ ] Sandboxed execution
- [ ] Incident response protocol

### v1.0 - Production Ready

- [ ] Dedicated registry service
- [ ] Web UI for marketplace
- [ ] Analytics for creators
- [ ] Private registries
- [ ] API for third-party integrations

### Future (v2.0+)

- [ ] Monetization (paid packages)
- [ ] Package collections
- [ ] Persona dependencies
- [ ] Dependency analysis tools
- [ ] Advanced search (ML-powered)

---

## 11. Open Questions

### Technical

- **Storage:** Where are installed packages stored? (`~/.forge/packages/` vs embedded in workspace)
- **Updates:** Background auto-update or manual? How to handle breaking changes?
- **Offline mode:** Can packages work without internet? (cache registry index locally)
- **Performance:** How to handle large packages (e.g., with ML models or datasets)?

### Business

- **Monetization:** When/how to introduce paid packages? What's the split (creator vs platform)?
- **Moderation:** How to scale beyond manual review? (community voting, automated checks)
- **Support:** Who handles support requests for third-party packages?
- **Liability:** What if a package causes data loss or security breach?

### Community

- **Governance:** Who decides what gets published? (maintainer team, community vote, automated approval)
- **Quality bar:** What's the minimum quality standard for marketplace inclusion?
- **Deprecation:** How to handle abandoned packages? (community forks, archive warnings)
- **Naming:** How to prevent namespace squatting? (first-come first-serve, verified creators only)

---

## 12. Success Metrics

Track marketplace health via:

- **Adoption:** Number of packages published and installed
- **Engagement:** Active users, tasks processed by marketplace personas
- **Quality:** Average rating, review count, verified creators
- **Diversity:** Number of unique creators, coverage across use cases
- **Retention:** Percentage of users who keep marketplace packages installed

**Target Metrics (6 months post-launch):**

- 50+ packages published
- 10+ verified creators
- 500+ total installations
- 4.5+ average package rating
- 80%+ user retention of installed packages

---

## 13. Related Documentation

- [Persona YAML Schema](./PERSONA-YAML-SCHEMA.md) - Persona definition format
- [Provider Specification](./PROVIDER_SPEC.md) - Provider interface contract
- [Persona Phase 3](./PERSONA_PHASE3.md) - Event triggers and parallel execution
- [Multi-User RFC](./rfcs/RFC-MULTI-USER.md) - Multi-user support design
- [BYOP Guide](./personas/byop.md) - Bring Your Own Persona tutorial

---

## 14. Appendix

### Example Package: Security Reviewer

**Repository:** `https://github.com/security-team/persona-security-reviewer`

**forge-plugin.yaml:**

```yaml
package:
  name: security-reviewer
  displayName: Security Code Reviewer
  version: 2.0.1
  author: security-team
  description: Security-focused code reviewer with OWASP expertise
  repository: https://github.com/security-team/persona-security-reviewer
  license: MIT

type: persona
forgeVersion: ">=0.8.0"

providers:
  required:
    - github
  optional:
    - slack

capabilities:
  - code:read
  - github:comment
  - github:pr

tags:
  - security
  - code-review
  - owasp
  - vulnerability-scanning

modelRequirements:
  minTier: advanced
  recommended: anthropic/claude-opus-4
```

**persona.yaml:**

```yaml
id: security-reviewer
name: Security Reviewer
emoji: 🔒
description: Security-focused code reviewer with OWASP Top 10 expertise

prompt: |
  You are a security-focused code reviewer specializing in identifying vulnerabilities.
  
  For every code change, check for:
  1. OWASP Top 10 vulnerabilities
  2. Authentication/authorization issues
  3. Input validation gaps
  4. SQL injection risks
  5. XSS vulnerabilities
  6. Secrets in code
  7. Insecure dependencies
  
  Provide specific, actionable feedback with examples.

specialties:
  - security
  - owasp
  - penetration-testing
  - secure-coding
  - cryptography

triggers:
  - pr_opened
  - pr_review_requested

providers:
  - github

model: anthropic/claude-opus-4

budgetCap:
  perTask: 300000
  perDay: 1000000

skills:
  - review
  - comment
```

**README.md:**

```markdown
# Security Code Reviewer Persona

Security-focused code reviewer for Forge, specializing in OWASP Top 10 and secure coding practices.

## Installation

```bash
forge install security-reviewer
```

## Usage

Auto-activates on PR creation:

```bash
# Manual assignment
forge assign security-reviewer TASK-123
```

## What It Checks

- ✅ OWASP Top 10 vulnerabilities
- ✅ Authentication/authorization flaws
- ✅ Input validation gaps
- ✅ SQL injection risks
- ✅ XSS vulnerabilities
- ✅ Hardcoded secrets
- ✅ Dependency vulnerabilities

## Capabilities

- ✅ `code:read` - Read code to analyze for vulnerabilities
- ✅ `github:comment` - Post security findings as PR comments
- ✅ `github:pr` - Request changes if critical issues found

## Configuration

Optional: Configure security severity threshold:

```yaml
# .forge/config.yaml
personas:
  security-reviewer:
    severity: high  # high | medium | low
```

## Examples

See [examples/](./examples/) for sample security reviews.

## License

MIT - See [LICENSE](./LICENSE)
```

---

**End of Design Specification**
