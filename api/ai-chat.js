/* Личный ИИ-чат. OpenAI ключ хранится только в Vercel Environment Variables. */
const SUPABASE_URL = process.env.SUPABASE_URL || "https://yedzfmibceboncrytbqz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_tSqbw3aeAgxYuzHhQurCuw_yDze4ZNn";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Используйте POST." });
  }
  const bearer = req.headers.authorization || "";
  if (!/^Bearer [^\s]+$/.test(bearer)) return res.status(401).json({ error: "Необходимо войти в «Работа»." });
  const token = bearer.slice(7);
  const authHeaders = { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token };
  try {
    const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: authHeaders, signal: AbortSignal.timeout(8000) });
    if (!userResponse.ok) return res.status(401).json({ error: "Сессия истекла. Войдите заново." });
    const user = await userResponse.json();
    if (!user.id) return res.status(401).json({ error: "Ошибка авторизации." });
    const path = "/rest/v1/rabota_members?select=user_id&user_id=eq." + encodeURIComponent(user.id) +
      "&role=eq.owner&active=is.true&limit=1";
    const memberResponse = await fetch(SUPABASE_URL + path, { headers: authHeaders, signal: AbortSignal.timeout(8000) });
    if (!memberResponse.ok) return res.status(403).json({ error: "Не удалось проверить права владельца." });
    const members = await memberResponse.json();
    if (!Array.isArray(members) || !members.length) return res.status(403).json({ error: "ИИ-чат доступен только владельцу." });

    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ error: "ИИ пока не подключён. Добавьте OPENAI_API_KEY в Environment Variables проекта Vercel и выполните повторный деплой." });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const messages = body?.messages;
    if (!Array.isArray(messages) || !messages.length || messages.length > 30 ||
        messages.some(m => !m || !["user","assistant"].includes(m.role) || typeof m.content !== "string" ||
          !m.content.trim() || m.content.length > 12000) ||
        messages[messages.length - 1].role !== "user") {
      return res.status(400).json({ error: "Некорректный формат сообщений." });
    }
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars > 45000) return res.status(413).json({ error: "Переписка слишком длинная. Начните новый чат." });

    const model = process.env.OPENAI_MODEL || "gpt-5-mini";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: "Ты полезный ИИ-помощник. Отвечай на языке пользователя, ясно и по делу. Не утверждай, что у тебя есть доступ к приложениям или данным, если инструменты не предоставлены.",
        input: messages.map(m => ({role:m.role,content:m.content})),
        max_output_tokens: 1200,
        store: false
      }),
      signal: AbortSignal.timeout(55000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const badKey = response.status === 401;
      const quota = response.status === 429;
      return res.status(badKey ? 503 : quota ? 429 : 502).json({
        error: badKey ? "Ключ OpenAI недействителен." :
          quota ? "Лимит или баланс OpenAI API исчерпан. Проверьте Billing." :
          "Ошибка OpenAI API: " + (data.error?.message || response.status)
      });
    }
    const content = (data.output || []).filter(x => x.type === "message" && x.role === "assistant")
      .flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text).join("\n").trim();
    if (!content) return res.status(502).json({ error: "OpenAI не вернул текст ответа. Попробуйте ещё раз." });
    return res.status(200).json({ reply: content });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({ error: "Превышено время ожидания. Повторите запрос." });
    }
    return res.status(500).json({ error: "Внутренняя ошибка ИИ-чата. Повторите попытку." });
  }
};
