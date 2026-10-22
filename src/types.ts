export interface Meaning {
  pos: string;
  text: string;
}

export interface BookDefinition {
  id: string;
  title: string;
  subtitle: string;
  color: string;
}

export interface LexiconSource {
  id: string;
  title: string;
  url?: string;
  license: string;
}

export interface ExampleSentence {
  english: string;
  chinese: string;
}

export interface WordEntry {
  id: string;
  word: string;
  phonetic: string;
  meanings: Meaning[];
  example?: ExampleSentence | null;
  books: string[];
  sources: string[];
  aliases?: string[];
  legacyIds?: string[];
}

export interface LexiconBundle {
  version: number;
  books: BookDefinition[];
  sources: LexiconSource[];
  bookCounts: Record<string, number>;
  words: WordEntry[];
}

export interface WordProgress {
  firstLearnedAt: string;
  lastReviewedAt: string | null;
  nextReviewAt: string;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

export interface DayActivity {
  newIds: string[];
  reviewedIds: string[];
  quizzes: Array<{ mode: 'daily' | 'review'; score: number; total: number }>;
}

export interface LearningState {
  version: 2;
  selectedBookId: string;
  dailyNewGoal: number;
  dailyReviewGoal: number;
  progress: Record<string, WordProgress>;
  activity: Record<string, DayActivity>;
}

export interface QuizQuestion {
  word: WordEntry;
  options: string[];
  correctIndex: number;
}
