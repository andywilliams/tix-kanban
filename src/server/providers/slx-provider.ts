// Wrapper around existing slx-service.ts

import { MessageProvider, MessageData } from './types.js';
import { getSlxConfig, runSlxSync, getSlackData, SlxConfig } from '../slx-service.js';

export class SlxProvider implements MessageProvider {
  name = 'slx';
  private config: SlxConfig | null = null;

  async sync(): Promise<MessageData[]> {
    if (!this.config) {
      this.config = await getSlxConfig();
    }

    if (!this.config) {
      return [];
    }

    // Run slx sync first
    const lookback = this.config.sync?.lookbackHours || 24;
    const result = await runSlxSync(lookback);
    
    if (!result.success) {
      console.error('SlxProvider sync failed:', result.error);
      return [];
    }

    // Then fetch the synced data
    const data = await getSlackData();
    const messages: MessageData[] = [];

    // Convert mentions - use deterministic IDs based on channel+author+timestamp
    for (const mention of data.mentions || []) {
      const timestamp = mention.timestamp || new Date().toISOString();
      messages.push({
        id: `slx-${mention.channel}-${mention.author}-${timestamp}`,
        channel: mention.channel || 'unknown',
        author: mention.author || 'unknown',
        text: mention.text || '',
        timestamp: mention.timestamp || new Date().toISOString(),
      });
    }

    return messages;
  }

  async configure(config: SlxConfig): Promise<void> {
    this.config = config;
  }
}

export const slxProvider = new SlxProvider();
