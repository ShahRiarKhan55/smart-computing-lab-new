# サイトオーナー/運用者向けガイド

**対象者：** Smart Computing Labウェブサイトの技術的な運用担当者
**目的：** このコードベースを安全に運用・変更・デプロイするために必要な実務知識をまとめる
**前提条件：** Node.js、npm、git。Prisma、Express、Reactの基礎知識があることを前提とします。

本ガイドは、実際に存在するリポジトリの内容を説明するものです。実装の経緯や設計根拠については `docs/architecture/*.md` を参照してください — 本ガイドは実務上のリファレンス、`docs/architecture/` は設計の記録という位置づけです。

## リポジトリ構成

npm workspacesによるモノレポ構成です。

```
apps/server/    Express + Prisma によるAPI（TypeScript、ESM）
apps/web/       React + TypeScript + Vite によるフロントエンド（クライアントレンダリングのSPA）
packages/shared/  Zodスキーマ、権限ロジック、i18n辞書 — 両アプリから利用
api/            Vercelサーバーレス関数のエントリーポイント（apps/serverのExpressアプリをラップ）
docs/           本ガイド、その他のユーザーガイド、docs/architecture/（実装の経緯）
```

`apps/server` には独自の `node_modules` はありません — npm workspacesによってすべての依存関係がリポジトリのルートにまとめられています。

## フロントエンド

Vite + React + TypeScript、クライアントサイドレンダリングのみ（SSRなし）。ルーティングは `react-router-dom` の `BrowserRouter`（ルート定義は `apps/web/src/App.tsx`、ヘッダーのメニュー構成はデータ駆動の `components/navConfig.ts`）。大きい、またはあまり使われないルートは `React.lazy` で分割していますが、一部のページは意図的に分割せず即時読み込みにしています（`App.tsx` 冒頭のコメントを参照 — 分割したことで実際に再現されたブラウザテストのタイミングアサーション失敗があったため）。

## バックエンド

Express 4、`/api` 配下にマウント（`apps/server/src/app.ts`）、`/robots.txt` と `/sitemap.xml` はドキュメントルートに配置。ルートは `apps/server/src/routes/*.routes.ts` にリソースごとに分かれており、`routes/index.ts` でまとめてマウントされています。認可は**サーバー側でのみ**強制されます（`middleware/auth.ts` の `requireAuth`／`requireCan`／`requireOwnerOrManager`、その裏側にある `packages/shared/src/permissions.ts` の純粋な権限判定関数群）。フロントエンド側で同じ関数を使っている箇所は見た目の制御（ボタンの表示・非表示）のみで、セキュリティ境界ではありません。

## 共有パッケージ

`packages/shared` — Zodバリデーションスキーマ、権限ポリシー関数、英語／日本語のUI辞書（`i18n/en.ts` / `i18n/ja.ts`、フラットなキー→文字列のマップ。`TranslationKey` は英語のキーから導出されるため、日本語側が同じキー集合を定義していることをTypeScriptが型レベルで強制します）。このパッケージは**ソースを直接参照せず、ビルドされたものを使う**設計です：`main`／`exports` は `dist/` を指しており、これは自身の `build` スクリプト（`tsc`）で生成されます。このビルドは `postinstall` でも自動実行されるため、`npm install` を行うだけで常に最新の `dist/` が用意され、追加の手動ステップは不要です。

## データベース

**Prisma 5.22.0**、両環境ともSQLite系のデータソース（`provider = "sqlite"`）を使用します。

- **ローカル開発環境：** `apps/server/prisma/dev.db` という通常のローカルSQLiteファイル。`DATABASE_URL="file:./dev.db"` で指定。
- **本番環境（Vercel）：** Turso（ホスティングされたlibSQL）。`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` を使用し、`@prisma/adapter-libsql` + `@libsql/client`（Prismaの `driverAdapters` プレビュー機能）経由で接続します。`PrismaClient` を生成する箇所は `apps/server/src/lib/prisma.ts` の1箇所のみで、`TURSO_DATABASE_URL` が設定されているかどうかで自動的に接続方式を切り替えます。他のファイルがこの分岐を行うことはありません。

libSQLアダプターを使っていても、Prisma 5.x のネイティブ「library」クエリエンジンはプロセス内で引き続き動作し、すべてのクエリをコンパイルします（アダプターが置き換えるのは低レベルのDB I/Oのみです）。詳細は `api/index.ts` 内の詳しいコメントと、下記の `binaryTargets` に関する注記を参照してください。

## 環境変数

| 変数 | 使用環境 | 用途 |
|---|---|---|
| `DATABASE_URL` | ローカル／テスト | `file:./dev.db` または使い捨てのコピー |
| `TURSO_DATABASE_URL` | 本番 | `<production value>` |
| `TURSO_AUTH_TOKEN` | 本番 | `<secret>` |
| `SESSION_SECRET` | 全環境 | `<secret>` — 本番環境では実際の値がないとアプリは起動を拒否します |
| `TRUST_PROXY` | 全環境 | `0`（リバースプロキシなし）／`1`（信頼できるホップが1つ）— 下記「Trust Proxy」を参照 |
| `NODE_ENV` | 全環境 | `development` / `production` |
| `PUBLIC_BASE_URL` | 任意 | `/sitemap.xml` を有効化し、招待リンクを絶対URLにします。ローカル開発では省略可 |
| `BLOB_READ_WRITE_TOKEN` | 本番 | `<provisioned automatically when Vercel Blob storage is attached>` |

シークレットと記載された変数の実際の値は、絶対にコミットしないでください。完全な注釈付き一覧は `apps/server/.env.example` を参照してください。

## セッションの仕組み

`express-session` に、カスタムのPrismaベースのストア（`lib/prismaSessionStore.ts`、テーブル名 `Session`）を組み合わせています — これは2つ目のネイティブドライバーを避けるための選択です。Cookie名は `scl.sid`、`HttpOnly`、`SameSite=Lax`、本番環境では `Secure`（`TRUST_PROXY` の設定**に加えて**、リバースプロキシが実際に `X-Forwarded-Proto: https` を送信している必要があります — 下記「Trust Proxy」を参照）。セッションIDはログイン時とパスワード変更時に再生成されます（セッション固定攻撃対策）。

## 認証・認可

bcryptによるパスワードハッシュ化（コスト係数10）。存在しないメールアドレスに対しては固定のダミーハッシュと比較することで、「アカウントが存在しない」と「パスワードが間違っている」をタイミングから区別できないようにしています。インメモリ・プロセス単位のログインレート制限（`lib/loginRateLimit.ts`）が `/api/auth/login` と `/api/auth/password` を保護します。研究者オンボーディング（`routes/invitations.routes.ts`）では、1回限り有効・7日間で期限切れ・SHA-256でハッシュ化された招待トークンを発行します — 管理者が研究者のパスワードを見たり設定したりすることはありません。詳細は管理者ガイドを参照してください。

**既知の制限事項：** ログイン／招待のレート制限はプロセス単位のインメモリ実装です。Vercel上では関数インスタンスごとに独立したレート制限になるため、コールドスタートや複数インスタンスにまたがるとガードの効果が弱まります。ただし、その場合でも実際のリクエストには正しいパスワード／トークンが依然として必要です。

## ストレージ

デュアルバックエンド構成（`lib/storage.ts`）：開発環境ではローカルファイルシステム、本番環境ではVercel Blob（プライベートアクセス）を使用し、`BLOB_READ_WRITE_TOKEN` が設定されているかどうかで自動的に切り替わります。ファイルはサーバーが生成した不透明な `storageKey` で参照され、ユーザーが指定したファイル名やパスがそのまま使われることはありません。`npm run storage:reconcile -w apps/server` で、孤立したBlob／レコードを検出・報告できます。

## ビルド・テスト・シード・マイグレーション

```
npm run build                        # shared -> server -> web の順にビルド
npm run dev                          # server（tsx watch）と web（vite）を並行起動
npm run migrate -w apps/server       # prisma migrate dev（ローカル用）
npm run seed -w apps/server          # べき等：管理者アカウントとサンプルコンテンツを、未作成の場合のみ作成
npm run test:unit -w apps/server     # サーバー・DBを起動しない純粋な単体テスト
npm run test:invitations -w apps/server   # 使い捨てのDBコピーに対して実サーバーを起動してテスト
```

`apps/server/package.json` の `test:*` スクリプトの多くは同じパターンに従います：`dev.db` を使い捨ての一時ファイルにコピーし、そのコピーに対して実サーバーを起動し、実際のHTTP経由で操作し、終了後にコピーを破棄します。**同じターミナルで本番のTursoに対する作業も行っている場合は、これらをローカルで実行する前に、必ずご自身のシェルで `TURSO_DATABASE_URL`／`TURSO_AUTH_TOKEN` を明示的にクリアしてください。** これらのスクリプトの一部は、起動するサーバーの環境変数に `...process.env` を展開する際、この2つの変数を先にクリアしていないため、Tursoの認証情報が環境に残っていると、「ローカル」のはずのテストサーバーが実際の本番データベースに読み取り接続されてしまいます（書き込みは失敗したトランザクション内でロールバックされますが、スクリプトの意図とは異なる動作になるため、明示的にクリアしておくのが安全です）。

## デプロイ（Vercel + Turso）

`vercel.json`：`buildCommand` は `packages/shared` → `apps/web` の順にビルドします。`functions["api/index.ts"]` ブロックが、Prismaのネイティブクエリエンジンのバイナリを関数に同梱します（`includeFiles`）。rewritesにより `/api/*` は関数へ、それ以外はビルド済みのSPAへ転送されます。`api/index.ts` は `PRISMA_QUERY_ENGINE_LIBRARY` を明示的に設定しています（VercelのFunctionランタイムはビルドコンテナ（Debianベース）とは異なりAmazon Linuxであるため、`prisma/schema.prisma` の `generator client` ブロックには `binaryTargets = ["native", "rhel-openssl-3.0.x"]` が指定されています。`native` はローカル／CI用、`rhel-openssl-3.0.x` はデプロイされた関数用です。詳しい経緯は両ファイルのコメントを参照してください）。

**マイグレーションが本番環境に自動適用されることはありません。** PrismaのマイグレーションコマンドはTursoのHTTPベースの接続をサポートしていないため、本番環境のマイグレーションは監査済みの一回限りのスクリプトを使って、実データベースに対して手動かつ意図的に適用します — 通常のデプロイの一部として自動実行されることは決してありません。

## ロールバックに関する考慮事項

Vercelは過去のデプロイを保持しており、以前のデプロイに戻すのがアプリケーションコードの最も迅速なロールバック方法です。**本プロジェクトの慣例として、データベースのマイグレーションは追加のみ**です（カラムやテーブルを削除したことはこれまで一度もありません）。そのため、新しい追加型マイグレーションが適用された状態のままアプリケーションコードだけを古いバージョンに戻しても安全です（古いコードは単に新しいテーブル・カラムを使わないだけです）。マイグレーション自体を取り消すための自動化ツールはなく、必要な場合は、順方向のマイグレーションと同じ慎重かつ監査付きのプロセスで、レビュー済みの逆方向マイグレーションを手動で作成して適用します。

## ログ

サーバーエラーは中央のエラーハンドラー（`app.ts`）で `console.error` によって記録されます。それ以外に外部のログ集約サービスへの接続は現時点ではありません — 標準出力／標準エラー出力は、プロセスを実行しているホスト（本番環境ではVercelの関数ログ）に出力されます。

## セキュリティ設定

Helmetベースのセキュリティヘッダー（`lib/security.ts`）、このシングルオリジンアプリに適したCSP、`TRUST_PROXY` による明示的なクライアントIP信頼設定（`lib/trustProxy.ts` — 無条件の `trust proxy: 1` ではなく、環境変数による明示的な設定とドキュメント化がされています）、そしてサポートされている唯一のトポロジー：静的SPAビルドとAPIの両方の前段に1つのリバースプロキシを配置し、`/robots.txt`、`/sitemap.xml`、`/api/*` をサーバーへ、それ以外をSPAビルドへ振り分ける構成です。

## レート制限

ログインとパスワード変更は（IP、メールアドレス）単位、招待の情報取得・承諾はIP単位で、いずれもインメモリ・プロセス単位です — 複数インスタンスに関する既知の制限事項は「認証・認可」を参照してください。

## バックアップ・復旧

Tursoはホスティングプラットフォーム側でポイントインタイムリカバリを提供しています（保持期間はご利用のプランによりますので、Tursoのダッシュボード／ドキュメントをご確認ください）。本リポジトリ自体には独自のバックアップ機構はありません。ローカル開発の `dev.db` は使い捨てでgit管理対象外のファイルであり、バックアップは想定していません — シードスクリプト（`npm run seed`）でいつでも基本的なコンテンツを再生成できます。

## 依存関係の更新

通常の `npm outdated` / `npm update` の流れで行います。ルートの `package.json` の `allowScripts` 項目（`@prisma/client`、`@prisma/engines`、`esbuild`、`prisma`）は、インストールスクリプトを持つパッケージを明示的に許可するリストです。追加する前によく確認してください。

## ブラウザテスト

`apps/server/scripts/browser-regression.cjs` は、生のCDP（Chrome DevTools Protocol）経由で実際のヘッドレスブラウザを操作します — PlaywrightやPuppeteerへの依存はなく、ブラウザの実行ファイルを直接起動します。`BROWSER_PATH` で実行ファイルを指定します（デフォルトはWindowsのEdgeのパスですが、このコンテナやほとんどのLinux CIでは、あらかじめインストールされたChromiumを指すように設定されています）。`ONLY_*` 環境変数で特定フェーズのセクションのみを実行できます。

## フェーズ27の連携機能（すべて任意）

詳細：`docs/architecture/phase27-lab-website-integrations.md`。

- **デプロイ順序：** フェーズ27のマイグレーション（`20261008090552_phase27_integrations`、追加のみ）は、新しいコードがトラフィックを処理する **前** にTursoへ適用する必要があります。適用しないと `/api/team` と `/api/profile` が「no such column」で失敗します。Previewデプロイは本番データベースを共有するため、このブランチのPreviewも影響を受けます。明示的な承認なしに本番へ `migrate`/`seed` を実行しないでください。
- **環境変数（プレースホルダーは `apps/server/.env.example`）：** `PORTAL_URL`（Google SitesのURL、httpsのみ）、`FACEBOOK_PAGE_URL`（公式FacebookページのURL、httpsのみ、任意）、`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`GOOGLE_OAUTH_REDIRECT_URI`（3つすべて、または未設定）、`ORCID_CLIENT_ID`・`ORCID_CLIENT_SECRET`（任意・推奨）、`PUBLICATION_SYNC_CONTACT_EMAIL`・`PUBLICATION_SYNC_DELAY_MS`・`PUBLICATION_SYNC_BUDGET_MS`、`MAX_PROFILE_PHOTO_BYTES`。
- **Google OAuthの設定：** Google Cloud Consoleで「ウェブアプリケーション」のOAuthクライアントを作成し、環境ごとに `/api/auth/google/callback` で終わるリダイレクトURI（本番はhttps）を登録します。Googleで管理者セッションを取得できるのは、確認済みのアカウント `susmartcomputinglab@gmail.com` のみで、メールアドレスだけで自動的にリンクされることはありません。
- **アップロードの問題：** 管理者として `/api/files/storage-status?probe=1` を開きます。`STORAGE_NOT_CONFIGURED` はプロジェクトにBlobストア／トークンが接続されていないこと、`STORAGE_UNAVAILABLE` はバックエンドが書き込みを拒否したこと（Blobストアとアクセスモードを確認）を意味します。Vercelではアップロードは4 MBまでです。
- **埋め込み不可：** Cookieが `SameSite=Lax` のため、このアプリはGoogle Sitesの埋め込みでは動作しません。サイトからリンクしてください。
- **Facebook：** 研究室の公式ページ（facebook.com / www.facebook.com / m.facebook.com 上のhttps URL、例：`https://www.facebook.com/<ページ名>`）を `FACEBOOK_PAGE_URL` に設定すると、ホームページに「Facebook で最新情報をチェック」のリンクが表示されます。未設定の場合（および値が受け付けられない場合）は「Facebook の更新はまだ連携されていません」と表示され、後者ではサーバーが起動時に警告を1行出力します。コピーしたリンクの追跡パラメータ（`mibextid`・`ref`・`fbclid`）は自動的に取り除かれ、それ以外のクエリ文字列は受け付けられません。対応しているのはリンクのみで、最近の投稿の取得・表示は行いません（Facebookのトークンやアプリも使用しません）。投稿の表示には、公式ページと承認されたMeta連携が必要です。詳細はアーキテクチャ文書を参照してください。

## 既知の制限事項

- ログアウト状態のユーザー向けの自己解決型「パスワードをお忘れですか」機能はありません（メール送信が必要になるため、意図的に導入していません — 管理者ガイドの回避策（新しい招待の発行）を参照）。
- ログイン／招待のレート制限は、複数のVercel関数インスタンス間で共有されない、プロセス単位の実装です。
- Tursoが提供するもの以外に、自動化されたバックアップ機構はありません。
- デフォルトでは外部のログ集約サービスには接続されていません。

## 運用チェックリスト（本番環境への変更前）

1. `npm run build`、`npm run test:unit -w apps/server`、および関連する `test:*` のリグレッションスクリプトを実行する。
2. マイグレーションを伴う場合：追加のみであることを確認し、まずローカルで適用・検証したうえで、本番環境へはドキュメント化された手動プロセスでのみ適用する — 自動適用は行わない。
3. シークレット・トークン・認証情報が漏れる可能性がないか、差分をレビューする。
4. まずPreview環境にデプロイし、`/api/health` と実際のログインをスモークテストしてから本番環境に昇格させる。

**関連ドキュメント：** 管理者ガイド・実装の経緯は `docs/architecture/*.md` を参照
