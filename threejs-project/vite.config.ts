import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      // 条件付きリクエストを無条件化して 304 を根絶する。
      // サーバー再起動を挟むとブラウザが古いキャッシュ実体を 304 再検証で
      // 使い回し、白画面 (module script に text/html) の原因になるため
      name: 'dev-kill-304',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
          next();
        });
      },
    },
  ],
  server: {
    // true = 全インターフェース (IPv4/IPv6 両方) に listen。
    // '127.0.0.1' や 'localhost' の単一指定だと片スタックのみ bind になり、
    // ブラウザの localhost 解決 (::1 / 127.0.0.1) と食い違うと接続拒否になる
    host: true,
    // dev サーバー再起動を挟むとブラザが壊れたキャッシュ実体を 304 再検証で
    // 使い回すことがあるため、dev では条件付きリクエスト自体を無効化する
    headers: { 'Cache-Control': 'no-store' },
    // この環境 (Orca worktree) では fsevents ベースの watch が壊れて編集後も
    // 古い transform キャッシュを配信し続けることがあるため polling で監視する
    watch: { usePolling: true, interval: 300 },
  },
});
