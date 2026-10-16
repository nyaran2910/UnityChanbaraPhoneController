# 接続サーバー実装ルール

## 責務

- このリポジトリはスマホ画面の配信と、スマホとUnity間のWebSocketシグナリングを担当する。
- センサーデータ本体はWebRTCでスマホからUnityへ直接送る。明示的な依頼なしにサーバー中継へ変更しない。
- スマホの定期送信は物理コントローラと同じ10ms周期（100Hz目標）にする。ボタン操作時の即時送信は維持する。ブラウザのタイマー精度とセンサー更新頻度は端末に依存する。
- 自作ESP32コントローラのESP-NOW受信処理はハードウェアリポジトリの責務であり、このサーバーへ混在させない。

## 開発環境

- Node.js 22以上とTypeScriptを使用する。
- 変更後は内容に応じて `npm test` と `npm run build` を実行する。
- ローカル実行は `npm run dev`、ビルド済み実行は `npm start` を使う。
- `node_modules`、`dist`、`.env`、ローカル証明書などの生成物・秘密情報をコミットしない。
- 総合ルートの `just phone-start` が生成するUnity側接続設定は `../unity/Assets/StreamingAssets/controller-connection.json` である。パスや形式を変更するときはUnity側も同じ作業で整合させる。
- ローカル起動では、既存のtmuxサーバーにも接続設定の保存先・ポート・URL上書き・停止コマンドを明示的に渡す。起動済みでもUnity用設定を現在のサーバーのキーに同期する。

## 変更方針

- 共通ルートのMVP方針をスマホ画面にも適用し、依頼のない文言、状態表示、装飾、設定を追加しない。
- シグナリングメッセージやスマホ送信データの形式を変更するときは、Unity側の受信実装とテストを同じ作業で整合させる。
- 姿勢パケットのワールド座標系は初期設定の基準に固定する。保存済みの軸入れ替え・反転は端末のローカル軸にだけ適用し、メニューの上下左右まで回転させない。正面合わせ後の剣の相対姿勢と56-byteパケット形式は維持する。
- `devicemotion.rotationRate`のalpha/beta/gammaはX/Y/Z軸の角速度であり、`deviceorientation`のalpha/beta/gamma（Z/X/Y軸の姿勢角）とは順序が違う。角速度をbeta/gamma/alphaに並べ替えない。姿勢の画面補正がローカル側のRz(-screenAngle)なので、角速度・加速度には逆変換のRz(+screenAngle)を使う。物理座標から独立に作ったブラウザイベントで、画面の上向き・左向き・縦横表示を含む方向を検証する。
- 新しい確定ルール、接続方式、環境変数、運用手順が生じた場合は、このファイルまたはリポジトリ内の関連ドキュメントへその都度記録する。

- リセットのpointerdown〜解放はflags bit4=RecenterHeldを送る。0.5秒未満の通常解放だけrecenterSequenceを増やし、長押し・pointercancel・blur・画面離脱では増やさない。2026-10-09の指定により、Unityが全画面で短押しの正面合わせ、長押しの接続ポーズを処理する。操作ボタンは文字なしアイコンとaria-labelを維持する。
- Unity側からデータチャネルに届く `{"type":"vibrate","durationMs":50|100}` を受けたら、対応ブラウザで `navigator.vibrate` を呼ぶ。非対応のiOS等では安全に無視する。加速度イベントが100ms途切れたらflags bit3を落とし、最後の加速度を有効な入力として送り続けない。

- 2026-10-12の指定によりスマホ操作ページ全体は動的viewport内へ固定し、縦横のページスクロールとバウンスを抑える。小画面・横画面でも操作ボタンを表示し、センサー送信周期と入力パケットは変更しない。

- 起動・停止は総合ルートの `just phone-start` / `just phone-stop` に集約する。

## 2026-10-15のゲーム内登録・軸調整

- DataChannelでcontroller.hello（ブラウザの永続deviceIdと軸設定）を送ってcontroller.readyを受ける。端末IDはブラウザに保存し、Unityは選んだプレイヤーへの登録を確定したときだけ記憶する。
- axis.configureのorder（XYZ/XZY/YXZ/YZX/ZXY/ZYXの0..5）、signs（出力X/Y/Zの反転bit0..2）、requestを検証して仮適用する。axis.commitで保存し、axis.cancelや確定前の切断では元へ戻す。軸設定は端末内にP1/P2別で保存する。axis.stateでrequestとnextSequenceを返し、古い設定のパケットをUnityが除外できるようにする。
- 新しい画面導線はUnity側のEsc→コントローラ→P1/P2→QR→軸順序6通り→各軸の正転・反転→Esc。姿勢の56-byteパケット、100Hz目標、センサー許可は維持する。
- 2026-10-15の指定により、スマホページから手動の動き調整UIと操作ヒントを除く。Unityから届く軸設定、端末内の保存、登録応答は維持する。

- 総合ルートのjust phone-startはUNITY_RUNTIME_CONFIGで ~/.kosen-chanbara/controller-connection.json を指定し、Editor用設定とビルド版用設定を同時に同期する。tmux起動時にもこの変数を明示的に渡す。テストは一時ディレクトリの保存先を指定する。

## 2026-10-16のWindows親機・LAN自動探索

- 最新指定では親機1台でphoneとscoreを動かし、ゲームWindows4台は配布物を起動するだけとする。phoneはUDP42045で応答元IP・ポート・動的キーを取得し、接続失敗時に再探索する。旧controller-connection.jsonとURL/キー環境変数をUnityでは参照しない。この指定を以前の設定ファイル同期ルールより優先する。
- LANは信頼する端末の専用ネットワークとし、キーはLAN探索でのみ配布する。nonce・版・サーバーUUID・ポート・キー長を検証し、異なる親機が複数の場合は接続しない。スマホ→UnityのWebRTC直接経路とセンサー形式は変更しない。
- 総合ルートのWindows just serverはscripts/server.mjsからWi-Fi→有線ICSとファイアウォールを準備し、phoneとscoreを起動する。管理者権限はネット設定だけに使う。ルータのAP/ブリッジ化・DHCPオフと学校Wi-Fiのログインは手動。手順はdocs/EVENT_SERVER_SETUP.md。
- ゲーム用Windowsの通信許可は正確なexeパス・LocalSubnetのUDPとし、実機42042だけでなく探索応答とWebRTC動的ポートを通す。配布物の「ゲーム起動.cmd」を入口とする。
