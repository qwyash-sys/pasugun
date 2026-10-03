import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AppBar, { AiTag } from "../components/AppBar";
import BottomSheet from "../components/BottomSheet";
import AnalyzingSteps from "../components/AnalyzingSteps";
import ImageLightbox, { type LightboxImage } from "../components/ImageLightbox";
import StreamingText from "../components/StreamingText";
import { captureDataUrl } from "../utils/capturePreview";
import { fileToBase64 } from "../utils/file";
import type { AttachmentMeta } from "../types";

interface ChatTurnResult {
  reply: string;
  turn: number;
  maxTurns: number;
  fallback?: boolean;
}

interface DemoTurn {
  user: string;
  ai: string;
  /** 이 턴에 함께 올리는 자료(안내문자 캡처 등)의 파일명 — 미리보기 이미지는 리포트 첨부에서 찾는다. */
  attachments?: string[];
}

interface Props {
  customerName: string;
  isDemo: boolean;
  loading: boolean;
  error: string | null;
  /** demo 모드 전용: AI 첫 인사말에 덧붙는 안내, 한 턴씩 재생할 대본, 대본 첨부의 미리보기 원본. */
  hint?: string;
  chatTurns?: DemoTurn[];
  demoAttachments?: AttachmentMeta[];
  /** local/remote 모드 전용: 실제 멀티턴 대화. */
  onSendTurn?: (payload: { text: string; attachments: { name: string; base64: string }[] }) => Promise<ChatTurnResult>;
  /** 대화를 건너뛰거나(0턴) 충분히 나눈 뒤(1턴 이상) 결과 화면으로 넘어간다. */
  onFinish: () => void;
  /** AI 분석을 건너뛰고 송금으로 바로 간다(막지 않는다는 원칙). 판정은 지금까지 쌓인 내용으로 확정된다. */
  onSkipAnalysis: () => void;
  onHome: () => void;
}

/** 입력창에 올려둔(또는 보낸) 사진. url은 미리보기용, base64는 실제 모드 전송용. */
interface StagedImage {
  name: string;
  url: string;
  base64?: string;
}

interface ChatMessage {
  role: "user" | "ai";
  text: string;
  images?: StagedImage[];
  /** AI 연결 장애로 규칙 기반 안내가 대신 나갔을 때 말풍선 아래 작게 알린다. */
  fallback?: boolean;
}

// 백엔드 상한(base64 약 14MB ≈ 원본 10MB)보다 여유 있게 잡는다.
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
// 백엔드 ChatTurnRequest.attachments의 max_length와 맞춘다.
const MAX_ATTACHMENTS = 5;
// 입력창은 글이 길어지면 최대 6줄까지 늘어나고, 그 이상은 입력창 안에서 스크롤한다.
const MAX_INPUT_LINES = 6;
const DEMO_REPLY_DELAY_MS = 900;
// 백엔드 ChatTurnRequest.text의 max_length와 같다. 넘기면 서버가 거절하므로 입력 단계에서 자른다.
const MAX_INPUT_CHARS = 2000;

/** M5 대화 화면. 데모와 실제 모드가 같은 채팅 화면(입력창·사진 첨부·전송)을 쓰고, 답장을
 * 만드는 방식만 다르다 — 데모는 대본, 실제 모드는 백엔드 AI. 데모에서는 대본의 다음 문장을
 * "추천 문장"으로 입력창 위에 띄워, 누르면 입력창에 채워지고 직접 ↑로 보내게 한다(버튼 한 번에
 * 대화가 저절로 넘어가면 사용자가 직접 채팅하는 화면이라는 게 드러나지 않는다). */
export default function M5Chat(props: Props) {
  const { isDemo, chatTurns, hint, customerName, demoAttachments, onSendTurn } = props;
  const turns = useMemo(() => chatTurns ?? [], [chatTurns]);

  // 데모 대본 첨부 파일명 → 미리보기 이미지(리포트에 같은 이름의 첨부가 있으면 그것, 없으면 기본 캡처).
  const demoImage = useMemo(() => {
    const byName = new Map((demoAttachments ?? []).map((a) => [a.name, a.url]));
    return (name: string): StagedImage => ({ name, url: byName.get(name) ?? captureDataUrl([name]) });
  }, [demoAttachments]);

  const sendTurn = async (payload: { text: string; images: StagedImage[]; turnIndex: number }): Promise<ChatTurnResult> => {
    if (isDemo) {
      await new Promise((r) => setTimeout(r, DEMO_REPLY_DELAY_MS));
      const scripted = turns[payload.turnIndex];
      return { reply: scripted?.ai ?? "", turn: payload.turnIndex + 1, maxTurns: turns.length };
    }
    if (!onSendTurn) throw new Error("대화를 보낼 수 없어요");
    return onSendTurn({
      text: payload.text,
      attachments: payload.images.map((i) => ({ name: i.name, base64: i.base64 ?? "" })),
    });
  };

  const greeting = isDemo
    ? `현재 송금이 안전한지 AI가 분석해드릴 수도 있어요. ${hint || "상황을 편하게 말씀해주세요."}`
    : `${customerName}님, 편하게 상황을 말씀해주세요. 몇 가지만 확인하고 바로 알려드릴게요.`;

  return (
    <>
      <ChatView
        {...props}
        greeting={greeting}
        sendTurn={sendTurn}
        initialMaxTurns={isDemo ? turns.length : 3}
        suggestionFor={isDemo ? (i) => (turns[i] ? { text: turns[i].user, images: (turns[i].attachments ?? []).map(demoImage) } : null) : undefined}
        noChat={isDemo && turns.length === 0}
        allowSkipLink={!isDemo}
      />
      {/* 결과 확정 중에는 대화 화면을 내리지 말고 위에 덮기만 한다 — 언마운트하면 확정이 실패했을 때
          대화 내용·턴 수가 전부 초기화된 빈 채팅으로 되돌아온다. */}
      {props.loading && (
        <div className="loading-overlay">
          <AnalyzingSteps />
        </div>
      )}
    </>
  );
}

interface ChatViewProps extends Props {
  greeting: string;
  sendTurn: (payload: { text: string; images: StagedImage[]; turnIndex: number }) => Promise<ChatTurnResult>;
  initialMaxTurns: number;
  /** 데모: n번째 턴의 추천 문장(대본). 실제 모드는 없음. */
  suggestionFor?: (turnIndex: number) => { text: string; images: StagedImage[] } | null;
  noChat: boolean;
  allowSkipLink: boolean;
}

function ChatView({
  greeting,
  sendTurn,
  initialMaxTurns,
  suggestionFor,
  noChat,
  allowSkipLink,
  onFinish,
  onSkipAnalysis,
  onHome,
  error,
}: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "ai", text: greeting }]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<StagedImage[]>([]);
  const [sending, setSending] = useState(false);
  // 답장은 도착 즉시 통째로 넣지 않고 여기 잠깐 담아뒀다가 화면에서 한 글자씩 흘려보낸다.
  const [pendingReply, setPendingReply] = useState<{ text: string; turn: number; maxTurns: number; fallback?: boolean } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  const [maxTurns, setMaxTurns] = useState(initialMaxTurns);
  const [viewer, setViewer] = useState<{ items: LightboxImage[]; index: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  const reachedCap = !noChat && turn >= maxTurns;
  const busy = sending || !!pendingReply;
  const suggestion = !busy && !reachedCap && !input.trim() && images.length === 0 ? suggestionFor?.(turn) ?? null : null;

  useAutoScroll(threadRef, footerRef);
  useAutoGrow(textareaRef, input);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const fileInput = e.target;
    const picked = Array.from(fileInput.files ?? []);
    // 같은 파일을 다시 골라도 change가 발생하도록 비워둔다(안 비우면 같은 파일 재선택이 무반응).
    fileInput.value = "";
    if (picked.length === 0) return;

    const room = MAX_ATTACHMENTS - images.length;
    const within = picked.slice(0, room);
    const sized = within.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    // 실제로 열리는 이미지인지 브라우저에서 먼저 확인한다 — 아니면 깨진 썸네일이 올라갔다가
    // 보낸 뒤에야 서버에서 거절되는 대신, 고르는 순간 바로 알려준다(서버 검사는 그대로 유지).
    const decodable = await Promise.all(sized.map((f) => isReadableImage(f)));
    const valid = sized.filter((_, i) => decodable[i]);
    const broken = sized.filter((_, i) => !decodable[i]);
    if (picked.length > room) setSendError(`이미지는 최대 ${MAX_ATTACHMENTS}장까지 첨부할 수 있어요.`);
    else if (within.length > sized.length) setSendError("이미지가 너무 커요. 7MB 이하로 올려주세요.");
    else if (broken.length) setSendError(`'${broken[0].name}'은(는) 읽을 수 있는 이미지가 아니에요. 다른 이미지로 다시 시도해주세요.`);
    else setSendError(null);
    if (valid.length === 0) return;

    const encoded = await Promise.all(
      valid.map(async (f) => {
        const base64 = await fileToBase64(f);
        return { name: f.name, base64, url: `data:${f.type || "image/png"};base64,${base64}` };
      }),
    );
    setImages((prev) => [...prev, ...encoded]);
  }

  function applySuggestion() {
    if (!suggestion) return;
    setInput(suggestion.text);
    setImages(suggestion.images);
    textareaRef.current?.focus();
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && images.length === 0) || busy || reachedCap) return;

    const staged = images;
    setMessages((prev) => [...prev, { role: "user", text, images: staged.length ? staged : undefined }]);
    setInput("");
    setImages([]);
    setSending(true);
    setSendError(null);

    try {
      const res = await sendTurn({ text, images: staged, turnIndex: turn });
      // 턴 수도 답장이 다 흘러나온 뒤에 반영해, 스트리밍 도중 "결과 확인하기"가 먼저 뜨지 않게 한다.
      setPendingReply({ text: res.reply.trim(), turn: res.turn, maxTurns: res.maxTurns, fallback: res.fallback });
    } catch (e) {
      // 실패해도 방금 쓴 말이 사라지면 안 되니 입력창에 되돌려 바로 재전송할 수 있게 한다.
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
      setImages(staged);
      const userMessage = (e as { userMessage?: string }).userMessage;
      setSendError(userMessage ?? "메시지 전송에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <AppBar title="AI 안심 송금" onHome={onHome} />
      <AiTag />

      <div className="chat-thread" ref={threadRef}>
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === "user" ? "chat-msg-user" : "chat-msg-ai"}`}>
            {m.images && (
              <ThumbStrip
                images={m.images}
                align="end"
                onOpen={(index) => setViewer({ items: m.images!, index })}
              />
            )}
            {m.text && <div className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-ai"}>{m.text}</div>}
            {m.fallback && <p className="chat-fallback-note">AI 연결이 원활하지 않아 기본 안내로 답했어요</p>}
          </div>
        ))}
        {sending && (
          <div className="chat-typing" aria-label="AI가 답장을 쓰는 중">
            <span />
            <span />
            <span />
          </div>
        )}
        {pendingReply && (
          <div className="chat-msg chat-msg-ai">
            <div className="chat-bubble-ai">
              <StreamingText
                text={pendingReply.text}
                onDone={() => {
                  setMessages((prev) => [...prev, { role: "ai", text: pendingReply.text, fallback: pendingReply.fallback }]);
                  setTurn(pendingReply.turn);
                  setMaxTurns(pendingReply.maxTurns);
                  setPendingReply(null);
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="spacer" />

      {/* 입력창·결과 버튼은 화면 하단에 고정한다 — 대화가 쌓여도 매번 스크롤할 필요가 없게. */}
      <div className="chat-footer" ref={footerRef}>
        {turn > 0 && (
          <p className="chat-turn-counter">
            {reachedCap ? "대화를 충분히 확인했어요" : `${turn}/${maxTurns}번 확인했어요`}
          </p>
        )}

        {noChat && <p className="script-hint">💡 이 시나리오는 대화 없이 바로 결과를 확인해요</p>}

        {/* 데모: 대본의 다음 문장을 입력창 위에 추천으로 띄운다 — 누르면 입력창에 채워진다 */}
        {suggestion && (
          <div className="chat-suggestion">
            <p className="script-hint">💡 추천 문장을 누르면 입력창에 채워져요. ↑ 버튼으로 보내보세요</p>
            <button className="chat-suggestion-btn scripted" onClick={applySuggestion}>
              <span className="chat-suggestion-text">"{suggestion.text}"</span>
              {suggestion.images.length > 0 && <span className="chat-suggestion-meta">📷 사진 {suggestion.images.length}장 함께</span>}
            </button>
          </div>
        )}

        {(sendError || error) && <p className="chat-error">{sendError || error}</p>}
        {input.length > MAX_INPUT_CHARS * 0.9 && (
          <p className="chat-char-count">
            {input.length.toLocaleString()}/{MAX_INPUT_CHARS.toLocaleString()}자
          </p>
        )}

        {!reachedCap && !noChat && (
          <>
            {images.length > 0 && (
              <ThumbStrip
                images={images}
                onOpen={(index) => setViewer({ items: images, index })}
                onRemove={(index) => setImages((prev) => prev.filter((_, i) => i !== index))}
              />
            )}
            <div className="chat-input-row">
              <textarea
                ref={textareaRef}
                placeholder="상황을 편하게 말씀해주세요"
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_CHARS))}
                onKeyDown={(e) => {
                  // 한글 등 조합형 입력 중 조합을 확정하는 Enter까지 전송으로 처리하면
                  // 마지막 글자가 끊긴 채로 보내진다 — 조합 중(isComposing)에는 무시한다.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                maxLength={MAX_INPUT_CHARS}
              />
              <button
                className="chat-send-btn chat-attach-btn"
                disabled={busy || images.length >= MAX_ATTACHMENTS}
                title={`사진 첨부 (최대 ${MAX_ATTACHMENTS}장)`}
                aria-label="사진 첨부"
                onClick={() => fileInputRef.current?.click()}
              >
                📷
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFile} />
              <button
                className="chat-send-btn"
                disabled={busy || (!input.trim() && images.length === 0)}
                aria-label="보내기"
                onClick={handleSend}
              >
                ↑
              </button>
            </div>
          </>
        )}

        {allowSkipLink && turn === 0 && !reachedCap && (
          <button className="chat-skip-link" disabled={busy} onClick={onFinish}>
            건너뛰고 바로 결과 볼게요
          </button>
        )}
        {(turn > 0 || noChat) && (
          <button className={`btn ${reachedCap || noChat ? "btn-primary" : "btn-outline"}`} disabled={busy} onClick={onFinish}>
            결과 확인하기
          </button>
        )}
        <SkipAnalysisButton onConfirm={onSkipAnalysis} disabled={busy} />
      </div>

      {viewer && (
        <ImageLightbox
          items={viewer.items}
          index={viewer.index}
          onIndex={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}

async function isReadableImage(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

/** 사진 썸네일 줄. 누르면 크게 보기, onRemove가 있으면 ✕로 빼기(보내기 전 입력창 위). */
function ThumbStrip({
  images,
  align = "start",
  onOpen,
  onRemove,
}: {
  images: StagedImage[];
  align?: "start" | "end";
  onOpen: (index: number) => void;
  onRemove?: (index: number) => void;
}) {
  return (
    <div className={`chat-thumbs align-${align}`}>
      {images.map((img, i) => (
        <div key={`${img.name}-${i}`} className="chat-thumb">
          <button className="chat-thumb-open" onClick={() => onOpen(i)} aria-label={`${img.name} 크게 보기`} title={img.name}>
            <img src={img.url} alt={img.name} />
            <span className="chat-thumb-zoom" aria-hidden>
              🔍
            </span>
          </button>
          {onRemove && (
            <button className="chat-thumb-remove" onClick={() => onRemove(i)} aria-label={`${img.name} 첨부 취소`}>
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** 대화(또는 하단 입력부)가 커질 때마다 화면을 맨 아래로 붙인다 — 새 말풍선, 한 글자씩 흘러나오는
 * 답장, 마지막에 나타나는 "결과 확인하기"까지 항상 보이게. 사용자가 위로 올려 읽는 중이면 끌어내리지 않는다. */
function useAutoScroll(threadRef: React.RefObject<HTMLDivElement | null>, footerRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const screen = threadRef.current?.closest(".screen") as HTMLElement | null;
    if (!screen) return;
    let stick = true;
    const onScroll = () => {
      stick = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 80;
    };
    const toBottom = () => {
      if (stick) screen.scrollTop = screen.scrollHeight;
    };
    const observer = new ResizeObserver(toBottom);
    if (threadRef.current) observer.observe(threadRef.current);
    if (footerRef.current) observer.observe(footerRef.current);
    screen.addEventListener("scroll", onScroll, { passive: true });
    toBottom();
    return () => {
      observer.disconnect();
      screen.removeEventListener("scroll", onScroll);
    };
  }, [threadRef, footerRef]);
}

/** 입력한 만큼 입력창 높이를 늘린다(최대 MAX_INPUT_LINES줄). */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 21;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    // box-sizing: border-box라 높이 = 내용+패딩(scrollHeight) + 테두리.
    const max = line * MAX_INPUT_LINES + padding + border;
    el.style.height = "auto";
    const wanted = el.scrollHeight + border;
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max + 1 ? "auto" : "hidden";
  }, [ref, value]);
}

/** 채팅 맨 아래 "AI분석 무시하고 송금 진행하기". 송금을 막지 않는다는 원칙 그대로, 고객이 원하면
 * 분석을 건너뛸 수 있게 하되 한 번 더 확인받는다 — 위험 신호가 이미 잡혔다면 지연이체로 접수된다. */
function SkipAnalysisButton({ onConfirm, disabled }: { onConfirm: () => void; disabled: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button className="btn btn-secondary skip-analysis-btn" disabled={disabled} onClick={() => setConfirming(true)}>
        AI분석 무시하고 송금 진행하기
      </button>
      {confirming && (
        <BottomSheet>
          <h2 className="sheet-title">AI 분석 없이 송금할까요?</h2>
          <p className="sheet-body">
            지금까지 확인된 내용만으로 송금을 진행해요. 보이스피싱 위험 신호가 이미 확인된 거래라면 안전을 위해
            지연이체로 접수되고, 고객센터에서 최대한 빠르게 확인 연락을 드려요.
          </p>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setConfirming(false)}>
              계속 확인할게요
            </button>
            <button className="btn btn-primary" onClick={onConfirm}>
              송금 진행
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
