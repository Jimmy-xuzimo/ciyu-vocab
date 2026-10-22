import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WordEntry } from '../types';
import {
  createInitialState,
  createQuiz,
  getNewWords,
  getBookWords,
  getReviewWords,
  markWordLearned,
  migrateLegacyProgress,
  normalizeWordKey,
  primaryMeaning,
  recordReviewAnswer,
} from './study';

const words: WordEntry[] = [
  { id: 'word:apple', word: 'apple', phonetic: '', meanings: [{ pos: 'n', text: '苹果' }], books: ['junior-high', 'cet4'], sources: [] },
  { id: 'word:apply', word: 'apply', phonetic: '', meanings: [{ pos: 'v', text: '申请；应用' }], books: ['cet4'], sources: [] },
  { id: 'word:april', word: 'April', phonetic: '', meanings: [{ pos: 'n', text: '四月' }], books: ['junior-high'], sources: [] },
  { id: 'word:apron', word: 'apron', phonetic: '', meanings: [{ pos: 'n', text: '围裙' }], books: ['cet4'], sources: [] },
  { id: 'word:approach', word: 'approach', phonetic: '', meanings: [{ pos: 'v', text: '靠近' }], books: ['cet4'], sources: [] },
];

describe('word identity and cross-book progress', () => {
  it('normalizes case, Unicode apostrophes, and dash variants consistently', () => {
    expect(normalizeWordKey('  Co‑operate ')).toBe('co-operate');
    expect(normalizeWordKey("DON’T")).toBe("don't");
  });

  it('does not offer a learned shared word as new in another book', () => {
    const state = markWordLearned(createInitialState(), 'word:apple', new Date('2026-10-22T08:00:00Z'));
    const newCet4 = getNewWords(words, 'cet4', state.progress, 10, () => 0.5);
    expect(newCet4.map((word) => word.id)).not.toContain('word:apple');
    expect(newCet4).toHaveLength(3);
  });

  it('migrates learned IDs from the original app even when the new ID changed', () => {
    const legacyWord: WordEntry = {
      ...words[0],
      id: 'word:a',
      word: 'a',
      legacyIds: ['wd_aan'],
    };
    const migrated = migrateLegacyProgress(
      createInitialState(),
      [legacyWord],
      ['wd_aan'],
      new Date('2026-10-22T08:00:00Z'),
    );
    expect(migrated.progress['word:a']).toBeDefined();
  });
});

describe('review and quiz behavior', () => {
  it('draws review questions only from globally learned words', () => {
    const state = markWordLearned(createInitialState(), 'word:apple', new Date('2026-10-22T08:00:00Z'));
    const review = getReviewWords(words, state.progress, 30, new Date('2026-10-22T12:00:00Z'), () => 0.5);
    expect(review).toEqual([words[0]]);
  });

  it('creates four distinct meaning choices and marks the correct choice', () => {
    const questions = createQuiz(words, 5, words, () => 0.4);
    expect(questions).toHaveLength(5);
    for (const question of questions) {
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options.map(normalizeWordKey)).size).toBe(4);
      expect(question.options[question.correctIndex]).toBe(primaryMeaning(question.word));
    }
  });

  it('does not create a multiple-choice question without three distinct distractors', () => {
    expect(createQuiz(words.slice(0, 3), 3, words.slice(0, 3))).toHaveLength(0);
  });

  it('moves correct reviews out while missed words return tomorrow', () => {
    const now = new Date('2026-10-22T08:00:00Z');
    const learned = markWordLearned(createInitialState(), 'word:apple', now);
    const correct = recordReviewAnswer(learned, 'word:apple', true, now);
    const missed = recordReviewAnswer(learned, 'word:apple', false, now);
    expect(correct.progress['word:apple'].intervalDays).toBe(1);
    expect(correct.progress['word:apple'].repetitions).toBe(1);
    expect(missed.progress['word:apple'].intervalDays).toBe(1);
    expect(missed.progress['word:apple'].repetitions).toBe(0);
    expect(missed.progress['word:apple'].lapses).toBe(1);
    expect(Date.parse(missed.progress['word:apple'].nextReviewAt)).toBeGreaterThan(now.getTime());
  });
});


describe('full lexicon regressions', () => {
  it('generates twenty questions from the real lexicon without quadratic work', () => {
    const bundle = JSON.parse(readFileSync('public/data/lexicon.json', 'utf-8'));
    const start = performance.now();
    const questions = createQuiz(getBookWords(bundle.words, 'senior-high'), 20, bundle.words);
    expect(questions).toHaveLength(20);
    expect(performance.now() - start).toBeLessThan(1500);
    for (const question of questions) expect(new Set(question.options.map(normalizeWordKey)).size).toBe(4);
  });
  it('merges both high school lists and preserves word identities', () => {
    const bundle = JSON.parse(readFileSync('public/data/lexicon.json', 'utf-8'));
    expect(bundle.books).toHaveLength(8);
    expect(bundle.books.find((book: { id: string }) => book.id === 'gaokao')).toBeUndefined();
    expect(getBookWords(bundle.words, 'senior-high')).toHaveLength(3900);
    expect(new Set(bundle.words.map((word: WordEntry) => normalizeWordKey(word.word))).size).toBe(bundle.words.length);
  });
});
