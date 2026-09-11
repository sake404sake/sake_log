# テーマ背景画像ガイド

SakeLogのテーマ背景画像を追加・差し替えするための資料です。

## 配置場所

背景画像は、次のフォルダーにテーマごとに配置します。

```text
src/
  assets/
    backgrounds/
      theme-sakura.webp
      theme-moon.webp
      theme-maple.webp
      theme-nature.webp
      theme-water.webp
      theme-bar.webp
      theme-kominka.webp
      theme-japan-modern.webp
      theme-gaming.webp
```

`src/assets/backgrounds/` がまだ存在しない場合は、新しく作成してください。

## ファイル名

ファイル名はテーマIDと対応させます。小文字とハイフンだけを使い、CSS側のパスと完全に一致させてください。

| 表示名 | テーマID | 推奨ファイル名 |
| --- | --- | --- |
| ダーク | `dark` | 背景なし |
| ライト | `light` | 背景なし |
| 桜 | `sakura` | `theme-sakura.webp` |
| 月 | `moon` | `theme-moon.webp` |
| 楓 | `maple` | `theme-maple.webp` |
| 自然 | `nature` | `theme-nature.webp` |
| 水 | `water` | `theme-water.webp` |
| 洋風のバー | `bar` | `theme-bar.webp` |
| 古民家 | `kominka` | `theme-kominka.webp` |
| 和モダン | `japan-modern` | `theme-japan-modern.webp` |
| ゲーム | `gaming` | `theme-gaming.webp` |

## 対応形式

第一候補は `WebP` です。

- 写真・風景: `WebP` または `JPG`
- 透過が必要な装飾: `PNG`
- 推奨サイズ: `1920 x 1080px` 前後
- 推奨容量: 1枚あたり `300KB〜1MB` 程度
- 大きすぎる画像はスマホの読み込みが遅くなるため避ける

## デザイン上の注意

背景はコンテンツの後ろに表示されるため、次の点を守ってください。

- 少し暗め、または低コントラストにする
- 中央に細かい模様や強い被写体を置かない
- 文字やロゴを画像に直接入れない
- ログカードや検索欄の文字が読める余白を作る
- 画像全体に薄いオーバーレイを重ねる
- スマホで縦長に切り取られても不自然にならない構図にする

## CSSへの登録

画像をフォルダーへ置くだけでは反映されません。`style.css` の該当テーマへ背景画像を登録します。

```css
html[data-theme="moon"] {
  --theme-bg-image:
    linear-gradient(rgba(17, 24, 39, 0.78), rgba(17, 24, 39, 0.78)),
    url("./src/assets/backgrounds/theme-moon.webp");
  --theme-bg-size: cover;
  --theme-bg-position: center;
}
```

ページ全体への適用ルールがない場合は、`html, body` に次の設定を追加します。

```css
html,
body {
  background-image: var(--theme-bg-image, none);
  background-size: var(--theme-bg-size, auto);
  background-position: var(--theme-bg-position, center);
  background-repeat: no-repeat;
  background-attachment: fixed;
}
```

SakeLogの現在のコードでは、背景画像を自動検出する仕組みはありません。画像追加時は、画像ファイルの配置とCSSのテーマ登録をセットで行ってください。

## GitHub Pagesでの注意

GitHub Pagesではファイル名の大文字・小文字を区別する場合があります。次のように、ファイル名とCSSのパスを完全に一致させてください。

```text
theme-moon.webp
```

```css
url("./src/assets/backgrounds/theme-moon.webp")
```

`Theme-Moon.webp` と `theme-moon.webp` は別ファイルとして扱われる可能性があります。

## 差し替え手順

1. 新しい画像を `src/assets/backgrounds/` に置く
2. ファイル名をテーマIDに合わせる
3. `style.css` の対象テーマの `url(...)` を更新する
4. GitHubへアップロードする
5. GitHub Pagesを強制再読み込みする
6. PCとスマホの両方で、文字やカードの読みやすさを確認する

ブラウザーに古い画像が残る場合は、CSSのURL末尾にバージョンを付ける方法もあります。

```css
url("./src/assets/backgrounds/theme-moon.webp?v=2")
```
