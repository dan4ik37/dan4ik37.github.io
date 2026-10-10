// SDK Денчика для Unity — игра на сайте dan4ik37.vercel.app: игрок, очки, монеты, комнаты (первый вошедший — хост).
// Как подключить и собрать — README.md в папке SDK. Без сайта (в редакторе Unity или если сборку открыли отдельно) всё
// тоже работает: игрок — «Игрок», очки пишутся в консоль, комнаты — понарошку на этом компьютере (D37.Simulate добавляет
// «друзей» и присылает от них сообщения — так можно проверить логику хоста, не собирая WebGL).
// Сообщения с сайтом — JSON по протоколу из Plugins/WebGL/D37Bridge.jslib (поле t — тип).
// Unity 2021.3 и новее, без сторонних пакетов.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;

/// <summary>Игрок сайта (тот, кто сейчас играет).</summary>
[Serializable]
public class D37Player
{
    /// <summary>Постоянный номер игрока в ЭТОЙ игре (не номер аккаунта сайта). У гостя меняется, когда он закроет вкладку.</summary>
    public string Id = "local";
    public string Nick = "Игрок";
    /// <summary>true — не вошёл на сайт (XP, монеты и рекорды не сохраняются).</summary>
    public bool IsGuest = true;
    /// <summary>VIP сайта (или команда сайта) — можно дать косметику или бонус.</summary>
    public bool IsVip;
    /// <summary>Картинка персонажа с сайта: «data:image/png;base64,…» (может быть пустой).</summary>
    public string AvatarPng = "";

    /// <summary>Картинка персонажа текстурой (или null). Текстуру удаляй сам, когда она больше не нужна.</summary>
    public Texture2D LoadAvatar()
    {
        if (string.IsNullOrEmpty(AvatarPng)) return null;
        int i = AvatarPng.IndexOf("base64,", StringComparison.Ordinal);
        if (i < 0) return null;
        try
        {
            byte[] bytes = Convert.FromBase64String(AvatarPng.Substring(i + 7));
            var tex = new Texture2D(2, 2);
            if (tex.LoadImage(bytes)) return tex;
            UnityEngine.Object.Destroy(tex);
        }
        catch (Exception) { }
        return null;
    }
}

/// <summary>Игрок в комнате.</summary>
public class D37RoomPlayer
{
    /// <summary>Номер в комнате (перезашёл — новый номер).</summary>
    public string Id = "";
    /// <summary>Постоянный номер человека в этой игре (как D37.Player.Id у него самого).</summary>
    public string UserId = "";
    public string Nick = "";
    public bool IsGuest;
    public bool IsHost;
    public bool IsMe;
}

/// <summary>Сообщение от другого игрока комнаты.</summary>
public class D37Message
{
    public string From = "";
    public string Type = "";
    /// <summary>Строка, которую прислал игрок (обычно JSON — разбирай JsonUtility.FromJson).</summary>
    public string Data = "";
    public D37RoomPlayer Sender { get { return D37.Room.GetPlayer(From); } }
}

/// <summary>Ответ сайта на D37.Over: засчитано ли, сколько XP и монет, рекорд.</summary>
public class D37Result
{
    public bool Ok;
    public int Xp;
    public int Coins;
    public bool Record;
    public int Best;
    /// <summary>Почему не засчитано: auth (гость), too_fast (чаще раза в 10 с), preview, offline, error…</summary>
    public string Reason = "";
}

public static class D37
{
    public const string Version = "1.0.0";
    /// <summary>Сколько монет можно дать за один раунд (сайт режет больше).</summary>
    public const int MaxRoundCoins = 50;
    /// <summary>Самое длинное сообщение комнаты (знаков).</summary>
    public const int MaxData = 8192;

    /// <summary>Init закончился (на сайте или без него) — можно читать Player.</summary>
    public static bool IsReady { get; private set; }
    /// <summary>Игра открыта на сайте и мост работает.</summary>
    public static bool IsOnline { get; private set; }
    // без сайта: не онлайн и уже не ждём ответа на hello (пока ждём — сообщения копит jslib и отдаст после init)
    static bool Offline { get { return !IsOnline && !waitingSite; } }
    /// <summary>Автор проверяет игру в «▶ Проверить»: результаты не сохраняются.</summary>
    public static bool IsPreview { get; private set; }
    public static D37Player Player { get; private set; } = new D37Player();
    public static string GameId { get; private set; } = "";
    public static string GameTitle { get; private set; } = "";
    /// <summary>Сколько игроков в комнате разрешил автор при добавлении игры (1 — без комнат).</summary>
    public static int MaxPlayers { get; private set; } = 1;

    public static event Action OnReady;
    /// <summary>Игрок вошёл/вышел на сайте, пока игра открыта.</summary>
    public static event Action<D37Player> OnPlayerChanged;
    public static event Action<D37Result> OnResult;

    static readonly List<Action> waiting = new List<Action>();
    static bool started, waitingSite;
    static float initAt = 0f;
    static int lastScore = -1, pendingScore = -1, roundCoins;
    static float lastScoreAt = -10f;

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] static extern int D37_Init(string goName, string helloJson);
    [DllImport("__Internal")] static extern int D37_Post(string json);
    [DllImport("__Internal")] static extern int D37_IsEmbedded();
    [DllImport("__Internal")] static extern string D37_PageInfo();
#endif

    /// <summary>Подключиться к сайту. onReady — когда известен игрок (на сайте — через долю секунды, без сайта — сразу).</summary>
    public static void Init(Action onReady = null)
    {
        if (onReady != null) { if (IsReady) Safe(onReady); else waiting.Add(onReady); }
        if (started) return;
        started = true;
        D37Bridge.Ensure();
#if UNITY_WEBGL && !UNITY_EDITOR
        if (D37_IsEmbedded() == 1)
        {
            waitingSite = true;
            initAt = Time.realtimeSinceStartup;
            D37_Init(D37Bridge.ObjectName, "{\"sdk\":" + Json(Version) + ",\"unity\":" + Json(Application.unityVersion) + "}");
            return;
        }
#endif
        GoOffline();
    }

    /// <summary>Счёт по ходу игры (сайт показывает его под игрой). Можно звать каждый кадр — уходит не чаще 10 раз в секунду.</summary>
    public static void Score(int score)
    {
        score = Mathf.Max(0, score);
        if (score == lastScore && pendingScore < 0) return;
        pendingScore = score;
        FlushScore(false);
    }

    /// <summary>Монеты сайта 🪙 за этот раунд (копятся до D37.Over, всего до 50; дневные лимиты — у сайта).</summary>
    public static void AddCoins(int coins)
    {
        if (coins > 0) roundCoins = Mathf.Min(MaxRoundCoins, roundCoins + coins);
    }
    public static int RoundCoins { get { return roundCoins; } }

    /// <summary>Конец раунда: рекорд игры, XP за победу, монеты раунда. Ответ сайта — в OnResult.</summary>
    public static void Over(int score, bool win = false)
    {
        score = Mathf.Max(0, score);
        pendingScore = -1;
        lastScore = score;
        int coins = roundCoins;
        roundCoins = 0;
        if (!Offline)
        {
            Post("{\"t\":\"over\",\"n\":" + score + ",\"win\":" + (win ? "true" : "false") + ",\"coins\":" + coins + "}");
            return;
        }
        Debug.Log("[D37] Конец раунда: очки " + score + (win ? ", победа" : "") + ", монеты " + coins + " (без сайта — не сохраняется)");
        var r = new D37Result { Ok = false, Reason = "offline", Best = score };
        Safe(() => { if (OnResult != null) OnResult(r); });
    }
    public static void Win(int score) { Over(score, true); }
    public static void Win() { Over(Math.Max(0, lastScore), true); }
    public static void Lose(int score) { Over(score, false); }

    /// <summary>Всплывающая надпись на сайте (до 140 знаков, не чаще раза в секунду).</summary>
    public static void Toast(string text)
    {
        if (string.IsNullOrEmpty(text)) return;
        if (!Offline) Post("{\"t\":\"toast\",\"text\":" + Json(Cut(text, 140)) + "}");
        else Debug.Log("[D37] " + text);
    }

    /// <summary>Строка в консоль браузера (видна автору в «▶ Проверить»).</summary>
    public static void Log(string text)
    {
        Debug.Log("[D37] " + text);
        if (!Offline) Post("{\"t\":\"log\",\"text\":" + Json(Cut(text ?? "", 300)) + "}");
    }

    /// <summary>Отладка: где открыта игра (адрес страницы, сайт).</summary>
    public static string DebugInfo()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return D37_PageInfo();
#else
        return "{\"editor\":true}";
#endif
    }

    // ═══ Комнаты ═══
    public static class Room
    {
        static readonly List<D37RoomPlayer> players = new List<D37RoomPlayer>();
        public static IReadOnlyList<D37RoomPlayer> Players { get { return players; } }
        public static string Code { get; private set; } = "";
        /// <summary>Ссылка, по которой друзья попадут в эту комнату.</summary>
        public static string Link { get; private set; } = "";
        public static int Max { get; private set; }
        public static string MyId { get; private set; } = "";
        public static string HostId { get; private set; } = "";
        public static bool InRoom { get { return !string.IsNullOrEmpty(Code); } }
        /// <summary>Я — хост: моя игра ведёт партию (считает мир, проверяет ходы гостей, рассылает состояние).</summary>
        public static bool IsHost { get { return InRoom && MyId == HostId; } }
        public static D37RoomPlayer Host { get { return GetPlayer(HostId); } }

        /// <summary>Вошли в комнату (Players уже заполнен; для остальных придёт OnPlayerJoined).</summary>
        public static event Action OnJoined;
        public static event Action OnLeft;
        public static event Action<D37RoomPlayer> OnPlayerJoined;
        public static event Action<D37RoomPlayer> OnPlayerLeft;
        /// <summary>Сменился хост (прежний ушёл). Если хост теперь ты — продолжай партию со своего последнего состояния.</summary>
        public static event Action<D37RoomPlayer> OnHostChanged;
        public static event Action<D37Message> OnMessage;
        /// <summary>full, dup, offline, code, single, rate, nobody, no_room, size, type.</summary>
        public static event Action<string> OnError;

        /// <summary>Новая комната (ты в ней первый — значит, хост). Ссылка для друзей — Link (сайт тоже показывает её под игрой).</summary>
        public static void Create()
        {
            if (Offline) { Simulate.Start("local"); return; }
            Post("{\"t\":\"room.create\"}");
        }
        /// <summary>Войти в комнату по коду (4–12 латинских букв и цифр).</summary>
        public static void Join(string code)
        {
            code = (code ?? "").Trim().ToLowerInvariant();
            if (!ValidCode(code)) { Fail("code"); return; }
            if (Offline) { Simulate.Start(code); return; }
            Post("{\"t\":\"room.join\",\"code\":" + Json(code) + "}");
        }
        public static void Leave()
        {
            if (Offline) { Simulate.Stop(); return; }
            Post("{\"t\":\"room.leave\"}");
        }
        /// <summary>Всем в комнате (кроме себя). type — короткое имя (латиница, цифры, _ . : -), json — любая строка до 8192 знаков.
        /// reliable: false — можно потерять (позиции каждые 0,1 с), true — дойдёт по порядку (ходы, события).</summary>
        public static void Send(string type, string json, bool reliable = true) { SendTo("", type, json, reliable); }
        public static void SendToHost(string type, string json, bool reliable = true) { SendTo(HostId, type, json, reliable); }
        public static void SendTo(string playerId, string type, string json, bool reliable = true)
        {
            if (!ValidType(type)) { Fail("type"); return; }
            json = json ?? "";
            if (json.Length > MaxData) { Fail("size"); return; }
            if (!InRoom) { Fail("no_room"); return; }
            if (Offline) { Simulate.Sent(playerId ?? "", type, json); return; }
            Post("{\"t\":\"room.send\",\"to\":" + Json(playerId ?? "") + ",\"type\":" + Json(type) + ",\"data\":" + Json(json) + ",\"rel\":" + (reliable ? "true" : "false") + "}");
        }
        public static D37RoomPlayer GetPlayer(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            for (int i = 0; i < players.Count; i++) if (players[i].Id == id) return players[i];
            return null;
        }

        static bool ValidCode(string c)
        {
            if (c.Length < 4 || c.Length > 12) return false;
            foreach (char ch in c) if (!((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'))) return false;
            return true;
        }
        static bool ValidType(string t)
        {
            if (string.IsNullOrEmpty(t) || t.Length > 32) return false;
            foreach (char ch in t)
                if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '.' || ch == ':' || ch == '-')) return false;
            return true;
        }

        // Состояние комнаты целиком (сайт шлёт его при любой перемене) → события по разнице с прошлым
        internal static void ApplyState(D37Wire w)
        {
            string oldCode = Code, oldHost = HostId;
            var old = new Dictionary<string, D37RoomPlayer>();
            foreach (var p in players) old[p.Id] = p;
            var fresh = new List<D37RoomPlayer>();
            if (w.players != null)
                foreach (var x in w.players)
                {
                    if (x == null || string.IsNullOrEmpty(x.id)) continue;
                    fresh.Add(new D37RoomPlayer { Id = x.id, UserId = x.uid ?? "", Nick = x.nick ?? "", IsGuest = x.guest, IsHost = x.id == w.host, IsMe = x.id == w.me });
                }
            Code = w.code ?? ""; Link = w.link ?? ""; Max = w.max; MyId = w.me ?? ""; HostId = w.host ?? "";
            players.Clear();
            players.AddRange(fresh);
            if (string.IsNullOrEmpty(Code))
            {
                MyId = ""; HostId = "";
                if (!string.IsNullOrEmpty(oldCode)) Safe(() => { if (OnLeft != null) OnLeft(); });
                return;
            }
            if (Code != oldCode)
            {
                if (!string.IsNullOrEmpty(oldCode)) Safe(() => { if (OnLeft != null) OnLeft(); });
                old.Clear(); oldHost = "";
                Safe(() => { if (OnJoined != null) OnJoined(); });
            }
            foreach (var p in fresh)
                if (!p.IsMe && !old.ContainsKey(p.Id)) { var pp = p; Safe(() => { if (OnPlayerJoined != null) OnPlayerJoined(pp); }); }
            foreach (var kv in old)
                if (fresh.Find(p => p.Id == kv.Key) == null) { var pp = kv.Value; Safe(() => { if (OnPlayerLeft != null) OnPlayerLeft(pp); }); }
            if (HostId != oldHost) { var h = GetPlayer(HostId); Safe(() => { if (OnHostChanged != null) OnHostChanged(h); }); }
        }
        internal static void Deliver(string from, string type, string data)
        {
            var m = new D37Message { From = from ?? "", Type = type ?? "", Data = data ?? "" };
            Safe(() => { if (OnMessage != null) OnMessage(m); });
        }
        internal static void Fail(string reason)
        {
            reason = reason ?? "";
            if (reason != "rate") Debug.LogWarning("[D37] Комната: " + reason);
            Safe(() => { if (OnError != null) OnError(reason); });
        }
    }

    // ═══ Без сайта (редактор Unity): «друзья» понарошку — проверить логику хоста и гостей ═══
    public static class Simulate
    {
        /// <summary>Что игра отправила в комнату без сайта: кому (пусто — всем), тип, данные.</summary>
        public static event Action<string, string, string> OnSent;
        static readonly List<D37WirePlayer> sim = new List<D37WirePlayer>();
        static string code = "";
        static int counter;

        /// <summary>«Друг» входит в комнату. joinedBeforeMe — он вошёл раньше тебя, то есть он хост, а ты гость.</summary>
        public static D37RoomPlayer AddPlayer(string nick, bool joinedBeforeMe = false)
        {
            if (!Offline) { Debug.LogWarning("[D37] Simulate работает только без сайта"); return null; }
            if (!Room.InRoom) Start("local");
            counter++;
            var p = new D37WirePlayer { id = "sim" + counter, uid = "gsim" + counter, nick = string.IsNullOrEmpty(nick) ? "Друг " + counter : nick, guest = true };
            if (joinedBeforeMe) sim.Insert(0, p); else sim.Add(p);
            Push();
            return Room.GetPlayer(p.id);
        }
        /// <summary>«Друг» вышел (если это был хост — хостом станет следующий).</summary>
        public static void RemovePlayer(string id)
        {
            if (!Offline || id == "me") return;
            sim.RemoveAll(p => p.id == id);
            Push();
        }
        /// <summary>«Друг» прислал сообщение.</summary>
        public static void Receive(string fromId, string type, string json)
        {
            if (!Offline || !Room.InRoom) return;
            Room.Deliver(fromId, type, json ?? "");
        }

        internal static void Start(string roomCode)
        {
            code = roomCode;
            sim.Clear();
            sim.Add(new D37WirePlayer { id = "me", uid = Player.Id, nick = Player.Nick, guest = Player.IsGuest });
            Push();
        }
        internal static void Stop()
        {
            code = "";
            sim.Clear();
            Push();
        }
        internal static void Sent(string to, string type, string json)
        {
            Safe(() => { if (OnSent != null) OnSent(to, type, json); });
        }
        static void Push()
        {
            var w = new D37Wire { t = "room.state", code = code, max = 8, me = code == "" ? "" : "me", host = sim.Count > 0 ? sim[0].id : "", link = "", players = sim.ToArray() };
            Room.ApplyState(w);
        }
    }

    // ═══ Внутреннее: приём от сайта (D37Bridge.D37Receive), отправка, таймеры ═══
    internal static void Receive(string json)
    {
        D37Wire w;
        try { w = JsonUtility.FromJson<D37Wire>(json); }
        catch (Exception e) { Debug.LogWarning("[D37] Не разобрал сообщение сайта: " + e.Message); return; }
        if (w == null || string.IsNullOrEmpty(w.t)) return;
        switch (w.t)
        {
            case "init": ApplyInit(w); break;
            case "player": SetPlayer(w.player); Safe(() => { if (OnPlayerChanged != null) OnPlayerChanged(Player); }); break;
            case "room.state": Room.ApplyState(w); break;
            case "room.msg": Room.Deliver(w.from, w.type, w.data); break;
            case "room.error": Room.Fail(w.reason); break;
            case "result":
                var r = new D37Result { Ok = w.ok, Xp = w.xp, Coins = w.coins, Record = w.record, Best = w.best, Reason = w.reason ?? "" };
                Safe(() => { if (OnResult != null) OnResult(r); });
                break;
        }
    }

    static void ApplyInit(D37Wire w)
    {
        waitingSite = false;
        bool wasReady = IsReady;
        if (!IsOnline && Room.InRoom) Simulate.Stop();   // успели поиграть «без сайта» — комната была понарошку
        IsOnline = true;
        IsPreview = w.preview;
        if (w.game != null) { GameId = w.game.id ?? ""; GameTitle = w.game.title ?? ""; MaxPlayers = Mathf.Max(1, w.game.players); }
        SetPlayer(w.player);
        if (wasReady) Safe(() => { if (OnPlayerChanged != null) OnPlayerChanged(Player); });
        MarkReady();
    }

    static void SetPlayer(D37WirePlayer p)
    {
        if (p == null || string.IsNullOrEmpty(p.id)) return;
        Player = new D37Player { Id = p.id, Nick = string.IsNullOrEmpty(p.nick) ? "Игрок" : p.nick, IsGuest = p.guest, IsVip = p.vip, AvatarPng = p.avatar ?? "" };
    }

    static void GoOffline()
    {
        waitingSite = false;
        IsOnline = false;
        MaxPlayers = 8;
        MarkReady();
    }

    static void MarkReady()
    {
        if (IsReady) return;
        IsReady = true;
        var list = waiting.ToArray();
        waiting.Clear();
        foreach (var a in list) Safe(a);
        Safe(() => { if (OnReady != null) OnReady(); });
    }

    // Каждый кадр (из D37Bridge.Update): досылаем счёт; сайт не ответил на hello за 5 с — играем без него
    internal static void Tick()
    {
        if (pendingScore >= 0) FlushScore(false);
        if (waitingSite && !IsReady && Time.realtimeSinceStartup - initAt > 5f)
        {
            Debug.LogWarning("[D37] Сайт не ответил — играем без него (ник, очки и комнаты не работают)");
            GoOffline();
        }
    }

    static void FlushScore(bool force)
    {
        if (pendingScore < 0) return;
        float now = Time.realtimeSinceStartup;
        if (!force && now - lastScoreAt < 0.1f) return;
        lastScoreAt = now;
        lastScore = pendingScore;
        pendingScore = -1;
        if (!Offline) Post("{\"t\":\"score\",\"n\":" + lastScore + "}");
    }

    static void Post(string json)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (IsOnline || waitingSite) D37_Post(json);
#endif
    }

    internal static void Safe(Action a)
    {
        try { a(); } catch (Exception e) { Debug.LogException(e); }
    }

    static string Cut(string s, int max) { return s.Length <= max ? s : s.Substring(0, max); }

    // Строка → JSON-строка в кавычках (кавычки, \, переводы строк и управляющие символы экранируются)
    internal static string Json(string s)
    {
        if (s == null) return "\"\"";
        var sb = new StringBuilder(s.Length + 8);
        sb.Append('"');
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < ' ' || c == (char)0x2028 || c == (char)0x2029) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }
}

// Сообщение сайта как есть (JsonUtility: лишние поля игнорирует, недостающие — по умолчанию)
[Serializable]
internal class D37Wire
{
    public int d37u;
    public string t;
    public int v;
    public bool online;
    public bool preview;
    public D37WirePlayer player;
    public D37WireGame game;
    public string code;
    public int max;
    public string me;
    public string host;
    public string link;
    public D37WirePlayer[] players;
    public string from;
    public string type;
    public string data;
    public bool ok;
    public int xp;
    public int coins;
    public bool record;
    public int best;
    public string reason;
}

[Serializable]
internal class D37WirePlayer
{
    public string id;
    public string uid;
    public string nick;
    public bool guest;
    public bool vip;
    public bool host;
    public bool me;
    public string avatar;
}

[Serializable]
internal class D37WireGame
{
    public string id;
    public string title;
    public int players;
}
