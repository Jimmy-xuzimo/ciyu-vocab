// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import type { LexiconBundle } from './types';
import { createInitialState, markWordLearned, STORAGE_KEY } from './engine/study';

Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });

const fixture: LexiconBundle = {
  version: 1,
  books: [{ id: 'senior-high', title: '高中', subtitle: '高考核心词汇', color: 'orange' }],
  sources: [
    { id: 'word3500', title: 'pluto0x0/word3500', url: 'https://github.com/pluto0x0/word3500', license: 'MIT' },
    { id: 'kylebing', title: 'KyleBing/english-vocabulary', url: 'https://github.com/KyleBing/english-vocabulary', license: 'BSD-3-Clause' },
    { id: 'user-cet4-pdf', title: '用户提供的大学英语四级词汇 PDF（乱序版）', license: '用户提供资料；公开再分发许可尚未核实' },
    { id: 'user-cet6-pdf', title: '用户提供的大学英语六级词汇 PDF（乱序版）', license: '用户提供资料；公开再分发许可尚未核实' },
  ],
  bookCounts: { 'senior-high': 4 },
  words: [
    { id: 'blue', word: 'blue', phonetic: '', meanings: [{ pos: 'adj', text: '蓝色的' }], books: ['senior-high'], sources: [] },
    { id: 'brave', word: 'brave', phonetic: '', meanings: [{ pos: 'adj', text: '勇敢的' }], books: ['senior-high'], sources: [] },
    { id: 'river', word: 'river', phonetic: '', meanings: [{ pos: 'n', text: '河流' }], books: ['senior-high'], sources: [] },
    { id: 'quiet', word: 'quiet', phonetic: '', meanings: [{ pos: 'adj', text: '安静的' }], books: ['senior-high'], sources: [] },
  ],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.mode;
});

describe('daily quiz flow', () => {
  it('shows source and license information in the learning report', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '学习报告' }));

    expect(await screen.findByText('词书来源与许可')).toBeTruthy();
    expect(screen.getAllByText('用户提供资料；公开再分发许可尚未核实')).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: '来源项目' }).map((link) => link.getAttribute('href')))
      .toContain('https://github.com/pluto0x0/word3500');
    expect(screen.getAllByRole('link', { name: '完整许可' }).map((link) => link.getAttribute('href')))
      .toContain('/licenses/word3500-MIT.txt');
  });

  it('completes four-choice questions and persists the daily score', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /每日测验/ }));
    expect(await screen.findByText('选择正确的中文释义')).toBeTruthy();

    for (let index = 0; index < fixture.words.length; index += 1) {
      const options = screen.getAllByRole('button').filter((button) => button.classList.contains('quiz-option'));
      expect(options).toHaveLength(4);
      fireEvent.click(options[0]);
      const nextButton = screen.getByRole('button', { name: /下一题|查看测验结果/ });
      fireEvent.click(nextButton);
    }

    expect(await screen.findByText('每日测验完成')).toBeTruthy();
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      const today = new Date().toISOString().slice(0, 10);
      expect(saved.activity[today].quizzes).toHaveLength(1);
      expect(saved.activity[today].quizzes[0]).toMatchObject({ mode: 'daily', total: 4 });
    });
  });

  it('draws only learned words for review and saves review answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    }));
    const now = new Date();
    const initial = fixture.words.reduce(
      (state, word) => markWordLearned(state, word.id, now),
      createInitialState('senior-high'),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /已学复习/ }));
    expect(await screen.findByText('只从已经学过的单词中出题')).toBeTruthy();

    for (let index = 0; index < fixture.words.length; index += 1) {
      const options = screen.getAllByRole('button').filter((button) => button.classList.contains('quiz-option'));
      expect(options).toHaveLength(4);
      fireEvent.click(options[0]);
      fireEvent.click(screen.getByRole('button', { name: /下一题|查看测验结果/ }));
    }

    expect(await screen.findByText('已学复习完成')).toBeTruthy();
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      const today = new Date().toISOString().slice(0, 10);
      expect(saved.activity[today].reviewedIds).toHaveLength(4);
      expect(saved.activity[today].quizzes[0]).toMatchObject({ mode: 'review', total: 4 });
      expect(Object.values(saved.progress).every((progress) => progress.lastReviewedAt)).toBe(true);
    });
  });
});


describe('appearance preferences', () => {
  it('defaults to system, saves explicit mode and palette, and restores them on remount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fixture }));
    const view = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '打开设置' }));
    expect(screen.getByRole('button', { name: '跟随系统' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '深色模式' }));
    fireEvent.click(screen.getByRole('button', { name: '海盐蓝' }));
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(document.documentElement.dataset.palette).toBe('ocean');
    view.unmount();
    render(<App />);
    await screen.findByRole('button', { name: '打开设置' });
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(document.documentElement.dataset.palette).toBe('ocean');
  });
  it('does not echo an identical cross-tab storage event back into localStorage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fixture }));
    render(<App />);
    await screen.findByRole('button', { name: '打开设置' });
    const saved = localStorage.getItem(STORAGE_KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: saved }));
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });
});
