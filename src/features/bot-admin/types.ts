export type Platform = 'twitch' | 'youtube' | 'kick';

export type ConversationalMode = 'off' | 'passive' | 'helpful' | 'chatty';

export interface TrackedStreamer {
  _id: string;
  platform: Platform;
  platformChannelId: string;
  platformLogin: string;
  displayName?: string;
  accentColor?: string;
  profileImageUrl?: string;
  discordUserId?: string;
  enabled: boolean;
  createdAt: number;
}

export interface ChannelConfig {
  _id: string;
  channelId: string;
  channelName?: string;
  guildId?: string;
  mode: ConversationalMode;
  cooldownMin: number;
  lastBotMsgTs?: number;
  personality?: string;
  updatedAt: number;
}

export interface BotMember {
  _id: string;
  discordUserId: string;
  username: string;
  displayName?: string;
  avatar?: string;
  joinedAt?: number;
  roles: string[];
  optedOut?: boolean;
}

export interface ReactionRole {
  _id: string;
  messageId: string;
  channelId: string;
  emoji: string;
  roleId: string;
  description?: string;
}

export interface ServerPersonality {
  scope: string;
  lexicon: string[];
  styleNotes: string;
  exampleMessages: string[];
  communityFacts?: string;
  sampleSize: number;
  lastLearnedAt: number;
}

export interface BotInterventionLog {
  _id: string;
  _creationTime: number;
  channelId: string;
  decision: string;
  confidence?: number;
  reason?: string;
  messageSnippet?: string;
}
