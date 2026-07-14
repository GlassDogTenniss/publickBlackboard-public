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
GitHub Pagesがmainブランチのrootを公開
```

## 公開するもの

- Workflow全体のstatus
- runId
- iteration
- current task / current agent
- taskごとのstatus、担当agent、attempt、更新時刻

private repositoryのstate全文、handoff、成果物本文、evidence、内部path、GitHub tokenは公開しません。

## ファイル

```text
index.html
app.js
styles.css
data/status.json
.nojekyll
```

ページは`data/status.json`を30秒ごとに再取得します。Chrome拡張はprivate stateのsnapshotが更新された場合だけ、内容を比較して`data/status.json`を更新します。

## GitHub Pages

Repository settingsのPagesで次を設定します。

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

公開URLは通常、次の形式になります。

```text
https://glassdogtenniss.github.io/publickBlackboard-public/
```

## 公開用token

Chrome拡張の「公開ステータス設定」へ、次のfine-grained tokenを保存します。

```text
Repository access: publickBlackboard-publicだけ
Repository permissions: Contents — Read and write
```

private黒板を読むread-only tokenとは分離します。tokenは拡張のtrusted local storageだけに保存され、公開ページへ渡されません。

## 注意

このrepositoryはpublicです。`data/status.json`へ個人情報、会話本文、secret、private repositoryの内容を追加しないでください。
