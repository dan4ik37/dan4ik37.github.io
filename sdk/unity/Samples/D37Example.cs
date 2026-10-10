// SDK Денчика — пример. Повесь на любой объект сцены и нажми Play (или собери WebGL и добавь на сайт).
// Кнопки на экране (OnGUI, без пакетов UI): очки, монеты, конец раунда; комната: создать, войти по коду, выйти.
// Мини-игра для комнаты — общий счётчик: гости шлют хосту «click», хост прибавляет и рассылает всем «state».
// Так устроены все игры с хостом: решает хост, гости шлют ему свои действия и показывают то, что он прислал.
// В редакторе (без сайта) есть кнопки «+ друг» и «клик от друга» — комнату можно проверить без второго игрока.
using System.Collections.Generic;
using UnityEngine;

public class D37Example : MonoBehaviour
{
    [System.Serializable]
    class State { public int value; public string last; }

    int score;
    State shared = new State { value = 0, last = "" };
    string code = "";
    readonly List<string> log = new List<string>();
    Vector2 scroll;

    void Start()
    {
        D37.Init(() => Say("Привет, " + D37.Player.Nick + (D37.IsOnline ? " (на сайте)" : " (без сайта)") + (D37.Player.IsGuest ? ", гость" : "") + (D37.Player.IsVip ? ", VIP" : "")));
        D37.OnPlayerChanged += p => Say("Теперь играет " + p.Nick);
        D37.OnResult += r => Say(r.Ok ? "Засчитано: +" + r.Xp + " XP, +" + r.Coins + " монет" + (r.Record ? ", рекорд!" : "") + " (лучший " + r.Best + ")" : "Не засчитано: " + r.Reason);

        D37.Room.OnJoined += () => Say("Комната " + D37.Room.Code + (D37.Room.IsHost ? " — ты хост, позови друзей: " + D37.Room.Link : " — хост " + Nick(D37.Room.Host)));
        D37.Room.OnLeft += () => Say("Вышли из комнаты");
        D37.Room.OnPlayerJoined += p =>
        {
            Say(p.Nick + " в комнате");
            if (D37.Room.IsHost) SendState(p.Id);   // новичку — текущее состояние
        };
        D37.Room.OnPlayerLeft += p => Say(p.Nick + " ушёл");
        D37.Room.OnHostChanged += h =>
        {
            Say("Хост: " + Nick(h));
            if (D37.Room.IsHost) SendState("");      // хост ушёл, теперь ведём мы — со своего последнего состояния
        };
        D37.Room.OnMessage += OnMessage;
        D37.Room.OnError += e => Say("Комната: " + e);
        // без сайта: что игра «отправила» в комнату понарошку
        D37.Simulate.OnSent += (to, type, json) => Say("(без сайта) → " + (to == "" ? "всем" : to) + ": " + type + " " + json);
    }

    void OnMessage(D37Message m)
    {
        if (m.Type == "click" && D37.Room.IsHost)
        {
            var who = m.Sender;
            shared.value++;
            shared.last = who != null ? who.Nick : "?";
            SendState("");
        }
        else if (m.Type == "state" && m.From == D37.Room.HostId)   // состояние принимаем только от хоста
        {
            var s = JsonUtility.FromJson<State>(m.Data);
            if (s != null) shared = s;
        }
    }

    void Click()
    {
        if (!D37.Room.InRoom) { score++; D37.Score(score); return; }
        if (D37.Room.IsHost) { shared.value++; shared.last = D37.Player.Nick; SendState(""); }
        else D37.Room.SendToHost("click", "{}");
    }

    void SendState(string to)
    {
        string json = JsonUtility.ToJson(shared);
        if (string.IsNullOrEmpty(to)) D37.Room.Send("state", json); else D37.Room.SendTo(to, "state", json);
    }

    static string Nick(D37RoomPlayer p) { return p != null ? p.Nick : "—"; }

    void Say(string s)
    {
        log.Add(s);
        if (log.Count > 30) log.RemoveAt(0);
        scroll.y = 99999;
        Debug.Log("[Пример] " + s);
    }

    void OnGUI()
    {
        float k = Mathf.Max(1f, Screen.height / 600f);   // крупнее на больших экранах и телефонах
        GUI.matrix = Matrix4x4.Scale(new Vector3(k, k, 1f));
        GUILayout.BeginArea(new Rect(10, 10, Screen.width / k - 20, Screen.height / k - 20));
        GUILayout.Label("SDK Денчика " + D37.Version + " · " + (D37.IsReady ? D37.Player.Nick : "подключаемся…") + (D37.IsOnline ? " · на сайте" : " · без сайта"));

        GUILayout.BeginHorizontal();
        if (GUILayout.Button(D37.Room.InRoom ? "Клик (" + shared.value + ")" : "+1 очко (" + score + ")", GUILayout.Height(40))) Click();
        if (GUILayout.Button("+5 монет (" + D37.RoundCoins + ")", GUILayout.Height(40))) D37.AddCoins(5);
        if (GUILayout.Button("Конец раунда", GUILayout.Height(40))) { D37.Over(score); score = 0; }
        if (GUILayout.Button("Победа", GUILayout.Height(40))) { D37.Win(score); score = 0; }
        if (GUILayout.Button("Тост", GUILayout.Height(40))) D37.Toast("Привет из Unity!");
        GUILayout.EndHorizontal();

        GUILayout.Space(8);
        if (!D37.Room.InRoom)
        {
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Создать комнату", GUILayout.Height(36))) D37.Room.Create();
            code = GUILayout.TextField(code, 12, GUILayout.Width(120), GUILayout.Height(36));
            if (GUILayout.Button("Войти по коду", GUILayout.Height(36))) D37.Room.Join(code);
            GUILayout.EndHorizontal();
        }
        else
        {
            GUILayout.Label("Комната " + D37.Room.Code + " · " + D37.Room.Players.Count + " из " + D37.Room.Max + (D37.Room.IsHost ? " · ты хост" : "") + " · счётчик " + shared.value + (shared.last != "" ? " (последний: " + shared.last + ")" : ""));
            foreach (var p in D37.Room.Players) GUILayout.Label((p.IsHost ? "[хост] " : "• ") + p.Nick + (p.IsMe ? " (ты)" : ""));
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Выйти", GUILayout.Height(32))) D37.Room.Leave();
            if (!D37.IsOnline)
            {
                if (GUILayout.Button("+ друг", GUILayout.Height(32))) D37.Simulate.AddPlayer("Друг");
                if (GUILayout.Button("+ хост раньше меня", GUILayout.Height(32))) D37.Simulate.AddPlayer("Хост", true);
                foreach (var p in D37.Room.Players)
                    if (!p.IsMe && GUILayout.Button("клик от " + p.Nick, GUILayout.Height(32))) D37.Simulate.Receive(p.Id, "click", "{}");
                var host = D37.Room.Host;
                if (host != null && !host.IsMe && GUILayout.Button("хост ушёл", GUILayout.Height(32))) D37.Simulate.RemovePlayer(host.Id);
            }
            GUILayout.EndHorizontal();
        }

        scroll = GUILayout.BeginScrollView(scroll);
        foreach (string s in log) GUILayout.Label(s);
        GUILayout.EndScrollView();
        GUILayout.EndArea();
    }
}
