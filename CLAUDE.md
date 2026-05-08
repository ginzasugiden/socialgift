# ソーシャルギフト設定侍 — CLAUDE.md

## プロジェクト概要

楽天 RMS の **ItemAPI 2.0** を使って、商品ごとの `features.socialGiftFlag`（ソーシャルギフト対応の ON/OFF）を一括で確認・編集するための、店舗運営者向けのシンプルな Web ツール。

- 対象ユーザー: 楽天市場店舗の運営者（社内ツールとしてライセンス制で配布）
- 公開URL: `CNAME` ファイルに記載のカスタムドメイン（GitHub Pages にバインド）
- ホスティング: GitHub Pages（静的配信）

UI 上の主要操作:
1. ID / PW でログイン（GAS 経由でスプレッドシート認証）
2. 商品管理番号（カンマ区切り可）で検索 → 現在の `socialGiftFlag` をトグル表示
3. トグルを切り替えて「変更を適用」で PATCH 一括反映

## アーキテクチャ

```
Browser (GitHub Pages)
   │   ※ すべて GET（CORS preflight 回避のため）
   ▼
GAS Web App (doGet) ─── Google スプレッドシート（ライセンス管理）
   │
   ▼
楽天 RMS ItemAPI 2.0
   https://api.rms.rakuten.co.jp/es/2.0/items/manage-numbers/{mn}
```

- フロントエンドは GitHub Pages 上の静的 HTML/JS のみ。バックエンドは持たない。
- 楽天 API は CORS を許可していないため、**GAS Web App をプロキシ**として全リクエストを中継する。
- ユーザー認証用のライセンス情報（ID/PW、楽天 API キー、有効期限など）は Google スプレッドシートで管理し、GAS が照合する。
- ブラウザは `licenseKey` / `serviceSecret`（楽天 API 用クレデンシャル）をログインレスポンスで受け取り、メモリ上にのみ保持（ローカルストレージには保存しない）。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 本体。HTML/CSS/JS が 1 ファイルにまとまった SPA。State / 認証 / API 呼び出し / 描画すべて含む。 |
| `config.js` | `APP_CONFIG.GAS_AUTH_URL` と `APP_CONFIG.ACCESS_TOKEN` を定義。`index.html` から `<script src="config.js">` で読み込む。**実値で git にコミットされている**（後述）。 |
| `config.js.example` | 雛形。⚠️ コメントに「.gitignore に記載」と書いてあるが、現状の運用と食い違っているので注意（後述）。 |
| `CNAME` | GitHub Pages のカスタムドメイン設定。 |
| `.gitignore` | OS 系のみ。`config.js` は **対象外**。 |

> このリポジトリには GAS 側のソースコードは含まれていない。GAS プロジェクトは別管理。

## GAS エンドポイント（doGet 1 本）

GAS 側は単一の Web App URL（`APP_CONFIG.GAS_AUTH_URL`）に対し、`action` クエリで処理を分岐する `doGet` 構成。すべて GET / クエリパラメータで完結する。

全リクエスト共通で `token=APP_CONFIG.ACCESS_TOKEN` を送信し、GAS 側で第一段の通行可否を判定する。

| アクション | クエリ | フロント側関数 | レスポンス |
|---|---|---|---|
| ログイン | `?token=&id=&pw=` （`action` なし） | `doLogin()` | `{ok, licenseKey, serviceSecret, sname, expiry}` または `{ok:false, error}` |
| 商品取得 | `?token=&action=get&ss=&lk=&mn=` | `apiGet(mn)` | `{ok, data:{manageNumber, title, features:{socialGiftFlag}, ...}}` |
| フラグ更新 | `?token=&action=patch&ss=&lk=&mn=&sgf=true|false` | `apiPatch(mn, flag)` | `{ok, status?, data?, error?}` |

`ss` = serviceSecret、`lk` = licenseKey、`mn` = 商品管理番号、`sgf` = socialGiftFlag。

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

検索欄を空欄にして検索すると、空一覧ではなく案内メッセージが出る（`handleSearch()` 参照）。全商品操作したい場合は GAS 側のシートから管理番号を吐き出してカンマ区切りで貼り付ける運用。一覧取得 API を追加する選択肢を勝手に提案しない（楽天側に存在しない）。

### 4. 単一 HTML / 素の JS / ビルドなし

- フレームワーク・バンドラ・トランスパイラはいっさい無し。`index.html` を直接編集する。
- 状態は `items` / `logs` / `authState` のグローバル変数で持つ。リファクタするなら全体構造ごと差し替える前提で。
- 動作確認は GitHub Pages にプッシュ → 本番ドメインで確認、もしくはローカルで `index.html` を開く。`config.js` の GAS URL は本番のものなので、ローカルでログインすれば本番のスプレッドシートに対して認証されることに注意。

### 5. UI まわりの細かい既知ポイント

- `searchInput` 要素には `id` 属性が二重に書かれている（HTML としては有効だが冗長）。触る場合は片方に揃える。
- `getAuth()` はコメントアウト済み。楽天 API への直接認証ヘッダ生成はフロントでは行わない（GAS 側に集約）。残骸として削除して問題ない。
- `actionBar` は変更件数 > 0 のときだけ `.visible` でスライドイン。`updateActionBar()` を呼ばないと表示が更新されないので、`items` を書き換えたら必ず呼ぶ。
