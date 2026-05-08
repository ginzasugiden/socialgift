# ソーシャルギフト設定侍 — CLAUDE.md

## プロジェクト概要

楽天 RMS の **ItemAPI 2.0** を使って、商品ごとの `features.socialGiftFlag`（ソーシャルギフト対応の ON/OFF）を一括で確認・編集するための、店舗運営者向けのシンプルな Web ツール。

- 対象ユーザー: 楽天市場店舗の運営者（社内ツールとしてライセンス制で配布）
- 公開URL: `CNAME` ファイルに記載のカスタムドメイン（GitHub Pages にバインド）
- ホスティング: GitHub Pages（静的配信）

UI 上の主要操作:
1. ID / PW でログイン（GAS 経由でスプレッドシート認証）
2. 検索モードを「商品コード」(完全一致 / カンマ区切り) と「商品名」(部分一致) で切替。商品名検索は「もっと読み込む」で 50 件ずつページング。
3. 結果一覧の各行のトグルで現在の `socialGiftFlag` を確認・変更
4. 「変更を適用」で PATCH 一括反映（クライアント側スロットリング + レート制限自動リトライ付き）

## アーキテクチャ

```
Browser (GitHub Pages)
   │   ※ すべて GET（CORS preflight 回避のため）
   ▼
GAS Web App (doGet) ─── Google スプレッドシート（ライセンス管理）
   │
   ▼ 楽天 RMS ItemAPI 2.0（GAS 側で正規化）
     - GET   /es/2.0/items/search                    （部分一致検索、numFound + manageNumbers）
     - POST  /es/2.0/items/bulk-get                  （最大 50 件一括取得）
     - PATCH /es/2.0/items/manage-numbers/{mn}       （socialGiftFlag 更新、1件ずつ）
```

- フロントエンドは GitHub Pages 上の静的 HTML/JS のみ。バックエンドは持たない。
- 楽天 API は CORS を許可していないため、**GAS Web App をプロキシ**として全リクエストを中継する。
- ユーザー認証用のライセンス情報（ID/PW、楽天 API キー、有効期限など）は Google スプレッドシートで管理し、GAS が照合する。
- ブラウザは `licenseKey` / `serviceSecret`（楽天 API 用クレデンシャル）をログインレスポンスで受け取り、メモリ上にのみ保持（ローカルストレージには保存しない）。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 本体。HTML/CSS/JS が 1 ファイルにまとまった SPA。State / 認証 / API 呼び出し / 描画すべて含む。 |
| `config.js` | `DEV_CONFIG` / `PROD_CONFIG` を分けて定義し、`location.hostname` で自動選択した結果を `APP_CONFIG` として公開。`MODE` ('dev' / 'prod') 含む。**実値で git にコミットされている**（後述）。 |
| `config.js.example` | 雛形。⚠️ コメントに「.gitignore に記載」と書いてあるが、現状の運用と食い違っているので注意（後述）。 |
| `CNAME` | GitHub Pages のカスタムドメイン設定（`socialgift.ginzasugiden.com`）。 |
| `.gitignore` | OS 系 + `gas/`（GAS ワークスペース、別管理）+ clasp credentials。`config.js` は **対象外**。 |
| `gas/` | clasp の作業ディレクトリ。`auth_endpoint.js`（Web App）と `コード.js`（旧スプレッドシート専用ユーティリティ）が入る。**`.gitignore` で除外**しているのでリポジトリには含まれない。変更は `cd gas && clasp push` で GAS プロジェクトに反映。 |

## GAS エンドポイント（doGet 1 本）

GAS 側は単一の Web App URL（`APP_CONFIG.GAS_AUTH_URL`）に対し、`action` クエリで処理を分岐する `doGet` 構成。すべて GET / クエリパラメータで完結する。

全リクエスト共通で `token=APP_CONFIG.ACCESS_TOKEN` を送信し、GAS 側で第一段の通行可否を判定する。

| アクション | クエリ | フロント側関数 | レスポンス（`data` 部のみ） |
|---|---|---|---|
| ログイン | `?token=&id=&pw=` （`action` なし） | `doLogin()` | `{licenseKey, serviceSecret, sname, expiry}` |
| 検索 | `?token=&action=search&ss=&lk=&field=title|mn&q=&hits=&offset=` | `apiSearch(field, q, hits, offset)` | `{numFound, manageNumbers:[...]}` ※ GAS 側で正規化済み |
| 一括取得 | `?token=&action=bulkget&ss=&lk=&mns=A,B,...` | `apiBulkGet(mns[])` | `{items:[{manageNumber, title, features}], errors}` ※ 最大 50 件 / 1 リクエスト |
| 商品取得（単発、廃止予定） | `?token=&action=get&ss=&lk=&mn=` | （未使用） | `{manageNumber, title, features, ...}` ※ 旧フロー用に残置 |
| フラグ更新 | `?token=&action=patch&ss=&lk=&mn=&sgf=true|false` | `apiPatch(mn, flag)` | `{status?, ...}` |

`ss` = serviceSecret、`lk` = licenseKey、`mn` = 商品管理番号、`mns` = カンマ区切り、`sgf` = socialGiftFlag、`field` = 検索対象（`title` 部分一致 / `manageNumber` 完全一致）。

GAS 側のレスポンスは `{ok, status, data, error?}` で統一。`ok` は楽天 API ステータス 200/204 を 1 つの真偽値に集約したもので、`status` は楽天 API の HTTP ステータスをそのまま返す。レート制限判定はフロント側で `status === 429 || 503` か、`error`/`data.errors[].message` に "rate"/"limit"/"上限"/"限度"/"回数" を含むかで行う（`isRateLimited()`）。

### 認証フロー

1. ブラウザ: `id` / `pw` を GAS に送信
2. GAS: スプレッドシートの行を検索し、PW と有効期限を照合
3. GAS: マッチした行から「楽天 API の `licenseKey` / `serviceSecret`」と「`sname`（店舗表示名）」「`expiry`（有効期限）」を返す
4. ブラウザ: `authState` に保持し、以降の `apiGet` / `apiPatch` 呼び出しで `ss` / `lk` を毎回クエリに付ける
5. 楽天 API への実際の認証ヘッダ（`Authorization: ESA base64(serviceSecret:licenseKey)`）の組み立ては **GAS 側で実施**

## 開発時の注意点

### 1. `config.js` は実値でコミットされている

`config.js.example` には「.gitignore に記載されています / 絶対にコミットしないでください」とあるが、**現在の運用ではこの注意書きは無効**。実際の `config.js` は実値（GAS デプロイ URL とアクセストークン）入りで `main` にコミットされている。理由:

- GitHub Pages の素の静的配信では、ビルド時に値を差し込む仕組みがない
- `GAS_AUTH_URL` も `ACCESS_TOKEN` も「公開クライアントが知っている前提」で運用される（真の認証は GAS 側のスプレッドシート照合で行う）
- `ACCESS_TOKEN` は流量制御・スクリプトキディ除けの第一段ゲートに過ぎず、漏れても直ちに楽天 API キーが漏れるわけではない（`licenseKey` / `serviceSecret` は ID/PW 突破後にしか返されない）

そのため `config.js` を編集する際は、**コミットしてプッシュする前提で実値を書く**こと。秘匿が必要になった場合は GAS 側のロジックで対応する（フロントの値を変えても効果は限定的）。

なお `config.js.example` のコメントは現状と矛盾しているため、迷ったらこの CLAUDE.md と実ファイル（`config.js` がリポジトリに存在し、`.gitignore` に入っていない事実）を優先すること。

### 2. すべて GET で通信する（CORS preflight 回避）

`index.html` のすべての fetch は **GET + クエリパラメータ**で構成されている。理由:

- GAS Web App はカスタムヘッダ付き / `Content-Type: application/json` の POST に対し CORS preflight (OPTIONS) を適切に返せず、ブラウザでブロックされやすい
- GET で送れば「単純リクエスト」扱いになり、preflight が不要

そのため:
- 値が長いケース（万一管理番号が大量＆カンマ区切りで投げられる場合など）でも、**POST に切り替えず**、フロント側でバッチ分割して逐次 GET する設計を維持すること
- どうしても POST が必要になったら、GAS 側の `doPost` ＋ 適切な CORS レスポンスヘッダ（`text/plain` で受ける、`e.postData.contents` を JSON.parse する等）の整備とセットで対応する
- `apiPatch` という名前だが実体は GET。命名は楽天 API 側のメソッド名に揃えただけ。

### 3. 楽天 ItemAPI 2.0 には全件取得エンドポイントが無い

「全件取得」エンドポイントは楽天側に存在しない。代わりに以下の組み合わせで運用する。

- **商品コードを既に把握している** → コードモードで管理番号をカンマ区切り入力 → `items.bulk-get` で 50 件ずつ一括取得
- **商品名で絞り込みたい** → 商品名モードで部分一致 → `items.search?title=...` で `manageNumber` のリストを取得 → 続けて `items.bulk-get` で本体取得
- 検索欄が空のまま検索した場合は、空一覧ではなくモード別の案内メッセージを出す（`handleSearch()` 参照）

`items.search` は `hits` 最大 100 / `offset` 最大 9999 の制約がある。本ツールではページサイズを 50 に固定（`PAGE_SIZE`）して `items.bulk-get` の上限と一致させ、商品名モードでは「もっと読み込む」ボタンで `offset += 50` していくページング設計にしている。

「シートに事前に商品リストを書き出してから操作する」運用（旧 `gas/コード.js` のような店舗別シート方式）はマルチアカウント運用の障害になるため採用しない。すべて API 直接利用で、ログインしたアカウントの楽天認証情報で取得できる範囲に自然にアクセスが閉じる設計。

### 3-bis. レート制限対策

楽天 ItemAPI 2.0 のレート制限値は非公開。現場ログ上、`PATCH` を連続で叩くと数件で 429/503 を返すことがある。以下の方針で対応。

- **GET 系**: `items.bulk-get` で 50 件 / 1 リクエストに集約。1000 件を超える店舗でも、ページ単位の取得は基本 1〜2 リクエストで済む。
- **PATCH 系**: bulk 版が存在しないため 1 件ずつ送るしかない。クライアント側で以下を実装（`applyChanges()`）:
  - リクエスト間に `PATCH_INTERVAL_MS = 1500ms` の固定インターバル
  - レート制限と判定したら `5s → 10s → 20s` の指数バックオフで最大 3 回リトライ（`PATCH_MAX_RETRY`）
  - 進捗を「`N/M`」でボタンに表示、待機中は `(待機 5s)` を併記
  - 実行中は「変更を適用」「元に戻す」を `disabled` に
  - 全件終了時に成功 / 失敗件数をトーストで通知
- **GAS 側の安全弁**: `RATE_LIMIT_MAX = 60`（1分あたり、`id+token` 単位）。これは楽天側ではなく GAS 側のフェイルセーフ（暴走スクリプトでの楽天 API 叩きすぎを止める用途）。クライアント側の `1500ms` 間隔ならぶつからない。
- 数値（間隔、リトライ回数、バックオフ起点）は `index.html` 冒頭の定数で管理しているので、本番ログを見て調整する場合はここを触る。

### 4. 単一 HTML / 素の JS / ビルドなし

- フレームワーク・バンドラ・トランスパイラはいっさい無し。`index.html` を直接編集する。
- 状態は `items` / `logs` / `authState` のグローバル変数で持つ。リファクタするなら全体構造ごと差し替える前提で。
- 動作確認は GitHub Pages にプッシュ → 本番ドメインで確認、もしくはローカルで `index.html` を開く。`config.js` の GAS URL は本番のものなので、ローカルでログインすれば本番のスプレッドシートに対して認証されることに注意。

### 5. UI まわりの細かい既知ポイント

- `actionBar` は変更件数 > 0 のときだけ `.visible` でスライドイン。`updateActionBar()` を呼ばないと表示が更新されないので、`items` を書き換えたら必ず呼ぶ（`renderList()` の末尾で必ず呼ばれる）。
- 検索モードはグローバルの `searchMode`（`'code'` または `'title'`）。`switchSearchMode()` で切替し、placeholder と `searchTab` の `.active` クラスを連動させる。
- `searchState`（`{mode, query, offset, numFound, hasMore}`）は **商品名モードのページング専用**。コードモードでは `numFound` は入力件数、`hasMore` は常に false。
- `loadMore()` は title モード時のみ有効。`btnLoadMore` を `disabled` 中はスピナーに差し替え、終了後に元に戻す。
- DEV モード（`APP_CONFIG.MODE === 'dev'`）では `applyChanges()` 冒頭に `confirm()`、ヘッダーに「DEV モード」バッジ、`document.title` に `[DEV]` プレフィックス、favicon 🚧 が入る。本番ドメイン以外では自動で dev 扱い。

### 6. dev / prod の判定（ホスト名ベース）

`config.js` 末尾の IIFE で `location.hostname === 'socialgift.ginzasugiden.com'` のときだけ `PROD_CONFIG` を採用、それ以外（`localhost` / `127.0.0.1` / `''`(file://) など）は `DEV_CONFIG` を採用。`APP_CONFIG.MODE` に `'prod'` / `'dev'` のどちらかが入る。

`DEV_CONFIG` は現状プレースホルダ（`<SET_DEV_DEPLOY_URL>` / `<SET_DEV_ACCESS_TOKEN>`）。dev 用 GAS / スプレッドシートを作成したら値を差し込む独立タスクが残っている。プレースホルダのままでもログインを試みるだけなら問題なく失敗する（=ローカルで本番を叩く事故は構造的に起きない）。
