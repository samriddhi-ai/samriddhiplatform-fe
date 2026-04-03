"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const supabase_js_1 = require("@supabase/supabase-js");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
}));
const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const authClient = (0, supabase_js_1.createClient)(supabaseUrl, supabaseAnonKey);
let dbClient = null;
if (supabaseServiceRoleKey) {
    dbClient = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceRoleKey);
}
else {
    console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is missing. Database-connected routes will fail.");
}
const rationalQuiz = [
    { id: "q1", answerIndex: 0, concept: "equivalent-fractions" },
    { id: "q2", answerIndex: 1, concept: "comparing-rationals" },
    { id: "q3", answerIndex: 1, concept: "fraction-operations" },
];
async function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
        res.status(401).json({ error: "Missing bearer token" });
        return;
    }
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) {
        res.status(401).json({ error: "Invalid token" });
        return;
    }
    req.userId = data.user.id;
    next();
}
function getWeakConceptRecommendations(attempts) {
    const missesByConcept = {};
    for (const attempt of attempts) {
        const answers = attempt.answers_json ?? {};
        for (const question of rationalQuiz) {
            const selected = answers[question.id];
            if (typeof selected === "number" && selected !== question.answerIndex) {
                missesByConcept[question.concept] = (missesByConcept[question.concept] ?? 0) + 1;
            }
        }
    }
    return Object.entries(missesByConcept)
        .sort((a, b) => b[1] - a[1])
        .map(([concept, misses]) => ({
        concept,
        misses,
    }));
}
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});
app.get("/subjects", async (_req, res) => {
    if (!dbClient) {
        res.status(500).json({ error: "Database client not initialized. Missing SUPABASE_SERVICE_ROLE_KEY." });
        return;
    }
    const { data, error } = await dbClient
        .from("subjects")
        .select("id, slug, title, class_level, is_active")
        .eq("is_active", true)
        .order("title");
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    res.json(data);
});
app.get("/subjects/:slug/modules", async (req, res) => {
    const { slug } = req.params;
    if (!dbClient) {
        res.status(500).json({ error: "Database client not initialized. Missing SUPABASE_SERVICE_ROLE_KEY." });
        return;
    }
    const { data: subject, error: subjectError } = await dbClient
        .from("subjects")
        .select("id")
        .eq("slug", slug)
        .single();
    if (subjectError || !subject) {
        res.status(404).json({ error: "Subject not found" });
        return;
    }
    const { data, error } = await dbClient
        .from("learning_modules")
        .select("id, slug, title, difficulty, content_json")
        .eq("subject_id", subject.id);
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    res.json(data);
});
app.post("/attempts", authMiddleware, async (req, res) => {
    const { moduleId, answers } = req.body;
    if (!moduleId || !answers) {
        res.status(400).json({ error: "moduleId and answers are required" });
        return;
    }
    const score = rationalQuiz.reduce((total, question) => {
        return total + (answers[question.id] === question.answerIndex ? 1 : 0);
    }, 0);
    if (!dbClient) {
        res.status(500).json({ error: "Database client not initialized. Missing SUPABASE_SERVICE_ROLE_KEY." });
        return;
    }
    const { error } = await dbClient.from("quiz_attempts").insert({
        user_id: req.userId,
        module_id: moduleId,
        score,
        answers_json: answers,
    });
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    res.json({ ok: true, score, total: rationalQuiz.length });
});
app.get("/progress/me", authMiddleware, async (req, res) => {
    if (!dbClient) {
        res.status(500).json({ error: "Database client not initialized. Missing SUPABASE_SERVICE_ROLE_KEY." });
        return;
    }
    const { data, error } = await dbClient
        .from("quiz_attempts")
        .select("score")
        .eq("user_id", req.userId);
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    const attempts = data ?? [];
    const attemptCount = attempts.length;
    const bestScore = attemptCount > 0 ? Math.max(...attempts.map((item) => item.score ?? 0)) : 0;
    const averageScore = attemptCount > 0
        ? Math.round((attempts.reduce((sum, item) => sum + (item.score ?? 0), 0) / attemptCount) * 10) / 10
        : 0;
    res.json({ attemptCount, bestScore, averageScore });
});
app.get("/recommendations/me", authMiddleware, async (req, res) => {
    if (!dbClient) {
        res.status(500).json({ error: "Database client not initialized. Missing SUPABASE_SERVICE_ROLE_KEY." });
        return;
    }
    const { data, error } = await dbClient
        .from("quiz_attempts")
        .select("answers_json")
        .eq("user_id", req.userId)
        .order("completed_at", { ascending: false });
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    const recommendations = getWeakConceptRecommendations((data ?? []));
    res.json(recommendations);
});
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Samriddhi API running on port ${port}`);
});
