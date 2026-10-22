import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { greeting, readPreferences, PREFERENCES_KEY } from './engine/preferences';
import type { Preferences } from './engine/preferences';
import type { BookDefinition, LearningState, LexiconBundle, QuizQuestion, WordEntry } from './types';
import {
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  clampGoal,
  createInitialState,
  createQuiz,
  dayKey,
  getBookWords,
  getDueCount,
  getNewWords,
  getReviewWords,
  getTodayActivity,
  markWordLearned,
  migrateLegacyProgress,
  normalizeWordKey,
  primaryMeaning,
  quizScore,
  recordQuizResult,
  recordReviewAnswer,
} from './engine/study';

type Screen = 'home' | 'books' | 'dictionary' | 'progress' | 'study' | 'quiz' | 'settings';
type QuizMode = 'daily' | 'review';

interface StudySession {
  queue: WordEntry[];
  index: number;
  learned: number;
}

interface QuizSession {
  mode: QuizMode;
  questions: QuizQuestion[];
  answers: Array<number | null>;
  index: number;
  complete: boolean;
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function loadSavedState(): LearningState {
  return parseLearningStateSafe(safeRead(STORAGE_KEY)) ?? createInitialState();
}

function parseLearningStateSafe(raw: string | null): LearningState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as LearningState;
    if (value.version !== 2 || !value.progress || !value.activity) return null;
    return {
      ...createInitialState(value.selectedBookId),
      ...value,
      selectedBookId: value.selectedBookId === 'gaokao' ? 'senior-high' : value.selectedBookId,
      dailyNewGoal: clampGoal(value.dailyNewGoal, 20, 1, 100),
      dailyReviewGoal: clampGoal(value.dailyReviewGoal, 30, 4, 100),
    };
  } catch {
    return null;
  }
}

function App() {
  const [now, setNow] = useState(() => new Date());
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const todayLabel = dateFormatter.format(now);
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.mode = preferences.appearance === 'system' ? (media.matches ? 'dark' : 'light') : preferences.appearance;
      document.documentElement.style.colorScheme = document.documentElement.dataset.mode;
      document.documentElement.dataset.palette = preferences.palette;
    };
    apply();
    media.addEventListener('change', apply);
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Keep preferences for this session. */ }
    return () => media.removeEventListener('change', apply);
  }, [preferences]);
  const [bundle, setBundle] = useState<LexiconBundle | null>(null);
  const [loadError, setLoadError] = useState('');
  const [learning, setLearning] = useState<LearningState>(loadSavedState);
  const [hasSavedState] = useState(() => Boolean(safeRead(STORAGE_KEY)));
  const migrationAttempted = useRef(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [study, setStudy] = useState<StudySession | null>(null);
  const [quiz, setQuiz] = useState<QuizSession | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [search, setSearch] = useState('');
  const [dictionaryBook, setDictionaryBook] = useState('all');

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2700);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/lexicon.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('词库文件读取失败');
        return response.json() as Promise<LexiconBundle>;
      })
      .then((data) => {
        if (data.version !== 1 || !Array.isArray(data.words) || !Array.isArray(data.books)) {
          throw new Error('词库格式不正确');
        }
        setBundle(data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(error instanceof Error ? error.message : '词库暂时无法加载，请刷新重试。');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!bundle || migrationAttempted.current) return;
    migrationAttempted.current = true;
    if (hasSavedState) return;
    const rawLegacy = safeRead(LEGACY_STORAGE_KEY);
    if (!rawLegacy) return;
    try {
      const oldIds: unknown = JSON.parse(rawLegacy);
      if (Array.isArray(oldIds) && oldIds.every((item) => typeof item === 'string')) {
        setLearning((current) => migrateLegacyProgress(current, bundle.words, oldIds));
        showToast('已把旧版的学习进度带到新版本');
      }
    } catch {
      // Keep the new app usable if an older browser stored malformed progress.
    }
  }, [bundle, hasSavedState, showToast]);

  useEffect(() => {
    if (!bundle) return;
    if (!bundle.books.some((book) => book.id === learning.selectedBookId)) {
      setLearning((state) => ({ ...state, selectedBookId: bundle.books[0]?.id ?? 'senior-high' }));
    }
  }, [bundle, learning.selectedBookId]);

  useEffect(() => {
    if (!bundle) return;
    try {
      const serialized = JSON.stringify(learning);
      if (safeRead(STORAGE_KEY) !== serialized) window.localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      showToast('设备存储空间不足，学习记录暂未保存');
    }
  }, [bundle, learning, showToast]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      const next = parseLearningStateSafe(event.newValue);
      if (next) setLearning((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const selectedBook = bundle?.books.find((book) => book.id === learning.selectedBookId) ?? bundle?.books[0];
  const selectedWords = useMemo(
    () => (bundle ? getBookWords(bundle.words, learning.selectedBookId) : []),
    [bundle, learning.selectedBookId],
  );
  const learnedCount = useMemo(
    () => (bundle ? bundle.words.reduce((count, word) => count + Number(Boolean(learning.progress[word.id])), 0) : 0),
    [bundle, learning.progress],
  );
  const learnedInBook = useMemo(
    () => selectedWords.reduce((count, word) => count + Number(Boolean(learning.progress[word.id])), 0),
    [selectedWords, learning.progress],
  );
  const todayActivity = getTodayActivity(learning);
  const dueCount = bundle ? getDueCount(bundle.words, learning.progress) : 0;
  const remainingNew = Math.max(0, learning.dailyNewGoal - todayActivity.newIds.length);

  function chooseBook(bookId: string) {
    setLearning((state) => ({ ...state, selectedBookId: bookId }));
    setScreen('home');
  }

  function startStudy() {
    if (!bundle) return;
    if (remainingNew <= 0) {
      showToast('今天的新词目标已经完成，明天再学新词也可以');
      return;
    }
    const queue = getNewWords(bundle.words, learning.selectedBookId, learning.progress, remainingNew);
    if (queue.length === 0) {
      showToast(`${selectedBook?.title ?? '这本词书'}已经学完，可以切换词书或去复习`);
      return;
    }
    setStudy({ queue, index: 0, learned: 0 });
    setScreen('study');
  }

  function startQuiz(mode: QuizMode) {
    if (!bundle) return;
    const source = mode === 'review'
      ? getReviewWords(bundle.words, learning.progress, learning.dailyReviewGoal)
      : selectedWords;
    if (source.length === 0) {
      showToast(mode === 'review' ? '先学会几个单词，再来做复习测验吧' : '这本词书暂时没有可测的词条');
      return;
    }
    const questions = createQuiz(source, mode === 'review' ? learning.dailyReviewGoal : 20, bundle.words);
    if (questions.length === 0) {
      showToast('这些词暂时没有可用释义');
      return;
    }
    setQuiz({ mode, questions, answers: questions.map(() => null), index: 0, complete: false });
    setScreen('quiz');
  }

  function answerQuestion(optionIndex: number) {
    if (!quiz || quiz.complete || quiz.answers[quiz.index] !== null) return;
    const question = quiz.questions[quiz.index];
    const correct = optionIndex === question.correctIndex;
    setQuiz((session) => session
      ? { ...session, answers: session.answers.map((answer, index) => index === session.index ? optionIndex : answer) }
      : session);
    if (quiz.mode === 'review') {
      setLearning((state) => recordReviewAnswer(state, question.word.id, correct));
    }
  }

  function advanceQuiz() {
    if (!quiz || quiz.answers[quiz.index] === null) return;
    if (quiz.index + 1 < quiz.questions.length) {
      setQuiz((session) => session ? { ...session, index: session.index + 1 } : session);
      return;
    }
    const score = quizScore(quiz.answers, quiz.questions);
    setLearning((state) => recordQuizResult(state, quiz.mode, score, quiz.questions.length));
    setQuiz((session) => session ? { ...session, complete: true } : session);
  }

  async function installApp() {
    if (!installPrompt) {
      showToast('可在浏览器菜单中选择“安装词屿”或“创建快捷方式”');
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') showToast('词屿已添加到桌面');
    setInstallPrompt(null);
  }

  function updateGoal(event: ChangeEvent<HTMLInputElement>, key: 'dailyNewGoal' | 'dailyReviewGoal') {
    const value = Number(event.currentTarget.value);
    if (Number.isFinite(value)) {
      setLearning((state) => ({
        ...state,
        [key]: clampGoal(value, key === 'dailyNewGoal' ? 20 : 30, key === 'dailyNewGoal' ? 1 : 4, 100),
      }));
    }
  }

  if (!bundle) {
    return (
      <div className="loading-screen">
        <div className="loading-mark">屿</div>
        <div className="loading-copy">
          <strong>{loadError ? '词库加载遇到问题' : '正在整理你的词库'}</strong>
          <span>{loadError || '初中、高考、四六级、雅思与进阶词书即将就绪'}</span>
        </div>
        {loadError && <button className="button button-primary" onClick={() => window.location.reload()}>重新加载</button>}
      </div>
    );
  }

  const pageHeading: Record<Screen, string> = {
    home: '今日学习',
    books: '我的词书',
    dictionary: '词典',
    progress: '学习报告',
    settings: '设置',
    study: '新词学习',
    quiz: quiz?.mode === 'review' ? '已学复习' : '每日测验',
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setScreen('home')} aria-label="返回今日学习">
          <span className="brand-mark">屿</span>
          <span><strong>词屿</strong><small>WORD ISLAND</small></span>
        </button>

        <div className="side-section-label">学习空间</div>
        <nav className="side-nav" aria-label="主导航">
          <NavButton icon="home" label="今日学习" active={screen === 'home'} onClick={() => setScreen('home')} />
          <NavButton icon="books" label="我的词书" active={screen === 'books'} onClick={() => setScreen('books')} />
          <NavButton icon="search" label="词典" active={screen === 'dictionary'} onClick={() => setScreen('dictionary')} />
          <NavButton icon="chart" label="学习报告" active={screen === 'progress'} onClick={() => setScreen('progress')} />
          <NavButton icon="settings" label="设置" active={screen === 'settings'} onClick={() => setScreen('settings')} />
        </nav>

        <div className="sidebar-book">
          <div className="side-section-label">当前词书</div>
          <button className="current-book" onClick={() => setScreen('books')}>
            <span className={`book-mini ${selectedBook?.color ?? 'mint'}`}>A</span>
            <span className="current-book-copy"><strong>{selectedBook?.title ?? '选择词书'}</strong><small>{learnedInBook.toLocaleString()} / {selectedWords.length.toLocaleString()} 已学</small></span>
            <Icon name="chevron" size={16} />
          </button>
        </div>

        <div className="sidebar-bottom">
          <a className="platform-card" href="https://Jimmy-xuzimo.github.io/ciyu/" target="_blank" rel="noreferrer">
            <div className="platform-icon"><Icon name="download" size={17} /></div>
            <div><strong>随时继续学习</strong><p>网页、电脑、安卓共用词库</p></div>
            <span className="platform-install"><Icon name="arrow" size={15} /></span>
          </a>
          <div className="sidebar-footer"><span className="online-dot" /> 离线可用 <span className="footer-divider">·</span> 数据保存在本机</div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-title">
            <div className="mobile-brand"><span className="brand-mark">屿</span><strong>词屿</strong></div>
            <span className="topbar-context">{pageHeading[screen]}</span>
          </div>
          <div className="topbar-actions">
            <div className="date-pill"><Icon name="sun" size={16} /> <span>{todayLabel}</span></div>
            <button className="install-button" onClick={installApp}><Icon name="download" size={16} /> <span>安装桌面版</span></button>
            <button className="theme-toggle" onClick={() => setPreferences((current) => ({ ...current, appearance: document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark' }))} aria-label="切换深浅模式"><Icon name="sun" size={18} /></button>
            <button className="theme-toggle" onClick={() => setScreen('settings')} aria-label="打开设置"><Icon name="settings" size={18} /></button>
          </div>
        </header>

        <main className="page-content">
          {screen === 'home' && (
            <HomeScreen
              now={now}
              bundle={bundle}
              selectedBook={selectedBook}
              selectedWords={selectedWords}
              learning={learning}
              learnedCount={learnedCount}
              learnedInBook={learnedInBook}
              todayNewCount={todayActivity.newIds.length}
              reviewCount={todayActivity.reviewedIds.length}
              dueCount={dueCount}
              remainingNew={remainingNew}
              onStartStudy={startStudy}
              onDailyQuiz={() => startQuiz('daily')}
              onReview={() => startQuiz('review')}
              onBooks={() => setScreen('books')}
              onDictionary={() => setScreen('dictionary')}
              onChooseBook={chooseBook}
            />
          )}
          {screen === 'settings' && <SettingsScreen preferences={preferences} onChange={setPreferences} learning={learning} onNewGoal={(event) => updateGoal(event, 'dailyNewGoal')} onReviewGoal={(event) => updateGoal(event, 'dailyReviewGoal')} onInstall={installApp} />}
          {screen === 'books' && (
            <BooksScreen
              bundle={bundle}
              learning={learning}
              onChoose={chooseBook}
              onStartStudy={startStudy}
            />
          )}
          {screen === 'dictionary' && (
            <DictionaryScreen
              bundle={bundle}
              learning={learning}
              search={search}
              activeBook={dictionaryBook}
              onSearch={setSearch}
              onSelectBook={setDictionaryBook}
              onMark={(id) => setLearning((state) => markWordLearned(state, id))}
            />
          )}
          {screen === 'progress' && (
            <ProgressScreen
              bundle={bundle}
              learning={learning}
              learnedCount={learnedCount}
              dueCount={dueCount}
              todayNewCount={todayActivity.newIds.length}
              onNewGoal={(event) => updateGoal(event, 'dailyNewGoal')}
              onReviewGoal={(event) => updateGoal(event, 'dailyReviewGoal')}
              onExport={() => exportProgress(learning, showToast)}
              onImport={(state) => setLearning(state)}
            />
          )}
          {screen === 'study' && study && (
            <StudyScreen
              session={study}
              book={selectedBook}
              dailyGoal={learning.dailyNewGoal}
              todayCount={todayActivity.newIds.length}
              onLearn={(word) => {
                setLearning((state) => markWordLearned(state, word.id));
                setStudy((state) => state ? { ...state, index: state.index + 1, learned: state.learned + 1 } : state);
              }}
              onSkip={() => setStudy((state) => state ? { ...state, index: state.index + 1 } : state)}
              onExit={() => { setScreen('home'); setStudy(null); }}
            />
          )}
          {screen === 'quiz' && quiz && (
            <QuizScreen
              session={quiz}
              onAnswer={answerQuestion}
              onNext={advanceQuiz}
              onExit={() => { setScreen('home'); setQuiz(null); }}
              onRestart={() => startQuiz(quiz.mode)}
            />
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="手机导航">
        <NavButton icon="home" label="首页" active={screen === 'home'} onClick={() => setScreen('home')} compact />
        <NavButton icon="books" label="词书" active={screen === 'books'} onClick={() => setScreen('books')} compact />
        <NavButton icon="search" label="词典" active={screen === 'dictionary'} onClick={() => setScreen('dictionary')} compact />
        <NavButton icon="chart" label="报告" active={screen === 'progress'} onClick={() => setScreen('progress')} compact />
        <NavButton icon="settings" label="设置" active={screen === 'settings'} onClick={() => setScreen('settings')} compact />
      </nav>
      {toast && <div className="toast" role="status"><Icon name="check" size={17} />{toast}</div>}
    </div>
  );
}


function SettingsScreen({ preferences, onChange, learning, onNewGoal, onReviewGoal, onInstall }: {
  preferences: Preferences;
  onChange: (value: Preferences) => void;
  learning: LearningState;
  onNewGoal: (event: ChangeEvent<HTMLInputElement>) => void;
  onReviewGoal: (event: ChangeEvent<HTMLInputElement>) => void;
  onInstall: () => void;
}) {
  return <div className="screen-stack settings-screen">
    <PageIntro eyebrow="让学习更合心意" title="设置" description="选择喜欢的颜色和明暗，让每天的学习更舒服。设置会保存在当前设备。" />
    <section className="report-panel"><div><h2>界面模式</h2><p>默认跟随系统，也可以固定为浅色或深色。</p></div><div className="appearance-options">{([['system', '跟随系统'], ['light', '浅色模式'], ['dark', '深色模式']] as const).map(([value, label]) => <button key={value} className="preference-option" aria-pressed={preferences.appearance === value} onClick={() => onChange({ ...preferences, appearance: value })}><Icon name={value === 'dark' ? 'spark' : 'sun'} size={22} /><strong>{label}</strong>{preferences.appearance === value && <Icon name="check" size={16} />}</button>)}</div></section>
    <section className="report-panel"><div><h2>主题颜色</h2><p>四种配色均支持浅色和深色模式。</p></div><div className="palette-options">{([['forest', '林间绿', '#2d6851'], ['ocean', '海盐蓝', '#377fa5'], ['violet', '鸢尾紫', '#8062b2'], ['amber', '暖杏橙', '#a27036']] as const).map(([value, label, color]) => <button key={value} className="preference-option" aria-pressed={preferences.palette === value} onClick={() => onChange({ ...preferences, palette: value })}><span className="palette-swatch" style={{ background: color }} /><strong>{label}</strong>{preferences.palette === value && <Icon name="check" size={16} />}</button>)}</div></section>
    <section className="report-panel"><div><h2>每日学习目标</h2><p>新词按当前词书学习；复习从所有已经学过的词中抽取。</p></div><div className="goal-controls"><label>每日新词<input type="number" min={1} max={100} value={learning.dailyNewGoal} onChange={onNewGoal} />个</label><label>每日复习<input type="number" min={4} max={100} value={learning.dailyReviewGoal} onChange={onReviewGoal} />个</label></div></section>
    <section className="report-panel"><div><h2>在其他设备上使用</h2><p>词库相同，学习记录可在学习报告中导出和导入。</p></div><div className="backup-actions"><a className="button button-outline" href="https://Jimmy-xuzimo.github.io/ciyu/" target="_blank" rel="noreferrer">访问项目网站 <Icon name="arrow" size={16} /></a><button className="button button-dark" onClick={onInstall}>安装网页应用</button></div></section>
  </div>;
}

function HomeScreen(props: {
  now: Date;
  bundle: LexiconBundle;
  selectedBook?: BookDefinition;
  selectedWords: WordEntry[];
  learning: LearningState;
  learnedCount: number;
  learnedInBook: number;
  todayNewCount: number;
  reviewCount: number;
  dueCount: number;
  remainingNew: number;
  onStartStudy: () => void;
  onDailyQuiz: () => void;
  onReview: () => void;
  onBooks: () => void;
  onDictionary: () => void;
  onChooseBook: (id: string) => void;
}) {
  const progress = props.selectedWords.length ? Math.round(props.learnedInBook / props.selectedWords.length * 100) : 0;
  const canReview = props.learnedCount > 0;
  return (
    <div className="screen-stack">
      <section className="welcome-row">
        <div><div className="eyebrow"><span className="eyebrow-dot" /> 每天进步一点点</div><h1>{greeting(props.now)}，今天也来记几个词吧。</h1><p>把每天的小目标做完，词汇量会在不知不觉中长大。</p></div>
        <div className="welcome-streak"><span className="streak-flame">✦</span><div><strong>{activeDays(props.learning)} <small>天</small></strong><span>近一周学习</span></div></div>
      </section>

      <section className="hero-card">
        <div className="hero-copy">
          <div className="hero-label"><span className="tiny-spark">✦</span> 今日计划 <span className="hero-dot">·</span> {props.selectedBook?.title ?? '高中'}</div>
          <h2>给今天的单词<br /><em>留一点时间。</em></h2>
          <p>今天新词目标 {props.learning.dailyNewGoal} 个，记住一个就向前一步。</p>
          <div className="hero-actions">
            <button className="button button-dark" onClick={props.onStartStudy} disabled={props.remainingNew === 0}>
              <Icon name="play" size={17} /> {props.remainingNew === 0 ? '今日目标已完成' : '开始今日学习'}
            </button>
            <button className="hero-link" onClick={props.onBooks}>更换词书 <Icon name="arrow" size={15} /></button>
          </div>
          <div className="hero-foot"><Icon name="check" size={14} /> 已在其他词书学过的单词，会自动跳过</div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="hero-leaf leaf-one" /><div className="hero-leaf leaf-two" />
          <div className="letter-card"><span className="letter-kicker">WORD OF THE DAY</span><strong>grow</strong><small>/ɡrəʊ/</small><span className="letter-meaning">成长 · 增长</span><span className="letter-sun">✦</span></div>
          <span className="float-dot dot-a" /><span className="float-dot dot-b" /><span className="float-word">learn <b>·</b> remember</span>
        </div>
        <div className="hero-progress"><div className="hero-progress-label"><span>本词书学习进度</span><strong>{props.learnedInBook.toLocaleString()} <small>/ {props.selectedWords.length.toLocaleString()}</small></strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><span className="progress-percent">{progress}%</span></div>
      </section>

      <section className="stat-grid" aria-label="学习统计">
        <StatCard icon="spark" tone="mint" label="今天新学" value={props.todayNewCount} suffix={`/ ${props.learning.dailyNewGoal}`} foot="每天稳步积累" />
        <StatCard icon="clock" tone="peach" label="待复习" value={props.dueCount} suffix="个" foot={props.dueCount ? '温故一下，记得更牢' : '目前没有到期的词'} />
        <StatCard icon="check" tone="lavender" label="已经学会" value={props.learnedCount.toLocaleString()} suffix="词" foot="跨词书统计，不重复计数" />
      </section>

      <section className="section-block">
        <div className="section-heading"><div><div className="eyebrow">学习工具</div><h2>今天想怎么学？</h2></div><span className="section-note">先学，再测，最后复习</span></div>
        <div className="action-grid">
          <ActionCard icon="book" tone="green" title="学习新词" detail={`${props.remainingNew} 个新词待学习`} tag="新词卡片" onClick={props.onStartStudy} />
          <ActionCard icon="quiz" tone="blue" title="每日测验" detail="从当前词书随机抽 20 题" tag="四选一" onClick={props.onDailyQuiz} />
          <ActionCard icon="refresh" tone="orange" title="已学复习" detail={`${props.learnedCount.toLocaleString()} 个词可参加复习`} tag={`随机 ${props.learning.dailyReviewGoal} 词`} onClick={props.onReview} disabled={!canReview} />
        </div>
      </section>

      <section className="section-block books-preview-block">
        <div className="section-heading"><div><div className="eyebrow">从一本词书开始</div><h2>挑选你的学习目标</h2></div><button className="text-button" onClick={props.onBooks}>查看全部词书 <Icon name="arrow" size={15} /></button></div>
        <div className="book-grid book-grid-home">
          {props.bundle.books.slice(0, 6).map((book, index) => {
            const count = props.bundle.bookCounts[book.id] ?? 0;
            const learned = props.bundle.words.reduce((total, word) => total + Number(word.books.includes(book.id) && Boolean(props.learning.progress[word.id])), 0);
            const active = book.id === props.learning.selectedBookId;
            return <BookCard key={book.id} book={book} number={index + 1} count={count} learned={learned} active={active} onClick={() => props.onChooseBook(book.id)} />;
          })}
        </div>
      </section>

      <section className="bottom-strip">
        <div className="strip-icon"><Icon name="search" size={19} /></div><div><strong>想查一个词，或者顺手标记已会的词？</strong><span>去词典搜索，学习进度会保存在本机。</span></div><button className="button button-outline" onClick={props.onDictionary}>打开词典 <Icon name="arrow" size={15} /></button>
      </section>
    </div>
  );
}

function BooksScreen({ bundle, learning, onChoose, onStartStudy }: {
  bundle: LexiconBundle;
  learning: LearningState;
  onChoose: (id: string) => void;
  onStartStudy: () => void;
}) {
  return (
    <div className="screen-stack">
      <PageIntro eyebrow="词汇路线" title="选择一本适合现在的词书。" description="不同考试目标各有一本词书。学过的词会在所有词书间共享进度，不会再次作为新词出现。" />
      <div className="book-route-note"><Icon name="layers" size={19} /><div><strong>全局去重已开启</strong><span>切换词书时，已学单词自动进入复习池；新词只从未学过的词里抽取。</span></div><span>{bundle.words.length.toLocaleString()} <small>去重词条</small></span></div>
      <div className="book-grid book-grid-all">
        {bundle.books.map((book, index) => {
          const count = bundle.words.reduce((total, word) => total + Number(word.books.includes(book.id)), 0);
          const learned = bundle.words.reduce((total, word) => total + Number(word.books.includes(book.id) && Boolean(learning.progress[word.id])), 0);
          return <BookCard key={book.id} book={book} number={index + 1} count={count} learned={learned} active={book.id === learning.selectedBookId} onClick={() => onChoose(book.id)} large />;
        })}
      </div>
      <div className="center-action"><button className="button button-dark" onClick={onStartStudy}><Icon name="play" size={16} /> 开始学习「{bundle.books.find((book) => book.id === learning.selectedBookId)?.title}」</button></div>
    </div>
  );
}

function DictionaryScreen({ bundle, learning, search, activeBook, onSearch, onSelectBook, onMark }: {
  bundle: LexiconBundle;
  learning: LearningState;
  search: string;
  activeBook: string;
  onSearch: (value: string) => void;
  onSelectBook: (id: string) => void;
  onMark: (id: string) => void;
}) {
  const normalizedSearch = normalizeWordKey(search);
  const filtered = useMemo(() => {
    const source = activeBook === 'all' ? bundle.words : bundle.words.filter((word) => word.books.includes(activeBook));
    if (!normalizedSearch) return source;
    return source.filter((word) => {
      const searchText = [word.word, ...(word.aliases ?? []), ...word.meanings.map((meaning) => meaning.text)].join(' ').toLocaleLowerCase('zh-CN');
      return searchText.includes(normalizedSearch);
    });
  }, [activeBook, bundle.words, normalizedSearch]);
  const visible = filtered.slice(0, 120);
  return (
    <div className="screen-stack">
      <PageIntro eyebrow="随时查词" title="把遇到的词，放进自己的词库。" description="支持英文、中文释义和词书筛选。你可以在这里直接标记已学单词。" />
      <div className="dictionary-tools">
        <label className="search-field"><Icon name="search" size={18} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索英文或中文释义" aria-label="搜索英文或中文释义" /><kbd>⌘ K</kbd></label>
        <span className="result-count">{filtered.length.toLocaleString()} 个结果</span>
      </div>
      <div className="filter-chips"><button className={activeBook === 'all' ? 'filter-chip active' : 'filter-chip'} onClick={() => onSelectBook('all')}>全部词书</button>{bundle.books.map((book) => <button key={book.id} className={activeBook === book.id ? 'filter-chip active' : 'filter-chip'} onClick={() => onSelectBook(book.id)}>{book.title}</button>)}</div>
      <div className="dictionary-list">
        {visible.map((word) => <WordRow key={word.id} word={word} books={bundle.books} learned={Boolean(learning.progress[word.id])} onMark={() => onMark(word.id)} />)}
        {visible.length === 0 && <div className="empty-state"><span className="empty-icon"><Icon name="search" size={21} /></span><strong>没有找到这个词</strong><span>试试更短的单词，或切换到全部词书。</span></div>}
      </div>
      {filtered.length > visible.length && <div className="list-limit-note">显示前 {visible.length} 个结果，请继续输入缩小范围。</div>}
    </div>
  );
}

function ProgressScreen({ bundle, learning, learnedCount, dueCount, todayNewCount, onNewGoal, onReviewGoal, onExport, onImport }: {
  bundle: LexiconBundle;
  learning: LearningState;
  learnedCount: number;
  dueCount: number;
  todayNewCount: number;
  onNewGoal: (event: ChangeEvent<HTMLInputElement>) => void;
  onReviewGoal: (event: ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onImport: (state: LearningState) => void;
}) {
  const days = useMemo(() => recentDays(learning), [learning]);
  const progressPercent = bundle.words.length ? Math.round(learnedCount / bundle.words.length * 100) : 0;
  return (
    <div className="screen-stack">
      <PageIntro eyebrow="你的学习轨迹" title="每一次复习，都算数。" description="进度只存放在当前设备。导出学习记录后，可以在另一台设备上导入继续。" />
      <div className="report-top-grid">
        <div className="report-total-card"><div><span className="metric-label">已学单词</span><div className="report-number">{learnedCount.toLocaleString()}<small> / {bundle.words.length.toLocaleString()}</small></div><span className="report-subtitle">涵盖 {bundle.books.length} 本词书，重复词只统计一次</span></div><div className="donut" style={{ background: `conic-gradient(#2d6851 ${progressPercent * 3.6}deg, #e7ede7 0deg)` }}><div><strong>{progressPercent}%</strong><span>总体进度</span></div></div></div>
        <div className="report-small-card"><span className="report-icon orange"><Icon name="clock" size={18} /></span><span className="metric-label">待复习</span><strong>{dueCount}<small> 词</small></strong><span className="report-subtitle">优先复习到期词</span></div>
        <div className="report-small-card"><span className="report-icon mint"><Icon name="spark" size={18} /></span><span className="metric-label">今日新词</span><strong>{todayNewCount}<small> / {learning.dailyNewGoal}</small></strong><span className="report-subtitle">逐步达到每日目标</span></div>
      </div>

      <section className="report-panel"><div className="section-heading"><div><div className="eyebrow">过去一周</div><h2>保持自己的节奏</h2></div><span className="section-note">浅绿代表当天有学习</span></div><div className="week-grid">{days.map((day) => <div className="week-day" key={day.key}><span>{day.label}</span><div className={day.active ? 'week-dot active' : 'week-dot'} title={day.active ? '当天完成了学习' : '当天没有学习记录'}>{day.active && <Icon name="check" size={13} />}</div><small>{day.date}</small></div>)}</div></section>

      <section className="report-panel"><div className="section-heading"><div><div className="eyebrow">词书进度</div><h2>每本书都向前了一点</h2></div></div><div className="progress-book-list">{bundle.books.map((book) => {
        const count = bundle.words.reduce((total, word) => total + Number(word.books.includes(book.id)), 0);
        const learned = bundle.words.reduce((total, word) => total + Number(word.books.includes(book.id) && Boolean(learning.progress[word.id])), 0);
        const percent = count ? Math.round(learned / count * 100) : 0;
        return <div className="progress-book-row" key={book.id}><span className={`book-mini ${book.color}`}>A</span><div className="progress-book-name"><strong>{book.title}</strong><span>{learned.toLocaleString()} / {count.toLocaleString()}</span></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><strong className="progress-book-percent">{percent}%</strong></div>;
      })}</div></section>

      <section className="report-panel settings-panel"><div><div className="eyebrow">学习偏好</div><h2>设置每日目标</h2><p>新词按当前词书学习；复习从所有已经学过的词里抽取。</p></div><div className="goal-controls"><label>每日新词<input type="number" min={1} max={100} value={learning.dailyNewGoal} onChange={onNewGoal} />个</label><label>每日复习<input type="number" min={4} max={100} value={learning.dailyReviewGoal} onChange={onReviewGoal} />个</label></div></section>

      <section className="report-panel backup-panel"><div><div className="eyebrow">多设备继续</div><h2>备份学习记录</h2><p>导出 JSON 文件后，可以在网页版、电脑或安卓设备上导入。词库本身不包含在备份里。</p></div><div className="backup-actions"><button className="button button-outline" onClick={onExport}><Icon name="download" size={16} /> 导出记录</button><label className="button button-dark import-button"><Icon name="upload" size={16} /> 导入记录<input type="file" accept="application/json,.json" onChange={(event) => importProgressFile(event, onImport)} /></label></div></section>

      <section className="report-panel source-panel"><div><div className="eyebrow">数据说明</div><h2>词书来源与许可</h2><p>相同拼写合并为一个学习词条，并保留收录词书和来源。用户提供 PDF 的再分发许可尚未核实。</p></div><div className="source-list">{bundle.sources.map((source) => {
        const licenseFile = source.id === 'word3500'
          ? 'word3500-MIT.txt'
          : source.id === 'kylebing'
            ? 'english-vocabulary-BSD-3-Clause.txt'
            : null;
        return <div className="source-row" key={source.id}><span><strong>{source.title}</strong><small>{source.license}</small></span><span className="source-links">{source.url && <a href={source.url} target="_blank" rel="noreferrer">来源项目</a>}{licenseFile && <a href={`${import.meta.env.BASE_URL}licenses/${licenseFile}`} target="_blank" rel="noreferrer">完整许可</a>}</span></div>;
      })}</div></section>
    </div>
  );
}

function StudyScreen({ session, book, dailyGoal, todayCount, onLearn, onSkip, onExit }: {
  session: StudySession;
  book?: BookDefinition;
  dailyGoal: number;
  todayCount: number;
  onLearn: (word: WordEntry) => void;
  onSkip: () => void;
  onExit: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const current = session.queue[session.index];
  const percent = Math.min(100, Math.round(session.index / session.queue.length * 100));
  useEffect(() => setRevealed(false), [session.index]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('button, input, select, textarea')) return;
      if (event.code === 'Space') { event.preventDefault(); setRevealed((value) => !value); }
      if (event.key === 'ArrowRight' && current) onSkip();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [current, onSkip]);
  if (!current) {
    return <div className="completion-wrap"><div className="completion-icon"><Icon name="spark" size={26} /></div><span className="eyebrow">新词学习完成</span><h1>今天又向前了一步。</h1><p>在「{book?.title ?? '当前词书'}」学会了 {session.learned} 个新词。还可以去做每日测验或复习。</p><div className="completion-actions"><button className="button button-dark" onClick={onExit}>回到今日学习</button></div></div>;
  }
  return (
    <div className="study-wrap">
      <div className="study-topline"><button className="back-link" onClick={onExit}><Icon name="chevron-left" size={17} /> 返回</button><span>{book?.title ?? '当前词书'} <i>·</i> 新词学习</span><span className="study-count">{Math.min(session.index + 1, session.queue.length)} <small>/ {session.queue.length}</small></span></div>
      <div className="study-progress"><span style={{ width: `${percent}%` }} /></div>
      <div className="study-meta"><span>今日计划 {Math.min(todayCount, dailyGoal)} / {dailyGoal}</span><span>空格翻面 · → 跳过</span></div>
      <button className={revealed ? 'flash-card revealed' : 'flash-card'} onClick={() => setRevealed((value) => !value)} aria-label={revealed ? '隐藏释义' : '查看释义'}>
        <span className="card-corner">{revealed ? '释义' : '单词'}</span>
        {!revealed ? <><strong className="flash-word">{current.word}</strong><span className="flash-phonetic">{current.phonetic || '先想一想这个词的意思'}</span><span className="flip-hint"><Icon name="refresh" size={15} /> 点击卡片查看释义</span></> : <><strong className="flash-word small-word">{current.word}</strong><span className="flash-phonetic">{current.phonetic}</span><span className="flash-meanings">{current.meanings.slice(0, 4).map((meaning, index) => <span key={`${meaning.text}-${index}`}><b>{meaning.pos && `${meaning.pos}.`}</b> {meaning.text}</span>)}</span>{current.example?.english && <span className="flash-example"><em>{current.example.english}</em>{current.example.chinese && <small>{current.example.chinese}</small>}</span>}</>}
      </button>
      <div className="study-actions"><button className="button button-skip" onClick={onSkip}><Icon name="skip" size={16} /> 还不熟，稍后再看</button><button className="button button-known" disabled={!revealed} onClick={() => onLearn(current)}><Icon name="check" size={17} /> 我记住了</button></div>
      <div className="study-note"><Icon name="layers" size={15} /> 记住的词会从其他词书的新词队列中自动移除</div>
    </div>
  );
}

function QuizScreen({ session, onAnswer, onNext, onExit, onRestart }: {
  session: QuizSession;
  onAnswer: (index: number) => void;
  onNext: () => void;
  onExit: () => void;
  onRestart: () => void;
}) {
  const score = quizScore(session.answers, session.questions);
  const title = session.mode === 'review' ? '已学复习' : '每日测验';
  if (session.complete) {
    const percentage = Math.round(score / session.questions.length * 100);
    return <div className="completion-wrap quiz-result"><div className={`result-ring ${percentage >= 80 ? 'good' : ''}`}><strong>{percentage}<small>%</small></strong><span>本次得分</span></div><span className="eyebrow">{title}完成</span><h1>{percentage >= 80 ? '做得很好，继续保持。' : '错题已经安排复习。'}</h1><p>答对 {score} 题，共 {session.questions.length} 题。{session.mode === 'review' ? '本次复习结果已经更新到记忆计划。' : '测验记录已经保存在学习报告中。'}</p><div className="completion-actions"><button className="button button-outline" onClick={onExit}>回到首页</button><button className="button button-dark" onClick={onRestart}><Icon name="refresh" size={16} /> 再测一次</button></div></div>;
  }
  const question = session.questions[session.index];
  const selected = session.answers[session.index];
  const answered = selected !== null;
  const correct = selected === question.correctIndex;
  const percent = Math.round((session.index + Number(answered)) / session.questions.length * 100);
  return (
    <div className="quiz-wrap">
      <div className="quiz-topline"><button className="back-link" onClick={onExit}><Icon name="chevron-left" size={17} /> 退出</button><div><span className="quiz-mode-label">{session.mode === 'review' ? '随机复习已学词' : '从当前词书随机抽词'}</span><strong>{title}</strong></div><span className="study-count">{session.index + 1} <small>/ {session.questions.length}</small></span></div>
      <div className="study-progress"><span style={{ width: `${percent}%` }} /></div>
      <div className="quiz-card"><span className="question-label">选择正确的中文释义</span><strong className="question-word">{question.word.word}</strong>{question.word.phonetic && <span className="question-phonetic">{question.word.phonetic}</span>}
        <div className="quiz-options">{question.options.map((option, index) => {
          const isSelected = selected === index;
          const isAnswer = index === question.correctIndex;
          const classes = ['quiz-option'];
          if (answered && isAnswer) classes.push('correct');
          if (answered && isSelected && !isAnswer) classes.push('incorrect');
          return <button key={`${index}-${option}`} className={classes.join(' ')} disabled={answered} onClick={() => onAnswer(index)}><span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span>{answered && isAnswer && <Icon name="check" size={17} />}{answered && isSelected && !isAnswer && <Icon name="close" size={16} />}</button>;
        })}</div>
        {answered && <div className={correct ? 'answer-feedback correct' : 'answer-feedback incorrect'}><span>{correct ? '答对了，记得很牢。' : `正确释义：${primaryMeaning(question.word)}`}</span>{question.word.example?.english && <small>{question.word.example.english}</small>}</div>}
        <button className="button button-dark quiz-next" disabled={!answered} onClick={onNext}>{session.index + 1 === session.questions.length ? '查看测验结果' : '下一题'} <Icon name="arrow" size={16} /></button>
      </div>
      <div className="quiz-footnote"><Icon name="layers" size={15} /> {session.mode === 'review' ? '只从已经学过的单词中出题' : '本词书中的词条均可能出现在测验里'}</div>
    </div>
  );
}

function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-intro"><div className="eyebrow"><span className="eyebrow-dot" /> {eyebrow}</div><h1>{title}</h1><p>{description}</p></div>;
}

function BookCard({ book, number, count, learned, active, onClick, large = false }: {
  book: BookDefinition;
  number: number;
  count: number;
  learned: number;
  active: boolean;
  onClick: () => void;
  large?: boolean;
}) {
  const percent = count ? Math.round(learned / count * 100) : 0;
  return <button className={`book-card ${large ? 'large' : ''} ${active ? 'selected' : ''}`} onClick={onClick}><div className="book-card-top"><span className={`book-index ${book.color}`}>{String(number).padStart(2, '0')}</span>{active && <span className="selected-label"><Icon name="check" size={13} /> 正在学习</span>}<span className="book-arrow"><Icon name="arrow" size={16} /></span></div><strong className="book-title">{book.title}</strong><span className="book-subtitle">{book.subtitle}</span><div className="book-card-foot"><span>{count.toLocaleString()} 个词</span><span>{learned.toLocaleString()} 已学</span></div><div className="progress-track book-progress"><span style={{ width: `${percent}%` }} /></div></button>;
}

function StatCard({ icon, tone, label, value, suffix, foot }: { icon: IconName; tone: string; label: string; value: ReactNode; suffix: string; foot: string }) {
  return <div className="stat-card"><span className={`stat-icon ${tone}`}><Icon name={icon} size={18} /></span><span className="stat-label">{label}</span><div className="stat-value">{value}<small>{suffix}</small></div><span className="stat-foot">{foot}</span></div>;
}

function ActionCard({ icon, tone, title, detail, tag, onClick, disabled = false }: { icon: IconName; tone: string; title: string; detail: string; tag: string; onClick: () => void; disabled?: boolean }) {
  return <button className={`action-card ${disabled ? 'disabled' : ''}`} onClick={onClick} disabled={disabled}><span className={`action-icon ${tone}`}><Icon name={icon} size={20} /></span><span className="action-copy"><strong>{title}</strong><small>{detail}</small></span><span className="action-tag">{tag}</span><span className="action-arrow"><Icon name="arrow" size={16} /></span></button>;
}

function WordRow({ word, books, learned, onMark }: { word: WordEntry; books: BookDefinition[]; learned: boolean; onMark: () => void }) {
  const labels = word.books.map((id) => books.find((book) => book.id === id)?.title).filter(Boolean).slice(0, 3);
  return <article className="word-row"><div className="word-main"><strong>{word.word}</strong>{word.phonetic && <span className="word-phonetic">{word.phonetic}</span>}<span className="word-meaning">{word.meanings.slice(0, 2).map((meaning) => `${meaning.pos ? `${meaning.pos}. ` : ''}${meaning.text}`).join('；')}</span>{word.example?.english && <small className="word-example">{word.example.english}</small>}<div className="word-book-tags">{labels.map((label) => <span key={label}>{label}</span>)}</div></div><button className={learned ? 'word-learned' : 'word-mark'} onClick={onMark} disabled={learned}>{learned ? <><Icon name="check" size={15} /> 已学</> : '标记已学'}</button></article>;
}

function NavButton({ icon, label, active, onClick, compact = false }: { icon: IconName; label: string; active: boolean; onClick: () => void; compact?: boolean }) {
  return <button className={`${compact ? 'mobile-nav-item' : 'nav-item'} ${active ? 'active' : ''}`} onClick={onClick}><Icon name={icon} size={compact ? 19 : 18} /><span>{label}</span>{!compact && active && <span className="nav-active-dot" />}</button>;
}

type IconName = 'home' | 'books' | 'search' | 'chart' | 'chevron' | 'chevron-left' | 'download' | 'upload' | 'arrow' | 'sun' | 'spark' | 'clock' | 'check' | 'play' | 'book' | 'quiz' | 'refresh' | 'layers' | 'skip' | 'close' | 'settings';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>,
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
    books: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21z" /><path d="M4 5.5v13A2.5 2.5 0 0 1 6.5 16H20" /><path d="M8 7h8" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /></>,
    chart: <><path d="M4 19V5" /><path d="M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    'chevron-left': <path d="m15 18-6-6 6-6" />,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    arrow: <><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    play: <path d="m8 5 11 7-11 7z" />,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21z" /><path d="M4 5.5v13A2.5 2.5 0 0 1 6.5 16H20" /></>,
    quiz: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 2.5 2.5L16 9" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 11.6-2.6L20 9M4 15l2.9 2.6A7 7 0 0 0 18.5 15" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
    skip: <><path d="M5 5v14l11-7z" /><path d="M19 5v14" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function activeDays(state: LearningState): number {
  return recentDays(state).filter((day) => day.active).length;
}

function recentDays(state: LearningState): Array<{ key: string; date: string; label: string; active: boolean }> {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = dayKey(date);
    const activity = state.activity[key];
    return {
      key,
      date: String(date.getDate()).padStart(2, '0'),
      label: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date),
      active: Boolean(activity && (activity.newIds.length || activity.reviewedIds.length || activity.quizzes.length)),
    };
  });
}

function exportProgress(state: LearningState, notify: (message: string) => void) {
  const blob = new Blob([JSON.stringify({ format: 'lexiday-progress', version: 2, exportedAt: new Date().toISOString(), learning: state }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lexiday-progress-${dayKey()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  notify('学习记录已导出');
}

function importProgressFile(event: ChangeEvent<HTMLInputElement>, onImport: (state: LearningState) => void) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as { format?: string; version?: number; learning?: LearningState };
      const state = parseLearningStateSafe(JSON.stringify(parsed.learning ?? parsed));
      if (parsed.format !== 'lexiday-progress' || !state) throw new Error('format');
      onImport(state);
      window.alert('学习记录已导入。');
    } catch {
      window.alert('文件格式不正确，无法导入学习记录。');
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file);
}

export default App;
