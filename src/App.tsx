import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Smile, 
  Frown, 
  Zap, 
  Clock, 
  MapPin, 
  ChevronRight, 
  TrendingUp, 
  Brain, 
  Sparkles, 
  ChevronDown, 
  Info, 
  RotateCcw, 
  CheckCircle2, 
  XCircle, 
  Plus, 
  BarChart3, 
  ShieldCheck, 
  ArrowRight,
  Flame,
  Award
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
type Screen = 'onboarding' | 'today' | 'model';

interface AdherenceHistoryItem {
  category: string;
  adherence: number;
  friction: number;
  liveFeedbackCount?: number;
}

interface FeedbackLogItem {
  id: string;
  type: 'completed' | 'too_hard';
  actionTitle: string;
  category: string;
  actionFriction: number;
  budgetBefore: number;
  budgetAfter: number;
  completed: boolean;
  timestamp: string;
  displayDate?: string;
}

interface CandidateIntervention {
  title: string;
  description: string;
  category: string;
  frictionScore: number;
  timeEstimate: number;
  score?: number;
  disqualified?: boolean;
  disqualificationReason?: string;
  explainability?: {
    adherencePrior: number;
    contextAdjustedAdherence: number;
    preferenceFactor: number;
    actionFriction: number;
    availableBudget: number;
    formula: string;
    status: string;
  };
}

interface UserProfile {
  goal: string;
  refusals: string[];
  likes: string[];
  dislikes: string[];
  adherenceHistory: AdherenceHistoryItem[];
  frictionBudget: number;
  logs?: FeedbackLogItem[];
  lastFeedback?: FeedbackLogItem | null;
}

// Seeded demo baseline history (Clearly distinguished from live feedback)
const INITIAL_DEMO_ADHERENCE: AdherenceHistoryItem[] = [
  { category: 'Physical', adherence: 0.84, friction: 0.28, liveFeedbackCount: 0 },
  { category: 'Mental', adherence: 0.72, friction: 0.35, liveFeedbackCount: 0 },
  { category: 'Social', adherence: 0.91, friction: 0.20, liveFeedbackCount: 0 },
  { category: 'Nutrition', adherence: 0.52, friction: 0.58, liveFeedbackCount: 0 },
  { category: 'Rest', adherence: 0.78, friction: 0.25, liveFeedbackCount: 0 },
];

const SEED_BASELINE_LOGS = [
  { id: 'seed-1', title: '5-Minute Doorway Mobility Stretch', category: 'Physical', date: 'Yesterday (Demo)', completed: true, friction: 0.20 },
  { id: 'seed-2', title: '8-Minute Quiet Patio Stroll', category: 'Physical', date: '2 days ago (Demo)', completed: true, friction: 0.28 },
  { id: 'seed-3', title: '4-Minute Standing Torso Twist', category: 'Physical', date: '3 days ago (Demo)', completed: false, friction: 0.40 },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('today');
  
  // Exact acceptance scenario defaults
  const [profile, setProfile] = useState<UserProfile>(() => {
    const cached = localStorage.getItem('minimum_profile_v2');
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* ignore */ }
    }
    return {
      goal: 'Build a daily morning movement habit.',
      refusals: ['morning coffee', '8 hours of sleep'],
      likes: ['nature walks', 'stretching', 'audiobooks'],
      dislikes: ['high-impact cardio', 'crowded gyms'],
      adherenceHistory: INITIAL_DEMO_ADHERENCE,
      frictionBudget: 0.75,
      logs: [],
      lastFeedback: null,
    };
  });

  const [context, setContext] = useState('Normal');
  const [time, setTime] = useState(10);
  const [recommendation, setRecommendation] = useState<CandidateIntervention | null>(null);
  const [allCandidates, setAllCandidates] = useState<CandidateIntervention[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showExplainability, setShowExplainability] = useState(false);
  
  // Feedback state and before/after tracking
  const [feedbackGiven, setFeedbackGiven] = useState<'done' | 'skipped' | null>(null);
  const [frictionTransition, setFrictionTransition] = useState<{ before: number; after: number } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [persistentError, setPersistentError] = useState<string | null>(null);
  const [generationSource, setGenerationSource] = useState('');
  const [customRefusalInput, setCustomRefusalInput] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Sync profile to localStorage on changes
  useEffect(() => {
    localStorage.setItem('minimum_profile_v2', JSON.stringify(profile));
  }, [profile]);

  // Load server profile on mount (Requirement 3: persist across refresh)
  useEffect(() => {
    async function loadServerProfile() {
      try {
        const res = await fetch('/api/profile');
        if (res.ok) {
          const data = await res.json();
          setProfile(prev => ({
            ...prev,
            goal: data.goal || prev.goal,
            refusals: data.refusals || prev.refusals,
            likes: data.likes || prev.likes,
            dislikes: data.dislikes || prev.dislikes,
            frictionBudget: typeof data.frictionBudget === 'number' ? data.frictionBudget : prev.frictionBudget,
            adherenceHistory: data.adherenceHistory || prev.adherenceHistory,
            logs: data.logs || prev.logs,
            lastFeedback: data.lastFeedback !== undefined ? data.lastFeedback : prev.lastFeedback,
          }));
        }
      } catch (err) {
        console.warn('Failed to load server profile:', err);
      }
      await generateRecommendation(false);
    }
    loadServerProfile();
  }, []);

  // Generate / Regenerate Recommendation
  const generateRecommendation = async (isRegen = false) => {
    setIsGenerating(true);
    setFeedbackGiven(null);
    setShowExplainability(false);
    setPersistentError(null);

    try {
      const prevFric = isRegen && recommendation ? recommendation.frictionScore : null;

      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          context, 
          availableTime: time,
          isRegenerate: isRegen,
          previousFriction: prevFric
        }),
      });

      if (!res.ok) {
        const failure = await res.json().catch(() => ({}));
        throw new Error(failure.error || `Recommendation request failed (${res.status})`);
      }

      const data = await res.json();
      if (data.recommendation) {
        setRecommendation(data.recommendation);
        setGenerationSource(data.generationSource || '');
        setAllCandidates(data.candidates || []);
        
        if (data.frictionTransition) {
          setFrictionTransition({
            before: data.frictionTransition.before,
            after: data.frictionTransition.after
          });
        } else if (!isRegen) {
          setFrictionTransition(null);
        }
      }

      if (data.behavioralModel) {
        setProfile(prev => ({
          ...prev,
          adherenceHistory: data.behavioralModel.adherenceHistory || prev.adherenceHistory,
          frictionBudget: typeof data.behavioralModel.frictionBudget === 'number'
            ? data.behavioralModel.frictionBudget
            : prev.frictionBudget
        }));
      }
    } catch (err: any) {
      console.error('Generation error:', err);
      setPersistentError(err.message || 'Could not generate an action.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Submit Feedback (Completed or Too hard)
  const submitFeedback = async (completed: boolean) => {
    if (!recommendation || feedbackGiven !== null) return;

    const actionFriction = recommendation.frictionScore;
    const actionTitle = recommendation.title;

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completed,
          category: recommendation.category,
          friction: actionFriction,
          actionTitle: actionTitle
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setFeedbackGiven(completed ? 'done' : 'skipped');
        if (data.updatedProfile) {
          setProfile(prev => ({
            ...prev,
            frictionBudget: data.updatedProfile.frictionBudget ?? prev.frictionBudget,
            adherenceHistory: data.updatedProfile.adherenceHistory || prev.adherenceHistory,
            logs: data.updatedProfile.logs || prev.logs,
            lastFeedback: data.updatedProfile.lastFeedback || prev.lastFeedback
          }));
        }

        const bBefore = Math.round(data.beforeAfter.budgetBefore * 100);
        const bAfter = Math.round(data.beforeAfter.budgetAfter * 100);

        if (!completed) {
          showToast(`Capacity ${bBefore}% → ${bAfter}% (Adjusted down). Click Regenerate for an easier action.`);
        } else {
          showToast(`Completed! Capacity ${bBefore}% → ${bAfter}% (+5% Headroom).`);
        }
      } else {
        const failure = await res.json().catch(() => ({}));
        throw new Error(failure.error || `Feedback request failed (${res.status})`);
      }
    } catch (err) {
      console.warn('Feedback sync error:', err);
      setPersistentError(err instanceof Error ? err.message : 'Feedback was not saved. Please retry.');
      /* no optimistic success: server is authoritative */
      /* setProfile(prev => {
        const bBefore = prev.frictionBudget;
        const bAfter = completed 
          ? Math.min(1.0, Number((bBefore + 0.05).toFixed(2)))
          : Math.max(0.10, Number((bBefore - 0.10).toFixed(2)));
        
        const newLog: FeedbackLogItem = {
          id: Date.now().toString(),
          type: completed ? 'completed' : 'too_hard',
          actionTitle,
          category: recommendation.category,
          actionFriction,
          budgetBefore: bBefore,
          budgetAfter: bAfter,
          completed,
          timestamp: new Date().toISOString(),
          displayDate: 'Just now'
        };

        return {
          ...prev,
          frictionBudget: bAfter,
          lastFeedback: newLog,
          logs: [newLog, ...(prev.logs || []).slice(0, 19)]
        };
      }); */
    }
  };

  // Onboarding Submit
  const handleOnboardingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile.goal.trim()) return;

    try {
      const res = await fetch('/api/analyze-goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: profile.goal,
          refusals: profile.refusals,
          likes: profile.likes,
          dislikes: profile.dislikes,
        }),
      });
      if (!res.ok) throw new Error('Could not save the profile. Please retry.');
      const data = await res.json().catch(() => null);
      if (data?.coreIntent) {
        showToast(`Baseline calibrated: "${data.coreIntent}"`);
      }
    } catch (err) {
      setPersistentError(err instanceof Error ? err.message : 'Could not save the profile.');
      return;
    }
    setScreen('today');
    generateRecommendation(false);
  };

  const addCustomRefusal = () => {
    if (!customRefusalInput.trim()) return;
    if (!profile.refusals.includes(customRefusalInput.trim())) {
      setProfile(p => ({ ...p, refusals: [...p.refusals, customRefusalInput.trim()] }));
    }
    setCustomRefusalInput('');
  };

  // Helper calculations for dynamic behavioral model
  const sortedByAdherence = [...(profile.adherenceHistory || [])].sort((a, b) => b.adherence - a.adherence);
  const strongestCategory = sortedByAdherence[0] || { category: 'Social', adherence: 0.91 };
  const weakestCategory = sortedByAdherence[sortedByAdherence.length - 1] || { category: 'Nutrition', adherence: 0.52 };
  
  // Total actual live check-ins recorded
  const actualFeedbackCount = (profile.logs || []).length;

  // Chart data formatted as percentage values
  const chartData = (profile.adherenceHistory || []).map(item => ({
    category: item.category,
    adherencePercent: Math.round(item.adherence * 100),
    frictionPercent: Math.round(item.friction * 100),
    hasLiveFeedback: (item.liveFeedbackCount || 0) > 0,
    liveCount: item.liveFeedbackCount || 0,
  }));

  return (
    <div className="min-h-screen bg-[#FBFBF9] text-slate-900 flex flex-col font-sans selection:bg-slate-200">
      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 whitespace-nowrap"
          >
            <Sparkles size={14} className="text-emerald-400" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Header Navigation (3 Zones) */}
      <header className="sticky top-0 z-30 bg-[#FBFBF9]/90 backdrop-blur-md border-b border-slate-200/60 px-6 py-3.5 flex items-center justify-between">
        {/* Zone 1: Brand title */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center text-white font-bold text-xs tracking-wider">
            M
          </div>
          <div>
            <span className="font-semibold tracking-tight text-slate-900 text-base">MINIMUM</span>
            <span className="hidden sm:inline-block ml-2 text-[10px] text-slate-400 uppercase tracking-widest font-medium">
              Adaptive Habit Engine
            </span>
          </div>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="flex items-center gap-1 bg-slate-200/50 p-1 rounded-xl text-xs font-medium">
          <button
            onClick={() => setScreen('today')}
            className={cn(
              "px-3 py-1.5 rounded-lg transition-all",
              screen === 'today' ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            Today
          </button>
          <button
            onClick={() => setScreen('model')}
            className={cn(
              "px-3 py-1.5 rounded-lg transition-all",
              screen === 'model' ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            Behavior Model
          </button>
          <button
            onClick={() => setScreen('onboarding')}
            className={cn(
              "px-3 py-1.5 rounded-lg transition-all",
              screen === 'onboarding' ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            Profile
          </button>
        </nav>

        {/* Zone 3: Capacity indicator with live budget */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="hidden sm:inline">Capacity Budget:</span>
          <span className="font-semibold text-slate-900 tabular-nums px-2 py-0.5 bg-slate-100 rounded-md border border-slate-200/60">
            {Math.round(profile.frictionBudget * 100)}%
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-2xl w-full mx-auto p-6 md:py-8">
        {persistentError && <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{persistentError}</div>}
        <AnimatePresence mode="wait">
          
          {/* ================= SCREEN 1: ONBOARDING ================= */}
          {screen === 'onboarding' && (
            <motion.div
              key="onboarding"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-8"
            >
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-1">Demo Profile</p>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">Define your consistency anchor.</h1>
                <p className="text-sm text-slate-500 mt-1">
                  MINIMUM designs around your non-negotiables so consistency never relies on willpower spikes.
                </p>
              </div>

              <form onSubmit={handleOnboardingSubmit} className="space-y-6">
                {/* 1. Goal Input */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-700 block">
                    Your Overarching Wellness Goal
                  </label>
                  <input
                    type="text"
                    value={profile.goal}
                    onChange={(e) => setProfile({ ...profile, goal: e.target.value })}
                    placeholder="e.g., Build a daily morning movement habit."
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1 text-xs text-slate-500">
                    <span className="text-[11px] text-slate-400 mr-1 self-center">Demo:</span>
                    <button
                      type="button"
                      onClick={() => setProfile({
                        ...profile,
                        goal: 'Build a daily morning movement habit.',
                        refusals: ['morning coffee', '8 hours of sleep'],
                        likes: ['nature walks', 'stretching', 'audiobooks'],
                        dislikes: ['high-impact cardio', 'crowded gyms']
                      })}
                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-md font-medium transition-colors border border-emerald-200"
                    >
                      Load Morning Movement Example
                    </button>
                  </div>
                </div>

                {/* 2. Refusals / Non-negotiables */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-700 block">
                    Things you refuse to give up (Non-negotiables)
                  </label>
                  <p className="text-xs text-slate-400">
                    The engine strictly preserves these routines without compromise.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {['morning coffee', '8 hours of sleep', 'evening reading', 'weekend rest'].map((item) => {
                      const selected = profile.refusals.some(r => r.toLowerCase() === item.toLowerCase());
                      return (
                        <button
                          type="button"
                          key={item}
                          onClick={() => {
                            setProfile({
                              ...profile,
                              refusals: selected 
                                ? profile.refusals.filter(r => r.toLowerCase() !== item.toLowerCase())
                                : [...profile.refusals, item]
                            });
                          }}
                          className={cn(
                            "px-3 py-1.5 text-xs font-medium rounded-lg border transition-all",
                            selected 
                              ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                              : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                          )}
                        >
                          {item}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={customRefusalInput}
                      onChange={(e) => setCustomRefusalInput(e.target.value)}
                      placeholder="Add another non-negotiable..."
                      className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomRefusal(); } }}
                    />
                    <button
                      type="button"
                      onClick={addCustomRefusal}
                      className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-200 flex items-center gap-1"
                    >
                      <Plus size={13} /> Add
                    </button>
                  </div>
                </div>

                {/* 3. Likes & Dislikes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-700 block">Activities you like</label>
                    <div className="flex flex-wrap gap-1.5">
                      {['nature walks', 'stretching', 'audiobooks', 'joint rolls', 'herbal tea'].map((like) => {
                        const selected = profile.likes.some(l => l.toLowerCase() === like.toLowerCase());
                        return (
                          <button
                            type="button"
                            key={like}
                            onClick={() => {
                              setProfile({
                                ...profile,
                                likes: selected 
                                  ? profile.likes.filter(l => l.toLowerCase() !== like.toLowerCase())
                                  : [...profile.likes, like]
                              });
                            }}
                            className={cn(
                              "px-2.5 py-1 text-xs rounded-md border transition-all",
                              selected 
                                ? "bg-emerald-50 text-emerald-800 border-emerald-300 font-medium"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                            )}
                          >
                            + {like}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-700 block">Activities you dislike (Forbidden)</label>
                    <div className="flex flex-wrap gap-1.5">
                      {['high-impact cardio', 'crowded gyms', 'burpees', 'rigid timers', 'heavy weights'].map((dislike) => {
                        const selected = profile.dislikes.some(d => d.toLowerCase() === dislike.toLowerCase());
                        return (
                          <button
                            type="button"
                            key={dislike}
                            onClick={() => {
                              setProfile({
                                ...profile,
                                dislikes: selected 
                                  ? profile.dislikes.filter(d => d.toLowerCase() !== dislike.toLowerCase())
                                  : [...profile.dislikes, dislike]
                              });
                            }}
                            className={cn(
                              "px-2.5 py-1 text-xs rounded-md border transition-all",
                              selected 
                                ? "bg-rose-50 text-rose-800 border-rose-300 font-medium"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                            )}
                          >
                            - {dislike}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!profile.goal.trim()}
                  className="w-full py-3.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                >
                  Save Profile & Go to Today
                  <ChevronRight size={16} />
                </button>
              </form>
            </motion.div>
          )}

          {/* ================= SCREEN 2: TODAY ================= */}
          {screen === 'today' && (
            <motion.div
              key="today"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-6"
            >
              {/* Header with goal anchor */}
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  <span>Daily Calibration</span>
                  <span>·</span>
                  <span className="text-emerald-700 font-medium">{profile.goal}</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
                  Today's micro-intervention.
                </h1>
              </div>

              {/* Requirement 3: Before → After Feedback Banner */}
              {profile.lastFeedback && (
                <div className="bg-slate-100/80 border border-slate-200/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-2 py-0.5 rounded font-semibold text-[10px] uppercase tracking-wider",
                      profile.lastFeedback.completed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                    )}>
                      {profile.lastFeedback.completed ? 'Completed' : 'Adjusted / Too Hard'}
                    </span>
                    <span className="text-slate-600 font-medium truncate max-w-[200px]">
                      {profile.lastFeedback.actionTitle}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 font-mono">
                      <span className="text-slate-500">Capacity:</span>
                      <span className="font-semibold text-slate-700">{Math.round(profile.lastFeedback.budgetBefore * 100)}%</span>
                      <ArrowRight size={12} className="text-slate-400" />
                      <span className={cn("font-bold", profile.lastFeedback.completed ? "text-emerald-600" : "text-amber-600")}>
                        {Math.round(profile.lastFeedback.budgetAfter * 100)}%
                      </span>
                    </div>

                    {frictionTransition && (
                      <div className="flex items-center gap-1 font-mono border-l border-slate-200 pl-3">
                        <span className="text-slate-500">Action Friction:</span>
                        <span className="text-slate-700">{Math.round(frictionTransition.before * 100)}%</span>
                        <ArrowRight size={12} className="text-slate-400" />
                        <span className="text-emerald-600 font-bold">{Math.round(frictionTransition.after * 100)}%</span>
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded ml-1">Strictly Easier</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Context Selector */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500">Your Current State</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'Normal', icon: Smile, label: 'Normal' },
                    { id: 'Exhausted', icon: Frown, label: 'Exhausted' },
                    { id: 'Motivated', icon: Zap, label: 'Motivated' },
                    { id: 'Traveling', icon: MapPin, label: 'Traveling' },
                  ].map((item) => {
                    const active = context === item.id;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setContext(item.id)}
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-xl border text-xs font-medium transition-all text-left",
                          active
                            ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                            : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                        )}
                      >
                        <Icon size={16} className={active ? "text-emerald-400" : "text-slate-400"} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time Selector */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500">Available Time Window</label>
                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 20, 30].map((mins) => {
                    const active = time === mins;
                    return (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setTime(mins)}
                        className={cn(
                          "py-2.5 rounded-xl border text-xs font-medium transition-all flex flex-col items-center justify-center",
                          active
                            ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                            : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                        )}
                      >
                        <span className="font-semibold text-sm tabular-nums">{mins === 30 ? '30+' : mins}</span>
                        <span className="text-[10px] opacity-70">minutes</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Trigger Generation Button */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => generateRecommendation(false)}
                  disabled={isGenerating}
                  className="flex-1 py-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-all shadow-xs"
                >
                  <RotateCcw size={14} className={cn(isGenerating && "animate-spin text-slate-400")} />
                  {isGenerating ? "Evaluating Behavioral Policy..." : "Generate Action Candidate Pool"}
                </button>

                {feedbackGiven === 'skipped' && (
                  <button
                    type="button"
                    onClick={() => generateRecommendation(true)}
                    disabled={isGenerating}
                    className="py-3 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm"
                  >
                    <RotateCcw size={14} className={cn(isGenerating && "animate-spin")} />
                    Regenerate Strictly Easier Action
                  </button>
                )}
              </div>

              {/* Primary Selected Micro-Intervention Card */}
              {recommendation && (
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                  <p className="text-[11px] text-slate-500">{generationSource}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                      {recommendation.category} Action
                    </span>
                    <div className="flex items-center gap-3 text-slate-500">
                      <span className="flex items-center gap-1 font-medium">
                        <Clock size={13} /> {recommendation.timeEstimate} min
                      </span>
                      <span>·</span>
                      <span className="tabular-nums font-mono">
                        Friction: {Math.round(recommendation.frictionScore * 100)}%
                      </span>
                      <span>·</span>
                      <span className="text-slate-400">
                        Budget: {Math.round(profile.frictionBudget * 100)}%
                      </span>
                    </div>
                  </div>

                  <div>
                    <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">
                      {recommendation.title}
                    </h2>
                    <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                      {recommendation.description}
                    </p>
                  </div>

                  {/* Explainability Breakdown (Requirement 5: Exact formula match & no false claims) */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowExplainability(!showExplainability)}
                      className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 font-medium transition-colors"
                    >
                      <Info size={13} />
                      <span>{showExplainability ? "Hide policy explainability" : "Why was this selected? (Deterministic Policy Breakdown)"}</span>
                      <ChevronDown size={13} className={cn("transition-transform", showExplainability && "rotate-180")} />
                    </button>

                    {showExplainability && recommendation.explainability && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mt-3 p-3.5 bg-slate-50 border border-slate-200/70 rounded-xl text-xs space-y-3 text-slate-600"
                      >
                        {/* Status statement */}
                        <div className="flex items-center gap-1.5 font-medium text-emerald-800 bg-emerald-50/70 border border-emerald-200/60 p-2 rounded-lg">
                          <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                          <span>{recommendation.explainability.status}</span>
                        </div>

                        {/* Metric Components */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                          <div className="bg-white p-2 rounded-lg border border-slate-200/50">
                            <span className="text-[10px] text-slate-400 block uppercase font-medium">Category Prior</span>
                            <span className="font-semibold text-slate-900 tabular-nums">
                              {Math.round(recommendation.explainability.adherencePrior * 100)}%
                            </span>
                            <span className="text-[9px] text-slate-400 block">(Seeded baseline)</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-slate-200/50">
                            <span className="text-[10px] text-slate-400 block uppercase font-medium">Preference Match</span>
                            <span className="font-semibold text-slate-900 tabular-nums">
                              {Math.round(recommendation.explainability.preferenceFactor * 100)}%
                            </span>
                            <span className="text-[9px] text-slate-400 block">(Likes alignment)</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-slate-200/50">
                            <span className="text-[10px] text-slate-400 block uppercase font-medium">Action Friction</span>
                            <span className="font-semibold text-slate-900 tabular-nums">
                              {Math.round(recommendation.explainability.actionFriction * 100)}%
                            </span>
                            <span className="text-[9px] text-slate-400 block">(≤ Budget constraint)</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-slate-200/50">
                            <span className="text-[10px] text-slate-400 block uppercase font-medium">Policy Score</span>
                            <span className="font-semibold text-emerald-600 tabular-nums">
                              {recommendation.score?.toFixed(2) ?? 'Top Score'}
                            </span>
                            <span className="text-[9px] text-slate-400 block">(Deterministic)</span>
                          </div>
                        </div>

                        {/* Exact Arithmetic Formula Display */}
                        <div className="p-2.5 bg-white rounded-lg border border-slate-200/60 font-mono text-[11px] text-slate-700">
                          <span className="text-slate-400 block text-[10px] font-sans font-medium uppercase mb-0.5">Scoring Formula</span>
                          {recommendation.explainability.formula}
                        </div>

                        {/* All 4 Candidates Table with Disqualification Status */}
                        {allCandidates.length > 0 && (
                          <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                            <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                              <span>Ranked Candidate Actions (up to 4):</span>
                              <span className="text-[10px] text-slate-400">Constraint: Friction ≤ {Math.round(profile.frictionBudget * 100)}%</span>
                            </div>
                            
                            <div className="space-y-1.5">
                              {allCandidates.map((cand, idx) => {
                                const isWinner = cand.title === recommendation.title;
                                return (
                                  <div
                                    key={idx}
                                    className={cn(
                                      "p-2.5 rounded-lg border text-[11px] transition-all",
                                      isWinner 
                                        ? "bg-emerald-50/80 border-emerald-200 text-slate-900 shadow-2xs" 
                                        : cand.disqualified
                                        ? "bg-rose-50/40 border-rose-200/50 text-slate-500 opacity-75"
                                        : "bg-white border-slate-200/60 text-slate-700"
                                    )}
                                  >
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-1.5 truncate mr-2">
                                        <span className={cn(
                                          "w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center shrink-0",
                                          isWinner ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
                                        )}>
                                          {idx + 1}
                                        </span>
                                        <span className="font-semibold truncate">{cand.title}</span>
                                        <span className="text-slate-400 text-[10px]">({cand.timeEstimate}m · {cand.category})</span>
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                                        <span>Friction: {Math.round(cand.frictionScore * 100)}%</span>
                                        <span className="font-bold">Score: {cand.disqualified ? '—' : cand.score?.toFixed(2)}</span>
                                      </div>
                                    </div>

                                    <div className="text-[10px] flex items-center justify-between text-slate-500">
                                      <span className="truncate mr-2">{cand.description}</span>
                                      {cand.disqualified ? (
                                        <span className="text-rose-600 font-medium shrink-0 bg-rose-50 px-1 rounded">
                                          {cand.disqualificationReason}
                                        </span>
                                      ) : (
                                        <span className="text-emerald-700 font-medium shrink-0">
                                          {isWinner ? 'Selected Winner' : 'Qualified'}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>

                  {/* Feedback Action Buttons (Requirements 2 & 3) */}
                  <div className="pt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={feedbackGiven !== null}
                      onClick={() => submitFeedback(true)}
                      className={cn(
                        "flex-1 py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs",
                        feedbackGiven === 'done'
                          ? "bg-emerald-700 text-white"
                          : "bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                      )}
                    >
                      <CheckCircle2 size={16} />
                      {feedbackGiven === 'done' ? "Completed (+5% Capacity)" : "Mark Done"}
                    </button>

                    <button
                      type="button"
                      disabled={feedbackGiven !== null}
                      onClick={() => submitFeedback(false)}
                      className={cn(
                        "px-4 py-3 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-1.5",
                        feedbackGiven === 'skipped'
                          ? "bg-amber-50 text-amber-800 border-amber-300 font-semibold"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                      )}
                    >
                      <XCircle size={15} className={feedbackGiven === 'skipped' ? "text-amber-600" : "text-slate-400"} />
                      {feedbackGiven === 'skipped' ? "Capacity Lowered (-10%)" : "Too Hard / Adjusted"}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ================= SCREEN 3: BEHAVIOR MODEL ================= */}
          {screen === 'model' && (
            <motion.div
              key="model"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-6"
            >
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-1">Adaptive Intelligence</p>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">Behavioral Model & Patterns</h1>
                <p className="text-sm text-slate-500 mt-1">
                  Demo category priors update when you record feedback.
                </p>
              </div>

              {/* Real-Time Friction Budget Meter */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <Flame size={15} className="text-amber-500" />
                    <span className="font-semibold text-slate-800">Current Friction Capacity Budget</span>
                  </div>
                  <span className="font-bold text-slate-900 tabular-nums text-sm bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                    {Math.round(profile.frictionBudget * 100)}% Capacity
                  </span>
                </div>

                <div className="w-full bg-slate-100 h-3.5 rounded-full overflow-hidden p-0.5 border border-slate-200/50">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      profile.frictionBudget >= 0.70 ? "bg-emerald-500" : profile.frictionBudget >= 0.40 ? "bg-amber-500" : "bg-rose-500"
                    )}
                    style={{ width: `${Math.min(100, Math.max(5, profile.frictionBudget * 100))}%` }}
                  />
                </div>

                <div className="text-xs text-slate-500 leading-relaxed flex items-start justify-between gap-2">
                  <p>
                    Candidates with friction above this threshold are disqualified. Feedback of <span className="font-semibold text-slate-700">"Too hard"</span> automatically contracts budget by 10% to prevent burnout; completion expands it by 5%.
                  </p>
                  {profile.lastFeedback && (
                    <span className="shrink-0 text-[10px] font-mono font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded">
                      Last: {Math.round(profile.lastFeedback.budgetBefore * 100)}% → {Math.round(profile.lastFeedback.budgetAfter * 100)}%
                    </span>
                  )}
                </div>
              </div>

              {/* Requirement 4: Learned Adherence by Category Chart with fixed height and explicit empty state */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-semibold text-slate-800">Learned Adherence by Category</span>
                    <span className="text-slate-400 ml-2">Seeded demo priors and recorded feedback</span>
                  </div>
                  
                  {/* Distinct label between demo data and actual feedback (Requirement 4) */}
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium border border-slate-200">
                      Demo Baseline Prior
                    </span>
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded text-[10px] font-medium border border-emerald-200">
                      {actualFeedbackCount} Live Check-ins Recorded
                    </span>
                  </div>
                </div>

                {/* CSS bars remain visible in the AI Studio preview. */}
                <div className="min-h-[210px]">
                  {chartData && chartData.length > 0 ? (
                    <div className="space-y-3" role="img" aria-label="Category adherence estimates">
                      {chartData.map((item) => (
                        <div key={item.category} className="grid grid-cols-[80px_1fr_42px] items-center gap-3 text-xs">
                          <span className="text-slate-600">{item.category}</span>
                          <div className="h-5 rounded-md bg-slate-100 overflow-hidden">
                            <div className={cn('h-full rounded-md', item.hasLiveFeedback ? 'bg-emerald-600' : 'bg-emerald-300')}
                              style={{ width: `${Math.max(0, Math.min(100, item.adherencePercent))}%` }} />
                          </div>
                          <span className="font-semibold tabular-nums">{item.adherencePercent}%</span>
                        </div>
                      ))}
                      <p className="text-[11px] text-slate-400">Light bars are seeded demo priors; dark bars include recorded feedback.</p>
                    </div>
                  ) : (
                    /* Explicit empty state (Requirement 4) */
                    <div className="h-full flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                      <BarChart3 size={24} className="mb-2 text-slate-300" />
                      <span>No category adherence recorded yet.</span>
                      <span className="text-[11px] text-slate-300 mt-1">Complete daily micro-habits to train your model.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Strongest vs Weakest Pattern Insights */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 bg-emerald-50/70 border border-emerald-200/70 rounded-2xl space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-semibold">
                    <TrendingUp size={15} />
                    <span>Strongest Pattern</span>
                  </div>
                  <div className="text-lg font-bold text-emerald-950">
                    {strongestCategory.category}
                  </div>
                  <p className="text-xs text-emerald-800/80">
                    Highest consistency baseline ({Math.round(strongestCategory.adherence * 100)}%). Highest demo category estimate.
                  </p>
                </div>

                <div className="p-4 bg-amber-50/70 border border-amber-200/70 rounded-2xl space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-800 text-xs font-semibold">
                    <Brain size={15} />
                    <span>Weakest Pattern</span>
                  </div>
                  <div className="text-lg font-bold text-amber-950">
                    {weakestCategory.category}
                  </div>
                  <p className="text-xs text-amber-800/80">
                    Lowest adherence baseline ({Math.round(weakestCategory.adherence * 100)}%). Lowest demo category estimate.
                  </p>
                </div>
              </div>

              {/* Actual Live Feedback vs Demo Reference Log (Requirement 4) */}
              <div className="space-y-4">
                {/* 1. Actual Live User Feedback Log */}
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">Actual Recorded Feedback</span>
                    <span className="text-slate-400">{actualFeedbackCount} Live Event(s)</span>
                  </div>

                  {profile.logs && profile.logs.length > 0 ? (
                    <div className="divide-y divide-slate-100 text-xs">
                      {profile.logs.map((item) => (
                        <div key={item.id} className="py-2.5 flex items-center justify-between">
                          <div>
                            <div className="font-medium text-slate-800">{item.actionTitle}</div>
                            <div className="text-[11px] text-slate-400">
                              {item.category} · Capacity {Math.round(item.budgetBefore * 100)}% → {Math.round(item.budgetAfter * 100)}%
                            </div>
                          </div>
                          <div>
                            {item.completed ? (
                              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-semibold text-[10px] border border-emerald-200">
                                Completed (+5%)
                              </span>
                            ) : (
                              <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md font-semibold text-[10px] border border-amber-200">
                                Too Hard (-10%)
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-4 text-center text-slate-400 text-xs border border-dashed border-slate-100 rounded-xl">
                      No live feedback logged yet. Mark an action Completed or Too Hard on Today screen.
                    </div>
                  )}
                </div>

                {/* 2. Seeded Demo Baseline Reference */}
                <div className="bg-white/60 border border-slate-200/60 rounded-2xl p-4 text-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-600">Seeded Historical Prior (Demo Reference)</span>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Simulation Data</span>
                  </div>
                  <div className="space-y-1.5 opacity-75">
                    {SEED_BASELINE_LOGS.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-[11px] py-1 border-b border-slate-100 last:border-0">
                        <span className="text-slate-700">{item.title}</span>
                        <span className="text-slate-400">{item.date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* General Wellness Framing Disclaimer */}
              <div className="text-center text-[11px] text-slate-400 py-2">
                MINIMUM is an algorithmic consistency engine for general wellness and personal habits. It does not provide medical diagnoses or treatment plans.
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}
