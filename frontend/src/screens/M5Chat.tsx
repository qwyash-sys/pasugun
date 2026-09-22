import { useEffect, useRef, useState } from "react";
import AppBar, { AiTag } from "../components/AppBar";
import StreamingText from "../components/StreamingText";
import { fileToBase64 } from "../utils/file";

interface ChatTurnResult {
  reply: string;
  turn: number;
  maxTurns: number;
}

interface DemoTurn {
  user: string;
  ai: string;
  /** 이 턴에서 함께 첨부하는 자료(안내문자 캡처 등)의 표시용 파일명. 실제 파일은 필요
   * 없다 — 시연 중 파일 선택창을 띄우지 않고도 첨부 흐름 자체를 보여주기 위한 연출. */
  attachment?: string;
}

interface Props {
  customerName: string;
  isDemo: boolean;
  loading: boolean;
  error: string | null;
  /** demo 모드 전용: AI 첫 인사말에 덧붙는 안내, 그리고 버튼을 눌러 한 턴씩 재생하는 대본.
   * 결과 자체는 어차피 대본대로 고정된다 — 대본은 화면에서 "실제로 대화하는 느낌"만 준다. */
  hint?: string;
  chatTurns?: DemoTurn[];
  onDemoSubmit?: (payload: { skipped: boolean }) => void;
  /** local/remote 모드 전용: 실제 멀티턴 대화. */
  onSendTurn?: (payload: { text: string; attachmentsBase64: string[] }) => Promise<ChatTurnResult>;
  /** 대화를 건너뛰거나(0턴) 충분히 나눈 뒤(1턴 이상) 결과 화면으로 넘어간다 — 서버가
   * 세션에 쌓인 대화 유무로 알아서 판단하므로 콜백은 하나면 충분하다. */
  onFinish?: () => void;
  onHome: () => void;
}

export default function M5Chat(props: Props) {
  if (props.loading) {
    return (
      <div className="loading-wrap">
        <div className="spinner" />
        <p>AI가 확인 중이에요</p>
      </div>
    );
  }

  return props.isDemo ? <DemoChat {...props} /> : <LiveChat {...props} />;
}

// 백엔드 상한(base64 약 14MB ≈ 원본 10MB)보다 여유 있게 잡는다.
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
// 백엔드 ChatTurnRequest.attachments_base64의 max_length와 맞춘다.
const MAX_ATTACHMENTS = 5;

interface ChatMessage {
  role: "user" | "ai";
  text: string;
  attachments?: string[];
}

/** demo 모드: 결과는 대본대로 고정돼있지만, 화면은 실제 채팅처럼 보이게 재생한다. 대사를
 * 직접 타이핑하게 하면 시연 중 오타·삭제로 흐름이 끊기니, 다음 대사를 누르면 사용자 말풍선이
 * 뜨고 잠시 후 AI 응답이 이어지는 식으로 버튼 클릭만으로 진행시킨다. */
function DemoChat({ hint, chatTurns, onDemoSubmit, onHome }: Props) {
  const turns = chatTurns ?? [];
  const [completed, setCompleted] = useState(0);
  // pending: 사용자 말풍선 + "입력 중" 점 3개(생각하는 척). revealing: 그 다음, AI 답장이
  // 한 글자씩 흘러나오는 단계 — 둘을 나눠야 "타이핑 중" 연출과 "스트리밍" 연출이 따로 보인다.
  const [pending, setPending] = useState<DemoTurn | null>(null);
  const [revealing, setRevealing] = useState<DemoTurn | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages: ChatMessage[] = [
    { role: "ai", text: `현재 송금이 안전한지 AI가 분석해드릴 수도 있어요. ${hint || "상황을 편하게 말씀해주세요."}` },
  ];
  for (let i = 0; i < completed; i++) {
    const { user, ai, attachment } = turns[i];
    messages.push({ role: "user", text: user, attachments: attachment ? [attachment] : undefined });
    messages.push({ role: "ai", text: ai });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending, revealing]);

  function playNext() {
    const turn = turns[completed];
    if (!turn || pending || revealing) return;
    setPending(turn);
    setTimeout(() => {
      setPending(null);
      setRevealing(turn);
    }, 900);
  }

  const done = completed >= turns.length;
  const noChat = turns.length === 0;
  const nextTurn = !done && !pending && !revealing ? turns[completed] : null;

  return (
    <>
      <AppBar title="AI 안전확인" onHome={onHome} />
      <AiTag />

      <div className="chat-thread">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === "user" ? "chat-msg-user" : "chat-msg-ai"}`}>
            {m.attachments?.map((name) => (
              <div key={name} className="chat-attach-chip">
                📷 {name}
              </div>
            ))}
            <div className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-ai"}>{m.text}</div>
          </div>
        ))}
        {pending && (
          <>
            <div className="chat-msg chat-msg-user">
              {pending.attachment && <div className="chat-attach-chip">📷 {pending.attachment}</div>}
              <div className="chat-bubble-user">{pending.user}</div>
            </div>
            <div className="chat-typing">
              <span />
              <span />
              <span />
            </div>
          </>
        )}
        {revealing && (
          <>
            <div className="chat-msg chat-msg-user">
              {revealing.attachment && <div className="chat-attach-chip">📷 {revealing.attachment}</div>}
              <div className="chat-bubble-user">{revealing.user}</div>
            </div>
            <div className="chat-msg chat-msg-ai">
              <div className="chat-bubble-ai">
                <StreamingText
                  text={revealing.ai}
                  onDone={() => {
                    setRevealing(null);
                    setCompleted((c) => c + 1);
                  }}
                />
              </div>
            </div>
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="spacer" />

      {noChat && (
        <p className="script-hint">💡 이 시나리오는 대화 없이 바로 결과를 확인해요</p>
      )}

      {!noChat && nextTurn && (
        <>
          <p className="script-hint">💡 아래 말풍선을 눌러 대화를 진행해보세요</p>
          {/* 실채팅(LiveChat)에서 파일을 고르면 전송 전 여기와 같은 칩으로 미리보기가 뜬다 —
              데모도 다음 대사에 첨부가 딸려있다는 걸 같은 방식으로 미리 보여준다. */}
          {nextTurn.attachment && <div className="chat-attach-chip">📷 {nextTurn.attachment}</div>}
          <button className="btn btn-outline" onClick={playNext}>
            💬 "{nextTurn.user}"
          </button>
        </>
      )}

      {(noChat || done) && (
        <button className="btn btn-primary" onClick={() => onDemoSubmit?.({ skipped: noChat })}>
          결과 확인하기
        </button>
      )}
    </>
  );
}

/** local/remote 모드: 실제 AI 상담원과 2~3턴 정도 주고받는 채팅. 게시판에 글 올리고 결과만
 * 받아보는 방식 대신, 짧게라도 대화를 주고받은 뒤 결론 화면(M6)으로 넘어가게 한다. 대화가
 * 길어지면 안 되므로 턴 수는 백엔드가 하드 캡(MAX_CHAT_TURNS)으로 못박는다. */
function LiveChat({ customerName, onSendTurn, onFinish, onHome, error }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "ai", text: `${customerName}님, 편하게 상황을 말씀해주세요. 몇 가지만 확인하고 바로 알려드릴게요.` },
  ]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<{ name: string; base64: string }[]>([]);
  const [sending, setSending] = useState(false);
  // 백엔드가 완성된 답을 한 번에 돌려주지만(멀티턴 tool-use 루프라 진짜 토큰 스트리밍은
  // 배보다 배꼽), 도착 즉시 통째로 박아넣지 않고 여기 잠깐 담아뒀다가 화면에서 흘려보낸다.
  const [pendingReply, setPendingReply] = useState<{ text: string; turn: number; maxTurns: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  const [maxTurns, setMaxTurns] = useState(3);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 하단 고정 푸터가 음수 마진을 써서 sentinel이 실제 끝보다 위에 놓이므로, 화면 컨테이너를 직접 맨 아래로 내린다.
    const screen = bottomRef.current?.closest(".screen");
    screen?.scrollTo({ top: screen.scrollHeight });
  }, [messages, sending, pendingReply]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const fileInput = e.target;
    const picked = Array.from(fileInput.files ?? []);
    // 같은 파일을 다시 골라도 change가 발생하도록 비워둔다(안 비우면 같은 파일 재선택이 무반응).
    fileInput.value = "";
    if (picked.length === 0) return;

    const room = MAX_ATTACHMENTS - attachments.length;
    const within = picked.slice(0, room);
    const sized = within.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    const droppedForSize = within.length - sized.length;

    if (picked.length > room) {
      setSendError(`이미지는 최대 ${MAX_ATTACHMENTS}장까지 첨부할 수 있어요.`);
    } else if (droppedForSize > 0) {
      setSendError("이미지가 너무 커요. 7MB 이하로 올려주세요.");
    } else {
      setSendError(null);
    }
    if (sized.length === 0) return;

    const encoded = await Promise.all(
      sized.map(async (f) => ({ name: f.name, base64: await fileToBase64(f) })),
    );
    setAttachments((prev) => [...prev, ...encoded]);
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending || pendingReply || !onSendTurn) return;

    const staged = attachments;
    setMessages((prev) => [
      ...prev,
      { role: "user", text, attachments: staged.length > 0 ? staged.map((a) => a.name) : undefined },
    ]);
    setInput("");
    setAttachments([]);
    setSending(true);
    setSendError(null);

    try {
      const res = await onSendTurn({ text, attachmentsBase64: staged.map((a) => a.base64) });
      // 여기서 바로 messages에 넣지 않는다 — pendingReply로 넘겨 화면에서 흘려보낸 뒤,
      // 다 나오면(onDone) 그때 확정해 넣는다. turn/maxTurns도 같이 미뤄서, 스트리밍
      // 도중에 "결과 확인하기" 같은 버튼이 먼저 나타나는 걸 막는다.
      setPendingReply({ text: res.reply, turn: res.turn, maxTurns: res.maxTurns });
    } catch {
      // 실패해도 방금 쓴 말이 사라지면 안 되니 입력창에 되돌려 바로 재전송할 수 있게 한다.
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
      setAttachments(staged);
      setSendError("메시지 전송에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSending(false);
    }
  }

  const reachedCap = turn >= maxTurns;
  const beforeFirstTurn = turn === 0;
  const busy = sending || !!pendingReply;

  return (
    <>
      <AppBar title="AI 안전확인" onHome={onHome} />
      <AiTag />

      <div className="chat-thread">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === "user" ? "chat-msg-user" : "chat-msg-ai"}`}>
            {m.attachments?.map((name) => (
              <div key={name} className="chat-attach-chip">
                📷 {name}
              </div>
            ))}
            {m.text && <div className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-ai"}>{m.text}</div>}
          </div>
        ))}
        {sending && (
          <div className="chat-typing">
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
                  setMessages((prev) => [...prev, { role: "ai", text: pendingReply.text }]);
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

      {/* 입력창·결과 버튼은 스크롤과 무관하게 화면 하단에 고정한다 — 대화가 쌓이면 폰에서
          입력창과 "결과 확인하기"가 화면 밖으로 밀려나 매번 스크롤해야 했다. */}
      <div className="chat-footer">
        {turn > 0 && (
          <p className="chat-turn-counter">
            {reachedCap ? "대화를 충분히 확인했어요" : `${turn}/${maxTurns}번 확인했어요`}
          </p>
        )}

        {(sendError || error) && <p style={{ color: "var(--danger)", fontSize: 13 }}>{sendError || error}</p>}

        {!reachedCap && (
          <>
            {attachments.length > 0 && (
              <div className="chat-attach-list">
                {attachments.map((a, i) => (
                  <div key={`${a.name}-${i}`} className="chat-attach-chip removable">
                    📷 {a.name}
                    <button type="button" aria-label={`${a.name} 첨부 취소`} onClick={() => removeAttachment(i)}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="chat-input-row">
              <textarea
                placeholder="상황을 편하게 말씀해주세요"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // 한글 등 조합형 입력 중 조합을 확정하는 Enter까지 전송으로 처리하면
                  // 마지막 글자가 끊긴 채로 보내진다 — 조합 중(isComposing)에는 무시한다.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                maxLength={2000}
              />
              <button
                className="chat-send-btn"
                disabled={busy || attachments.length >= MAX_ATTACHMENTS}
                title={`사진 첨부 (최대 ${MAX_ATTACHMENTS}장)`}
                onClick={() => fileInputRef.current?.click()}
              >
                📷
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFile} />
              <button
                className="chat-send-btn"
                disabled={busy || (!input.trim() && attachments.length === 0)}
                onClick={handleSend}
              >
                ↑
              </button>
            </div>
          </>
        )}

        {beforeFirstTurn && !reachedCap && (
          <button className="chat-skip-link" disabled={busy} onClick={onFinish}>
            건너뛰고 바로 결과 볼게요
          </button>
        )}
        {turn > 0 && (
          <button className={`btn ${reachedCap ? "btn-primary" : "btn-outline"}`} disabled={busy} onClick={onFinish}>
            결과 확인하기
          </button>
        )}
      </div>
      <div ref={bottomRef} />
    </>
  );
}
