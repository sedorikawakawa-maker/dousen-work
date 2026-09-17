// vitest実行時のみ`import "server-only"`を無害化するスタブ。
// Next.jsのビルド本体では本物のserver-onlyパッケージが使われ、クライアントバンドルへの
// 混入を防ぐ役目はそのまま維持される（vitestの実行時だけこの差し替えが有効）。
export {};
