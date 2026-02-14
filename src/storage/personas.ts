import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'

export interface Persona {
  id: string
  name: string
  emoji: string
  description: string
  prompt: string
  filePath: string
}

class PersonaSystem {
  private dataDir: string
  private projectDir: string

  constructor() {
    this.dataDir = path.join(os.homedir(), '.tix-kanban', 'personas')
    this.projectDir = path.join(process.cwd(), 'personas')
    
    // Ensure both directories exist
    fs.ensureDirSync(this.dataDir)
    fs.ensureDirSync(this.projectDir)
    
    this.initializeDefaults()
  }

  private async initializeDefaults(): Promise<void> {
    const defaultPersonas = [
      {
        id: 'qa-engineer',
        name: 'QA Engineer',
        emoji: '🧪',
        description: 'Focuses on testing, edge cases, and quality assurance',
        prompt: `You are a QA Engineer focused on quality and testing.

When reviewing tasks:
- Look for edge cases and potential bugs
- Suggest test scenarios and validation steps
- Focus on user experience and error handling
- Check for security vulnerabilities
- Ensure proper error messages and validation

Be thorough but practical in your suggestions.`
      },
      {
        id: 'security-reviewer',
        name: 'Security Reviewer',
        emoji: '🔒',
        description: 'Identifies security vulnerabilities and best practices',
        prompt: `You are a Security Reviewer focused on identifying and preventing security issues.

When reviewing tasks:
- Look for authentication and authorization issues
- Check for input validation and sanitization
- Identify potential injection vulnerabilities
- Review data exposure and privacy concerns
- Suggest security best practices
- Check for secure coding patterns

Security is critical - be vigilant but provide actionable guidance.`
      },
      {
        id: 'tech-writer',
        name: 'Tech Writer',
        emoji: '📝',
        description: 'Creates clear documentation and user guides',
        prompt: `You are a Technical Writer focused on clear communication and documentation.

When working on tasks:
- Write clear, concise documentation
- Focus on user experience and clarity
- Create step-by-step guides where appropriate
- Use proper formatting and structure
- Consider your audience (developers, users, etc.)
- Include examples and use cases

Make complex topics accessible and easy to understand.`
      },
      {
        id: 'bug-fixer',
        name: 'Bug Fixer',
        emoji: '🔧',
        description: 'Systematically identifies and fixes issues',
        prompt: `You are a Bug Fixer focused on systematically identifying and resolving issues.

When working on tasks:
- Reproduce the issue step by step
- Identify the root cause, not just symptoms
- Provide minimal, focused fixes
- Test your solution thoroughly
- Consider side effects and edge cases
- Document the fix and reasoning

Be methodical and thorough in your approach.`
      },
      {
        id: 'general-developer',
        name: 'General Developer',
        emoji: '💻',
        description: 'Handles general development tasks and features',
        prompt: `You are a General Developer focused on building features and maintaining code.

When working on tasks:
- Write clean, maintainable code
- Follow existing patterns and conventions
- Consider performance and scalability
- Add appropriate comments and documentation
- Test your implementation
- Think about future extensibility

Balance pragmatism with best practices.`
      }
    ]

    for (const persona of defaultPersonas) {
      const filePath = path.join(this.projectDir, `${persona.id}.md`)
      
      // Only create if it doesn't exist
      if (!await fs.pathExists(filePath)) {
        const frontMatter = {
          name: persona.name,
          emoji: persona.emoji,
          description: persona.description
        }
        
        const content = matter.stringify(persona.prompt, frontMatter)
        await fs.writeFile(filePath, content)
      }
    }
  }

  async list(): Promise<Persona[]> {
    const personas: Persona[] = []
    
    // Read from both directories
    const dirs = [this.dataDir, this.projectDir]
    
    for (const dir of dirs) {
      try {
        const files = await fs.readdir(dir)
        const mdFiles = files.filter(f => f.endsWith('.md'))
        
        for (const file of mdFiles) {
          try {
            const filePath = path.join(dir, file)
            const content = await fs.readFile(filePath, 'utf8')
            const parsed = matter(content)
            
            const id = path.basename(file, '.md')
            const persona: Persona = {
              id,
              name: parsed.data.name || id,
              emoji: parsed.data.emoji || '🤖',
              description: parsed.data.description || '',
              prompt: parsed.content.trim(),
              filePath
            }
            
            // Avoid duplicates (project dir takes precedence)
            const existingIndex = personas.findIndex(p => p.id === id)
            if (existingIndex >= 0) {
              if (dir === this.projectDir) {
                personas[existingIndex] = persona
              }
            } else {
              personas.push(persona)
            }
          } catch (error) {
            console.error(`Failed to read persona file ${file}:`, error)
          }
        }
      } catch (error) {
        console.error(`Failed to read personas directory ${dir}:`, error)
      }
    }
    
    return personas.sort((a, b) => a.name.localeCompare(b.name))
  }

  async get(id: string): Promise<Persona | null> {
    const personas = await this.list()
    return personas.find(p => p.id === id) || null
  }
}

export const personaSystem = new PersonaSystem()