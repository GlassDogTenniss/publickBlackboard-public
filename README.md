# publickBlackboard-public

`GlassDogTenniss/publickBlackboard`のWorkflow状態から、公開可能な項目だけを抽出して表示するread-only Dashboardです。

## 無料構成

GitHub Actionsは使用しません。

```text
Chrome拡張
  private state.jsonを既存のread-only tokenで取得
  ↓ 公開項目だけを抽出
  publickBlackboard-public/data/status.jsonへ直接commit
  ↓
公開Dashboardがpublic dataを読み込む
```

## Dashboard UI

private repositoryの`dashboard/index.html`で作成したWorkflow Mapと同じ構成です。

- Workflow概要と進捗カード
- agent graph
- ドラッグ可能なagentカード
- selected agent詳細
- 直近の引き継ぎ
- task一覧と送信回数表示
- 30秒ごとの自動更新
- スマートフォン向けresponsive layout

成果物欄は公開版では`非公開`と表示します。

## 公開するもの

- Workflow title、theme、status
- runId、iteration、current task / current agent
- taskごとのstatus、担当agent、attempt、更新時刻
- agent名、役割、担当task、進捗
- task間の接続
- 引き継ぎ履歴の制御情報
- status contract検査結果

private repositoryのstate全文、task instruction、handoff本文、成果物本文、evidence、内部path、commit SHA、blob SHA、GitHub tokenは公開しません。

## ファイル

```text
index.html
app.js
styles.css
data/status.json
.nojekyll
```

ページは公開repositoryの`data/status.json`を30秒ごとに再取得します。Chrome拡張はprivate stateのsnapshotが変わった場合だけ、内容を比較して`data/status.json`を更新します。

## GitHub Pages

通常はRepository settingsのPagesで次を設定します。

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

Pages URL:

```text
https://glassdogtenniss.github.io/publickBlackboard-public/
```

GitHub Pagesはbranch公開を選んだ場合も内部ではGitHub Actions deploymentを使います。アカウント側でActions jobが停止されている間はPagesが404のままになることがあります。

## Actionsを使わない閲覧URL

Pages deploymentを利用できない場合は、development用のraw.githack URLで同じHTMLを開けます。

```text
https://raw.githack.com/GlassDogTenniss/publickBlackboard-public/main/index.html
```

HTML、CSS、JavaScriptはraw.githackから読み込み、状態JSONは`raw.githubusercontent.com`から直接再取得します。

## 公開用token

Chrome拡張の「公開ステータス設定」へ、次のfine-grained tokenを保存します。

```text
Repository access: publickBlackboard-publicだけ
Repository permissions: Contents — Read and write
```

private黒板を読むread-only tokenとは分離します。tokenは拡張のtrusted local storageだけに保存され、公開ページへ渡されません。

## 注意

このrepositoryはpublicです。`data/status.json`へ個人情報、会話本文、secret、private repositoryの内容を追加しないでください。
