
export enum SessionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR'
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface SummaryPoint {
  title: string;
  description: string;
  correction?: string;
}

export interface SessionSummary {
  mainTopics: string[];
  learningPoints: SummaryPoint[];
  encouragement: string;
}
