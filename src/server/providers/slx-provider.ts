// Wrapper around existing slx-service.ts

import crypto from 'crypto';
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

    // Convert mentions - use deterministic IDs based on content hash
    for (const mention of data.mentions || []) {
      const timestamp = mention.timestamp || new Date().toISOString();
      const channel = mention.channel || 'unknown';
      const author = mention.author || 'unknown';
      const content = mention.text || '';
      
      // Generate deterministic ID from content hash
      const idSource = `${channel}-${author}-${timestamp}-${content}`;
      const hash = crypto.createHash('sha256').update(idSource).digest('hex').slice(0, 16);
      const id = `slx-${hash}`;
      
      messages.push({
        id,
        channel,
        author,
        text: content,
        timestamp,
      });
    }

    return messages;
  }

  async configure(config: SlxConfig): Promise<void> {
    this.config = config;
  }
}

export const slxProvider = new SlxProvider();
