// Reminder rule types matching the server-side implementation

export type Operator =
  | '=' | '!=' | '>' | '<' | '>=' | '<='
  | 'contains' | 'not_contains' | 'in' | 'not_in';

export type RuleTarget = 'ticket' | 'pr' | 'backlog';

export interface RuleCondition {
  field: string;
  operator: Operator;
  value: string | number | string[];
}

export interface RuleAction {
  type: 'slack' | 'console';
  channel?: string;
  template: string;
}

export interface ReminderRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  target: RuleTarget;
  conditions: RuleCondition[];
  action: RuleAction;
  cooldown: string;
  createdAt: Date;
  updatedAt: Date;
  isBuiltin?: boolean;
  hasActiveCooldowns?: boolean; // Added by API to indicate active cooldowns
}