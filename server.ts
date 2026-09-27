import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Setup
let db: any = null;
try {
  const configPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
  }
} catch (e) {
  console.error('Firebase init failed, falling back to in-memory', e);
}

// Initial demo baseline history
const DEMO_ADHERENCE_HISTORY = [
  { category: 'Physical', adherence: 0.84, friction: 0.28, liveFeedbackCount: 0 },
  { category: 'Mental', adherence: 0.72, friction: 0.35, liveFeedbackCount: 0 },
  { category: 'Social', adherence: 0.91, friction: 0.20, liveFeedbackCount: 0 },
  { category: 'Nutrition', adherence: 0.52, friction: 0.58, liveFeedbackCount: 0 },
  { category: 'Rest', adherence: 0.78, friction: 0.25, liveFeedbackCount: 0 },
];

// Curated goal-aligned single-action replacement candidates (ONE observable movement action)
const CURATED_MOVEMENT_ACTIONS = [
  {
    title: '5-Minute Doorway Spine & Hamstring Stretch',
    description: 'Stretch your calves gently beside a doorway.',
    category: 'Physical',
    frictionScore: 0.22,
    timeEstimate: 5,
  },
  {
    title: '8-Minute Quiet Outdoor Patio Stroll',
    description: 'Walk leisurely outside on your patio or yard to take in morning sunlight at an unhurried pace.',
    category: 'Physical',
    frictionScore: 0.30,
    timeEstimate: 8,
  },
  {
    title: '7-Minute Living Room Audiobook Pacing',
    description: 'Pace gently across your living space while listening to an audiobook.',
    category: 'Physical',
    frictionScore: 0.26,
    timeEstimate: 7,
  },
  {
    title: '4-Minute Morning Joint Mobility Roll',
    description: 'Gently sway your hips while standing beside your bed.',
    category: 'Physical',
    frictionScore: 0.16,
    timeEstimate: 4,
  },
  {
    title: '2-Minute Gentle Standing Torso Twist',
    description: 'Gently swing your arms side-to-side while standing.',
    category: 'Physical',
    frictionScore: 0.10,
    timeEstimate: 2,
  },
  {
    title: '1-Minute Bedside Ankle Mobility Circles',
    description: 'Rotate one ankle gently while standing beside your bed.',
    category: 'Physical',
    frictionScore: 0.08,
    timeEstimate: 1,
  }
];

const CURATED_READING_ACTIONS = [
  { title: 'Read One Paragraph', description: 'Read one paragraph from a book you enjoy.', category: 'Mental', frictionScore: 0.03, timeEstimate: 1 },
  { title: 'Read One Page', description: 'Read one page from a book you enjoy.', category: 'Mental', frictionScore: 0.08, timeEstimate: 2 },
  { title: 'Read for Three Minutes', description: 'Read a book for three minutes.', category: 'Mental', frictionScore: 0.14, timeEstimate: 3 },
  { title: 'Read for Five Minutes', description: 'Read a book for five minutes.', category: 'Mental', frictionScore: 0.20, timeEstimate: 5 },
];
const CURATED_HYDRATION_ACTIONS = [
  { title: 'Take One Sip of Water', description: 'Take one sip of water.', category: 'Nutrition', frictionScore: 0.03, timeEstimate: 1 },
  { title: 'Drink Half a Glass of Water', description: 'Drink half a glass of water.', category: 'Nutrition', frictionScore: 0.08, timeEstimate: 1 },
  { title: 'Drink a Glass of Water', description: 'Drink a glass of water.', category: 'Nutrition', frictionScore: 0.14, timeEstimate: 2 },
  { title: 'Refill Your Water Bottle', description: 'Refill your water bottle.', category: 'Nutrition', frictionScore: 0.20, timeEstimate: 2 },
];
const CURATED_SLEEP_ACTIONS = [
  { title: 'Dim One Light', description: 'Dim one light before bedtime.', category: 'Rest', frictionScore: 0.03, timeEstimate: 1 },
  { title: 'Put Your Phone Away', description: 'Put your phone out of reach at bedtime.', category: 'Rest', frictionScore: 0.08, timeEstimate: 1 },
  { title: 'Close the Bedroom Curtains', description: 'Close the bedroom curtains before sleep.', category: 'Rest', frictionScore: 0.12, timeEstimate: 1 },
  { title: 'Set a Bedtime Reminder', description: 'Set one bedtime reminder on your phone.', category: 'Rest', frictionScore: 0.18, timeEstimate: 2 },
];
function curatedActions(goal: string) {
  if (/read|book/i.test(goal)) return CURATED_READING_ACTIONS;
  if (/sleep|bedtime/i.test(goal)) return CURATED_SLEEP_ACTIONS;
  if (/hydrat|water/i.test(goal)) return CURATED_HYDRATION_ACTIONS;
  if (/walk|mov|stretch|exercise|fitness|weight|active/i.test(goal)) return CURATED_MOVEMENT_ACTIONS;
  return [];
}

// Server-side validation function to enforce Requirement 1
function validateCandidateAction(
  c: any,
  goal: string,
  availableTime: number,
  dislikes: string[],
  refusals: string[]
): { valid: boolean; reason?: string } {
  if (!c || typeof c.title !== 'string' || typeof c.description !== 'string') {
    return { valid: false, reason: 'Missing title or description' };
  }
  const text = `${c.title} ${c.description}`.toLowerCase();

  // 1. Time window constraint
  const timeEst = typeof c.timeEstimate === 'number' ? c.timeEstimate : 5;
  if (!Number.isInteger(timeEst) || timeEst < 1 || timeEst > availableTime) {
    return { valid: false, reason: `Exceeds available time (${timeEst}m > ${availableTime}m)` };
  }

  if (!Number.isFinite(c.frictionScore) || c.frictionScore < 0.01 || c.frictionScore > 1) return { valid: false, reason: 'Invalid friction estimate' };
  if (!['Physical', 'Mental', 'Social', 'Nutrition', 'Rest'].includes(c.category)) return { valid: false, reason: 'Unknown category' };

  // 2. Reject multi-action combinations (Do not combine hydration, preparation, and movement)
  const mentionsHydration = /\b(water|hydrate|hydration|drink|glass of|cup of|tea|coffee|sip)\b/i.test(text);
  const mentionsPrep = /\b(prepare|pack|lay out|shoes on|gear up|alarm|calendar|schedule|dressed)\b/i.test(text);
  const mentionsMovement = /\b(walk|stretch|mobility|stroll|step|pace|twist|pose|roll|movement|calisthenics)\b/i.test(text);

  if (mentionsHydration && mentionsMovement) {
    return { valid: false, reason: 'Rejected: combines hydration and movement into a multi-step task' };
  }
  if (mentionsPrep && mentionsMovement) {
    return { valid: false, reason: 'Rejected: combines preparation and movement into a multi-step task' };
  }

  // 3. Dislikes constraint (e.g. high-impact cardio, crowded gym)
  if (dislikes.some(d => /gym/i.test(d)) && /\b(gym|fitness center|weight room|treadmill|elliptical)\b/i.test(text)) {
    return { valid: false, reason: 'Rejected: violates dislike (crowded gyms)' };
  }
  if (dislikes.some(d => /cardio|impact|run|burpee/i.test(d)) && /\b(cardio|burpee|sprint|hiit|jumping jack|run|jog|jump rope|crossfit)\b/i.test(text)) {
    return { valid: false, reason: 'Rejected: violates dislike (high-impact cardio)' };
  }

  // 4. Non-negotiables (e.g. morning coffee, 8 hours of sleep)
  if (refusals.some(r => /coffee/i.test(r)) && /\b(skip coffee|without coffee|cut coffee|replace coffee|tea instead)\b/i.test(text)) {
    return { valid: false, reason: 'Rejected: violates non-negotiable (morning coffee)' };
  }
  if (refusals.some(r => /sleep/i.test(r)) && /\b(wake up earlier|sleep less|6 hours|cut sleep|early alarm)\b/i.test(text)) {
    return { valid: false, reason: 'Rejected: violates non-negotiable (8 hours sleep)' };
  }

  // 5. Must directly support movement if goal is movement
  if (/walk|mov|stretch|exercise|fitness|weight|active/i.test(goal) && !mentionsMovement) {
    return { valid: false, reason: 'Rejected: does not contain an observable movement action' };
  }

  if (/walk|mov|stretch|exercise|fitness|weight|active/i.test(goal) && c.category !== 'Physical') return { valid: false, reason: 'Movement action must be Physical' };
  if (/read|book/i.test(goal) && !/\b(read|page|paragraph|book)\b/i.test(text)) return { valid: false, reason: 'Unrelated to reading goal' };
  if (/sleep|bedtime/i.test(goal) && !/\b(bed|sleep|light|curtain|phone)\b/i.test(text)) return { valid: false, reason: 'Unrelated to sleep goal' };
  if (/hydrat|water/i.test(goal) && !/\b(water|drink|sip|bottle)\b/i.test(text)) return { valid: false, reason: 'Unrelated to hydration goal' };
  return { valid: true };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // One clearly labeled demo persona; authentication is not implemented.
  let useLocalProfile = !db;
  const withTimeout = <T,>(promise: Promise<T>, ms = 1500): Promise<T> => Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Firestore timed out')), ms)),
  ]);

  // Local state with exact acceptance scenario defaults
  let localProfile = {
    userId: 'default-user',
    goal: 'Build a daily morning movement habit.',
    refusals: ['morning coffee', '8 hours of sleep'],
    likes: ['nature walks', 'stretching', 'audiobooks'],
    dislikes: ['high-impact cardio', 'crowded gyms'],
    adherenceHistory: DEMO_ADHERENCE_HISTORY,
    frictionBudget: 0.75,
    logs: [],
    lastFeedback: null as any,
  };

  const getProfile = async (userId: string = 'default-user') => {
    if (useLocalProfile) return localProfile;
    try {
      const docRef = doc(db, 'users', userId);
      const docSnap = await withTimeout(getDoc(docRef));
      if (docSnap.exists()) {
        const data = docSnap.data();
        return {
          ...localProfile,
          ...data,
          frictionBudget: typeof data.frictionBudget === 'number' ? data.frictionBudget : localProfile.frictionBudget,
          adherenceHistory: (Array.isArray(data.adherenceHistory) && data.adherenceHistory.length > 0) ? data.adherenceHistory : DEMO_ADHERENCE_HISTORY,
          logs: data.logs || localProfile.logs,
          lastFeedback: data.lastFeedback !== undefined ? data.lastFeedback : localProfile.lastFeedback,
        };
      }
      return localProfile;
    } catch (e) {
      console.warn('Firestore read unavailable; using demo memory:', e);
      useLocalProfile = true;
      return localProfile;
    }
  };

  const saveProfile = async (profile: any, userId: string = 'default-user') => {
    localProfile = { ...localProfile, ...profile, userId };
    if (useLocalProfile) return;
    try {
      await withTimeout(setDoc(doc(db, 'users', userId), {
        userId: 'default-user',
        goal: (profile.goal || 'Build a daily morning movement habit.').slice(0, 500),
        frictionBudget: typeof profile.frictionBudget === 'number' ? Math.max(0.05, Math.min(1.0, profile.frictionBudget)) : 0.75,
        refusals: Array.isArray(profile.refusals) ? profile.refusals : [],
        likes: Array.isArray(profile.likes) ? profile.likes : [],
        dislikes: Array.isArray(profile.dislikes) ? profile.dislikes : [],
        adherenceHistory: (Array.isArray(profile.adherenceHistory) && profile.adherenceHistory.length > 0) ? profile.adherenceHistory : DEMO_ADHERENCE_HISTORY,
        logs: Array.isArray(profile.logs) ? profile.logs.slice(0, 20) : [],
        lastFeedback: profile.lastFeedback || null,
        updatedAt: serverTimestamp(),
      }, { merge: true }));
    } catch (e: any) {
      console.warn('Firestore sync unavailable; using demo memory:', e?.message || e);
      useLocalProfile = true;
    }
  };

  // Helper to query Gemini with automatic multi-model fallback
  async function generateContentWithFallback(prompt: string, schema: any) {
    if (!process.env.GEMINI_API_KEY) return null;
    const models = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
    for (const model of models) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        });
        if (response.text) {
          const cleaned = response.text.replace(/```json\n?|```/g, '').trim();
          return JSON.parse(cleaned);
        }
      } catch (err: any) {
        console.warn(`Model ${model} fallback note:`, err?.message || err);
        if (err?.status === 429 || /quota|resource_exhausted/i.test(err?.message || '')) break;
      }
    }
    return null;
  }

  // --- API Routes ---

  // GET /api/profile - persists updates across refresh
  app.get('/api/profile', async (req, res) => {
    const profile = await getProfile();
    res.json(profile);
  });

  // POST /api/analyze-goal
  app.post('/api/analyze-goal', async (req, res) => {
    const { 
      goal = 'Build a daily morning movement habit.', 
      refusals = ['morning coffee', '8 hours of sleep'], 
      likes = ['nature walks', 'stretching', 'audiobooks'], 
      dislikes = ['high-impact cardio', 'crowded gyms'] 
    } = req.body;

    try {
      const prompt = `Analyze this user profile for an adaptive wellness micro-habit coach called MINIMUM.
Goal: ${goal}
Non-negotiables: ${refusals.join(', ')}
Likes: ${likes.join(', ')}
Dislikes: ${dislikes.join(', ')}

Extract the core intent, relevant categories, and primary motivation.`;

      const schema = {
        type: Type.OBJECT,
        properties: {
          coreIntent: { type: Type.STRING },
          categories: { type: Type.ARRAY, items: { type: Type.STRING } },
          primaryMotivation: { type: Type.STRING },
        },
        required: ['coreIntent', 'categories', 'primaryMotivation'],
      };

      let analysis = await generateContentWithFallback(prompt, schema);

      if (!analysis) {
        analysis = {
          coreIntent: goal.trim(),
          categories: ['Physical', 'Rest'],
          primaryMotivation: 'Build a low-friction daily morning movement habit that protects coffee and sleep.'
        };
      }

      const profile = await getProfile();
      const updatedProfile = { 
        ...profile, 
        userId: 'default-user',
        goal: goal.trim(), 
        refusals, 
        likes, 
        dislikes 
      };
      await saveProfile(updatedProfile);

      return res.json(analysis);
    } catch (error: any) {
      console.error('Analyze goal error:', error);
      return res.json({
        coreIntent: goal.trim(),
        categories: ['Physical', 'Rest'],
        primaryMotivation: 'Sustainable baseline morning movement.'
      });
    }
  });

  // POST /api/recommend - Requirement 1 & 2
  app.post('/api/recommend', async (req, res) => {
    const { 
      context = 'Normal', 
      availableTime = 10,
      isRegenerate = false,
      previousFriction = null 
    } = req.body;

    try {
      if (!Number.isInteger(availableTime) || availableTime < 1 || availableTime > 60) return res.status(400).json({ error: 'Choose a time from 1 to 60 minutes.' });
      const profile = await getProfile();
      const userGoal = profile.goal || 'Build a daily morning movement habit.';
      const currentBudget = typeof profile.frictionBudget === 'number' ? Number(profile.frictionBudget.toFixed(2)) : 0.75;
      const dislikes = profile.dislikes || ['high-impact cardio', 'crowded gyms'];
      const refusals = profile.refusals || ['morning coffee', '8 hours of sleep'];
      const likes = profile.likes || ['nature walks', 'stretching', 'audiobooks'];

      const prompt = `You are MINIMUM, an adaptive AI goal coach that finds the smallest behavior a user will consistently perform.
User Goal: ${userGoal}
Context / State: ${context}
Available Time Window: ${availableTime} minutes
Current Capacity Friction Budget: ${(currentBudget * 100).toFixed(0)}%
${isRegenerate && previousFriction ? `CRITICAL REGENERATION CONSTRAINT: The previous action had friction ${(previousFriction * 100).toFixed(0)}%. You MUST generate strictly easier candidates with friction < ${(previousFriction * 100).toFixed(0)}%.` : ''}

NON-NEGOTIABLES (NEVER disrupt): ${refusals.join(', ')}
DISLIKES (ABSOLUTELY FORBIDDEN): ${dislikes.join(', ')}
LIKES (STRONGLY PRIORITIZE): ${likes.join(', ')}

STRICT RULES:
1. Generate EXACTLY 4 candidate actions.
2. Each candidate MUST contain EXACTLY ONE observable action directly supporting the goal "${userGoal}".
3. DO NOT COMBINE ACTIONS:
   - Absolutely NO combining hydration (drinking water/coffee) with movement.
   - Absolutely NO combining preparation (laying out clothes, packing a bag) with movement.
   - Every candidate is a single, isolated, observable action.
4. Time estimate must be <= ${availableTime} minutes.
5. NO high-impact cardio (no burpees, running, jumping jacks, HIIT). NO crowded gyms.
6. NO skipping coffee or reducing 8 hours of sleep.
7. Category must be "Physical" or "Rest".
8. Friction score must be between 0.05 and 0.85.`;

      const schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            category: { type: Type.STRING },
            frictionScore: { type: Type.NUMBER },
            timeEstimate: { type: Type.INTEGER },
          },
          required: ['title', 'description', 'category', 'frictionScore', 'timeEstimate'],
        },
      };

      let rawCandidates = await generateContentWithFallback(prompt, schema);

      if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
        rawCandidates = [];
      }

      // Server-side validation and rejection (Requirement 1)
      const validatedCandidates: any[] = [];
      const rejectionReasons: string[] = [];

      for (const cand of rawCandidates) {
        const val = validateCandidateAction(cand, userGoal, availableTime, dislikes, refusals);
        if (val.valid) {
          validatedCandidates.push({
            ...cand,
            frictionScore: Number(Math.max(0.05, Math.min(0.95, cand.frictionScore)).toFixed(2)),
            timeEstimate: Math.min(availableTime, Math.max(1, cand.timeEstimate || 5)),
            category: cand.category || 'Physical',
          });
        } else {
          rejectionReasons.push(`${cand.title || 'Candidate'}: ${val.reason}`);
        }
      }

      // Fill up to exactly 4 candidates using curated goal-aligned single actions
      const templatePool = isRegenerate ? [...curatedActions(userGoal)].sort((a, b) => a.frictionScore - b.frictionScore) : curatedActions(userGoal);
      let poolIndex = 0;
      while (validatedCandidates.length < 4 && poolIndex < templatePool.length) {
        const fallback = templatePool[poolIndex];
        poolIndex++;
        // Avoid duplicate titles
        if (validateCandidateAction(fallback, userGoal, availableTime, dislikes, refusals).valid && !validatedCandidates.some(c => c.title.toLowerCase() === fallback.title.toLowerCase())) {
          validatedCandidates.push({
            ...fallback,
            frictionScore: Number(fallback.frictionScore.toFixed(2)),
            timeEstimate: Math.min(availableTime, fallback.timeEstimate),
          });
        }
      }

      if (!validatedCandidates.length) return res.status(422).json({ error: 'No safe, goal-relevant action was found. Try a more specific goal.' });

      // Truncate to at most 4 candidates
      const fourCandidates = validatedCandidates.slice(0, 4);

      // Requirement 2: Friction budget as a REAL constraint
      // Candidates above today's budget CANNOT win (disqualified).
      // If regenerating after 'Too hard', candidate must be strictly easier than previousFriction.
      const scoredCandidates = fourCandidates.map((c: any) => {
        const hist = (profile.adherenceHistory || []).find((h: any) => h.category.toLowerCase() === c.category.toLowerCase()) 
          || { adherence: 0.84, friction: 0.28 };

        // Context Adjustment on Adherence Prior
        let adjAdherence = hist.adherence;
        if (context === 'Exhausted') adjAdherence = Number((adjAdherence * 0.70).toFixed(2));
        else if (context === 'Traveling') adjAdherence = Number((adjAdherence * 0.80).toFixed(2));
        else if (context === 'Motivated') adjAdherence = Number(Math.min(1.0, adjAdherence * 1.15).toFixed(2));
        else adjAdherence = Number(adjAdherence.toFixed(2));

        // Preference Factor
        const text = `${c.title} ${c.description}`.toLowerCase();
        let prefFactor = 0.50; // Neutral baseline
        if (likes.some((l: string) => text.includes(l.toLowerCase()))) {
          prefFactor = 0.95;
        } else if (dislikes.some((d: string) => text.includes(d.toLowerCase()))) {
          prefFactor = 0.10;
        }

        // REAL BUDGET CONSTRAINT CHECK
        const exceedsBudget = c.frictionScore > currentBudget;
        const priorFriction = profile.lastFeedback?.type === 'too_hard' ? profile.lastFeedback.actionFriction : null;
        const notStrictlyEasier = isRegenerate && typeof priorFriction === 'number' && c.frictionScore >= priorFriction;

        if (exceedsBudget) {
          return {
            ...c,
            disqualified: true,
            disqualificationReason: `Exceeds Capacity Budget (${Math.round(c.frictionScore * 100)}% > ${Math.round(currentBudget * 100)}%)`,
            score: -999,
            explainability: {
              adherencePrior: Number(hist.adherence.toFixed(2)),
              contextAdjustedAdherence: Number(adjAdherence.toFixed(2)),
              preferenceFactor: Number(prefFactor.toFixed(2)),
              actionFriction: Number(c.frictionScore.toFixed(2)),
              availableBudget: currentBudget,
              formula: `Disqualified: Friction ${Math.round(c.frictionScore * 100)}% > Capacity Budget ${Math.round(currentBudget * 100)}%`,
              status: 'Disqualified (Above Capacity Budget)'
            }
          };
        }

        if (notStrictlyEasier) {
          return {
            ...c,
            disqualified: true,
            disqualificationReason: `Not strictly easier than prior action (${Math.round(c.frictionScore * 100)}% >= ${Math.round(priorFriction * 100)}%)`,
            score: -999,
            explainability: {
              adherencePrior: Number(hist.adherence.toFixed(2)),
              contextAdjustedAdherence: Number(adjAdherence.toFixed(2)),
              preferenceFactor: Number(prefFactor.toFixed(2)),
              actionFriction: Number(c.frictionScore.toFixed(2)),
              availableBudget: currentBudget,
              formula: `Disqualified: Friction ${Math.round(c.frictionScore * 100)}% not strictly easier than prior ${Math.round(priorFriction * 100)}%`,
              status: 'Disqualified (Not Strictly Easier)'
            }
          };
        }

        // Deterministic Behavioral Scoring Formula:
        // Policy Score = (0.45 × Adherence Prior) + (0.35 × Preference Factor) - (0.20 × Action Friction)
        const compositeScore = (adjAdherence * 0.45) + (prefFactor * 0.35) - (c.frictionScore * 0.20);
        const finalScore = Number(compositeScore.toFixed(3));

        return {
          ...c,
          disqualified: false,
          score: finalScore,
          explainability: {
            adherencePrior: Number(hist.adherence.toFixed(2)),
            contextAdjustedAdherence: Number(adjAdherence.toFixed(2)),
            preferenceFactor: Number(prefFactor.toFixed(2)),
            actionFriction: Number(c.frictionScore.toFixed(2)),
            availableBudget: currentBudget,
            formula: `(0.45 × ${adjAdherence.toFixed(2)}) + (0.35 × ${prefFactor.toFixed(2)}) - (0.20 × ${c.frictionScore.toFixed(2)}) = ${finalScore.toFixed(2)}`,
            status: `Qualified: Friction ${Math.round(c.frictionScore * 100)}% ≤ Budget ${Math.round(currentBudget * 100)}%`
          }
        };
      });

      // Filter eligible candidates
      const eligible = scoredCandidates.filter(c => !c.disqualified);

      let winner: any = null;

      if (eligible.length > 0) {
        // Sort eligible by score descending
        eligible.sort((a, b) => b.score - a.score);
        winner = eligible[0];
      } else {
        return res.status(422).json({ error: 'No action fits the current budget. Try a shorter goal-relevant action.' });
      }

      // Sort full candidate list: qualified by score, disqualified at bottom
      scoredCandidates.sort((a, b) => {
        if (a.disqualified && !b.disqualified) return 1;
        if (!a.disqualified && b.disqualified) return -1;
        return (b.score || 0) - (a.score || 0);
      });

      // Transitions for Requirement 3
      const prevFric = isRegenerate && profile.lastFeedback?.type === 'too_hard' ? profile.lastFeedback.actionFriction : null;
      const nextFric = Number(winner.frictionScore.toFixed(2));

      return res.json({
        recommendation: winner,
        generationSource: rawCandidates.length ? 'Gemini proposals + deterministic policy' : 'Curated demo templates + deterministic policy',
        candidates: scoredCandidates,
        explainability: winner.explainability,
        behavioralModel: {
          adherenceHistory: profile.adherenceHistory || DEMO_ADHERENCE_HISTORY,
          frictionBudget: currentBudget,
        },
        frictionTransition: prevFric !== null ? {
          before: prevFric,
          after: nextFric,
          isEasier: nextFric < prevFric
        } : null,
        budgetTransition: profile.lastFeedback ? {
          before: profile.lastFeedback.budgetBefore,
          after: profile.lastFeedback.budgetAfter
        } : null
      });
    } catch (error: any) {
      console.error('Recommend error:', error);
      res.status(500).json({ error: 'Recommendation failed on the server. Check the server log.' });
    }
  });

  // POST /api/feedback - Requirement 2 & 3
  app.post('/api/feedback', async (req, res) => {
    const { completed, category = 'Physical', friction = 0.25, actionTitle = 'Micro-Intervention' } = req.body;

    try {
      const profile = await getProfile();
      const budgetBefore = Number((profile.frictionBudget || 0.75).toFixed(2));
      let budgetAfter = budgetBefore;

      if (completed) {
        // Completed: increase capacity headroom (+5%)
        budgetAfter = Math.min(1.0, Number((budgetBefore + 0.05).toFixed(2)));
      } else {
        // Too hard / Adjusted: strictly lower budget by -10% (Requirement 2)
        budgetAfter = Math.max(0.10, Number((budgetBefore - 0.10).toFixed(2)));
      }

      // Update adherence history
      const historyIndex = (profile.adherenceHistory || []).findIndex((h: any) => h.category.toLowerCase() === category.toLowerCase());
      if (historyIndex > -1) {
        const h = profile.adherenceHistory[historyIndex];
        const weight = 0.20;
        h.adherence = Number((h.adherence * (1 - weight) + (completed ? 1.0 : 0.0) * weight).toFixed(2));
        h.friction = Number((h.friction * (1 - weight) + friction * weight).toFixed(2));
        h.liveFeedbackCount = (h.liveFeedbackCount || 0) + 1;
      }

      profile.frictionBudget = budgetAfter;

      const feedbackRecord = {
        id: Date.now().toString(),
        type: completed ? 'completed' : 'too_hard',
        actionTitle: actionTitle,
        category: category,
        actionFriction: Number(friction.toFixed(2)),
        budgetBefore,
        budgetAfter,
        completed: !!completed,
        timestamp: new Date().toISOString(),
        displayDate: 'Just now'
      };

      profile.lastFeedback = feedbackRecord;
      profile.logs = [feedbackRecord, ...(profile.logs || []).slice(0, 19)];

      await saveProfile(profile);

      return res.json({
        success: true,
        updatedProfile: profile,
        beforeAfter: {
          budgetBefore,
          budgetAfter,
          actionFriction: Number(friction.toFixed(2)),
          type: completed ? 'completed' : 'too_hard'
        }
      });
    } catch (error: any) {
      console.error('Feedback error:', error);
      res.status(500).json({ error: 'Failed to record feedback' });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
