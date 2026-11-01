# Kosen Chanbara Phone Controller

スマホ用ページと、UnityとのWebRTC接続を確立するシグナリングサーバーです。センサーデータはサーバーを通らず、スマホから各UnityへLAN内で直接送られます。複数のゲームPCには独立したセッションとP1/P2のQRを割り当てます。

UnityはUDP42045でサーバーの現在のIP・HTTPポート・ホストキーを自動取得し、LAN内のWebSocketへ接続します。IP固定やキーの配布は不要です。探索にはnonce、版、サーバーIDを使い、接続先には応答元IPを使います。複数親機が見つかった場合は接続しません。LAN上の端末を信頼する方式で、キーはHTTPS経由では公開しません。

Windows親機は総合リポジトリのルートで `just server-start` を使います。Git・Node.js 24以上・justが必要です。Wi-Fi→有線のWindows ICS、通信許可、依存の導入・ビルド、HTTPSトンネルとphone、scoreをまとめて起動します。詳細は総合リポジトリの `docs/EVENT_SERVER_SETUP.md` を参照してください。

Windowsでphoneだけ起動する場合は `just phone-start`、停止はそのウィンドウでCtrl+Cです。ネットワーク共有・通信許可は単独起動では設定しません。Mac/Linux開発時の `just phone-start` / `just phone-stop` は従来どおりtmuxを使います。旧起動処理が生成するUnity用接続ファイルは、新しいUnityでは参照しません。

一時HTTPS URLは起動中もインターネット接続を必要とします。スマホも親機のインターネット共有などでそのURLへ到達できる必要があります。親機の再起動後は最新のQRでスマホを開き直してください。

定期送信は物理コントローラと同じ10ms周期（100Hz目標）です。ボタン操作時には即時送信します。実際のタイマー精度とセンサー更新頻度はスマホに依存します。

設定: `PORT`（HTTP、既定8080）、`PHONE_DISCOVERY_PORT`（UDP、既定42045）、`PHONE_LAN_ADDRESS`（探索を許可する有線IPv4サブネット）、`HOST_KEY`、`PUBLIC_BASE_URL`。総合起動ではこれらを起動処理が設定します。Unity側の探索ポートを変える場合は `KOSEN_PHONE_DISCOVERY_PORT` も合わせます。

検証はこのディレクトリで `npm test` と `npm run build` を実行します。

リモコンは上から①リセット・ポーズ、②決定・ガード、③センサー開始です。数字は選択できないSVGパスで表示します。スマホは3ボタンだけを表示し、操作説明はUnity側に表示します。縦横ともボタンの上下順を維持します。

ゲーム内のEsc→コントローラ→P1/P2には「① Wi-Fi接続」「② ゲーム接続」のQRを表示します。親機のルート `.env` の `WIFI_SSID1` / `WIFI_PASS1`（既存実機用のAP設定、番号なしも可）を使い、`just server-start` を再起動すると各ゲームPCへ自動配信します。上流の学校Wi-Fiではなく、スマホ・子機が接続するAPの情報を設定してください。未設定時はWi-Fi QRを表示せず未設定と案内します。Wi-Fi接続済みのスマホは②だけ読み取ります。
