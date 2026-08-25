const URL_PATTERN = /(https?:\/\/[^\s<>"'）】」』]+)/g;
const TRAILING_PUNCTUATION_PATTERN = /[.,;:、。！？!?]+$/;

/**
 * 自由記述テキスト中に含まれるURL（http/httpsのみ）だけを安全にリンク化して表示する。
 * URLはhttps?://で始まる箇所のみを対象とするため、javascript:等の危険なスキームは
 * そもそもマッチしない。末尾の句読点・全角括弧はURLに含めず地の文として残す。
 */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const segments = text.split(URL_PATTERN);

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        // split結果は [地の文, URL, 地の文, URL, ...] の順で交互に並ぶ（キャプチャ1個のため奇数indexがURL）。
        if (index % 2 === 0) {
          return segment ? <span key={index}>{segment}</span> : null;
        }
        const trailingMatch = segment.match(TRAILING_PUNCTUATION_PATTERN);
        const trailing = trailingMatch ? trailingMatch[0] : "";
        const url = trailing ? segment.slice(0, -trailing.length) : segment;
        return (
          <span key={index}>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="break-all text-[var(--accent-strong)] underline"
            >
              {url}
            </a>
            {trailing}
          </span>
        );
      })}
    </span>
  );
}
