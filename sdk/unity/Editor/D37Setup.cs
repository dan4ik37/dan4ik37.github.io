// SDK Денчика: меню «SDK Денчика» в Unity — настроить сборку WebGL для сайта одним нажатием.
// Что делает «Настроить сборку для сайта»: сжатие Gzip + Decompression Fallback (игра грузится на любом хостинге,
// в том числе GitHub Pages, где нельзя настроить заголовки), без потоков (на сайте они не работают), шаблон страницы
// D37 (игра на всё окно, полоса загрузки по-русски) — его папка копируется в Assets/WebGLTemplates/D37.
using System.IO;
using UnityEditor;
using UnityEngine;

public static class D37Setup
{
    const string Docs = "https://github.com/dan4ik37/dan4ik37.github.io/tree/main/sdk/unity";
    const string Site = "https://dan4ik37.vercel.app/#/games/unity/new";

    [MenuItem("SDK Денчика/Настроить сборку для сайта", false, 1)]
    public static void Configure()
    {
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Gzip;
        PlayerSettings.WebGL.decompressionFallback = true;
        PlayerSettings.WebGL.threadsSupport = false;
        PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
        PlayerSettings.WebGL.nameFilesAsHashes = false;
        PlayerSettings.WebGL.dataCaching = true;
        PlayerSettings.runInBackground = true;
        string template = CopyTemplate();
        if (template != null) PlayerSettings.WebGL.template = "PROJECT:D37";
        bool webgl = EditorUserBuildSettings.activeBuildTarget == BuildTarget.WebGL;
        EditorUtility.DisplayDialog("SDK Денчика",
            "Готово:\n• сжатие Gzip + Decompression Fallback\n• без потоков (Multithreading)\n" +
            (template != null ? "• шаблон страницы D37 (игра на всё окно)\n" : "• шаблон D37 не найден — останется обычный\n") +
            (webgl ? "\nТеперь File → Build Settings → Build." : "\nОсталось переключиться на WebGL: File → Build Settings → WebGL → Switch Platform (или меню «SDK Денчика → Переключиться на WebGL»)."),
            "Понятно");
    }

    [MenuItem("SDK Денчика/Переключиться на WebGL", false, 2)]
    public static void SwitchToWebGL()
    {
        if (EditorUserBuildSettings.activeBuildTarget == BuildTarget.WebGL) { EditorUtility.DisplayDialog("SDK Денчика", "Проект уже собирается под WebGL.", "Хорошо"); return; }
        if (!EditorUtility.DisplayDialog("SDK Денчика", "Переключить проект на WebGL? Это может занять несколько минут (Unity переимпортирует ресурсы).\nЕсли пункта WebGL нет — установи модуль «WebGL Build Support» в Unity Hub.", "Переключить", "Отмена")) return;
        EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
    }

    [MenuItem("SDK Денчика/Инструкция", false, 20)]
    public static void OpenDocs() { Application.OpenURL(Docs); }

    [MenuItem("SDK Денчика/Добавить игру на сайт", false, 21)]
    public static void OpenSite() { Application.OpenURL(Site); }

    // Шаблон лежит в папке SDK (WebGLTemplates/D37) — Unity видит шаблоны только в Assets/WebGLTemplates, копируем туда
    static string CopyTemplate()
    {
        string root = SdkRoot();
        if (root == null) return null;
        string from = Path.Combine(root, "WebGLTemplates", "D37");
        if (!File.Exists(Path.Combine(from, "index.html"))) return null;
        string to = Path.Combine(Application.dataPath, "WebGLTemplates", "D37");
        if (Path.GetFullPath(from).TrimEnd('/', '\\') == Path.GetFullPath(to).TrimEnd('/', '\\')) return to;
        Directory.CreateDirectory(to);
        foreach (string f in Directory.GetFiles(from))
        {
            if (f.EndsWith(".meta")) continue;
            File.Copy(f, Path.Combine(to, Path.GetFileName(f)), true);
        }
        AssetDatabase.Refresh();
        return to;
    }

    // Папка SDK: где лежит этот скрипт (Assets/… или пакет Packages/…), на уровень выше папки Editor
    static string SdkRoot()
    {
        string[] guids = AssetDatabase.FindAssets("D37Setup t:MonoScript");
        foreach (string guid in guids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            if (!path.EndsWith("/Editor/D37Setup.cs")) continue;
            string dir = Path.GetDirectoryName(Path.GetDirectoryName(path));
            var pkg = UnityEditor.PackageManager.PackageInfo.FindForAssetPath(path);
            if (pkg != null && !string.IsNullOrEmpty(pkg.resolvedPath)) return pkg.resolvedPath;
            return Path.GetFullPath(dir);
        }
        return null;
    }
}
