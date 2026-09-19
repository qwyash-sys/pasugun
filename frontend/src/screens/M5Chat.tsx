import { useEffect, useRef, useState } from "react";
import AppBar, { AiTag } from "../components/AppBar";
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
  onSendTurn?: (payload: { text: string; attachmentBase64: string | null }) => Promise<ChatTurnResult>;
  /** 대화를 건너뛰거나(0턴) 충분히 나눈 뒤(1턴 이상) 결과 화면으로 넘어간다 — 서버가
   * 세션에 쌓인 대화 유무로 알아서 판단하므로 콜백은 하나면 충분하다. */
  onFinish?: () => void;
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

interface ChatMessage {
  role: "user" | "ai";
  text: string;
  attachment?: string;
}

/** demo 모드: 결과는 대본대로 고정돼있지만, 화면은 실제 채팅처럼 보이게 재생한다. 대사를
 * 직접 타이핑하게 하면 시연 중 오타·삭제로 흐름이 끊기니, 다음 대사를 누르면 사용자 말풍선이
 * 뜨고 잠시 후 AI 응답이 이어지는 식으로 버튼 클릭만으로 진행시킨다. */
function DemoChat({ hint, chatTurns, onDemoSubmit }: Props) {
  const turns = chatTurns ?? [];
  const [completed, setCompleted] = useState(0);
  const [pending, setPending] = useState<DemoTurn | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages: ChatMessage[] = [
    { role: "ai", text: `현재 송금이 안전한지 AI가 분석해드릴 수도 있어요. ${hint || "상황을 편하게 말씀해주세요."}` },
  ];
  for (let i = 0; i < completed; i++) {
    messages.push({ role: "user", text: turns[i].user, attachment: turns[i].attachment });
    messages.push({ role: "ai", text: turns[i].ai });
  }
  if (pending) messages.push({ role: "user", text: pending.user, attachment: pending.attachment });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  function playNext() {
    const turn = turns[completed];
    if (!turn || pending) return;
    setPending(turn);
    setTimeout(() => {
      setPending(null);
      setCompleted((c) => c + 1);
    }, 900);
  }

  const done = completed >= turns.length;
  const noChat = turns.length === 0;
  const nextTurn = !done ? turns[completed] : null;

  return (
    <>
      <AppBar title="AI 안전확인" />
      <AiTag />

      <div className="chat-thread">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === "user" ? "chat-msg-user" : "chat-msg-ai"}`}>
            {m.attachment && <div className="chat-attach-chip">📷 {m.attachment}</div>}
            <div className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-ai"}>{m.text}</div>
          </div>
        ))}
        {pending && (
          <div className="chat-typing">
            <span />
            <span />
            <span />
          </div>
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
          <button className="btn btn-outline" disabled={!!pending} onClick={playNext}>
            {nextTurn.attachment ? "💬📷 " : "💬 "}"{nextTurn.user}"
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
function LiveChat({ customerName, onSendTurn, onFinish, error }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "ai", text: `${customerName}님, 편하게 상황을 말씀해주세요. 몇 가지만 확인하고 바로 알려드릴게요.` },
  ]);
  const [input, setInput] = useState("");
  const [attachedName, setAttachedName] = useState<string | null>(null);
  const [attachmentBase64, setAttachmentBase64] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  const [maxTurns, setMaxTurns] = useState(3);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachedName(file.name);
    setAttachmentBase64(await fileToBase64(file));
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && !attachmentBase64) || sending || !onSendTurn) return;

    const attachment = attachmentBase64;
    const attachmentLabel = attachedName;
    setMessages((prev) => [...prev, { role: "user", text: text || `(첨부: ${attachmentLabel})` }]);
    setInput("");
    setAttachedName(null);
    setAttachmentBase64(null);
    setSending(true);
    setSendError(null);

    try {
      const res = await onSendTurn({ text, attachmentBase64: attachment });
      setMessages((prev) => [...prev, { role: "ai", text: res.reply }]);
      setTurn(res.turn);
      setMaxTurns(res.maxTurns);
    } catch {
      // 실패해도 방금 쓴 말이 사라지면 안 되니 입력창에 되돌려 바로 재전송할 수 있게 한다.
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
      setAttachedName(attachmentLabel);
      setAttachmentBase64(attachment);
      setSendError("메시지 전송에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSending(false);
    }
  }

  const reachedCap = turn >= maxTurns;
  const beforeFirstTurn = turn === 0;

  return (
    <>
      <AppBar title="AI 안전확인" />
      <AiTag />

      <div className="chat-thread">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-ai"}>
            {m.text}
          </div>
        ))}
        {sending && (
          <div className="chat-typing">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {turn > 0 && (
        <p className="chat-turn-counter">
          {reachedCap ? "대화를 충분히 확인했어요" : `${turn}/${maxTurns}번 확인했어요`}
        </p>
      )}

      {(sendError || error) && <p style={{ color: "var(--danger)", fontSize: 13 }}>{sendError || error}</p>}

      {!reachedCap && (
        <>
          {attachedName && <div className="chat-attach-chip">📷 {attachedName}</div>}
          <div className="chat-input-row">
            <textarea
              placeholder="상황을 편하게 말씀해주세요"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
            />
            <button className="chat-send-btn" disabled={sending} onClick={() => fileInputRef.current?.click()}>
              📷
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} />
            <button
              className="chat-send-btn"
              disabled={sending || (!input.trim() && !attachmentBase64)}
              onClick={handleSend}
            >
              ↑
            </button>
          </div>
        </>
      )}

      <div className="spacer" />

      {beforeFirstTurn && !reachedCap && (
        <button className="chat-skip-link" onClick={onFinish}>
          건너뛰고 바로 결과 볼게요
        </button>
      )}
      {turn > 0 && (
        <button className={`btn ${reachedCap ? "btn-primary" : "btn-outline"}`} onClick={onFinish}>
          결과 확인하기
        </button>
      )}
    </>
  );
}
