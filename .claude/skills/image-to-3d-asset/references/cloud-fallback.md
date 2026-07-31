# クラウドで3D生成する（ローカル環境が無い場合）

Hugging Face Space の gradio API を直接叩くのが、無料で自動化できる唯一の実用経路。ブラウザ操作なしで完結する。

**先に期待値を合わせておく**: この経路で取れるのは基本**形状のみ（白メッシュ）**。テクスチャ生成エンドポイントは無料GPU枠では拒否される（認証を付けても同じ）。テクスチャが要るならローカル SPAR3D か有料サービスを使う。

## Hunyuan3D-2.0（動作確認済みの本命）

Space: `tencent-hunyuan3d-2.hf.space`（gradio 4系）

### 手順

```bash
SP="https://tencent-hunyuan3d-2.hf.space"
TOK="Authorization: Bearer $(cat /tmp/hf_token)"   # 無くても動くが枠が小さい

# 1) アップロード
UP=$(curl -s --max-time 90 -H "$TOK" -X POST "$SP/upload" -F "files=@ref.png")
P=$(echo "$UP" | python3 -c "import json,sys; print(json.load(sys.stdin)[0])")

# 2) ジョブ投入（形状のみ = shape_generation）
EV=$(curl -s --max-time 30 -H "$TOK" -X POST "$SP/call/shape_generation" \
  -H "Content-Type: application/json" \
  -d "{\"data\": [null, {\"path\": \"$P\", \"orig_name\": \"ref.png\", \"meta\": {\"_type\": \"gradio.FileData\"}}, null, null, null, null, 30, 5.0, 1234, 256, true, 8000, false]}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('event_id',''))")

# 3) 完了待ち（SSE。一度きりの消費なので保存する）
curl -s -N --max-time 600 -H "$TOK" "$SP/call/shape_generation/$EV" > result.sse

# 4) glb 取得
GLB=$(grep -o '"path": "[^"]*white_mesh.glb"' result.sse | head -1 | sed 's/"path": "//; s/"$//')
curl -s -L --max-time 180 -H "$TOK" "$SP/file=$GLB" -o out.glb
```

data 配列の並び（Space の `/config` の `dependencies` から確認できる）:

```
[state, image, front, back, left, right, steps, guidance, seed, octree_res, remove_bg, num_chunks, randomize_seed]
```

### 注意点

- **SSE は一度しか読めない**。取りこぼすと event_id ごと無効になるのでファイルに保存してから解析する
- **認証トークンで枠が広がる**。匿名は連続7回程度で枯渇して `event: error` になる。Bearer を付けると復活する
- **`generation_all`（テクスチャ付き）は認証しても拒否される**。無料GPU枠の制限
- 出力は約18MBの高密度メッシュ。`gltfpack -si 0.2` 前提で扱う
- 連続実行は10〜15秒の間隔を空ける

## Hunyuan3D-2.1 / TRELLIS 系（うまくいかなかった経路）

記録として残す。同じ轍を踏まないため。

- **Hunyuan3D-2.1 Space**: 同じ REST 呼び出しで通るが、生成結果が**薄い板状レリーフに縮退**した（2回再現）。UI 内部 state を null で渡すため簡易モードに落ちる疑い。2.0 を使う
- **TRELLIS 系 Space**: セッション状態が必須で `/call` 系が全滅する（`404 Not Found` / `Session not found`）。gradio の queue プロトコル（`GET /gradio_api/queue/data?session_hash=X` の SSE を常駐させてから `POST /gradio_api/queue/join`）で疎通はするが、最終的に GPU 実行段で失敗し続けた。ブラウザ自動化でも同じ壁

## Meshy / Tripo

品質は高いが、**無料枠ではエクスポートできない**（生成プレビューまで）。自動化するなら有料プラン前提。API を使う場合は各社のドキュメントを参照。

## 生成器を乗り換えるときの注意

同じ参照画像でも生成器が変わると**スケール基準・原点・向きが変わる**。アプリ側は「取り込んだメッシュの bbox を目標サイズへ正規化してからアンカーに載せる」実装にしておくと、生成器を差し替えても配置設定を作り直さずに済む（`integration.md` 参照）。
