// SDK Денчика: объект-приёмник сообщений сайта. Создаётся сам из D37.Init (класть в сцену не нужно), живёт между сценами.
// Сайт → jslib → SendMessage("D37Bridge", "D37Receive", json) → D37.Receive. Каждый кадр — D37.Tick (счёт, ожидание сайта).
using UnityEngine;

[AddComponentMenu("")]
[DisallowMultipleComponent]
public class D37Bridge : MonoBehaviour
{
    /// <summary>Имя объекта в сцене — по нему jslib зовёт SendMessage (не переименовывай).</summary>
    public const string ObjectName = "D37Bridge";
    internal static D37Bridge Instance;

    internal static void Ensure()
    {
        if (Instance != null) return;
        var go = GameObject.Find(ObjectName);
        if (go == null) go = new GameObject(ObjectName);
        Instance = go.GetComponent<D37Bridge>();
        if (Instance == null) Instance = go.AddComponent<D37Bridge>();
        if (go.transform.parent != null) go.transform.SetParent(null);   // переживает смену сцен только объект верхнего уровня
        DontDestroyOnLoad(go);
    }

    // Зовёт jslib (SendMessage) — сообщение сайта строкой JSON
    public void D37Receive(string json)
    {
        D37.Receive(json);
    }

    void Update()
    {
        D37.Tick();
    }

    void OnDestroy()
    {
        if (Instance == this) Instance = null;
    }
}
