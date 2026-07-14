# publickBlackboard-public

`GlassDogTenniss/publickBlackboard`のWorkflow状態から、公開可能な項目だけを抽出して表示するread-only Dashboardです。

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
.github/workflows/pages.yml
```

ページは`data/status.json`を30秒ごとに再取得します。private repository側の`Publish sanitized workflow status`がstate更新時に安全化したJSONをこのrepositoryへpushします。

## GitHub Pages

`.github/workflows/pages.yml`がGitHub Pagesへdeployします。Repository settingsのPagesで次を設定します。

```text
Source: GitHub Actions
```

公開URLは通常、次の形式になります。

```text
https://glassdogtenniss.github.io/publickBlackboard-public/
```

## 注意

このrepositoryはpublicです。`data/status.json`へ個人情報、会話本文、secret、private repositoryの内容を追加しないでください。
