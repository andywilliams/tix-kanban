// Provider registry and factory

import { TicketProvider, MessageProvider, ProviderConfig } from './types.js';
import { tixProvider } from './tix-provider.js';
import { slxProvider } from './slx-provider.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const PROVIDER_CONFIG_PATH = path.join(os.homedir(), '.tix-kanban', 'providers.json');

// Registry of available providers
const ticketProviders: Map<string, TicketProvider> = new Map([
  ['tix', tixProvider],
]);

const messageProviders: Map<string, MessageProvider> = new Map([
  ['slx', slxProvider],
]);

// Active providers (set by config or defaults)
let activeTicketProvider: TicketProvider | null = tixProvider;
let activeMessageProvider: MessageProvider | null = slxProvider;

/**
 * Load provider configuration
 */
export async function loadProviderConfig(): Promise<ProviderConfig | null> {
  try {
    const data = await fs.readFile(PROVIDER_CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    // Return defaults if no config exists
    return { ticketProvider: 'tix', messageProvider: 'slx' };
  }
}

/**
 * Initialize providers based on config
 */
export async function initializeProviders(): Promise<void> {
  const config = await loadProviderConfig();
  
  if (config?.ticketProvider) {
    const provider = ticketProviders.get(config.ticketProvider);
    if (provider) {
      activeTicketProvider = provider;
    } else {
      console.warn(`Unknown ticket provider "${config.ticketProvider}" in config - using default`);
    }
  }
  
  if (config?.messageProvider) {
    const provider = messageProviders.get(config.messageProvider);
    if (provider) {
      activeMessageProvider = provider;
    } else {
      console.warn(`Unknown message provider "${config.messageProvider}" in config - using default`);
    }
  }
}

/**
 * Register a custom ticket provider
 */
export function registerTicketProvider(provider: TicketProvider): void {
  ticketProviders.set(provider.name, provider);
}

/**
 * Register a custom message provider  
 */
export function registerMessageProvider(provider: MessageProvider): void {
  messageProviders.set(provider.name, provider);
}

/**
 * Get the active ticket provider
 */
export function getTicketProvider(): TicketProvider | null {
  return activeTicketProvider;
}

/**
 * Get the active message provider
 */
export function getMessageProvider(): MessageProvider | null {
  return activeMessageProvider;
}

/**
 * Set the active ticket provider by name
 */
export function setTicketProvider(name: string): boolean {
  const provider = ticketProviders.get(name);
  if (provider) {
    activeTicketProvider = provider;
    return true;
  }
  return false;
}

/**
 * Set the active message provider by name
 */
export function setMessageProvider(name: string): boolean {
  const provider = messageProviders.get(name);
  if (provider) {
    activeMessageProvider = provider;
    return true;
  }
  return false;
}

/**
 * List available providers
 */
export function listProviders(): { tickets: string[]; messages: string[] } {
  return {
    tickets: Array.from(ticketProviders.keys()),
    messages: Array.from(messageProviders.keys()),
  };
}

// Re-export types
export * from './types.js';
