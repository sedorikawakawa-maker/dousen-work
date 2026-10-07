// 正式な消費税額・税込請求額の計算ルールが確定するまで、「送付済みにする」操作を
// UIから実行できないようにするための切り替え（PDF生成・Drive保存・発行取消・再発行は対象外、
// 引き続き利用可能）。DB(mark_invoice_sent RPC)・Server Action(markInvoiceSentGuarded)側の
// ガードはPhase2D hardeningで別途維持しており、これはUI導線だけを塞ぐためのフラグ。
// 税額ロジック確定後にtrueへ変更する。
export const SENDING_ENABLED = false;
