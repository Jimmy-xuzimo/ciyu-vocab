import type { LearningState, QuizQuestion, WordEntry, WordProgress } from '../types';

export const STORAGE_KEY = 'lexiday-learning-v2';
export const LEGACY_STORAGE_KEY = 'gaokao-learned';

export function dayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeWordKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘`]/g, "'")
    .replace(/\s*[-‐‑‒–—]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
}

export function legacyIdForWord(word: string): string {
  return `wd_${word.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '')}`;
}

export function createInitialState(selectedBookId = 'senior-high'): LearningState {
  return {
    version: 2,
    selectedBookId,
    dailyNewGoal: 20,
    dailyReviewGoal: 30,
    progress: {},
    activity: {},
  };
}

export function parseLearningState(raw: string | null): LearningState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LearningState>;
    if (value.version !== 2 || !value.progress || !value.activity) return null;
    return {
      ...createInitialState(value.selectedBookId),
      ...value,
      dailyNewGoal: clampGoal(value.dailyNewGoal, 20, 1, 100),
      dailyReviewGoal: clampGoal(value.dailyReviewGoal, 30, 4, 100),
      progress: value.progress,
      activity: value.activity,
    };
  } catch {
    return null;
  }
}

export function clampGoal(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

export function migrateLegacyProgress(
  state: LearningState,
  words: WordEntry[],
  legacyIds: string[],
  now = new Date(),
): LearningState {
  const legacy = new Set(legacyIds);
  const progress = { ...state.progress };
  const timestamp = now.toISOString();
  for (const word of words) {
    const ids = word.legacyIds?.length ? word.legacyIds : [legacyIdForWord(word.word)];
    if (!progress[word.id] && ids.some((id) => legacy.has(id))) {
      progress[word.id] = {
        firstLearnedAt: timestamp,
        lastReviewedAt: null,
        nextReviewAt: timestamp,
        intervalDays: 0,
        repetitions: 0,
        lapses: 0,
      };
    }
  }
  return { ...state, progress };
}

export function getBookWords(words: WordEntry[], bookId: string): WordEntry[] {
  return words.filter((word) => word.books.includes(bookId));
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function getNewWords(
  words: WordEntry[],
  bookId: string,
  progress: Record<string, WordProgress>,
  count: number,
  random: () => number = Math.random,
): WordEntry[] {
  const unseen = words.filter((word) => word.books.includes(bookId) && !progress[word.id]);
  return shuffle(unseen, random).slice(0, Math.max(0, count));
}

export function getReviewWords(
  words: WordEntry[],
  progress: Record<string, WordProgress>,
  count: number,
  now = new Date(),
  random: () => number = Math.random,
): WordEntry[] {
  const learned = words.filter((word) => Boolean(progress[word.id]));
  const due = learned.filter((word) => Date.parse(progress[word.id].nextReviewAt) <= now.getTime());
  const notDue = learned.filter((word) => Date.parse(progress[word.id].nextReviewAt) > now.getTime());
  return [...shuffle(due, random), ...shuffle(notDue, random)].slice(0, Math.max(0, count));
}

export function getDueCount(
  words: WordEntry[],
  progress: Record<string, WordProgress>,
  now = new Date(),
): number {
  return words.reduce((total, word) => {
    const item = progress[word.id];
    return total + (item && Date.parse(item.nextReviewAt) <= now.getTime() ? 1 : 0);
  }, 0);
}

export function getTodayActivity(state: LearningState, now = new Date()) {
  return state.activity[dayKey(now)] ?? { newIds: [], reviewedIds: [], quizzes: [] };
}

export function markWordLearned(
  state: LearningState,
  wordId: string,
  now = new Date(),
): LearningState {
  if (state.progress[wordId]) return state;
  const timestamp = now.toISOString();
  const today = dayKey(now);
  const currentActivity = getTodayActivity(state, now);
  return {
    ...state,
    progress: {
      ...state.progress,
      [wordId]: {
        firstLearnedAt: timestamp,
        lastReviewedAt: null,
        nextReviewAt: timestamp,
        intervalDays: 0,
        repetitions: 0,
        lapses: 0,
      },
    },
    activity: {
      ...state.activity,
      [today]: {
        ...currentActivity,
        newIds: currentActivity.newIds.includes(wordId)
          ? currentActivity.newIds
          : [...currentActivity.newIds, wordId],
      },
    },
  };
}

export function recordReviewAnswer(
  state: LearningState,
  wordId: string,
  correct: boolean,
  now = new Date(),
): LearningState {
  const previous = state.progress[wordId];
  if (!previous) return state;
  const repetitions = correct ? previous.repetitions + 1 : 0;
  const intervalDays = correct
    ? [1, 3, 7, 14, 30, 60][Math.min(repetitions - 1, 5)]
    : 1;
  const today = dayKey(now);
  const currentActivity = getTodayActivity(state, now);
  const progress = {
    ...state.progress,
    [wordId]: {
      ...previous,
      lastReviewedAt: now.toISOString(),
      nextReviewAt: addDays(now, intervalDays).toISOString(),
      intervalDays,
      repetitions,
      lapses: correct ? previous.lapses : previous.lapses + 1,
    },
  };
  return {
    ...state,
    progress,
    activity: {
      ...state.activity,
      [today]: {
        ...currentActivity,
        reviewedIds: currentActivity.reviewedIds.includes(wordId)
          ? currentActivity.reviewedIds
          : [...currentActivity.reviewedIds, wordId],
      },
    },
  };
}

export function recordQuizResult(
  state: LearningState,
  mode: 'daily' | 'review',
  score: number,
  total: number,
  now = new Date(),
): LearningState {
  const today = dayKey(now);
  const currentActivity = getTodayActivity(state, now);
  return {
    ...state,
    activity: {
      ...state.activity,
      [today]: {
        ...currentActivity,
        quizzes: [...currentActivity.quizzes, { mode, score, total }],
      },
    },
  };
}

export function primaryMeaning(word: WordEntry): string {
  const meaning = word.meanings.find((item) => item.text.trim());
  if (!meaning) return '';
  const pos = meaning.pos.trim();
  return pos ? `${pos}. ${meaning.text}` : meaning.text;
}

export function createQuiz(
  questionsFrom: WordEntry[],
  count: number,
  distractorPool: WordEntry[] = questionsFrom,
  random: () => number = Math.random,
): QuizQuestion[] {
  const distractors = new Map<string, string>();
  for (const word of distractorPool) {
    const meaning = primaryMeaning(word);
    if (meaning) distractors.set(normalizeWordKey(meaning), meaning);
  }
  const shuffledPool = shuffle([...distractors.entries()], random);
  const available = questionsFrom.filter((word) => {
    const correct = primaryMeaning(word);
    if (!correct) return false;
    return distractors.size - Number(distractors.has(normalizeWordKey(correct))) >= 3;
  });
  return shuffle(available, random).slice(0, Math.max(0, count)).map((word) => {
    const correct = primaryMeaning(word);
    const correctKey = normalizeWordKey(correct);
    const options = [correct];
    const offset = Math.floor(random() * shuffledPool.length);
    for (let index = 0; index < shuffledPool.length && options.length < 4; index += 1) {
      const [key, meaning] = shuffledPool[(offset + index) % shuffledPool.length];
      if (key !== correctKey) options.push(meaning);
    }
    const shuffledOptions = shuffle(options, random);
    return { word, options: shuffledOptions, correctIndex: shuffledOptions.indexOf(correct) };
  });
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function quizScore(answers: Array<number | null>, questions: QuizQuestion[]): number {
  return questions.reduce(
    (score, question, index) => score + (answers[index] === question.correctIndex ? 1 : 0),
    0,
  );
}
